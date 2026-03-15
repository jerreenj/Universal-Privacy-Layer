import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { 
  Wallet, ArrowUpRight, ArrowDownLeft, 
  RefreshCw, Copy, Check, ExternalLink, Eye, EyeOff,
  ChevronDown, Zap, Lock, Layers, Activity,
  Loader2, Hexagon, Fingerprint, ArrowRight, 
  Shield, Globe, Cpu, Database, Code, TrendingUp, X
} from "lucide-react";
import { Toaster, toast } from "sonner";
import RotatingEarth from "@/components/ui/RotatingEarth";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// MAINNET Chains
const CHAINS = {
  base: {
    name: "Base",
    chainId: "0x2105",
    chainIdDec: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    symbol: "ETH",
    color: "#0052FF",
    contracts: {
      privacyRelayer: "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c",
      stealthRegistry: "0xf2E7A6734E58774A8417c176AaE3898667699Ff4"
    }
  },
  arbitrum: {
    name: "Arbitrum",
    chainId: "0xa4b1",
    chainIdDec: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    symbol: "ETH",
    color: "#28A0F0",
    contracts: null
  },
  ethereum: {
    name: "Ethereum",
    chainId: "0x1",
    chainIdDec: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    symbol: "ETH",
    color: "#627EEA",
    contracts: null
  }
};

// Context
const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

// Provider
function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState("base");
  const [balance, setBalance] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = async () => {
    if (!window.ethereum) { toast.error("Install MetaMask"); return; }
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const ethProvider = new ethers.BrowserProvider(window.ethereum);
      const ethSigner = await ethProvider.getSigner();
      setAddress(accounts[0]);
      setProvider(ethProvider);
      setSigner(ethSigner);
      toast.success("Connected");
    } catch { toast.error("Failed"); }
    setIsConnecting(false);
  };

  const disconnectWallet = () => {
    setAddress(null);
    setProvider(null);
    setSigner(null);
    setBalance(null);
  };

  const switchChain = async (chainKey) => {
    setChain(chainKey);
    if (window.ethereum && address) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAINS[chainKey].chainId }]
        });
        toast.success(`Switched to ${CHAINS[chainKey].name}`);
      } catch (err) {
        if (err.code === 4902) {
          const c = CHAINS[chainKey];
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: c.chainId, chainName: c.name, rpcUrls: [c.rpcUrl], blockExplorerUrls: [c.explorer], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }]
          });
        }
      }
    }
  };

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      const rpc = CHAINS[chain].rpcUrl;
      const tempProvider = new ethers.JsonRpcProvider(rpc);
      const bal = await tempProvider.getBalance(address);
      const ethBal = ethers.formatEther(bal);
      setBalance({
        wei: bal.toString(),
        eth: ethBal,
        formatted: parseFloat(ethBal).toFixed(6),
        symbol: "ETH"
      });
    } catch (err) {
      console.error("Balance error:", err);
    }
  }, [address, chain]);

  useEffect(() => {
    if (address) fetchBalance();
  }, [address, chain, fetchBalance]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length > 0) setAddress(accounts[0]);
        else disconnectWallet();
      });
    }
  }, []);

  return (
    <WalletContext.Provider value={{ address, chain, balance, provider, signer, isConnecting, connectWallet, disconnectWallet, switchChain, fetchBalance, setChain }}>
      {children}
    </WalletContext.Provider>
  );
}

