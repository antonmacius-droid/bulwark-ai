/**
 * Prompt CI/CD — version control and regression testing for system prompts.
 *
 * Features:
 * - Versioned prompt registry with instant rollback
 * - Golden dataset management (expected input/output pairs)
 * - Automated quality testing via embedding similarity
 * - Hot standby: previous version always ready for instant revert
 *
 * Feedback incorporated from @m13v:
 * - Embedding similarity for automated gating (not LLM-as-judge)
 * - Instant rollback without rebuilding from git (hot standby pattern)
 *
 * @example
 * ```ts
 * const registry = new PromptRegistry(gateway.database);
 *
 * // Register a prompt
 * await registry.register("contract-analyzer", {
 *   systemPrompt: "You are a contract analysis expert...",
 *   model: "gpt-4o",
 * });
 *
 * // Add golden test cases
 * await registry.addTestCase("contract-analyzer", {
 *   input: "What are the payment terms?",
 *   expectedOutput: "Payment is due within 30 days...",
 * });
 *
 * // Test a new prompt version before deploying
 * const results = await registry.test("contract-analyzer", {
 *   systemPrompt: "You are an expert legal contract analyst...",
 * });
 * // { passed: true, score: 0.91, details: [...] }
 *
 * // Deploy (keeps previous version as hot standby)
 * await registry.register("contract-analyzer", { systemPrompt: "..." });
 *
 * // Instant rollback (< 1ms, no pipeline rebuild)
 * await registry.rollback("contract-analyzer");
 *
 * // Get active prompt for use in gateway
 * const prompt = await registry.getActive("contract-analyzer");
 * ```
 */

import { v4 as uuid } from "uuid";
import type { Database } from "../database";
import type { EmbeddingProvider } from "../rag/embeddings";
import { cosineSimilarity } from "../rag/embeddings";

// --- Types ---

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  systemPrompt: string;
  model?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  /** Whether this is the currently active version */
  active: boolean;
}

export interface TestCase {
  id: string;
  promptId: string;
  input: string;
  expectedOutput: string;
  weight?: number;
  tags?: string[];
  createdAt: string;
}

export interface TestResult {
  testCaseId: string;
  input: string;
  expectedOutput: string;
  /** Cosine similarity between expected and actual output embeddings */
  similarity: number;
  passed: boolean;
}

export interface TestSuiteResult {
  promptId: string;
  versionTested: number;
  passed: boolean;
  /** Weighted average similarity score */
  score: number;
  /** Minimum similarity threshold used */
  threshold: number;
  results: TestResult[];
  timestamp: string;
}

export interface PromptRegistryConfig {
  /** Minimum similarity score to pass (0-1, default: 0.75) */
  passThreshold?: number;
}

// --- Schema ---

