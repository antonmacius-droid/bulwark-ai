import React, { useState, useRef, useEffect, useCallback, DragEvent } from 'react';

/* ─── palette ─── */
const C = {
  dark: '#0A2540',
  darkAlt: '#0F172A',
  purple: '#635BFF',
  purpleHover: '#5147E5',
  cyan: '#80E9FF',
  green: '#34D399',
  sidebar: '#0D1B2A',
  sidebarBorder: '#1E3A5F',
  chatBg: '#F8FAFC',
  white: '#FFFFFF',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textDark: '#1E293B',
  textMuted: '#64748B',
  inputBg: '#FFFFFF',
  inputBorder: '#E2E8F0',
  bubble: '#EDE9FE',
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/* ─── types ─── */
type View = 'setup' | 'chat';

interface Source {
  id: string;
  name: string;
  chunks: number;
  createdAt: string;
}

interface Citation {
  source: string;
  score: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  streaming?: boolean;
}

/* ─── shield icon component ─── */
function ShieldIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shieldGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#635BFF" />
          <stop offset="1" stopColor="#80E9FF" />
        </linearGradient>
      </defs>
      <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" fill="url(#shieldGrad)" />
      <path d="M32 12l-16 8v12c0 10.08 6.72 19.52 16 22.4 9.28-2.88 16-12.32 16-22.4V20l-16-8z" fill="#0A2540" />
      <path d="M28 30l-4-4-2 2 6 6 12-12-2-2-10 10z" fill="#80E9FF" />
    </svg>
  );
}

/* ─── spinner ─── */
function Spinner({ size = 18, color = C.purple }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
    </svg>
  );
}

/* ─── typing dots for streaming ─── */
function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', height: 20 }}>
      <style>{`
        @keyframes blink { 0%,80%,100% { opacity:.3 } 40% { opacity:1 } }
      `}</style>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: '50%', background: C.purple,
          animation: `blink 1.4s ${i * 0.2}s infinite both`,
        }} />
      ))}
    </span>
  );
}

/* ─── upload icon ─── */
function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/* ─── send icon ─── */
function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

/* ─── trash icon ─── */
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

/* ─── doc icon ─── */
function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/* ═══════════════════════════ APP ═══════════════════════════ */

