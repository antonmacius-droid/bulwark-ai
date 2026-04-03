import React, { useState } from "react";
import { PageHeader, StatCard, card, Loading, useFetch } from "../components/shared";

interface SettingsData {
  policyCount: number; sourceCount: number; budgetCount: number; tenantCount: number;
  monthlyUsage: { requests: number; tokens: number; cost: number };
}

function ToggleSwitch({ defaultOn = true }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button onClick={() => setOn(!on)} style={{
      width: 40, height: 22, borderRadius: 11, border: "none", padding: 2,
      background: on ? "#059669" : "#D1D5DB", cursor: "pointer", transition: "background 150ms",
      display: "flex", alignItems: "center",
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: 9, background: "white",
        boxShadow: "0 1px 3px rgba(0,0,0,.15)",
        transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform 150ms",
      }} />
    </button>
  );
}

export function SettingsPage({ apiBase }: { apiBase?: string }) {
  const base = apiBase || "http://localhost:3101/api/bulwark-admin";
  const { data, loading } = useFetch<SettingsData>(`${base}/settings`);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const sections = [
    { id: "providers", title: "LLM Providers", desc: "Configure API keys and default models", icon: "M13 10V3L4 14h7v7l9-11h-7z", color: "#635BFF",
      fields: [
        { label: "OpenAI API Key", key: "openai_key", type: "password" as const, placeholder: "sk-..." },
        { label: "Anthropic API Key", key: "anthropic_key", type: "password" as const, placeholder: "sk-ant-..." },
        { label: "Mistral API Key", key: "mistral_key", type: "password" as const, placeholder: "" },
        { label: "Google AI Key", key: "google_key", type: "password" as const, placeholder: "" },
        { label: "Ollama URL", key: "ollama_url", type: "text" as const, placeholder: "http://localhost:11434" },
        { label: "Default Model", key: "default_model", type: "select" as const, options: ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6", "claude-haiku-4-5", "mistral-large-latest", "gemini-2.0-flash"] },
      ]},
    { id: "pii", title: "PII Detection", desc: "Configure personal data detection and handling", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", color: "#DC2626",
      fields: [
        { label: "PII Detection Enabled", key: "pii_on", type: "toggle" as const },
        { label: "Action", key: "pii_action", type: "select" as const, options: ["redact", "block", "warn"] },
        { label: "Detect Emails", key: "pii_email", type: "toggle" as const },
        { label: "Detect Phone Numbers", key: "pii_phone", type: "toggle" as const },
        { label: "Detect Credit Cards", key: "pii_cc", type: "toggle" as const },
        { label: "Detect SSN / National ID", key: "pii_ssn", type: "toggle" as const },
        { label: "Detect IBAN", key: "pii_iban", type: "toggle" as const },
        { label: "Detect VAT Numbers", key: "pii_vat", type: "toggle" as const },
      ]},
    { id: "prompt", title: "Prompt Security", desc: "Injection detection and system prompt hardening", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", color: "#D97706",
      fields: [
        { label: "Prompt Guard Enabled", key: "pg_on", type: "toggle" as const },
        { label: "Action on Injection", key: "pg_action", type: "select" as const, options: ["block", "sanitize", "warn"] },
        { label: "Sensitivity", key: "pg_sens", type: "select" as const, options: ["low", "medium", "high"] },
        { label: "System Prompt Hardening", key: "pg_harden", type: "toggle" as const },
        { label: "Prevent Prompt Extraction", key: "pg_extract", type: "toggle" as const },
        { label: "Enforce GDPR in Prompts", key: "pg_gdpr", type: "toggle" as const },
      ]},
    { id: "ratelimit", title: "Rate Limiting", desc: "Control request frequency per user/team", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", color: "#F59E0B",
      fields: [
        { label: "Rate Limiting Enabled", key: "rl_on", type: "toggle" as const },
        { label: "Max Requests per Window", key: "rl_max", type: "number" as const, placeholder: "100" },
        { label: "Window (seconds)", key: "rl_window", type: "number" as const, placeholder: "60" },
        { label: "Scope", key: "rl_scope", type: "select" as const, options: ["user", "team", "tenant", "ip"] },
      ]},
    { id: "budgets", title: "Budget Controls", desc: "Set monthly token and cost limits", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1", color: "#059669",
      fields: [
        { label: "Budget Enforcement", key: "b_on", type: "toggle" as const },
        { label: "Default User Limit (tokens/month)", key: "b_user", type: "number" as const, placeholder: "500000" },
        { label: "Default Team Limit (tokens/month)", key: "b_team", type: "number" as const, placeholder: "5000000" },
        { label: "On Exceeded", key: "b_action", type: "select" as const, options: ["block", "warn"] },
        { label: "Alert at 70%", key: "b_70", type: "toggle" as const },
        { label: "Alert at 90%", key: "b_90", type: "toggle" as const },
      ]},
    { id: "gdpr", title: "GDPR Compliance", desc: "Data retention, erasure, and privacy controls", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", color: "#2563EB",
      fields: [
        { label: "Data Retention (days, 0=unlimited)", key: "gdpr_ret", type: "number" as const, placeholder: "365" },
        { label: "Hash User IDs in Audit", key: "gdpr_hash", type: "toggle" as const },
        { label: "Metadata-Only Audit", key: "gdpr_meta", type: "toggle" as const },
        { label: "Breach Detection Alerts", key: "gdpr_breach", type: "toggle" as const },
      ]},
    { id: "soc2", title: "SOC 2 Controls", desc: "Anomaly detection, change tracking, monitoring", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4", color: "#7C3AED",
      fields: [
        { label: "Immutable Audit Logs", key: "soc_immutable", type: "toggle" as const },
        { label: "Max Requests/User/Hour", key: "soc_req", type: "number" as const, placeholder: "200" },
        { label: "Max PII Detections/Hour", key: "soc_pii", type: "number" as const, placeholder: "50" },
        { label: "Max Cost/User/Day ($)", key: "soc_cost", type: "number" as const, placeholder: "10" },
        { label: "Change Tracking", key: "soc_changes", type: "toggle" as const },
        { label: "Vendor Reporting", key: "soc_vendor", type: "toggle" as const },
      ]},
  ];

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure gateway behavior, security, and compliance" />

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard label="Policies" value={data.policyCount} color="#635BFF" />
          <StatCard label="KB Sources" value={data.sourceCount} color="#2563EB" />
          <StatCard label="Budgets" value={data.budgetCount} color="#059669" />
          <StatCard label="Tenants" value={data.tenantCount} color="#7C3AED" />
          <StatCard label="Monthly Cost" value={`$${data.monthlyUsage.cost}`} color="#D97706" />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sections.map(section => {
          const isOpen = activeSection === section.id;
          return (
            <div key={section.id} style={{ ...card, padding: 0, overflow: "hidden", transition: "all 200ms" }}>
              <button onClick={() => setActiveSection(isOpen ? null : section.id)} style={{
                width: "100%", padding: "18px 24px", border: "none", background: isOpen ? "#FAFBFC" : "white", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 14, fontFamily: "inherit", textAlign: "left",
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `${section.color}10`, border: `1px solid ${section.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={section.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={section.icon} /></svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0A2540" }}>{section.title}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{section.desc}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 200ms" }}><polyline points="6 9 12 15 18 9" /></svg>
              </button>

              {isOpen && (
                <div style={{ padding: "0 24px 20px", borderTop: "1px solid #F0F1F3" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
                    {section.fields.map(field => (
                      <div key={field.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
                        <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", flexShrink: 0 }}>{field.label}</label>
                        {field.type === "toggle" ? (
                          <ToggleSwitch />
                        ) : field.type === "select" ? (
                          <select style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", minWidth: 200, background: "white", color: "#0A2540" }}>
                            {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : field.type === "password" ? (
                          <input type="password" placeholder={field.placeholder} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "'SF Mono', monospace", minWidth: 260, color: "#0A2540" }} />
                        ) : field.type === "number" ? (
                          <input type="number" placeholder={field.placeholder} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "'SF Mono', monospace", width: 140, textAlign: "right", color: "#0A2540" }} />
                        ) : (
                          <input type="text" placeholder={field.placeholder} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", minWidth: 260, color: "#0A2540" }} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                    <button style={{
                      padding: "9px 20px", borderRadius: 8, border: "none",
                      background: section.color, color: "white", fontSize: 13, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", transition: "opacity 150ms",
                    }} onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")} onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>Save Changes</button>
                    <button style={{
                      padding: "9px 20px", borderRadius: 8, border: "1px solid #E5E7EB",
                      background: "white", color: "#6B7280", fontSize: 13, fontWeight: 500,
                      cursor: "pointer", fontFamily: "inherit",
                    }}>Reset</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
