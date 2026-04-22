"""CLI entry point for EPUB ingestion.

Usage: uv run reader3.py <file.epub>
"""

import os
import sys

from reader3 import process_epub, save_to_pickle

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python reader3.py <file.epub>")
        sys.exit(1)

    epub_file = sys.argv[1]
    assert os.path.exists(epub_file), "File not found."
    base_name = os.path.splitext(os.path.basename(epub_file))[0]
    out_dir = os.path.join("books", base_name + "_data")
    os.makedirs("books", exist_ok=True)

    book_obj = process_epub(epub_file, out_dir)
    save_to_pickle(book_obj, out_dir)
    print("\n--- Summary ---")
    print(f"Title: {book_obj.metadata.title}")
    print(f"Authors: {', '.join(book_obj.metadata.authors)}")
    print(f"Physical Files (Spine): {len(book_obj.spine)}")
    print(f"TOC Root Items: {len(book_obj.toc)}")
    print(f"Images extracted: {len(book_obj.images)}")
