"""RAG type definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class RAGConfig:
    enabled: bool = False
    embedding_model: str = "text-embedding-3-small"
    chunk_size: int = 1000
    chunk_overlap: int = 200
    top_k: int = 8
    min_score: float = 0.3


@dataclass
class Chunk:
    id: str
    source_id: str
    source_name: str
    content: str
    embedding: list[float] | None = None
    metadata: dict[str, Any] | None = None
    tenant_id: str | None = None


@dataclass
class SearchResult:
    chunk: Chunk
    score: float


@dataclass
class KnowledgeSource:
    id: str
    name: str
    type: Literal["pdf", "docx", "text", "markdown", "csv", "html", "url", "confluence", "sharepoint"]
    status: Literal["pending", "indexing", "active", "error"]
    chunk_count: int = 0
    tenant_id: str | None = None
    created_at: str = ""
    updated_at: str = ""


@dataclass
class ChunkOptions:
    chunk_size: int = 1000
    chunk_overlap: int = 200
    strategy: Literal["paragraph", "sentence", "fixed", "markdown"] = "paragraph"


@dataclass
class TextChunk:
    content: str
    index: int
    metadata: dict[str, Any] | None = None
