"""
Document chunking -- splits text into overlapping chunks for embedding.

Supports strategies: paragraph, sentence, markdown, fixed.
"""

from __future__ import annotations

import re
from typing import Literal

from .types import TextChunk


PARAGRAPH_SEPARATORS = ["\n\n", "\r\n\r\n"]
SENTENCE_ENDINGS = re.compile(r"(?<=[.!?])\s+")
MARKDOWN_HEADERS = re.compile(r"^#{1,6}\s", re.MULTILINE)


def _split_by_paragraph(text: str) -> list[str]:
    for sep in PARAGRAPH_SEPARATORS:
        if sep in text:
            return [s for s in text.split(sep) if s.strip()]
    return [s for s in text.split("\n") if s.strip()]


def _split_by_markdown(text: str) -> list[str]:
    sections: list[str] = []
    lines = text.split("\n")
    current = ""

    for line in lines:
        if MARKDOWN_HEADERS.match(line) and current.strip():
            sections.append(current.strip())
            current = line
        else:
            current += "\n" + line

    if current.strip():
        sections.append(current.strip())

    return sections if sections else _split_by_paragraph(text)


def _split_fixed(text: str, size: int) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


def chunk_text(
    text: str,
    *,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    strategy: Literal["paragraph", "sentence", "fixed", "markdown"] = "paragraph",
) -> list[TextChunk]:
    """
    Split text into overlapping chunks suitable for embedding.

    Args:
        text: The input text to chunk.
        chunk_size: Maximum characters per chunk (default 1000).
        chunk_overlap: Overlap between consecutive chunks (default 200).
        strategy: Split strategy -- paragraph, sentence, markdown, or fixed.

    Returns:
        List of TextChunk objects with content and index.
    """
    if not text or not text.strip():
        return []

    chunks: list[TextChunk] = []

    if strategy == "markdown":
        segments = _split_by_markdown(text)
    elif strategy == "sentence":
        segments = [s for s in SENTENCE_ENDINGS.split(text) if s.strip()]
    elif strategy == "paragraph":
        segments = _split_by_paragraph(text)
    elif strategy == "fixed":
        segments = _split_fixed(text, chunk_size)
    else:
        segments = _split_fixed(text, chunk_size)

    # Merge small segments and split large ones
    current_chunk = ""
    chunk_index = 0

    for segment in segments:
        if len(current_chunk) + len(segment) > chunk_size and current_chunk:
            chunks.append(TextChunk(content=current_chunk.strip(), index=chunk_index))
            chunk_index += 1

            # Keep overlap
            if chunk_overlap > 0:
                overlap_start = max(0, len(current_chunk) - chunk_overlap)
                current_chunk = current_chunk[overlap_start:] + " " + segment
            else:
                current_chunk = segment
        else:
            current_chunk += (" " if current_chunk else "") + segment

        # If single segment exceeds chunk size, force split
        if len(current_chunk) > chunk_size * 1.5:
            force_split = _split_fixed(current_chunk, chunk_size)
            for part in force_split[:-1]:
                chunks.append(TextChunk(content=part.strip(), index=chunk_index))
                chunk_index += 1
            current_chunk = force_split[-1]

    if current_chunk.strip():
        chunks.append(TextChunk(content=current_chunk.strip(), index=chunk_index))

    return chunks