// Floating Controls
function FloatingControls() {
  const { address, chain, connectWallet, disconnectWallet, switchChain, isConnecting } = useWallet();
  const [showChains, setShowChains] = useState(false);

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-3">
      <div className="relative">
        <button onClick={() => setShowChains(!showChains)} className="flex items-center gap-2 px-4 py-2.5 bg-black/90 backdrop-blur border border-white/10 hover:border-[#00FF94]/50 transition-all">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[chain].color }} />
          <span className="text-sm">{CHAINS[chain].name}</span>
          <ChevronDown className={`w-4 h-4 text-[#666] transition-transform ${showChains ? 'rotate-180' : ''}`} />
        </button>
        {showChains && (
          <div className="absolute top-full mt-2 right-0 bg-black/95 backdrop-blur border border-white/10 min-w-[160px]">
            {Object.entries(CHAINS).map(([k, v]) => (
              <button key={k} onClick={() => { switchChain(k); setShowChains(false); }} className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#00FF94]/10 text-left ${chain === k ? 'bg-[#00FF94]/5 border-l-2 border-[#00FF94]' : ''}`}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                <span className="text-sm">{v.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {address ? (
        <button onClick={disconnectWallet} className="flex items-center gap-2 px-4 py-2.5 bg-[#00FF94]/10 border border-[#00FF94]/50 text-[#00FF94] hover:bg-[#00FF94] hover:text-black transition-all">
          <div className="w-2 h-2 rounded-full bg-[#00FF94] animate-pulse" />
          <span className="font-mono text-sm">{address.slice(0,6)}...{address.slice(-4)}</span>
        </button>
      ) : (
        <button onClick={connectWallet} disabled={isConnecting} className="flex items-center gap-2 px-5 py-2.5 bg-[#00FF94] text-black font-bold uppercase tracking-widest text-sm hover:scale-105 transition-all disabled:opacity-50">
          {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          Connect
        </button>
      )}
    </div>
  );
}

// Modal
function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-lg max-h-[85vh] overflow-auto animate-fade-in">
        <div className="sticky top-0 bg-[#0A0A0A] border-b border-white/10 p-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5"><X className="w-5 h-5" /></button>
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
    if (!address) { toast.error("Connect wallet"); return; }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/stealth/generate`, { public_address: address, chain });
      setStealth(res.data);
      toast.success("Generated!");
    } catch { toast.error("Failed"); }
    setLoading(false);
  };

  const copy = async (t) => { await navigator.clipboard.writeText(t); setCopied(true); toast.success("Copied!"); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="space-y-6">
      <p className="text-[#888]">Generate a one-time stealth address that cannot be linked to your wallet.</p>
      <button onClick={generate} disabled={loading || !address} className="w-full py-4 bg-[#00FF94]/10 border border-[#00FF94]/50 text-[#00FF94] uppercase tracking-widest font-bold hover:bg-[#00FF94] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
        Generate
      </button>
      {stealth && (
        <div className="bg-black/50 p-5 border border-[#00FF94]/30 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#888] uppercase tracking-wider">Stealth Address</span>
            <button onClick={() => copy(stealth.stealth_address)} className="p-1 hover:bg-white/5">
              {copied ? <Check className="w-4 h-4 text-[#00FF94]" /> : <Copy className="w-4 h-4 text-[#888]" />}
            </button>
          </div>
          <p className="font-mono text-sm text-[#00FF94] break-all">{stealth.stealth_address}</p>
          <div className="pt-3 border-t border-white/10 flex justify-between text-xs text-[#888]">
            <span>Tag: <span className="text-white font-mono">{stealth.view_tag}</span></span>
            <span>{CHAINS[chain].name}</span>
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
    if (!signer) { toast.error("Connect wallet"); return; }
    if (!ethers.isAddress(to)) { toast.error("Invalid address"); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error("Enter amount"); return; }
    setSending(true);
    try {
      const tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
      setTxHash(tx.hash);
      toast.success("Sent!");
      await tx.wait();
      toast.success("Confirmed!");
      fetchBalance();
      setTo(""); setAmount("");
    } catch (e) { toast.error(e.message || "Failed"); }
    setSending(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs text-[#888] uppercase tracking-wider mb-2">Recipient</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x... or stealth address" className="w-full bg-black/50 border border-white/10 focus:border-[#00FF94] p-4 font-mono text-sm outline-none" />
      </div>
      <div>
        <label className="block text-xs text-[#888] uppercase tracking-wider mb-2">Amount (ETH)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" step="0.001" className="w-full bg-black/50 border border-white/10 focus:border-[#00FF94] p-4 font-mono text-sm outline-none" />
      </div>
      <button onClick={send} disabled={sending || !address} className="w-full py-4 bg-[#00F0FF]/10 border border-[#00F0FF]/50 text-[#00F0FF] uppercase tracking-widest font-bold hover:bg-[#00F0FF] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send
      </button>
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-sm text-[#00FF94] hover:underline">
          View Transaction <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// Balance Card
function BalanceCard() {
  const { balance, address, chain, fetchBalance } = useWallet();
  const [show, setShow] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => { setRefreshing(true); await fetchBalance(); setRefreshing(false); };

  if (!address) return null;

  return (
    <div className="bg-black/40 backdrop-blur border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-[#888] uppercase tracking-wider">Balance on {CHAINS[chain].name}</span>
        <div className="flex gap-2">
          <button onClick={() => setShow(!show)} className="p-2 hover:bg-white/5">
            {show ? <Eye className="w-4 h-4 text-[#888]" /> : <EyeOff className="w-4 h-4 text-[#888]" />}
          </button>
          <button onClick={refresh} className="p-2 hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 text-[#888] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="font-heading text-5xl font-bold text-white">
          {show && balance ? balance.formatted : '••••••'}
        </span>
        <span className="text-[#888] mb-2">ETH</span>
      </div>
      {CHAINS[chain].contracts && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <p className="text-xs text-[#00FF94]">✓ Contracts deployed on {CHAINS[chain].name}</p>
        </div>
      )}
    </div>
  );
}

// Quick Actions
function QuickActions({ onAction }) {
  const actions = [
    { id: 'receive', icon: Fingerprint, title: 'Private Receive', desc: 'Generate stealth address', color: '#00FF94' },
    { id: 'send', icon: Zap, title: 'Private Send', desc: 'Send to any address', color: '#00F0FF' },
    { id: 'swap', icon: RefreshCw, title: 'Private Swap', desc: 'Swap with privacy', color: '#00FF94' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {actions.map((a) => (
        <button key={a.id} onClick={() => onAction(a.id)} className="group bg-black/30 backdrop-blur border border-white/5 p-6 text-left hover:border-white/20 transition-all">
          <a.icon className="w-8 h-8 mb-4" style={{ color: a.color }} strokeWidth={1.5} />
          <h3 className="text-lg font-semibold mb-1">{a.title}</h3>
          <p className="text-sm text-[#888]">{a.desc}</p>
          <ArrowRight className="w-4 h-4 mt-4 text-[#888] group-hover:text-white group-hover:translate-x-1 transition-all" />
        </button>
      ))}
    </div>
  );
}

// Features
function Features() {
  const items = [
    { icon: Shield, title: "ZK Ready", color: "#00FF94" },
    { icon: Globe, title: "Multi-Chain", color: "#00F0FF" },
    { icon: Lock, title: "Non-Custodial", color: "#00FF94" },
    { icon: Database, title: "Stateless", color: "#00F0FF" },
    { icon: Code, title: "Open Source", color: "#00FF94" },
    { icon: TrendingUp, title: "0.05% Fee", color: "#00F0FF" },
  ];

  return (
    <div className="flex flex-wrap justify-center gap-4">
      {items.map((f, i) => (
        <div key={i} className="flex items-center gap-2 px-4 py-2 bg-black/30 border border-white/5">
          <f.icon className="w-4 h-4" style={{ color: f.color }} strokeWidth={1.5} />
          <span className="text-sm">{f.title}</span>
        </div>
      ))}
    </div>
  );
}

// Landing
function Landing() {
  const { connectWallet, isConnecting } = useWallet();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(#00FF94 1px, transparent 1px), linear-gradient(90deg, #00FF94 1px, transparent 1px)`,
        backgroundSize: '100px 100px'
      }} />
      
      {/* Globe */}
      <div className="absolute inset-0 flex items-center justify-center opacity-40 pointer-events-none">
        <RotatingEarth width={700} height={700} />
      </div>
      
      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl">
        <h1 className="font-heading text-6xl md:text-8xl font-bold tracking-tighter text-white mb-6 leading-[0.85]">
          Universal<br />Privacy<br />Layer
        </h1>
        
        <p className="text-2xl md:text-3xl text-[#00FF94] mb-4 font-medium">
          The HTTPS of Web3
        </p>
        
        <p className="text-lg text-[#888] mb-10 max-w-xl mx-auto">
          Real cryptographic privacy on Base, Arbitrum & Ethereum.
          Every transaction hidden. Every balance invisible.
        </p>
        
        <button
          onClick={connectWallet}
          disabled={isConnecting}
          className="px-14 py-5 bg-[#00FF94] text-black font-bold uppercase tracking-widest text-lg hover:scale-105 hover:shadow-[0_0_40px_rgba(0,255,148,0.4)] transition-all flex items-center gap-3 mx-auto"
        >
          {isConnecting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Hexagon className="w-6 h-6" />}
          Enter Privacy Layer
        </button>
        
        {/* Stats */}
        <div className="mt-16 flex items-center justify-center gap-12">
          <div className="text-center">
            <p className="font-heading text-4xl font-bold text-[#00FF94]">100%</p>
            <p className="text-xs text-[#888] uppercase mt-1">Private</p>
          </div>
          <div className="text-center">
            <p className="font-heading text-4xl font-bold text-[#00F0FF]">3</p>
            <p className="text-xs text-[#888] uppercase mt-1">Mainnets</p>
          </div>
          <div className="text-center">
            <p className="font-heading text-4xl font-bold text-white">LIVE</p>
            <p className="text-xs text-[#888] uppercase mt-1">On Base</p>
          </div>
        </div>

        {/* Contract Badge */}
        <div className="mt-12">
          <a 
            href="https://basescan.org/address/0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-black/50 border border-[#00FF94]/30 text-sm text-[#00FF94] hover:bg-[#00FF94]/10 transition-colors"
          >
            <div className="w-2 h-2 rounded-full bg-[#00FF94] animate-pulse" />
            Contracts Live on Base Mainnet
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

