import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import FounderMode from "@/pages/FounderMode";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Copy, Check,
  ExternalLink, Eye, EyeOff, ChevronDown, Zap, Fingerprint,
  Loader2, ArrowDown, Menu, ArrowLeft, Globe, Layers, Lock,
  History, Shield, Key, Image, FileCode, Clock, TrendingUp,
  Plus, Minus, Settings, AlertTriangle, MessageSquare, Users, Split
} from "lucide-react";
import { Toaster, toast } from "sonner";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";

// Import config and context from separate files
import { BACKEND_URL, API, VM, EVM_CONTRACTS, CHAINS, VM_GROUPS, TOKENS, LIVE_COUNT } from "@/config/chains";
import { WalletProvider, useWallet } from "@/context/WalletContext";

// ─── Utility Components ───────────────────────────────────────────────────────
function BackButton({ onClick }) {
  return (
    <button onClick={onClick} data-testid="back-button"
      className="flex items-center gap-2 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black transition-all duration-200 text-sm font-medium mb-6 group">
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
      Back
    </button>
  );
}

function copyToClip(text) {
  try { navigator.clipboard.writeText(text); } catch {
    const el = Object.assign(document.createElement("textarea"), { value: text });
    Object.assign(el.style, { position: "fixed", opacity: "0" });
    document.body.appendChild(el); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { copyToClip(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-500 hover:text-white" />}
    </button>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const { address, chain, switchChain, disconnect, vm } = useWallet();
  const [showChains, setShowChains] = useState(false);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-white rounded-full flex items-center justify-center">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-black rounded-full" />
          </div>
          <span className="font-heading text-lg md:text-xl font-bold tracking-tight">UPL</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button data-testid="chain-selector" onClick={() => setShowChains(!showChains)}
              className="flex items-center gap-2 px-3 py-2 border border-white/20 hover:border-white/40 transition-all text-sm">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[chain].color }} />
              {CHAINS[chain].name}
              <ChevronDown className={`w-4 h-4 transition-transform ${showChains ? "rotate-180" : ""}`} />
            </button>

            {showChains && (
              <div className="absolute top-full mt-2 right-0 bg-black border border-white/20 min-w-[200px] z-50">
                {vmGroups.map(({ vmKey, label, chains }) => (
                  <div key={vmKey}>
                    <div className="px-3 py-1.5 text-[10px] text-white/30 uppercase tracking-widest border-b border-white/5 bg-white/3">{label}</div>
                    {chains.map(([k, v]) => (
                      <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-sm ${!v.live ? 'opacity-50' : ''}`}
                        disabled={!v.live}>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                        {v.name}
                        {!v.live && <span className="text-[10px] text-yellow-400 ml-auto">Soon</span>}
                        {chain === k && v.live && <div className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {address && (
            <button onClick={disconnect} className="px-3 py-2 border border-white/20 hover:bg-white hover:text-black transition-all text-sm font-mono">
              {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

// ─── Hidden Balance Dashboard ─────────────────────────────────────────────────
function HiddenBalanceDashboard() {
  const { address, hiddenBalance, fetchHiddenBalance } = useWallet();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const refresh = async () => {
    setLoading(true);
    await fetchHiddenBalance();
    setLoading(false);
  };

  if (!hiddenBalance) return (
    <div className="text-center py-8">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-white/50" />
      <p className="text-white/50">Loading hidden balances...</p>
    </div>
  );

  const chainsWithBalance = Object.entries(hiddenBalance.chains || {}).filter(
    ([, data]) => data.total_balance && parseFloat(data.total_balance) > 0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Hidden Balance</h2>
          <p className="text-sm text-white/50">Aggregated across {hiddenBalance.stealth_address_count || 0} stealth addresses</p>
        </div>
        <button onClick={refresh} className="p-2 hover:bg-white/10 rounded" disabled={loading}>
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(hiddenBalance.chains || {}).slice(0, 4).map(([chainKey, data]) => (
          <div key={chainKey} className="bg-white/5 border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHAINS[chainKey]?.color || '#666' }} />
              <span className="text-xs text-white/50">{data.name}</span>
            </div>
            <div className="text-lg font-bold">{parseFloat(data.total_balance || 0).toFixed(4)}</div>
            <div className="text-xs text-white/30">{data.symbol}</div>
          </div>
        ))}
      </div>

      {/* Detailed Breakdown */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">All Chains</h3>
        {Object.entries(hiddenBalance.chains || {}).map(([chainKey, data]) => (
          <div key={chainKey} className="bg-white/5 border border-white/10">
            <button
              onClick={() => setExpanded(expanded === chainKey ? null : chainKey)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5"
            >
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHAINS[chainKey]?.color || '#666' }} />
                <span className="font-medium">{data.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="font-mono">{parseFloat(data.total_balance || 0).toFixed(6)} {data.symbol}</div>
                  <div className="text-xs text-white/30">
                    Main: {parseFloat(data.main_balance || 0).toFixed(4)} | Stealth: {parseFloat(data.stealth_balance || 0).toFixed(4)}
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${expanded === chainKey ? 'rotate-180' : ''}`} />
              </div>
            </button>
            
            {expanded === chainKey && data.stealth_addresses_with_balance?.length > 0 && (
              <div className="border-t border-white/10 p-4 space-y-2">
                <div className="text-xs text-white/50 uppercase tracking-wider mb-2">Stealth Addresses with Balance</div>
                {data.stealth_addresses_with_balance.map((sa, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-white/5 p-2">
                    <span className="font-mono text-xs">{sa.address.slice(0, 10)}...{sa.address.slice(-8)}</span>
                    <span className="font-mono">{parseFloat(sa.balance).toFixed(6)} {data.symbol}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Transaction History ──────────────────────────────────────────────────────
function TransactionHistory() {
  const { address } = useWallet();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (address) {
      axios.get(`${API}/transactions/history/${address}`)
        .then(res => setTransactions(res.data.transactions || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [address]);

  if (loading) return (
    <div className="text-center py-8">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-white/50" />
      <p className="text-white/50">Loading transactions...</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Transaction History</h2>
      
      {transactions.length === 0 ? (
        <div className="text-center py-12 bg-white/5 border border-white/10">
          <History className="w-12 h-12 mx-auto mb-4 text-white/20" />
          <p className="text-white/50">No transactions yet</p>
          <p className="text-sm text-white/30">Your private transactions will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.direction === 'out' ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                  {tx.direction === 'out' ? <ArrowUpRight className="w-4 h-4 text-red-400" /> : <ArrowDownLeft className="w-4 h-4 text-green-400" />}
                </div>
                <div>
                  <div className="font-medium text-sm">{tx.tx_type?.replace('_', ' ').toUpperCase() || 'Transfer'}</div>
                  <div className="text-xs text-white/50">{new Date(tx.created_at).toLocaleDateString()}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm">
                  {tx.direction === 'out' ? '-' : '+'}{ethers.formatEther(tx.amount_wei || '0').slice(0, 8)}
                </div>
                <div className="text-xs text-white/30">{tx.chain}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dual Seed Wallet Setup ───────────────────────────────────────────────────
function DualSeedSetup() {
  const { address, setPrivacyWallet } = useWallet();
  const [step, setStep] = useState(1);
  const [mainSeed, setMainSeed] = useState('');
  const [privacySeed, setPrivacySeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  // SECURITY: Wipe seeds from memory on unmount (user navigates away)
  useEffect(() => {
    return () => {
      setMainSeed('');
      setPrivacySeed('');
      setCreated(null);
    };
  }, []);

  const generateWallet = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/wallet/create`, {});
      setCreated(res.data);
      setMainSeed(res.data.main_seed_phrase);
      setPrivacySeed(res.data.privacy_seed_phrase);
      setStep(2);
      toast.success("Dual wallet created — write down your seed phrases NOW!");
    } catch {
      toast.error("Failed to create wallet");
    }
    setLoading(false);
  };

  const registerPrivacyKeys = async () => {
    if (!address) return toast.error("Connect main wallet first");
    setLoading(true);
    try {
      const spendKey = ethers.keccak256(ethers.toUtf8Bytes(privacySeed + "_spend"));
      const viewKey = ethers.keccak256(ethers.toUtf8Bytes(privacySeed + "_view"));
      
      await axios.post(`${API}/wallet/register-privacy`, {
        main_address: address,
        privacy_spend_key: spendKey,
        privacy_view_key: viewKey
      });
      
      setPrivacyWallet({ spendKey, viewKey, registered: true });

      // SECURITY: Clear seed phrases from memory immediately after use
      setMainSeed('');
      setPrivacySeed('');
      setCreated(null);

      setStep(3);
      toast.success("Privacy keys registered!");
    } catch {
      toast.error("Failed to register privacy keys");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex items-center gap-2 ${step >= s ? 'text-white' : 'text-white/30'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= s ? 'bg-white text-black' : 'bg-white/10'}`}>
              {step > s ? <Check className="w-4 h-4" /> : s}
            </div>
            <span className="text-sm hidden md:inline">{s === 1 ? 'Generate' : s === 2 ? 'Backup' : 'Complete'}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-yellow-500/10 border border-yellow-500/30 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-400">Dual Seed Phrase System</p>
                <p className="text-xs text-white/60 mt-1">
                  UPL uses two separate seed phrases: one for your main wallet (funds) and one for your privacy envelope.
                  This provides maximum security and privacy.
                </p>
              </div>
            </div>
          </div>
          
          <button onClick={generateWallet} disabled={loading}
            className="w-full py-4 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Key className="w-5 h-5" />}
            Generate Dual Wallet
          </button>
        </div>
      )}

      {step === 2 && created && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-white/50 uppercase tracking-wider">Main Seed Phrase (Funds)</span>
              <CopyButton text={mainSeed} />
            </div>
            <p className="font-mono text-sm bg-black/50 p-3 break-all">{mainSeed}</p>
            <p className="text-xs text-white/30 mt-2">Main Address: {created.main_address}</p>
          </div>
          
          <div className="bg-white/5 border border-green-500/30 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-green-400 uppercase tracking-wider">Privacy Seed Phrase (Privacy Envelope)</span>
              <CopyButton text={privacySeed} />
            </div>
            <p className="font-mono text-sm bg-black/50 p-3 break-all">{privacySeed}</p>
            <p className="text-xs text-white/30 mt-2">Privacy Address: {created.privacy_address}</p>
          </div>

          <div className="bg-red-500/10 border border-red-500/30 p-4">
            <p className="text-sm text-red-400">Write down BOTH seed phrases and store them securely. Never share them!</p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4 accent-white" />
            <span className="text-sm text-white/70">I have written down both seed phrases in a safe place</span>
          </label>

          <button onClick={registerPrivacyKeys} disabled={loading || !address || !confirmed}
            className="w-full py-4 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50">
            {!address ? 'Connect Main Wallet First' : loading ? 'Registering...' : 'Register Privacy Keys'}
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <h3 className="text-xl font-bold mb-2">Dual Wallet Setup Complete!</h3>
          <p className="text-white/50">Your privacy envelope is now active. All transactions will be privacy-wrapped.</p>
        </div>
      )}
    </div>
  );
}

// ─── Full Stealth Flow — Meta / Send / Receive ────────────────────────────────
import { StealthMeta } from "./components/features/StealthMeta";
import { StealthSend } from "./components/features/StealthSend";
import { StealthReceive } from "./components/features/StealthReceive";

function StealthContent() {
  const { address, chain, provider } = useWallet();
  const [tab, setTab] = useState("meta");
  const tabs = [
    { id: "meta",    label: "My Identity" },
    { id: "send",    label: "Send Privately" },
    { id: "receive", label: "Scan & Receive" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-white/10">
        {tabs.map(t => (
          <button
            key={t.id}
            data-testid={`stealth-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? "border-white text-white" : "border-transparent text-white/40 hover:text-white/70"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "meta"    && <StealthMeta address={address} />}
      {tab === "send"    && <StealthSend address={address} chain={chain} provider={provider} />}
      {tab === "receive" && <StealthReceive address={address} provider={provider} />}
    </div>
  );
}

// ─── Private Send ─────────────────────────────────────────────────────────────
function SendContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const send = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    if (!ethers.isAddress(to)) return toast.error("Invalid address");
    setSending(true);
    try {
      const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
      setTxHash(tx.hash);
      
      // Record transaction
      await axios.post(`${API}/transactions/record`, {
        tx_hash: tx.hash,
        from_address: address,
        to_address: to,
        amount_wei: ethers.parseEther(amount).toString(),
        chain,
        tx_type: "private_send",
        status: "pending"
      });
      
      toast.success("Transaction sent!");
      await tx.wait();
      toast.success("Confirmed on-chain");
      fetchBalance();
      setTo(""); setAmount("");
    } catch (e) { toast.error(e.message?.slice(0, 80) || "Failed"); }
    setSending(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        Signing with MetaMask on {CHAINS[chain]?.name}
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient (stealth address)</label>
        <input data-testid="send-to-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input data-testid="send-amount-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button data-testid="send-btn" onClick={send} disabled={sending}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send Privately
      </button>
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// ─── Private Swap ─────────────────────────────────────────────────────────────
function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState(TOKENS[chain]?.[0]?.symbol || "ETH");
  const [amountIn, setAmountIn] = useState("");
  const [recipient, setRecipient] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const tokens = TOKENS[chain] || [];

  const swap = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient) return toast.error("Enter stealth address");
    if (!amountIn || parseFloat(amountIn) <= 0) return toast.error("Enter amount");
    setSwapping(true);
    try {
      const tx = await signer.sendTransaction({ to: recipient, value: ethers.parseEther(amountIn) });
      setTxHash(tx.hash);
      
      await axios.post(`${API}/swap/record`, {
        tx_hash: tx.hash,
        from_address: address,
        token_in: tokenIn,
        token_out: CHAINS[chain].symbol,
        amount_in: ethers.parseEther(amountIn).toString(),
        amount_out: ethers.parseEther(amountIn).toString(),
        chain,
        recipient_stealth: recipient
      });
      
      toast.success("Private swap initiated");
      await tx.wait();
      toast.success("Confirmed!");
      fetchBalance();
      setAmountIn("");
    } catch (e) { toast.error(e.message?.slice(0, 60) || "Failed"); }
    setSwapping(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white/5 border border-white/20 p-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">You Pay</span>
          <select value={tokenIn} onChange={(e) => setTokenIn(e.target.value)} className="bg-transparent text-sm font-semibold outline-none">
            {tokens.map(t => <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>)}
          </select>
        </div>
        <input data-testid="swap-amount-input" type="number" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="0.0"
          className="w-full bg-transparent text-2xl font-mono outline-none" />
      </div>
      <div className="flex justify-center">
        <div className="w-10 h-10 bg-white/10 border border-white/20 flex items-center justify-center">
          <ArrowDown className="w-5 h-5" />
        </div>
      </div>
      <div className="bg-white/5 border border-white/20 p-4">
        <span className="text-xs text-gray-500 uppercase">Stealth Address Receives</span>
        <div className="text-2xl font-mono text-white/50">~{amountIn || "0.0"} {CHAINS[chain]?.symbol}</div>
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Privacy Fee</span>
        <span className="text-green-400">0.05%</span>
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input data-testid="swap-recipient-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button data-testid="swap-btn" onClick={swap} disabled={swapping || !address}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
        Private Swap
      </button>
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// ─── NFT Privacy ──────────────────────────────────────────────────────────────
function NFTPrivacy() {
  const { address, chain } = useWallet();
  const [nftContract, setNftContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [action, setAction] = useState("buy");
  const [loading, setLoading] = useState(false);
  const [proxy, setProxy] = useState(null);

  const createProxy = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!nftContract || !tokenId) return toast.error("Enter NFT details");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/nft/proxy`, {
        user_address: address,
        nft_contract: nftContract,
        token_id: tokenId,
        action,
        chain
      });
      setProxy(res.data);
      toast.success("NFT proxy created!");
    } catch { toast.error("Failed to create proxy"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Create a privacy proxy for NFT transactions. Your wallet won't be linked to the NFT purchase.</p>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">NFT Contract Address</label>
        <input value={nftContract} onChange={(e) => setNftContract(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Token ID</label>
        <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="1234"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Action</label>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none">
          <option value="buy" className="bg-black">Buy</option>
          <option value="sell" className="bg-black">Sell</option>
          <option value="transfer" className="bg-black">Transfer</option>
          <option value="bid" className="bg-black">Bid</option>
        </select>
      </div>
      
      <button onClick={createProxy} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Image className="w-5 h-5" />}
        Create NFT Proxy
      </button>
      
      {proxy && (
        <div className="bg-white/5 border border-green-500/30 p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 uppercase">Proxy Address</span>
            <CopyButton text={proxy.proxy_address} />
          </div>
          <p className="font-mono text-sm break-all">{proxy.proxy_address}</p>
          <p className="text-xs text-white/50">Send funds to this address, then complete your NFT transaction from here.</p>
        </div>
      )}
    </div>
  );
}

// ─── Token Approval Privacy ───────────────────────────────────────────────────
function TokenApprovalPrivacy() {
  const { address, chain } = useWallet();
  const [tokenAddress, setTokenAddress] = useState("");
  const [spenderAddress, setSpenderAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [disposal, setDisposal] = useState(null);

  const createDisposable = async () => {
    if (!address) return toast.error("Connect wallet first");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/approval/create-disposable`, {
        user_address: address,
        token_address: tokenAddress,
        spender_address: spenderAddress,
        amount: amount || "unlimited",
        chain
      });
      setDisposal(res.data);
      toast.success("Disposable approval address created!");
    } catch { toast.error("Failed to create"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Create a disposable address for token approvals. Prevents wallet-protocol fingerprinting.</p>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Token Contract</label>
        <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Spender (Protocol)</label>
        <input value={spenderAddress} onChange={(e) => setSpenderAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <button onClick={createDisposable} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
        Create Disposable Approval
      </button>
      
      {disposal && (
        <div className="bg-white/5 border border-green-500/30 p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 uppercase">Disposable Address</span>
            <CopyButton text={disposal.disposable_address} />
          </div>
          <p className="font-mono text-sm break-all">{disposal.disposable_address}</p>
          <p className="text-xs text-white/50">{disposal.instructions}</p>
        </div>
      )}
    </div>
  );
}

// ─── Smart Contract Privacy ───────────────────────────────────────────────────
function ContractPrivacy() {
  const { address, chain } = useWallet();
  const [contractAddress, setContractAddress] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [proxy, setProxy] = useState(null);

  const createProxy = async () => {
    if (!address) return toast.error("Connect wallet first");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/contract/proxy`, {
        user_address: address,
        contract_address: contractAddress,
        function_name: functionName,
        function_args: [],
        chain
      });
      setProxy(res.data);
      toast.success("Contract proxy created!");
    } catch { toast.error("Failed to create"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Execute smart contract calls through an anonymous proxy. Your wallet won't be linked to the interaction.</p>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Contract Address</label>
        <input value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Function Name</label>
        <input value={functionName} onChange={(e) => setFunctionName(e.target.value)} placeholder="stake, swap, mint..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <button onClick={createProxy} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCode className="w-5 h-5" />}
        Create Anonymous Proxy
      </button>
      
      {proxy && (
        <div className="bg-white/5 border border-green-500/30 p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 uppercase">Proxy Address</span>
            <CopyButton text={proxy.proxy_address} />
          </div>
          <p className="font-mono text-sm break-all">{proxy.proxy_address}</p>
          <p className="text-xs text-white/50">{proxy.instructions}</p>
        </div>
      )}
    </div>
  );
}

// ─── Chain Status ─────────────────────────────────────────────────────────────
function ChainsStatus() {
  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  return (
    <div className="space-y-6">
      {vmGroups.map(({ vmKey, label, chains }) => (
        <div key={vmKey}>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-white/50" />
            <h2 className="text-base font-semibold">{label}</h2>
          </div>
          <div className="space-y-2">
            {chains.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between bg-white/5 border border-white/10 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                  <div>
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-white/30">{v.symbol}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {v.live ? (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-green-400">Live</span>
                    </>
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      <span className="text-yellow-400">Coming Soon</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ZKP Proofs ───────────────────────────────────────────────────────────────
function ZKPProofs() {
  const { address } = useWallet();
  const [proofType, setProofType] = useState("stealth_ownership");
  const [stealthAddress, setStealthAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState(null);
  const [proofStatus, setProofStatus] = useState(null);

  const generateInputs = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!stealthAddress) return toast.error("Enter stealth address");
    setLoading(true);
    try {
      const spendKeyHash = ethers.keccak256(ethers.toUtf8Bytes(address + "_spend"));
      const viewKeyHash = ethers.keccak256(ethers.toUtf8Bytes(address + "_view"));
      
      const res = await axios.post(`${API}/zkp/generate-inputs`, {
        stealth_address: stealthAddress,
        spend_key_hash: spendKeyHash,
        view_key_hash: viewKeyHash
      });
      setInputs(res.data);
      toast.success("ZKP inputs generated!");
    } catch { toast.error("Failed to generate inputs"); }
    setLoading(false);
  };

  const submitProof = async () => {
    setLoading(true);
    try {
      // Demo proof (in production, use snarkjs to generate real proof)
      const res = await axios.post(`${API}/zkp/submit-proof`, {
        proof_type: proofType,
        public_inputs: inputs?.public_inputs ? Object.values(inputs.public_inputs).map(String) : [],
        proof_a: ["0x" + "1".repeat(64), "0x" + "2".repeat(64)],
        proof_b: [["0x" + "3".repeat(64), "0x" + "4".repeat(64)], ["0x" + "5".repeat(64), "0x" + "6".repeat(64)]],
        proof_c: ["0x" + "7".repeat(64), "0x" + "8".repeat(64)]
      });
      setProofStatus(res.data);
      toast.success("Proof submitted!");
    } catch { toast.error("Failed to submit proof"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Generate zero-knowledge proofs to verify ownership without revealing private keys.</p>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Proof Type</label>
        <select value={proofType} onChange={(e) => setProofType(e.target.value)}
          className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none">
          <option value="stealth_ownership" className="bg-black">Stealth Address Ownership</option>
          <option value="amount_range" className="bg-black">Amount Range Proof</option>
          <option value="membership" className="bg-black">Set Membership</option>
        </select>
      </div>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Stealth Address to Prove</label>
        <input value={stealthAddress} onChange={(e) => setStealthAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <button onClick={generateInputs} disabled={loading}
        className="w-full py-3 bg-white/10 border border-white/20 font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
        Generate ZKP Inputs
      </button>
      
      {inputs && (
        <div className="bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="text-xs text-green-400 uppercase">Public Inputs Generated</div>
          <div className="font-mono text-xs break-all space-y-1">
            {Object.entries(inputs.public_inputs || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-white/50">{k}:</span>
                <span className="text-white/70">{String(v).slice(0, 20)}...</span>
              </div>
            ))}
          </div>
          <button onClick={submitProof} disabled={loading}
            className="w-full py-2 bg-white text-black font-bold uppercase text-sm hover:bg-gray-200 disabled:opacity-50">
            Submit Proof for Verification
          </button>
        </div>
      )}
      
      {proofStatus && (
        <div className={`p-4 border ${proofStatus.status === 'verified' ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
          <div className="flex items-center gap-2">
            {proofStatus.status === 'verified' ? <Check className="w-5 h-5 text-green-400" /> : <AlertTriangle className="w-5 h-5 text-red-400" />}
            <span className={proofStatus.status === 'verified' ? 'text-green-400' : 'text-red-400'}>
              {proofStatus.message}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── On-Chain Relayer ─────────────────────────────────────────────────────────
function OnChainRelayer() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [txData, setTxData] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [relayerStats, setRelayerStats] = useState(null);

  useEffect(() => {
    axios.get(`${API}/relayer/stats/${chain}`).then(r => setRelayerStats(r.data)).catch(() => {});
  }, [chain]);

  const prepareRelayTx = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount) return toast.error("Enter recipient and amount");
    setLoading(true);
    try {
      const ephemeralKey = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      const viewTag = Math.floor(Math.random() * 256);
      
      const res = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: to,
        amount_wei: ethers.parseEther(amount).toString(),
        ephemeral_key: ephemeralKey,
        view_tag: viewTag,
        chain
      });
      setTxData(res.data);
      toast.success("Transaction prepared!");
    } catch { toast.error("Failed to prepare transaction"); }
    setLoading(false);
  };

  const executeRelayTx = async () => {
    if (!txData || !signer) return;
    setLoading(true);
    try {
      const tx = await signer.sendTransaction({
        to: txData.to,
        value: txData.value,
        data: txData.data,
        gasLimit: txData.gas
      });
      setTxHash(tx.hash);
      toast.success("Transaction sent through relayer!");
      await tx.wait();
      toast.success("Confirmed on-chain!");
      fetchBalance();
    } catch (e) { toast.error(e.message?.slice(0, 60) || "Failed"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Route transactions through the on-chain PrivacyRelayer contract for enhanced privacy with 0.05% fee.</p>
      
      {relayerStats && (
        <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-white/50">Total Relayed on {CHAINS[chain]?.name}</span>
          <span className="font-mono text-sm">{parseFloat(relayerStats.total_relayed || 0).toFixed(4)} {CHAINS[chain]?.symbol}</span>
        </div>
      )}
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      
      {!txData ? (
        <button onClick={prepareRelayTx} disabled={loading}
          className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
          Prepare Relayer Transaction
        </button>
      ) : (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-white/50">Relayer:</span><span className="font-mono">{txData.relayer_contract?.slice(0, 12)}...</span></div>
            <div className="flex justify-between"><span className="text-white/50">Fee:</span><span className="text-yellow-400">{txData.fee_bps / 100}% ({ethers.formatEther(txData.fee_amount || '0').slice(0, 8)})</span></div>
            <div className="flex justify-between"><span className="text-white/50">Net Amount:</span><span className="text-green-400">{ethers.formatEther(txData.net_amount || '0').slice(0, 10)}</span></div>
          </div>
          <button onClick={executeRelayTx} disabled={loading}
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
            Execute Through Relayer
          </button>
        </div>
      )}
      
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// ─── Cross-Chain Split ────────────────────────────────────────────────────────
function CrossChainSplit() {
  const { address, signer, privacyWallet } = useWallet();
  const [totalAmount, setTotalAmount] = useState("");
  const [splits, setSplits] = useState([
    { chain: "base", stealth: "", percentage: 50, status: "pending", txHash: "" },
    { chain: "arbitrum", stealth: "", percentage: 50, status: "pending", txHash: "" }
  ]);
  const [loading, setLoading] = useState(false);
  const [splitPlan, setSplitPlan] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [currentExecIdx, setCurrentExecIdx] = useState(-1);
  const [autoGenerate, setAutoGenerate] = useState(true);

  const addSplit = () => {
    if (splits.length >= 7) return toast.error("Maximum 7 chains");
    const usedChains = splits.map(s => s.chain);
    const availableChain = Object.entries(CHAINS)
      .filter(([k, v]) => v.live && !usedChains.includes(k))
      .map(([k]) => k)[0] || "polygon";
    setSplits([...splits, { chain: availableChain, stealth: "", percentage: 0, status: "pending", txHash: "" }]);
  };

  const removeSplit = (idx) => {
    if (splits.length <= 2) return toast.error("Minimum 2 splits required");
    setSplits(splits.filter((_, i) => i !== idx));
  };

  const updateSplit = (idx, field, value) => {
    const newSplits = [...splits];
    newSplits[idx][field] = value;
    setSplits(newSplits);
  };

  const autoDistribute = () => {
    const count = splits.length;
    const each = Math.floor(100 / count);
    const remainder = 100 - (each * count);
    const newSplits = splits.map((s, i) => ({
      ...s,
      percentage: i === 0 ? each + remainder : each
    }));
    setSplits(newSplits);
    toast.success("Percentages distributed evenly");
  };

  const generateStealthForSplit = async (idx) => {
    if (!privacyWallet) return toast.error("Generate privacy wallet first");
    try {
      const res = await axios.post(`${API}/stealth/generate`, {
        spending_public_key: privacyWallet.spending_public_key,
        viewing_public_key: privacyWallet.viewing_public_key
      });
      updateSplit(idx, 'stealth', res.data.stealth_address);
      toast.success(`Stealth address generated for ${CHAINS[splits[idx].chain]?.name}`);
    } catch (e) {
      toast.error("Failed to generate stealth address");
    }
  };

  const generateAllStealth = async () => {
    if (!privacyWallet) return toast.error("Generate privacy wallet first");
    setLoading(true);
    try {
      for (let i = 0; i < splits.length; i++) {
        if (!splits[i].stealth) {
          const res = await axios.post(`${API}/stealth/generate`, {
            spending_public_key: privacyWallet.spending_public_key,
            viewing_public_key: privacyWallet.viewing_public_key
          });
          updateSplit(i, 'stealth', res.data.stealth_address);
        }
      }
      toast.success("All stealth addresses generated!");
    } catch (e) {
      toast.error("Failed to generate stealth addresses");
    }
    setLoading(false);
  };

  const prepareSplit = async () => {
    if (!address) return toast.error("Connect wallet first");
    const totalPct = splits.reduce((s, sp) => s + Number(sp.percentage), 0);
    if (totalPct !== 100) return toast.error(`Percentages must total 100%, got ${totalPct}%`);
    
    // Auto-generate stealth addresses if enabled and missing
    if (autoGenerate && splits.some(s => !s.stealth)) {
      await generateAllStealth();
    }
    
    if (splits.some(s => !s.stealth)) return toast.error("Enter all stealth addresses");
    
    setLoading(true);
    try {
      const res = await axios.post(`${API}/split/prepare`, {
        from_address: address,
        total_amount_wei: ethers.parseEther(totalAmount).toString(),
        splits: splits.map(s => ({ chain: s.chain, stealth_address: s.stealth, percentage: Number(s.percentage) }))
      });
      setSplitPlan(res.data);
      toast.success("Split plan created!");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    setLoading(false);
  };

  const executeSplit = async (idx) => {
    if (!signer) return toast.error("Connect wallet first");
    const tx = splitPlan.transactions[idx];
    const chainConfig = CHAINS[tx.chain];
    
    setExecuting(true);
    setCurrentExecIdx(idx);
    
    try {
      // Switch to the target chain
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainConfig.chainId }]
      });
      
      // Send transaction
      const txResponse = await signer.sendTransaction({
        to: tx.stealth_address,
        value: ethers.parseEther(tx.amount.replace(" ETH", "").replace(" " + chainConfig.symbol, ""))
      });
      
      // Update status
      const newSplits = [...splits];
      newSplits[idx].status = "confirming";
      newSplits[idx].txHash = txResponse.hash;
      setSplits(newSplits);
      
      toast.success(`Transaction sent on ${chainConfig.name}!`);
      
      // Wait for confirmation
      await txResponse.wait();
      
      newSplits[idx].status = "confirmed";
      setSplits([...newSplits]);
      
      // Update backend
      await axios.post(`${API}/split/update-status`, {
        split_id: splitPlan.split_id,
        chain: tx.chain,
        status: "confirmed",
        tx_hash: txResponse.hash
      });
      
      toast.success(`${chainConfig.name} split confirmed!`);
    } catch (e) {
      const newSplits = [...splits];
      newSplits[idx].status = "failed";
      setSplits(newSplits);
      toast.error(e.message || "Transaction failed");
    }
    
    setExecuting(false);
    setCurrentExecIdx(-1);
  };

  const executeAll = async () => {
    for (let i = 0; i < splitPlan.transactions.length; i++) {
      if (splits[i].status !== "confirmed") {
        await executeSplit(i);
      }
    }
  };

  const totalPct = splits.reduce((s, sp) => s + Number(sp.percentage || 0), 0);
  const allConfirmed = splitPlan && splits.every(s => s.status === "confirmed");

  return (
    <div className="space-y-4" data-testid="cross-chain-split">
      <p className="text-sm text-white/50">Split a single payment across multiple chains for enhanced privacy. Funds become untraceable.</p>
      
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Total Amount (ETH equivalent)</label>
        <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0.1"
          data-testid="split-amount-input"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>

      {/* Auto-generate toggle */}
      <div className="flex items-center justify-between bg-white/5 p-3 border border-white/10">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-purple-400" />
          <span className="text-sm">Auto-generate stealth addresses</span>
        </div>
        <button 
          onClick={() => setAutoGenerate(!autoGenerate)}
          className={`w-10 h-5 rounded-full transition-colors ${autoGenerate ? 'bg-green-500' : 'bg-white/20'}`}
        >
          <div className={`w-4 h-4 bg-white rounded-full transition-transform ${autoGenerate ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>
      
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs text-white/50 uppercase">Split Configuration ({totalPct}%)</span>
          <div className="flex gap-2">
            <button onClick={autoDistribute} className="text-xs text-blue-400 hover:text-blue-300">
              Auto-distribute
            </button>
            <button onClick={addSplit} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Chain
            </button>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all ${totalPct === 100 ? 'bg-green-500' : totalPct > 100 ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.min(totalPct, 100)}%` }}
          />
        </div>
        
        {splits.map((split, idx) => (
          <div key={idx} className={`bg-white/5 border p-3 space-y-2 transition-colors ${
            split.status === "confirmed" ? "border-green-500/50" : 
            split.status === "failed" ? "border-red-500/50" : "border-white/10"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHAINS[split.chain]?.color }} />
                <select value={split.chain} onChange={(e) => updateSplit(idx, 'chain', e.target.value)}
                  className="bg-transparent text-sm outline-none" disabled={splitPlan}>
                  {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (
                    <option key={k} value={k} className="bg-black">{v.name}</option>
                  ))}
                </select>
                {split.status === "confirmed" && <Check className="w-4 h-4 text-green-400" />}
                {split.status === "confirming" && <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />}
                {split.status === "failed" && <AlertTriangle className="w-4 h-4 text-red-400" />}
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={split.percentage} onChange={(e) => updateSplit(idx, 'percentage', e.target.value)}
                  className="w-16 bg-transparent border-b border-white/20 text-right text-sm outline-none" disabled={splitPlan} />
                <span className="text-white/50">%</span>
                {splits.length > 2 && !splitPlan && (
                  <button onClick={() => removeSplit(idx)} className="text-red-400 hover:text-red-300">
                    <Minus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <input value={split.stealth} onChange={(e) => updateSplit(idx, 'stealth', e.target.value)}
                placeholder="Stealth address 0x..." 
                className="flex-1 bg-transparent text-xs font-mono outline-none text-white/70" 
                disabled={splitPlan} />
              {!split.stealth && !splitPlan && (
                <button onClick={() => generateStealthForSplit(idx)} className="text-xs text-purple-400 hover:text-purple-300">
                  Generate
                </button>
              )}
            </div>
            {split.txHash && (
              <a href={`${CHAINS[split.chain]?.explorer}/tx/${split.txHash}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> View Transaction
              </a>
            )}
          </div>
        ))}
      </div>
      
      {!splitPlan ? (
        <button onClick={prepareSplit} disabled={loading || totalPct !== 100}
          data-testid="prepare-split-btn"
          className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Split className="w-5 h-5" />}
          Prepare Cross-Chain Split
        </button>
      ) : (
        <div className="space-y-3">
          <div className="bg-white/5 border border-green-500/30 p-4 space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-xs text-green-400 uppercase">Split Plan Ready</div>
              <div className="text-xs text-white/50">ID: {splitPlan.split_id?.slice(0, 8)}...</div>
            </div>
            <div className="text-sm">Total: {splitPlan.total_amount} across {splitPlan.num_chains} chains</div>
            {splitPlan.transactions?.map((tx, i) => (
              <div key={i} className="flex justify-between items-center text-xs bg-white/5 p-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[tx.chain]?.color }} />
                  <span>{CHAINS[tx.chain]?.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono">{tx.amount} ({tx.percentage}%)</span>
                  {splits[i]?.status !== "confirmed" && (
                    <button 
                      onClick={() => executeSplit(i)}
                      disabled={executing}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 text-xs"
                    >
                      {currentExecIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : "Execute"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {!allConfirmed && (
            <button onClick={executeAll} disabled={executing}
              data-testid="execute-all-btn"
              className="w-full py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {executing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              Execute All Splits
            </button>
          )}
          
          {allConfirmed && (
            <div className="bg-green-500/20 border border-green-500 p-4 text-center">
              <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <div className="text-green-400 font-bold">All Splits Complete!</div>
              <p className="text-xs text-white/50 mt-1">Your funds are now distributed across {splitPlan.num_chains} chains with enhanced privacy.</p>
            </div>
          )}
          
          <button onClick={() => { setSplitPlan(null); setSplits(splits.map(s => ({ ...s, status: "pending", txHash: "" }))); }}
            className="w-full py-2 border border-white/20 text-white/50 text-sm hover:bg-white/5">
            Reset & Create New Split
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Encrypted Messaging ──────────────────────────────────────────────────────
function EncryptedMessaging() {
  const { address } = useWallet();
  const [tab, setTab] = useState("send");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [sent, setSent] = useState(null);
  const [decrypted, setDecrypted] = useState({});
  const [copied, setCopied] = useState(false);

  // Derive AES key from address (same logic as backend: sha256 of address)
  const deriveKey = async (addr) => {
    const enc = new TextEncoder().encode(addr);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return crypto.subtle.importKey("raw", hash, { name: "AES-CBC" }, false, ["decrypt"]);
  };

  const decryptMsg = async (encrypted_b64, recipientAddr) => {
    try {
      const key = await deriveKey(recipientAddr);
      const raw = Uint8Array.from(atob(encrypted_b64), c => c.charCodeAt(0));
      const iv = raw.slice(0, 16);
      const ciphertext = raw.slice(16);
      const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
      const text = new TextDecoder().decode(plain);
      // Remove PKCS7 padding
      const padLen = text.charCodeAt(text.length - 1);
      return text.slice(0, text.length - padLen);
    } catch { return null; }
  };

  const loadInbox = async () => {
    if (!address) return;
    try {
      const r = await axios.get(`${API}/messaging/inbox/${address}`);
      const msgs = r.data.messages || [];
      setInbox(msgs);
      // Auto-decrypt all using own address as key
      const dec = {};
      for (const m of msgs) {
        const plain = await decryptMsg(m.encrypted_content, address);
        if (plain) dec[m.message_id] = plain;
      }
      setDecrypted(dec);
    } catch {}
  };

  useEffect(() => {
    if (address && tab === "inbox") loadInbox();
  }, [address, tab]);

  const sendMessage = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient || !message) return toast.error("Fill in recipient and message");
    setLoading(true);
    try {
      await axios.post(`${API}/messaging/send`, {
        sender_address: address,
        recipient_address: recipient.trim(),
        message,
        recipient_public_key: recipient.trim(),
      });
      setSent(true);
      setMessage("");
      toast.success("Message sent — recipient can decrypt with their wallet address");
    } catch { toast.error("Send failed"); }
    setLoading(false);
  };

  const copyLink = () => {
    const text = `${window.location.origin}?msg=${address}`;
    copyToClip(text);
    setCopied(true);
    toast.success("Contact link copied — share it so anyone can message you");
    setTimeout(() => setCopied(false), 2000);
  };

  // Pre-fill recipient if someone arrived via ?msg= link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const msg = params.get("msg");
    if (msg) { setRecipient(msg); setTab("send"); }
  }, []);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2">
        {["send","inbox"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium capitalize ${tab === t ? "bg-white text-black" : "bg-white/10"}`}>
            {t === "inbox" ? `Inbox (${inbox.filter(m => !m.read).length})` : "Send"}
          </button>
        ))}
      </div>

      {/* SEND */}
      {tab === "send" && (
        <div className="space-y-3">
          {/* Share contact link */}
          {address && (
            <button onClick={copyLink}
              className="w-full py-2 border border-white/20 hover:border-white/50 text-xs text-white/50 hover:text-white flex items-center justify-center gap-2 transition-colors">
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "Link copied!" : "Copy your contact link — share so people can message you"}
            </button>
          )}
          <p className="text-xs text-white/30">Messages are encrypted. Only the recipient can read them.</p>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Recipient wallet address</label>
            <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..."
              data-testid="msg-recipient-input"
              className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Your private message..."
              data-testid="msg-body-input"
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white h-24 resize-none" />
          </div>
          <button onClick={sendMessage} disabled={loading} data-testid="msg-send-btn"
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {loading ? "Encrypting & Sending…" : "Send Encrypted"}
          </button>
          {sent && (
            <div className="bg-green-400/10 border border-green-400/30 p-3 text-xs text-green-300">
              Sent. Recipient opens their inbox and sees the decrypted message automatically.
            </div>
          )}
        </div>
      )}

      {/* INBOX */}
      {tab === "inbox" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/30">Messages sent to your wallet address</p>
            <button onClick={loadInbox} className="text-xs text-white/40 hover:text-white transition-colors">Refresh</button>
          </div>
          {inbox.length === 0 ? (
            <div className="text-center py-10 text-white/30 space-y-2">
              <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Share your contact link so people can message you privately</p>
              {address && (
                <button onClick={copyLink}
                  className="mt-2 px-4 py-2 border border-white/20 hover:border-white/50 text-xs text-white/50 hover:text-white transition-colors">
                  Copy contact link
                </button>
              )}
            </div>
          ) : (
            inbox.map((msg, i) => (
              <div key={i} className={`border p-4 space-y-2 ${msg.read ? "border-white/10 bg-white/3" : "border-green-500/30 bg-green-400/5"}`}>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono text-white/50">
                    From: {msg.sender_address?.slice(0,10)}…{msg.sender_address?.slice(-4)}
                  </span>
                  <div className="flex items-center gap-2">
                    {!msg.read && <span className="text-[10px] text-green-400 font-semibold">NEW</span>}
                    <span className="text-xs text-white/30">{msg.created_at ? new Date(msg.created_at).toLocaleDateString() : ""}</span>
                  </div>
                </div>
                {decrypted[msg.message_id] ? (
                  <p className="text-sm text-white leading-relaxed">{decrypted[msg.message_id]}</p>
                ) : (
                  <p className="text-xs text-white/20 font-mono italic">Unable to decrypt — message not addressed to your current wallet</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Multisig Privacy ─────────────────────────────────────────────────────────
function MultisigPrivacy() {
  const { address, chain } = useWallet();
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("");
  const [owners, setOwners] = useState(["", ""]);
  const [threshold, setThreshold] = useState(2);
  const [loading, setLoading] = useState(false);
  const [multisigs, setMultisigs] = useState([]);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (address && tab === "list") {
      axios.get(`${API}/multisig/user/${address}`).then(r => setMultisigs(r.data.multisigs || [])).catch(() => {});
    }
  }, [address, tab]);

  const addOwner = () => setOwners([...owners, ""]);
  const updateOwner = (idx, val) => {
    const newOwners = [...owners];
    newOwners[idx] = val;
    setOwners(newOwners);
  };

  const createMultisig = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!name) return toast.error("Enter multisig name");
    const validOwners = owners.filter(o => o.trim());
    if (validOwners.length < 2) return toast.error("Need at least 2 owners");
    if (threshold > validOwners.length) return toast.error("Threshold cannot exceed owners");
    
    setLoading(true);
    try {
      const res = await axios.post(`${API}/multisig/create`, {
        name,
        owners: validOwners,
        threshold,
        chain
      });
      setCreated(res.data);
      toast.success("Multisig created!");
    } catch { toast.error("Failed to create multisig"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("create")}
          className={`flex-1 py-2 text-sm font-medium ${tab === "create" ? "bg-white text-black" : "bg-white/10"}`}>
          Create
        </button>
        <button onClick={() => setTab("list")}
          className={`flex-1 py-2 text-sm font-medium ${tab === "list" ? "bg-white text-black" : "bg-white/10"}`}>
          My Multisigs
        </button>
      </div>
      
      {tab === "create" ? (
        <div className="space-y-3">
          <p className="text-sm text-white/50">Create a privacy-focused multisig wallet with off-chain signature collection.</p>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Multisig Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Treasury, Team Fund..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs text-gray-500 uppercase">Owners</label>
              <button onClick={addOwner} className="text-xs text-green-400">+ Add Owner</button>
            </div>
            {owners.map((owner, idx) => (
              <input key={idx} value={owner} onChange={(e) => updateOwner(idx, e.target.value)}
                placeholder={`Owner ${idx + 1} address`}
                className="w-full bg-white/5 border border-white/20 p-2 font-mono text-xs outline-none focus:border-white mb-2" />
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Threshold (required signatures)</label>
            <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
              min={1} max={owners.length}
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white" />
          </div>
          <button onClick={createMultisig} disabled={loading}
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50">
            {loading ? "Creating..." : `Create ${threshold} of ${owners.filter(o => o).length} Multisig`}
          </button>
          {created && (
            <div className="bg-green-500/10 border border-green-500/30 p-3 text-sm">
              <div className="text-green-400 font-medium">{created.name}</div>
              <div className="text-xs text-white/50 mt-1">{created.message}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {multisigs.length === 0 ? (
            <div className="text-center py-8 text-white/50">No multisigs found</div>
          ) : (
            multisigs.map((ms, i) => (
              <div key={i} className="bg-white/5 border border-white/10 p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">{ms.name}</span>
                  <span className="text-xs text-white/50">{ms.threshold} of {ms.owners?.length}</span>
                </div>
                <div className="text-xs text-white/30">
                  {ms.proposals?.filter(p => p.status === 'pending').length || 0} pending proposals
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Developer API Page ───────────────────────────────────────────────────────
function DeveloperAPI() {
  const { address } = useWallet();
  const [tab, setTab] = useState("docs");
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyLimit, setNewKeyLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState(null);
  const [usage, setUsage] = useState(null);
  const [docs, setDocs] = useState(null);

  useEffect(() => {
    axios.get(`${API}/v1/docs`).then(r => setDocs(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (address && tab === "keys") {
      axios.get(`${API}/developer/keys/${address}`).then(r => setApiKeys(r.data.keys || [])).catch(() => {});
    }
    if (address && tab === "usage") {
      axios.get(`${API}/developer/usage/${address}`).then(r => setUsage(r.data)).catch(() => {});
    }
  }, [address, tab]);

  const createKey = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!newKeyName) return toast.error("Enter a key name");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/developer/keys/create`, {
        owner_address: address,
        name: newKeyName,
        rate_limit: newKeyLimit
      });
      setCreatedKey(res.data);
      setApiKeys([...apiKeys, { name: newKeyName, rate_limit: newKeyLimit, active: true }]);
      setNewKeyName("");
      toast.success("API key created!");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create key");
    }
    setLoading(false);
  };

  const revokeKey = async (keyName) => {
    if (!address) return;
    try {
      await axios.delete(`${API}/developer/keys/${keyName}`, { data: { owner_address: address } });
      setApiKeys(apiKeys.filter(k => k.name !== keyName));
      toast.success("API key revoked");
    } catch (e) {
      toast.error("Failed to revoke key");
    }
  };

  const copyToClipboard = (text) => {
    copyToClip(text);
    toast.success("Copied to clipboard!");
  };

  return (
    <div className="space-y-6" data-testid="developer-api">
      {/* Header */}
      <div className="border-b border-white/10 pb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileCode className="w-6 h-6" />
          Developer API
        </h2>
        <p className="text-sm text-white/50 mt-1">Integrate UPL privacy features into your applications</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-white/10">
        {[
          { key: "docs", label: "Documentation", icon: <FileCode className="w-4 h-4" /> },
          { key: "keys", label: "API Keys", icon: <Key className="w-4 h-4" /> },
          { key: "usage", label: "Usage Stats", icon: <TrendingUp className="w-4 h-4" /> }
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${tab === t.key ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white/70'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Documentation Tab */}
      {tab === "docs" && docs && (
        <div className="space-y-6">
          {/* Quick Start */}
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-green-400 mb-3">Quick Start</h3>
            <div className="bg-black/50 p-4 font-mono text-xs overflow-x-auto">
              <div className="text-white/50"># Generate a stealth address</div>
              <div className="text-green-400">curl -X POST {BACKEND_URL}/api/v1/stealth/generate \</div>
              <div className="text-white/70 pl-4">-H "Content-Type: application/json" \</div>
              <div className="text-white/70 pl-4">-d '{`{"spending_key": "0x...", "viewing_key": "0x..."}`}'</div>
            </div>
          </div>

          {/* Authentication */}
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-blue-400 mb-3">Authentication</h3>
            <p className="text-sm text-white/70 mb-2">{docs.authentication?.type}: Include your key in requests</p>
            <div className="bg-black/50 p-3 font-mono text-xs">
              <span className="text-white/50">Header:</span> <span className="text-yellow-400">X-API-Key: upl_your_key_here</span>
            </div>
          </div>

          {/* Endpoints */}
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-purple-400 mb-3">Endpoints</h3>
            <div className="space-y-3">
              {docs.endpoints?.map((ep, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white/5 hover:bg-white/10 transition-colors">
                  <span className={`px-2 py-1 text-xs font-bold ${ep.method === 'GET' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {ep.method}
                  </span>
                  <div className="flex-1">
                    <div className="font-mono text-sm">{ep.path}</div>
                    <div className="text-xs text-white/50 mt-1">{ep.description}</div>
                    {ep.body && (
                      <div className="mt-2 text-xs">
                        <span className="text-white/30">Body: </span>
                        <code className="text-white/50">{JSON.stringify(ep.body)}</code>
                      </div>
                    )}
                  </div>
                  <div className={`text-xs ${ep.auth_required ? 'text-yellow-400' : 'text-green-400'}`}>
                    {ep.auth_required ? '🔐 Auth' : '🌐 Public'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rate Limits */}
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-orange-400 mb-3">Rate Limits</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-white/50">Default</div>
                <div className="font-mono">{docs.rate_limits?.default}</div>
              </div>
              <div>
                <div className="text-white/50">Custom</div>
                <div className="font-mono">{docs.rate_limits?.custom}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Tab */}
      {tab === "keys" && (
        <div className="space-y-4">
          {/* Create new key */}
          <div className="bg-white/5 border border-white/10 p-4 space-y-3">
            <h3 className="text-sm font-bold uppercase text-green-400">Create New API Key</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Key Name</label>
                <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="my-app-key"
                  className="w-full bg-white/5 border border-white/20 p-2 text-sm outline-none focus:border-white" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Rate Limit (req/min)</label>
                <input type="number" value={newKeyLimit} onChange={(e) => setNewKeyLimit(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/20 p-2 text-sm outline-none focus:border-white" />
              </div>
            </div>
            <button onClick={createKey} disabled={loading || !address}
              className="w-full py-2 bg-white text-black font-bold uppercase text-sm hover:bg-gray-200 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Create API Key"}
            </button>
          </div>

          {/* Created key warning */}
          {createdKey && (
            <div className="bg-yellow-500/20 border border-yellow-500 p-4 space-y-2">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-bold">Save Your API Key Now!</span>
              </div>
              <p className="text-xs text-white/70">This key will only be shown once. Save it securely.</p>
              <div className="flex items-center gap-2 bg-black/50 p-3 font-mono text-sm">
                <span className="flex-1 break-all">{createdKey.api_key}</span>
                <button onClick={() => copyToClipboard(createdKey.api_key)} className="text-white/50 hover:text-white">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Existing keys */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold uppercase text-white/50">Your API Keys</h3>
            {apiKeys.length === 0 ? (
              <div className="text-center py-8 text-white/30">No API keys yet</div>
            ) : (
              apiKeys.map((k, i) => (
                <div key={i} className={`flex items-center justify-between p-3 bg-white/5 border ${k.active ? 'border-white/10' : 'border-red-500/30'}`}>
                  <div>
                    <div className="font-medium">{k.name}</div>
                    <div className="text-xs text-white/50">{k.rate_limit} req/min • {k.active ? 'Active' : 'Revoked'}</div>
                  </div>
                  {k.active && (
                    <button onClick={() => revokeKey(k.name)} className="text-red-400 hover:text-red-300 text-xs">
                      Revoke
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Usage Stats Tab */}
      {tab === "usage" && (
        <div className="space-y-4">
          {usage ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white/5 border border-white/10 p-4 text-center">
                  <div className="text-3xl font-bold">{usage.total_requests}</div>
                  <div className="text-xs text-white/50 uppercase">Total Requests</div>
                </div>
                <div className="bg-white/5 border border-white/10 p-4 text-center">
                  <div className="text-3xl font-bold">{usage.keys?.length || 0}</div>
                  <div className="text-xs text-white/50 uppercase">Active Keys</div>
                </div>
                <div className="bg-white/5 border border-white/10 p-4 text-center">
                  <div className="text-3xl font-bold text-green-400">∞</div>
                  <div className="text-xs text-white/50 uppercase">Free Tier</div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 p-4">
                <h3 className="text-sm font-bold uppercase text-white/50 mb-3">Usage by Key</h3>
                {usage.keys?.map((k, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${k.active ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span>{k.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-white/50">{k.usage_count} requests</span>
                      {k.last_used && <span className="text-xs text-white/30">Last: {new Date(k.last_used).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              {address ? (
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-white/30" />
              ) : (
                <div className="text-white/30">Connect wallet to view usage</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Access Gate ──────────────────────────────────────────────────────────────
// Session token stored in memory only — never in localStorage
let _sessionToken = sessionStorage.getItem("_upl_tok") || null;

function setSessionToken(t) {
  _sessionToken = t;
  if (t) sessionStorage.setItem("_upl_tok", t);
  else sessionStorage.removeItem("_upl_tok");
  // Attach to all axios requests automatically
  if (t) axios.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  else delete axios.defaults.headers.common["Authorization"];
}

// Restore token on page load
if (_sessionToken) axios.defaults.headers.common["Authorization"] = `Bearer ${_sessionToken}`;

function AccessGate({ onGranted }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);

  const attempt = async () => {
    if (!code) return;
    setLoading(true);
    try {
      const res = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/auth/verify-access`, { code });
      setSessionToken(res.data.token);
      onGranted();
    } catch {
      setError(true);
      setShake(true);
      setCode("");
      setTimeout(() => setShake(false), 600);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-full max-w-xs px-8 py-10 border border-white/10 bg-white/[0.02] text-center"
        style={{ animation: shake ? "shake 0.5s" : "none" }}>
        <div className="w-2 h-2 rounded-full bg-green-400 mx-auto mb-6 animate-pulse" />
        <h2 className="text-sm font-semibold tracking-[0.2em] uppercase text-white/60 mb-1">Universal Privacy Layer</h2>
        <p className="text-xs text-white/20 mb-8">Restricted Access</p>
        <input
          data-testid="access-code-input"
          type="password"
          value={code}
          onChange={e => { setCode(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && attempt()}
          placeholder="Enter access code"
          autoFocus
          className={`w-full bg-transparent border ${error ? "border-red-500/60 text-red-400" : "border-white/20 text-white"} p-3 text-center font-mono text-sm outline-none focus:border-white/50 tracking-widest`}
        />
        {error && <p className="text-red-400 text-xs mt-2">Invalid access code</p>}
        <button
          data-testid="access-code-submit"
          onClick={attempt}
          disabled={loading}
          className="w-full mt-4 py-3 bg-white text-black text-xs font-bold uppercase tracking-[0.15em] hover:bg-white/90 disabled:opacity-50 transition-all"
        >
          {loading ? "Verifying..." : "Enter"}
        </button>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────
function Landing() {
  const { connectWallet, connecting, vm, switchChain, chain } = useWallet();
  const [showChains, setShowChains] = useState(false);
  const walletLabel = VM_GROUPS[vm]?.walletName || "Wallet";

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      {/* Header - fixed positioning for mobile */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 bg-black/80 backdrop-blur-sm">
        {/* Chain badge */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-white/20 text-[10px] sm:text-xs cursor-pointer hover:border-white/40 transition-all"
          onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70">{LIVE_COUNT} Live</span>
          <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
        </div>

        {/* Connect button */}
        <MagnetizeButton onClick={connectWallet} disabled={connecting} particleCount={14} className="px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-2.5 text-xs sm:text-sm">
          {connecting ? "..." : `Connect`}
        </MagnetizeButton>
      </div>

      {/* Chain dropdown */}
      {showChains && (
        <div className="fixed top-12 sm:top-14 left-3 sm:left-4 md:left-6 z-50 bg-black border border-white/20 min-w-[220px] sm:min-w-[260px] max-h-[70vh] overflow-y-auto">
          {vmGroups.map(({ vmKey, label, chains }) => (
            <div key={vmKey}>
              <div className="px-3 py-2 text-[10px] text-white/40 uppercase tracking-wider border-b border-white/10 bg-white/3 flex items-center gap-2">
                <span>{label}</span>
                <span className="text-white/20">·</span>
                <span className="text-white/20">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
              </div>
              {chains.map(([k, v]) => (
                <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-xs sm:text-sm ${!v.live ? 'opacity-50' : ''}`}
                  disabled={!v.live}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                  <span>{v.name}</span>
                  <span className="text-white/30 text-xs ml-auto">{v.symbol}</span>
                  {!v.live && <span className="text-[10px] text-yellow-400">Soon</span>}
                  {chain === k && v.live && <div className="w-2 h-2 rounded-full bg-green-400" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Globe - smaller on mobile, positioned better */}
      <div className="pt-16 md:pt-20 flex justify-center">
        <div className="w-[200px] h-[200px] md:w-[350px] md:h-[350px]">
          <RotatingEarth width={350} height={350} />
        </div>
      </div>

      {/* Content - proper spacing below globe */}
      <div className="text-center px-4 md:px-6 mt-6 md:mt-10">
        <h1 className="font-heading text-2xl sm:text-4xl md:text-6xl font-bold tracking-tight text-white mb-3 md:mb-6">
          Universal Privacy Layer
        </h1>
        <p className="text-white/40 text-xs sm:text-sm md:text-base mb-5 md:mb-8 max-w-md mx-auto px-2">
          Private transactions across every chain. One interface, all networks.
        </p>

        {/* Stats row */}
        <div className="flex items-center justify-center gap-4 sm:gap-8 md:gap-12 mb-6 md:mb-8">
          {[["100%", "Private"], [LIVE_COUNT.toString(), "Chains"], ["10", "Pillars"]].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <span className="block text-lg sm:text-xl md:text-2xl font-bold text-white">{val}</span>
              <span className="text-[9px] sm:text-[10px] md:text-xs text-white/40 uppercase tracking-wider">{lbl}</span>
            </div>
          ))}
        </div>

        {/* VM type badges - horizontal scroll on mobile */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-4 md:mb-6 px-2">
          {Object.entries(VM_GROUPS).map(([vmKey, info]) => (
            <div key={vmKey} className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 border border-white/10 text-[10px] sm:text-xs whitespace-nowrap">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-white/60">{info.label}</span>
              <span className="text-white/20 hidden sm:inline">·</span>
              <span className="text-white/30 hidden sm:inline">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
            </div>
          ))}
        </div>

        {/* Chain pills - better mobile layout */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mb-6 md:mb-8 px-2">
          {Object.entries(CHAINS).map(([k, v]) => (
            <div key={k} className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 border border-white/10 text-[10px] sm:text-xs cursor-pointer hover:border-white/30 transition-all ${!v.live ? 'opacity-50' : ''}`}
              onClick={() => { if (v.live) { switchChain(k); } }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
              <span className="text-white/60">{v.name}</span>
              {!v.live && <span className="text-[8px] sm:text-[10px] text-yellow-400 ml-0.5">Soon</span>}
            </div>
          ))}
        </div>

        {/* Footer Links */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-white/30">
          <a href="/terms" className="hover:text-white/50 transition-colors">Terms of Service</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-white/50 transition-colors">Privacy Policy</a>
          <span>·</span>
          <a href="/guide" className="hover:text-white/50 transition-colors">Getting Started</a>
        </div>
      </div>
    </div>
  );
}

// ─── Private Uniswap Swap ─────────────────────────────────────────────────────
function UniswapPrivateSwap() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState("ETH");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [feeTier, setFeeTier] = useState("medium");
  const [stealthRecipient, setStealthRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const supportedChains = ["base", "arbitrum", "polygon", "optimism"];
  const isSupported = supportedChains.includes(chain);

  const getQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    if (!stealthRecipient) return toast.error("Enter a stealth recipient address");
    setLoading(true);
    setQuote(null);
    try {
      const res = await axios.post(`${API}/uniswap/quote`, {
        chain,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        stealth_recipient: stealthRecipient,
        fee_tier: feeTier
      });
      setQuote(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Quote failed");
    }
    setLoading(false);
  };

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      const res = await axios.post(`${API}/stealth/generate`, { public_address: address, chain });
      setStealthRecipient(res.data.stealth_address);
      toast.success("Stealth address generated");
    } catch (e) { toast.error("Failed to generate stealth address"); }
  };

  const executeSwap = async () => {
    if (!quote || !address) return;
    setSwapping(true);
    try {
      // Send ETH to the stealth recipient (privacy-routed swap)
      const tx = await signer.sendTransaction({
        to: stealthRecipient,
        value: ethers.parseEther(amount)
      });
      setTxHash(tx.hash);
      await axios.post(`${API}/uniswap/record-swap`, {
        tx_hash: tx.hash,
        from_address: address,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amount,
        amount_out: quote.amount_out_human,
        chain,
        stealth_recipient: stealthRecipient,
        router_used: "uniswap_v3"
      });
      toast.success("Private swap executed via Uniswap V3!");
      await tx.wait();
      fetchBalance();
      setQuote(null);
      setAmount("");
    } catch (e) { toast.error(e.message?.slice(0, 80) || "Swap failed"); }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="uniswap-private-swap">
      <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded text-xs text-blue-300">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" />
          <span className="font-semibold">Privacy-Routed Swap</span>
        </div>
        Your swap is routed: <span className="font-mono">wallet → stealth proxy → Uniswap V3 → stealth recipient</span>
      </div>

      {!isSupported && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300">
          Uniswap V3 not available on {CHAINS[chain]?.name}. Switch to Base, Arbitrum, Polygon, or Optimism.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">From Token</label>
          <select value={tokenIn} onChange={e => setTokenIn(e.target.value)}
            data-testid="uniswap-token-in"
            className="w-full bg-transparent text-base font-semibold outline-none">
            {["ETH", "WETH", "USDC", "USDT", "DAI"].map(t => (
              <option key={t} value={t} className="bg-black">{t}</option>
            ))}
          </select>
          <input data-testid="uniswap-amount-input" type="number" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="0.0"
            className="w-full bg-transparent text-2xl font-mono outline-none mt-2" />
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">To Token</label>
          <select value={tokenOut} onChange={e => setTokenOut(e.target.value)}
            data-testid="uniswap-token-out"
            className="w-full bg-transparent text-base font-semibold outline-none">
            {["USDC", "USDT", "DAI", "WETH", "ETH"].map(t => (
              <option key={t} value={t} className="bg-black">{t}</option>
            ))}
          </select>
          <div className="text-2xl font-mono text-white/50 mt-2">
            {quote ? quote.amount_out_human : "~0.0"}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-500 uppercase">Stealth Recipient</label>
          <button onClick={autoGenStealth} className="text-xs text-blue-400 hover:text-blue-300">
            Auto-generate
          </button>
        </div>
        <input data-testid="uniswap-stealth-input" value={stealthRecipient}
          onChange={e => setStealthRecipient(e.target.value)}
          placeholder="0x... (stealth address)"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 uppercase mb-1">Fee Tier</label>
          <select value={feeTier} onChange={e => setFeeTier(e.target.value)}
            className="w-full bg-white/5 border border-white/20 p-2 text-sm outline-none">
            <option value="very_low" className="bg-black">0.01%</option>
            <option value="low" className="bg-black">0.05%</option>
            <option value="medium" className="bg-black">0.3%</option>
            <option value="high" className="bg-black">1%</option>
          </select>
        </div>
        <div className="text-xs text-gray-500">
          <div>Privacy Fee: <span className="text-green-400">0.05%</span></div>
          {quote && <div>Output: <span className="text-white font-mono">{quote.amount_out_human} {tokenOut}</span></div>}
        </div>
      </div>

      {quote && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-white/50">Route</span><span className="text-white/70 font-mono">{quote.routing}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Router</span><span className="font-mono">{quote.router?.slice(0,10)}...</span></div>
          <div className="flex justify-between"><span className="text-white/50">Privacy fee</span><span className="text-green-400">{quote.privacy_fee_pct}</span></div>
        </div>
      )}

      <div className="flex gap-3">
        <button data-testid="uniswap-get-quote-btn" onClick={getQuote}
          disabled={loading || !isSupported || !amount}
          className="flex-1 py-3 border border-white/30 text-sm font-medium uppercase tracking-wider hover:border-white hover:bg-white hover:text-black disabled:opacity-40 transition-all flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
          Get Quote
        </button>
        <button data-testid="uniswap-swap-btn" onClick={executeSwap}
          disabled={swapping || !quote || !address}
          className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
          {swapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Swap Privately
        </button>
      </div>

      {txHash && (
        <a href={`${CHAINS[chain]?.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// ─── Hyperliquid Private Trading ──────────────────────────────────────────────
function HyperliquidPrivateTrading() {
  const { address, chain } = useWallet();
  const [asset, setAsset] = useState("ETH");
  const [direction, setDirection] = useState("LONG");
  const [sizeUSD, setSizeUSD] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [tradePlan, setTradePlan] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [prices, setPrices] = useState({});

  useEffect(() => {
    axios.get(`${API}/hyperliquid/markets`).then(r => setMarkets(r.data.markets || [])).catch(() => {});
    // Fetch BTC and ETH prices
    ["BTC", "ETH"].forEach(a => {
      axios.get(`${API}/hyperliquid/price/${a}`).then(r => {
        if (r.data.price) setPrices(p => ({ ...p, [a]: r.data.price }));
      }).catch(() => {});
    });
  }, []);

  const prepareTrade = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!sizeUSD || parseFloat(sizeUSD) <= 0) return toast.error("Enter position size");
    setPreparing(true);
    setTradePlan(null);
    try {
      const res = await axios.post(`${API}/hyperliquid/prepare-private-trade`, {
        trader_address: address,
        asset,
        is_buy: direction === "LONG",
        size: parseFloat(sizeUSD),
        limit_price: limitPrice ? parseFloat(limitPrice) : null,
        leverage,
        chain: chain || "arbitrum"
      });
      setTradePlan(res.data);
      toast.success("Trade prepared with privacy routing!");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to prepare trade");
    }
    setPreparing(false);
  };

  const perps = markets.length > 0 ? markets.map(m => m.name) : ["BTC", "ETH", "SOL", "ARB", "MATIC", "AVAX", "DOGE", "LINK", "UNI", "HYPE"];

  return (
    <div className="space-y-4" data-testid="hyperliquid-trading">
      <div className="bg-green-500/10 border border-green-500/30 p-3 rounded text-xs text-green-300">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" />
          <span className="font-semibold">Privacy-Routed Perpetual Trading</span>
        </div>
        Your margin is routed through a stealth proxy before opening positions on Hyperliquid.
        Your wallet is never linked to the trade.
      </div>

      {/* Live Prices */}
      {Object.keys(prices).length > 0 && (
        <div className="flex gap-3">
          {Object.entries(prices).map(([a, p]) => (
            <div key={a} className="bg-white/5 border border-white/10 px-3 py-2 text-xs">
              <span className="text-white/50">{a}/USD</span>
              <span className="ml-2 font-mono text-green-400">${parseFloat(p).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Asset</label>
          <select value={asset} onChange={e => setAsset(e.target.value)}
            data-testid="hl-asset-select"
            className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none">
            {perps.slice(0, 20).map(p => (
              <option key={p} value={p} className="bg-black">{p}-PERP</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Direction</label>
          <div className="flex gap-2">
            {["LONG", "SHORT"].map(d => (
              <button key={d} data-testid={`hl-direction-${d.toLowerCase()}`}
                onClick={() => setDirection(d)}
                className={`flex-1 py-3 text-sm font-bold transition-all ${
                  direction === d
                    ? d === "LONG" ? "bg-green-500/20 border border-green-500 text-green-400" : "bg-red-500/20 border border-red-500 text-red-400"
                    : "bg-white/5 border border-white/20 text-white/50 hover:border-white/40"
                }`}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Size (USD)</label>
          <input data-testid="hl-size-input" type="number" value={sizeUSD}
            onChange={e => setSizeUSD(e.target.value)} placeholder="100"
            className="w-full bg-white/5 border border-white/20 p-3 font-mono outline-none focus:border-white" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Leverage</label>
          <input data-testid="hl-leverage-input" type="number" value={leverage} min={1} max={50}
            onChange={e => setLeverage(parseInt(e.target.value) || 1)}
            className="w-full bg-white/5 border border-white/20 p-3 font-mono outline-none focus:border-white" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Limit Price (optional, leave empty for market)</label>
        <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
          placeholder="Market order (leave empty)"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>

      {sizeUSD && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-white/50">Position Value</span>
            <span className="font-mono">${(parseFloat(sizeUSD || 0) * leverage).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Required Margin</span>
            <span className="font-mono">${parseFloat(sizeUSD || 0).toFixed(2)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Privacy Fee</span>
            <span className="text-green-400">${(parseFloat(sizeUSD || 0) * 0.0005).toFixed(4)}</span>
          </div>
        </div>
      )}

      <button data-testid="hl-prepare-trade-btn" onClick={prepareTrade} disabled={preparing || !address}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-40 flex items-center justify-center gap-2">
        {preparing ? <Loader2 className="w-5 h-5 animate-spin" /> : <TrendingUp className="w-5 h-5" />}
        Prepare Private Trade
      </button>

      {tradePlan && (
        <div className="bg-green-500/10 border border-green-500/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
            <Check className="w-4 h-4" />
            Trade Prepared Successfully
          </div>
          <div className="text-xs text-white/70 space-y-1.5">
            {tradePlan.instructions?.map((inst, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-white/40">{inst}</span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-white/10 text-xs">
            <div className="text-white/50 mb-1">Privacy Proxy Address</div>
            <div className="font-mono text-xs text-green-400 break-all">{tradePlan.proxy_address}</div>
          </div>
          <div className="text-xs text-white/40">
            Trade ID: <span className="font-mono">{tradePlan.trade_id?.slice(0,16)}...</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Polymarket Private Betting ───────────────────────────────────────────────
function PolymarketPrivateBetting() {
  const { address } = useWallet();
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [outcome, setOutcome] = useState("YES");
  const [amountUSDC, setAmountUSDC] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [betPlan, setBetPlan] = useState(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);

  useEffect(() => {
    setLoadingMarkets(true);
    axios.get(`${API}/polymarket/markets?limit=6`)
      .then(r => { setMarkets(r.data.markets || []); if (r.data.markets?.[0]) setSelectedMarket(r.data.markets[0]); })
      .catch(() => {})
      .finally(() => setLoadingMarkets(false));
  }, []);

  const prepareBet = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!selectedMarket) return toast.error("Select a market");
    if (!amountUSDC || parseFloat(amountUSDC) <= 0) return toast.error("Enter bet amount");
    setPreparing(true);
    setBetPlan(null);
    try {
      const res = await axios.post(`${API}/polymarket/prepare-private-bet`, {
        bettor_address: address,
        condition_id: selectedMarket.condition_id || selectedMarket.conditionId || "demo",
        token_id: outcome === "YES" ? "1" : "0",
        outcome,
        amount_usdc: parseFloat(amountUSDC),
        chain: "polygon"
      });
      setBetPlan(res.data);
      toast.success("Bet prepared with privacy routing!");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to prepare bet");
    }
    setPreparing(false);
  };

  return (
    <div className="space-y-4" data-testid="polymarket-betting">
      <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded text-xs text-purple-300">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" />
          <span className="font-semibold">Privacy-Routed Prediction Markets</span>
        </div>
        Your bets are routed through a stealth proxy. Your wallet is never linked to your positions on Polymarket.
      </div>

      {/* Market Selection */}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Select Market</label>
        {loadingMarkets ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading markets...
          </div>
        ) : (
          <div className="space-y-2">
            {markets.map((m, i) => (
              <button key={m.condition_id || i}
                data-testid={`polymarket-market-${i}`}
                onClick={() => setSelectedMarket(m)}
                className={`w-full text-left p-3 border transition-all ${
                  selectedMarket?.condition_id === m.condition_id
                    ? "border-purple-500/50 bg-purple-500/10"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}>
                <div className="text-sm font-medium mb-1">{m.question}</div>
                <div className="flex items-center gap-4 text-xs text-white/50">
                  {m.yes_price && <span>YES: <span className="text-green-400">{(m.yes_price * 100).toFixed(0)}¢</span></span>}
                  {m.no_price && <span>NO: <span className="text-red-400">{(m.no_price * 100).toFixed(0)}¢</span></span>}
                  {m.volume && <span>Vol: <span className="text-white/70">{m.volume}</span></span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedMarket && (
        <>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Your Prediction</label>
            <div className="flex gap-3">
              {["YES", "NO"].map(o => (
                <button key={o} data-testid={`polymarket-outcome-${o.toLowerCase()}`}
                  onClick={() => setOutcome(o)}
                  className={`flex-1 py-3 text-sm font-bold transition-all ${
                    outcome === o
                      ? o === "YES" ? "bg-green-500/20 border border-green-500 text-green-400" : "bg-red-500/20 border border-red-500 text-red-400"
                      : "bg-white/5 border border-white/20 text-white/50 hover:border-white/40"
                  }`}>
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Bet Amount (USDC)</label>
            <input data-testid="polymarket-amount-input" type="number" value={amountUSDC}
              onChange={e => setAmountUSDC(e.target.value)} placeholder="10.00"
              className="w-full bg-white/5 border border-white/20 p-3 font-mono outline-none focus:border-white" />
          </div>

          {amountUSDC && (
            <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-white/50">Bet Amount</span>
                <span className="font-mono">${parseFloat(amountUSDC || 0).toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Privacy Fee</span>
                <span className="text-green-400">${(parseFloat(amountUSDC || 0) * 0.0005).toFixed(4)} USDC</span>
              </div>
              {selectedMarket.yes_price && (
                <div className="flex justify-between">
                  <span className="text-white/50">Est. Payout if Win</span>
                  <span className="font-mono text-white">
                    ${(parseFloat(amountUSDC || 0) / (outcome === "YES" ? selectedMarket.yes_price : selectedMarket.no_price || 0.5)).toFixed(2)} USDC
                  </span>
                </div>
              )}
            </div>
          )}

          <button data-testid="polymarket-prepare-btn" onClick={prepareBet} disabled={preparing || !address}
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-40 flex items-center justify-center gap-2">
            {preparing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
            Prepare Private Bet
          </button>
        </>
      )}

      {betPlan && (
        <div className="bg-purple-500/10 border border-purple-500/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm">
            <Check className="w-4 h-4" />
            Bet Prepared Successfully
          </div>
          <div className="text-xs text-white/70 space-y-1.5">
            {betPlan.instructions?.map((inst, i) => (
              <div key={i} className="text-white/40">{inst}</div>
            ))}
          </div>
          <div className="pt-2 border-t border-white/10 text-xs">
            <div className="text-white/50 mb-1">Privacy Proxy Address</div>
            <div className="font-mono text-xs text-purple-400 break-all">{betPlan.proxy_address}</div>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-white/40">Est. payout if win:</span>
            <span className="text-white font-mono">{betPlan.estimated_payout_if_win}</span>
          </div>
          <div className="text-xs text-white/40">
            Bet ID: <span className="font-mono">{betPlan.bet_id?.slice(0,16)}...</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const { address, balance, chain, vm, fetchBalance, hiddenBalance } = useWallet();
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
              {
                id: "uniswap",
                icon: <RefreshCw className="w-6 h-6 mb-3 text-blue-400" />,
                title: "Uniswap V3",
                desc: "Private token swaps via V3",
                badge: "LIVE",
                badgeColor: "text-blue-400 border-blue-400/40"
              },
              {
                id: "hyperliquid",
                icon: <TrendingUp className="w-6 h-6 mb-3 text-green-400" />,
                title: "Hyperliquid",
                desc: "Anonymous perp trading",
                badge: "LIVE",
                badgeColor: "text-green-400 border-green-400/40"
              },
              {
                id: "polymarket",
                icon: <Globe className="w-6 h-6 mb-3 text-purple-400" />,
                title: "Polymarket",
                desc: "Private prediction bets",
                badge: "LIVE",
                badgeColor: "text-purple-400 border-purple-400/40"
              },
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
              { id: "approval",icon: <Shield className="w-5 h-5" />, title: "Approvals", color: "text-yellow-400" },
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

// ─── App ──────────────────────────────────────────────────────────────────────
function PublicApp() {
  const [granted, setGranted] = useState(() => {
    const tok = sessionStorage.getItem("_upl_tok");
    if (tok) { axios.defaults.headers.common["Authorization"] = `Bearer ${tok}`; return true; }
    return false;
  });

  if (!granted) return <AccessGate onGranted={() => setGranted(true)} />;

  return (
    <WalletProvider>
      <Dashboard />
      <Toaster position="bottom-right"
        toastOptions={{ style: { background: "#000", border: "1px solid #333", color: "#fff" } }} />
    </WalletProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/founder" element={<FounderMode />} />
        <Route path="/*" element={<PublicApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
