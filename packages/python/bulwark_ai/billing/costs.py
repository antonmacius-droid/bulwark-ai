"""
Cost calculation for LLM API calls.

Maintains a pricing table of 30+ models across OpenAI, Anthropic, Mistral,
Google, and Ollama. Prices are per million tokens.
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

from ..types import CostRecord

logger = logging.getLogger("bulwark_ai.billing.costs")

__all__ = ["CostCalculator", "MODEL_PRICING"]

# Per-million-token pricing
MODEL_PRICING: Dict[str, Dict[str, float]] = {
    # OpenAI
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    "gpt-4": {"input": 30.00, "output": 60.00},
    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
    "o1": {"input": 15.00, "output": 60.00},
    "o1-mini": {"input": 3.00, "output": 12.00},
    "o3-mini": {"input": 1.10, "output": 4.40},
    # Anthropic
    "claude-opus-4-6": {"input": 15.00, "output": 75.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-haiku-4-5": {"input": 0.80, "output": 4.00},
    "claude-3-5-sonnet-20241022": {"input": 3.00, "output": 15.00},
    "claude-3-opus-20240229": {"input": 15.00, "output": 75.00},
    "claude-3-haiku-20240307": {"input": 0.25, "output": 1.25},
    "claude-3-5-haiku-20241022": {"input": 1.00, "output": 5.00},
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
    "claude-opus-4-20250514": {"input": 15.00, "output": 75.00},
    # Mistral
    "mistral-large-latest": {"input": 2.00, "output": 6.00},
    "mistral-small-latest": {"input": 0.10, "output": 0.30},
    "mistral-medium-latest": {"input": 2.70, "output": 8.10},
    "codestral-latest": {"input": 0.30, "output": 0.90},
    "pixtral-large-latest": {"input": 2.00, "output": 6.00},
    # Google
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-2.0-pro": {"input": 1.25, "output": 5.00},
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    # Ollama (local -- zero cost)
    "llama3.2": {"input": 0, "output": 0},
    "llama3.1": {"input": 0, "output": 0},
    "phi4": {"input": 0, "output": 0},
    "deepseek-r1": {"input": 0, "output": 0},
    "qwen2.5": {"input": 0, "output": 0},
    "codellama": {"input": 0, "output": 0},
}


def _detect_provider(model: str) -> str:
    """Detect provider from model name."""
    m = model.lower()
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith(("mistral", "codestral", "pixtral")):
        return "mistral"
    if m.startswith(("gemini", "palm")):
        return "google"
    if m.startswith(("llama", "phi", "qwen", "deepseek", "codellama")):
        return "ollama"
    return "openai"


class CostCalculator:
    """Calculate USD cost for LLM API calls based on token usage."""

    def __init__(self, overrides: Optional[Dict[str, Dict[str, float]]] = None) -> None:
        self._pricing: Dict[str, Dict[str, float]] = {**MODEL_PRICING}
        if overrides:
            self._pricing.update(overrides)

    def calculate(self, model: str, input_tokens: int, output_tokens: int) -> CostRecord:
        """Calculate cost in USD for a request.

        Args:
            model: Model name (e.g. "gpt-4o").
            input_tokens: Number of input/prompt tokens.
            output_tokens: Number of output/completion tokens.

        Returns:
            CostRecord with per-token and total costs (6 decimal places).
        """
        pricing = self._pricing.get(model) or self._pricing.get("gpt-4o-mini") or {"input": 0.15, "output": 0.60}

        input_cost = (input_tokens / 1_000_000) * pricing["input"]
        output_cost = (output_tokens / 1_000_000) * pricing["output"]
        total_cost = input_cost + output_cost

        return CostRecord(
            model=model,
            provider=_detect_provider(model),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_cost=round(input_cost, 6),
            output_cost=round(output_cost, 6),
            total_cost=round(total_cost, 6),
        )

    def set_model_price(self, model: str, input_price: float, output_price: float) -> None:
        """Update pricing for a model (per million tokens)."""
        self._pricing[model] = {"input": input_price, "output": output_price}
