# Extending reader 3

Things to know before modifying each piece.

## The pickle is the contract

`Book`, `ChapterContent`, `TOCEntry`, `BookMetadata` in `reader3.py` define the on-disk format.

- Adding a **new optional field** with a default is safe — old pickles can still be loaded.
- **Renaming or removing** a field breaks every existing book. Bump `Book.version` and plan a re-ingest.
- Moving dataclasses to a different module breaks pickles too (pickle stores the import path). If you must, keep a compatibility re-export at the old path.
- Pickle files are trusted input — this project is single-user. Don't accept pickles from elsewhere.

## The `lru_cache` on `load_book_cached`

`server.py` wraps `load_book_cached` with `functools.lru_cache(maxsize=10)` keyed on folder name. Consequences:

- Any write path that mutates an existing book **must** call `load_book_cached.cache_clear()` (or evict that key) or the server keeps serving stale content. The `/upload` handler already does this.
- The cache is process-local. CLI re-ingests while the server is running require a server restart.
- `maxsize=10` means an 11th book evicts the least-recently-used. For very large libraries, raise this.

## HTML cleaning is aggressive

`clean_html_content` in `reader3.py` strips `script`, `style`, `iframe`, `video`, `nav`, `form`, `button`, `input`, and all HTML comments. If your feature needs any of those (e.g. preserving original styles, embedded video), change the cleaner rather than working around it downstream — the text has already been dropped by the time the server sees it.

## Image rewriting

`process_epub` builds the image map with **two keys** per image — the full internal EPUB path and the bare basename — so that messy `<img src>` values (`../images/foo.jpg`, URL-encoded paths, absolute vs relative) still match. Image extraction runs on both `ITEM_IMAGE` and `ITEM_COVER`; older EPUBs that only tag the cover as `ITEM_COVER` won't be missed.

If you see a 404 on an image after ingest, it almost always means the `src` in the cleaned HTML didn't match either key in the map. Print `image_map.keys()` and the unmatched `src` to debug.

## Path safety

`GET /read/{book_id}/images/{image_name}` sanitises both path params with `os.path.basename`. If you add any new route that reads from disk using user-supplied components, do the same — or `os.path.realpath` + `startswith(BOOKS_DIR)` check.

## Templates

- `library.html` — shelf + upload UI. Uses Fraunces + IBM Plex Mono from Google Fonts (requires internet on first load). Dropzone talks to `POST /upload` via `fetch` + `FormData`. The "new book" highlight uses `sessionStorage` to survive a reload.
- `reader.html` — single-chapter view. The `spineMap` object is rendered inline from `book.spine` so TOC links can resolve `href → linear index` in JS. If you change the shape of `ChapterContent`, update the template.

## TODO / Roadmap

Rough shortlist of features that fit the current architecture:

### Primary goal — Read *with* an LLM and keep a "bitácora"

Two connected features that define where the project is heading:

- [x] **Selection-aware LLM chat** ✓ — Implemented in Phase 1 (2026-04-22). Selection toolbar appears on `mouseup`; right-hand side panel streams replies via `POST /chat` (SSE); API key stays server-side. Actions: *Explain*, *Summarize*, *Translate*, *Discuss*, *Free chat*. See `reader3/llm.py`, `static/side_panel.js`, `static/side_panel.css`.

- [x] **Bitácora / Reading Notebook** ✓ — Implemented in Phase 2 (2026-04-22). `books/<id>/notebook.json` sidecar stores entries with scope, type, body, origin, tags, and timestamps. Notebook tab in the side panel; `GET/POST/PATCH/DELETE /notebook/{book_id}/entries[/{id}]`; digest view at `/notebook/{book_id}`; Markdown export at `/notebook/{book_id}/export.md`. See `reader3/notebook.py`, `static/notebook.js`, `static/notebook.css`, `static/digest.js`, `templates/digest.html`.

### Smaller features that fit the architecture

- [ ] **Reading position** — persist "last chapter read" per book. Easiest: write a small JSON sidecar next to `book.pkl`, read it in the library scan, show a "Resume" button.
- [ ] **Delete-from-UI** — `DELETE /book/{book_id}` that `shutil.rmtree`s the folder and clears the cache. The dropzone already proves multipart + cache-clear works.
- [ ] **Cover thumbnails on the shelf** — most EPUBs have `ITEM_COVER`; after ingest, the cover lives at `books/<id>/images/cover.jpg` (or similar). Pick the first matching file and show it on the card.
- [ ] **TOC-anchor scrolling** — today TOC links jump to the right chapter index but lose the `#anchor`. A small JS tweak in `reader.html` can pass the anchor through the URL and `scrollIntoView` on load (partially in place — verify across books).
- [ ] **Copy as Markdown** — extend the existing "Copy Full Text" action with a second option that uses `ChapterContent.text` plus light markdown formatting (headings, images as `![](...)`). Currently the button copies `innerText` from the rendered DOM.

## Things *not* to do

- Don't add auth / multi-tenant assumptions. This is `localhost` software.
- Don't reach for a database. The folder-per-book layout is a feature — users can back up, move, or delete books with a file manager.
- Don't break the "EPUB in, folder out" contract of `process_epub`. Both the CLI and `/upload` rely on it.
