# Architecture

reader 3 is a two-stage pipeline with an on-disk hand-off between stages:

```
  ┌──────────────┐    parse, clean,     ┌─────────────────────────┐   lru_cache   ┌──────────┐
  │  .epub file  │ ─► extract images ─► │ books/<name>_data/      │ ─► in-memory ─► │ FastAPI  │
  │              │    build TOC +       │   book.pkl              │    Book object │  + Jinja │
  └──────────────┘    pickle Book       │   images/*.{jpg,png,…}  │                └──────────┘
                                        └─────────────────────────┘                      │
                                                                                         ▼
                                                                                   browser tab
```

## Stage 1 — Ingest (`reader3.py`)

Runs either as a CLI (`uv run reader3.py book.epub`) or as a function called by `POST /upload` in the server.

1. **Load** the EPUB with `ebooklib.epub.read_epub`.
2. **Extract metadata** — Dublin Core fields (title, creator, language, description, publisher, date, identifier, subjects). Falls back to `"Untitled"` / `"en"` if missing.
3. **Prepare output** — wipes `books/<name>_data/` if it exists, re-creates `images/` inside it.
4. **Extract images** — iterates items matching `ITEM_IMAGE` or `ITEM_COVER`. Sanitises each filename (alnum + `._-` only), writes bytes to `images/<safe_name>`, and records the mapping under **two keys**: the full internal EPUB path (e.g. `OEBPS/image/cover.jpg`) and the bare basename. This two-key map makes downstream HTML rewriting robust against messy `<img src>` attributes.
5. **Parse TOC** — recursive walk of `book.toc` handling `epub.Link`, `epub.Section`, and `(Section, [children])` tuples. If the TOC is empty, builds a flat one from the spine with titles guessed from filenames.
6. **Process each spine item (in linear reading order)**:
   - Decode bytes as UTF-8 (errors ignored).
   - Parse with BeautifulSoup.
   - Rewrite every `<img src>` — URL-decode, try exact match in the image map, fall back to basename match.
   - Strip dangerous/useless tags: `script`, `style`, `iframe`, `video`, `nav`, `form`, `button`, `input`, and HTML comments.
   - Keep only the inner contents of `<body>`.
   - Also extract whitespace-collapsed plain text for LLM/search.
7. **Assemble** a `Book` dataclass (metadata + spine + TOC + images + source file + timestamp + version).
8. **Pickle** to `books/<name>_data/book.pkl`.

## Stage 2 — Serve (`server.py`)

FastAPI app on `127.0.0.1:8123`, Jinja2 templates in `templates/`.

- **Library scan** — lists folders under `books/` that end in `_data` and contain a loadable `book.pkl`. Each folder becomes one library card.
- **Book loading** — wrapped in `functools.lru_cache(maxsize=10)` keyed by folder name, so repeat clicks don't re-unpickle. The cache is cleared after every successful upload; it's **not** cleared if you re-ingest from the CLI, so restart the server in that case.
- **Chapter rendering** — `GET /read/{book_id}/{chapter_index}` picks `book.spine[chapter_index]`, computes prev/next indices, and renders `reader.html`. The TOC sidebar in the template uses a Jinja-emitted `spineMap` (`href → index`) so TOC clicks can jump to the correct linear chapter index client-side.
- **Image serving** — `GET /read/{book_id}/images/{image_name}` serves files from `books/<book_id>/images/`. Both params are run through `os.path.basename` as the only path-traversal guard, so any new file-serving route needs its own validation.
- **Uploads** — `POST /upload` accepts an `.epub` via `UploadFile`, writes to a `NamedTemporaryFile`, calls `process_epub` + `save_to_pickle` into `books/<basename>_data/`, clears `load_book_cached`, and returns JSON. See [`api.md`](api.md) for the full contract.

## Data model

Defined in `reader3.py`. These dataclasses **are the pickle format**: any change requires re-ingesting every book.

```
Book
├── metadata: BookMetadata { title, language, authors[], description?, publisher?, date?, identifiers[], subjects[] }
├── spine:    List[ChapterContent]     # physical files in linear reading order
├── toc:      List[TOCEntry]           # navigation tree (may contain anchors inside spine files)
├── images:   Dict[str, str]           # both full-path and basename keys → "images/<safe>"
├── source_file, processed_at, version
```

```
ChapterContent
├── id       # EPUB internal id
├── href     # filename (the key TOC entries match on)
├── title    # fallback "Section N" — TOC carries real titles
├── content  # cleaned inner-body HTML with rewritten image srcs
├── text     # plain text, whitespace-collapsed, for LLM copy-paste
└── order    # linear index in the spine
```

```
TOCEntry
├── title
├── href       # raw "part01.html#anchor"
├── file_href  # just "part01.html" — used to match a spine item
├── anchor     # just "anchor" (may be "")
└── children: List[TOCEntry]
```

## Spine vs TOC

These are two different navigation structures and the distinction matters:

- **Spine** = the *physical* reading order of XHTML files in the EPUB. One entry per file. This is what `Prev/Next` walks.
- **TOC** = the *logical* chapter tree. Often deeper than the spine; a single spine file can back many TOC entries (via `#anchor`s).

The sidebar matches a TOC entry to the "active" state by `file_href` only — anchors are ignored for highlighting. Clicking a TOC entry jumps to the spine index of its `file_href`; if that file isn't in the spine, the click silently fails (logged to the browser console).

## What's *not* here

- No auth. No multi-user. No accounts. Meant for `localhost`.
- No database. Folders in `books/` are the source of truth.
- No streaming / websockets. Every nav is a full page load.
- No write-back (bookmarks, notes, progress). Reading position isn't persisted.
