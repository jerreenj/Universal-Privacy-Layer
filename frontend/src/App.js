import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { Wallet, ArrowUpRight, ArrowDownLeft, RefreshCw, Copy, Check, ExternalLink, Eye, EyeOff, ChevronDown, Zap, Fingerprint, X, Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CHAINS = {
  base: { name: "Base", chainId: "0x2105", chainIdDec: 8453, rpcUrl: "https://mainnet.base.org", explorer: "https://basescan.org", symbol: "ETH", color: "#0052FF", contracts: { privacyRelayer: "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c", stealthRegistry: "0xf2E7A6734E58774A8417c176AaE3898667699Ff4" } },
  arbitrum: { name: "Arbitrum", chainId: "0xa4b1", chainIdDec: 42161, rpcUrl: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", symbol: "ETH", color: "#28A0F0", contracts: null },
  ethereum: { name: "Ethereum", chainId: "0x1", chainIdDec: 1, rpcUrl: "https://eth.llamarpc.com", explorer: "https://etherscan.io", symbol: "ETH", color: "#627EEA", contracts: null }
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

// Navbar
function Navbar() {
  const { address, chain, switchChain, disconnectWallet } = useWallet();
  const [showChains, setShowChains] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
            <div className="w-4 h-4 bg-black rounded-full" />
          </div>
          <span className="font-heading text-xl font-bold tracking-tight">UPL</span>
        </div>

        <div className="flex items-center gap-4">
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
      </div>
    </nav>
  );
}

// Modal
function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />
      <div className="relative bg-black border border-white/20 w-full max-w-md">
        <div className="border-b border-white/20 p-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
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
          <p className="font-mono text-sm break-all">{stealth.stealth_address}</p>
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
    <div className="space-y-6">
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

// Landing
function Landing() {
  const { connectWallet, isConnecting } = useWallet();

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      {/* Top Left - Chain indicator */}
      <div className="absolute top-6 left-6 z-50 flex items-center gap-2 px-4 py-2 border border-white/20 text-sm">
        <div className="w-2 h-2 rounded-full bg-[#0052FF]" />
        <span className="text-white/70">Base Mainnet</span>
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-2" />
      </div>

      {/* Top Right - Connect Wallet */}
      <div className="absolute top-6 right-6 z-50">
        <MagnetizeButton onClick={connectWallet} disabled={isConnecting} particleCount={14} className="px-6 py-2.5">
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </MagnetizeButton>
      </div>

      {/* Globe - Top section */}
      <div className="pt-16 flex justify-center">
        <RotatingEarth width={400} height={400} />
      </div>

      {/* All content below globe */}
      <div className="text-center px-6 mt-8">
        <h1 className="font-heading text-5xl md:text-6xl font-bold tracking-tight text-white mb-8">
          Universal Privacy Layer
        </h1>
        
        {/* Stats row */}
        <div className="flex items-center justify-center gap-12 mb-8">
          <div className="text-center">
            <span className="block text-2xl font-bold text-white">100%</span>
            <span className="text-xs text-white/40 uppercase tracking-wider">Private</span>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="text-center">
            <span className="block text-2xl font-bold text-white">3</span>
            <span className="text-xs text-white/40 uppercase tracking-wider">Chains</span>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="text-center">
            <span className="block text-2xl font-bold text-green-400">LIVE</span>
            <span className="text-xs text-white/40 uppercase tracking-wider">On Base</span>
          </div>
        </div>

        {/* Contract link */}
        <a 
          href="https://basescan.org/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c" 
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
  const { address, balance, chain, fetchBalance, disconnectWallet } = useWallet();
  const [page, setPage] = useState("home");
  const [modal, setModal] = useState(null);
  const [showBal, setShowBal] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  if (!address) return <Landing />;

  const refresh = async () => { setRefreshing(true); await fetchBalance(); setRefreshing(false); };

  // Sub pages
  if (page !== "home") {
    return (
      <div className="min-h-screen bg-black pt-20 px-6">
        <Navbar />
        <div className="max-w-2xl mx-auto py-10">
          <InteractiveHoverButton text="Back" onClick={() => setPage("home")} className="mb-8" />
          
          {page === "receive" && (
            <div>
              <h1 className="text-3xl font-bold mb-6">Private Receive</h1>
              <StealthContent />
            </div>
          )}
          {page === "send" && (
            <div>
              <h1 className="text-3xl font-bold mb-6">Private Send</h1>
              <SendContent />
            </div>
          )}
          {page === "swap" && (
            <div>
              <h1 className="text-3xl font-bold mb-6">Private Swap</h1>
              <p className="text-gray-400">Coming soon - Uniswap integration</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Navbar />
      
      <div className="pt-24 pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Balance */}
          <div className="bg-white/5 border border-white/10 p-8 mb-8">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-500 uppercase tracking-wider">Balance on {CHAINS[chain].name}</span>
              <div className="flex gap-2">
                <button onClick={() => setShowBal(!showBal)} className="p-2 hover:bg-white/10">{showBal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                <button onClick={refresh} className="p-2 hover:bg-white/10"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <span className="text-5xl font-bold">{showBal && balance ? balance.formatted : '••••••'}</span>
              <span className="text-gray-500 mb-1">ETH</span>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <button onClick={() => setPage("receive")} className="group bg-white/5 border border-white/10 p-6 text-left hover:border-white/30 transition-all">
              <Fingerprint className="w-8 h-8 mb-4" />
              <h3 className="text-lg font-semibold mb-1">Private Receive</h3>
              <p className="text-sm text-gray-500">Generate stealth address</p>
            </button>
            <button onClick={() => setPage("send")} className="group bg-white/5 border border-white/10 p-6 text-left hover:border-white/30 transition-all">
              <Zap className="w-8 h-8 mb-4" />
              <h3 className="text-lg font-semibold mb-1">Private Send</h3>
              <p className="text-sm text-gray-500">Send to any address</p>
            </button>
            <button onClick={() => setPage("swap")} className="group bg-white/5 border border-white/10 p-6 text-left hover:border-white/30 transition-all">
              <RefreshCw className="w-8 h-8 mb-4" />
              <h3 className="text-lg font-semibold mb-1">Private Swap</h3>
              <p className="text-sm text-gray-500">Swap with privacy</p>
            </button>
          </div>

          {/* Contract info */}
          <div className="text-center">
            <a href="https://basescan.org/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Contracts live on Base Mainnet <ExternalLink className="w-4 h-4" />
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
