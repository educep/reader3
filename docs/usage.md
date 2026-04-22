# Usage

## Prerequisites

- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/) (handles venv + deps from `pyproject.toml` / `uv.lock`)

## Run the server

```bash
uv run server.py
# → Starting server at http://127.0.0.1:8123
```

Open `http://localhost:8123/` in a browser.

## Add a book — two ways

### 1. Through the web UI (recommended)

1. Open the library page.
2. Drop an `.epub` on the "Submit a new volume" card, or click **Choose File**.
3. Wait for the progress bar to finish. The page reloads with the new volume highlighted on the shelf.

Only `.epub` is accepted; other files return a 400 from the server and a red status message in the UI.

### 2. From the CLI

```bash
uv run reader3.py path/to/book.epub
```

The book is always written to `books/<basename>_data/`, regardless of where the source `.epub` lives. Paths with spaces, Unicode, or OneDrive / network paths are fine — only the basename is used.

If the server is already running, **restart it** after a CLI ingest so the in-memory `lru_cache` drops the stale entry. (The upload endpoint clears the cache automatically; the CLI can't reach into the server process.)

## Read a book

- From the shelf, click any volume card → opens chapter 0.
- Navigate with **Prev / Next** at the bottom of each chapter, or click TOC entries in the left sidebar.
- Sidebar highlights the currently active spine file. If TOC entries point to anchors inside the current file, all of them may be marked active — that's expected (matching is by filename, not anchor).

## Remove a book

Delete `books/<name>_data/` from disk. Restart the server so `lru_cache` forgets it.

```bash
rm -rf "books/Some Book_data"
```

## Where things live

```
reader3/
├── server.py             # FastAPI app — run this
├── reader3.py            # ingest CLI + process_epub() used by /upload
├── templates/
│   ├── library.html      # shelf + upload dropzone
│   └── reader.html       # single-chapter view with TOC sidebar
├── books/                # the library — one folder per ingested book
│   └── <name>_data/
│       ├── book.pkl      # pickled Book dataclass (the content)
│       └── images/       # extracted images served by /read/<id>/images/<file>
├── pyproject.toml
├── uv.lock
└── docs/                 # you are here
```

## Troubleshooting

**"No processed books found" / the shelf is empty.**
Check that `books/` exists and contains at least one `<name>_data/` folder with a `book.pkl` inside.

**A book shows broken images.**
Re-ingest it. The cover-image extraction was broadened to include `ITEM_COVER` in addition to `ITEM_IMAGE`; any book ingested before that fix may still have a `src="image/cover.jpg"` reference that 404s. Re-running `uv run reader3.py` on the `.epub` (or uploading it again) regenerates the pickle with the rewrite applied.

**CLI ingest succeeded but the library still shows the old version.**
Restart `server.py`. The `lru_cache` is process-local and only cleared automatically on upload.

**Upload endpoint returns 500.**
The error is returned as `{"error": "..."}` in the response body and shown in red under the dropzone. Most commonly: the file isn't a valid EPUB, or `ebooklib` can't parse it.
