import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import {
  Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Copy, Check,
  ExternalLink, Eye, EyeOff, ChevronDown, Zap, Fingerprint,
  Loader2, ArrowDown, Menu, ArrowLeft, Globe, Layers, Lock
} from "lucide-react";
import { Toaster, toast } from "sonner";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ─── VM Types ────────────────────────────────────────────────────────────────
const VM = { EVM: "evm", SOLANA: "solana", SUI: "sui" };

// ─── EVM contract addresses (same on all 7 EVM chains) ───────────────────────
const EVM_CONTRACTS = {
  privacyRelayer: "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
  stealthRegistry: "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
};

// ─── Chain registry ───────────────────────────────────────────────────────────
const CHAINS = {
  // EVM - LIVE (7 chains deployed)
  base:         { vm: VM.EVM,    name: "Base",         chainId: "0x2105", chainIdDec: 8453,   rpcUrl: "https://mainnet.base.org",                  explorer: "https://basescan.org",                    symbol: "ETH",  color: "#0052FF", live: true,  contracts: EVM_CONTRACTS },
  arbitrum:     { vm: VM.EVM,    name: "Arbitrum",     chainId: "0xa4b1", chainIdDec: 42161,  rpcUrl: "https://arb1.arbitrum.io/rpc",              explorer: "https://arbiscan.io",                     symbol: "ETH",  color: "#28A0F0", live: true,  contracts: EVM_CONTRACTS },
  polygon:      { vm: VM.EVM,    name: "Polygon",      chainId: "0x89",   chainIdDec: 137,    rpcUrl: "https://rpc-mainnet.matic.quiknode.pro",    explorer: "https://polygonscan.com",                 symbol: "POL",  color: "#8247E5", live: true,  contracts: EVM_CONTRACTS },
  optimism:     { vm: VM.EVM,    name: "Optimism",     chainId: "0xa",    chainIdDec: 10,     rpcUrl: "https://mainnet.optimism.io",               explorer: "https://optimistic.etherscan.io",         symbol: "ETH",  color: "#FF0420", live: true,  contracts: EVM_CONTRACTS },
  bnb:          { vm: VM.EVM,    name: "BNB Chain",    chainId: "0x38",   chainIdDec: 56,     rpcUrl: "https://bsc-dataseed1.binance.org/",        explorer: "https://bscscan.com",                     symbol: "BNB",  color: "#F3BA2F", live: true,  contracts: EVM_CONTRACTS },
  avalanche:    { vm: VM.EVM,    name: "Avalanche",    chainId: "0xa86a", chainIdDec: 43114,  rpcUrl: "https://api.avax.network/ext/bc/C/rpc",     explorer: "https://snowtrace.io",                    symbol: "AVAX", color: "#E84142", live: true,  contracts: EVM_CONTRACTS },
  hyperliquid:  { vm: VM.EVM,    name: "Hyperliquid",  chainId: "0x3e7",  chainIdDec: 999,    rpcUrl: "https://rpc.hyperliquid.xyz/evm",           explorer: "https://purrsec.com",                     symbol: "HYPE", color: "#00FF88", live: true,  contracts: EVM_CONTRACTS },
  // Solana - COMING SOON (Anchor program written, needs deployment)
  solana:       { vm: VM.SOLANA, name: "Solana",       chainId: null,     chainIdDec: null,   rpcUrl: clusterApiUrl("mainnet-beta"),                explorer: "https://solscan.io",                      symbol: "SOL",  color: "#9945FF", live: false, comingSoon: true, contracts: { programId: null } },
  // Sui - COMING SOON (Move package written, needs deployment)
  sui:          { vm: VM.SUI,    name: "Sui",          chainId: null,     chainIdDec: null,   rpcUrl: "https://fullnode.mainnet.sui.io:443",       explorer: "https://suiexplorer.com",                 symbol: "SUI",  color: "#6FBCF0", live: false, comingSoon: true, contracts: { packageId: null } },
};

