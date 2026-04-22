# HTTP API

All routes are served by `server.py` on `127.0.0.1:8123`.

| Method | Path                                        | Returns  | Purpose                                      |
|--------|---------------------------------------------|----------|----------------------------------------------|
| GET    | `/`                                         | HTML     | Library shelf + upload dropzone              |
| POST   | `/upload`                                   | JSON     | Ingest an uploaded `.epub`                   |
| GET    | `/read/{book_id}`                           | HTML     | Redirects to chapter 0                       |
| GET    | `/read/{book_id}/{chapter_index}`           | HTML     | Single-chapter reader view                   |
| GET    | `/read/{book_id}/images/{image_name}`       | binary   | Image extracted during ingest                |
| GET    | `/docs`                                     | HTML     | FastAPI auto-generated Swagger UI (built in) |
| GET    | `/openapi.json`                             | JSON     | OpenAPI schema (built in)                    |

`book_id` is always a folder name ending in `_data` (e.g. `the-challenger-customer_data`).

## `POST /upload`

**Request:** `multipart/form-data` with a single `file` field containing an `.epub`.

```bash
curl -F "file=@dracula.epub" http://127.0.0.1:8123/upload
```

**Success — 200:**

```json
{
  "ok": true,
  "book_id": "dracula_data",
  "title": "Dracula",
  "author": "Bram Stoker",
  "chapters": 27
}
```

**Errors:**

- `400` — file is missing or extension isn't `.epub`:
  ```json
  {"error": "Only .epub files are supported."}
  ```
- `500` — parsing failed (corrupt EPUB, unsupported structure, disk error):
  ```json
  {"error": "Failed to process EPUB: <message>"}
  ```

**Side effects** (in order):
1. The upload is copied to a temp file (`tempfile.NamedTemporaryFile`).
2. `process_epub` parses it and writes `books/<basename>_data/{book.pkl, images/*}`. Any existing folder of that name is **wiped first** — re-uploading replaces the book.
3. `load_book_cached.cache_clear()` runs so the next GET sees fresh data.
4. The temp file is unlinked (best-effort).

## `GET /read/{book_id}/{chapter_index}`

- `chapter_index` is an integer in `[0, len(book.spine))`.
- Returns `404` if the book folder is missing, the pickle can't be loaded, or the index is out of range.
- The template receives `book`, `current_chapter`, `chapter_index`, `book_id`, `prev_idx`, `next_idx`.
- `prev_idx` is `None` at index 0; `next_idx` is `None` at the last chapter.

## Chat endpoints

### `GET /chat/health`
Returns the current chat capability status.
**Response**: `{"ok": bool, "model": str, "has_key": bool}`
- `ok`: `true` if `ANTHROPIC_API_KEY` is set and chat is available.
- `model`: the model that will be used (default `claude-sonnet-4-6`, overridable via `READER3_MODEL`).
- `has_key`: `true` if the API key is present in the environment.

### `POST /chat`
Streams an LLM reply as Server-Sent Events.
**Request body** (JSON):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `book_id` | string | yes | Book folder name (e.g. `mypbook_data`) |
| `chapter_index` | int | yes | Zero-based spine index |
| `selection` | string | no | Selected passage text |
| `action` | string | yes | One of: `explain`, `summarize`, `translate`, `discuss`, `free` |
| `messages` | array | yes | Prior turns: `[{"role": "user"/"assistant", "content": "..."}]` |

**Response**: `text/event-stream`. Each event:
- Token event: `data: {"token": "<text>"}`
- Done event: `data: {"done": true}`
- Error event: `data: {"error": "<message>"}`

**Error codes**: 404 (book not found), 422 (chapter_index out of range), 503 (ANTHROPIC_API_KEY not set).

## `GET /read/{book_id}/images/{image_name}`

Serves a file from `books/<book_id>/images/<image_name>`. Both path segments go through `os.path.basename` before being joined, so `../` traversal is blocked. Returns `404` if the file doesn't exist.

The HTML served by the reader view uses relative `src="images/xxx"` paths, which the browser resolves against the current URL `/read/{book_id}/<chapter>` → `/read/{book_id}/images/xxx`. That's why the route is nested under `/read/{book_id}/` rather than a flat `/images/`.

