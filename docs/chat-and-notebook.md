# Chat & Notebook

Two features that live side-by-side in the same side panel of the reader:

- **Chat** — stream replies from Claude about the current chapter or a selected passage. No persistence.
- **Notebook** (bitácora) — per-book JSON sidecar for saving notes, summaries, diagrams, and LLM replies. Persistent on disk.

They share one panel but are otherwise independent: you can use the notebook without ever setting an API key, and you can use chat without ever saving anything.

For a user walk-through, see [`usage.md`](usage.md#chatting-with-the-llm). For the HTTP surface, see [`api.md`](api.md#chat-endpoints). This document covers how it all fits together under the hood.

---

## Chat

### Data flow

```
browser selection ──► POST /chat ──► reader3.llm.stream_chat ──► Anthropic API
       ▲                │                     │
       │                │                     │ async for text in stream.text_stream
       │                ▼                     │
       └─── SSE events ─┴─── yield text ◄─────┘
             (data: {"token": "..."})
             (data: {"done": true})
             (data: {"error": "..."})
```

### The pieces

**`reader3/llm.py`** — thin async wrapper around `anthropic.AsyncAnthropic`.
- `DEFAULT_MODEL = "claude-sonnet-4-6"`, overridable via `READER3_MODEL` env var.
- `stream_chat(messages, system, model)` is an `AsyncIterator[str]` that yields plain text deltas via `stream.text_stream`.
- A module-level singleton client (`_get_client()`) is reused across requests — no per-request re-instantiation, so the underlying httpx connection pool is preserved.
- `ANTHROPIC_API_KEY` is read from the environment **at call time**, not at import. Missing key → `RuntimeError("ANTHROPIC_API_KEY not set")`.

**`POST /chat`** in `server.py` — the only chat route.
- Validates `book_id` (sanitised via `os.path.basename`) and `chapter_index`.
- Validates `action` as a `Literal["explain", "summarize", "translate", "discuss", "free"]` via Pydantic.
- Assembles the **entire system prompt server-side** (book title, authors, chapter title, the first ~3000 chars of chapter text, and the selection wrapped in `"""…"""` delimiters). The client never supplies the system prompt.
- Returns a `StreamingResponse` with `media_type="text/event-stream"` — one SSE event per token, then a `done` event.
- Returns `503` if `ANTHROPIC_API_KEY` is unset — checked *before* opening the stream so the client gets a proper status code instead of an empty stream.

**`GET /chat/health`** — returns `{ok, model, has_key}`. The frontend polls this on page load and disables the toolbar buttons if `has_key` is false.

**`templates/partials/side_panel.html`** — the side-panel markup. Two tabs (Chat, Notebook), a selection quote block, a message list, and an input row.

**`static/side_panel.js`** — handles the streaming client. Key points:
- `textContent = rawText` during streaming. We only switch to `innerHTML = DOMPurify.sanitize(marked.parse(rawText))` **after** the `done` event. This prevents partial-markdown XSS and keeps the streaming render cheap.
- Each in-flight stream has an `AbortController`; starting a new chat cancels the previous one.
- A floating selection toolbar attaches to `mouseup` on `#chapterBody`. Clicking an action (Explain / Summarize / …) opens the panel, quotes the selection, and kicks off the SSE request.

### Prompt caching

The system prompt is sent with `cache_control: {type: "ephemeral"}`, so the chapter context is cached on Anthropic's side. Follow-up questions within the same chapter hit the cache → noticeably faster time-to-first-token.

### What chat does *not* do

- **No history persistence.** Messages live in memory; closing the tab clears them.
- **No per-book conversations.** "New conversation" is a local reset button only.
- **No rate limiting / no auth.** reader 3 is localhost-only and single-user by design.

---

## Notebook

### Storage layout

One JSON file per book, sitting next to `book.pkl`:

```
books/<name>_data/
├── book.pkl
├── images/
├── notebook.json        ← all entries for this book
└── notebook.json.lock   ← filelock sentinel (auto-managed)
```

`notebook.json` is human-readable and safe to open in a text editor. Example shape:

```json
{
  "book_id": "dracula_data",
  "schema_version": 1,
  "created_at": "2026-04-22T10:15:00+00:00",
  "updated_at": "2026-04-22T11:02:33+00:00",
  "entries": [
    {
      "id": "f3a1e2bc-4c25-4c8a-...",
      "scope": {
        "level": "selection",
        "chapter_index": 2,
        "selection": {"text": "…", "char_start": 1240, "char_end": 1312}
      },
      "type": "quote",
      "body": "A telling passage.",
      "origin": "human",
      "tags": [],
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

### Entry schema

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID string | Server-generated on create |
| `scope.level` | `"book"`, `"chapter"`, or `"selection"` | `"book"` notes apply to the whole volume |
| `scope.chapter_index` | int | Required when level ≠ `"book"` |
| `scope.selection.text` | str | The verbatim passage; validated against chapter text at create time (warn on drift, don't reject) |
| `scope.selection.char_start` / `char_end` | int | Bounds validated against `chapter.text` length |
| `type` | str | `note`, `summary`, `bullets`, `quote`, `question`, `diagram` |
| `body` | str | Markdown. For `diagram`, the body is Mermaid source |
| `origin` | str | `"human"` or `"llm"` |
| `llm.model` | str | Optional — model ID when `origin == "llm"` |
| `tags` | string[] | Free-form |
| `created_at` / `updated_at` | ISO-8601 UTC | |

### Write safety

Two concurrent tabs saving at once used to be a recipe for lost writes. Three defences:

1. **`filelock.FileLock`** around both `load()` and `save()` using `notebook.json.lock` — cross-platform, cooperative, 5-second timeout.
2. **Atomic rename**: `save()` writes to a `NamedTemporaryFile` in the same directory, then `os.replace()`s it onto `notebook.json`. No partial writes survive a crash.
3. **`updated_at` is set inside the lock**, so two writers can't race between reading the timestamp and winning the rename.

### Validation

`_validate_entry()` runs before every create:

- Rejects out-of-range `chapter_index` (`ValueError` → 422 from the route).
- Rejects `char_start`/`char_end` that fall outside the chapter text or are inverted.
- **Warns, doesn't reject**, if `scope.selection.text` differs from what's actually at those offsets. (Text can legitimately drift if a book was re-ingested with different HTML cleaning; killing old notes would be worse than keeping a mildly stale quote.)

### HTTP surface

Five JSON routes + one HTML digest + one Markdown export:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/notebook/{book_id}/entries?chapter_index=&type=` | List entries (optionally filtered) |
| `POST` | `/notebook/{book_id}/entries` | Create an entry (201 on success) |
| `PATCH` | `/notebook/{book_id}/entries/{entry_id}` | Update `body` and `tags` only |
| `DELETE` | `/notebook/{book_id}/entries/{entry_id}` | 204 on success, 404 if gone |
| `GET` | `/notebook/{book_id}` | Read-only HTML digest (editorial layout, grouped by chapter) |
| `GET` | `/notebook/{book_id}/export.md` | All entries as one Markdown file |

Every route sanitises `book_id` with `os.path.basename` before touching disk and confirms the book exists via `load_book_cached` before calling the notebook module.

### Frontend integration

- **Tab in the side panel** (`static/notebook.js`, `static/notebook.css`) — three sub-views: current-scope (chapter), book-wide index with type/origin filters, and a link to the full digest page.
- **Entry composer** — type dropdown + Markdown textarea; saves via `POST /notebook/{id}/entries`.
- **"Save to Notebook"** button appears under every completed assistant bubble in the Chat tab. Clicking it opens the composer pre-filled with the reply text and `origin: "llm"`.
- **Margin marks** (`❦`) — for entries with `scope.level == "selection"` in the current chapter, a small glyph is placed in the reader margin. Clicking it jumps to the Notebook tab and scrolls to that entry card.
- **Diagram entries** — Mermaid is loaded from CDN with `securityLevel: "strict"`. After Mermaid renders, the resulting SVG is passed through DOMPurify with `USE_PROFILES: {svg: true, svgFilters: true}` before being inserted. This closes the stored-XSS path that Mermaid's default renderer would otherwise leave open.

### What notebook does *not* do

- **No cross-book search or tagging**. Each book is an island.
- **No conflict resolution beyond file locks**. Two simultaneous edits of the *same entry* in different tabs → last write wins (within the critical section). Good enough for single-user.
- **No migrations.** `schema_version` is `1`; if the schema ever changes, bump the version and write a migration.

---

## How they interact

The only point of contact is the **"Save to Notebook"** button on assistant replies:

```
   Chat tab                         Notebook tab
   ──────────                       ────────────
   assistant bubble
   "Here's a summary..."
          │
          │ click "Save to Notebook"
          ▼
   window.openNotebookComposerWithText(rawText)
          │
          ▼
   switch tabs ──► composer opens, prefilled with:
                     type:   summary
                     body:   <the reply text>
                     origin: llm
                     scope:  current chapter
```

Everything else is independent. Chat doesn't read the notebook; notebook doesn't read chat history.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | *(unset)* | Required for `/chat`. Without it, chat UI degrades gracefully — notebook still works. |
| `READER3_MODEL` | `claude-sonnet-4-6` | Overrides the Claude model used by `/chat`. |

Read at call time, not at import, so rotating the key does not require a restart (though an in-flight stream will not pick up the new key until it finishes).

---

## Extending

- **Add an entry type** → add it to the `<select>` in `templates/partials/side_panel.html` and to the digest template's type badge rendering. No server change needed; `type` is a free-form string.
- **Add a chat action** → add it to the `Literal[...]` in `server.py`'s `ChatRequest`, add a toolbar button in `side_panel.html`, and extend the system-prompt assembly in `chat_endpoint` if the new action needs special framing.
- **Change the notebook schema** → bump `schema_version` in `reader3/notebook.py`, add a migration step in `load()` that upgrades old files on first read, and document the change in `CLAUDE.md`.
- **Swap the LLM backend** → `reader3/llm.py` is the only file that imports `anthropic`. Replace `stream_chat` with a different provider's async streamer that also yields `str` tokens and nothing else needs to change.
