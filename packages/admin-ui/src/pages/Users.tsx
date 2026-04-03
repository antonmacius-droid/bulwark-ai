import React, { useState } from "react";
import { PageHeader, Table, Loading, Badge, StatCard, card, mono, fmtCost, fmtTokens, useFetch } from "../components/shared";

interface Budget { id: string; scope_type: string; scope_id: string; monthly_token_limit: number; monthly_cost_limit: number; }
interface Tenant { id: string; name: string; createdAt: string; }

export function UsersPage({ apiBase }: { apiBase: string }) {
  const { data: bd, loading: bl, reload: rlb } = useFetch<{ budgets: Budget[] }>(`${apiBase}/budgets`);
  const { data: td, loading: tl, reload: rlt } = useFetch<{ tenants: Tenant[] }>(`${apiBase}/tenants`);
  const [showBF, setShowBF] = useState(false);
  const [showTF, setShowTF] = useState(false);
  const [bf, setBf] = useState({ scopeType: "user", scopeId: "", monthlyTokenLimit: "500000" });
  const [tn, setTn] = useState("");

  const addBudget = async () => { if (!bf.scopeId) return; await fetch(`${apiBase}/budgets`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...bf, monthlyTokenLimit: Number(bf.monthlyTokenLimit) }) }); setBf({ scopeType: "user", scopeId: "", monthlyTokenLimit: "500000" }); setShowBF(false); rlb(); };
  const delBudget = async (id: string) => { await fetch(`${apiBase}/budgets/${id}`, { method: "DELETE", credentials: "include" }); rlb(); };
  const addTenant = async () => { if (!tn) return; await fetch(`${apiBase}/tenants`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: tn }) }); setTn(""); setShowTF(false); rlt(); };
  const delTenant = async (id: string) => { await fetch(`${apiBase}/tenants/${id}`, { method: "DELETE", credentials: "include" }); rlt(); };

  return (
    <div>
      <PageHeader title="Users & Teams" subtitle="Manage budgets, tenants, and access control" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Budgets" value={bd?.budgets?.length || 0} color="#059669" />
        <StatCard label="Tenants" value={td?.tenants?.length || 0} color="#7C3AED" />
        <StatCard label="Scope Types" value="User / Team" color="#2563EB" />
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0A2540" }}>Token Budgets</div>
          <button onClick={() => setShowBF(!showBF)} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: showBF ? "#6B7280" : "#059669", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{showBF ? "Cancel" : "+ Add"}</button>
        </div>
        {showBF && (
          <div style={{ padding: "12px 14px", borderRadius: 10, background: "#F9FAFB", border: "1px solid #F0F1F3", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>Scope</label><select value={bf.scopeType} onChange={e => setBf({ ...bf, scopeType: e.target.value })} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, background: "white" }}><option value="user">User</option><option value="team">Team</option></select></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>ID</label><input value={bf.scopeId} onChange={e => setBf({ ...bf, scopeId: e.target.value })} placeholder="user-123" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, boxSizing: "border-box" }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 3 }}>Limit/mo</label><input value={bf.monthlyTokenLimit} onChange={e => setBf({ ...bf, monthlyTokenLimit: e.target.value })} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, ...mono, boxSizing: "border-box" }} /></div>
            <button onClick={addBudget} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#059669", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add</button>
          </div>
        )}
        {bl ? <Loading /> : !(bd?.budgets?.length) ? <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>No budgets</div> : (
          <Table headers={["Scope", "ID", "Token Limit", ""]}>
            {bd.budgets.map(b => (
              <tr key={b.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "7px 12px" }}><Badge color="#2563EB" bg="#EFF6FF">{b.scope_type}</Badge></td>
                <td style={{ padding: "7px 12px", fontWeight: 600, fontSize: 12 }}>{b.scope_id}</td>
                <td style={{ padding: "7px 12px", ...mono, fontSize: 12 }}>{fmtTokens(b.monthly_token_limit)}</td>
                <td style={{ padding: "7px 12px" }}><button onClick={() => delBudget(b.id)} style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Del</button></td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0A2540" }}>Tenants</div>
          <button onClick={() => setShowTF(!showTF)} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: showTF ? "#6B7280" : "#7C3AED", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{showTF ? "Cancel" : "+ Add"}</button>
        </div>
        {showTF && (
          <div style={{ padding: "12px 14px", borderRadius: 10, background: "#F9FAFB", border: "1px solid #F0F1F3", marginBottom: 14, display: "flex", gap: 10 }}>
            <input value={tn} onChange={e => setTn(e.target.value)} placeholder="Tenant name" style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12 }} />
            <button onClick={addTenant} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#7C3AED", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Create</button>
          </div>
        )}
        {tl ? <Loading /> : !(td?.tenants?.length) ? <div style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>No tenants</div> : (
          <Table headers={["ID", "Name", "Created", ""]}>
            {td.tenants.map(t => (
              <tr key={t.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "7px 12px", ...mono, fontSize: 11, color: "#6B7280" }}>{t.id}</td>
                <td style={{ padding: "7px 12px", fontWeight: 600, fontSize: 13 }}>{t.name}</td>
                <td style={{ padding: "7px 12px", fontSize: 11, color: "#6B7280" }}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}</td>
                <td style={{ padding: "7px 12px" }}><button onClick={() => delTenant(t.id)} style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Del</button></td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