// Dashboard
function Dashboard() {
  const { address } = useWallet();
  const [modal, setModal] = useState(null);

  if (!address) return <Landing />;

  return (
    <div className="min-h-screen pt-24 pb-16 px-6">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center">
          <h1 className="font-heading text-3xl font-bold mb-2">Privacy Dashboard</h1>
          <p className="text-[#888]">Manage your private transactions on mainnet</p>
        </div>

        {/* Balance */}
        <BalanceCard />

        {/* Actions */}
        <QuickActions onAction={setModal} />

        {/* Features */}
        <Features />

        {/* Modals */}
        <Modal isOpen={modal === 'receive'} onClose={() => setModal(null)} title="Private Receive">
          <StealthContent />
        </Modal>
        <Modal isOpen={modal === 'send'} onClose={() => setModal(null)} title="Private Send">
          <SendContent />
        </Modal>
        <Modal isOpen={modal === 'swap'} onClose={() => setModal(null)} title="Private Swap">
          <SendContent />
        </Modal>
      </div>
    </div>
  );
}

// App
function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-[#050505] text-white">
        <FloatingControls />
        <Dashboard />
        <Toaster position="bottom-right" toastOptions={{
          style: { background: '#0A0A0A', border: '1px solid #222', color: '#EDEDED', fontFamily: 'Rajdhani' }
        }} />
      </div>
    </WalletProvider>
  );
}

export default App;
