import React from "react";
import type { Page } from "../App";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "playground", label: "Playground", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "users", label: "Users & Teams", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { id: "knowledge", label: "Knowledge Base", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { id: "policies", label: "Policies", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { id: "audit", label: "Audit Log", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "costs", label: "Cost Center", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "docs", label: "Documentation", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

const css = `
.bp-sidebar { width: 240px; background: #0A2540; display: flex; flex-direction: column; flex-shrink: 0; }
.bp-logo { padding: 24px 20px 32px; display: flex; align-items: center; gap: 10px; }
.bp-logo-icon { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #635BFF, #80E9FF); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(99,91,255,.3); }
.bp-nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
.bp-nav-btn { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; color: rgba(255,255,255,.45); border: none; background: none; cursor: pointer; text-align: left; width: 100%; transition: all 120ms; font-family: inherit; }
.bp-nav-btn:hover { color: rgba(255,255,255,.75); background: rgba(255,255,255,.05); }
.bp-nav-btn.active { color: white; background: rgba(255,255,255,.1); font-weight: 600; }
.bp-footer { margin-top: auto; padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.06); }
`;

export function Sidebar({ activePage, onNavigate }: { activePage: Page; onNavigate: (p: Page) => void }) {
  return (
    <>
      <style>{css}</style>
      <nav className="bp-sidebar">
        <div className="bp-logo">
          <div className="bp-logo-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "white", letterSpacing: "-0.02em" }}>Bulwark AI</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.3)" }}>Admin Console</div>
          </div>
        </div>

        <div className="bp-nav">
          {NAV.map(item => (
            <button key={item.id} className={`bp-nav-btn ${activePage === item.id ? "active" : ""}`} onClick={() => onNavigate(item.id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
              {item.label}
            </button>
          ))}
        </div>

        <div className="bp-footer">
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.2)" }}>Bulwark AI v0.1.0</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.15)", marginTop: 2 }}>AFKzona Group</div>
        </div>
      </nav>
    </>
  );
}
