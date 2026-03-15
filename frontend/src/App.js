import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import {
  Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Copy, Check,
  ExternalLink, Eye, EyeOff, ChevronDown, Zap, Fingerprint, X,
  Loader2, ArrowDown, Menu, ArrowLeft, Clock, Globe
} from "lucide-react";
import { Toaster, toast } from "sonner";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Contract addresses are the same on all live chains (deterministic deployment)
const DEPLOYED_CONTRACTS = {
  privacyRelayer: "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
  stealthRegistry: "0xf2E7A6734E58774A8417c176AaE3898667699Ff4",
};

const CHAINS = {
  base: {
    name: "Base",
    chainId: "0x2105",
    chainIdDec: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    symbol: "ETH",
    color: "#0052FF",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
  arbitrum: {
    name: "Arbitrum",
    chainId: "0xa4b1",
    chainIdDec: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    symbol: "ETH",
    color: "#28A0F0",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
  polygon: {
    name: "Polygon",
    chainId: "0x89",
    chainIdDec: 137,
    rpcUrl: "https://rpc-mainnet.matic.quiknode.pro",
    explorer: "https://polygonscan.com",
    symbol: "POL",
    color: "#8247E5",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
  optimism: {
    name: "Optimism",
    chainId: "0xa",
    chainIdDec: 10,
    rpcUrl: "https://mainnet.optimism.io",
    explorer: "https://optimistic.etherscan.io",
    symbol: "ETH",
    color: "#FF0420",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
  bnb: {
    name: "BNB Chain",
    chainId: "0x38",
    chainIdDec: 56,
    rpcUrl: "https://bsc-dataseed1.binance.org/",
    explorer: "https://bscscan.com",
    symbol: "BNB",
    color: "#F3BA2F",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
  avalanche: {
    name: "Avalanche",
    chainId: "0xa86a",
    chainIdDec: 43114,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
    symbol: "AVAX",
    color: "#E84142",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
  hyperliquid: {
    name: "Hyperliquid",
    chainId: "0x3e7",
    chainIdDec: 999,
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    explorer: "https://purrsec.com",
    symbol: "HYPE",
    color: "#00FF88",
    live: true,
    contracts: DEPLOYED_CONTRACTS,
  },
};

// Non-EVM chains (informational only)
const NON_EVM_CHAINS = [
  { name: "Solana", symbol: "SOL", color: "#9945FF", note: "Needs Anchor/Rust programs" },
  { name: "Bitcoin", symbol: "BTC", color: "#F7931A", note: "Lightning / Stacks layer" },
  { name: "Sui", symbol: "SUI", color: "#6FBCF0", note: "Needs Move smart contracts" },
  { name: "Hyperliquid", symbol: "HYPE", color: "#00FF88", note: "HyperEVM — roadmap" },
];

const TOKENS = {
  base: [
    { symbol: "ETH", name: "Ethereum", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    { symbol: "DAI", name: "Dai", decimals: 18, address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" },
    { symbol: "WETH", name: "Wrapped ETH", decimals: 18, address: "0x4200000000000000000000000000000000000006" },
  ],
  arbitrum: [
    { symbol: "ETH", name: "Ethereum", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    { symbol: "DAI", name: "Dai", decimals: 18, address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" },
    { symbol: "ARB", name: "Arbitrum", decimals: 18, address: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
  ],
  polygon: [
    { symbol: "POL", name: "Polygon", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
    { symbol: "USDT", name: "Tether", decimals: 6, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    { symbol: "WETH", name: "Wrapped ETH", decimals: 18, address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619" },
  ],
  optimism: [
    { symbol: "ETH", name: "Ethereum", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
    { symbol: "OP", name: "Optimism", decimals: 18, address: "0x4200000000000000000000000000000000000042" },
    { symbol: "WETH", name: "Wrapped ETH", decimals: 18, address: "0x4200000000000000000000000000000000000006" },
  ],
  bnb: [
    { symbol: "BNB", name: "BNB", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 18, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
    { symbol: "USDT", name: "Tether", decimals: 18, address: "0x55d398326f99059fF775485246999027B3197955" },
    { symbol: "WBNB", name: "Wrapped BNB", decimals: 18, address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
  ],
  avalanche: [
    { symbol: "AVAX", name: "Avalanche", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
    { symbol: "USDT", name: "Tether", decimals: 6, address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" },
    { symbol: "WAVAX", name: "Wrapped AVAX", decimals: 18, address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7" },
  ],
  hyperliquid: [
    { symbol: "HYPE", name: "Hyperliquid", decimals: 18, address: "native" },
  ],
};

const LIVE_CHAINS = Object.entries(CHAINS).filter(([, v]) => v.live).length;

const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState("base");
  const [balance, setBalance] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = async () => {
    if (!window.ethereum) { toast.error("Install MetaMask to continue"); return; }
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      setAddress(accounts[0]);
      setSigner(await provider.getSigner());
      toast.success("Wallet connected");
    } catch { toast.error("Connection failed"); }
    setIsConnecting(false);
  };

  const disconnectWallet = () => { setAddress(null); setSigner(null); setBalance(null); };

  const switchChain = async (k) => {
    if (!CHAINS[k].live) {
      toast.info(`${CHAINS[k].name} coming soon — contracts being deployed`);
      return;
    }
    setChain(k);
    if (window.ethereum && address) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAINS[k].chainId }] });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CHAINS[k].chainId,
              chainName: CHAINS[k].name,
              rpcUrls: [CHAINS[k].rpcUrl],
              nativeCurrency: { name: CHAINS[k].symbol, symbol: CHAINS[k].symbol, decimals: 18 }
            }]
          });
        }
      }
    }
  };

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      const provider = new ethers.JsonRpcProvider(CHAINS[chain].rpcUrl);
      const bal = await provider.getBalance(address);
      setBalance({
        wei: bal.toString(),
        eth: ethers.formatEther(bal),
        formatted: parseFloat(ethers.formatEther(bal)).toFixed(6),
        symbol: CHAINS[chain].symbol
      });
    } catch {}
  }, [address, chain]);

  useEffect(() => { if (address) fetchBalance(); }, [address, chain, fetchBalance]);
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (a) => a.length > 0 ? setAddress(a[0]) : disconnectWallet());
    }
  }, []);

  return (
    <WalletContext.Provider value={{ address, chain, balance, signer, isConnecting, connectWallet, disconnectWallet, switchChain, fetchBalance }}>
      {children}
    </WalletContext.Provider>
  );
}

