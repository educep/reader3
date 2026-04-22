## 🔍 The Inspector's Report

*Phase 2 is here, and the codebase has acquired ambitions it hasn't entirely earned. The notebook feature is admirably structured — and yet, in reaching for maturity, it has tripped over several banana peels that were lying in plain sight.*

---

### 💀 CATASTROPHES  (2 found)

**[server.py:55]** `book = pickle.load(f)`
> *Ah, `pickle.load` — the gift that keeps giving, right up until someone drops a crafted `book.pkl` into the `books/` directory. The CLAUDE.md itself warns "Pickle is trusted input" and "Don't accept `book.pkl` files from elsewhere — pickle can execute arbitrary code on load." The warning is correct; the code ignores it entirely. Any user (or script) that can write to `books/<name>_data/book.pkl` — via the OS, a misconfigured share, or future file-upload scope creep — gets arbitrary code execution the next time that book is loaded. The `lru_cache` is cold comfort: first load still calls `pickle.load`.*
> **Fix:** This is localhost-only and single-user, so the practical risk is low today. But document the trust boundary explicitly with an assertion: verify the file path is strictly inside `BOOKS_DIR` using `os.path.realpath` + `startswith(os.path.realpath(BOOKS_DIR))` before opening. Long-term: migrate to a safe serialisation format (JSON + reconstructed dataclasses, or `msgspec`).

**[templates/digest.html:404]** `<pre class="mermaid">{{ entry.body }}</pre>` and **[digest.html:435]** same pattern
> *Mermaid diagram entries have their `body` injected raw into a `<pre>` element without ANY escaping. Jinja's autoescaping applies to HTML attribute values and text content by default, but `<pre class="mermaid">` content is then handed to `mermaid.initialize({ startOnLoad: true })` — which re-parses the inner text as Mermaid source. A carefully crafted Mermaid payload can inject arbitrary SVG, and SVG supports `<script>` and `<a href="javascript:...">`. This is a stored XSS via user-controlled notebook entries rendered in the digest view. The notebook accepts user-supplied `body` text without sanitisation on the server; the digest page then renders it unsanitised.*
> **Fix:** On the server, reject or strip `body` content that contains HTML tags before persisting. In the template, use `{{ entry.body | e }}` (already done for `.entry-body` via `data-raw` but NOT for the mermaid branch). In the JS, after mermaid renders, apply DOMPurify to the resulting SVG: `DOMPurify.sanitize(pre.innerHTML, { USE_PROFILES: { svg: true } })`. The safest fix: validate that diagram entries contain only valid Mermaid graph syntax server-side (regex whitelist on keywords).

---

### 😱 DISGRACES  (5 found)

**[reader3/notebook.py:51–62]** `save()` — race between `data["updated_at"] = _now()` and `with lock:`
> *`updated_at` is mutated at line 54 **before** acquiring the lock at line 55. Two concurrent writers both read `data` from `load()`, both mutate it, then fight over the lock. The winner's write survives; the loser overwrites it with stale data. The mutation must be inside the lock.*
> **Fix:** Move `data["updated_at"] = _now()` to after `with lock:`, immediately before the `tempfile` block.

**[server.py:253–261]** `create_notebook_entry` — `book_id` in notebook path not validated for path traversal before file operations
> *`os.path.basename(book_id)` on line 254 is applied to `safe_id` for the book existence check. But `notebook.create_entry(safe_id, ...)` calls `notebook_path(book_id)` which calls `os.path.join("books", book_id, NOTEBOOK_FILENAME)`. If `safe_id = os.path.basename(book_id)` produces a clean name, this is fine — **but** `os.path.basename("../../etc/passwd_data")` returns `"passwd_data"`, not an empty string. An attacker sending `book_id = "../../../../tmp/evil_data"` gets `basename = "evil_data"`, which the book check rejects (no pickle there). So exploitation is blocked by the book-existence gate. However, this is a layered-defence gap: the safety depends entirely on the LRU cache check, not on path containment. Any future route that skips the book check would be immediately exploitable.*
> **Fix:** After `os.path.basename`, add `os.path.realpath` containment: assert the resolved `os.path.join(BOOKS_DIR, safe_id)` starts with `os.path.realpath(BOOKS_DIR)`. Apply consistently to all notebook routes.

**[server.py:213–219]** System prompt injects unescaped book metadata (`title`, `authors`, `chapter.title`) and unchecked `request.action`
> *`request.action` is a free-form string from the client (Pydantic model only declares it as `str`, no enum validation). A user can send `action: "ignore all previous instructions and..."`. Combined with book metadata that may contain adversarial content (an EPUB with a crafted title), this is a prompt injection surface. The system prompt is passed verbatim to Claude.*
> **Fix:** Validate `action` against an explicit allowlist (`Literal["explain", "summarize", "translate", "discuss", "free"]`) in the Pydantic model. Wrap metadata fields in a clearly delimited block (XML tags or triple-quoted strings) so the model can distinguish instructions from data.

**[server.py:294]** `from collections import defaultdict` inside async handler `notebook_digest`
> *Deferred imports inside a hot async function are a minor performance eyesore — but more importantly, it's a signal that this function is doing too much. The grouping logic (14 lines) belongs in a helper, not inline in a route handler.*
> **Fix:** Move the `import` to the top of the file; extract `group_entries_by_chapter(entries)` as a standalone function.