export default function App() {
  const [view, setView] = useState<View>('setup');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  // Chat state
  const [sources, setSources] = useState<Source[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [viewTransition, setViewTransition] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Check if already configured
  useEffect(() => {
    fetch('/api/setup')
      .then(r => r.json())
      .then(d => {
        if (d.configured) {
          setView('chat');
          loadSources();
        }
      })
      .catch(() => {});
  }, []);

  const loadSources = async () => {
    try {
      const r = await fetch('/api/sources');
      if (r.ok) {
        const data = await r.json();
        setSources(data.sources || []);
      }
    } catch {}
  };

  /* ─── setup handler ─── */
  const handleSetup = async () => {
    if (!apiKey.trim()) return;
    setConnecting(true);
    setError('');
    try {
      const r = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to connect');
      }
      setViewTransition(true);
      setTimeout(() => {
        setView('chat');
        setViewTransition(false);
      }, 300);
    } catch (e: any) {
      setError(e.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  /* ─── file upload ─── */
  const handleFiles = async (files: FileList | File[]) => {
    setUploading(true);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!['pdf', 'md', 'txt', 'csv', 'html'].includes(ext || '')) continue;

      try {
        const text = await file.text();
        const r = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, content: text }),
        });
        if (r.ok) await loadSources();
      } catch {}
    }
    setUploading(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleDeleteSource = async (id: string) => {
    try {
      await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      setSources(prev => prev.filter(s => s.id !== id));
    } catch {}
  };

  /* ─── chat ─── */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    const assistantMsg: Message = { role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const r = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!r.ok) throw new Error('Chat failed');

      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let citations: Citation[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.token) {
                  fullText += data.token;
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === 'assistant') {
                      updated[updated.length - 1] = { ...last, content: fullText };
                    }
                    return updated;
                  });
                }
                if (data.citations) {
                  citations = data.citations;
                }
                if (data.done) {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last.role === 'assistant') {
                      updated[updated.length - 1] = {
                        ...last,
                        content: fullText || last.content,
                        citations,
                        streaming: false,
                      };
                    }
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      }

      // Finalize if stream ended without done event
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant' && last.streaming) {
          updated[updated.length - 1] = { ...last, streaming: false, citations };
        }
        return updated;
      });
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: 'Sorry, something went wrong. Check your API key and try again.',
            streaming: false,
          };
        }
        return updated;
      });
    } finally {
      setSending(false);
    }
  };

  /* ═════════ RENDER ═════════ */

  /* ─── Setup View ─── */
  if (view === 'setup') {
    return (
      <div style={{
        minHeight: '100vh',
        background: `linear-gradient(145deg, ${C.dark} 0%, ${C.darkAlt} 50%, #131B2E 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        opacity: viewTransition ? 0 : 1,
        transition: 'opacity 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow effects */}
        <div style={{
          position: 'absolute', top: '-20%', left: '-10%',
          width: 600, height: 600, borderRadius: '50%',
          background: `radial-gradient(circle, ${C.purple}10 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: '-20%', right: '-10%',
          width: 500, height: 500, borderRadius: '50%',
          background: `radial-gradient(circle, ${C.cyan}08 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <div style={{
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20,
          padding: '56px 48px',
          width: 440,
          maxWidth: '90vw',
          textAlign: 'center',
          position: 'relative',
          boxShadow: '0 32px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>
          <div style={{ marginBottom: 28 }}>
            <ShieldIcon size={56} />
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            color: C.textPrimary,
            margin: 0,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}>
            Chat with your docs
          </h1>
          <p style={{
            fontSize: 15,
            color: C.textSecondary,
            marginTop: 10,
            lineHeight: 1.6,
          }}>
            Add your OpenAI key, upload documents, ask anything.
          </p>

          <div style={{ marginTop: 32 }}>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSetup()}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  fontSize: 15,
                  fontFamily: 'monospace',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${error ? '#EF4444' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 12,
                  color: C.textPrimary,
                  outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => {
                  e.target.style.borderColor = C.purple;
                  e.target.style.boxShadow = `0 0 0 3px ${C.purple}25`;
                }}
                onBlur={e => {
                  e.target.style.borderColor = error ? '#EF4444' : 'rgba(255,255,255,0.1)';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {error && (
              <p style={{ color: '#EF4444', fontSize: 13, marginTop: 8, textAlign: 'left' }}>{error}</p>
            )}

            <button
              onClick={handleSetup}
              disabled={connecting || !apiKey.trim()}
              style={{
                width: '100%',
                marginTop: 16,
                padding: '14px 24px',
                fontSize: 15,
                fontWeight: 600,
                color: C.white,
                background: connecting || !apiKey.trim()
                  ? 'rgba(99,91,255,0.4)'
                  : `linear-gradient(135deg, ${C.purple}, #7C6BFF)`,
                border: 'none',
                borderRadius: 12,
                cursor: connecting || !apiKey.trim() ? 'not-allowed' : 'pointer',
                fontFamily: FONT,
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: connecting || !apiKey.trim() ? 'none' : `0 4px 16px ${C.purple}40`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
              onMouseEnter={e => {
                if (!connecting && apiKey.trim()) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = `0 6px 20px ${C.purple}50`;
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 4px 16px ${C.purple}40`;
              }}
            >
              {connecting && <Spinner size={16} color="white" />}
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>

          <p style={{
            fontSize: 12,
            color: 'rgba(148,163,184,0.6)',
            marginTop: 28,
            lineHeight: 1.5,
          }}>
            Your key stays on your machine. Self-hosted. Private.
          </p>
        </div>
      </div>
    );
  }

  /* ─── Chat View ─── */
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      fontFamily: FONT,
      overflow: 'hidden',
    }}>
      {/* ── LEFT SIDEBAR ── */}
      <div style={{
        width: 280,
        minWidth: 280,
        background: `linear-gradient(180deg, ${C.sidebar} 0%, #081420 100%)`,
        borderRight: `1px solid ${C.sidebarBorder}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Sidebar header */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: `1px solid ${C.sidebarBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <ShieldIcon size={28} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, letterSpacing: '-0.01em' }}>
              Knowledge Base
            </div>
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 1 }}>
              {sources.length} source{sources.length !== 1 ? 's' : ''} loaded
            </div>
          </div>
        </div>

        {/* Upload area */}
        <div style={{ padding: 16 }}>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? C.purple : C.sidebarBorder}`,
              borderRadius: 12,
              padding: '20px 12px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
              background: dragOver ? `${C.purple}10` : 'transparent',
            }}
            onMouseEnter={e => {
              if (!dragOver) e.currentTarget.style.borderColor = C.textSecondary;
            }}
            onMouseLeave={e => {
              if (!dragOver) e.currentTarget.style.borderColor = C.sidebarBorder;
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.md,.txt,.csv,.html"
              style={{ display: 'none' }}
              onChange={e => e.target.files && handleFiles(e.target.files)}
            />
            {uploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Spinner size={24} color={C.cyan} />
                <span style={{ fontSize: 12, color: C.textSecondary }}>Processing...</span>
              </div>
            ) : (
              <>
                <UploadIcon />
                <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 8, lineHeight: 1.5 }}>
                  Drop files here or <span style={{ color: C.purple, fontWeight: 500 }}>browse</span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.5)', marginTop: 4 }}>
                  .pdf .md .txt .csv .html
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sources list */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 16px',
        }}>
          {sources.map(source => (
            <div key={source.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              marginBottom: 4,
              transition: 'background 0.15s',
              cursor: 'default',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <DocIcon />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: C.textPrimary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {source.name}
                </div>
                <div style={{ fontSize: 11, color: C.textSecondary }}>
                  {source.chunks} chunk{source.chunks !== 1 ? 's' : ''}
                </div>
              </div>
              <button
                onClick={() => handleDeleteSource(source.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.textSecondary,
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.15s, background 0.15s',
                  opacity: 0.5,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = '#EF4444';
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = C.textSecondary;
                  e.currentTarget.style.opacity = '0.5';
                  e.currentTarget.style.background = 'none';
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${C.sidebarBorder}`,
          textAlign: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.4)' }}>
            Powered by{' '}
            <span style={{ color: C.purple, fontWeight: 600 }}>Bulwark AI</span>
          </span>
        </div>
      </div>

      {/* ── RIGHT: CHAT AREA ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: C.chatBg,
        position: 'relative',
      }}>
        {/* Chat header */}
        <div style={{
          padding: '16px 28px',
          borderBottom: `1px solid ${C.inputBorder}`,
          background: C.white,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: C.green,
            boxShadow: `0 0 8px ${C.green}80`,
          }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: C.textDark }}>
            Bulwark KB Chat
          </span>
          <span style={{ fontSize: 12, color: C.textMuted }}>
            {sources.length > 0 ? `${sources.length} source${sources.length !== 1 ? 's' : ''} indexed` : 'No sources yet'}
          </span>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}>
          {messages.length === 0 && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              opacity: 0.5,
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: C.textDark, marginBottom: 4 }}>
                  Upload a document and start asking questions
                </div>
                <div style={{ fontSize: 13, color: C.textMuted }}>
                  Your AI assistant will answer based on your knowledge base
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              animation: 'fadeIn 0.25s ease',
            }}>
              <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }`}</style>
              <div style={{ maxWidth: '72%' }}>
                {/* Avatar + bubble */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: msg.role === 'user'
                      ? `linear-gradient(135deg, ${C.purple}, #7C6BFF)`
                      : `linear-gradient(135deg, ${C.dark}, #1A2D47)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 14,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  }}>
                    {msg.role === 'user' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                      </svg>
                    ) : (
                      <ShieldIcon size={18} />
                    )}
                  </div>

                  {/* Bubble */}
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user'
                      ? `linear-gradient(135deg, ${C.purple}, #7C6BFF)`
                      : C.white,
                    color: msg.role === 'user' ? C.white : C.textDark,
                    fontSize: 14,
                    lineHeight: 1.65,
                    boxShadow: msg.role === 'user'
                      ? `0 4px 12px ${C.purple}30`
                      : '0 2px 8px rgba(0,0,0,0.06)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {msg.content || (msg.streaming ? <TypingDots /> : '')}
                  </div>
                </div>

                {/* Citations */}
                {msg.citations && msg.citations.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginTop: 8,
                    paddingLeft: 42,
                  }}>
                    {msg.citations.map((c, ci) => (
                      <span key={ci} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 10px',
                        borderRadius: 20,
                        background: `${C.purple}0C`,
                        border: `1px solid ${C.purple}20`,
                        fontSize: 11,
                        color: C.purple,
                        fontWeight: 500,
                      }}>
                        <span style={{ opacity: 0.6 }}>[{ci + 1}]</span> {c.source}
                        <span style={{
                          fontSize: 10,
                          color: C.textMuted,
                          marginLeft: 2,
                        }}>
                          ({(c.score * 100).toFixed(0)}%)
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div style={{
          padding: '16px 28px 20px',
          borderTop: `1px solid ${C.inputBorder}`,
          background: C.white,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: C.chatBg,
            border: `1px solid ${C.inputBorder}`,
            borderRadius: 14,
            padding: '6px 6px 6px 18px',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
            onFocus={e => {
              e.currentTarget.style.borderColor = C.purple;
              e.currentTarget.style.boxShadow = `0 0 0 3px ${C.purple}15`;
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = C.inputBorder;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={sources.length > 0 ? 'Ask anything about your documents...' : 'Upload a document first...'}
              disabled={sending}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 14,
                color: C.textDark,
                fontFamily: FONT,
                padding: '8px 0',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: 'none',
                background: !input.trim() || sending
                  ? C.inputBorder
                  : `linear-gradient(135deg, ${C.purple}, #7C6BFF)`,
                cursor: !input.trim() || sending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: input.trim() && !sending ? `0 2px 8px ${C.purple}40` : 'none',
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                if (input.trim() && !sending) e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              {sending ? <Spinner size={16} color="white" /> : <SendIcon />}
            </button>
          </div>
          <div style={{
            textAlign: 'center',
            marginTop: 10,
            fontSize: 11,
            color: 'rgba(100,116,139,0.5)',
          }}>
            Responses are generated from your uploaded documents only
          </div>
        </div>
      </div>
    </div>
  );
}
