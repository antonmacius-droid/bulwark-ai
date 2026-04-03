# Contributing to Bulwark AI

Thank you for your interest in contributing to Bulwark AI! This document explains how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/afkzona/bulwark-ai.git
cd bulwark-ai

# Install dependencies
cd packages/typescript
npm install

# Type check
npx tsc --noEmit

# Run unit tests (no API key needed)
npx vitest run

# Run integration tests (requires OpenAI key, costs ~$2-3)
OPENAI_API_KEY=sk-xxx npx vitest run src/__tests__/integration.test.ts

# Start the admin UI (optional)
cd ../admin-ui
npm install
npm run dev          # → http://localhost:3100

# Start the demo backend (optional)
npx tsx server.ts    # → http://localhost:3101
```

## Project Structure

```
packages/
  typescript/src/
    gateway.ts              # Core AIGateway class
    types.ts                # Type definitions
    providers/              # LLM providers (OpenAI, Anthropic, Mistral, Google, Ollama, Azure)
    security/               # PII detection, content policies, prompt injection guard
    billing/                # Cost calculator, budget enforcement
    audit/                  # Audit logging
    cache/                  # Memory, Redis, rate limiter, response cache
    rag/                    # Knowledge base, chunker, embeddings, parsers
    compliance/             # GDPR, SOC 2, HIPAA, data residency
    middleware/             # Express, Next.js, Fastify adapters
    admin/                  # Admin API + embeddable React panel
    streaming.ts            # SSE streaming support
    tenant.ts               # Multi-tenant management
    __tests__/              # Unit + integration tests
  admin-ui/                 # Standalone admin dashboard (Vite + React)
```

## How to Contribute

### Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version, OS, provider used

### Feature Requests

Open an issue with:
- Use case description
- Proposed API design
- Whether you'd like to implement it

### Pull Requests

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Add tests for new functionality
5. Run the full test suite: `npx vitest run`
6. Type check: `npx tsc --noEmit`
7. Submit a PR with a clear description

### Code Style

- TypeScript strict mode
- No `any` types (use `unknown` + type guards)
- All public APIs must have JSDoc comments
- Error handling: use `BulwarkError` with error codes
- No external dependencies for core modules (keep the package lightweight)

### Tests

- Unit tests for all logic (no API calls)
- Integration tests for end-to-end flows (real API calls)
- Every new feature must have tests
- Tests must pass: `npx vitest run && npx tsc --noEmit`

### Commit Messages

Use conventional commits:
```
feat: add Mistral provider
fix: PII regex for international phone numbers
docs: update streaming example
test: add GDPR erasure integration test
```

## Licensing

### Important: Contributor License

By submitting a pull request, you agree that:

1. Your contribution is your original work
2. You grant AFKzona Group a perpetual, worldwide, non-exclusive, royalty-free license to use, modify, and distribute your contribution
3. You have the right to grant this license
4. Your contribution may be distributed under the project's existing licenses (MIT for core, BSL 1.1 for premium modules)

This is a standard DCO (Developer Certificate of Origin). It ensures the project can be maintained and licensed consistently.

### Module Licensing

- **MIT modules** (core, providers, security, billing, audit, cache, middleware): Contributions are MIT-licensed
- **BSL modules** (rag, compliance, admin): Contributions follow BSL 1.1 terms

If you're unsure which license applies to your contribution, ask in the PR.

## Getting Help

- Open a GitHub issue for bugs or questions
- Email: info@afkzonagroup.lt for licensing questions
- Check the admin panel Docs page for API reference

## Code of Conduct

Be respectful, constructive, and inclusive. We're building security infrastructure — precision and thoroughness are valued over speed.