**[static/side_panel.js:118]** `streamResponse` — no timeout on the SSE stream; `streamController.abort()` is called on a *new* request, abandoning the previous reader without cleanup
> *When `streamResponse` is called twice rapidly (double-click, two toolbar actions), the old `AbortController` is aborted and a new one starts. The old `reader` is left hanging — the `while(true)` loop will throw `AbortError` and the `catch` block sets bubble text. But the `reader.cancel()` is never called explicitly, leaving the underlying stream un-released until GC. Additionally there is no timeout: a stalled server will leave the connection open indefinitely.*
> **Fix:** After aborting the old controller, also call `reader.cancel()` if a `reader` reference is in scope. Wrap the fetch in a `setTimeout`-based timeout using the same `AbortController`. Consider storing `reader` in an outer scope so it can be cancelled on abort.

---

### 😒 EYESORES  (6 found)

**[reader3/notebook.py:65]** `_validate_entry` — `get_book: Callable` lacks type parameters
> *`Callable` without `[[args], ReturnType]` annotation is effectively `Any`. This defeats mypy's ability to catch misuse.*
> **Fix:** `get_book: Callable[[str], Book | None]`

**[templates/digest.html:13–25] and [templates/reader.html:17–29]** `:root { --paper: ... }` duplicated verbatim across two templates
> *Eleven CSS custom property declarations, character-for-character identical, maintained in two places. When someone tweaks `--oxblood` they'll find it wrong in the other template three months later.*
> **Fix:** Extract to `/static/theme.css` (already have a `static/` directory), link from both templates. Or add `--rule-soft` and `--sidebar-w` only to reader (they're reader-specific) and share the base palette.

**[server.py:57–58]** `print(f"Error loading book {folder_name}: {e}")` — bare `print` instead of `logger`
> *All other error paths in the module use proper logging. This one uses `print`, bypassing any log level filtering or structured logging.*
> **Fix:** Replace with `logger = logging.getLogger(__name__)` (add at module level) and `logger.exception("Error loading book %s", folder_name)`.

**[server.py:1–341]** No module-level `logger`; logging is absent for most routes
> *The server imports nothing from `logging`. Upload errors, book-load failures, and cache operations are silent or printed. When something goes wrong in production, you'll be guessing.*
> **Fix:** Add `import logging; logger = logging.getLogger(__name__)` and replace `print` calls; add `logger.info` for upload success and cache invalidation.

**[static/notebook.js:170–172]** Silent swallow: `catch (_) {}` on every API call
> *`loadScopeEntries`, `loadIndexEntries`, `createEntry`, `deleteEntry` all silently discard network errors. Users see no feedback when the notebook API is down.*
> **Fix:** At minimum log to console. Preferably show a transient error banner in the notebook pane (one line of DOM insertion).

**[digest.js:1–2]** File exists purely as a stub comment
> *`digest.js` contains two comment lines and nothing else. It's loaded nowhere (digest.html doesn't reference it). It exists as aspirational scaffolding.*
> **Fix:** Delete the file until it has content, or add it to `.gitignore`. Dead files accumulate.

---

### 🔍 NITPICKS  (5 found)

**[server.py:35]** `action: str  # "explain" | "summarize" | "translate" | "discuss" | "free"` — comment describes what should be a `Literal` type
> **Fix:** `from typing import Literal; action: Literal["explain", "summarize", "translate", "discuss", "free"]`

**[templates/reader.html:675]** `{% for ch in book.spine %}"{{ ch.href }}": {{ ch.order }},` — `ch.href` is not escaped before being embedded in a JS object literal
> *If a spine `href` contains a `"` character (unusual but valid in EPUB), it would break the JS string literal. Jinja's `| tojson` filter handles this correctly.*
> **Fix:** `"{{ ch.href | tojson }}": {{ ch.order }},`

**[scripts/smoke_notebook.py:35]** `except urllib.error.HTTPError as e: return e.status, {}` — swallows the error body silently
> *For failed requests, the body often contains the error detail. Returning `{}` makes debugging harder.*
> **Fix:** `return e.status, json.loads(e.read()) if e.fp else {}`

**[server.py:288–308]** `notebook_digest` — `grouped` keys include both `int` and `str` (`"book"`), typed as `dict[int | str, list]`
> *Sorting `grouped.keys()` in the template with `| sort` will raise a TypeError in Python 3 when mixing `int` and `str` keys (e.g. `0 < "book"` is not defined). The template at line 413 does `{% for ch_idx in grouped.keys() | sort %}` — this will explode if both `"book"` and integer keys are present.*
> **Fix:** Use a sentinel integer like `-1` for book-level entries, or sort with a key function: `sorted(grouped.keys(), key=lambda k: (-1 if k == 'book' else k))`.

**[templates/reader.html:9] vs [templates/digest.html:9]** Google Fonts `link` tags load different weight sets
> *reader.html loads `wght@300;400;500;600;700` for Fraunces; digest.html loads `wght@300;500;700;900`. Inconsistent palette, and one extra network round-trip per page.*
> **Fix:** Standardise on a single weight set in the shared theme CSS import (see EYESORE above).

---

### ✅ What somehow works

*The notebook persistence layer is genuinely solid: filelock + tempfile + os.replace is the correct trifecta, and the offset validation on selections is a thoughtful touch that most codebases skip entirely. The LLM streaming implementation in `side_panel.js` correctly uses `AbortController`, `textContent` during streaming (no XSS), and DOMPurify+marked only on completion — that's the right order of operations. The `_validate_entry` guard catching out-of-range chapter indices before touching disk is exactly the kind of defensive programming that prevents corrupt notebooks.*

---

### 📊 Disaster Score: 5/10

*Phase 2 arrived with real engineering — and real new attack surface. The mermaid XSS in the digest view is the kind of issue that gets quietly exploited long after the codebase has forgotten it exists. The race condition in `save()` is a correctness bug that will bite during any concurrent use (two browser tabs, anyone?). Everything else is fixable without losing sleep. The bones are good; the flesh needs a few more stitches.*