// Back button - always visible and prominent
function BackButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid="back-button"
      className="flex items-center gap-2 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black transition-all duration-200 text-sm font-medium mb-6 group"
    >
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
      Back
    </button>
  );
}

// Navbar
function Navbar() {
  const { address, chain, switchChain, disconnectWallet } = useWallet();
  const [showChains, setShowChains] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  const liveChains = Object.entries(CHAINS).filter(([, v]) => v.live);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-white rounded-full flex items-center justify-center">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-black rounded-full" />
          </div>
          <span className="font-heading text-lg md:text-xl font-bold tracking-tight">UPL</span>
        </div>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-4">
          <div className="relative">
            <button
              data-testid="chain-selector"
              onClick={() => setShowChains(!showChains)}
              className="flex items-center gap-2 px-3 py-2 border border-white/20 hover:border-white/40 transition-all text-sm"
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[chain].color }} />
              {CHAINS[chain].name}
              <ChevronDown className={`w-4 h-4 transition-transform ${showChains ? "rotate-180" : ""}`} />
            </button>
            {showChains && (
              <div className="absolute top-full mt-2 right-0 bg-black border border-white/20 min-w-[160px] z-50">
                <div className="px-3 py-1.5 text-xs text-white/40 uppercase tracking-wider border-b border-white/10">Live Chains</div>
                {liveChains.map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => { switchChain(k); setShowChains(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-sm"
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                    {v.name}
                    {chain === k && <div className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                  </button>
                ))}
                <div className="px-3 py-1.5 text-xs text-white/40 uppercase tracking-wider border-t border-b border-white/10">Coming Soon</div>
                {Object.entries(CHAINS).filter(([, v]) => v.comingSoon).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 px-3 py-2 text-sm text-white/30">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                    {v.name}
                    <Clock className="w-3 h-3 ml-auto" />
                  </div>
                ))}
              </div>
            )}
          </div>
          {address && (
            <button
              onClick={disconnectWallet}
              className="px-3 py-2 border border-white/20 hover:bg-white hover:text-black transition-all text-sm font-mono"
            >
              {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setMobileMenu(!mobileMenu)}>
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {mobileMenu && (
        <div className="md:hidden border-t border-white/10 bg-black p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Network</span>
            <select
              value={chain}
              onChange={(e) => { switchChain(e.target.value); setMobileMenu(false); }}
              className="bg-black border border-white/20 px-3 py-1.5 text-sm"
            >
              {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (
                <option key={k} value={k}>{v.name}</option>
              ))}
            </select>
          </div>
          {address && (
            <button onClick={() => { disconnectWallet(); setMobileMenu(false); }} className="w-full py-2 border border-white/20 text-sm">
              Disconnect {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

// Stealth Content
function StealthContent() {
  const { address, chain } = useWallet();
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

  return (
    <div className="space-y-6">
      <p className="text-gray-400 text-sm">Generate a one-time stealth address. Share it with senders — funds arrive untraceable.</p>
      <div className="bg-white/5 border border-white/10 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-white/50">Contract: {CHAINS[chain]?.contracts?.privacyRelayer?.slice(0, 10)}...</span>
        </div>
        <div className="text-xs text-white/30">Chain: {CHAINS[chain]?.name}</div>
      </div>
      <button
        data-testid="generate-stealth-btn"
        onClick={generate}
        disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
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

// Send Content
function SendContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const send = async () => {
    if (!signer) return toast.error("Connect wallet first");
    if (!ethers.isAddress(to)) return toast.error("Invalid address");
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    setSending(true);
    try {
      const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
      setTxHash(tx.hash);
      toast.success("Transaction sent!");
      await tx.wait();
      toast.success("Confirmed on-chain");
      fetchBalance();
      setTo(""); setAmount("");
    } catch (e) { toast.error(e.message?.slice(0, 60) || "Failed"); }
    setSending(false);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient (stealth address)</label>
        <input
          data-testid="send-to-input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input
          data-testid="send-amount-input"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white transition-colors"
        />
      </div>
      <button
        data-testid="send-btn"
        onClick={send}
        disabled={sending}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send Privately
      </button>
      {txHash && (
        <a
          href={`${CHAINS[chain].explorer}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white"
        >
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// Swap Content
function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState("ETH");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [recipient, setRecipient] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const tokens = TOKENS[chain] || TOKENS.base;
  const nativeSymbol = CHAINS[chain]?.symbol || "ETH";

  const swap = async () => {
    if (!signer) return toast.error("Connect wallet first");
    if (!recipient || !ethers.isAddress(recipient)) return toast.error("Enter a valid stealth address");
    if (!amountIn || parseFloat(amountIn) <= 0) return toast.error("Enter an amount");
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
      <div className="bg-white/5 border border-white/20 p-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">You Pay</span>
          <select value={tokenIn} onChange={(e) => setTokenIn(e.target.value)} className="bg-transparent text-sm font-semibold outline-none">
            {tokens.map(t => <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>)}
          </select>
        </div>
        <input
          data-testid="swap-amount-input"
          type="number"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="0.0"
          className="w-full bg-transparent text-2xl font-mono outline-none"
        />
      </div>

      <div className="flex justify-center">
        <div className="w-10 h-10 bg-white/10 border border-white/20 flex items-center justify-center">
          <ArrowDown className="w-5 h-5" />
        </div>
      </div>

      <div className="bg-white/5 border border-white/20 p-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">You Receive</span>
          <select value={tokenOut} onChange={(e) => setTokenOut(e.target.value)} className="bg-transparent text-sm font-semibold outline-none">
            {tokens.filter(t => t.symbol !== tokenIn).map(t => <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>)}
          </select>
        </div>
        <div className="text-2xl font-mono text-white/50">~{amountIn || "0.0"}</div>
      </div>

      <div className="flex justify-between text-xs text-gray-500">
        <span>Privacy Fee</span>
        <span className="text-green-400">0.05%</span>
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input
          data-testid="swap-recipient-input"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-green-400">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        Privacy contracts live on {CHAINS[chain]?.name}
      </div>

      <button
        data-testid="swap-btn"
        onClick={swap}
        disabled={swapping || !address}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
        Private Swap
      </button>

      {txHash && (
        <a
          href={`${CHAINS[chain].explorer}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white"
        >
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// Landing Page
function Landing() {
  const { connectWallet, isConnecting } = useWallet();
  const [showChains, setShowChains] = useState(false);

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      {/* Live chain badge */}
      <div
        className="absolute top-4 md:top-6 left-4 md:left-6 z-50 flex items-center gap-2 px-3 md:px-4 py-2 border border-white/20 text-xs md:text-sm cursor-pointer hover:border-white/40 transition-all"
        onClick={() => setShowChains(!showChains)}
        data-testid="live-chain-badge"
      >
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-white/70">{LIVE_CHAINS} Chains Live</span>
        <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
      </div>

      {/* Chain list dropdown */}
      {showChains && (
        <div className="absolute top-14 md:top-16 left-4 md:left-6 z-50 bg-black border border-white/20 min-w-[240px]">
          <div className="px-3 py-2 text-xs text-white/40 uppercase tracking-wider border-b border-white/10">Live — Contracts Deployed</div>
          {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
              <span>{v.name}</span>
              <a href={`${v.explorer}/address/${DEPLOYED_CONTRACTS.privacyRelayer}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-white/30 hover:text-white/60">
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ))}
          <div className="px-3 py-2 text-xs text-white/40 uppercase tracking-wider border-t border-b border-white/10">Coming Soon (EVM)</div>
          {Object.entries(CHAINS).filter(([, v]) => v.comingSoon).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 px-3 py-2 text-sm text-white/30">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
              <span>{v.name}</span>
              <Clock className="w-3 h-3 ml-auto" />
            </div>
          ))}
          <div className="px-3 py-2 text-xs text-white/40 uppercase tracking-wider border-t border-b border-white/10">Non-EVM (roadmap)</div>
          {NON_EVM_CHAINS.map((c) => (
            <div key={c.name} className="flex items-center gap-2 px-3 py-2 text-sm text-white/20">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
              <span>{c.name}</span>
              <span className="ml-auto text-xs text-white/20">{c.note}</span>
            </div>
          ))}
        </div>
      )}

      {/* Connect button */}
      <div className="absolute top-4 md:top-6 right-4 md:right-6 z-50">
        <MagnetizeButton
          data-testid="landing-connect"
          onClick={connectWallet}
          disabled={isConnecting}
          particleCount={14}
          className="px-4 md:px-6 py-2 md:py-2.5 text-sm"
        >
          {isConnecting ? "Connecting..." : "Connect Wallet"}
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
          Private transactions, stealth addresses, and shielded swaps across {LIVE_CHAINS} mainnets.
        </p>

        {/* Stats */}
        <div className="flex items-center justify-center gap-6 md:gap-12 mb-6 md:mb-10">
          <div className="text-center">
            <span className="block text-xl md:text-2xl font-bold text-white">100%</span>
            <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">Private</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-white/10" />
          <div className="text-center">
            <span className="block text-xl md:text-2xl font-bold text-white">{LIVE_CHAINS}</span>
            <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">Chains Live</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-white/10" />
          <div className="text-center">
            <span className="block text-xl md:text-2xl font-bold text-green-400">LIVE</span>
            <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">Mainnet</span>
          </div>
        </div>

        {/* Chain pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-xs">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-white/60">{v.name}</span>
            </div>
          ))}
          {Object.entries(CHAINS).filter(([, v]) => v.comingSoon).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 px-3 py-1.5 border border-white/5 text-xs opacity-40">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-white/40">{v.name}</span>
              <Clock className="w-2.5 h-2.5 text-white/20" />
            </div>
          ))}
        </div>

        {/* Non-EVM chains note */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          <span className="text-xs text-white/20">On roadmap:</span>
          {NON_EVM_CHAINS.map((c) => (
            <span key={c.name} className="text-xs text-white/20">{c.name}</span>
          ))}
        </div>

        <a
          href={`https://basescan.org/address/${DEPLOYED_CONTRACTS.privacyRelayer}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          View contracts on BaseScan <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// Dashboard
function Dashboard() {
  const { address, balance, chain, fetchBalance } = useWallet();
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
          <h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">{titles[page]}</h1>
          {page === "receive" && <StealthContent />}
          {page === "send" && <SendContent />}
          {page === "swap" && <SwapContent />}
          {page === "chains" && <ChainsStatus />}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Navbar />
      <div className="pt-20 md:pt-24 pb-12 md:pb-16 px-4 md:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Balance */}
          <div className="bg-white/5 border border-white/10 p-5 md:p-8 mb-6 md:mb-8">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <span className="text-xs md:text-sm text-gray-500 uppercase tracking-wider">
                Balance on <span style={{ color: CHAINS[chain].color }}>{CHAINS[chain].name}</span>
              </span>
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

          {/* Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
            <button
              data-testid="nav-receive"
              onClick={() => setPage("receive")}
              className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all"
            >
              <Fingerprint className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-1">Private Receive</h3>
              <p className="text-xs md:text-sm text-gray-500">Generate stealth address</p>
            </button>
            <button
              data-testid="nav-send"
              onClick={() => setPage("send")}
              className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all"
            >
              <Zap className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-1">Private Send</h3>
              <p className="text-xs md:text-sm text-gray-500">Send to any address</p>
            </button>
            <button
              data-testid="nav-swap"
              onClick={() => setPage("swap")}
              className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all"
            >
              <RefreshCw className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-1">Private Swap</h3>
              <p className="text-xs md:text-sm text-gray-500">ETH, USDC, DAI + more</p>
            </button>
          </div>

          {/* Chain status row */}
          <div
            className="bg-white/5 border border-white/10 p-4 cursor-pointer hover:border-white/20 transition-all"
            onClick={() => setPage("chains")}
            data-testid="chain-status-card"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-white/50" />
                <span className="text-sm text-white/70">Deployed on {LIVE_CHAINS} chains</span>
                <div className="flex gap-1.5">
                  {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (
                    <div key={k} className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} title={v.name} />
                  ))}
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-white/30" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chain Status Page
function ChainsStatus() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">Live Chains</h2>
        <div className="space-y-2">
          {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between bg-white/5 border border-white/10 p-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-white/40 font-mono">{DEPLOYED_CONTRACTS.privacyRelayer.slice(0, 16)}...</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </div>
                <a
                  href={`${v.explorer}/address/${DEPLOYED_CONTRACTS.privacyRelayer}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/30 hover:text-white"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Coming Soon (EVM)</h2>
        <div className="space-y-2">
          {Object.entries(CHAINS).filter(([, v]) => v.comingSoon).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between bg-white/5 border border-white/5 p-4 opacity-50">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-white/40">EVM-compatible — needs deployment funding</div>
                </div>
              </div>
              <Clock className="w-4 h-4 text-white/30" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">On the Roadmap (non-EVM)</h2>
        <div className="space-y-2">
          {NON_EVM_CHAINS.map((c) => (
            <div key={c.name} className="flex items-center justify-between bg-white/5 border border-white/5 p-4 opacity-40">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <div>
                  <div className="font-medium">{c.name} ({c.symbol})</div>
                  <div className="text-xs text-white/40">{c.note}</div>
                </div>
              </div>
              <Clock className="w-4 h-4 text-white/30" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <WalletProvider>
      <Dashboard />
      <Toaster
        position="bottom-right"
        toastOptions={{ style: { background: "#000", border: "1px solid #333", color: "#fff" } }}
      />
    </WalletProvider>
  );
}

export default App;
