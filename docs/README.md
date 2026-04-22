# reader 3 — Documentation

A self-hosted, single-user EPUB reader. Point it at an `.epub`, read one chapter at a time in the browser, copy-paste chapters to an LLM.

This folder contains the human-readable docs for understanding and extending the project. For an AI-assistant briefing, see `../CLAUDE.md`.

## Contents

- [`architecture.md`](architecture.md) — how the pieces fit together: ingest → pickle → server → browser.
- [`usage.md`](usage.md) — how to run it, upload books, and read them.
- [`extending.md`](extending.md) — what to know before modifying the ingester, server, or templates.
- [`api.md`](api.md) — HTTP routes exposed by `server.py`.

## 30-second tour

```
┌─────────────┐     reader3.py      ┌──────────────────────┐    server.py    ┌─────────┐
│  .epub file │ ───────────────────▶│ books/<name>_data/   │ ───────────────▶│ browser │
│ (on disk)   │   or POST /upload   │   ├── book.pkl       │   FastAPI       │ reader  │
└─────────────┘                     │   └── images/*.jpg   │   Jinja2        └─────────┘
                                    └──────────────────────┘
```

- **Ingest** parses the EPUB, cleans HTML, extracts images, and pickles a structured `Book` object.
- **Serve** reads the pickle (cached in memory), renders Jinja templates, and serves images straight from disk.
- **No database.** The `books/` folder *is* the library. Delete a folder, delete a book.