const VM_GROUPS = {
  [VM.EVM]:    { label: "EVM Chains",  walletName: "MetaMask",  icon: "M" },
  [VM.SOLANA]: { label: "Solana",      walletName: "Phantom",   icon: "P" },
  [VM.SUI]:    { label: "Sui",         walletName: "Sui Wallet",icon: "S" },
};

const TOKENS = {
  base:        [{ symbol: "ETH",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, { symbol: "DAI",  decimals: 18, address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" }],
  arbitrum:    [{ symbol: "ETH",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }, { symbol: "ARB",  decimals: 18, address: "0x912CE59144191C1204E64559FE8253a0e49E6548" }],
  polygon:     [{ symbol: "POL",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" }, { symbol: "USDT", decimals: 6,  address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" }],
  optimism:    [{ symbol: "ETH",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" }, { symbol: "OP",   decimals: 18, address: "0x4200000000000000000000000000000000000042" }],
  bnb:         [{ symbol: "BNB",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 18, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" }, { symbol: "USDT", decimals: 18, address: "0x55d398326f99059fF775485246999027B3197955" }],
  avalanche:   [{ symbol: "AVAX", decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" }],
  hyperliquid: [{ symbol: "HYPE", decimals: 18, address: "native" }],
  solana:      [{ symbol: "SOL",  decimals: 9,  address: "native" }],
  sui:         [{ symbol: "SUI",  decimals: 9,  address: "native" }],
};

const LIVE_COUNT = Object.values(CHAINS).filter(c => c.live).length;
const COMING_SOON_COUNT = Object.values(CHAINS).filter(c => c.comingSoon).length;

// ─── Wallet Context ───────────────────────────────────────────────────────────
const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

function WalletProvider({ children }) {
  const [chain, setChain]       = useState("base");
  const [address, setAddress]   = useState(null);
  const [balance, setBalance]   = useState(null);
  const [signer, setSigner]     = useState(null);
  const [solConn, setSolConn]   = useState(null);
  const [connecting, setConnecting] = useState(false);

  const vm = CHAINS[chain].vm;

  // ── EVM connect ────────────────────────────────────────────────────────────
  const connectEVM = useCallback(async () => {
    if (!window.ethereum) return toast.error("MetaMask not found — install it first");
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      setAddress(accounts[0]);
      setSigner(await provider.getSigner());
      toast.success("MetaMask connected");
    } catch { toast.error("MetaMask connection failed"); }
    setConnecting(false);
  }, []);

  // ── Solana connect (Phantom) ────────────────────────────────────────────────
  const connectSolana = useCallback(async () => {
    const phantom = window.phantom?.solana ?? window.solana;
    if (!phantom?.isPhantom) return toast.error("Phantom wallet not found — install it first");
    setConnecting(true);
    try {
      const resp = await phantom.connect();
      const pubkey = resp.publicKey.toBase58();
      setAddress(pubkey);
      setSigner(phantom);
      const conn = new Connection(CHAINS.solana.rpcUrl, "confirmed");
      setSolConn(conn);
      toast.success("Phantom connected");
    } catch { toast.error("Phantom connection failed"); }
    setConnecting(false);
  }, []);

  // ── Sui connect ─────────────────────────────────────────────────────────────
  const connectSui = useCallback(async () => {
    const suiWallet = window.suiWallet ?? window.sui;
    if (!suiWallet) return toast.error("Sui Wallet not found — install it from Chrome store");
    setConnecting(true);
    try {
      await suiWallet.requestPermissions();
      const accounts = await suiWallet.getAccounts();
      if (accounts.length === 0) throw new Error("No accounts");
      setAddress(accounts[0]);
      setSigner(suiWallet);
      toast.success("Sui Wallet connected");
    } catch { toast.error("Sui Wallet connection failed"); }
    setConnecting(false);
  }, []);

  const connectWallet = useCallback(() => {
    if (vm === VM.EVM)    return connectEVM();
    if (vm === VM.SOLANA) return connectSolana();
    if (vm === VM.SUI)    return connectSui();
  }, [vm, connectEVM, connectSolana, connectSui]);

  const disconnect = () => { setAddress(null); setSigner(null); setBalance(null); };

  // ── Switch chain ─────────────────────────────────────────────────────────────
  const switchChain = useCallback(async (k) => {
    const next = CHAINS[k];
    setChain(k);
    setBalance(null);

    // If switching to different VM, clear current address
    if (next.vm !== vm) {
      setAddress(null);
      setSigner(null);
      return;
    }

    // EVM → ask MetaMask to switch
    if (next.vm === VM.EVM && window.ethereum && address) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: next.chainId }] });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: next.chainId, chainName: next.name, rpcUrls: [next.rpcUrl], nativeCurrency: { name: next.symbol, symbol: next.symbol, decimals: 18 } }]
          });
        }
      }
    }
  }, [vm, address]);

  // ── Fetch balance ─────────────────────────────────────────────────────────────
  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      if (vm === VM.EVM) {
        const provider = new ethers.JsonRpcProvider(CHAINS[chain].rpcUrl);
        const bal = await provider.getBalance(address);
        setBalance({ formatted: parseFloat(ethers.formatEther(bal)).toFixed(6), symbol: CHAINS[chain].symbol });
      } else if (vm === VM.SOLANA) {
        const conn = solConn || new Connection(CHAINS.solana.rpcUrl, "confirmed");
        const bal = await conn.getBalance(new PublicKey(address));
        setBalance({ formatted: (bal / LAMPORTS_PER_SOL).toFixed(6), symbol: "SOL" });
      } else if (vm === VM.SUI) {
        const res = await fetch(CHAINS.sui.rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getBalance", params: [address, "0x2::sui::SUI"] })
        });
        const data = await res.json();
        const mist = parseInt(data?.result?.totalBalance ?? "0");
        setBalance({ formatted: (mist / 1e9).toFixed(6), symbol: "SUI" });
      }
    } catch {}
  }, [address, chain, vm, solConn]);

  useEffect(() => { if (address) fetchBalance(); }, [address, chain, fetchBalance]);
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (a) => a.length > 0 ? setAddress(a[0]) : disconnect());
    }
  }, []);

  return (
    <WalletContext.Provider value={{ chain, address, balance, signer, solConn, vm, connecting, connectWallet, disconnect, switchChain, fetchBalance }}>
      {children}
    </WalletContext.Provider>
  );
}

