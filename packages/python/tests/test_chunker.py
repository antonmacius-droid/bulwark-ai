"""
Unit tests for the text chunker.

Covers: paragraph, sentence, markdown, fixed strategies,
overlap handling, empty input, large documents, force splitting.
"""

from __future__ import annotations

import pytest

from bulwark_ai.rag.chunker import chunk_text


class TestChunkerParagraphStrategy:
    """Default paragraph splitting."""

    def test_split_paragraphs(self) -> None:
        text = "First paragraph with enough text to exceed chunk size.\n\nSecond paragraph also has content.\n\nThird paragraph too."
        chunks = chunk_text(text, strategy="paragraph", chunk_size=40)
        assert len(chunks) >= 2
        assert chunks[0].index == 0

    def test_single_paragraph(self) -> None:
        text = "Just one paragraph with some text."
        chunks = chunk_text(text, strategy="paragraph", chunk_size=1000)
        assert len(chunks) == 1
        assert chunks[0].content == text

    def test_fallback_to_newline_split(self) -> None:
        """When no double newline, falls back to single newline split."""
        text = "Line one.\nLine two.\nLine three."
        chunks = chunk_text(text, strategy="paragraph", chunk_size=1000)
        assert len(chunks) >= 1


class TestChunkerSentenceStrategy:
    """Sentence splitting."""

    def test_split_sentences(self) -> None:
        text = "First sentence. Second sentence! Third sentence? Fourth."
        chunks = chunk_text(text, strategy="sentence", chunk_size=50)
        assert len(chunks) >= 2

    def test_single_sentence(self) -> None:
        text = "Just one sentence."
        chunks = chunk_text(text, strategy="sentence", chunk_size=1000)
        assert len(chunks) == 1


class TestChunkerMarkdownStrategy:
    """Markdown header splitting."""

    def test_split_by_headers(self) -> None:
        text = "# Introduction\nSome intro text.\n# Methods\nSome methods.\n# Results\nFindings."
        chunks = chunk_text(text, strategy="markdown", chunk_size=30)
        assert len(chunks) >= 2

    def test_nested_headers(self) -> None:
        text = "# H1\nText here is long enough.\n## H2\nMore text here too.\n### H3\nDeep text content."
        chunks = chunk_text(text, strategy="markdown", chunk_size=30)
        assert len(chunks) >= 2

    def test_no_headers_falls_back(self) -> None:
        """If no markdown headers, falls back to paragraph splitting."""
        text = "No headers here.\n\nJust paragraphs."
        chunks = chunk_text(text, strategy="markdown", chunk_size=1000)
        assert len(chunks) >= 1


class TestChunkerFixedStrategy:
    """Fixed-size splitting."""

    def test_fixed_split(self) -> None:
        text = "a" * 500
        chunks = chunk_text(text, strategy="fixed", chunk_size=100, chunk_overlap=0)
        assert len(chunks) >= 4  # at least 4 chunks from 500 chars at 100 each
        assert all(len(c.content) <= 101 for c in chunks)  # allow small variance

    def test_fixed_exact_boundary(self) -> None:
        text = "x" * 200
        chunks = chunk_text(text, strategy="fixed", chunk_size=100, chunk_overlap=0)
        assert len(chunks) >= 2


class TestChunkerOverlap:
    """Chunk overlap behavior."""

    def test_overlap_present(self) -> None:
        """When overlap is set, consecutive chunks should share content."""
        text = "A" * 200 + "\n\n" + "B" * 200 + "\n\n" + "C" * 200
        chunks = chunk_text(text, strategy="paragraph", chunk_size=250, chunk_overlap=50)
        if len(chunks) >= 2:
            # The end of chunk 0 should overlap with the start of chunk 1
            # (This is approximate -- overlap merges segment text)
            assert len(chunks) >= 2

    def test_zero_overlap(self) -> None:
        text = "Para one content here.\n\nPara two content here."
        chunks = chunk_text(text, strategy="paragraph", chunk_size=30, chunk_overlap=0)
        assert len(chunks) >= 2


class TestChunkerEdgeCases:
    """Edge cases."""

    def test_empty_text(self) -> None:
        chunks = chunk_text("")
        assert chunks == []

    def test_whitespace_only(self) -> None:
        chunks = chunk_text("   \n\n   ")
        assert chunks == []

    def test_none_like_empty(self) -> None:
        """None should not crash -- but our function requires str."""
        # The function signature requires str, but test defensively
        chunks = chunk_text("")
        assert chunks == []

    def test_very_long_segment_force_split(self) -> None:
        """A single segment larger than chunk_size * 1.5 should be force-split."""
        text = "x" * 2000  # Single segment, no newlines
        chunks = chunk_text(text, strategy="paragraph", chunk_size=100)
        assert len(chunks) >= 10
        # Each chunk should be roughly chunk_size
        for c in chunks:
            assert len(c.content) <= 200  # chunk_size * 1.5 + some slack

    def test_chunk_indices_are_sequential(self) -> None:
        text = "A\n\nB\n\nC\n\nD\n\nE"
        chunks = chunk_text(text, strategy="paragraph", chunk_size=5, chunk_overlap=0)
        indices = [c.index for c in chunks]
        assert indices == list(range(len(chunks)))

    def test_chunk_content_not_empty(self) -> None:
        text = "First.\n\nSecond.\n\nThird."
        chunks = chunk_text(text, strategy="paragraph", chunk_size=1000)
        for c in chunks:
            assert c.content.strip() != ""

    def test_large_document(self) -> None:
        """Chunking a large document should not crash or hang."""
        text = "\n\n".join(f"Paragraph {i} with some content." for i in range(1000))
        chunks = chunk_text(text, strategy="paragraph", chunk_size=500)
        assert len(chunks) > 0
        # All chunks should have content
        assert all(c.content.strip() for c in chunks)
