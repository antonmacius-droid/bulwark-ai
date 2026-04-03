import React, { useState } from "react";
import { PageHeader, card, mono, fmtCost, Badge } from "../components/shared";

export function PlaygroundPage({ apiBase }: { apiBase: string }) {
  const [model, setModel] = useState("gpt-4o");
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState("test-user");
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setLoading(true); setError(null); setResponse(null);
    try {
      const chatBase = apiBase.replace("/bulwark-admin", "/ai").replace("bulwark-admin", "ai");
      const r = await fetch(`${chatBase}/chat`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ model, messages: [{ role: "user", content: input }] }),
      });
      const data = await r.json();
      if (!r.ok) setError(data.error || `Error ${r.status}`);
      else setResponse(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Network error"); }
    setLoading(false);
  };

  return (
    <div>
      <PageHeader title="Playground" subtitle="Test prompts through the governance pipeline" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Input */}
        <div style={card}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Model</label>
              <select value={model} onChange={e => setModel(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit" }}>
                {["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6", "claude-haiku-4-5", "mistral-large-latest", "gemini-2.0-flash"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>User ID</label>
              <input value={userId} onChange={e => setUserId(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          </div>
          <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Type your prompt..." rows={8}
            style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: 14, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
          <button onClick={send} disabled={loading || !input.trim()} style={{
            marginTop: 10, width: "100%", padding: "10px", borderRadius: 10, border: "none",
            background: loading ? "#6B7280" : "#0A2540", color: "white", fontSize: 13, fontWeight: 600,
            cursor: loading ? "wait" : "pointer", fontFamily: "inherit",
          }}>{loading ? "Processing..." : "Send through gateway"}</button>
        </div>

        {/* Output */}
        <div style={card}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          {response && (
            <div>
              {/* Pipeline results */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {(response.piiDetections as { type: string }[])?.map((d, i) => <Badge key={i} color="#DC2626" bg="#FEF2F2">PII: {d.type}</Badge>)}
                {(response.policyViolations as { policy: string }[])?.map((v, i) => <Badge key={i} color="#D97706" bg="#FFFBEB">Policy: {v.policy}</Badge>)}
                <Badge color="#2563EB" bg="#EFF6FF">{response.model as string}</Badge>
                <Badge color="#059669" bg="#ECFDF5">{fmtCost((response.cost as { total: number })?.total || 0)}</Badge>
                <Badge color="#6B7280" bg="#F3F4F6">{response.durationMs}ms</Badge>
              </div>

              {/* Response text */}
              <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{response.content as string}</div>

              {/* Usage */}
              <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "#F9FAFB", display: "flex", gap: 20 }}>
                <div><span style={{ fontSize: 10, color: "#9CA3AF" }}>Input</span><div style={{ ...mono, fontSize: 13, fontWeight: 700 }}>{(response.usage as { inputTokens: number })?.inputTokens}</div></div>
                <div><span style={{ fontSize: 10, color: "#9CA3AF" }}>Output</span><div style={{ ...mono, fontSize: 13, fontWeight: 700 }}>{(response.usage as { outputTokens: number })?.outputTokens}</div></div>
                <div><span style={{ fontSize: 10, color: "#9CA3AF" }}>Cost</span><div style={{ ...mono, fontSize: 13, fontWeight: 700, color: "#059669" }}>{fmtCost((response.cost as { total: number })?.total || 0)}</div></div>
                <div><span style={{ fontSize: 10, color: "#9CA3AF" }}>Audit ID</span><div style={{ ...mono, fontSize: 11, color: "#6B7280" }}>{(response.auditId as string)?.slice(0, 8)}...</div></div>
              </div>

              {/* Sources */}
              {(response.sources as { source: string; score: number }[])?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>RAG Sources</div>
                  {(response.sources as { source: string; score: number; content: string }[]).map((s, i) => (
                    <div key={i} style={{ padding: "6px 10px", borderRadius: 6, background: "#F9FAFB", marginBottom: 4, fontSize: 12 }}>
                      <strong>[{i + 1}]</strong> {s.source} <span style={{ color: "#9CA3AF" }}>({Math.round(s.score * 100)}%)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!response && !error && (
            <div style={{ padding: 40, textAlign: "center", color: "#D1D5DB", fontSize: 13 }}>Send a prompt to see the governance pipeline in action</div>
          )}
        </div>
      </div>
    </div>
  );
}
