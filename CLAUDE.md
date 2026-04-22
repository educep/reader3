# reader3

Lightweight self-hosted **EPUB** reader. Users ingest an `.epub` (CLI or browser upload), then browse it chapter-by-chapter at `localhost:8123`. Intended for copy-pasting chapters into an LLM to read along.

> Full human-readable docs live under [`docs/`](docs/README.md) — `architecture.md`, `usage.md`, `api.md`, `extending.md`.

## Documentation lookups

Use the Context7 MCP for up-to-date docs on any third-party library before writing or reviewing code that calls it. Two steps: `resolve-library-id` then `query-docs`. See `.claude/skills/context7-docs/SKILL.md` for the library name table, examples, and the "when to use / when to skip" rules. Required for FastAPI, Starlette, Jinja2, ebooklib, BeautifulSoup, anthropic SDK, marked, DOMPurify, mermaid; skip for stdlib-only work.

## Architecture

Two-stage pipeline: **ingest → on-disk pickle → FastAPI server**. The ingester is shared by both entry points (CLI and upload endpoint).

```
.epub  ──(reader3.py / POST /upload)──►  books/<name>_data/book.pkl   ──(server.py)──►  browser
                                         books/<name>_data/images/*
```

- **`reader3.py`** — ingester. `process_epub(epub_path, output_dir)` parses via `ebooklib`, cleans HTML with `BeautifulSoup` (strips `script`/`style`/`iframe`/`nav`/`form`/`button`/`input`/comments), extracts images to `<output_dir>/images/`, rewrites `<img src>` to relative `images/<file>` paths, builds a TOC tree, and returns a `Book` dataclass. `save_to_pickle` then writes `book.pkl`.
  - CLI: `uv run reader3.py path/to/book.epub` → always writes to `books/<basename>_data/` regardless of where the source file lives (only basename is used; `books/` is created if missing).
  - Image extraction covers **both** `ITEM_IMAGE` and `ITEM_COVER` — older EPUBs that only tag covers as `ITEM_COVER` (e.g. `src="image/cover.jpg"`) rely on this or they 404.
  - The image map uses **two keys** per image: full internal EPUB path and bare basename. This is deliberate — `<img src>` attributes in the wild are messy (URL-encoded, `../`-prefixed, inconsistent casing), and the double key makes rewriting robust.

### Phase 1: Chat (added 2026-04-22)
- New routes: `GET /chat/health`, `POST /chat` (SSE stream).
- New files: `reader3/llm.py` (Anthropic streaming helper), `static/side_panel.js`, `static/side_panel.css`, `templates/partials/side_panel.html`.
- Env vars: `ANTHROPIC_API_KEY` (required for chat; server boots without it), `READER3_MODEL` (optional, default `claude-sonnet-4-6`).
- System prompt assembled server-side; client never supplies it.

### Phase 2: Bitácora (added 2026-04-22)
- `notebook.json` sidecar at `books/<id>/notebook.json` — one file per book, human-readable JSON with schema_version 1.
- `filelock` dependency: prevents torn writes when entries are saved rapidly.
- New files: `reader3/notebook.py` (CRUD + validation), `static/notebook.js`, `static/notebook.css`, `static/digest.js`, `templates/digest.html`.
- New routes: `GET/POST /notebook/{book_id}/entries`, `PATCH/DELETE /notebook/{book_id}/entries/{id}`, `GET /notebook/{book_id}` (digest HTML), `GET /notebook/{book_id}/export.md`.
- Note: notebook writes do NOT mutate `book.pkl`, so `load_book_cached.cache_clear()` is NOT needed for notebook operations.

