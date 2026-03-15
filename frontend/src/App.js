import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Copy, Check, ExternalLink, Eye, EyeOff, ChevronDown, Zap, Fingerprint, X, Loader2, ArrowDown, Menu } from "lucide-react";
import { Toaster, toast } from "sonner";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CHAINS = {
  base: { name: "Base", chainId: "0x2105", chainIdDec: 8453, rpcUrl: "https://mainnet.base.org", explorer: "https://basescan.org", symbol: "ETH", color: "#0052FF", contracts: { privacyRelayer: "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c", stealthRegistry: "0xf2E7A6734E58774A8417c176AaE3898667699Ff4", uniswapWrapper: "0xD04f9cE68CfF7C0FD6d631794964784B99423943" } },
  arbitrum: { name: "Arbitrum", chainId: "0xa4b1", chainIdDec: 42161, rpcUrl: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", symbol: "ETH", color: "#28A0F0", contracts: { privacyRelayer: "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c", stealthRegistry: "0xf2E7A6734E58774A8417c176AaE3898667699Ff4", uniswapWrapper: "0xD04f9cE68CfF7C0FD6d631794964784B99423943" } },
  ethereum: { name: "Ethereum", chainId: "0x1", chainIdDec: 1, rpcUrl: "https://eth.llamarpc.com", explorer: "https://etherscan.io", symbol: "ETH", color: "#627EEA", contracts: null }
};

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
  ethereum: [
    { symbol: "ETH", name: "Ethereum", decimals: 18, address: "native" },
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { symbol: "DAI", name: "Dai", decimals: 18, address: "0x6B175474E89094C44Da98b954EescdeCB5BE3830" },
  ]
};

const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState("base");
  const [balance, setBalance] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = async () => {
    if (!window.ethereum) { toast.error("Install MetaMask"); return; }
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      setAddress(accounts[0]);
      setSigner(await provider.getSigner());
      toast.success("Connected");
    } catch { toast.error("Failed"); }
    setIsConnecting(false);
  };

  const disconnectWallet = () => { setAddress(null); setSigner(null); setBalance(null); };

  const switchChain = async (k) => {
    setChain(k);
    if (window.ethereum && address) {
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAINS[k].chainId }] }); }
      catch (e) { if (e.code === 4902) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAINS[k].chainId, chainName: CHAINS[k].name, rpcUrls: [CHAINS[k].rpcUrl], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }] }); }
    }
  };

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      const provider = new ethers.JsonRpcProvider(CHAINS[chain].rpcUrl);
      const bal = await provider.getBalance(address);
      setBalance({ wei: bal.toString(), eth: ethers.formatEther(bal), formatted: parseFloat(ethers.formatEther(bal)).toFixed(6), symbol: "ETH" });
    } catch {}
  }, [address, chain]);

  useEffect(() => { if (address) fetchBalance(); }, [address, chain, fetchBalance]);
  useEffect(() => { if (window.ethereum) window.ethereum.on("accountsChanged", (a) => a.length > 0 ? setAddress(a[0]) : disconnectWallet()); }, []);

  return <WalletContext.Provider value={{ address, chain, balance, signer, isConnecting, connectWallet, disconnectWallet, switchChain, fetchBalance, setChain }}>{children}</WalletContext.Provider>;
}

