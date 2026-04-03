import React, { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/Dashboard";
import { AuditPage } from "./pages/Audit";
import { UsersPage } from "./pages/Users";
import { KnowledgePage } from "./pages/Knowledge";
import { PoliciesPage } from "./pages/Policies";
import { CostCenterPage } from "./pages/CostCenter";
import { PlaygroundPage } from "./pages/Playground";
import { SettingsPage } from "./pages/Settings";
import { DocsPage } from "./pages/Docs";

export type Page = "dashboard" | "playground" | "users" | "knowledge" | "policies" | "audit" | "costs" | "settings" | "docs";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3101/api/bulwark-admin";

export function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F6F9FC" }}>
      <Sidebar activePage={page} onNavigate={setPage} />
      <main style={{ flex: 1, padding: "28px 36px", overflowY: "auto" }}>
        {page === "dashboard" && <DashboardPage apiBase={API_BASE} />}
        {page === "playground" && <PlaygroundPage apiBase={API_BASE} />}
        {page === "users" && <UsersPage apiBase={API_BASE} />}
        {page === "knowledge" && <KnowledgePage apiBase={API_BASE} />}
        {page === "policies" && <PoliciesPage apiBase={API_BASE} />}
        {page === "audit" && <AuditPage apiBase={API_BASE} />}
        {page === "costs" && <CostCenterPage apiBase={API_BASE} />}
        {page === "settings" && <SettingsPage apiBase={API_BASE} />}
          {page === "docs" && <DocsPage />}
      </main>
    </div>
  );
}
