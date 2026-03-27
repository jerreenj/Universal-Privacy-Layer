import React, { useState, useEffect, useCallback } from "react";
import { API } from "../config/chains";

// ─── Founder Token stored only in sessionStorage — wiped on tab close ─────────
const FT_KEY = "ft";
const getToken = () => sessionStorage.getItem(FT_KEY);
const setToken = (t) => sessionStorage.setItem(FT_KEY, t);
const clearToken = () => sessionStorage.removeItem(FT_KEY);

// ─── API helper ───────────────────────────────────────────────────────────────
async function founderFetch(path) {
  const token = getToken();
  const res = await fetch(`${API}/founder${path}`, {
    headers: { "X-Founder-Token": token },
  });
  if (res.status === 403) { clearToken(); throw new Error("forbidden"); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtWei(wei) {
  const eth = Number(BigInt(wei || 0)) / 1e18;
  if (eth === 0) return "0 ETH";
  if (eth < 0.0001) return `${wei} wei`;
  return `${eth.toFixed(6)} ETH`;
}
function fmtNum(n) { return Number(n || 0).toLocaleString(); }
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function truncate(s, n = 10) {
  if (!s) return "—";
  return s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-6)}` : s;
}

// ─── Gate ─────────────────────────────────────────────────────────────────────
function Gate({ onAuth }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(false);
    try {
      const res = await fetch(`${API}/founder/metrics`, {
        headers: { "X-Founder-Token": val.trim() },
      });
      if (res.ok) { setToken(val.trim()); onAuth(); }
      else setErr(true);
    } catch { setErr(true); }
  };

  return (
    <div style={styles.gateWrap}>
      <form onSubmit={submit} style={styles.gateBox}>
        <div style={styles.gateLock}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <input
          data-testid="founder-token-input"
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Enter founder token"
          style={{ ...styles.gateInput, borderColor: err ? "#ff4444" : "#1e2a3a" }}
          autoFocus
          autoComplete="off"
        />
        {err && <p style={styles.gateErr}>Access denied</p>}
        <button data-testid="founder-login-btn" type="submit" style={styles.gateBtn}>
          Authenticate
        </button>
      </form>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ ...styles.card, borderTop: `2px solid ${accent || "#00ff88"}` }}>
      <p style={styles.cardLabel}>{label}</p>
      <p style={{ ...styles.cardValue, color: accent || "#00ff88" }}>{value}</p>
      {sub && <p style={styles.cardSub}>{sub}</p>}
    </div>
  );
}

// ─── Chain health row ─────────────────────────────────────────────────────────
function ChainRow({ c }) {
  const dot = c.status === "online" ? "#00ff88" : "#ff4444";
  return (
    <div style={styles.chainRow}>
      <span style={{ ...styles.dot, background: dot }} />
      <span style={styles.chainName}>{c.chain}</span>
      <span style={styles.chainBlock}>{c.block ? `#${fmtNum(c.block)}` : "—"}</span>
      <span style={{ color: "#64748b", fontSize: 11 }}>{c.latency_ms != null ? `${c.latency_ms}ms` : c.error || "—"}</span>
    </div>
  );
}

