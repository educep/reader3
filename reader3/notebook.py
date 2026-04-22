"""
Persistence layer for per-book notebook.json sidecars.
Provides CRUD with file locking and offset validation.
"""

import json
import logging
import os
import tempfile
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import filelock

logger = logging.getLogger(__name__)

NOTEBOOK_FILENAME = "notebook.json"
LOCK_TIMEOUT = 5  # seconds


def notebook_path(book_id: str) -> str:
    return os.path.join("books", book_id, NOTEBOOK_FILENAME)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _empty_notebook(book_id: str) -> dict:
    now = _now()
    return {
        "book_id": book_id,
        "schema_version": 1,
        "created_at": now,
        "updated_at": now,
        "entries": [],
    }


def load(book_id: str) -> dict:
    path = notebook_path(book_id)
    lock = filelock.FileLock(path + ".lock", timeout=LOCK_TIMEOUT)
    with lock:
        if not os.path.exists(path):
            return _empty_notebook(book_id)
        with open(path, encoding="utf-8") as f:
            return json.load(f)


def save(book_id: str, data: dict) -> None:
    path = notebook_path(book_id)
    lock = filelock.FileLock(path + ".lock", timeout=LOCK_TIMEOUT)
    with lock:
        data["updated_at"] = _now()
        dir_ = os.path.dirname(path)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=dir_, suffix=".tmp", delete=False
        ) as tmp:
            json.dump(data, tmp, indent=2, ensure_ascii=False)
            tmp_path = tmp.name
        os.replace(tmp_path, path)


def _validate_entry(book_id: str, entry_data: dict, get_book: Callable[[str], Any]) -> None:
    scope = entry_data.get("scope", {})
    level = scope.get("level", "book")
    if level == "book":
        return
    chapter_index = scope.get("chapter_index")
    if chapter_index is None:
        raise ValueError("scope.chapter_index required when level != 'book'")
    book = get_book(book_id)
    if book is None:
        raise ValueError(f"Book '{book_id}' not found")
    if chapter_index < 0 or chapter_index >= len(book.spine):
        raise ValueError(
            f"chapter_index {chapter_index} out of range (spine has {len(book.spine)} items)"
        )
    if level == "selection":
        sel = scope.get("selection", {})
        char_start = sel.get("char_start", 0)
        char_end = sel.get("char_end", 0)
        chapter_text = book.spine[chapter_index].text
        if not (0 <= char_start < char_end <= len(chapter_text)):
            raise ValueError(
                f"selection offsets [{char_start}:{char_end}] out of range "
                f"(chapter text length: {len(chapter_text)})"
            )
        stored_text = sel.get("text", "")
        actual_text = chapter_text[char_start:char_end]
        if stored_text and stored_text != actual_text:
            logger.warning(
                "Selection text mismatch for book %s ch%s [%d:%d]: stored=%r actual=%r",
                book_id,
                chapter_index,
                char_start,
                char_end,
                stored_text[:40],
                actual_text[:40],
            )


def create_entry(book_id: str, entry_data: dict, get_book: Callable[[str], Any]) -> dict:
    _validate_entry(book_id, entry_data, get_book)
    notebook = load(book_id)
    now = _now()
    entry = {
        "id": str(uuid.uuid4()),
        "created_at": now,
        "updated_at": now,
        **entry_data,
    }
    notebook["entries"].append(entry)
    save(book_id, notebook)
    return entry


def update_entry(book_id: str, entry_id: str, patch: dict) -> dict | None:
    notebook = load(book_id)
    for entry in notebook["entries"]:
        if entry["id"] == entry_id:
            allowed = {"body", "tags"}
            for key in allowed:
                if key in patch:
                    entry[key] = patch[key]
            entry["updated_at"] = _now()
            save(book_id, notebook)
            return entry
    return None


def delete_entry(book_id: str, entry_id: str) -> bool:
    notebook = load(book_id)
    original_len = len(notebook["entries"])
    notebook["entries"] = [e for e in notebook["entries"] if e["id"] != entry_id]
    if len(notebook["entries"]) == original_len:
        return False
    save(book_id, notebook)
    return True


def list_entries(
    book_id: str,
    chapter_index: int | None = None,
    entry_type: str | None = None,
) -> list[dict]:
    notebook = load(book_id)
    entries = notebook["entries"]
    if chapter_index is not None:
        entries = [e for e in entries if e.get("scope", {}).get("chapter_index") == chapter_index]
    if entry_type is not None:
        entries = [e for e in entries if e.get("type") == entry_type]
    return entries
