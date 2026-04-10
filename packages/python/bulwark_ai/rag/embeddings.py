"""
Embedding generation -- wraps OpenAI's embedding API using httpx.

Produces 1536-dimensional vectors (text-embedding-3-small) or 3072 (text-embedding-3-large).
"""

from __future__ import annotations

import math

import httpx


class OpenAIEmbeddings:
    """
    Async OpenAI embeddings client using httpx (no openai SDK dependency).

    Supports batch embedding up to 512 inputs per request.
    """

    OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"

    def __init__(self, api_key: str, model: str = "text-embedding-3-small") -> None:
        self._api_key = api_key
        self._model = model
        self.dimensions = 3072 if "large" in model else 1536

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a list of texts.

        Batches in groups of 512 to stay within OpenAI limits.
        """
        batch_size = 512
        all_embeddings: list[list[float]] = []

        async with httpx.AsyncClient(timeout=120.0) as client:
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                response = await client.post(
                    self.OPENAI_EMBEDDINGS_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._model,
                        "input": batch,
                    },
                )
                response.raise_for_status()
                data = response.json()
                for item in data["data"]:
                    all_embeddings.append(item["embedding"])

        return all_embeddings


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Cosine similarity between two vectors.

    Returns value between -1 and 1 (higher = more similar).
    Returns 0 if vectors have different lengths or zero magnitude.
    """
    if len(a) != len(b):
        return 0.0

    dot_product = 0.0
    norm_a = 0.0
    norm_b = 0.0

    for i in range(len(a)):
        dot_product += a[i] * b[i]
        norm_a += a[i] * a[i]
        norm_b += b[i] * b[i]

    denominator = math.sqrt(norm_a) * math.sqrt(norm_b)
    return dot_product / denominator if denominator != 0 else 0.0
