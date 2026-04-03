import type { ChatMessage } from "../types";
import type { ContentPolicy } from "./types";

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  action: "block" | "warn";
  matchedPattern?: string;
}

interface CheckContext {
  userId?: string;
  teamId?: string;
  tenantId?: string;
}

export class PolicyEngine {
  private policies: ContentPolicy[];

  constructor(policies: ContentPolicy[]) {
    this.policies = policies;
  }

  /** Get all policies */
  getPolicies(): ContentPolicy[] {
    return [...this.policies]; // return copy to prevent mutation
  }

  /** Add a policy at runtime */
  addPolicy(policy: ContentPolicy): void {
    // Validate policy
    if (!policy.id || !policy.name || !policy.type || !policy.action) {
      throw new Error("Policy must have id, name, type, and action");
    }
    if (this.policies.some(p => p.id === policy.id)) {
      throw new Error(`Policy with id "${policy.id}" already exists`);
    }
    this.policies.push(policy);
  }

  /** Remove a policy by ID */
  removePolicy(id: string): void {
    this.policies = this.policies.filter(p => p.id !== id);
  }

  /** Check messages against all active policies */
  check(messages: ChatMessage[], context: CheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const text = messages.map(m => m.content).join(" ");

    for (const policy of this.policies) {
      // Tenant scope check
      if (policy.tenantId && policy.tenantId !== context.tenantId) continue;

      // Scope check — if policy targets specific teams/users, skip if not in scope
      if (policy.applyTo) {
        const hasUserScope = policy.applyTo.users && policy.applyTo.users.length > 0;
        const hasTeamScope = policy.applyTo.teams && policy.applyTo.teams.length > 0;

        // If teams are specified, user must be in one of those teams
        if (hasTeamScope && (!context.teamId || !policy.applyTo.teams!.includes(context.teamId))) continue;
        // If users are specified, user must be in the list
        if (hasUserScope && (!context.userId || !policy.applyTo.users!.includes(context.userId))) continue;
      }

      let violated = false;
      let matchedPattern: string | undefined;

      switch (policy.type) {
        case "keyword_block":
          if (policy.patterns) {
            for (const kw of policy.patterns) {
              if (text.toLowerCase().includes(kw.toLowerCase())) {
                violated = true;
                matchedPattern = kw;
                break;
              }
            }
          }
          break;

        case "regex_block":
          if (policy.regex) {
            // ReDoS protection — reject patterns with nested quantifiers
            if (/\([^)]*[+*][^)]*\)[+*]/.test(policy.regex)) break;
            if (/(\.\*){3,}/.test(policy.regex)) break;
            try {
              const regex = new RegExp(policy.regex, "gi");
              const match = regex.exec(text);
              if (match) {
                violated = true;
                matchedPattern = match[0];
              }
            } catch { /* invalid regex — skip */ }
          }
          break;

        case "topic_restriction":
          if (policy.patterns) {
            const lowerText = text.toLowerCase();
            for (const topic of policy.patterns) {
              if (lowerText.includes(topic.toLowerCase())) {
                violated = true;
                matchedPattern = topic;
                break;
              }
            }
          }
          break;

        case "max_tokens":
          if (policy.maxTokens) {
            // Conservative estimate: 1 token ≈ 3 chars (errs on the side of blocking)
            // Actual tokenization varies: English prose ~4 chars/token, code/short words ~2-3
            const estimatedTokens = Math.ceil(text.length / 3);
            if (estimatedTokens > policy.maxTokens) {
              violated = true;
              matchedPattern = `${estimatedTokens} tokens (max: ${policy.maxTokens})`;
            }
          }
          break;
      }

      if (violated) {
        violations.push({
          policyId: policy.id,
          policyName: policy.name,
          action: policy.action,
          matchedPattern,
        });
      }
    }

    return violations;
  }
}
