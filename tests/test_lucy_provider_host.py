"""Lucy talks to Anthropic's own API only when the base URL's host is exactly Anthropic's."""

from __future__ import annotations

import pytest

from selecta.lucy.providers import AnthropicProvider


@pytest.mark.parametrize(
    ("base_url", "default"),
    [
        (None, True),
        ("", True),
        ("https://api.anthropic.com", True),
        ("https://api.anthropic.com/v1", True),
        ("https://other.example/api.anthropic.com", False),
        ("https://api.anthropic.com.other.example", False),
        ("https://proxy.example", False),
    ],
)
def test_only_the_real_host_counts_as_anthropic(base_url, default):
    provider = AnthropicProvider("test-key", "claude-haiku-5-5", base_url, 64)
    assert provider.default_host is default
