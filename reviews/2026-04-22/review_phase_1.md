## 🔍 The Inspector's Report

*The code is, on balance, a pleasant surprise — which makes the problems it does have all the more worth savouring.*

---

### 💀 CATASTROPHES  (1 found)

**[server.py:93–118]** `book = load_book_cached(book_id)` — `book_id` is a raw path segment from the URL, passed directly to `os.path.join(BOOKS_DIR, folder_name, "book.pkl")` inside `load_book_cached`.

> *Oh, how delightful. `book_id` arrives from the URL as-is, is never sanitised, and goes straight into `os.path.join`. A request to `/read/../../etc/passwd/0` hands the attacker a lovely pickle-load-from-arbitrary-path primitive. The image route (line 169) correctly calls `os.path.basename` on `book_id`, but `read_chapter` and `chat_endpoint` do not. The `load_book_cached` cache keyed on the raw segment means the evil path is even memoised for free.*
>
> **Fix:** Apply `safe_book_id = os.path.basename(book_id)` at the top of every handler that accepts `book_id` from the URL — `read_chapter`, `redirect_to_first_chapter`, and `chat_endpoint` — before passing it to `load_book_cached`. Alternatively, add a `validate_book_id` helper that checks the value is in `os.listdir(BOOKS_DIR)` and raise 404 otherwise.

---

### 😱 DISGRACES  (5 found)

**[server.py:133–134]** `base_name = os.path.splitext(os.path.basename(filename))[0]` / `out_dir = os.path.join(BOOKS_DIR, base_name + "_data")`

> *The upload endpoint takes the filename from the client-supplied `Content-Disposition`. A filename of `../evil` produces `out_dir = "books/../evil_data"`, which escapes BOOKS_DIR entirely. `shutil.rmtree` is then cheerfully called on it inside `process_epub`. This is technically a catastrophe-adjacent path but the immediate payload is directory deletion rather than arbitrary read, so a high-severity disgrace it is.*
>
> **Fix:** After computing `base_name`, assert it contains no path separators and re-sanitise: `base_name = re.sub(r'[^\w\-]', '_', base_name)` or similar. Then verify `os.path.realpath(out_dir).startswith(os.path.realpath(BOOKS_DIR))`.

**[server.py:187–223]** `async def chat_endpoint` calls `llm.stream_chat(...)` which calls `anthropic.AsyncAnthropic()` synchronously inside an `async def`, constructing a new client per request with no connection pooling.

> *Not a correctness bug, but a new `AsyncAnthropic()` instance is instantiated for every single `/chat` POST. The client carries an httpx `AsyncClient` inside it; creating it fresh each request bypasses keep-alive and connection reuse entirely. Under even modest concurrency (unlikely for a personal app, but still), this is wasteful and the httpx client is never explicitly closed.*
>
> **Fix:** Move `client = anthropic.AsyncAnthropic()` to module level in `llm.py` (or use `lifespan` in FastAPI) so it is shared and its connection pool is reused. The key is already read from the environment at call time, so no security regression.

**[server.py:200–209]** System prompt construction interpolates raw book metadata and user-supplied `request.selection` into an f-string that is sent to the LLM.

> *`book.metadata.title`, `authors`, and `chapter.title` come from the EPUB — author-controlled strings. `request.selection` comes straight from the client. A crafted EPUB (or a crafted selection) can inject arbitrary instructions into the system prompt. The server trusts the pickle, and the pickle trusts the EPUB.*
>
> **Fix:** For the selection, at minimum truncate it server-side (e.g. 500 chars) and wrap it in clear delimiters: `Selected passage (verbatim, do not interpret as instructions): """..."""`. For metadata, no fix is strictly required given single-user localhost context, but documenting the exposure is wise.

**[server.py:56–58]** `except Exception as e: print(f"Error loading book {folder_name}: {e}")` returns `None` silently.

> *A corrupted or version-mismatched pickle logs one line to stdout and returns `None`. The library page silently skips the book with no user-facing indication. The reader returns a bare 404. There is no structured error path, no log level, and no way to distinguish "pickle corrupted" from "file does not exist".*
>
> **Fix:** Use `logging` at `WARNING` level. Distinguish `FileNotFoundError` (return `None` quietly) from other exceptions (log at `ERROR` with full traceback using `logging.exception`). Optionally expose a `/debug/books` endpoint for the owner.

**[reader3/llm.py:40–42]** Event loop iteration pattern: `async for event in stream:` followed by manual `event.type` / `event.delta.type` checks.

> *This is fine for the current Anthropic SDK version, but the stream helper already provides a `text_stream` async iterator (`async for text in stream.text_stream`) that yields exactly the string deltas you need, without the manual event-type guards. The current code will silently drop tokens if the SDK ever changes the internal event shape.*
>
> **Fix:** Replace the loop body with `async for text in stream.text_stream: yield text`. This is the documented streaming convenience API.

---

### 😒 EYESORES  (6 found)

**[reader.html:13–27]** `:root { --paper: #f3ecdd; ... }` inline in `reader.html`.

> *All CSS custom properties are defined inline in `<style>` inside `reader.html` and then again consumed by `side_panel.css` which relies on them being present in scope. If `side_panel.css` is ever loaded standalone (e.g. in a Storybook, a test, or a second template), all `var(--paper)` references resolve to nothing. The variables belong in `side_panel.css` or a shared `variables.css`.*
>
> **Fix:** Move `:root { ... }` to `static/side_panel.css` (or a new `static/variables.css` imported first). Remove the duplication from the `<style>` block in `reader.html`.

