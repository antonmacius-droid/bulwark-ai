import React, { useState, useEffect, useCallback } from "react";

/* ── Shared styles ── */
export const card = { background: "white", border: "1px solid #E5E7EB", borderRadius: 14, padding: "20px 24px" } as const;
export const label = { fontSize: 10, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase" as const, letterSpacing: ".06em" };
export const mono = { fontFamily: "'SF Mono', 'Fira Code', monospace" };

/* ── Formatters ── */
export const fmtCost = (n: number) => `$${n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
export const fmtTokens = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`;
export const fmtNum = (n: number) => n.toLocaleString();

/* ── Hooks ── */
export function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(url, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

/* ── Components ── */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0A2540", letterSpacing: "-0.02em" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label: l, value, color, subtitle }: { label: string; value: string | number; color?: string; subtitle?: string }) {
  return (
    <div style={card}>
      <div style={label}>{l}</div>
      <div style={{ ...mono, fontSize: 28, fontWeight: 800, color: color || "#0A2540", marginTop: 4, letterSpacing: "-0.02em" }}>
        {typeof value === "number" ? fmtNum(value) : value}
      </div>
      {subtitle && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700, color, background: bg }}>{children}</span>;
}

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: "2px solid #E5E7EB" }}>
          {headers.map((h, i) => <th key={i} style={{ ...label, padding: "8px 12px", textAlign: "left" }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function Loading() {
  return <div style={{ padding: 48, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>Loading...</div>;
}

export function Empty({ message }: { message: string }) {
  return <div style={{ padding: 48, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>{message}</div>;
}
