import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Eye, EyeOff, RefreshCw, Zap, Fingerprint, Globe, Layers, Lock,
  History, Key, Image, FileCode, TrendingUp, MessageSquare, Users,
  Search, FileText, BookOpen, Hash, Send, ScanLine, Receipt, ChevronDown
} from "lucide-react";
import { CHAINS, LIVE_COUNT } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { BackButton } from "@/components/common/BackButton";
import { FeatureErrorBoundary } from "@/components/common/FeatureErrorBoundary";
import { Navbar } from "@/components/layout/Navbar";
import { Landing } from "@/components/layout/Landing";

/* Lazy-loaded feature components – each becomes a separate JS chunk.
 * IMPORTANT: every feature file uses NAMED exports (export function Foo),
 * NOT default exports. React.lazy() requires a default export, so every
 * import MUST use `.then(m => ({ default: m.Foo }))` to convert the named
 * export to a default. Without this, lazy() gets `undefined` and React
 * throws error #306 — which was the cause of EVERY blank feature page.
 */
const StealthContent          = lazy(() => import("@/components/features/StealthContent").then(m => ({ default: m.StealthContent })));
const SendContent               = lazy(() => import("@/components/features/SendContent").then(m => ({ default: m.SendContent })));
const SwapContent               = lazy(() => import("@/components/features/SwapContent").then(m => ({ default: m.SwapContent })));
// SwapSVM = the multi-DEX picker (Uniswap V3 + Aerodrome V2). Mounted
// only on the PrivateDeFi 'All in One Swap' tile so the customer who
// wants to compare DEXes lands here. The Core Actions 'Private Swap'
// tile uses SwapContent instead — the simpler single-DEX form that
// calls the Aerodrome wrapper directly with no picker. Keeping these
// two paths visibly distinct is the rule the customer asked for:
// Core = native single-DEX swap, PrivateDeFi = third-party picker.
const HyperliquidPrivateTrading = lazy(() => import("@/components/features/HyperliquidPrivateTrading").then(m => ({ default: m.HyperliquidPrivateTrading })));
const PolymarketPrivateBetting  = lazy(() => import("@/components/features/PolymarketPrivateBetting").then(m => ({ default: m.PolymarketPrivateBetting })));
const HiddenBalanceDashboard    = lazy(() => import("@/components/features/HiddenBalanceDashboard").then(m => ({ default: m.HiddenBalanceDashboard })));
const TransactionHistory        = lazy(() => import("@/components/features/TransactionHistory").then(m => ({ default: m.TransactionHistory })));
const DualSeedSetup             = lazy(() => import("@/components/features/DualSeedSetup").then(m => ({ default: m.DualSeedSetup })));
const NFTPrivacy                = lazy(() => import("@/components/features/NFTPrivacy").then(m => ({ default: m.NFTPrivacy })));
const TokenApprovalPrivacy      = lazy(() => import("@/components/features/TokenApprovalPrivacy").then(m => ({ default: m.TokenApprovalPrivacy })));
const ContractPrivacy           = lazy(() => import("@/components/features/ContractPrivacy").then(m => ({ default: m.ContractPrivacy })));
const ZKPProofs                 = lazy(() => import("@/components/features/ZKPProofs").then(m => ({ default: m.ZKPProofs })));
const OnChainRelayer            = lazy(() => import("@/components/features/OnChainRelayer").then(m => ({ default: m.OnChainRelayer })));
const CrossChainSplit           = lazy(() => import("@/components/features/CrossChainSplit").then(m => ({ default: m.CrossChainSplit })));
const EncryptedMessaging        = lazy(() => import("@/components/features/EncryptedMessaging").then(m => ({ default: m.EncryptedMessaging })));
const MultisigPrivacy           = lazy(() => import("@/components/features/MultisigPrivacy").then(m => ({ default: m.MultisigPrivacy })));
const DeveloperAPI              = lazy(() => import("@/pages/DeveloperAPI").then(m => ({ default: m.DeveloperAPI })));
const WalletPrivacyAnalyzer     = lazy(() => import("@/components/features/WalletPrivacyAnalyzer").then(m => ({ default: m.WalletPrivacyAnalyzer })));
const EncryptedReceipts         = lazy(() => import("@/components/features/EncryptedReceipts").then(m => ({ default: m.EncryptedReceipts })));
const PrivacyAddressBook        = lazy(() => import("@/components/features/PrivacyAddressBook").then(m => ({ default: m.PrivacyAddressBook })));
const ZKCommitments             = lazy(() => import("@/components/features/ZKCommitments").then(m => ({ default: m.ZKCommitments })));
const StealthSendSVM            = lazy(() => import("@/components/features/StealthSendSVM").then(m => ({ default: m.StealthSendSVM })));
const ScannerSVM                = lazy(() => import("@/components/features/ScannerSVM").then(m => ({ default: m.ScannerSVM })));
const SwapSVM                    = lazy(() => import("@/components/features/SwapSVM").then(m => ({ default: m.SwapSVM })));

