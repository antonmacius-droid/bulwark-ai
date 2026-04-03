import React, { useState } from "react";
import { PageHeader, Table, Loading, Badge, card, useFetch } from "../components/shared";

interface Source { id: string; name: string; type: string; status: string; chunk_count: number; created_at: string; }
const STATUS: Record<string, { bg: string; color: string }> = { active: { bg: "#ECFDF5", color: "#059669" }, indexing: { bg: "#EFF6FF", color: "#2563EB" }, pending: { bg: "#FFFBEB", color: "#D97706" }, error: { bg: "#FEF2F2", color: "#DC2626" } };

export function KnowledgePage({ apiBase }: { apiBase: string }) {
  const { data, loading, reload } = useFetch<{ sources: Source[] }>(`${apiBase}/knowledge`);
  const [showUpload, setShowUpload] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [name, setName] = useState(""); const [content, setContent] = useState(""); const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(""); const [searchResults, setSearchResults] = useState<{ chunk: { content: string; sourceName: string }; score: number }[]>([]); const [searching, setSearching] = useState(false);

  const upload = async () => { if (!name || !content) return; setUploading(true); await fetch(`${apiBase}/knowledge/ingest`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, content, type: "text" }) }); setName(""); setContent(""); setShowUpload(false); setUploading(false); reload(); };
  const deleteSource = async (id: string) => { await fetch(`${apiBase}/knowledge/${id}`, { method: "DELETE", credentials: "include" }); reload(); };
  const search = async () => { if (!searchQuery) return; setSearching(true); const r = await fetch(`${apiBase}/knowledge/search`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) }); const d = await r.json(); setSearchResults(d.results || []); setSearching(false); };

  return (
    <div>
      <PageHeader title="Knowledge Base" subtitle="Manage document sources for RAG" action={
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setShowSearch(!showSearch); setShowUpload(false); }} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #E5E7EB", background: showSearch ? "#EFF6FF" : "white", color: showSearch ? "#2563EB" : "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Search</button>
          <button onClick={() => { setShowUpload(!showUpload); setShowSearch(false); }} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: showUpload ? "#6B7280" : "#0A2540", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{showUpload ? "Cancel" : "+ Upload"}</button>
        </div>
      } />

      {showSearch && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0A2540", marginBottom: 10 }}>Semantic Search</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Search across all documents..." style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit" }} />
            <button onClick={search} disabled={searching} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#2563EB", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{searching ? "..." : "Search"}</button>
          </div>
          {searchResults.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {searchResults.map((r, i) => (
                <div key={i} style={{ padding: "10px 14px", borderRadius: 8, background: "#F9FAFB", border: "1px solid #F0F1F3" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#635BFF" }}>{r.chunk.sourceName}</span>
                    <span style={{ fontSize: 10, fontFamily: "monospace", color: "#059669" }}>{Math.round(r.score * 100)}%</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{r.chunk.content.slice(0, 200)}{r.chunk.content.length > 200 ? "..." : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showUpload && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0A2540", marginBottom: 10 }}>Upload Document</div>
          <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Document Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. handbook.pdf" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} /></div>
          <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Content</label><textarea value={content} onChange={e => setContent(e.target.value)} rows={6} placeholder="Paste document text..." style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#9CA3AF" }}>{content.length > 0 ? `${content.length} chars` : ""}</span>
            <button onClick={upload} disabled={uploading || !name || !content} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#0A2540", color: "white", fontSize: 13, fontWeight: 600, cursor: uploading ? "wait" : "pointer", fontFamily: "inherit", opacity: !name || !content ? 0.5 : 1 }}>{uploading ? "Ingesting..." : "Ingest"}</button>
          </div>
        </div>
      )}

      <div style={card}>
        {loading ? <Loading /> : !(data?.sources?.length) ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0A2540", marginBottom: 4 }}>No knowledge sources yet</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>Upload documents to build your knowledge base.</div>
          </div>
        ) : (
          <Table headers={["Name", "Type", "Status", "Chunks", "Created", ""]}>
            {data.sources.map(s => { const st = STATUS[s.status] || STATUS.pending; return (
              <tr key={s.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0A2540" }}>{s.name}</td>
                <td style={{ padding: "8px 12px" }}><Badge color="#374151" bg="#F3F4F6">{s.type}</Badge></td>
                <td style={{ padding: "8px 12px" }}><Badge color={st.color} bg={st.bg}>{s.status}</Badge></td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{s.chunk_count}</td>
                <td style={{ padding: "8px 12px", fontSize: 11, color: "#6B7280" }}>{new Date(s.created_at).toLocaleDateString()}</td>
                <td style={{ padding: "8px 12px" }}><button onClick={() => deleteSource(s.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Delete</button></td>
              </tr>
            ); })}
          </Table>
        )}
      </div>
    </div>
  );
}
