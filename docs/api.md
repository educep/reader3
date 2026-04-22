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