- **`server.py`** — FastAPI app on `127.0.0.1:8123`.
  - `GET /` → library shelf (editorial-styled template with Fraunces + IBM Plex Mono from Google Fonts).
  - `POST /upload` → accepts an `.epub` via `UploadFile`, writes to a `NamedTemporaryFile`, calls `process_epub` + `save_to_pickle` into `books/<basename>_data/`, **clears** `load_book_cached.cache_clear()`, returns JSON `{ok, book_id, title, author, chapters}`. Rejects non-`.epub` with 400; parse failures return 500 with `{"error": ...}`. Requires `python-multipart` (already in deps).
  - `GET /read/{book_id}` → redirects to chapter 0.
  - `GET /read/{book_id}/{chapter_index}` → renders one spine item with Prev/Next + TOC sidebar.
  - `GET /read/{book_id}/images/{image_name}` → serves extracted images. Path safety = `os.path.basename` on both params.
  - `load_book_cached` = `lru_cache(maxsize=10)` keyed by folder name. **Upload clears it automatically. CLI ingests do not — restart the server.**

- **`templates/`** — Jinja2.
  - `library.html` — editorial aesthetic: paper-cream background with SVG grain, deep ink, oxblood accent, Fraunces display + IBM Plex Mono metadata. Drag-and-drop dropzone posts to `/upload` with `FormData`, shows indeterminate progress, then reloads and highlights the new volume via `sessionStorage`.
  - `reader.html` — recursive TOC sidebar + single-chapter body. Jinja emits a `spineMap` (`href → spine index`) so TOC clicks resolve to the correct linear chapter index client-side. TOC entries whose `file_href` isn't in the spine silently fail (logged to console).

## Data model (pickle = contract)

- `Book` — root: `metadata`, `spine: List[ChapterContent]`, `toc: List[TOCEntry]`, `images: Dict[str,str]`, `source_file`, `processed_at`, `version`.
- `ChapterContent` — one spine file: `id`, `href` (filename, matches TOC entries), `title`, `content` (cleaned inner-body HTML), `text` (plain text for LLM copy-paste), `order`.
- `TOCEntry` — recursive: `title`, `href`, `file_href`, `anchor`, `children`.
- **Spine vs TOC**: the spine is linear reading order (one per physical file); the TOC is the navigation tree and may point to anchors *inside* spine files. Active-chapter matching uses `file_href` only — anchors are ignored for highlighting.

## Running

```bash
uv run server.py           # http://127.0.0.1:8123 — includes upload UI
uv run reader3.py FILE     # CLI ingest → books/<name>_data/
```

Python 3.12+, managed via `uv` (`pyproject.toml` + `uv.lock`). Deps: `fastapi`, `uvicorn`, `jinja2`, `ebooklib`, `beautifulsoup4`, `python-multipart`. FastAPI's built-in `/docs` (Swagger UI) and `/openapi.json` are available alongside the app's routes.

## Gotchas for extending

- **Pickle format is the contract.** Changing `Book`/`ChapterContent`/`TOCEntry` dataclasses requires re-ingesting every book. There's no migration. Bump `Book.version` if you break compat.
- **`lru_cache` invalidation.** Any write path that mutates an existing book must `load_book_cached.cache_clear()` (or evict the specific key). `/upload` does this; CLI ingest can't (different process) — restart the server.
- **Upload replaces.** `process_epub` `shutil.rmtree`s the output dir before recreating it, so re-uploading an `.epub` with the same basename overwrites the existing book. That's how CLI and upload both behave — intentional, but don't use it as a "versioning" mechanism.
- **Path safety** currently relies on `os.path.basename`. If you add any new file-serving route, do the same or use `os.path.realpath` + `startswith(BOOKS_DIR)`.
- **HTML cleaning is aggressive.** If a feature needs `script`/`style`/`iframe`/`video`/`nav`/`form`/`button`/`input`, adjust `clean_html_content` — by the time the server sees the content, those tags are gone.
- **TOC can be empty.** `get_fallback_toc` builds a flat TOC from the spine; titles are guessed from filenames.
- **Fonts are loaded from Google Fonts CDN.** First paint on the library page requires internet. Swap for self-hosted fonts if offline use matters.
- **Single-user, localhost.** No auth, no accounts, no rate limiting. Don't expose `server.py` to a network without a proxy + auth in front.
- **Pickle is trusted input.** Don't accept `book.pkl` files from elsewhere — pickle can execute arbitrary code on load.
- **README's "vibe-coded illustration" disclaimer** still applies from upstream — feel free to refactor freely, no backwards-compat expectations.
