import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { 
  Wallet, ArrowUpRight, ArrowDownLeft, 
  RefreshCw, Copy, Check, ExternalLink, Eye, EyeOff,
  ChevronDown, Zap, Lock, Layers, Activity,
  Loader2, Hexagon, Fingerprint, ArrowRight, 
  Shield, Globe, Cpu, Database, Code, TrendingUp
} from "lucide-react";
import { Toaster, toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Chain configurations - MAINNET
const CHAINS = {
  base: {
    name: "Base",
    chainId: "0x2105",
    chainIdDec: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    symbol: "ETH",
    color: "#0052FF",
    isMainnet: true
  },
  arbitrum: {
    name: "Arbitrum One", 
    chainId: "0xa4b1",
    chainIdDec: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    symbol: "ETH",
    color: "#28A0F0",
    isMainnet: true
  },
  ethereum: {
    name: "Ethereum",
    chainId: "0x1",
    chainIdDec: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
    symbol: "ETH",
    color: "#627EEA",
    isMainnet: true
  }
};

// Wallet Context
const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

// Custom Logo
function UPLLogo({ size = 48, animated = false }) {
  return (
    <div className={`relative ${animated ? 'animate-pulse-glow' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <path d="M50 5L90 27.5V72.5L50 95L10 72.5V27.5L50 5Z" stroke="#00FF94" strokeWidth="2" fill="rgba(0,255,148,0.05)"/>
        <path d="M50 20L75 35V65L50 80L25 65V35L50 20Z" stroke="#00FF94" strokeWidth="1.5" strokeOpacity="0.6" fill="none"/>
        <path d="M50 32L65 41V59L50 68L35 59V41L50 32Z" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.4" fill="rgba(0,255,148,0.1)"/>
        <circle cx="50" cy="50" r="4" fill="#00FF94" />
        <line x1="50" y1="46" x2="50" y2="32" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
        <line x1="54" y1="50" x2="65" y2="50" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
        <line x1="46" y1="50" x2="35" y2="50" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
        <line x1="50" y1="54" x2="50" y2="68" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
      </svg>
    </div>
  );
}

// WalletProvider
function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState("base");
  const [balance, setBalance] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error("Please install MetaMask");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const ethProvider = new ethers.BrowserProvider(window.ethereum);
      const ethSigner = await ethProvider.getSigner();
      setAddress(accounts[0]);
      setProvider(ethProvider);
      setSigner(ethSigner);
      toast.success("Wallet connected");
    } catch (err) {
      toast.error("Connection failed");
    }
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
    toast.success(`Switched to ${CHAINS[chainKey].name}`);
    if (window.ethereum && address) {
      const chainConfig = CHAINS[chainKey];
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainConfig.chainId }]
        });
      } catch (err) {
        if (err.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainConfig.chainId,
              chainName: chainConfig.name,
              rpcUrls: [chainConfig.rpcUrl],
              blockExplorerUrls: [chainConfig.explorer],
              nativeCurrency: { name: chainConfig.symbol, symbol: chainConfig.symbol, decimals: 18 }
            }]
          });
        }
      }
    }
  };

  const fetchBalance = useCallback(async () => {
    if (!address || !provider) return;
    try {
      const bal = await provider.getBalance(address);
      setBalance({
        total_balance_eth: ethers.formatEther(bal),
        main_balance_wei: bal.toString(),
        stealth_balance_wei: "0",
        symbol: CHAINS[chain].symbol
      });
    } catch (err) {
      console.error(err);
    }
  }, [address, chain, provider]);

  useEffect(() => {
    if (address && provider) fetchBalance();
  }, [address, chain, provider, fetchBalance]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length > 0) setAddress(accounts[0]);
        else disconnectWallet();
      });
    }
  }, []);

  return (
    <WalletContext.Provider value={{
      address, chain, balance, provider, signer, isConnecting,
      connectWallet, disconnectWallet, switchChain, fetchBalance, setChain
    }}>
      {children}
    </WalletContext.Provider>
  );
}

// Floating Controls
function FloatingControls() {
  const { address, chain, connectWallet, disconnectWallet, switchChain, isConnecting } = useWallet();
  const [showChainMenu, setShowChainMenu] = useState(false);
  const truncateAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-3">
      <div className="relative">
        <button
          data-testid="chain-selector"
          onClick={() => setShowChainMenu(!showChainMenu)}
          className="flex items-center gap-2 px-4 py-2.5 bg-black/80 backdrop-blur-xl border border-white/10 hover:border-[#00FF94]/50 transition-all"
        >
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[chain].color }} />
          <span className="text-sm text-[#EDEDED]">{CHAINS[chain].name}</span>
          <ChevronDown className={`w-4 h-4 text-[#888] transition-transform ${showChainMenu ? 'rotate-180' : ''}`} />
        </button>
        {showChainMenu && (
          <div className="absolute top-full mt-2 right-0 bg-black/95 backdrop-blur-xl border border-white/10 min-w-[180px]">
            {Object.entries(CHAINS).map(([key, config]) => (
              <button
                key={key}
                onClick={() => { switchChain(key); setShowChainMenu(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#00FF94]/10 transition-colors text-left ${chain === key ? 'bg-[#00FF94]/5 border-l-2 border-[#00FF94]' : ''}`}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-sm">{config.name}</span>
                {config.isMainnet && <span className="text-[10px] text-[#00FF94] ml-auto">MAINNET</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {address ? (
        <button onClick={disconnectWallet} className="flex items-center gap-2 px-4 py-2.5 bg-[#00FF94]/10 border border-[#00FF94]/50 text-[#00FF94] hover:bg-[#00FF94] hover:text-black transition-all">
          <div className="w-2 h-2 rounded-full bg-[#00FF94] animate-pulse" />
          <span className="font-mono text-sm">{truncateAddress(address)}</span>
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

// Quick Action Card
function QuickAction({ icon: Icon, title, desc, color, onClick, testId }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="group bg-black/30 backdrop-blur border border-white/5 p-6 text-left hover:border-white/20 transition-all duration-300 hover:bg-black/50"
    >
      <Icon className="w-8 h-8 mb-4 transition-colors" style={{ color }} strokeWidth={1.5} />
      <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-[#888]">{desc}</p>
      <ArrowRight className="w-4 h-4 mt-4 text-[#888] group-hover:text-white group-hover:translate-x-1 transition-all" />
    </button>
  );
}

// Modal Component
function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0A0A0A] border border-white/10 w-full max-w-lg max-h-[80vh] overflow-auto">
        <div className="sticky top-0 bg-[#0A0A0A] border-b border-white/10 p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 transition-colors">
            <ArrowRight className="w-5 h-5 rotate-45" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// Stealth Address Modal Content
function StealthContent() {
  const { address, chain } = useWallet();
  const [stealthAddress, setStealthAddress] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!address) { toast.error("Connect wallet first"); return; }
    setIsGenerating(true);
    try {
      const res = await axios.post(`${API}/stealth/generate`, { public_address: address, chain });
      setStealthAddress(res.data);
      toast.success("Stealth address generated");
    } catch { toast.error("Generation failed"); }
    setIsGenerating(false);
  };

  const copy = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <p className="text-[#888]">Generate a one-time stealth address. The sender cannot link this address to you.</p>
      <button
        onClick={generate}
        disabled={isGenerating || !address}
        className="w-full py-4 bg-[#00FF94]/10 border border-[#00FF94]/50 text-[#00FF94] uppercase tracking-widest font-bold hover:bg-[#00FF94] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
        Generate Address
      </button>
      {stealthAddress && (
        <div className="bg-black/50 p-4 border border-[#00FF94]/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#888] uppercase tracking-wider">Stealth Address</span>
            <button onClick={() => copy(stealthAddress.stealth_address)} className="p-1 hover:bg-white/5">
              {copied ? <Check className="w-4 h-4 text-[#00FF94]" /> : <Copy className="w-4 h-4 text-[#888]" />}
            </button>
          </div>
          <p className="font-mono text-sm text-[#00FF94] break-all">{stealthAddress.stealth_address}</p>
          <div className="pt-3 border-t border-white/10 flex justify-between text-xs text-[#888]">
            <span>View Tag: <span className="text-white font-mono">{stealthAddress.view_tag}</span></span>
            <span>{CHAINS[chain].name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Private Send Modal Content
function SendContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const send = async () => {
    if (!address || !signer) { toast.error("Connect wallet first"); return; }
    if (!ethers.isAddress(recipient)) { toast.error("Invalid address"); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error("Enter amount"); return; }
    
    setIsSending(true);
    try {
      const tx = await signer.sendTransaction({ to: recipient, value: ethers.parseEther(amount) });
      toast.success("Transaction sent");
      setTxHash(tx.hash);
      await tx.wait();
      toast.success("Confirmed!");
      fetchBalance();
      setRecipient("");
      setAmount("");
    } catch (err) {
      toast.error(err.message || "Failed");
    }
    setIsSending(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs text-[#888] uppercase tracking-wider mb-2">Recipient</label>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x... or stealth address"
          className="w-full bg-black/50 border border-white/10 focus:border-[#00FF94] p-4 font-mono text-sm outline-none transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs text-[#888] uppercase tracking-wider mb-2">Amount (ETH)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          step="0.001"
          className="w-full bg-black/50 border border-white/10 focus:border-[#00FF94] p-4 font-mono text-sm outline-none transition-colors"
        />
      </div>
      <button
        onClick={send}
        disabled={isSending || !address}
        className="w-full py-4 bg-[#00F0FF]/10 border border-[#00F0FF]/50 text-[#00F0FF] uppercase tracking-widest font-bold hover:bg-[#00F0FF] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send Privately
      </button>
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-sm text-[#00FF94] hover:underline">
          View Transaction <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

// Swap Modal Content
function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [amountIn, setAmountIn] = useState("");
  const [recipient, setRecipient] = useState("");
  const [isSwapping, setIsSwapping] = useState(false);

  const swap = async () => {
    if (!address || !signer) { toast.error("Connect wallet first"); return; }
    if (!recipient || !ethers.isAddress(recipient)) { toast.error("Enter stealth address"); return; }
    if (!amountIn || parseFloat(amountIn) <= 0) { toast.error("Enter amount"); return; }
    
    setIsSwapping(true);
    try {
      const tx = await signer.sendTransaction({ to: recipient, value: ethers.parseEther(amountIn) });
      toast.success("Swap initiated");
      await tx.wait();
      toast.success("Swap confirmed!");
      fetchBalance();
      setAmountIn("");
    } catch (err) {
      toast.error(err.message || "Swap failed");
    }
    setIsSwapping(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-black/50 p-4 border border-white/10">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-[#888] uppercase">You Pay</span>
          <span className="text-xs text-[#00FF94]">ETH</span>
        </div>
        <input
          type="number"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="0.0"
          className="w-full bg-transparent text-2xl font-mono outline-none"
        />
      </div>
      <div className="flex justify-center">
        <div className="w-10 h-10 bg-[#00FF94]/10 border border-[#00FF94]/30 flex items-center justify-center">
          <ArrowDownLeft className="w-5 h-5 text-[#00FF94]" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-[#888] uppercase tracking-wider mb-2">Recipient Stealth Address</label>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x..."
          className="w-full bg-black/50 border border-white/10 focus:border-[#00FF94] p-4 font-mono text-sm outline-none"
        />
      </div>
      <div className="flex justify-between text-xs text-[#888]">
        <span>Privacy Fee</span>
        <span className="text-[#00FF94]">0.05%</span>
      </div>
      <button
        onClick={swap}
        disabled={isSwapping || !address}
        className="w-full py-4 bg-gradient-to-r from-[#00FF94]/20 to-[#00F0FF]/20 border border-[#00FF94]/50 text-[#00FF94] uppercase tracking-widest font-bold hover:from-[#00FF94] hover:to-[#00F0FF] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSwapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
        Swap Privately
      </button>
    </div>
  );
}

// Balance Display
function BalanceDisplay() {
  const { balance, address } = useWallet();
  const [show, setShow] = useState(true);
  if (!address) return null;

  return (
    <div className="bg-black/30 backdrop-blur border border-white/5 p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#888] uppercase tracking-wider">Your Balance</span>
        <button onClick={() => setShow(!show)} className="p-1 hover:bg-white/5">
          {show ? <Eye className="w-4 h-4 text-[#888]" /> : <EyeOff className="w-4 h-4 text-[#888]" />}
        </button>
      </div>
      <div className="flex items-end gap-2">
        <span className="font-heading text-4xl font-bold">
          {show && balance ? parseFloat(balance.total_balance_eth).toFixed(4) : '••••'}
        </span>
        <span className="text-[#888] mb-1">ETH</span>
      </div>
    </div>
  );
}

// Transaction History
function HistoryDisplay() {
  const { address, chain } = useWallet();
  const [txs, setTxs] = useState([]);

  const fetch = useCallback(async () => {
    if (!address) return;
    try {
      const res = await axios.get(`${API}/transactions/${address}?chain=${chain}`);
      setTxs(res.data.transactions || []);
    } catch {}
  }, [address, chain]);

  useEffect(() => { fetch(); }, [fetch]);

  if (!address || txs.length === 0) return null;

  return (
    <div className="bg-black/30 backdrop-blur border border-white/5 p-6">
      <h3 className="text-xs text-[#888] uppercase tracking-wider mb-4">Recent Activity</h3>
      <div className="space-y-2">
        {txs.slice(0, 3).map((tx, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-[#00F0FF]" />
              <span className="text-sm">{tx.tx_type}</span>
            </div>
            <span className="text-xs text-[#888] font-mono">{(parseFloat(tx.amount_wei) / 1e18).toFixed(4)} ETH</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Features Grid
function Features() {
  const features = [
    { icon: Shield, title: "ZK Proofs", desc: "Zero-knowledge verification", color: "#00FF94" },
    { icon: Globe, title: "Multi-Chain", desc: "Base, Arbitrum, Ethereum", color: "#00F0FF" },
    { icon: Cpu, title: "Stealth Addresses", desc: "One-time receive addresses", color: "#00FF94" },
    { icon: Database, title: "No Data Storage", desc: "Non-custodial & stateless", color: "#00F0FF" },
    { icon: Code, title: "Open Source", desc: "Auditable smart contracts", color: "#00FF94" },
    { icon: TrendingUp, title: "0.05% Fee", desc: "Industry-lowest privacy fee", color: "#00F0FF" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {features.map((f, i) => (
        <div key={i} className="bg-black/20 border border-white/5 p-4 text-center hover:border-white/10 transition-colors">
          <f.icon className="w-6 h-6 mx-auto mb-2" style={{ color: f.color }} strokeWidth={1.5} />
          <p className="text-sm font-medium">{f.title}</p>
          <p className="text-xs text-[#888]">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}

// Landing Page
function LandingPage() {
  const { connectWallet, isConnecting } = useWallet();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative">
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: `linear-gradient(rgba(0,255,148,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,148,0.3) 1px, transparent 1px)`,
        backgroundSize: '80px 80px'
      }} />
      <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] bg-[#00FF94]/5 rounded-full blur-[150px]" />
      
      <div className="relative z-10 text-center max-w-3xl">
        <div className="mb-10">
          <UPLLogo size={80} animated />
        </div>
        
        <h1 className="font-heading text-6xl md:text-8xl font-bold tracking-tighter text-white mb-4 leading-[0.9]">
          Universal<br />Privacy Layer
        </h1>
        
        <p className="text-2xl text-[#00FF94] mb-4">The HTTPS of Web3</p>
        
        <p className="text-lg text-[#888] mb-12 max-w-xl mx-auto">
          Real cryptographic privacy. Every transaction hidden. Every balance invisible.
        </p>
        
        <button
          data-testid="landing-connect"
          onClick={connectWallet}
          disabled={isConnecting}
          className="px-14 py-5 bg-[#00FF94] text-black font-bold uppercase tracking-widest text-lg hover:scale-105 transition-all flex items-center gap-3 mx-auto"
        >
          {isConnecting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Hexagon className="w-6 h-6" />}
          Enter Privacy Layer
        </button>
        
        <div className="mt-16 flex items-center justify-center gap-12">
          <div className="text-center">
            <p className="font-heading text-3xl font-bold text-[#00FF94]">100%</p>
            <p className="text-xs text-[#888] uppercase mt-1">Private</p>
          </div>
          <div className="text-center">
            <p className="font-heading text-3xl font-bold text-[#00F0FF]">3</p>
            <p className="text-xs text-[#888] uppercase mt-1">Mainnets</p>
          </div>
          <div className="text-center">
            <p className="font-heading text-3xl font-bold text-white">0.05%</p>
            <p className="text-xs text-[#888] uppercase mt-1">Fee</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Dashboard
function Dashboard() {
  const { address } = useWallet();
  const [activeModal, setActiveModal] = useState(null);

  if (!address) return <LandingPage />;

  return (
    <div className="min-h-screen pt-24 pb-16 px-6">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="flex items-center gap-4">
          <UPLLogo size={40} />
          <div>
            <h1 className="font-heading text-2xl font-bold">Privacy Dashboard</h1>
            <p className="text-sm text-[#888]">Manage your private transactions</p>
          </div>
        </div>

        {/* Balance & History */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <BalanceDisplay />
          <HistoryDisplay />
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-xs text-[#888] uppercase tracking-wider mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <QuickAction
              icon={Fingerprint}
              title="Private Receive"
              desc="Generate a stealth address"
              color="#00FF94"
              onClick={() => setActiveModal('stealth')}
              testId="action-receive"
            />
            <QuickAction
              icon={Zap}
              title="Private Send"
              desc="Send to any address privately"
              color="#00F0FF"
              onClick={() => setActiveModal('send')}
              testId="action-send"
            />
            <QuickAction
              icon={RefreshCw}
              title="Private Swap"
              desc="Swap tokens with privacy"
              color="#00FF94"
              onClick={() => setActiveModal('swap')}
              testId="action-swap"
            />
          </div>
        </div>

        {/* Features */}
        <div>
          <h2 className="text-xs text-[#888] uppercase tracking-wider mb-4">Privacy Features</h2>
          <Features />
        </div>

        {/* Modals */}
        <Modal isOpen={activeModal === 'stealth'} onClose={() => setActiveModal(null)} title="Generate Stealth Address">
          <StealthContent />
        </Modal>
        <Modal isOpen={activeModal === 'send'} onClose={() => setActiveModal(null)} title="Private Send">
          <SendContent />
        </Modal>
        <Modal isOpen={activeModal === 'swap'} onClose={() => setActiveModal(null)} title="Private Swap">
          <SwapContent />
        </Modal>
      </div>
    </div>
  );
}

// App
function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-[#050505]">
        <div className="noise-overlay" />
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
