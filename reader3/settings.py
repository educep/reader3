"""Runtime configuration for reader3.

Loads a `.env` file from the project root (if present) into `os.environ`, then
exposes typed settings as module-level constants. Real environment variables
always win over `.env` values.

Import this module once at server startup (before anything reads env vars) so
downstream code can either `from reader3 import settings` or keep reading
`os.environ` directly — both work.
"""

import os
from pathlib import Path

PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
ENV_FILE: Path = PROJECT_ROOT / ".env"


def _load_env_file(path: Path) -> None:
    """Minimal .env parser — KEY=VALUE per line, optional surrounding quotes.

    Real environment variables take precedence (setdefault, not overwrite).
    Comments (`#`) and blank lines are ignored.
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_env_file(ENV_FILE)


# --- Settings ---

ANTHROPIC_API_KEY: str | None = os.environ.get("ANTHROPIC_API_KEY")
"""Anthropic API key. Required for /chat; server boots without it."""

READER3_MODEL: str = os.environ.get("READER3_MODEL") or "claude-sonnet-4-6"
"""Claude model ID used by the chat endpoint."""

HOST: str = os.environ.get("READER3_HOST") or "127.0.0.1"
PORT: int = int(os.environ.get("READER3_PORT") or "8123")


def has_anthropic_key() -> bool:
    """Re-read env each call so tests/hot-reload can toggle the key."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))
