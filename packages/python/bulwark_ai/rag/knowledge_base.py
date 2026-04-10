"""
Knowledge Base -- document ingestion, chunking, embedding, and retrieval.

Uses aiosqlite for async storage with in-process cosine similarity search.
Tenant-isolated: all operations are scoped by tenant_id.
"""

from __future__ import annotations

import json
import struct
import uuid
from typing import Any

import aiosqlite

from .chunker import chunk_text
from .embeddings import OpenAIEmbeddings, cosine_similarity
from .types import (
    ChunkOptions,
    Chunk,
    KnowledgeSource,
    RAGConfig,
    SearchResult,
)


def _floats_to_blob(floats: list[float]) -> bytes:
    """Pack a list of floats into a binary blob (little-endian float32)."""
    return struct.pack(f"<{len(floats)}f", *floats)


def _blob_to_floats(blob: bytes) -> list[float]:
    """Unpack a binary blob back to a list of floats."""
    count = len(blob) // 4
    return list(struct.unpack(f"<{count}f", blob))


class KnowledgeBase:
    """
    Async knowledge base with document ingestion, chunking, embedding, and semantic search.

    Uses aiosqlite for storage and httpx-based OpenAI embeddings API.
    All queries are tenant-isolated.

    Example::

        kb = KnowledgeBase(db_path="bulwark.db", config=RAGConfig(enabled=True), openai_api_key="sk-...")
        await kb.initialize()
        result = await kb.ingest("My document...", name="contract.pdf", source_type="pdf")
        results = await kb.search("payment terms", tenant_id="tenant_1")
    """

    def __init__(self, db_path: str, config: RAGConfig, openai_api_key: str) -> None:
        self._db_path = db_path
        self._config = config
        self._embedder = OpenAIEmbeddings(openai_api_key, config.embedding_model)
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        """Open the database and create tables if needed."""
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS bulwark_knowledge_sources (
                id TEXT PRIMARY KEY,
                tenant_id TEXT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                chunk_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS bulwark_chunks (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                tenant_id TEXT,
                content TEXT NOT NULL,
                embedding BLOB,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (source_id) REFERENCES bulwark_knowledge_sources(id)
            )
        """)
        await self._db.execute(
            "CREATE INDEX IF NOT EXISTS idx_chunks_source ON bulwark_chunks(source_id)"
        )
        await self._db.execute(
            "CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON bulwark_chunks(tenant_id)"
        )
        await self._db.commit()

    async def close(self) -> None:
        """Close the database connection."""
        if self._db:
            await self._db.close()
            self._db = None

    def _ensure_db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("KnowledgeBase not initialized. Call await kb.initialize() first.")
        return self._db

    async def ingest(
        self,
        content: str,
        *,
        name: str,
        source_type: str = "text",
        tenant_id: str | None = None,
        chunk_options: ChunkOptions | None = None,
    ) -> dict[str, Any]:
        """
        Ingest text content into the knowledge base.

        Chunks the text, generates embeddings via OpenAI, and stores them.

        Returns:
            Dict with ``source_id`` and ``chunks`` count.
        """
        db = self._ensure_db()
        source_id = str(uuid.uuid4())
        opts = chunk_options or ChunkOptions()

        await db.execute(
            "INSERT INTO bulwark_knowledge_sources (id, tenant_id, name, type, status) VALUES (?, ?, ?, ?, ?)",
            (source_id, tenant_id, name, source_type, "indexing"),
        )
        await db.commit()

        try:
            chunks = chunk_text(
                content,
                chunk_size=opts.chunk_size or self._config.chunk_size,
                chunk_overlap=opts.chunk_overlap or self._config.chunk_overlap,
                strategy=opts.strategy or "paragraph",
            )

            if not chunks:
                await db.execute(
                    "UPDATE bulwark_knowledge_sources SET status = 'error' WHERE id = ?",
                    (source_id,),
                )
                await db.commit()
                return {"source_id": source_id, "chunks": 0}

            # Generate embeddings in batch
            texts = [c.content for c in chunks]
            embeddings = await self._embedder.embed(texts)

            # Store chunks with embeddings
            for i, chunk in enumerate(chunks):
                chunk_id = str(uuid.uuid4())
                embedding_blob = _floats_to_blob(embeddings[i])
                metadata = json.dumps({"index": chunk.index})
                await db.execute(
                    "INSERT INTO bulwark_chunks (id, source_id, tenant_id, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?)",
                    (chunk_id, source_id, tenant_id, chunk.content, embedding_blob, metadata),
                )

            # Update source status
            await db.execute(
                "UPDATE bulwark_knowledge_sources SET status = 'active', chunk_count = ?, updated_at = datetime('now') WHERE id = ?",
                (len(chunks), source_id),
            )
            await db.commit()
            return {"source_id": source_id, "chunks": len(chunks)}

        except Exception:
            await db.execute(
                "UPDATE bulwark_knowledge_sources SET status = 'error' WHERE id = ?",
                (source_id,),
            )
            await db.commit()
            raise

    async def search(
        self,
        query: str,
        *,
        tenant_id: str | None = None,
        source_id: str | None = None,
        top_k: int | None = None,
        min_score: float | None = None,
    ) -> list[SearchResult]:
        """
        Search the knowledge base using semantic similarity.

        SECURITY: Always scoped by tenant_id. If no tenant_id, only searches
        global (non-tenant) chunks.
        """
        db = self._ensure_db()
        k = top_k or self._config.top_k
        threshold = min_score or self._config.min_score

        # Generate query embedding
        query_embeddings = await self._embedder.embed([query])
        query_embedding = query_embeddings[0]

        # Build SQL -- always scope by tenant
        sql = (
            "SELECT c.id, c.source_id, c.content, c.embedding, c.metadata, c.tenant_id, "
            "ks.name as source_name "
            "FROM bulwark_chunks c "
            "JOIN bulwark_knowledge_sources ks ON ks.id = c.source_id "
            "WHERE ks.status = 'active'"
        )
        params: list[Any] = []

        if tenant_id:
            sql += " AND c.tenant_id = ?"
            params.append(tenant_id)
        else:
            sql += " AND (c.tenant_id IS NULL OR c.tenant_id = '')"

        if source_id:
            sql += " AND c.source_id = ?"
            params.append(source_id)

        async with db.execute(sql, params) as cursor:
            rows = await cursor.fetchall()

        # Calculate similarity scores
        scored: list[SearchResult] = []
        for row in rows:
            row_id, row_source_id, content, embedding_blob, metadata_str, row_tenant_id, source_name = row
            if not embedding_blob:
                continue
            embedding = _blob_to_floats(embedding_blob)
            score = cosine_similarity(query_embedding, embedding)

            if score >= threshold:
                parsed_meta = json.loads(metadata_str) if metadata_str else None
                scored.append(SearchResult(
                    chunk=Chunk(
                        id=row_id,
                        source_id=row_source_id,
                        source_name=source_name,
                        content=content,
                        tenant_id=row_tenant_id,
                        metadata=parsed_meta,
                    ),
                    score=score,
                ))

        # Sort by score descending, take top K
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:k]

    async def list_sources(self, tenant_id: str | None = None) -> list[KnowledgeSource]:
        """List all knowledge sources, scoped by tenant."""
        db = self._ensure_db()

        if tenant_id:
            sql = "SELECT * FROM bulwark_knowledge_sources WHERE tenant_id = ? ORDER BY created_at DESC"
            params: tuple[Any, ...] = (tenant_id,)
        else:
            sql = "SELECT * FROM bulwark_knowledge_sources WHERE (tenant_id IS NULL OR tenant_id = '') ORDER BY created_at DESC"
            params = ()

        async with db.execute(sql, params) as cursor:
            rows = await cursor.fetchall()
            columns = [desc[0] for desc in cursor.description] if cursor.description else []

        sources: list[KnowledgeSource] = []
        for row in rows:
            row_dict = dict(zip(columns, row))
            sources.append(KnowledgeSource(
                id=row_dict["id"],
                name=row_dict["name"],
                type=row_dict["type"],
                status=row_dict["status"],
                chunk_count=row_dict.get("chunk_count", 0) or 0,
                tenant_id=row_dict.get("tenant_id"),
                created_at=row_dict.get("created_at", ""),
                updated_at=row_dict.get("updated_at", ""),
            ))
        return sources

    async def delete_source(self, source_id: str, tenant_id: str | None = None) -> None:
        """
        Delete a knowledge source and all its chunks.

        If tenant_id provided, verifies ownership before deleting.
        """
        db = self._ensure_db()

        if tenant_id:
            async with db.execute(
                "SELECT tenant_id FROM bulwark_knowledge_sources WHERE id = ?",
                (source_id,),
            ) as cursor:
                row = await cursor.fetchone()
            if row and row[0] and row[0] != tenant_id:
                raise PermissionError("Cannot delete source belonging to another tenant")

        await db.execute("DELETE FROM bulwark_chunks WHERE source_id = ?", (source_id,))
        await db.execute("DELETE FROM bulwark_knowledge_sources WHERE id = ?", (source_id,))
        await db.commit()
