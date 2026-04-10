import React from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { PageHeader, StatCard, Table, Loading, card, label, mono, fmtCost, fmtTokens, useFetch } from "../components/shared";

interface Dashboard {
  requestsToday: number; requestsThisMonth: number;
  costToday: number; costThisMonth: number; activeUsers: number;
  topModels: { model: string; count: number; cost: number }[];
  topUsers: { userId: string; count: number; cost: number }[];
  costByTeam: { teamId: string; cost: number; tokens: number }[];
}

interface GatewayStatus {
  enabled: boolean; activeRequests: number;
  circuitBreaker: Record<string, { state: "closed" | "open" | "half_open"; failures: number }>;
}

const COLORS = ["#635BFF", "#059669", "#D97706", "#2563EB", "#DC2626", "#7C3AED"];
const CB_COLORS: Record<string, string> = { closed: "#059669", open: "#DC2626", half_open: "#D97706" };
const CB_LABELS: Record<string, string> = { closed: "Closed", open: "Open", half_open: "Half Open" };

export function DashboardPage({ apiBase }: { apiBase: string }) {
  const { data, loading } = useFetch<Dashboard>(`${apiBase}/dashboard`);
  const { data: status } = useFetch<GatewayStatus>(`${apiBase}/status`);
  if (loading || !data) return <Loading />;

  const pieData = data.topModels.map(m => ({ name: m.model, value: m.count }));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Real-time overview of your AI gateway" />

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard label="Requests Today" value={data.requestsToday} color="#0A2540" />
        <StatCard label="Requests This Month" value={data.requestsThisMonth} color="#2563EB" />
        <StatCard label="Cost Today" value={fmtCost(data.costToday)} color="#059669" />
        <StatCard label="Cost This Month" value={fmtCost(data.costThisMonth)} color="#D97706" />
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 24 }}>
        {/* Top Users */}
        <div style={card}>
          <div style={{ ...label, marginBottom: 14 }}>Top Users by Cost</div>
          <Table headers={["User", "Requests", "Cost"]}>
            {data.topUsers.slice(0, 8).map(u => (
              <tr key={u.userId} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0A2540" }}>{u.userId}</td>
                <td style={{ padding: "8px 12px", ...mono }}>{u.count}</td>
                <td style={{ padding: "8px 12px", ...mono, color: "#059669" }}>{fmtCost(u.cost)}</td>
              </tr>
            ))}
          </Table>
        </div>

        {/* Model Distribution Pie */}
        <div style={card}>
          <div style={{ ...label, marginBottom: 14 }}>Models</div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value" strokeWidth={0}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {data.topModels.map((m, i) => (
              <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
                <span style={{ fontSize: 11, color: "#374151", flex: 1 }}>{m.model}</span>
                <span style={{ fontSize: 11, ...mono, color: "#6B7280" }}>{m.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gateway Health */}
      {status && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 24 }}>
          <div style={card}>
            <div style={{ ...label, marginBottom: 14 }}>Active Requests</div>
            <div style={{ ...mono, fontSize: 36, fontWeight: 800, color: "#0A2540", letterSpacing: "-0.02em" }}>{status.activeRequests}</div>
          </div>
          <div style={card}>
            <div style={{ ...label, marginBottom: 14 }}>Circuit Breaker States</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(status.circuitBreaker).map(([provider, info]) => (
                <div key={provider} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, background: `${CB_COLORS[info.state]}10`, border: `1px solid ${CB_COLORS[info.state]}30` }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: CB_COLORS[info.state] }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0A2540" }}>{provider}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: CB_COLORS[info.state] }}>{CB_LABELS[info.state]}</span>
                  {info.failures > 0 && <span style={{ fontSize: 11, ...mono, color: "#6B7280" }}>({info.failures} failures)</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Team Costs */}
      {data.costByTeam.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 14 }}>Cost by Team</div>
          <Table headers={["Team", "Tokens", "Cost"]}>
            {data.costByTeam.map(t => (
              <tr key={t.teamId} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0A2540" }}>{t.teamId || "Unassigned"}</td>
                <td style={{ padding: "8px 12px", ...mono }}>{fmtTokens(t.tokens)}</td>
                <td style={{ padding: "8px 12px", ...mono, color: "#059669" }}>{fmtCost(t.cost)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