## Notebook endpoints

All notebook routes are scoped to a single book via `{book_id}`. The backing store is `books/<book_id>/notebook.json` — a plain JSON file with `schema_version: 1` and a top-level `entries` array.

### Entry JSON schema

```json
{
  "id": "ulid-string",
  "scope": {
    "level": "book | chapter | selection",
    "chapter_index": 0,
    "selection": {
      "text": "The selected passage text",
      "char_start": 120,
      "char_end": 240
    }
  },
  "type": "note | summary | bullets | diagram | quote | question",
  "body": "Markdown body of the entry",
  "origin": "human | llm",
  "llm": "claude-sonnet-4-6",
  "tags": ["tag1", "tag2"],
  "created_at": "2026-04-22T10:00:00Z",
  "updated_at": "2026-04-22T10:05:00Z"
}
```

**Field descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | ULID — unique, sortable by creation time |
| `scope.level` | enum | `book` — entire book; `chapter` — one spine entry; `selection` — a text range |
| `scope.chapter_index` | int \| null | Zero-based spine index; required when `level` is `chapter` or `selection` |
| `scope.selection` | object \| null | Present only when `level` is `selection` |
| `scope.selection.text` | string | The selected passage verbatim |
| `scope.selection.char_start` | int | Character offset from the start of the chapter's `content` string |
| `scope.selection.char_end` | int | Character offset (exclusive) |
| `type` | enum | `note` free-form note; `summary` prose summary; `bullets` bullet-point list; `diagram` Mermaid source; `quote` extracted quote; `question` open question |
| `body` | string | Markdown content of the entry |
| `origin` | enum | `human` — user wrote it; `llm` — generated by the model |
| `llm` | string \| null | Model ID used when `origin` is `llm`, e.g. `claude-sonnet-4-6` |
| `tags` | string[] | Free-form tags for filtering |
| `created_at` | ISO-8601 string | UTC timestamp |
| `updated_at` | ISO-8601 string | UTC timestamp, updated on every PATCH |

---

### `GET /notebook/{book_id}/entries`

List notebook entries for a book, optionally filtered.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `chapter_index` | int | If provided, returns only entries whose `scope.chapter_index` matches |
| `type` | string | If provided, returns only entries whose `type` matches |

**Response — 200:**

```json
{
  "entries": [ /* array of entry objects */ ]
}
```

**Errors:** `404` if `book_id` folder does not exist.

---

### `POST /notebook/{book_id}/entries`

Create a new notebook entry.

**Request body (JSON):**

```json
{
  "scope": { "level": "chapter", "chapter_index": 2 },
  "type": "note",
  "body": "The author introduces the main antagonist here.",
  "origin": "human",
  "tags": ["characters"]
}
```

All fields except `llm` are required. `id`, `created_at`, and `updated_at` are assigned server-side.

**Response — 201:** The created entry object (full schema).

**Errors:** `404` (book not found), `422` (validation error — e.g. missing required field, `chapter_index` out of range).

---

### `PATCH /notebook/{book_id}/entries/{id}`

Update one or more fields of an existing entry. All body fields are optional; only supplied fields are changed. `id`, `created_at`, `scope` are immutable.

**Request body (JSON, partial):**

```json
{ "body": "Revised note text.", "tags": ["characters", "antagonist"] }
```

**Response — 200:** The updated entry object.

**Errors:** `404` (book or entry not found), `422` (invalid field value).

---

### `DELETE /notebook/{book_id}/entries/{id}`

Delete a single entry by `id`.

**Response — 204:** No body.

**Errors:** `404` (book or entry not found).

---

### `GET /notebook/{book_id}`

Digest view — full HTML page listing all entries grouped by chapter, with a book-level summary at the top. Intended as a read-only overview of the entire reading notebook.

**Response:** `text/html` — rendered `digest.html` template.

**Errors:** `404` if book not found.

---

### `GET /notebook/{book_id}/export.md`

Export all notebook entries as a single Markdown document, grouped by chapter. The response is `text/markdown; charset=utf-8` with `Content-Disposition: attachment; filename="<book_id>_notebook.md"`.

**Response:** Markdown file download.

**Errors:** `404` if book not found.