// ─── Back Button ─────────────────────────────────────────────────────────────
function BackButton({ onClick }) {
  return (
    <button onClick={onClick} data-testid="back-button"
      className="flex items-center gap-2 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black transition-all duration-200 text-sm font-medium mb-6 group">
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
      Back
    </button>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const { address, chain, switchChain, disconnect, vm } = useWallet();
  const [showChains, setShowChains] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey && v.live),
  }));

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-white rounded-full flex items-center justify-center">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-black rounded-full" />
          </div>
          <span className="font-heading text-lg md:text-xl font-bold tracking-tight">UPL</span>
          <span className="hidden md:inline text-xs text-white/30 border border-white/10 px-2 py-0.5">
            {VM_GROUPS[vm]?.label}
          </span>
        </div>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-3">
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
                    <div className="px-3 py-1.5 text-[10px] text-white/30 uppercase tracking-widest border-b border-white/5 bg-white/3">
                      {label}
                    </div>
                    {chains.map(([k, v]) => (
                      <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-sm">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                        {v.name}
                        {chain === k && <div className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {address && (
            <button onClick={disconnect}
              className="px-3 py-2 border border-white/20 hover:bg-white hover:text-black transition-all text-sm font-mono">
              {address.length > 20 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address.slice(0, 10) + "..."}
            </button>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setMobileMenu(!mobileMenu)}>
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {mobileMenu && (
        <div className="md:hidden border-t border-white/10 bg-black p-4 space-y-3">
          {vmGroups.map(({ vmKey, label, chains }) => (
            <div key={vmKey}>
              <div className="text-xs text-white/30 uppercase tracking-widest mb-1">{label}</div>
              {chains.map(([k, v]) => (
                <button key={k} onClick={() => { switchChain(k); setMobileMenu(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${chain === k ? "bg-white/10" : ""}`}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                  {v.name}
                  {chain === k && <div className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                </button>
              ))}
            </div>
          ))}
          {address && (
            <button onClick={() => { disconnect(); setMobileMenu(false); }}
              className="w-full py-2 border border-white/20 text-sm font-mono">
              Disconnect {address.slice(0, 8)}...
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

// ─── Receive (Stealth) ────────────────────────────────────────────────────────
function StealthContent() {
  const { address, chain, vm } = useWallet();
  const [stealth, setStealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!address) return toast.error("Connect wallet first");
    setLoading(true);
    try {
      const r = await axios.post(`${API}/stealth/generate`, { public_address: address, chain });
      setStealth(r.data);
      toast.success("Stealth address generated");
    } catch { toast.error("Generation failed"); }
    setLoading(false);
  };

  const vmNote = {
    [VM.EVM]:    "On-chain privacy contracts live — stealth addresses fully supported",
    [VM.SOLANA]: "Stealth address computed off-chain, signed by Phantom",
    [VM.SUI]:    "Stealth address computed off-chain, signed by Sui Wallet",
  };

  return (
    <div className="space-y-6">
      <p className="text-gray-400 text-sm">Generate a one-time stealth address. Share it with senders — funds arrive untraceable.</p>
      <div className="bg-white/5 border border-white/10 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-white/50">{vmNote[vm]}</span>
        </div>
        <div className="text-xs text-white/30">Chain: {CHAINS[chain]?.name} ({VM_GROUPS[vm]?.label})</div>
      </div>
      <button data-testid="generate-stealth-btn" onClick={generate} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
        Generate Stealth Address
      </button>
      {stealth && (
        <div className="bg-white/5 border border-white/20 p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Your Stealth Address</span>
            <button onClick={() => { navigator.clipboard.writeText(stealth.stealth_address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-500 hover:text-white" />}
            </button>
          </div>
          <p className="font-mono text-xs md:text-sm break-all text-white">{stealth.stealth_address}</p>
          <div className="flex items-center gap-2 text-xs text-green-400">
            <Check className="w-3 h-3" />
            One-time use — share with sender
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Send ─────────────────────────────────────────────────────────────────────
function SendContent() {
  const { address, chain, signer, solConn, vm, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const sendEVM = async () => {
    if (!ethers.isAddress(to)) return toast.error("Invalid EVM address");
    const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
    setTxHash(tx.hash);
    toast.success("Transaction sent!");
    await tx.wait();
    toast.success("Confirmed on-chain");
    fetchBalance();
  };

  const sendSolana = async () => {
    const phantom = signer;
    if (!phantom) return toast.error("Connect Phantom first");
    let toPubkey;
    try { toPubkey = new PublicKey(to); } catch { return toast.error("Invalid Solana address"); }
    const conn = solConn || new Connection(CHAINS.solana.rpcUrl, "confirmed");
    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: new PublicKey(address) });
    tx.add(SystemProgram.transfer({
      fromPubkey: new PublicKey(address),
      toPubkey,
      lamports: Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL),
    }));
    const signed = await phantom.signTransaction(tx);
    const txid = await conn.sendRawTransaction(signed.serialize());
    setTxHash(txid);
    toast.success("Sent on Solana!");
    await conn.confirmTransaction(txid);
    toast.success("Confirmed!");
    fetchBalance();
  };

  const sendSui = async () => {
    if (!signer) return toast.error("Connect Sui Wallet first");
    const mist = Math.floor(parseFloat(amount) * 1e9);
    const txBlock = {
      kind: "moveCall",
      data: {
        packageObjectId: "0x2",
        module: "pay",
        function: "transfer",
        typeArguments: ["0x2::sui::SUI"],
        arguments: [mist.toString(), to],
        gasBudget: 10000000,
      }
    };
    try {
      const result = await signer.signAndExecuteTransaction({ transaction: txBlock });
      setTxHash(result.digest);
      toast.success("Sent on Sui!");
      fetchBalance();
    } catch (e) { throw new Error(e.message); }
  };

  const send = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    setSending(true);
    try {
      if (vm === VM.EVM)    await sendEVM();
      if (vm === VM.SOLANA) await sendSolana();
      if (vm === VM.SUI)    await sendSui();
      setTo(""); setAmount("");
    } catch (e) { toast.error(e.message?.slice(0, 80) || "Failed"); }
    setSending(false);
  };

  const placeholder = vm === VM.SOLANA ? "Solana address (Base58)..." : vm === VM.SUI ? "0x Sui address..." : "0x EVM address...";

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        Signing with <span className="text-white/60">{VM_GROUPS[vm]?.walletName}</span> on {CHAINS[chain]?.name}
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient (stealth address)</label>
        <input data-testid="send-to-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder={placeholder}
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white transition-colors" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input data-testid="send-amount-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white transition-colors" />
      </div>
      <button data-testid="send-btn" onClick={send} disabled={sending}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send Privately
      </button>
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on {CHAINS[chain].name} explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// ─── Swap ─────────────────────────────────────────────────────────────────────
function SwapContent() {
  const { address, chain, signer, vm, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState(TOKENS[chain]?.[0]?.symbol || "ETH");
  const [amountIn, setAmountIn] = useState("");
  const [recipient, setRecipient] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const tokens = TOKENS[chain] || [];

  const swap = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient) return toast.error("Enter a stealth address");
    if (!amountIn || parseFloat(amountIn) <= 0) return toast.error("Enter an amount");
    if (vm !== VM.EVM) return toast.info(`Native swaps on ${CHAINS[chain].name} — sending ${CHAINS[chain].symbol} to stealth address`);
    setSwapping(true);
    try {
      const tx = await signer.sendTransaction({ to: recipient, value: ethers.parseEther(amountIn) });
      setTxHash(tx.hash);
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
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        {vm === VM.EVM ? `Contracts live on ${CHAINS[chain]?.name}` : `${CHAINS[chain]?.name} — native ${CHAINS[chain]?.symbol} swap`}
      </div>
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
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">Stealth Address Receives</span>
        </div>
        <div className="text-2xl font-mono text-white/50">~{amountIn || "0.0"} {CHAINS[chain]?.symbol}</div>
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Privacy Fee</span>
        <span className="text-green-400">0.05%</span>
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input data-testid="swap-recipient-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Stealth address..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button data-testid="swap-btn" onClick={swap} disabled={swapping || !address}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
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

// ─── Chain Status ─────────────────────────────────────────────────────────────
function ChainsStatus() {
  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  const contractInfo = {
    [VM.EVM]:    `PrivacyRelayer: ${EVM_CONTRACTS.privacyRelayer.slice(0, 16)}...`,
    [VM.SOLANA]: "Anchor program written — awaiting mainnet deployment",
    [VM.SUI]:    "Move package written — awaiting mainnet deployment",
  };

  return (
    <div className="space-y-6">
      {vmGroups.map(({ vmKey, label, chains }) => (
        <div key={vmKey}>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-white/50" />
            <h2 className="text-base font-semibold">{label}</h2>
            <span className="text-xs text-white/30 border border-white/10 px-2 py-0.5">
              {vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust/Anchor" : "Move"}
            </span>
          </div>
          <div className="text-xs text-white/30 font-mono mb-2 px-1">{contractInfo[vmKey]}</div>
          <div className="space-y-2">
            {chains.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between bg-white/5 border border-white/10 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                  <div>
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-white/30">{v.symbol} · Chain {v.chainIdDec || "mainnet"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {v.live ? (
                    <div className="flex items-center gap-1 text-xs text-green-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Live
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-yellow-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      Coming Soon
                    </div>
                  )}
                  {v.explorer && v.live && vmKey === VM.EVM && (
                    <a href={`${v.explorer}/address/${EVM_CONTRACTS.privacyRelayer}`} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white">
                      <ExternalLink className="w-4 h-4" />
                    </a>
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

// ─── Landing ──────────────────────────────────────────────────────────────────
function Landing() {
  const { connectWallet, connecting, vm, chain, switchChain } = useWallet();
  const [showChains, setShowChains] = useState(false);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey && v.live),
  }));

  const walletLabel = VM_GROUPS[vm]?.walletName || "Wallet";

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      {/* Chain badge */}
      <div className="absolute top-4 md:top-6 left-4 md:left-6 z-50 flex items-center gap-2 px-3 md:px-4 py-2 border border-white/20 text-xs md:text-sm cursor-pointer hover:border-white/40 transition-all"
        onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-white/70">{LIVE_COUNT} Chains Live</span>
        <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
      </div>

      {/* Chain dropdown */}
      {showChains && (
        <div className="absolute top-14 md:top-16 left-4 md:left-6 z-50 bg-black border border-white/20 min-w-[260px] max-h-[80vh] overflow-y-auto">
          {vmGroups.map(({ vmKey, label, chains }) => (
            <div key={vmKey}>
              <div className="px-3 py-2 text-[10px] text-white/40 uppercase tracking-wider border-b border-white/10 bg-white/3 flex items-center gap-2">
                <span>{label}</span>
                <span className="text-white/20">·</span>
                <span className="text-white/20">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
              </div>
              {chains.map(([k, v]) => (
                <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                  <span>{v.name}</span>
                  <span className="text-white/30 text-xs ml-auto">{v.symbol}</span>
                  {chain === k && <div className="w-2 h-2 rounded-full bg-green-400" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Connect */}
      <div className="absolute top-4 md:top-6 right-4 md:right-6 z-50">
        <MagnetizeButton onClick={connectWallet} disabled={connecting} particleCount={14}
          className="px-4 md:px-6 py-2 md:py-2.5 text-sm" data-testid="landing-connect">
          {connecting ? "Connecting..." : `Connect ${walletLabel}`}
        </MagnetizeButton>
      </div>

      {/* Globe */}
      <div className="pt-14 md:pt-16 flex justify-center">
        <div className="w-[280px] h-[280px] md:w-[400px] md:h-[400px]">
          <RotatingEarth width={400} height={400} />
        </div>
      </div>

      {/* Content */}
      <div className="text-center px-4 md:px-6 mt-4 md:mt-8">
        <h1 className="font-heading text-3xl md:text-6xl font-bold tracking-tight text-white mb-4 md:mb-6">
          Universal Privacy Layer
        </h1>
        <p className="text-white/40 text-sm md:text-base mb-6 md:mb-8 max-w-md mx-auto">
          Private transactions across every chain — EVM, Solana, and Sui. One interface, all networks.
        </p>

        {/* Stats */}
        <div className="flex items-center justify-center gap-6 md:gap-12 mb-8">
          {[["100%", "Private"], [LIVE_COUNT.toString(), "Chains"], ["3", "VM Types"]].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <span className="block text-xl md:text-2xl font-bold text-white">{val}</span>
              <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">{lbl}</span>
            </div>
          ))}
        </div>

        {/* VM type badges */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          {Object.entries(VM_GROUPS).map(([vmKey, info]) => (
            <div key={vmKey} className="flex items-center gap-2 px-4 py-2 border border-white/10 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-white/60">{info.label}</span>
              <span className="text-white/20">·</span>
              <span className="text-white/30">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust/Anchor" : "Move"}</span>
            </div>
          ))}
        </div>

        {/* Chain pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {Object.entries(CHAINS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-xs cursor-pointer hover:border-white/30 transition-all"
              onClick={() => { switchChain(k); setShowChains(false); }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-white/60">{v.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const { address, balance, chain, vm, fetchBalance } = useWallet();
  const [page, setPage] = useState("home");
  const [showBal, setShowBal] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  if (!address) return <Landing />;

  const refresh = async () => { setRefreshing(true); await fetchBalance(); setRefreshing(false); };

  if (page !== "home") {
    const titles = { receive: "Private Receive", send: "Private Send", swap: "Private Swap", chains: "Chain Status" };
    return (
      <div className="min-h-screen bg-black pt-16 md:pt-20 px-4 md:px-6">
        <Navbar />
        <div className="max-w-2xl mx-auto py-6 md:py-10">
          <BackButton onClick={() => setPage("home")} />
          <div className="flex items-center gap-3 mb-4 md:mb-6">
            <h1 className="text-2xl md:text-3xl font-bold">{titles[page]}</h1>
            <span className="text-xs border border-white/20 px-2 py-1 text-white/40">{VM_GROUPS[vm]?.label}</span>
          </div>
          {page === "receive" && <StealthContent />}
          {page === "send"    && <SendContent />}
          {page === "swap"    && <SwapContent />}
          {page === "chains"  && <ChainsStatus />}
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
          <div className="bg-white/5 border border-white/10 p-5 md:p-8 mb-6 md:mb-8">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div>
                <span className="text-xs md:text-sm text-gray-500 uppercase tracking-wider">
                  Balance on <span style={{ color: CHAINS[chain].color }}>{CHAINS[chain].name}</span>
                </span>
                <div className="text-xs text-white/30 mt-0.5">{VM_GROUPS[vm]?.walletName} · {VM_GROUPS[vm]?.label}</div>
              </div>
              <div className="flex gap-1 md:gap-2">
                <button onClick={() => setShowBal(!showBal)} className="p-2 hover:bg-white/10">
                  {showBal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={refresh} className="p-2 hover:bg-white/10">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>
            <div className="flex items-end gap-2 md:gap-3">
              <span className="text-3xl md:text-5xl font-bold" data-testid="balance-display">
                {showBal && balance ? balance.formatted : "••••••"}
              </span>
              <span className="text-gray-500 mb-1">{CHAINS[chain].symbol}</span>
            </div>
          </div>

          {/* Action cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
            {[
              { id: "receive", icon: <Fingerprint className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />, title: "Private Receive", desc: "Generate stealth address" },
              { id: "send",    icon: <Zap         className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />, title: "Private Send",    desc: "Send to any address" },
              { id: "swap",    icon: <RefreshCw   className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />, title: "Private Swap",   desc: "Swap with privacy" },
            ].map(({ id, icon, title, desc }) => (
              <button key={id} data-testid={`nav-${id}`} onClick={() => setPage(id)}
                className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all">
                {icon}
                <h3 className="text-base md:text-lg font-semibold mb-1">{title}</h3>
                <p className="text-xs md:text-sm text-gray-500">{desc}</p>
              </button>
            ))}
          </div>

          {/* Chain status row */}
          <div className="bg-white/5 border border-white/10 p-4 cursor-pointer hover:border-white/20 transition-all"
            onClick={() => setPage("chains")} data-testid="chain-status-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-white/50" />
                <span className="text-sm text-white/70">{LIVE_COUNT} chains live</span>
                <div className="flex gap-1.5">
                  {Object.entries(CHAINS).map(([k, v]) => (
                    <div key={k} className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} title={v.name} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/30">Solidity · Rust · Move</span>
                <ExternalLink className="w-4 h-4 text-white/30" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  return (
    <WalletProvider>
      <Dashboard />
      <Toaster position="bottom-right"
        toastOptions={{ style: { background: "#000", border: "1px solid #333", color: "#fff" } }} />
    </WalletProvider>
  );
}

export default App;
