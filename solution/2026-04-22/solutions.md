## Issue 1 — Add anthropic dependency and reader3/llm.py

**Files**: pyproject.toml, uv.lock, reader3/llm.py
**What was done**: Added anthropic SDK dependency and created async streaming helper with prompt caching support. Key reads from ANTHROPIC_API_KEY at call time; model overridable via READER3_MODEL.

## Issue 2 — Mount static/ and add /chat + /chat/health endpoints

**Files**: server.py, static/ (directory)
**What was done**: Added StaticFiles mount, ChatRequest Pydantic model, GET /chat/health (returns key presence + model), and POST /chat (SSE streaming endpoint assembling system prompt server-side).

## Issue 3 — Reader UI: selection toolbar, side panel, streaming display

**Files**: templates/partials/side_panel.html (new), static/side_panel.css (new), static/side_panel.js (new), templates/reader.html (modified)
**What was done**: Added floating selection toolbar on mouseup, right-docked side panel with Chat tab (Notebook greyed out), SSE streaming with DOMPurify+marked markdown rendering. Keyboard shortcuts: Esc closes toolbar, Ctrl+L focuses input, Ctrl+\ toggles panel.

## Issue 4 — Phase 1 docs and smoke test

**Files**: docs/api.md, docs/usage.md, CLAUDE.md, scripts/smoke_chat.py (new)
**What was done**: Documented /chat and /chat/health in api.md, added ANTHROPIC_API_KEY setup and UX walkthrough to usage.md, updated CLAUDE.md with Phase 1 surface, and created a standalone smoke test script.

## Issue 5 — reader3/notebook.py CRUD with file locking

**Files**: pyproject.toml, uv.lock, reader3/notebook.py (new)
**What was done**: Created notebook persistence layer with FileLock, atomic rename (temp file + os.replace), offset validation against book.spine, and warn-not-reject on selection text drift.

## Issue 6 — Server notebook routes and digest page

**Files**: server.py, templates/digest.html (new)
**What was done**: Added 5 notebook HTTP routes (list/create/patch/delete entries, digest HTML, export.md). book_id sanitized with os.path.basename on every route. Digest page follows library.html editorial aesthetic with Mermaid CDN for diagram entries.

## Issue 7 — Notebook UI: second tab, composer, margin marks, Mermaid

**Files**: templates/partials/side_panel.html (modified), static/notebook.js (new), static/notebook.css (new), static/digest.js (new), templates/reader.html (modified), static/side_panel.js (modified)
**What was done**: Activated Notebook tab with three sub-views, entry composer with type dropdown, "Save to Notebook" on chat bubbles, margin marks for selection-scoped entries, Mermaid rendering in diagram-type entries.

## Issue 8 — Phase 2 docs and smoke test

**Files**: docs/api.md, docs/usage.md, docs/extending.md, CLAUDE.md, scripts/smoke_notebook.py (new)
**What was done**: Documented all notebook routes with full entry schema, added "Taking notes" to usage.md, ticked off LLM chat + notebook TODOs in extending.md, updated CLAUDE.md with Phase 2 surface, created round-trip CRUD smoke test.
