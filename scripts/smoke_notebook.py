"""
Smoke test for the /notebook surface.
Usage: uv run python scripts/smoke_notebook.py
Server must be running on http://127.0.0.1:8123
"""

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8123"


def discover_book_id() -> str | None:
    books_dir = os.path.join(os.path.dirname(__file__), "..", "books")
    if not os.path.isdir(books_dir):
        return None
    for name in sorted(os.listdir(books_dir)):
        if name.endswith("_data") and os.path.isfile(os.path.join(books_dir, name, "book.pkl")):
            return name
    return None


def request(method: str, path: str, body: dict | None = None, expected_status: int = 200):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"content-type": "application/json"} if data else {}
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        return e.status, {}
    if raw:
        try:
            return status, json.loads(raw)
        except Exception:
            return status, {"_raw": raw.decode(errors="replace")}
    return status, {}


def main():
    print("=== smoke_notebook.py ===")
    passed = 0
    failed = 0

    # Check server is up
    try:
        urllib.request.urlopen(f"{BASE}/", timeout=5)
    except Exception as e:
        print(f"[ERROR] Cannot reach server at {BASE}: {e}")
        sys.exit(1)

    book_id = discover_book_id()
    if not book_id:
        print("[ERROR] No book found in books/ — ingest an EPUB first")
        sys.exit(1)
    print(f"Using book_id: {book_id}")

    # 1. Create entry
    status, entry = request(
        "POST",
        f"/notebook/{book_id}/entries",
        {
            "scope": {"level": "chapter", "chapter_index": 0},
            "type": "note",
            "body": "Smoke test note",
            "origin": "human",
            "tags": [],
        },
        expected_status=201,
    )
    if status == 201 and "id" in entry:
        print(f"[PASS] POST /notebook entries → id={entry['id']}")
        passed += 1
        entry_id = entry["id"]
    else:
        print(f"[FAIL] POST /notebook entries → status={status}, body={entry}")
        failed += 1
        sys.exit(1)

    # 2. List entries
    status, data = request("GET", f"/notebook/{book_id}/entries?chapter_index=0")
    ids = [e["id"] for e in data.get("entries", [])]
    if status == 200 and entry_id in ids:
        print("[PASS] GET /notebook entries → found entry")
        passed += 1
    else:
        print(f"[FAIL] GET /notebook entries → status={status}, ids={ids}")
        failed += 1

    # 3. Patch entry
    status, updated = request(
        "PATCH", f"/notebook/{book_id}/entries/{entry_id}", {"body": "Updated smoke test note"}
    )
    if status == 200 and updated.get("body") == "Updated smoke test note":
        print(f"[PASS] PATCH /notebook entries/{entry_id} → body updated")
        passed += 1
    else:
        print(f"[FAIL] PATCH /notebook entries/{entry_id} → status={status}")
        failed += 1

    # 4. Verify on disk
    nb_path = os.path.join(os.path.dirname(__file__), "..", "books", book_id, "notebook.json")
    if os.path.isfile(nb_path):
        with open(nb_path, encoding="utf-8") as f:
            on_disk = json.load(f)
        disk_ids = [e["id"] for e in on_disk.get("entries", [])]
        if entry_id in disk_ids:
            print("[PASS] notebook.json on disk contains entry")
            passed += 1
        else:
            print(f"[FAIL] notebook.json on disk missing entry_id={entry_id}")
            failed += 1
    else:
        print(f"[FAIL] notebook.json not found at {nb_path}")
        failed += 1

    # 5. Delete entry
    status, _ = request("DELETE", f"/notebook/{book_id}/entries/{entry_id}", expected_status=204)
    if status == 204:
        print(f"[PASS] DELETE /notebook entries/{entry_id} → 204")
        passed += 1
    else:
        print(f"[FAIL] DELETE /notebook entries/{entry_id} → status={status}")
        failed += 1

    # 6. Confirm gone
    status, data = request("GET", f"/notebook/{book_id}/entries?chapter_index=0")
    ids = [e["id"] for e in data.get("entries", [])]
    if entry_id not in ids:
        print("[PASS] Entry absent after delete")
        passed += 1
    else:
        print("[FAIL] Entry still present after delete")
        failed += 1

    print(f"\nResult: {passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
