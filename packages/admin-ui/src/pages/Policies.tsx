import React, { useState } from "react";
import { PageHeader, Table, Loading, Badge, card, useFetch } from "../components/shared";

interface Policy { id: string; name: string; type: string; action: string; patterns?: string[]; }

export function PoliciesPage({ apiBase }: { apiBase: string }) {
  const { data, loading, reload } = useFetch<{ policies: Policy[] }>(`${apiBase}/policies`);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", type: "keyword_block", action: "block", patterns: "" });

  const createPolicy = async () => {
    if (!form.id || !form.name) return;
    await fetch(`${apiBase}/policies`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, patterns: form.patterns.split(",").map(s => s.trim()).filter(Boolean) }),
    });
    setForm({ id: "", name: "", type: "keyword_block", action: "block", patterns: "" });
    setShowForm(false);
    reload();
  };

  const deletePolicy = async (id: string) => {
    await fetch(`${apiBase}/policies/${id}`, { method: "DELETE", credentials: "include" });
    reload();
  };

  return (
    <div>
      <PageHeader title="Content Policies" subtitle="PII detection, keyword blocking, topic restrictions" action={
        <button onClick={() => setShowForm(!showForm)} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: showForm ? "#6B7280" : "#0A2540", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{showForm ? "Cancel" : "+ New Policy"}</button>
      } />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        {[
          { label: "PII Detection", desc: "Auto-detect and redact personal data", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", color: "#DC2626" },
          { label: "Prompt Guard", desc: "Block jailbreak and override attempts", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", color: "#D97706" },
          { label: "Content Filtering", desc: "Keyword and topic restrictions", icon: "M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z", color: "#635BFF" },
        ].map((c, i) => (
          <div key={i} style={{ ...card, display: "flex", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: `${c.color}10`, border: `1px solid ${c.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={c.icon} /></svg>
            </div>
            <div><div style={{ fontSize: 13, fontWeight: 700, color: "#0A2540" }}>{c.label}</div><div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{c.desc}</div></div>
          </div>
        ))}
      </div>

      {showForm && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0A2540", marginBottom: 14 }}>Create New Policy</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Policy ID", value: form.id, key: "id", placeholder: "e.g. no-secrets" },
              { label: "Name", value: form.name, key: "name", placeholder: "Block secrets" },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>{f.label}</label>
                <input value={f.value} onChange={e => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", background: "white" }}>
                <option value="keyword_block">Keyword Block</option><option value="regex_block">Regex Block</option><option value="topic_restriction">Topic Restriction</option><option value="max_tokens">Max Tokens</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Action</label>
              <select value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", background: "white" }}>
                <option value="block">Block</option><option value="warn">Warn</option>
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Patterns (comma-separated)</label>
              <input value={form.patterns} onChange={e => setForm({ ...form, patterns: e.target.value })} placeholder="password, api_key, secret" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          </div>
          <button onClick={createPolicy} style={{ marginTop: 12, padding: "8px 20px", borderRadius: 8, border: "none", background: "#0A2540", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Create Policy</button>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>Active Policies</div>
        {loading ? <Loading /> : !(data?.policies?.length) ? (
          <div style={{ padding: 32, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No policies configured yet.</div>
        ) : (
          <Table headers={["Name", "Type", "Action", "Patterns", ""]}>
            {data.policies.map(p => (
              <tr key={p.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px" }}><div style={{ fontWeight: 600, color: "#0A2540", fontSize: 13 }}>{p.name}</div><div style={{ fontSize: 10, color: "#9CA3AF" }}>{p.id}</div></td>
                <td style={{ padding: "8px 12px" }}><Badge color="#635BFF" bg="#EFF0FF">{p.type}</Badge></td>
                <td style={{ padding: "8px 12px" }}><Badge color={p.action === "block" ? "#DC2626" : "#D97706"} bg={p.action === "block" ? "#FEF2F2" : "#FFFBEB"}>{p.action}</Badge></td>
                <td style={{ padding: "8px 12px", fontSize: 11, color: "#6B7280" }}>{p.patterns?.join(", ") || "—"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button onClick={() => deletePolicy(p.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
