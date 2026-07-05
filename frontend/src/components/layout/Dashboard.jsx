import { useEffect, useState, lazy } from "react";
import {
  Eye, EyeOff, RefreshCw, Zap, Fingerprint, Globe, Layers, Lock,
  History, Key, Image, FileCode, TrendingUp, MessageSquare, Users,
  Search, FileText, BookOpen, Hash
} from "lucide-react";
import { CHAINS, LIVE_COUNT } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { BackButton } from "@/components/common/BackButton";
import { SafeSuspense } from "@/components/common/ChunkErrorBoundary";
import { Navbar } from "@/components/layout/Navbar";
import { Landing } from "@/components/layout/Landing";

/* Lazy-loaded feature components – each becomes a separate JS chunk. */
const StealthContent          = lazy(() => import("@/components/features/StealthContent"));
const SendContent               = lazy(() => import("@/components/features/SendContent"));
const SwapContent               = lazy(() => import("@/components/features/SwapContent"));
const UniswapPrivateSwap        = lazy(() => import("@/components/features/UniswapPrivateSwap"));
const HyperliquidPrivateTrading = lazy(() => import("@/components/features/HyperliquidPrivateTrading"));
const PolymarketPrivateBetting  = lazy(() => import("@/components/features/PolymarketPrivateBetting"));
const HiddenBalanceDashboard    = lazy(() => import("@/components/features/HiddenBalanceDashboard"));
const TransactionHistory        = lazy(() => import("@/components/features/TransactionHistory"));
const DualSeedSetup             = lazy(() => import("@/components/features/DualSeedSetup"));
const NFTPrivacy                = lazy(() => import("@/components/features/NFTPrivacy"));
const TokenApprovalPrivacy      = lazy(() => import("@/components/features/TokenApprovalPrivacy"));
const ContractPrivacy           = lazy(() => import("@/components/features/ContractPrivacy"));
const ChainsStatus              = lazy(() => import("@/components/features/ChainsStatus"));
const ZKPProofs                 = lazy(() => import("@/components/features/ZKPProofs"));
const OnChainRelayer            = lazy(() => import("@/components/features/OnChainRelayer"));
const CrossChainSplit           = lazy(() => import("@/components/features/CrossChainSplit"));
const EncryptedMessaging        = lazy(() => import("@/components/features/EncryptedMessaging"));
const MultisigPrivacy           = lazy(() => import("@/components/features/MultisigPrivacy"));
const DeveloperAPI              = lazy(() => import("@/pages/DeveloperAPI"));
const WalletPrivacyAnalyzer     = lazy(() => import("@/components/features/WalletPrivacyAnalyzer"));
const EncryptedReceipts         = lazy(() => import("@/components/features/EncryptedReceipts"));
const PrivacyAddressBook        = lazy(() => import("@/components/features/PrivacyAddressBook"));
const ZKCommitments             = lazy(() => import("@/components/features/ZKCommitments"));

/* Page metadata – references the lazy Component *type*, not a rendered element. The `key` field is passed to ChunkErrorBoundary so it can show what failed.
 *
 * The six Sui/Solana chain-specific buttons (SuiStealthSend/SuiScanner/
 * SuiReceipts + SolStealthSend/SolScanner/SolReceipts) were removed from
 * this map AND from the button grid below. Rationale: chains are selected
 * INSIDE a feature when needed (e.g. cross-chain split, hidden balance),
 * not as separate top-level buttons. The lazy-imported files still exist
 * on disk so any future feature expansion can re-wire them.
 */
const pages = {
  receive:     { title: "Private Receive",             Component: StealthContent,          key: "receive" },
  send:        { title: "Private Send",                Component: SendContent,             key: "send" },
  swap:        { title: "Private Swap",                Component: SwapContent,             key: "swap" },
  uniswap:     { title: "Uniswap V3 Private Swap",     Component: UniswapPrivateSwap,      key: "uniswap" },
  hyperliquid: { title: "Hyperliquid Private Trading", Component: HyperliquidPrivateTrading, key: "hyperliquid" },
  polymarket:  { title: "Polymarket Private Betting",  Component: PolymarketPrivateBetting, key: "polymarket" },
  balance:     { title: "Hidden Balance",              Component: HiddenBalanceDashboard,  key: "balance" },
  history:     { title: "Transaction History",         Component: TransactionHistory,      key: "history" },
  wallet:      { title: "Dual Seed Setup",             Component: DualSeedSetup,           key: "wallet" },
  nft:         { title: "NFT Privacy",                 Component: NFTPrivacy,              key: "nft" },
  approval:    { title: "Token Approval Privacy",      Component: TokenApprovalPrivacy,    key: "approval" },
  contract:    { title: "Contract Privacy",            Component: ContractPrivacy,         key: "contract" },
  chains:      { title: "Chain Status",                Component: ChainsStatus,            key: "chains" },
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
};

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}