/* Page metadata – references the lazy Component *type*, not a rendered element. The `key` field is passed to ChunkErrorBoundary so it can show what failed.
 *
 * The six Sui/Solana chain-specific buttons were merged into THREE generic
 * panels (Stealth Send / Scanner / Receipts) that ship a Sui↔Solana toggle
 * INSIDE the feature. Per the design rule: no chain identity on the
 * Dashboard home, just feature names.
 */
const pages = {
  receive:     { title: "Private Receive",             Component: StealthContent,             key: "receive" },
  send:        { title: "Private Send",                Component: SendContent,                key: "send" },
  // 'Private Swap' tile in Core Actions mounts the **native in-house**
  // swap UI (SwapContent). ETH in, USDC out, paid to a stealth
  // recipient through NativePrivateSwap vault — owned by us, no
  // third-party router, no picker. Visually + behaviourally distinct
  // from the PrivateDeFi 'All in One Swap' tile (the third-party
  // picker that routes through the Aerodrome / Uniswap wrappers).
  swap:        { title: "Private Swap",                Component: SwapContent,                key: "swap" },
  // 'All in One Swap' tile (PrivateDeFi section) is the third-party
  // multi-DEX picker. Customer opens the picker, picks Uniswap V3 or
  // Aerodrome V2, and goes through the wrapper for that DEX.
  allswap:     { title: "All in One Swap",             Component: SwapSVM,                    key: "all-swap" },
  hyperliquid: { title: "Hyperliquid Private Trading", Component: HyperliquidPrivateTrading,  key: "hyperliquid" },
  polymarket:  { title: "Polymarket Private Betting",  Component: PolymarketPrivateBetting,   key: "polymarket" },
  balance:     { title: "Hidden Balance",              Component: HiddenBalanceDashboard,  key: "balance" },
  history:     { title: "Transaction History",         Component: TransactionHistory,      key: "history" },
  wallet:      { title: "Dual Seed Setup",             Component: DualSeedSetup,           key: "wallet" },
  nft:         { title: "NFT Privacy",                 Component: NFTPrivacy,              key: "nft" },
  approval:    { title: "Token Approval Privacy",      Component: TokenApprovalPrivacy,    key: "approval" },
  contract:    { title: "Contract Privacy",            Component: ContractPrivacy,         key: "contract" },
  zkp:         { title: "ZKP Proofs",                  Component: ZKPProofs,               key: "zkp" },
  relayer:     { title: "On-Chain Relayer",            Component: OnChainRelayer,          key: "relayer" },
  split:       { title: "Cross-Chain Split",           Component: CrossChainSplit,         key: "split" },
  messaging:   { title: "Encrypted Messaging",         Component: EncryptedMessaging,      key: "messaging" },
  multisig:    { title: "Multisig Privacy",            Component: MultisigPrivacy,         key: "multisig" },
  developer:   { title: "Developer API",               Component: DeveloperAPI,            key: "developer" },
  analyzer:    { title: "Wallet Privacy Analyzer",     Component: WalletPrivacyAnalyzer,   key: "analyzer" },
  receipts:    { title: "Encrypted Receipts",          Component: EncryptedReceipts,       key: "receipts" },
  addressbook: { title: "Privacy Address Book",        Component: PrivacyAddressBook,      key: "addressbook" },
  zkcommit:    { title: "ZK Commitments",              Component: ZKCommitments,           key: "zkcommit" },
  svmSend:     { title: "Stealth Send",                Component: StealthSendSVM,          key: "svm-send" },
  svmScan:     { title: "Scanner (All Chains)",     Component: ScannerSVM,         key: "svm-scanner" },
};

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}