// ─── Activity row ─────────────────────────────────────────────────────────────
function ActivityRow({ type, item }) {
  const configs = {
    tx: { label: "TX", color: "#3b82f6", val: item.tx_type || "transfer", sub: item.chain },
    stealth: { label: "STEALTH", color: "#8b5cf6", val: truncate(item.stealth_address), sub: item.chain },
    trade: { label: "TRADE", color: "#f59e0b", val: `${item.platform} ${item.is_buy ? "BUY" : "SELL"} $${item.size_usd}`, sub: item.chain },
  };
  const cfg = configs[type] || { label: type.toUpperCase(), color: "#64748b", val: "—", sub: "" };
  return (
    <div style={styles.actRow}>
      <span style={{ ...styles.actBadge, background: cfg.color + "22", color: cfg.color }}>{cfg.label}</span>
      <span style={styles.actVal}>{cfg.val}</span>
      <span style={styles.actSub}>{cfg.sub}</span>
      <span style={styles.actDate}>{fmtDate(item.created_at)}</span>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard({ onLogout }) {
  const [metrics, setMetrics] = useState(null);
  const [chains, setChains] = useState(null);
  const [activity, setActivity] = useState(null);
  const [system, setSystem] = useState(null);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, c, a, s] = await Promise.all([
        founderFetch("/metrics"),
        founderFetch("/chains/health"),
        founderFetch("/activity"),
        founderFetch("/system"),
      ]);
      setMetrics(m);
      setChains(c);
      setActivity(a);
      setSystem(s);
      setLastRefresh(new Date());
    } catch (e) {
      if (e.message === "forbidden") onLogout();
      else setError("Failed to load data. Check backend.");
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);
  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !metrics) return <div style={styles.loadWrap}>Loading founder data…</div>;
  if (error) return <div style={styles.loadWrap} data-testid="founder-error">{error}</div>;

  const tabs = ["overview", "chains", "activity", "system"];

  const allActivity = activity ? [
    ...(activity.transactions || []).map(i => ({ type: "tx", item: i, date: i.created_at })),
    ...(activity.stealth_addresses || []).map(i => ({ type: "stealth", item: i, date: i.created_at })),
    ...(activity.defi_trades || []).map(i => ({ type: "trade", item: i, date: i.created_at })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 40) : [];

  return (
    <div style={styles.dash} data-testid="founder-dashboard">
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerDot} />
          <span style={styles.headerTitle}>Founder Mode</span>
          <span style={styles.headerBadge}>PRIVATE</span>
        </div>
        <div style={styles.headerRight}>
          {lastRefresh && (
            <span style={styles.refreshLabel}>
              Last sync {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button onClick={load} style={styles.refreshBtn} data-testid="founder-refresh-btn">
            Refresh
          </button>
          <button onClick={onLogout} style={styles.logoutBtn} data-testid="founder-logout-btn">
            Lock
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {tabs.map(t => (
          <button
            key={t}
            data-testid={`founder-tab-${t}`}
            onClick={() => setTab(t)}
            style={{ ...styles.tabBtn, ...(tab === t ? styles.tabActive : {}) }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && metrics && (
        <div>
          <div style={styles.grid4}>
            <StatCard label="Total Transactions" value={fmtNum(metrics.transactions.total)} sub={`${fmtNum(metrics.transactions.completed)} completed`} accent="#3b82f6" />
            <StatCard label="Total Volume" value={fmtWei(metrics.transactions.total_volume_wei)} sub="on-chain recorded" accent="#00ff88" />
            <StatCard label="Stealth Addresses" value={fmtNum(metrics.stealth.total_generated)} sub={`${fmtNum(metrics.stealth.used)} used`} accent="#8b5cf6" />
            <StatCard label="Wallets Created" value={fmtNum(metrics.wallets.standard + metrics.wallets.privacy + metrics.wallets.multisig)} sub={`${fmtNum(metrics.wallets.multisig)} multisig`} accent="#f59e0b" />
          </div>
          <div style={styles.grid4}>
            <StatCard label="DeFi Trades" value={fmtNum(metrics.defi.total_trades)} sub="across all platforms" accent="#ef4444" />
            <StatCard label="Encrypted Messages" value={fmtNum(metrics.messaging.total)} sub={`${fmtNum(metrics.messaging.unread)} unread`} accent="#06b6d4" />
            <StatCard label="ZKP Proofs" value={fmtNum(metrics.zkp.total_proofs)} sub={`${fmtNum(metrics.zkp.verified)} verified`} accent="#10b981" />
            <StatCard label="Cross-Chain Splits" value={fmtNum(metrics.splits)} sub="executed" accent="#f97316" />
          </div>

          {/* Per-chain breakdown */}
          <div style={styles.section}>
            <p style={styles.sectionTitle}>Transaction Volume by Chain</p>
            <div style={styles.chainGrid}>
              {Object.entries(metrics.transactions.by_chain || {}).map(([chain, data]) => (
                <div key={chain} style={styles.chainStatCard}>
                  <p style={styles.chainStatName}>{chain}</p>
                  <p style={styles.chainStatVal}>{fmtNum(data.txs)} txs</p>
                  <p style={styles.chainStatSub}>{fmtWei(data.volume_wei)}</p>
                </div>
              ))}
              {Object.keys(metrics.transactions.by_chain || {}).length === 0 && (
                <p style={styles.empty}>No on-chain transactions recorded yet</p>
              )}
            </div>
          </div>

          {/* DeFi platform breakdown */}
          {Object.keys(metrics.defi.by_platform || {}).length > 0 && (
            <div style={styles.section}>
              <p style={styles.sectionTitle}>DeFi Platform Breakdown</p>
              <div style={styles.chainGrid}>
                {Object.entries(metrics.defi.by_platform).map(([platform, data]) => (
                  <div key={platform} style={styles.chainStatCard}>
                    <p style={styles.chainStatName}>{platform}</p>
                    <p style={styles.chainStatVal}>{fmtNum(data.count)} trades</p>
                    <p style={styles.chainStatSub}>${Number(data.volume_usd || 0).toLocaleString()} vol</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Errors */}
          {metrics.errors_24h > 0 && (
            <div style={{ ...styles.section, borderLeft: "3px solid #ef4444" }}>
              <p style={{ color: "#ef4444", fontWeight: 600 }}>
                {metrics.errors_24h} error{metrics.errors_24h !== 1 ? "s" : ""} in the last 24h — check system tab
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── CHAINS ── */}
      {tab === "chains" && chains && (
        <div style={styles.section}>
          <div style={styles.chainHeader}>
            <p style={styles.sectionTitle}>Chain Health — Live RPC Status</p>
            <span style={{ color: "#00ff88", fontSize: 13 }}>{chains.online}/{chains.total} online</span>
          </div>
          <div style={styles.chainList}>
            {chains.chains.map(c => <ChainRow key={c.chain} c={c} />)}
          </div>
          <p style={styles.chainTs}>Checked at {fmtDate(chains.timestamp)}</p>
        </div>
      )}

      {/* ── ACTIVITY ── */}
      {tab === "activity" && (
        <div style={styles.section}>
          <p style={styles.sectionTitle}>Recent Activity (Live)</p>
          {allActivity.length === 0 ? (
            <p style={styles.empty}>No activity recorded yet</p>
          ) : (
            <div style={styles.actList}>
              {allActivity.map((a, i) => (
                <ActivityRow key={i} type={a.type} item={a.item} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM ── */}
      {tab === "system" && system && (
        <div style={styles.section}>
          <div style={styles.grid4}>
            <StatCard label="Backend" value={system.backend.toUpperCase()} accent="#00ff88" />
            <StatCard label="Active Sessions" value={fmtNum(system.active_sessions)} sub="user sessions" accent="#3b82f6" />
            <StatCard label="Contracts Deployed" value={system.contracts_deployed ? "YES" : "NO"} sub={system.contracts_deployed ? "On-chain" : "Pending funding"} accent={system.contracts_deployed ? "#00ff88" : "#ef4444"} />
            <StatCard label="Database" value={system.database.status.toUpperCase()} sub={system.database.name} accent="#10b981" />
          </div>

          <div style={styles.section}>
            <p style={styles.sectionTitle}>Deployer Wallet</p>
            <div style={styles.walletBox}>
              <span style={styles.walletAddr}>{system.deployer_wallet}</span>
              <span style={{ color: "#ef4444", fontSize: 12 }}>No gas funds — contracts pending</span>
            </div>
          </div>

          <div style={styles.section}>
            <p style={styles.sectionTitle}>Database Collections</p>
            <div style={styles.dbGrid}>
              {Object.entries(system.database.collections).map(([col, count]) => (
                <div key={col} style={styles.dbRow}>
                  <span style={styles.dbCol}>{col}</span>
                  <span style={styles.dbCount}>{fmtNum(count)}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.section}>
            <p style={styles.sectionTitle}>Python</p>
            <p style={{ color: "#64748b", fontSize: 12, fontFamily: "monospace" }}>{system.python_version}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────
export default function FounderMode() {
  const [authed, setAuthed] = useState(!!getToken());

  const handleLogout = () => { clearToken(); setAuthed(false); };

  // Block referrer leakage
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  if (!authed) return <Gate onAuth={() => setAuthed(true)} />;
  return <Dashboard onLogout={handleLogout} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  gateWrap: { minHeight: "100vh", background: "#020812", display: "flex", alignItems: "center", justifyContent: "center" },
  gateBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 40, background: "#0a1628", border: "1px solid #1e2a3a", borderRadius: 12, width: 320 },
  gateLock: { marginBottom: 8 },
  gateInput: { width: "100%", padding: "10px 14px", background: "#020812", border: "1px solid #1e2a3a", borderRadius: 8, color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" },
  gateErr: { color: "#ef4444", fontSize: 12, margin: 0 },
  gateBtn: { width: "100%", padding: "10px 0", background: "#00ff88", color: "#020812", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" },
  loadWrap: { minHeight: "100vh", background: "#020812", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 },
  dash: { minHeight: "100vh", background: "#020812", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif", padding: "0 0 60px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 32px", borderBottom: "1px solid #1e2a3a", background: "#0a1628" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerDot: { width: 8, height: 8, background: "#00ff88", borderRadius: "50%", boxShadow: "0 0 8px #00ff88" },
  headerTitle: { fontSize: 16, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.05em" },
  headerBadge: { fontSize: 10, fontWeight: 700, color: "#00ff88", background: "#00ff8820", padding: "2px 8px", borderRadius: 4, letterSpacing: "0.1em" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  refreshLabel: { fontSize: 11, color: "#64748b" },
  refreshBtn: { padding: "6px 14px", background: "#1e2a3a", color: "#e2e8f0", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" },
  logoutBtn: { padding: "6px 14px", background: "#ef444420", color: "#ef4444", border: "1px solid #ef444440", borderRadius: 6, fontSize: 12, cursor: "pointer" },
  tabBar: { display: "flex", gap: 4, padding: "16px 32px", borderBottom: "1px solid #1e2a3a" },
  tabBtn: { padding: "6px 18px", background: "transparent", color: "#64748b", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer", fontWeight: 500 },
  tabActive: { background: "#1e2a3a", color: "#e2e8f0" },
  grid4: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, padding: "24px 32px 0" },
  card: { background: "#0a1628", border: "1px solid #1e2a3a", borderRadius: 10, padding: "18px 20px" },
  cardLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" },
  cardValue: { fontSize: 26, fontWeight: 700, margin: "0 0 4px", fontVariantNumeric: "tabular-nums" },
  cardSub: { fontSize: 12, color: "#64748b", margin: 0 },
  section: { margin: "24px 32px 0", background: "#0a1628", border: "1px solid #1e2a3a", borderRadius: 10, padding: "20px 24px" },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 16px" },
  chainGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 },
  chainStatCard: { background: "#020812", borderRadius: 8, padding: "12px 14px", border: "1px solid #1e2a3a" },
  chainStatName: { fontSize: 11, color: "#64748b", textTransform: "uppercase", margin: "0 0 4px" },
  chainStatVal: { fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: "0 0 2px" },
  chainStatSub: { fontSize: 11, color: "#64748b", margin: 0 },
  chainHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  chainList: { display: "flex", flexDirection: "column", gap: 8 },
  chainRow: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#020812", borderRadius: 8, border: "1px solid #1e2a3a" },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  chainName: { fontSize: 13, fontWeight: 600, color: "#e2e8f0", flex: "0 0 100px", textTransform: "capitalize" },
  chainBlock: { fontSize: 12, color: "#00ff88", fontFamily: "monospace", flex: 1 },
  chainTs: { fontSize: 11, color: "#64748b", marginTop: 12 },
  actList: { display: "flex", flexDirection: "column", gap: 6 },
  actRow: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#020812", borderRadius: 8, border: "1px solid #1e2a3a" },
  actBadge: { fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, letterSpacing: "0.05em", flexShrink: 0 },
  actVal: { fontSize: 13, color: "#e2e8f0", flex: 1, fontFamily: "monospace" },
  actSub: { fontSize: 11, color: "#64748b", flex: "0 0 80px" },
  actDate: { fontSize: 11, color: "#64748b", flexShrink: 0 },
  empty: { color: "#64748b", fontSize: 13, padding: "20px 0", textAlign: "center" },
  walletBox: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", background: "#020812", borderRadius: 8, border: "1px solid #1e2a3a" },
  walletAddr: { fontSize: 12, fontFamily: "monospace", color: "#94a3b8", wordBreak: "break-all" },
  dbGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 },
  dbRow: { display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#020812", borderRadius: 6, border: "1px solid #1e2a3a" },
  dbCol: { fontSize: 12, color: "#64748b" },
  dbCount: { fontSize: 12, fontWeight: 700, color: "#e2e8f0" },
};
