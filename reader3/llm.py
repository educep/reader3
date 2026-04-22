import os
from collections.abc import AsyncIterator

import anthropic
from anthropic.types import MessageParam

DEFAULT_MODEL: str = "claude-sonnet-4-6"

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


async def stream_chat(
    messages: list[MessageParam],
    system: str,
    model: str | None = None,
) -> AsyncIterator[str]:
    """Stream a chat response from Claude, yielding text deltas as they arrive.

    Reads ANTHROPIC_API_KEY from the environment at call time.
    Model precedence: READER3_MODEL env var > model param > DEFAULT_MODEL.
    The system prompt is sent with cache_control ephemeral for prompt caching.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    resolved_model: str = os.environ.get("READER3_MODEL") or model or DEFAULT_MODEL

    client = _get_client()

    async with client.messages.stream(
        model=resolved_model,
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text