const PROMPT_SCHEMA = `
CREATE TABLE IF NOT EXISTS bulwark_prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active_version INTEGER NOT NULL DEFAULT 0,
  previous_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulwark_prompt_versions (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  model TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(prompt_id, version)
);

CREATE TABLE IF NOT EXISTS bulwark_prompt_test_cases (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bulwark_prompt_test_results (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  score REAL NOT NULL,
  passed INTEGER NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// --- Implementation ---

export class PromptRegistry {
  private db: Database;
  private embedder: EmbeddingProvider | null;
  private config: PromptRegistryConfig;
  private initialized = false;

  constructor(db: Database, embedder?: EmbeddingProvider, config: PromptRegistryConfig = {}) {
    this.db = db;
    this.embedder = embedder || null;
    this.config = config;
  }

  /** Initialize prompt tables. */
  async init(): Promise<void> {
    if (this.initialized) return;
    const statements = PROMPT_SCHEMA.split(";").filter(s => s.trim());
    for (const stmt of statements) {
      this.db.run(stmt.trim());
    }
    this.initialized = true;
  }

  /**
   * Register a new prompt (or update an existing one with a new version).
   */
  async register(name: string, config: {
    systemPrompt: string;
    model?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PromptVersion> {
    await this.init();

    // Check if prompt exists
    const existing = await this.db.queryOne<{ id: string; active_version: number }>(
      "SELECT id, active_version FROM bulwark_prompts WHERE name = ?", [name]
    );

    let promptId: string;
    let version: number;

    if (existing) {
      promptId = existing.id;
      version = existing.active_version + 1;
      // Store current active as previous (hot standby)
      this.db.run(
        "UPDATE bulwark_prompts SET previous_version = active_version, active_version = ?, updated_at = datetime('now') WHERE id = ?",
        [version, promptId]
      );
    } else {
      promptId = uuid();
      version = 1;
      this.db.run(
        "INSERT INTO bulwark_prompts (id, name, description, active_version) VALUES (?, ?, ?, ?)",
        [promptId, name, config.description || null, version]
      );
    }

    // Create version record
    const versionId = uuid();
    this.db.run(
      "INSERT INTO bulwark_prompt_versions (id, prompt_id, version, system_prompt, model, metadata) VALUES (?, ?, ?, ?, ?, ?)",
      [versionId, promptId, version, config.systemPrompt, config.model || null, config.metadata ? JSON.stringify(config.metadata) : null]
    );

    return {
      id: versionId,
      promptId,
      version,
      systemPrompt: config.systemPrompt,
      model: config.model,
      metadata: config.metadata,
      createdAt: new Date().toISOString(),
      active: true,
    };
  }

  /**
   * Get the currently active prompt version by name.
   */
  async getActive(name: string): Promise<PromptVersion | null> {
    await this.init();
    const row = await this.db.queryOne<{
      vid: string; pid: string; version: number; system_prompt: string; model: string; metadata: string; created_at: string;
    }>(
      `SELECT pv.id as vid, pv.prompt_id as pid, pv.version, pv.system_prompt, pv.model, pv.metadata, pv.created_at
       FROM bulwark_prompts p
       JOIN bulwark_prompt_versions pv ON pv.prompt_id = p.id AND pv.version = p.active_version
       WHERE p.name = ?`,
      [name]
    );
    if (!row) return null;
    return {
      id: row.vid, promptId: row.pid, version: row.version,
      systemPrompt: row.system_prompt, model: row.model,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at, active: true,
    };
  }

  /**
   * List all prompt versions for a given prompt name.
   */
  async listVersions(name: string): Promise<PromptVersion[]> {
    await this.init();
    const prompt = await this.db.queryOne<{ id: string; active_version: number }>(
      "SELECT id, active_version FROM bulwark_prompts WHERE name = ?", [name]
    );
    if (!prompt) return [];

    const rows = await this.db.queryAll<{
      id: string; prompt_id: string; version: number; system_prompt: string; model: string; metadata: string; created_at: string;
    }>(
      "SELECT * FROM bulwark_prompt_versions WHERE prompt_id = ? ORDER BY version DESC",
      [prompt.id]
    );
    return rows.map(r => ({
      id: r.id, promptId: r.prompt_id, version: r.version,
      systemPrompt: r.system_prompt, model: r.model,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.created_at, active: r.version === prompt.active_version,
    }));
  }

  /**
   * Instant rollback to previous version (hot standby pattern).
   * No pipeline rebuild — just swaps active/previous pointers.
   */
  async rollback(name: string): Promise<{ rolledBackTo: number } | null> {
    await this.init();
    const prompt = await this.db.queryOne<{ id: string; active_version: number; previous_version: number | null }>(
      "SELECT id, active_version, previous_version FROM bulwark_prompts WHERE name = ?", [name]
    );
    if (!prompt || !prompt.previous_version) return null;

    // Swap active and previous
    this.db.run(
      "UPDATE bulwark_prompts SET active_version = ?, previous_version = ?, updated_at = datetime('now') WHERE id = ?",
      [prompt.previous_version, prompt.active_version, prompt.id]
    );

    return { rolledBackTo: prompt.previous_version };
  }

  /**
   * Add a test case (golden dataset entry) for a prompt.
   */
  async addTestCase(name: string, testCase: {
    input: string;
    expectedOutput: string;
    weight?: number;
    tags?: string[];
  }): Promise<TestCase> {
    await this.init();
    const prompt = await this.db.queryOne<{ id: string }>(
      "SELECT id FROM bulwark_prompts WHERE name = ?", [name]
    );
    if (!prompt) throw new Error(`Prompt not found: ${name}`);

    const id = uuid();
    this.db.run(
      "INSERT INTO bulwark_prompt_test_cases (id, prompt_id, input, expected_output, weight, tags) VALUES (?, ?, ?, ?, ?, ?)",
      [id, prompt.id, testCase.input, testCase.expectedOutput, testCase.weight ?? 1.0, testCase.tags ? JSON.stringify(testCase.tags) : null]
    );

    return {
      id, promptId: prompt.id,
      input: testCase.input, expectedOutput: testCase.expectedOutput,
      weight: testCase.weight ?? 1.0, tags: testCase.tags,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * List test cases for a prompt.
   */
  async listTestCases(name: string): Promise<TestCase[]> {
    await this.init();
    const prompt = await this.db.queryOne<{ id: string }>(
      "SELECT id FROM bulwark_prompts WHERE name = ?", [name]
    );
    if (!prompt) return [];

    const rows = await this.db.queryAll<{
      id: string; prompt_id: string; input: string; expected_output: string; weight: number; tags: string; created_at: string;
    }>(
      "SELECT * FROM bulwark_prompt_test_cases WHERE prompt_id = ? ORDER BY created_at ASC",
      [prompt.id]
    );
    return rows.map(r => ({
      id: r.id, promptId: r.prompt_id,
      input: r.input, expectedOutput: r.expected_output,
      weight: r.weight, tags: r.tags ? JSON.parse(r.tags) : undefined,
      createdAt: r.created_at,
    }));
  }

  /**
   * Run regression tests for a prompt version using embedding similarity.
   * Compares the expected output embeddings against the actual output text.
   *
   * If `actualOutputs` is provided, uses those instead of calling the LLM.
   * This allows testing without an LLM — just provide the outputs externally.
   */
  async test(name: string, actualOutputs: string[]): Promise<TestSuiteResult> {
    await this.init();
    if (!this.embedder) throw new Error("Embedder required for testing — pass an EmbeddingProvider to the constructor");

    const prompt = await this.db.queryOne<{ id: string; active_version: number }>(
      "SELECT id, active_version FROM bulwark_prompts WHERE name = ?", [name]
    );
    if (!prompt) throw new Error(`Prompt not found: ${name}`);

    const testCases = await this.listTestCases(name);
    if (testCases.length === 0) throw new Error(`No test cases for prompt: ${name}`);
    if (actualOutputs.length !== testCases.length) {
      throw new Error(`Expected ${testCases.length} outputs, got ${actualOutputs.length}`);
    }

    const threshold = this.config.passThreshold ?? 0.75;

    // Embed all expected outputs and actual outputs in batch
    const expectedTexts = testCases.map(tc => tc.expectedOutput);
    const [expectedEmbeddings, actualEmbeddings] = await Promise.all([
      this.embedder.embed(expectedTexts),
      this.embedder.embed(actualOutputs),
    ]);

    // Compare each pair
    const results: TestResult[] = [];
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < testCases.length; i++) {
      const similarity = cosineSimilarity(expectedEmbeddings[i], actualEmbeddings[i]);
      const weight = testCases[i].weight ?? 1.0;
      const passed = similarity >= threshold;

      results.push({
        testCaseId: testCases[i].id,
        input: testCases[i].input,
        expectedOutput: testCases[i].expectedOutput,
        similarity: Math.round(similarity * 1000) / 1000,
        passed,
      });

      weightedSum += similarity * weight;
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 1000) / 1000 : 0;
    const allPassed = results.every(r => r.passed);

    // Store result
    const resultId = uuid();
    this.db.run(
      "INSERT INTO bulwark_prompt_test_results (id, prompt_id, version, score, passed, details) VALUES (?, ?, ?, ?, ?, ?)",
      [resultId, prompt.id, prompt.active_version, score, allPassed ? 1 : 0, JSON.stringify(results)]
    );

    return {
      promptId: prompt.id,
      versionTested: prompt.active_version,
      passed: allPassed,
      score,
      threshold,
      results,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List all registered prompts.
   */
  async list(): Promise<{ id: string; name: string; activeVersion: number; previousVersion: number | null; createdAt: string }[]> {
    await this.init();
    const rows = await this.db.queryAll<{
      id: string; name: string; active_version: number; previous_version: number | null; created_at: string;
    }>("SELECT * FROM bulwark_prompts ORDER BY created_at DESC");
    return rows.map(r => ({
      id: r.id, name: r.name,
      activeVersion: r.active_version,
      previousVersion: r.previous_version,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get test history for a prompt.
   */
  async getTestHistory(name: string, limit = 20): Promise<{ version: number; score: number; passed: boolean; createdAt: string }[]> {
    await this.init();
    const prompt = await this.db.queryOne<{ id: string }>(
      "SELECT id FROM bulwark_prompts WHERE name = ?", [name]
    );
    if (!prompt) return [];

    return this.db.queryAll<{ version: number; score: number; passed: boolean; created_at: string }>(
      `SELECT version, score, passed, created_at FROM bulwark_prompt_test_results
       WHERE prompt_id = ? ORDER BY created_at DESC LIMIT ?`,
      [prompt.id, limit]
    ).then(rows => rows.map(r => ({
      version: r.version, score: r.score, passed: !!r.passed, createdAt: r.created_at,
    })));
  }
}
