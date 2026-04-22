import os
from collections.abc import AsyncIterator

import anthropic

DEFAULT_MODEL: str = "claude-sonnet-4-6"


async def stream_chat(
    messages: list[dict],
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

    client = anthropic.AsyncAnthropic()

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
        async for event in stream:
            if event.type == "content_block_delta" and event.delta.type == "text_delta":
                yield event.delta.text