export function Dashboard() {
  const { address, balance, usdcBalance, chain, fetchBalance, fetchHiddenBalance, fetchUsdcBalance, hiddenBalance } = useWallet();
  const [page, _setPage] = useState("home");
  const [showBal, setShowBal] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Token picker — which balance is shown as the big "primary" number.
  // Default USDC, persisted per wallet. The other token is always shown
  // below as a clickable subtitle so the customer can switch with one
  // tap. USDC is the promoted default: it's the same on every chain
  // and the only stablecoin most pilots actually transact in.
  const [focusedToken, setFocusedToken] = useState("usdc"); // "usdc" | "native"
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef(null);
  // Captured scroll position at the moment the user leaves the dashboard
  // home view (clicking a tile OR hitting browser back). React state
  // survives both the click-bound setPage and the popstate-bound fromHash,
  // so this is a more reliable handoff than sessionStorage alone (which
  // can race with the browser's own scroll restoration).
  const [savedScrollY, setSavedScrollY] = useState(0);

  // Defensive: if chain is somehow undefined or not in CHAINS, fall back
  // to "base" so CHAINS[safeChain] never throws "Cannot read properties of
  // undefined". This was causing the entire Dashboard to crash-render
  // blank when WalletContext returned an unexpected chain value.
  const safeChain = (chain && CHAINS[chain]) ? chain : "base";

  // Hash-based navigation so the BROWSER back button works.
  // Dashboard is mounted at /<path> for every route (see App.js), so we
  // track sub-page state in window.location.hash and listen on popstate.
  //
  // SCROLL PRESERVATION:
  // We disable the browser's automatic scroll restoration
  // (`history.scrollRestoration = 'manual'`) and manage it ourselves.
  // When LEAVING home, we capture `window.scrollY` synchronously in the
  // click handler (BEFORE React re-renders to the new page and the DOM
  // shrinks, which would clamp the scroll). When RETURNING to home,
  // we restore the captured Y via a requestAnimationFrame so the layout
  // has settled by then. This works for both the in-app "Back to
  // Dashboard" button AND the browser's native back arrow.
  const setPage = (id) => {
    // Capture scroll at click-time, while the dashboard is still in the DOM.
    // We capture into React state (survives re-render) AND sessionStorage
    // (survives a full page reload) so the user never lands at scrollY=0.
    if (page === "home" && id !== "home") {
      const y = window.scrollY;
      setSavedScrollY(y);
      try { sessionStorage.setItem("upl-dashboard-scroll", String(y)); } catch {}
    }
    _setPage(id);
    try {
      const next = id === "home" ? "/" : `#/${id}`;
      if (window.location.hash !== next) {
        window.history.pushState(null, "", next);
      }
    } catch {}
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // ALWAYS start on USDC. We deliberately do NOT read a stale
    // localStorage preference — the pilot asked for USDC primary by
    // default every time they connect. If they explicitly pick ETH
    // via the dropdown during the session, that's saved for THIS
    // session only via the click handlers below — and the next
    // account they connect starts fresh on USDC.
    if (address) setFocusedToken("usdc");
  }, [address]);

  // Close the token-picker dropdown on outside click so it doesn't
  // stay open over the rest of the dashboard. Native pattern — works
  // without pulling in @radix-ui for a single 2-item menu.
  useEffect(() => {
    if (!tokenMenuOpen) return;
    const onDocClick = (e) => {
      if (tokenMenuRef.current && !tokenMenuRef.current.contains(e.target)) {
        setTokenMenuOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setTokenMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [tokenMenuOpen]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Take over scroll management from the browser.
    if ("scrollRestoration" in history) {
      try { history.scrollRestoration = "manual"; } catch {}
    }

    const fromHash = () => {
      const m = (window.location.hash || "").match(/^#\/([^/]+)/);
      const next = m ? m[1] : "home";
      // Capture scroll when leaving home via the browser back/forward button.
      if (page === "home" && next !== "home") {
        const y = window.scrollY;
        setSavedScrollY(y);
        try { sessionStorage.setItem("upl-dashboard-scroll", String(y)); } catch {}
      }
      _setPage(next);
    };
    fromHash(); // sync on mount
    window.addEventListener("popstate", fromHash);
    return () => window.removeEventListener("popstate", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll-preservation across feature navigation ─────────────────
  // Restore scroll when arriving at the dashboard home. We use
  // useLayoutEffect (runs SYNCHRONOUSLY after the DOM commit but BEFORE
  // the browser paints) — this is the only reliable hook for "I need
  // the new DOM's scroll height to be accurate NOW." Then we re-scroll
  // in a requestAnimationFrame as a belt-and-braces catch for late
  // asynchronous layout shifts (font loading, lazy chunks resolving).
  useLayoutEffect(() => {
    if (page !== "home") return;
    // 1) Restore from React state (the freshest value, captured
    //    synchronously at the click that left home).
    let targetY = savedScrollY || 0;
    // 2) Fall back to sessionStorage if state is empty (e.g. user
    //    hit browser back from outside the app).
    if (targetY === 0) {
      try {
        const fromSS = sessionStorage.getItem("upl-dashboard-scroll");
        if (fromSS != null) targetY = parseInt(fromSS, 10) || 0;
      } catch {}
    }
    if (targetY <= 0) return;
    // First-set: right now, in the same frame as the DOM commit.
    try { window.scrollTo(0, targetY); } catch {}
    // Second-set: after the browser has had a chance to finalize
    // font loading + image layout for the dashboard home view.
    requestAnimationFrame(() => {
      try { window.scrollTo(0, targetY); } catch {}
    });
  }, [page, savedScrollY]);

  if (!address) return <Landing />;

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      fetchBalance(),
      fetchUsdcBalance(),
      fetchHiddenBalance(),
    ]);
    setRefreshing(false);
  };

  if (page !== "home" && pages[page]) {
    const { title, Component, key: featureKey } = pages[page];
    return (
      <div className="min-h-screen bg-black pt-16 md:pt-20 px-4 md:px-6">
        <Navbar />
        <div className="max-w-2xl mx-auto py-6 md:py-10">
          <BackButton onClick={() => setPage("home")} />
          <h1 className="text-2xl md:text-3xl font-bold mb-6">{title}</h1>
          <FeatureErrorBoundary>
            <Suspense fallback={<LoadingFallback />}>
              <Component />
            </Suspense>
          </FeatureErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Navbar />
      <div className="pt-20 md:pt-24 pb-12 md:pb-16 px-4 md:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Balance card ---------------------------------------------------------
              Layout: the BIG number is the primary token (USDC by default).
              The chosen-token name sits directly under it with a chevron that
              opens the dropdown — no separate "Balance on Chain" header text
              that distracts from the token. The chain name rides along beside
              the token ("USDC on Base") so the customer knows where the funds
              live without losing focus on the token itself.
          */}
          <div className="bg-white/5 border border-white/10 p-5 md:p-8 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-white/40">
                Wallet balance
              </span>
              <div className="flex gap-1">
                <button onClick={() => setShowBal(!showBal)} className="p-2 hover:bg-white/10" aria-label="Toggle balance visibility">
                  {showBal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={refresh} className="p-2 hover:bg-white/10" aria-label="Refresh balance">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* BIG number — the focused token's exact on-chain amount. */}
            <div className="flex items-end gap-2">
              <span
                data-testid="primary-balance-amount"
                className={`text-4xl md:text-6xl font-bold tracking-tight ${
                  !showBal ? "text-white/0 select-none" : "text-white"
                }`}
                style={!showBal ? {
                  background: "rgba(255,255,255,0.4)",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                } : undefined}
              >
                {(() => {
                  if (!showBal) return "••••••";
                  if (focusedToken === "usdc") {
                    // Loading state: address set, USDC fetch in-flight.
                    if (usdcBalance === null && address) return "…";
                    if (usdcBalance === null) return "—";
                    return usdcBalance.formatted;
                  }
                  // native token
                  if (balance === null) return "…";
                  return balance.formatted;
                })()}
              </span>
            </div>

            {/* Token + chain label with dropdown trigger. */}
            <div className="relative inline-block mt-2" ref={tokenMenuRef}>
              <button
                onClick={() => setTokenMenuOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={tokenMenuOpen}
                data-testid="primary-token-label"
                className="inline-flex items-center gap-1.5 px-2 py-1 text-base md:text-lg font-semibold text-white hover:bg-white/10 transition-colors"
              >
                <span data-testid="primary-token-name">
                  {focusedToken === "usdc" ? "USDC" : (CHAINS[safeChain]?.symbol || "Native")}
                </span>
                <span className="text-white/40 text-sm font-normal" style={{ color: CHAINS[safeChain].color }}>
                  on {CHAINS[safeChain]?.name}
                </span>
                <ChevronDown className={`w-4 h-4 text-white/60 transition-transform ${tokenMenuOpen ? "rotate-180" : ""}`} />
                <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-blue-500/15 border border-blue-400/30 text-blue-300">
                  Primary
                </span>
              </button>

              {tokenMenuOpen && (
                <div
                  role="listbox"
                  className="absolute top-full left-0 mt-2 z-20 bg-black border border-white/20 min-w-[260px] shadow-2xl"
                >
                  {[
                    {
                      key: "usdc",
                      label: "USDC",
                      sub: "Stablecoin — same contract on every supported chain",
                      symbol: "USDC",
                      available: !!usdcBalance && usdcBalance.formatted !== "—",
                    },
                    {
                      key: "native",
                      label: CHAINS[safeChain]?.symbol || "Native",
                      sub: `Chain native token (${CHAINS[safeChain]?.name || "—"})`,
                      symbol: CHAINS[safeChain]?.symbol || "",
                      available: !!balance,
                    },
                  ].map((opt) => {
                    const isFocused = focusedToken === opt.key;
                    return (
                      <button
                          key={opt.key}
                          role="option"
                          aria-selected={isFocused}
                          disabled={!opt.available}
                          onClick={() => {
                            // Session-only preference. Next connect
                            // (new account or page reload) starts on
                            // USDC again — pilot asked for USDC-by-
                            // default every time.
                            setFocusedToken(opt.key);
                            setTokenMenuOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 flex items-center justify-between text-xs hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent border-b border-white/5 last:border-b-0 ${
                            isFocused ? "bg-white/5" : ""
                          }`}
                        >
                          <div>
                            <div className={`font-semibold ${isFocused ? "text-white" : "text-white/80"}`}>
                              {opt.label}
                            </div>
                            <div className="text-[10px] text-white/40">{opt.sub}</div>
                          </div>
                          {isFocused && (
                            <span className="text-[10px] uppercase tracking-wider text-blue-300 ml-3">
                              ★ Primary
                            </span>
                          )}
                        </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Other-token subtitle — clickable to flip primary in one tap. */}
            {(() => {
              const other = focusedToken === "usdc"
                ? (balance ? balance.formatted : null)
                : (usdcBalance ? usdcBalance.formatted : null);
              const otherSymbol = focusedToken === "usdc"
                ? (CHAINS[safeChain]?.symbol || "")
                : "USDC";
              const otherKey = focusedToken === "usdc" ? "native" : "usdc";
              if (other === null) return null;
              return (
                <div className="flex items-center gap-2 text-xs text-white/40 mt-3 pt-3 border-t border-white/10">
                  <span className="text-white/30">+</span>
                  <button
                    onClick={() => setFocusedToken(otherKey)}
                    title={`Switch primary to ${otherSymbol}`}
                    data-testid="alternate-token-chip"
                    className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                  >
                    <span className="font-mono">{other}</span>
                    <span>{otherSymbol}</span>
                    <ChevronDown className="w-3 h-3 text-white/30" />
                  </button>
                  <span className="text-white/20 ml-auto">tap to make this primary</span>
                </div>
              );
            })()}

            {hiddenBalance && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Hidden (Stealth) Balance</span>
                  <span className="text-sm font-mono text-green-400">
                    {parseFloat(hiddenBalance.chains?.[chain]?.stealth_balance || 0).toFixed(6)} {CHAINS[safeChain].symbol}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Core Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {[
              { id: "receive", icon: <Fingerprint className="w-6 h-6 mb-3" />, title: "Private Receive", desc: "Generate stealth address" },
              { id: "send",    icon: <Zap className="w-6 h-6 mb-3" />, title: "Private Send", desc: "Send to any address" },
              { id: "swap",    icon: <RefreshCw className="w-6 h-6 mb-3" />, title: "Private Swap", desc: "Swap with privacy" },
            ].map(({ id, icon, title, desc }) => (
              <button key={id} data-testid={`nav-${id}`} onClick={() => setPage(id)}
                className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all">
                {icon}
                <h3 className="text-base font-semibold mb-1">{title}</h3>
                <p className="text-xs text-gray-500">{desc}</p>
              </button>
            ))}
          </div>

          {/* Private DeFi Integrations */}
          <div className="mb-4">
            <h2 className="text-sm text-white/50 uppercase tracking-wider mb-3">Private DeFi</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {[
              { id: "allswap", icon: <RefreshCw className="w-6 h-6 mb-3 text-blue-400" />, title: "All in One Swap", desc: "Uniswap V3, Aerodrome V2 + more", badge: "LIVE", badgeColor: "text-blue-400 border-blue-400/40" },
              { id: "hyperliquid", icon: <TrendingUp className="w-6 h-6 mb-3 text-green-400" />, title: "Hyperliquid", desc: "Anonymous perp trading", badge: "LIVE", badgeColor: "text-green-400 border-green-400/40" },
              { id: "polymarket", icon: <Globe className="w-6 h-6 mb-3 text-purple-400" />, title: "Polymarket", desc: "Private prediction bets", badge: "LIVE", badgeColor: "text-purple-400 border-purple-400/40" },
            ].map(({ id, icon, title, desc, badge, badgeColor }) => (
              <button key={id} data-testid={`nav-${id}`} onClick={() => setPage(id)}
                className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all relative group">
                <div className={`absolute top-3 right-3 text-[10px] border px-1.5 py-0.5 ${badgeColor}`}>{badge}</div>
                {icon}
                <h3 className="text-base font-semibold mb-1">{title}</h3>
                <p className="text-xs text-gray-500">{desc}</p>
              </button>
            ))}
          </div>

          {/* Advanced Features */}
          <div className="mb-4">
            <h2 className="text-sm text-white/50 uppercase tracking-wider mb-3">Advanced Privacy</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { id: "balance", icon: <TrendingUp className="w-5 h-5" />, title: "Hidden Balance", color: "text-green-400" },
              { id: "history", icon: <History className="w-5 h-5" />, title: "History", color: "text-blue-400" },
              { id: "wallet",  icon: <Key className="w-5 h-5" />, title: "Dual Seed", color: "text-purple-400" },
              { id: "relayer", icon: <Lock className="w-5 h-5" />, title: "On-Chain Relayer", color: "text-orange-400" },
              { id: "receipts", icon: <FileText className="w-5 h-5" />, title: "Receipts", color: "text-sky-400" },
              { id: "split",   icon: <Globe className="w-5 h-5" />, title: "Cross-Chain Split", color: "text-teal-400" },
              { id: "messaging", icon: <MessageSquare className="w-5 h-5" />, title: "Messaging", color: "text-pink-400" },
              { id: "multisig", icon: <Users className="w-5 h-5" />, title: "Multisig", color: "text-amber-400" },
              { id: "analyzer", icon: <Search className="w-5 h-5" />, title: "Privacy Analyzer", color: "text-cyan-400" },
              { id: "addressbook", icon: <BookOpen className="w-5 h-5" />, title: "Address Book", color: "text-violet-400" },
              { id: "svmSend", icon: <Send className="w-5 h-5" />, title: "Stealth Send", color: "text-cyan-400" },
              { id: "svmScan", icon: <ScanLine className="w-5 h-5" />, title: "Scanner", color: "text-cyan-400" },
            ].map(({ id, icon, title, color }) => (
              <button key={id} onClick={() => setPage(id)}
                className="bg-white/5 border border-white/10 p-4 text-left hover:border-white/30 transition-all">
                <div className={`mb-2 ${color}`}>{icon}</div>
                <span className="text-sm font-medium">{title}</span>
              </button>
            ))}
          </div>

          {/* Extra Features */}
          <div className="mb-4">
            <h2 className="text-sm text-white/50 uppercase tracking-wider mb-3">More Tools</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { id: "nft",     icon: <Image className="w-5 h-5" />, title: "NFT Privacy", color: "text-rose-400" },
              { id: "approval",icon: <Lock className="w-5 h-5" />, title: "Approvals", color: "text-yellow-400" },
              { id: "contract",icon: <FileCode className="w-5 h-5" />, title: "Contracts", color: "text-cyan-400" },
              { id: "developer", icon: <FileCode className="w-5 h-5" />, title: "Developer API", color: "text-emerald-400" },
              { id: "zkp",       icon: <Fingerprint className="w-5 h-5" />, title: "ZKP Proofs", color: "text-indigo-400" },
            ].map(({ id, icon, title, color }) => (
              <button key={id} onClick={() => setPage(id)}
                className="bg-white/5 border border-white/10 p-4 text-left hover:border-white/30 transition-all">
                <div className={`mb-2 ${color}`}>{icon}</div>
                <span className="text-sm font-medium">{title}</span>
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="bg-white/5 border border-white/10 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-white/50" />
                <span className="text-sm text-white/70">{LIVE_COUNT} chains live</span>
              </div>
              <span className="text-xs text-white/30">Contracts: 0x0A81...fB5c</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
