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

## Chatting with the LLM

### Prerequisites
Set your Anthropic API key before starting the server:
```bash
# macOS / Linux
export ANTHROPIC_API_KEY=sk-ant-...

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# Optional: override the model (default: claude-sonnet-4-6)
export READER3_MODEL=claude-opus-4-5
```

### How to use
1. Start the server: `uv run server.py`
2. Open any book and navigate to a chapter.
3. Select any passage of text with your mouse.
4. A floating toolbar appears — click **Explain**, **Summarize**, **Translate**, or **Discuss**.
5. The right-hand side panel opens with your selection quoted and an LLM reply streaming in.
6. Ask follow-up questions in the chat input at the bottom. History is kept for the session.
7. Click **New conversation** to clear history and start fresh.

### Graceful degradation
If `ANTHROPIC_API_KEY` is not set, the reader continues to work normally. The chat action buttons in the selection toolbar are disabled and show a tooltip. Check `GET /chat/health` to verify key status.

## Taking notes

reader3 includes a **Notebook** (bitácora) attached to each book. Notes are stored in `books/<id>/notebook.json` alongside `book.pkl` — plain JSON you can open, edit, or back up with any text editor.

### Opening the Notebook tab

1. Open any book and navigate to a chapter.
2. In the right-hand side panel (the same panel used for chat), click the **Notebook** tab. The tab is always visible whether or not `ANTHROPIC_API_KEY` is set.

### Creating a note manually

1. With the Notebook tab open, click **+ New entry** (or the compose icon) at the top of the pane.
2. Choose a **type**: Note, Summary, Bullets, Quote, Question, or Diagram.
3. The scope defaults to the current chapter. You can change it to *Whole book* if the note applies broadly.
4. Type your content in the text area (Markdown supported). Diagram entries are rendered with Mermaid client-side.
5. Click **Save**. The entry appears in the list immediately.

### Using "Save to Notebook" on chat replies

After the LLM streams a reply in the Chat tab:

1. Click the **Save to Notebook** button that appears below the response.
2. A pre-filled composer opens with `origin: llm`, the model name recorded, and the reply as the body.
3. Adjust the type and tags if needed, then click **Save**.

### Saving a selection-scoped entry

1. Select a passage of text in the chapter body.
2. The floating selection toolbar appears. Click **Add to Notebook**.
3. The composer opens with `scope.level: selection`, the selected text pre-filled, and `char_start`/`char_end` recorded.
4. Add a body (optional — the selection text alone is enough for a `quote` entry), choose a type, and click **Save**.

### Viewing the full digest

Navigate to `/notebook/<book_id>` (e.g. `http://localhost:8123/notebook/dracula_data`) for a full-page read-only view of all entries grouped by chapter. This is useful for a quick "what did I note about this book?" overview.

### Exporting as Markdown

Visit `/notebook/<book_id>/export.md` to download all entries as a single Markdown file grouped by chapter. The file is named `<book_id>_notebook.md` and uses standard Markdown so it opens in any editor.

## Troubleshooting

**"No processed books found" / the shelf is empty.**
Check that `books/` exists and contains at least one `<name>_data/` folder with a `book.pkl` inside.

**A book shows broken images.**
Re-ingest it. The cover-image extraction was broadened to include `ITEM_COVER` in addition to `ITEM_IMAGE`; any book ingested before that fix may still have a `src="image/cover.jpg"` reference that 404s. Re-running `uv run reader3.py` on the `.epub` (or uploading it again) regenerates the pickle with the rewrite applied.

**CLI ingest succeeded but the library still shows the old version.**
Restart `server.py`. The `lru_cache` is process-local and only cleared automatically on upload.

**Upload endpoint returns 500.**
The error is returned as `{"error": "..."}` in the response body and shown in red under the dropzone. Most commonly: the file isn't a valid EPUB, or `ebooklib` can't parse it.