export function Dashboard() {
  const { address, balance, chain, fetchBalance, hiddenBalance } = useWallet();
  const [page, _setPage] = useState("home");
  const [showBal, setShowBal] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Hash-based navigation so the BROWSER back button works.
  // Dashboard is mounted at /<path> for every route (see App.js), so we
  // track sub-page state in window.location.hash and listen on popstate.
  const setPage = (id) => {
    _setPage(id);
    try {
      const next = id === "home" ? "/" : `#/${id}`;
      if (window.location.hash !== next) {
        window.history.pushState(null, "", next);
      }
    } catch {}
  };

  useEffect(() => {
    const fromHash = () => {
      const m = (window.location.hash || "").match(/^#\/([^/]+)/);
      _setPage(m ? m[1] : "home");
    };
    fromHash(); // sync on mount
    window.addEventListener("popstate", fromHash);
    return () => window.removeEventListener("popstate", fromHash);
  }, []);

  if (!address) return <Landing />;

  const refresh = async () => {
    setRefreshing(true);
    await fetchBalance();
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
          <SafeSuspense featureName={featureKey} fallback={<LoadingFallback />}>
            <Component />
          </SafeSuspense>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Navbar />
      <div className="pt-20 md:pt-24 pb-12 md:pb-16 px-4 md:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Balance card */}
          <div className="bg-white/5 border border-white/10 p-5 md:p-8 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wider">
                  Balance on <span style={{ color: CHAINS[chain].color }}>{CHAINS[chain].name}</span>
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setShowBal(!showBal)} className="p-2 hover:bg-white/10">
                  {showBal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={refresh} className="p-2 hover:bg-white/10">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl md:text-5xl font-bold">
                {showBal && balance ? balance.formatted : "••••••"}
              </span>
              <span className="text-gray-500 mb-1">{CHAINS[chain].symbol}</span>
            </div>
            {hiddenBalance && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Hidden (Stealth) Balance</span>
                  <span className="text-sm font-mono text-green-400">
                    {parseFloat(hiddenBalance.chains?.[chain]?.stealth_balance || 0).toFixed(6)} {CHAINS[chain].symbol}
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
              { id: "uniswap", icon: <RefreshCw className="w-6 h-6 mb-3 text-blue-400" />, title: "Uniswap V3", desc: "Private token swaps via V3", badge: "LIVE", badgeColor: "text-blue-400 border-blue-400/40" },
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
              { id: "zkp",     icon: <Fingerprint className="w-5 h-5" />, title: "ZKP Proofs", color: "text-indigo-400" },
              { id: "split",   icon: <Globe className="w-5 h-5" />, title: "Cross-Chain Split", color: "text-teal-400" },
              { id: "messaging", icon: <MessageSquare className="w-5 h-5" />, title: "Messaging", color: "text-pink-400" },
              { id: "multisig", icon: <Users className="w-5 h-5" />, title: "Multisig", color: "text-amber-400" },
              { id: "analyzer", icon: <Search className="w-5 h-5" />, title: "Privacy Analyzer", color: "text-cyan-400" },
              { id: "zkcommit", icon: <Hash className="w-5 h-5" />, title: "ZK Commitments", color: "text-lime-400" },
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
              { id: "chains",  icon: <Layers className="w-5 h-5" />, title: "Chains", color: "text-white/50" },
              { id: "developer", icon: <FileCode className="w-5 h-5" />, title: "Developer API", color: "text-emerald-400" },
              { id: "receipts", icon: <FileText className="w-5 h-5" />, title: "Receipts", color: "text-sky-400" },
              { id: "addressbook", icon: <BookOpen className="w-5 h-5" />, title: "Address Book", color: "text-violet-400" },
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
