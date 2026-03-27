import { useState } from "react";
import {
  Eye, EyeOff, RefreshCw, Zap, Fingerprint, Globe, Layers, Lock,
  History, Key, Image, FileCode, TrendingUp, MessageSquare, Users
} from "lucide-react";
import { CHAINS, LIVE_COUNT } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { BackButton } from "@/components/common/BackButton";
import { Navbar } from "@/components/layout/Navbar";
import { Landing } from "@/components/layout/Landing";
import { StealthContent } from "@/components/features/StealthContent";
import { SendContent } from "@/components/features/SendContent";
import { SwapContent } from "@/components/features/SwapContent";
import { UniswapPrivateSwap } from "@/components/features/UniswapPrivateSwap";
import { HyperliquidPrivateTrading } from "@/components/features/HyperliquidPrivateTrading";
import { PolymarketPrivateBetting } from "@/components/features/PolymarketPrivateBetting";
import { HiddenBalanceDashboard } from "@/components/features/HiddenBalanceDashboard";
import { TransactionHistory } from "@/components/features/TransactionHistory";
import { DualSeedSetup } from "@/components/features/DualSeedSetup";
import { NFTPrivacy } from "@/components/features/NFTPrivacy";
import { TokenApprovalPrivacy } from "@/components/features/TokenApprovalPrivacy";
import { ContractPrivacy } from "@/components/features/ContractPrivacy";
import { ChainsStatus } from "@/components/features/ChainsStatus";
import { ZKPProofs } from "@/components/features/ZKPProofs";
import { OnChainRelayer } from "@/components/features/OnChainRelayer";
import { CrossChainSplit } from "@/components/features/CrossChainSplit";
import { EncryptedMessaging } from "@/components/features/EncryptedMessaging";
import { MultisigPrivacy } from "@/components/features/MultisigPrivacy";
import { DeveloperAPI } from "@/pages/DeveloperAPI";

export function Dashboard() {
  const { address, balance, chain, fetchBalance, hiddenBalance } = useWallet();
  const [page, setPage] = useState("home");
  const [showBal, setShowBal] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  if (!address) return <Landing />;

  const refresh = async () => { setRefreshing(true); await fetchBalance(); setRefreshing(false); };

  const pages = {
    receive: { title: "Private Receive", component: <StealthContent /> },
    send: { title: "Private Send", component: <SendContent /> },
    swap: { title: "Private Swap", component: <SwapContent /> },
    uniswap: { title: "Uniswap V3 Private Swap", component: <UniswapPrivateSwap /> },
    hyperliquid: { title: "Hyperliquid Private Trading", component: <HyperliquidPrivateTrading /> },
    polymarket: { title: "Polymarket Private Betting", component: <PolymarketPrivateBetting /> },
    balance: { title: "Hidden Balance", component: <HiddenBalanceDashboard /> },
    history: { title: "Transaction History", component: <TransactionHistory /> },
    wallet: { title: "Dual Seed Setup", component: <DualSeedSetup /> },
    nft: { title: "NFT Privacy", component: <NFTPrivacy /> },
    approval: { title: "Token Approval Privacy", component: <TokenApprovalPrivacy /> },
    contract: { title: "Contract Privacy", component: <ContractPrivacy /> },
    chains: { title: "Chain Status", component: <ChainsStatus /> },
    zkp: { title: "ZKP Proofs", component: <ZKPProofs /> },
    relayer: { title: "On-Chain Relayer", component: <OnChainRelayer /> },
    split: { title: "Cross-Chain Split", component: <CrossChainSplit /> },
    messaging: { title: "Encrypted Messaging", component: <EncryptedMessaging /> },
    multisig: { title: "Multisig Privacy", component: <MultisigPrivacy /> },
    developer: { title: "Developer API", component: <DeveloperAPI /> },
  };

  if (page !== "home" && pages[page]) {
    return (
      <div className="min-h-screen bg-black pt-16 md:pt-20 px-4 md:px-6">
        <Navbar />
        <div className="max-w-2xl mx-auto py-6 md:py-10">
          <BackButton onClick={() => setPage("home")} />
          <h1 className="text-2xl md:text-3xl font-bold mb-6">{pages[page].title}</h1>
          {pages[page].component}
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