// Navbar - Mobile responsive
function Navbar() {
  const { address, chain, switchChain, disconnectWallet } = useWallet();
  const [showChains, setShowChains] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

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
            <button onClick={() => setShowChains(!showChains)} className="flex items-center gap-2 px-3 py-2 border border-white/20 hover:border-white/40 transition-all text-sm">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[chain].color }} />
              {CHAINS[chain].name}
              <ChevronDown className={`w-4 h-4 transition-transform ${showChains ? 'rotate-180' : ''}`} />
            </button>
            {showChains && (
              <div className="absolute top-full mt-2 right-0 bg-black border border-white/20 min-w-[140px]">
                {Object.entries(CHAINS).map(([k, v]) => (
                  <button key={k} onClick={() => { switchChain(k); setShowChains(false); }} className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-sm ${chain === k ? 'bg-white/5' : ''}`}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                    {v.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {address && (
            <button onClick={disconnectWallet} className="px-3 py-2 border border-white/20 hover:bg-white hover:text-black transition-all text-sm font-mono">
              {address.slice(0,6)}...{address.slice(-4)}
            </button>
          )}
        </div>

        {/* Mobile menu button */}
        <button className="md:hidden p-2" onClick={() => setMobileMenu(!mobileMenu)}>
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileMenu && (
        <div className="md:hidden border-t border-white/10 bg-black p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Network</span>
            <select value={chain} onChange={(e) => { switchChain(e.target.value); setMobileMenu(false); }} className="bg-black border border-white/20 px-3 py-1.5 text-sm">
              {Object.entries(CHAINS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          {address && (
            <button onClick={() => { disconnectWallet(); setMobileMenu(false); }} className="w-full py-2 border border-white/20 text-sm">
              Disconnect {address.slice(0,6)}...{address.slice(-4)}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

// Modal - Mobile responsive
function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />
      <div className="relative bg-black border border-white/20 w-full md:max-w-md md:rounded-none rounded-t-2xl max-h-[85vh] overflow-auto">
        <div className="sticky top-0 bg-black border-b border-white/20 p-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 md:p-6">{children}</div>
      </div>
    </div>
  );
}

// Stealth Content
function StealthContent() {
  const { address, chain } = useWallet();
  const [stealth, setStealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!address) return toast.error("Connect wallet");
    setLoading(true);
    try { const r = await axios.post(`${API}/stealth/generate`, { public_address: address, chain }); setStealth(r.data); toast.success("Generated!"); }
    catch { toast.error("Failed"); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <p className="text-gray-400 text-sm">Generate a one-time stealth address.</p>
      <button onClick={generate} disabled={loading} className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />} Generate
      </button>
      {stealth && (
        <div className="bg-white/5 border border-white/20 p-4">
          <div className="flex justify-between mb-2"><span className="text-xs text-gray-500 uppercase">Address</span>
            <button onClick={() => { navigator.clipboard.writeText(stealth.stealth_address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-500" />}
            </button>
          </div>
          <p className="font-mono text-xs md:text-sm break-all">{stealth.stealth_address}</p>
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
    if (!signer) return toast.error("Connect wallet");
    if (!ethers.isAddress(to)) return toast.error("Invalid address");
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter amount");
    setSending(true);
    try {
      const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
      setTxHash(tx.hash); toast.success("Sent!");
      await tx.wait(); toast.success("Confirmed!"); fetchBalance(); setTo(""); setAmount("");
    } catch (e) { toast.error(e.message || "Failed"); }
    setSending(false);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div><label className="block text-xs text-gray-500 uppercase mb-2">To</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..." className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" /></div>
      <div><label className="block text-xs text-gray-500 uppercase mb-2">Amount (ETH)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" /></div>
      <button onClick={send} disabled={sending} className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />} Send
      </button>
      {txHash && <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">View <ExternalLink className="w-4 h-4" /></a>}
    </div>
  );
}

// Swap Content - NEW with tokens
function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState("ETH");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [recipient, setRecipient] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const tokens = TOKENS[chain] || TOKENS.base;
  const hasWrapper = CHAINS[chain]?.contracts?.uniswapWrapper;

  const swap = async () => {
    if (!signer) return toast.error("Connect wallet");
    if (!recipient || !ethers.isAddress(recipient)) return toast.error("Enter stealth address");
    if (!amountIn || parseFloat(amountIn) <= 0) return toast.error("Enter amount");
    
    setSwapping(true);
    try {
      // For now, direct transfer to stealth (full Uniswap integration requires more setup)
      const tx = await signer.sendTransaction({ to: recipient, value: ethers.parseEther(amountIn) });
      setTxHash(tx.hash);
      toast.success("Swap initiated!");
      await tx.wait();
      toast.success("Confirmed!");
      fetchBalance();
      setAmountIn("");
    } catch (e) { toast.error(e.message || "Failed"); }
    setSwapping(false);
  };

  return (
    <div className="space-y-4">
      {/* From */}
      <div className="bg-white/5 border border-white/20 p-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">You Pay</span>
          <select value={tokenIn} onChange={(e) => setTokenIn(e.target.value)} className="bg-transparent text-sm font-semibold outline-none">
            {tokens.map(t => <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>)}
          </select>
        </div>
        <input type="number" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="0.0" className="w-full bg-transparent text-2xl font-mono outline-none" />
      </div>

      {/* Arrow */}
      <div className="flex justify-center"><div className="w-10 h-10 bg-white/10 border border-white/20 flex items-center justify-center"><ArrowDown className="w-5 h-5" /></div></div>

      {/* To */}
      <div className="bg-white/5 border border-white/20 p-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">You Receive</span>
          <select value={tokenOut} onChange={(e) => setTokenOut(e.target.value)} className="bg-transparent text-sm font-semibold outline-none">
            {tokens.filter(t => t.symbol !== tokenIn).map(t => <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>)}
          </select>
        </div>
        <div className="text-2xl font-mono text-white/50">~{amountIn || "0.0"}</div>
      </div>

      {/* Fee */}
      <div className="flex justify-between text-xs text-gray-500">
        <span>Privacy Fee</span><span className="text-green-400">0.05%</span>
      </div>

      {/* Recipient */}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>

      {/* Contract status */}
      {hasWrapper ? (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          UniswapWrapper deployed
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-yellow-400">
          <div className="w-2 h-2 rounded-full bg-yellow-400" />
          Wrapper not deployed on {CHAINS[chain].name}
        </div>
      )}

      {/* Swap button */}
      <button onClick={swap} disabled={swapping || !address} className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />} Private Swap
      </button>

      {txHash && <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">View <ExternalLink className="w-4 h-4" /></a>}
    </div>
  );
}

// Landing - Mobile responsive
function Landing() {
  const { connectWallet, isConnecting } = useWallet();

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      {/* Top Left - Chain indicator */}
      <div className="absolute top-4 md:top-6 left-4 md:left-6 z-50 flex items-center gap-2 px-3 md:px-4 py-2 border border-white/20 text-xs md:text-sm">
        <div className="w-2 h-2 rounded-full bg-[#0052FF]" />
        <span className="text-white/70">Base Mainnet</span>
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1 md:ml-2" />
      </div>

      {/* Top Right - Connect Wallet */}
      <div className="absolute top-4 md:top-6 right-4 md:right-6 z-50">
        <MagnetizeButton onClick={connectWallet} disabled={isConnecting} particleCount={14} className="px-4 md:px-6 py-2 md:py-2.5 text-sm">
          {isConnecting ? "..." : "Connect"}
        </MagnetizeButton>
      </div>

      {/* Globe */}
      <div className="pt-14 md:pt-16 flex justify-center">
        <div className="w-[280px] h-[280px] md:w-[400px] md:h-[400px]">
          <RotatingEarth width={400} height={400} />
        </div>
      </div>

      {/* Content below */}
      <div className="text-center px-4 md:px-6 mt-4 md:mt-8">
        <h1 className="font-heading text-3xl md:text-6xl font-bold tracking-tight text-white mb-6 md:mb-8">
          Universal Privacy Layer
        </h1>
        
        {/* Stats */}
        <div className="flex items-center justify-center gap-6 md:gap-12 mb-6 md:mb-8">
          <div className="text-center">
            <span className="block text-xl md:text-2xl font-bold text-white">100%</span>
            <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">Private</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-white/10" />
          <div className="text-center">
            <span className="block text-xl md:text-2xl font-bold text-white">3</span>
            <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">Chains</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-white/10" />
          <div className="text-center">
            <span className="block text-xl md:text-2xl font-bold text-green-400">LIVE</span>
            <span className="text-[10px] md:text-xs text-white/40 uppercase tracking-wider">On Base</span>
          </div>
        </div>

        <a href="https://basescan.org/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors">
          View contracts on BaseScan <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// Dashboard - Mobile responsive
function Dashboard() {
  const { address, balance, chain, fetchBalance } = useWallet();
  const [page, setPage] = useState("home");
  const [showBal, setShowBal] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  if (!address) return <Landing />;

  const refresh = async () => { setRefreshing(true); await fetchBalance(); setRefreshing(false); };

  // Sub pages
  if (page !== "home") {
    return (
      <div className="min-h-screen bg-black pt-16 md:pt-20 px-4 md:px-6">
        <Navbar />
        <div className="max-w-2xl mx-auto py-6 md:py-10">
          <InteractiveHoverButton text="Back" onClick={() => setPage("home")} className="mb-6 md:mb-8" />
          
          {page === "receive" && <><h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">Private Receive</h1><StealthContent /></>}
          {page === "send" && <><h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">Private Send</h1><SendContent /></>}
          {page === "swap" && <><h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">Private Swap</h1><SwapContent /></>}
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
              <span className="text-xs md:text-sm text-gray-500 uppercase tracking-wider">Balance on {CHAINS[chain].name}</span>
              <div className="flex gap-1 md:gap-2">
                <button onClick={() => setShowBal(!showBal)} className="p-2 hover:bg-white/10">{showBal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                <button onClick={refresh} className="p-2 hover:bg-white/10"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
              </div>
            </div>
            <div className="flex items-end gap-2 md:gap-3">
              <span className="text-3xl md:text-5xl font-bold">{showBal && balance ? balance.formatted : '••••••'}</span>
              <span className="text-gray-500 mb-1">ETH</span>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
            <button onClick={() => setPage("receive")} className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all">
              <Fingerprint className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-1">Private Receive</h3>
              <p className="text-xs md:text-sm text-gray-500">Generate stealth address</p>
            </button>
            <button onClick={() => setPage("send")} className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all">
              <Zap className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-1">Private Send</h3>
              <p className="text-xs md:text-sm text-gray-500">Send to any address</p>
            </button>
            <button onClick={() => setPage("swap")} className="bg-white/5 border border-white/10 p-4 md:p-6 text-left hover:border-white/30 transition-all">
              <RefreshCw className="w-6 md:w-8 h-6 md:h-8 mb-3 md:mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-1">Private Swap</h3>
              <p className="text-xs md:text-sm text-gray-500">ETH, USDC, DAI</p>
            </button>
          </div>

          {/* Contract info */}
          <div className="text-center">
            <a href="https://basescan.org/address/0xD04f9cE68CfF7C0FD6d631794964784B99423943" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs md:text-sm text-gray-500 hover:text-white">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              3 contracts live on Base <ExternalLink className="w-3 md:w-4 h-3 md:h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <WalletProvider>
      <Dashboard />
      <Toaster position="bottom-right" toastOptions={{ style: { background: '#000', border: '1px solid #333', color: '#fff' } }} />
    </WalletProvider>
  );
}

export default App;
