"""
Smoke test for the /chat surface.
Usage: uv run python scripts/smoke_chat.py
Server must be running on http://127.0.0.1:8123
"""

import json
import os
import sys

BASE = "http://127.0.0.1:8123"


def discover_book_id() -> str | None:
    """Return the first *_data folder under books/ that has a book.pkl."""
    books_dir = os.path.join(os.path.dirname(__file__), "..", "books")
    if not os.path.isdir(books_dir):
        return None
    for name in sorted(os.listdir(books_dir)):
        if name.endswith("_data") and os.path.isfile(os.path.join(books_dir, name, "book.pkl")):
            return name
    return None


def main():
    import urllib.error
    import urllib.request

    print("=== smoke_chat.py ===")
    passed = 0
    failed = 0

    # Step 1: health check
    try:
        with urllib.request.urlopen(f"{BASE}/chat/health", timeout=5) as resp:
            health = json.loads(resp.read())
        print(f"[PASS] GET /chat/health → {health}")
        passed += 1
    except Exception as e:
        print(f"[FAIL] GET /chat/health → {e}")
        failed += 1
        print("Is the server running? uv run server.py")
        sys.exit(1)

    # Step 2: streaming test (skip if no key)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[SKIP] ANTHROPIC_API_KEY not set — skipping /chat streaming test")
    else:
        book_id = discover_book_id()
        if not book_id:
            print("[SKIP] No book found in books/ — skipping /chat streaming test")
        else:
            payload = json.dumps(
                {
                    "book_id": book_id,
                    "chapter_index": 0,
                    "selection": "test passage",
                    "action": "explain",
                    "messages": [],
                }
            ).encode()
            req = urllib.request.Request(
                f"{BASE}/chat",
                data=payload,
                headers={"content-type": "application/json"},
                method="POST",
            )
            try:
                tokens = []
                done_seen = False
                with urllib.request.urlopen(req, timeout=30) as resp:
                    for raw_line in resp:
                        line = raw_line.decode().strip()
                        if not line.startswith("data: "):
                            continue
                        evt = json.loads(line[6:])
                        if "token" in evt:
                            tokens.append(evt["token"])
                        if evt.get("done"):
                            done_seen = True
                if tokens and done_seen:
                    print(f"[PASS] POST /chat → received {len(tokens)} tokens, done=true")
                    passed += 1
                else:
                    print(f"[FAIL] POST /chat → tokens={len(tokens)}, done_seen={done_seen}")
                    failed += 1
            except Exception as e:
                print(f"[FAIL] POST /chat → {e}")
                failed += 1

    print(f"\nResult: {passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