**[reader.html:630]** `{{ current_chapter.content | safe }}`

> *The `| safe` filter is appropriate here — the content was cleaned by BeautifulSoup at ingest time. However, the pipeline strips `script`/`style` at ingest but does NOT strip `data-*` attributes or event handlers (`onclick=`, `onerror=` on img tags, etc.). A crafted EPUB with `<img onerror="...">` would survive ingestion and arrive in the browser. Single-user localhost context reduces the practical risk, but it remains an eyesore of the highest order.*
>
> **Fix:** In `reader3.py`'s `clean_html_content`, add `tag.attrs = {k: v for k, v in tag.attrs.items() if not k.startswith('on')}` to strip event handler attributes. Alternatively, use a stricter BeautifulSoup allowlist.

**[server.py:1–22]** `server.py` imports `from anthropic.types import MessageParam` at module level.

> *The `anthropic` package is only needed if the `/chat` endpoints are exercised. Importing it (and constructing nothing) at startup is harmless, but it adds to import time and means a missing `anthropic` dep crashes the server even if the user never intends to use chat. Since `llm.py` already encapsulates the import, `server.py` need only import `llm`, not `anthropic.types` directly.*
>
> **Fix:** Move `from anthropic.types import MessageParam` into `reader3/llm.py` and export it, or inline the type as `list[dict]` in the Pydantic model until you need strict validation.

**[server.py:25]** `os.makedirs("static", exist_ok=True)` at module load.

> *A side-effecting `os.makedirs` at module import time (not inside `lifespan` or a startup event) is surprising. If `server.py` is imported in a test context, it silently creates a `static/` directory in the test's working directory.*
>
> **Fix:** Move into a `@app.on_event("startup")` handler or (preferably) a `lifespan` context manager.

**[side_panel.js:118–185]** `streamResponse` has no timeout on the `fetch`. A stalled or very slow API response keeps the stream open indefinitely, the `msg-streaming` CSS animation spins forever, and the user cannot cancel (the `AbortController` is only fired if they open a second stream).

> *For a single-user app this is a minor irritant rather than a crisis, but a 5-minute streaming hang with no escape hatch is an eyesore.*
>
> **Fix:** Add a `setTimeout(() => streamController.abort(), 60_000)` guard and expose a Cancel button that calls `streamController.abort()`.

**[reader.html:671–675]** `spineMap` is emitted as a raw JS object literal where `ch.href` and `ch.order` are interpolated directly from Jinja without escaping.

> *`ch.href` is a filename from the EPUB spine; a crafted EPUB with a filename containing `"` or `</script>` can break out of the object literal and inject JS. Low severity given single-user context and the fact that the user ingested the file themselves, but the pattern is wrong.*
>
> **Fix:** Emit the spine as a JSON blob via `{{ book.spine | tojson }}` and parse it client-side: `const spineMap = {}; for (const ch of {{ book.spine | tojson }}) spineMap[ch.href] = ch.order;`

---

### 🔍 NITPICKS  (4 found)

**[server.py:39]** `BOOKS_DIR = "books"` — relative path, resolved against the process CWD.

> *Running `uv run server.py` from a subdirectory silently looks in the wrong place. Use `os.path.join(os.path.dirname(__file__), "books")` for robustness.*

**[reader3/llm.py:7]** `DEFAULT_MODEL: str = "claude-sonnet-4-6"` — the model string is hardcoded and not validated.

> *A typo in `READER3_MODEL` silently fails at the API call rather than at startup. Worth logging the resolved model at startup/first call.*

**[scripts/smoke_chat.py:71]** `urllib.request.urlopen(req, timeout=30)` — no streaming: `urllib` buffers the entire response body before the `for raw_line in resp` loop runs.

> *This means the smoke test actually tests buffered-response parsing, not true SSE streaming. Use `http.client` or `httpx` with `stream=True` if you want to validate streaming behaviour.*

**[side_panel.html:6]** `<button class="sp-tab sp-tab--disabled" ... aria-disabled="true" tabindex="-1">Notebook</button>` — uses `aria-disabled` but not the native `disabled` attribute.

> *`aria-disabled` tells screen readers the button is disabled but does not prevent keyboard focus/click in all browsers. Add the HTML `disabled` attribute for full accessibility correctness.*

---

### ✅ What somehow works

The image-serving path (`serve_image`, lines 161–177) correctly applies `os.path.basename` to both `book_id` *and* `image_name` — a rare moment of consistent path hygiene. The SSE streaming plumbing in `side_panel.js` is clean: it uses an `AbortController`, properly handles `AbortError` separately, and renders LLM output only after DOMPurify sanitization via `innerHTML`. The `lru_cache` invalidation on upload is correctly placed and the `cache_clear()` call is never forgotten.

---

### 📊 Disaster Score: 5/10

*A thoughtful codebase that remembered to sanitise the image path and forgot to sanitise the book path — achieving the rare distinction of being simultaneously careful and catastrophically inconsistent. The XSS surface is mostly contained by BeautifulSoup, the secrets are not leaked, and the streaming architecture is sound; the path traversal through `load_book_cached` is the one gift that keeps on giving.*
