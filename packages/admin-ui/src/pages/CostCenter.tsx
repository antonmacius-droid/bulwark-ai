import React from "react";
import { PageHeader, StatCard, Table, Loading, card, label, mono, fmtCost, fmtTokens, useFetch } from "../components/shared";

interface Dashboard {
  costToday: number; costThisMonth: number; activeUsers: number;
  topModels: { model: string; count: number; cost: number }[];
  topUsers: { userId: string; count: number; cost: number }[];
  costByTeam: { teamId: string; cost: number; tokens: number }[];
}

export function CostCenterPage({ apiBase }: { apiBase: string }) {
  const { data, loading } = useFetch<Dashboard>(`${apiBase}/dashboard`);
  if (loading || !data) return <Loading />;

  const totalTokens = data.topModels.reduce((s, m) => s + m.count, 0);

  return (
    <div>
      <PageHeader title="Cost Center" subtitle="Track AI spend by model, team, and user" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard label="Cost Today" value={fmtCost(data.costToday)} color="#059669" />
        <StatCard label="Cost This Month" value={fmtCost(data.costThisMonth)} color="#D97706" />
        <StatCard label="Active Users" value={data.activeUsers} color="#2563EB" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div style={card}>
          <div style={{ ...label, marginBottom: 12 }}>Cost by Model</div>
          <Table headers={["Model", "Requests", "Cost", "% of Total"]}>
            {data.topModels.map(m => (
              <tr key={m.model} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>{m.model}</td>
                <td style={{ padding: "8px 12px", ...mono, fontSize: 12 }}>{m.count}</td>
                <td style={{ padding: "8px 12px", ...mono, fontSize: 12, color: "#059669" }}>{fmtCost(m.cost)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: "#E5E7EB", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "#635BFF", borderRadius: 2, width: `${data.costThisMonth > 0 ? Math.round(m.cost / data.costThisMonth * 100) : 0}%` }} />
                    </div>
                    <span style={{ ...mono, fontSize: 10, color: "#6B7280" }}>{data.costThisMonth > 0 ? Math.round(m.cost / data.costThisMonth * 100) : 0}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>

        <div style={card}>
          <div style={{ ...label, marginBottom: 12 }}>Cost by User (Top 10)</div>
          <Table headers={["User", "Requests", "Cost"]}>
            {data.topUsers.slice(0, 10).map(u => (
              <tr key={u.userId} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>{u.userId}</td>
                <td style={{ padding: "8px 12px", ...mono, fontSize: 12 }}>{u.count}</td>
                <td style={{ padding: "8px 12px", ...mono, fontSize: 12, color: "#059669" }}>{fmtCost(u.cost)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      {data.costByTeam.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 12 }}>Cost by Team</div>
          <Table headers={["Team", "Tokens Used", "Cost", "Budget Bar"]}>
            {data.costByTeam.map(t => (
              <tr key={t.teamId} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12 }}>{t.teamId || "Unassigned"}</td>
                <td style={{ padding: "8px 12px", ...mono, fontSize: 12 }}>{fmtTokens(t.tokens)}</td>
                <td style={{ padding: "8px 12px", ...mono, fontSize: 12, color: "#059669" }}>{fmtCost(t.cost)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <div style={{ height: 6, background: "#E5E7EB", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: t.cost > 50 ? "#DC2626" : t.cost > 20 ? "#D97706" : "#059669", borderRadius: 3, width: `${Math.min(100, Math.round(t.cost / (data.costThisMonth || 1) * 100))}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
