import React, { useState, useEffect, useCallback, useRef } from "react";
import { API } from "../config/chains";

// ── Session storage — wiped on tab close ──────────────────────────────────────
const FS_KEY = "fs"; // stores the founder SESSION token (not the raw admin token)
const getSession = () => sessionStorage.getItem(FS_KEY);
const setSession = (t) => sessionStorage.setItem(FS_KEY, t);
const clearSession = () => sessionStorage.removeItem(FS_KEY);

async function founderFetch(path) {
  const res = await fetch(`${API}/founder${path}`, {
    headers: {
      "Authorization": `Bearer ${getSession()}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 403) { clearSession(); throw new Error("forbidden"); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtWei = (wei) => {
  const n = Number(BigInt(wei || 0));
  if (n === 0) return "0 ETH";
  const eth = n / 1e18;
  return eth < 0.0001 ? `${n} wei` : `${eth.toFixed(6)} ETH`;
};
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtUSD = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const truncAddr = (s) => s ? `${s.slice(0, 8)}…${s.slice(-6)}` : "—";
const timeAgo = (d) => {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ── Gate Screen ────────────────────────────────────────────────────────────────
function Gate({ onAuth }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(false);
    setLoading(true);
    try {
      const res = await fetch(`${API}/founder/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: val.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
        onAuth();
      } else {
        setErr(true);
        setVal("");
      }
    } catch { setErr(true); }
    finally { setLoading(false); }
  };

  return (
    <div style={g.wrap}>
      <div style={g.grid} />
      <form onSubmit={submit} style={g.box}>
        <div style={g.iconWrap}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <p style={g.title}>Founder Access</p>
        <p style={g.sub}>Operator-only. Session clears on tab close.</p>
        <input
          data-testid="founder-token-input"
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Paste access token"
          style={{ ...g.input, borderColor: err ? "#ef4444" : "#1e3a2a" }}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        {err && <p style={g.errMsg}>Access denied — invalid token</p>}
        <button data-testid="founder-login-btn" type="submit" style={g.btn} disabled={loading || !val.trim()}>
          {loading ? "Verifying…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

// ── Stat Tile ──────────────────────────────────────────────────────────────────
function Tile({ label, value, sub, accent = "#00ff88", delta }) {
  return (
    <div style={{ ...s.tile, borderTop: `2px solid ${accent}` }}>
      <p style={s.tileLabel}>{label}</p>
      <p style={{ ...s.tileVal, color: accent }}>{value}</p>
      {sub && <p style={s.tileSub}>{sub}</p>}
      {delta !== undefined && (
        <span style={{ ...s.tileDelta, color: delta >= 0 ? "#00ff88" : "#ef4444" }}>
          {delta >= 0 ? "+" : ""}{delta}% 24h
        </span>
      )}
    </div>
  );
}

// ── Chain Health Row ───────────────────────────────────────────────────────────
function ChainRow({ c }) {
  const online = c.status === "online";
  return (
    <div style={s.chainRow}>
      <span style={{ ...s.statusDot, background: online ? "#00ff88" : "#ef4444", boxShadow: online ? "0 0 6px #00ff88" : "0 0 6px #ef4444" }} />
      <span style={s.chainName}>{c.chain}</span>
      <div style={s.chainBarWrap}>
        <div style={{ ...s.chainBar, width: online ? `${Math.min(100, 100 - (c.latency_ms || 0) / 10)}%` : "0%", background: online ? "#00ff88" : "#ef4444" }} />
      </div>
      <span style={s.chainBlock}>{c.block ? `#${fmtNum(c.block)}` : "—"}</span>
      <span style={{ ...s.chainLatency, color: online ? (c.latency_ms < 300 ? "#00ff88" : "#f59e0b") : "#ef4444" }}>
        {online ? `${c.latency_ms}ms` : "offline"}
      </span>
    </div>
  );
}

// ── Activity Feed Item ─────────────────────────────────────────────────────────
const TYPE_CFG = {
  tx: { label: "TX", color: "#3b82f6" },
  stealth: { label: "STEALTH", color: "#8b5cf6" },
  trade: { label: "TRADE", color: "#f59e0b" },
  message: { label: "MSG", color: "#06b6d4" },
};

function FeedItem({ type, item }) {
  const cfg = TYPE_CFG[type] || { label: type.toUpperCase(), color: "#64748b" };
  const desc = {
    tx: `${item.tx_type || "transfer"} on ${item.chain} — ${truncAddr(item.from_address)}`,
    stealth: `Generated on ${item.chain} — ${truncAddr(item.stealth_address)}`,
    trade: `${item.platform} ${item.is_buy ? "BUY" : "SELL"} ${item.asset || ""} — ${fmtUSD(item.size_usd)}`,
    message: `${truncAddr(item.sender_address)} → ${truncAddr(item.recipient_address)} on ${item.chain}`,
  }[type] || "—";

  return (
    <div style={s.feedRow}>
      <span style={{ ...s.feedBadge, background: cfg.color + "18", color: cfg.color }}>{cfg.label}</span>
      <span style={s.feedDesc}>{desc}</span>
      <span style={s.feedTime}>{timeAgo(item.created_at)}</span>
    </div>
  );
}

// ── Mini Sparkline (SVG) ───────────────────────────────────────────────────────
function Sparkline({ data, color = "#00ff88" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const W = 120, H = 32;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - (v / max) * H}`).join(" ");
  return (
    <svg width={W} height={H} style={{ opacity: 0.7 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────────
function SectionHeader({ title, right }) {
  return (
    <div style={s.secHeader}>
      <p style={s.secTitle}>{title}</p>
      {right && <span style={s.secRight}>{right}</span>}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
function Dashboard({ onLogout }) {
  const [metrics, setMetrics] = useState(null);
  const [chains, setChains] = useState(null);
  const [activity, setActivity] = useState(null);
  const [system, setSystem] = useState(null);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [err, setErr] = useState(null);
  const [pulse, setPulse] = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [m, c, a, sys] = await Promise.all([
        founderFetch("/metrics"),
        founderFetch("/chains/health"),
        founderFetch("/activity"),
        founderFetch("/system"),
      ]);
      setMetrics(m); setChains(c); setActivity(a); setSystem(sys);
      setLastSync(new Date());
      setPulse(true);
      setTimeout(() => setPulse(false), 800);
    } catch (e) {
      if (e.message === "forbidden") onLogout();
      else setErr("Unable to reach backend.");
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    timerRef.current = setInterval(load, 60000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  if (loading) return (
    <div style={s.loadWrap}>
      <div style={s.loadSpinner} />
      <p style={s.loadText}>Connecting to backend…</p>
    </div>
  );
  if (err) return <div style={s.loadWrap}><p style={{ color: "#ef4444" }}>{err}</p></div>;

  // Build merged feed
  const feed = activity ? [
    ...(activity.transactions || []).map(i => ({ type: "tx", item: i, ts: i.created_at })),
    ...(activity.stealth_addresses || []).map(i => ({ type: "stealth", item: i, ts: i.created_at })),
    ...(activity.defi_trades || []).map(i => ({ type: "trade", item: i, ts: i.created_at })),
    ...(activity.messages || []).map(i => ({ type: "message", item: i, ts: i.created_at })),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 50) : [];

  const onlineCount = chains?.chains?.filter(c => c.status === "online").length || 0;

  return (
    <div style={s.root}>
      {/* ── Topbar ── */}
      <header style={s.topbar}>
        <div style={s.topLeft}>
          <div style={{ ...s.liveDot, boxShadow: pulse ? "0 0 12px #00ff88" : "0 0 6px #00ff8888" }} />
          <span style={s.brand}>Founder Mode</span>
          <span style={s.privateBadge}>PRIVATE</span>
          <span style={s.chainsBadge}>{onlineCount}/7 chains live</span>
        </div>
        <div style={s.topRight}>
          <span style={s.syncLabel}>{lastSync ? `Synced ${lastSync.toLocaleTimeString()}` : "Syncing…"}</span>
          <button data-testid="founder-refresh-btn" onClick={load} style={s.ghostBtn}>Refresh</button>
          <button data-testid="founder-logout-btn" onClick={() => { clearSession(); onLogout(); }} style={s.lockBtn}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Lock
          </button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav style={s.nav}>
        {["overview", "chains", "activity", "system"].map(t => (
          <button key={t} data-testid={`founder-tab-${t}`} onClick={() => setTab(t)}
            style={{ ...s.navBtn, ...(tab === t ? s.navActive : {}) }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main style={s.main}>

        {/* ══ OVERVIEW ══ */}
        {tab === "overview" && metrics && (
          <>
            {/* KPI row */}
            <div style={s.tileGrid}>
              <Tile label="Total Transactions" value={fmtNum(metrics.transactions.total)} sub={`${fmtNum(metrics.transactions.completed)} completed · ${fmtNum(metrics.transactions.pending)} pending`} accent="#3b82f6" />
              <Tile label="Volume Routed" value={fmtWei(metrics.transactions.total_volume_wei)} sub="recorded on-chain" accent="#00ff88" />
              <Tile label="Stealth Addresses" value={fmtNum(metrics.stealth.total_generated)} sub={`${fmtNum(metrics.stealth.used)} used · ${fmtNum(metrics.stealth.unused)} available`} accent="#8b5cf6" />
              <Tile label="DeFi Trades" value={fmtNum(metrics.defi.total_trades)} sub="across all platforms" accent="#f59e0b" />
              <Tile label="Total Wallets" value={fmtNum(metrics.wallets.standard + metrics.wallets.privacy + metrics.wallets.multisig)} sub={`${fmtNum(metrics.wallets.multisig)} multisig · ${fmtNum(metrics.wallets.privacy)} privacy`} accent="#06b6d4" />
              <Tile label="ZKP Proofs" value={fmtNum(metrics.zkp.total_proofs)} sub={`${fmtNum(metrics.zkp.verified)} verified`} accent="#10b981" />
              <Tile label="Encrypted Messages" value={fmtNum(metrics.messaging.total)} sub={`${fmtNum(metrics.messaging.unread)} unread`} accent="#f97316" />
              <Tile label="Cross-Chain Splits" value={fmtNum(metrics.splits)} sub="executed" accent="#ec4899" />
            </div>

            {/* Two-col: chain breakdown + platform breakdown */}
            <div style={s.twoCol}>
              <div style={s.panel}>
                <SectionHeader title="Transactions by Chain" />
                {Object.keys(metrics.transactions.by_chain || {}).length === 0
                  ? <p style={s.empty}>No on-chain transactions yet</p>
                  : Object.entries(metrics.transactions.by_chain).map(([chain, data]) => {
                    const pct = metrics.transactions.total > 0 ? Math.round((data.txs / metrics.transactions.total) * 100) : 0;
                    return (
                      <div key={chain} style={s.barRow}>
                        <span style={s.barLabel}>{chain}</span>
                        <div style={s.barTrack}>
                          <div style={{ ...s.barFill, width: `${pct}%` }} />
                        </div>
                        <span style={s.barCount}>{data.txs} tx</span>
                        <span style={s.barVol}>{fmtWei(data.volume_wei)}</span>
                      </div>
                    );
                  })
                }
              </div>

              <div style={s.panel}>
                <SectionHeader title="DeFi Platform Breakdown" />
                {Object.keys(metrics.defi.by_platform || {}).length === 0
                  ? <p style={s.empty}>No DeFi trades yet</p>
                  : Object.entries(metrics.defi.by_platform).map(([platform, data]) => (
                    <div key={platform} style={s.platformRow}>
                      <span style={s.platformName}>{platform}</span>
                      <span style={s.platformTrades}>{fmtNum(data.count)} trades</span>
                      <span style={s.platformVol}>{fmtUSD(data.volume_usd)}</span>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Stealth by chain */}
            <div style={s.panel}>
              <SectionHeader title="Stealth Addresses by Chain" right={`${fmtNum(metrics.stealth.total_generated)} total`} />
              <div style={s.stealthGrid}>
                {Object.keys(metrics.stealth.by_chain || {}).length === 0
                  ? <p style={s.empty}>No stealth addresses generated yet</p>
                  : Object.entries(metrics.stealth.by_chain).map(([chain, count]) => (
                    <div key={chain} style={s.stealthChip}>
                      <p style={s.stealthChipChain}>{chain}</p>
                      <p style={s.stealthChipCount}>{fmtNum(count)}</p>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Live feed preview */}
            <div style={s.panel}>
              <SectionHeader title="Live Activity Feed" right={<button onClick={() => setTab("activity")} style={s.linkBtn}>View all →</button>} />
              {feed.slice(0, 8).length === 0
                ? <p style={s.empty}>No activity yet</p>
                : feed.slice(0, 8).map((f, i) => <FeedItem key={i} type={f.type} item={f.item} />)
              }
            </div>
          </>
        )}

        {/* ══ CHAINS ══ */}
        {tab === "chains" && chains && (
          <div style={s.panel}>
            <SectionHeader
              title="Chain RPC Health — Live"
              right={<span style={{ color: onlineCount === 7 ? "#00ff88" : "#f59e0b" }}>{onlineCount}/7 online</span>}
            />
            <div style={s.chainList}>
              {chains.chains.map(c => <ChainRow key={c.chain} c={c} />)}
            </div>
            <p style={s.panelFooter}>Last checked {fmtDate(chains.timestamp)}</p>
          </div>
        )}

        {/* ══ ACTIVITY ══ */}
        {tab === "activity" && (
          <div style={s.panel}>
            <SectionHeader title="Full Activity Log" right={`${feed.length} events`} />
            {feed.length === 0
              ? <p style={s.empty}>No activity recorded yet</p>
              : feed.map((f, i) => <FeedItem key={i} type={f.type} item={f.item} />)
            }
          </div>
        )}

        {/* ══ SYSTEM ══ */}
        {tab === "system" && system && (
          <>
            <div style={s.tileGrid}>
              <Tile label="Backend Status" value={system.backend.toUpperCase()} accent="#00ff88" />
              <Tile label="Active User Sessions" value={fmtNum(system.active_sessions)} sub="bearer tokens in memory" accent="#3b82f6" />
              <Tile label="Contracts On-Chain" value={system.contracts_deployed ? "DEPLOYED" : "PENDING"} sub={system.contracts_deployed ? "Live on all chains" : "Awaiting wallet funding"} accent={system.contracts_deployed ? "#00ff88" : "#ef4444"} />
              <Tile label="Database" value={system.database.status.toUpperCase()} sub={system.database.name} accent="#10b981" />
            </div>

            <div style={s.twoCol}>
              <div style={s.panel}>
                <SectionHeader title="Deployer Wallet" />
                <div style={s.walletBox}>
                  <span style={s.walletAddr}>{system.deployer_wallet}</span>
                  <span style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>
                    {system.contracts_deployed ? "Funded & active" : "No gas — contracts not yet deployed"}
                  </span>
                </div>
              </div>

              <div style={s.panel}>
                <SectionHeader title="Runtime" />
                <p style={s.monoText}>{system.python_version}</p>
              </div>
            </div>

            <div style={s.panel}>
              <SectionHeader title="Database Collections" right={`${Object.keys(system.database.collections).length} collections`} />
              <div style={s.dbGrid}>
                {Object.entries(system.database.collections)
                  .sort(([, a], [, b]) => b - a)
                  .map(([col, count]) => (
                    <div key={col} style={s.dbRow}>
                      <span style={s.dbCol}>{col}</span>
                      <span style={{ ...s.dbCount, color: count > 0 ? "#00ff88" : "#334155" }}>{fmtNum(count)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────
export default function FounderMode() {
  const [authed, setAuthed] = useState(!!getSession());

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer"; meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  return authed
    ? <Dashboard onLogout={() => setAuthed(false)} />
    : <Gate onAuth={() => setAuthed(true)} />;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const g = {
  wrap: { minHeight: "100vh", background: "#020c14", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" },
  grid: { position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(0,255,136,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.03) 1px, transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" },
  box: { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 36px", background: "#0a1a14", border: "1px solid #1a3a2a", borderRadius: 16, width: 340, zIndex: 1 },
  iconWrap: { width: 52, height: 52, background: "#00ff8810", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" },
  sub: { margin: 0, fontSize: 12, color: "#475569", textAlign: "center" },
  input: { width: "100%", padding: "11px 14px", background: "#020c14", border: "1px solid #1a3a2a", borderRadius: 8, color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "monospace", letterSpacing: "0.05em" },
  errMsg: { color: "#ef4444", fontSize: 12, margin: 0 },
  btn: { width: "100%", padding: "11px 0", background: "#00ff88", color: "#020c14", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer", letterSpacing: "0.03em" },
};

const s = {
  root: { minHeight: "100vh", background: "#020c14", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif" },
  // topbar
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", height: 56, background: "#050f0a", borderBottom: "1px solid #0f2a1a", position: "sticky", top: 0, zIndex: 10 },
  topLeft: { display: "flex", alignItems: "center", gap: 12 },
  liveDot: { width: 8, height: 8, background: "#00ff88", borderRadius: "50%", transition: "box-shadow 0.3s" },
  brand: { fontSize: 14, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.04em" },
  privateBadge: { fontSize: 9, fontWeight: 700, color: "#00ff88", background: "#00ff8815", padding: "2px 7px", borderRadius: 4, letterSpacing: "0.12em", border: "1px solid #00ff8830" },
  chainsBadge: { fontSize: 11, color: "#475569" },
  topRight: { display: "flex", alignItems: "center", gap: 10 },
  syncLabel: { fontSize: 11, color: "#334155" },
  ghostBtn: { padding: "5px 12px", background: "transparent", color: "#64748b", border: "1px solid #1e3a2a", borderRadius: 6, fontSize: 12, cursor: "pointer" },
  lockBtn: { display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "#ef444415", color: "#ef4444", border: "1px solid #ef444430", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 500 },
  // nav
  nav: { display: "flex", gap: 2, padding: "0 28px", background: "#050f0a", borderBottom: "1px solid #0f2a1a" },
  navBtn: { padding: "12px 16px", background: "transparent", color: "#475569", border: "none", borderBottom: "2px solid transparent", fontSize: 13, cursor: "pointer", fontWeight: 500, transition: "color 0.15s" },
  navActive: { color: "#00ff88", borderBottom: "2px solid #00ff88" },
  // main
  main: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1400 },
  // tiles
  tileGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 },
  tile: { background: "#050f0a", border: "1px solid #0f2a1a", borderRadius: 10, padding: "16px 18px" },
  tileLabel: { fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" },
  tileVal: { fontSize: 28, fontWeight: 700, margin: "0 0 4px", fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  tileSub: { fontSize: 11, color: "#334155", margin: 0 },
  tileDelta: { fontSize: 10, fontWeight: 600, marginTop: 4, display: "block" },
  // panel
  panel: { background: "#050f0a", border: "1px solid #0f2a1a", borderRadius: 10, padding: "18px 20px" },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
  secHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  secTitle: { fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 },
  secRight: { fontSize: 12, color: "#334155" },
  linkBtn: { background: "none", border: "none", color: "#00ff88", fontSize: 12, cursor: "pointer", padding: 0 },
  panelFooter: { fontSize: 11, color: "#1e3a2a", marginTop: 12 },
  empty: { color: "#334155", fontSize: 13, padding: "12px 0", textAlign: "center" },
  // bar chart rows
  barRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  barLabel: { fontSize: 12, color: "#64748b", width: 80, flexShrink: 0, textTransform: "capitalize" },
  barTrack: { flex: 1, height: 4, background: "#0f2a1a", borderRadius: 2, overflow: "hidden" },
  barFill: { height: "100%", background: "#00ff88", borderRadius: 2, transition: "width 0.5s ease" },
  barCount: { fontSize: 12, color: "#94a3b8", width: 40, textAlign: "right", flexShrink: 0 },
  barVol: { fontSize: 11, color: "#334155", width: 80, textAlign: "right", flexShrink: 0 },
  // platform
  platformRow: { display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid #0f2a1a" },
  platformName: { fontSize: 13, color: "#94a3b8", flex: 1, textTransform: "capitalize" },
  platformTrades: { fontSize: 13, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" },
  platformVol: { fontSize: 13, color: "#00ff88", fontVariantNumeric: "tabular-nums", width: 90, textAlign: "right" },
  // stealth grid
  stealthGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 },
  stealthChip: { background: "#0a1a14", borderRadius: 8, padding: "10px 12px", border: "1px solid #0f2a1a" },
  stealthChipChain: { fontSize: 10, color: "#475569", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em" },
  stealthChipCount: { fontSize: 22, fontWeight: 700, color: "#8b5cf6", margin: 0 },
  // chain health
  chainList: { display: "flex", flexDirection: "column", gap: 8 },
  chainRow: { display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", background: "#020c14", borderRadius: 8, border: "1px solid #0f2a1a" },
  statusDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  chainName: { fontSize: 13, fontWeight: 600, color: "#94a3b8", width: 90, textTransform: "capitalize", flexShrink: 0 },
  chainBarWrap: { flex: 1, height: 3, background: "#0f2a1a", borderRadius: 2, overflow: "hidden" },
  chainBar: { height: "100%", borderRadius: 2, transition: "width 0.6s ease" },
  chainBlock: { fontSize: 11, color: "#00ff88", fontFamily: "monospace", width: 90, textAlign: "right", flexShrink: 0 },
  chainLatency: { fontSize: 11, fontWeight: 600, width: 60, textAlign: "right", flexShrink: 0 },
  // feed
  feedRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #0f2a1a" },
  feedBadge: { fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.08em", flexShrink: 0 },
  feedDesc: { fontSize: 12, color: "#64748b", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  feedTime: { fontSize: 11, color: "#1e3a2a", flexShrink: 0 },
  // system
  walletBox: { display: "flex", flexDirection: "column", padding: "12px 14px", background: "#020c14", borderRadius: 8, border: "1px solid #0f2a1a" },
  walletAddr: { fontSize: 12, fontFamily: "monospace", color: "#64748b", wordBreak: "break-all" },
  monoText: { fontSize: 11, fontFamily: "monospace", color: "#334155", margin: 0 },
  dbGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 },
  dbRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", background: "#020c14", borderRadius: 6, border: "1px solid #0f2a1a" },
  dbCol: { fontSize: 12, color: "#334155" },
  dbCount: { fontSize: 13, fontWeight: 700 },
  // loading
  loadWrap: { minHeight: "100vh", background: "#020c14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 },
  loadSpinner: { width: 32, height: 32, border: "2px solid #0f2a1a", borderTop: "2px solid #00ff88", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  loadText: { color: "#334155", fontSize: 13 },
};

// Inject spinner keyframes
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}
