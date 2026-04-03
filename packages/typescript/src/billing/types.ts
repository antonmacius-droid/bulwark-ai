export interface BudgetConfig {
  enabled: boolean;
  /** Default monthly token budget per user (0 = unlimited) */
  defaultUserLimit?: number;
  /** Default monthly token budget per team (0 = unlimited) */
  defaultTeamLimit?: number;
  /** Action when budget exceeded: "block" or "warn" */
  onExceeded?: "block" | "warn";
  /** Alert thresholds (0-1) — triggers callback */
  alertThresholds?: number[];
  /** Callback when threshold hit */
  onAlert?: (alert: BudgetAlert) => void | Promise<void>;
}

export interface BudgetAlert {
  type: "user" | "team" | "tenant";
  id: string;
  threshold: number;
  used: number;
  limit: number;
  costUsd: number;
}

export interface UsageRecord {
  userId?: string;
  teamId?: string;
  tenantId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

export interface CostRecord {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/** Per million tokens pricing */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4-turbo": { input: 10.00, output: 30.00 },
  "o1": { input: 15.00, output: 60.00 },
  "o1-mini": { input: 3.00, output: 12.00 },
  "o3-mini": { input: 1.10, output: 4.40 },
  // Anthropic
  "claude-opus-4-6": { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5": { input: 0.80, output: 4.00 },
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
  "claude-3-opus-20240229": { input: 15.00, output: 75.00 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  // Mistral
  "mistral-large-latest": { input: 2.00, output: 6.00 },
  "mistral-small-latest": { input: 0.10, output: 0.30 },
  "codestral-latest": { input: 0.30, output: 0.90 },
  "pixtral-large-latest": { input: 2.00, output: 6.00 },
  // Google
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-pro": { input: 1.25, output: 5.00 },
  "gemini-1.5-pro": { input: 1.25, output: 5.00 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  // Ollama (local — zero cost)
  "llama3.2": { input: 0, output: 0 },
  "phi4": { input: 0, output: 0 },
  "deepseek-r1": { input: 0, output: 0 },
  "qwen2.5": { input: 0, output: 0 },
};
