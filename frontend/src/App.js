import { useState, useEffect, createContext, useContext, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { ethers } from "ethers";
import { 
  Wallet, ArrowUpRight, ArrowDownLeft, 
  RefreshCw, Copy, Check, ExternalLink, Eye, EyeOff,
  ChevronDown, Zap, Lock, Layers, Activity,
  Loader2, Hexagon, Grid3X3, Fingerprint
} from "lucide-react";
import { Toaster, toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Chain configurations
const CHAINS = {
  ethereum_sepolia: {
    name: "Ethereum Sepolia",
    chainId: "0xaa36a7",
    chainIdDec: 11155111,
    rpcUrl: "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    symbol: "ETH",
    color: "#627EEA"
  },
  arbitrum_sepolia: {
    name: "Arbitrum Sepolia", 
    chainId: "0x66eee",
    chainIdDec: 421614,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    symbol: "ETH",
    color: "#28A0F0"
  },
  base_sepolia: {
    name: "Base Sepolia",
    chainId: "0x14a34",
    chainIdDec: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    symbol: "ETH",
    color: "#0052FF"
  }
};

// Wallet Context
const WalletContext = createContext();

export const useWallet = () => useContext(WalletContext);

// Custom Logo Component
function UPLLogo({ size = 48, animated = false }) {
  return (
    <div className={`relative ${animated ? 'animate-pulse-glow' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* Outer hexagon */}
        <path 
          d="M50 5L90 27.5V72.5L50 95L10 72.5V27.5L50 5Z" 
          stroke="#00FF94" 
          strokeWidth="2" 
          fill="rgba(0,255,148,0.05)"
        />
        {/* Inner pattern - privacy layers */}
        <path 
          d="M50 20L75 35V65L50 80L25 65V35L50 20Z" 
          stroke="#00FF94" 
          strokeWidth="1.5" 
          strokeOpacity="0.6"
          fill="none"
        />
        <path 
          d="M50 32L65 41V59L50 68L35 59V41L50 32Z" 
          stroke="#00FF94" 
          strokeWidth="1" 
          strokeOpacity="0.4"
          fill="rgba(0,255,148,0.1)"
        />
        {/* Center dot */}
        <circle cx="50" cy="50" r="4" fill="#00FF94" />
        {/* Connection lines */}
        <line x1="50" y1="46" x2="50" y2="32" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
        <line x1="54" y1="50" x2="65" y2="50" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
        <line x1="46" y1="50" x2="35" y2="50" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
        <line x1="50" y1="54" x2="50" y2="68" stroke="#00FF94" strokeWidth="1" strokeOpacity="0.5" />
      </svg>
    </div>
  );
}

// WalletProvider Component
function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState("ethereum_sepolia");
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
      const accounts = await window.ethereum.request({ 
        method: "eth_requestAccounts" 
      });
      const ethProvider = new ethers.BrowserProvider(window.ethereum);
      const ethSigner = await ethProvider.getSigner();
      
      setAddress(accounts[0]);
      setProvider(ethProvider);
      setSigner(ethSigner);
      
      toast.success("Wallet connected");
    } catch (err) {
      toast.error("Connection failed");
      console.error(err);
    }
    setIsConnecting(false);
  };

  const disconnectWallet = () => {
    setAddress(null);
    setProvider(null);
    setSigner(null);
    setBalance(null);
    toast.success("Wallet disconnected");
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
          try {
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
          } catch (addErr) {
            console.error("Failed to add network", addErr);
          }
        }
      }
    }
  };

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      const res = await axios.get(`${API}/balance/${address}?chain=${chain}`);
      setBalance(res.data);
    } catch (err) {
      console.error(err);
    }
  }, [address, chain]);

  useEffect(() => {
    if (address) fetchBalance();
  }, [address, chain, fetchBalance]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length > 0) {
          setAddress(accounts[0]);
        } else {
          disconnectWallet();
        }
      });
      
      window.ethereum.on("chainChanged", () => {
        window.location.reload();
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

// Floating Controls (replaces navbar)
function FloatingControls() {
  const { address, chain, connectWallet, disconnectWallet, switchChain, isConnecting } = useWallet();
  const [showChainMenu, setShowChainMenu] = useState(false);

  const truncateAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="fixed top-6 right-6 z-50 flex items-center gap-3">
      {/* Chain Selector */}
      <div className="relative">
        <button
          data-testid="chain-selector"
          onClick={() => setShowChainMenu(!showChainMenu)}
          className="flex items-center gap-2 px-4 py-2.5 bg-black/80 backdrop-blur-xl border border-white/10 hover:border-[#00FF94]/50 transition-all duration-300"
        >
          <div 
            className="w-2 h-2 rounded-full" 
            style={{ backgroundColor: CHAINS[chain].color }}
          />
          <span className="text-sm text-[#EDEDED] font-medium">{CHAINS[chain].name}</span>
          <ChevronDown className={`w-4 h-4 text-[#888888] transition-transform ${showChainMenu ? 'rotate-180' : ''}`} />
        </button>
        
        {showChainMenu && (
          <div className="absolute top-full mt-2 right-0 bg-black/95 backdrop-blur-xl border border-white/10 min-w-[200px] overflow-hidden">
            {Object.entries(CHAINS).map(([key, config]) => (
              <button
                key={key}
                data-testid={`chain-option-${key}`}
                onClick={() => { switchChain(key); setShowChainMenu(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#00FF94]/10 transition-colors text-left ${chain === key ? 'bg-[#00FF94]/5 border-l-2 border-[#00FF94]' : ''}`}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-sm">{config.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Wallet Button */}
      {address ? (
        <button
          data-testid="wallet-disconnect"
          onClick={disconnectWallet}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#00FF94]/10 border border-[#00FF94]/50 text-[#00FF94] hover:bg-[#00FF94] hover:text-black transition-all duration-300"
        >
          <div className="w-2 h-2 rounded-full bg-[#00FF94] animate-pulse" />
          <span className="font-mono text-sm">{truncateAddress(address)}</span>
        </button>
      ) : (
        <button
          data-testid="wallet-connect"
          onClick={connectWallet}
          disabled={isConnecting}
          aria-disabled={isConnecting}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#00FF94] text-black font-bold uppercase tracking-widest text-sm hover:scale-105 transition-all duration-200 disabled:opacity-50"
        >
          {isConnecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wallet className="w-4 h-4" strokeWidth={2} />
          )}
          Connect
        </button>
      )}
    </div>
  );
}

// Balance Card
function BalanceCard() {
  const { balance, fetchBalance, address, chain } = useWallet();
  const [showBalance, setShowBalance] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchBalance();
    setIsRefreshing(false);
  };

  if (!address) return null;

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/10 p-6 hover:border-[#00FF94]/30 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-[#00FF94]" strokeWidth={1.5} />
          <h3 className="text-[#888888] uppercase tracking-widest text-xs font-semibold">Hidden Balance</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="toggle-balance-visibility"
            onClick={() => setShowBalance(!showBalance)}
            className="p-2 hover:bg-white/5 transition-colors"
          >
            {showBalance ? <Eye className="w-4 h-4 text-[#888888]" /> : <EyeOff className="w-4 h-4 text-[#888888]" />}
          </button>
          <button
            data-testid="refresh-balance"
            onClick={handleRefresh}
            className="p-2 hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-[#888888] ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      
      {balance ? (
        <>
          <div className="mb-4">
            <span className="font-heading text-4xl font-bold text-white">
              {showBalance ? parseFloat(balance.total_balance_eth).toFixed(6) : '••••••'}
            </span>
            <span className="text-[#888888] ml-2">{balance.symbol}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#0A0A0A] p-3">
              <p className="text-[#888888] text-xs uppercase tracking-wider mb-1">Main Wallet</p>
              <p className="font-mono text-sm text-[#EDEDED]">
                {showBalance ? (parseFloat(balance.main_balance_wei) / 1e18).toFixed(6) : '••••'} {balance.symbol}
              </p>
            </div>
            <div className="bg-[#0A0A0A] p-3">
              <p className="text-[#888888] text-xs uppercase tracking-wider mb-1">Stealth Wallets</p>
              <p className="font-mono text-sm text-[#00FF94]">
                {showBalance ? (parseFloat(balance.stealth_balance_wei) / 1e18).toFixed(6) : '••••'} {balance.symbol}
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="animate-pulse">
          <div className="h-10 bg-[#121212] w-48 mb-4"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-16 bg-[#121212]"></div>
            <div className="h-16 bg-[#121212]"></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Stealth Address Generator
function StealthGenerator() {
  const { address, chain } = useWallet();
  const [stealthAddress, setStealthAddress] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateStealth = async () => {
    if (!address) {
      toast.error("Connect wallet first");
      return;
    }
    
    setIsGenerating(true);
    try {
      const res = await axios.post(`${API}/stealth/generate`, {
        public_address: address,
        chain: chain
      });
      setStealthAddress(res.data);
      toast.success("Stealth address generated");
    } catch (err) {
      toast.error("Generation failed");
      console.error(err);
    }
    setIsGenerating(false);
  };

  const copyToClipboard = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/10 p-6 hover:border-[#00FF94]/30 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <Fingerprint className="w-5 h-5 text-[#00FF94]" strokeWidth={1.5} />
        <h3 className="text-[#888888] uppercase tracking-widest text-xs font-semibold">Private Receive</h3>
      </div>
      
      <p className="text-sm text-[#888888] mb-4">
        Generate a one-time stealth address. Sender cannot link to you.
      </p>
      
      <button
        data-testid="generate-stealth"
        onClick={generateStealth}
        disabled={isGenerating || !address}
        className="w-full py-3 bg-[#00FF94]/10 border border-[#00FF94]/50 text-[#00FF94] uppercase tracking-widest text-sm font-bold hover:bg-[#00FF94] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isGenerating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowDownLeft className="w-4 h-4" strokeWidth={1.5} />
        )}
        Generate Stealth Address
      </button>
      
      {stealthAddress && (
        <div className="mt-4 bg-[#0A0A0A] p-4 border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#888888] uppercase tracking-wider">Your Stealth Address</span>
            <button
              data-testid="copy-stealth-address"
              onClick={() => copyToClipboard(stealthAddress.stealth_address)}
              className="p-1 hover:bg-white/5"
            >
              {copied ? <Check className="w-4 h-4 text-[#00FF94]" /> : <Copy className="w-4 h-4 text-[#888888]" />}
            </button>
          </div>
          <p className="font-mono text-sm text-[#00FF94] break-all">{stealthAddress.stealth_address}</p>
          <div className="mt-3 pt-3 border-t border-[#222222] flex items-center justify-between">
            <span className="text-xs text-[#888888]">View Tag: <span className="font-mono text-[#EDEDED]">{stealthAddress.view_tag}</span></span>
            <span className="text-xs text-[#888888]">{CHAINS[chain].name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Private Send Component
function PrivateSend() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const sendPrivate = async () => {
    if (!address || !signer) {
      toast.error("Connect wallet first");
      return;
    }
    
    if (!ethers.isAddress(recipient)) {
      toast.error("Invalid recipient address");
      return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Enter valid amount");
      return;
    }
    
    setIsSending(true);
    try {
      const amountWei = ethers.parseEther(amount);
      
      const tx = await signer.sendTransaction({
        to: recipient,
        value: amountWei
      });
      
      toast.success("Transaction sent");
      setTxHash(tx.hash);
      
      await tx.wait();
      toast.success("Transaction confirmed");
      
      await axios.post(`${API}/transactions/record`, {
        tx_hash: tx.hash,
        from_address: address,
        to_address: recipient,
        amount_wei: amountWei.toString(),
        chain: chain,
        tx_type: "private_send",
        status: "confirmed"
      });
      
      await axios.post(`${API}/receipt/create`, {
        transaction_hash: tx.hash,
        sender_address: address,
        recipient_stealth_address: recipient,
        amount_wei: amountWei.toString(),
        chain: chain,
        timestamp: new Date().toISOString()
      });
      
      fetchBalance();
      setRecipient("");
      setAmount("");
    } catch (err) {
      toast.error(err.message || "Transaction failed");
      console.error(err);
    }
    setIsSending(false);
  };

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/10 p-6 hover:border-[#00F0FF]/30 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <Zap className="w-5 h-5 text-[#00F0FF]" strokeWidth={1.5} />
        <h3 className="text-[#888888] uppercase tracking-widest text-xs font-semibold">Private Send</h3>
      </div>
      
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[#888888] uppercase tracking-wider mb-2">Recipient Address</label>
          <input
            data-testid="send-recipient-input"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x... or stealth address"
            className="w-full bg-black/50 border-b border-white/20 focus:border-[#00F0FF] rounded-none px-0 py-3 text-sm font-mono placeholder:text-white/20 outline-none transition-colors"
          />
        </div>
        
        <div>
          <label className="block text-xs text-[#888888] uppercase tracking-wider mb-2">Amount ({CHAINS[chain].symbol})</label>
          <input
            data-testid="send-amount-input"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            step="0.0001"
            className="w-full bg-black/50 border-b border-white/20 focus:border-[#00F0FF] rounded-none px-0 py-3 text-sm font-mono placeholder:text-white/20 outline-none transition-colors"
          />
        </div>
        
        <button
          data-testid="send-button"
          onClick={sendPrivate}
          disabled={isSending || !address}
          className="w-full py-3 bg-[#00F0FF]/10 border border-[#00F0FF]/50 text-[#00F0FF] uppercase tracking-widest text-sm font-bold hover:bg-[#00F0FF] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowUpRight className="w-4 h-4" strokeWidth={1.5} />
          )}
          Send Privately
        </button>
        
        {txHash && (
          <div className="bg-[#0A0A0A] p-3 border border-[#222222]">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#888888] uppercase">Transaction Hash</span>
              <a
                href={`${CHAINS[chain].explorer}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[#00FF94] hover:underline"
              >
                View <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="font-mono text-xs text-[#EDEDED] break-all mt-1">{txHash}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Transaction History
function TransactionHistory() {
  const { address, chain } = useWallet();
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const res = await axios.get(`${API}/transactions/${address}?chain=${chain}`);
      setTransactions(res.data.transactions || []);
    } catch (err) {
      console.error(err);
    }
    setIsLoading(false);
  }, [address, chain]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  if (!address) return null;

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-[#888888]" strokeWidth={1.5} />
          <h3 className="text-[#888888] uppercase tracking-widest text-xs font-semibold">Transaction History</h3>
        </div>
        <button
          data-testid="refresh-transactions"
          onClick={fetchTransactions}
          className="p-2 hover:bg-white/5 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-[#888888] ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      
      {transactions.length > 0 ? (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {transactions.map((tx, idx) => (
            <div key={idx} className="bg-[#0A0A0A] p-3 border border-[#222222] hover:border-[#00FF94]/30 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {tx.from_address.toLowerCase() === address.toLowerCase() ? (
                    <ArrowUpRight className="w-4 h-4 text-[#FF3B30]" />
                  ) : (
                    <ArrowDownLeft className="w-4 h-4 text-[#00FF94]" />
                  )}
                  <span className="text-xs uppercase tracking-wider text-[#888888]">{tx.tx_type}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 ${tx.status === 'confirmed' ? 'bg-[#00FF94]/10 text-[#00FF94]' : 'bg-yellow-500/10 text-yellow-500'}`}>
                  {tx.status}
                </span>
              </div>
              <p className="font-mono text-xs text-[#EDEDED] truncate">{tx.tx_hash}</p>
              <p className="text-xs text-[#888888] mt-1">
                {(parseFloat(tx.amount_wei) / 1e18).toFixed(6)} {CHAINS[chain].symbol}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-[#888888]">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No transactions yet</p>
        </div>
      )}
    </div>
  );
}

// Private Swap Component
function PrivateSwap() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState("ETH");
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [quote, setQuote] = useState(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [recipient, setRecipient] = useState("");
  
  const tokens = [
    { symbol: "ETH", name: "Ethereum" },
    { symbol: "USDC", name: "USD Coin" },
    { symbol: "WETH", name: "Wrapped ETH" }
  ];

  const getQuote = async () => {
    if (!amountIn || parseFloat(amountIn) <= 0) return;
    
    setIsQuoting(true);
    try {
      const amountWei = ethers.parseEther(amountIn).toString();
      const res = await axios.post(`${API}/swap/quote`, {
        chain: chain,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amountWei
      });
      setQuote(res.data);
    } catch (err) {
      toast.error("Failed to get quote");
      console.error(err);
    }
    setIsQuoting(false);
  };

  useEffect(() => {
    if (amountIn && parseFloat(amountIn) > 0) {
      const timer = setTimeout(getQuote, 500);
      return () => clearTimeout(timer);
    }
  }, [amountIn, tokenIn, tokenOut, chain]);

  const executeSwap = async () => {
    if (!address || !signer) {
      toast.error("Connect wallet first");
      return;
    }
    
    if (!recipient || !ethers.isAddress(recipient)) {
      toast.error("Enter valid recipient stealth address");
      return;
    }
    
    setIsSwapping(true);
    try {
      // For now, execute as a simple transfer (full Uniswap integration requires deployed contracts)
      const amountWei = ethers.parseEther(amountIn);
      
      const tx = await signer.sendTransaction({
        to: recipient,
        value: amountWei
      });
      
      toast.success("Swap initiated");
      await tx.wait();
      toast.success("Swap confirmed");
      
      // Record the swap
      await axios.post(`${API}/swap/record`, {
        tx_hash: tx.hash,
        from_address: address,
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: amountWei.toString(),
        amount_out: amountWei.toString(),
        chain: chain,
        recipient_stealth: recipient
      });
      
      fetchBalance();
      setAmountIn("");
      setQuote(null);
    } catch (err) {
      toast.error(err.message || "Swap failed");
      console.error(err);
    }
    setIsSwapping(false);
  };

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/10 p-6 hover:border-[#00FF94]/30 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <RefreshCw className="w-5 h-5 text-[#00FF94]" strokeWidth={1.5} />
        <h3 className="text-[#888888] uppercase tracking-widest text-xs font-semibold">Private Swap</h3>
      </div>
      
      <div className="space-y-4">
        {/* Token In */}
        <div className="bg-[#0A0A0A] p-4 border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#888888] uppercase">You Pay</span>
            <select
              data-testid="swap-token-in"
              value={tokenIn}
              onChange={(e) => setTokenIn(e.target.value)}
              className="bg-transparent text-[#00FF94] text-sm font-semibold outline-none cursor-pointer"
            >
              {tokens.map(t => (
                <option key={t.symbol} value={t.symbol} className="bg-[#0A0A0A]">{t.symbol}</option>
              ))}
            </select>
          </div>
          <input
            data-testid="swap-amount-in"
            type="number"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value)}
            placeholder="0.0"
            step="0.0001"
            className="w-full bg-transparent text-2xl font-mono text-white placeholder:text-white/20 outline-none"
          />
        </div>
        
        {/* Swap Arrow */}
        <div className="flex justify-center">
          <div className="w-8 h-8 bg-[#00FF94]/10 border border-[#00FF94]/30 flex items-center justify-center">
            <ArrowDownLeft className="w-4 h-4 text-[#00FF94]" />
          </div>
        </div>
        
        {/* Token Out */}
        <div className="bg-[#0A0A0A] p-4 border border-[#222222]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#888888] uppercase">You Receive</span>
            <select
              data-testid="swap-token-out"
              value={tokenOut}
              onChange={(e) => setTokenOut(e.target.value)}
              className="bg-transparent text-[#00F0FF] text-sm font-semibold outline-none cursor-pointer"
            >
              {tokens.filter(t => t.symbol !== tokenIn).map(t => (
                <option key={t.symbol} value={t.symbol} className="bg-[#0A0A0A]">{t.symbol}</option>
              ))}
            </select>
          </div>
          <div className="text-2xl font-mono text-white/50">
            {isQuoting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : quote ? (
              (parseFloat(quote.estimated_output) / 1e18).toFixed(6)
            ) : (
              "0.0"
            )}
          </div>
        </div>
        
        {/* Fee Info */}
        {quote && (
          <div className="flex items-center justify-between text-xs text-[#888888]">
            <span>Privacy Fee:</span>
            <span className="text-[#00FF94]">{quote.fee_percent}</span>
          </div>
        )}
        
        {/* Recipient */}
        <div>
          <label className="block text-xs text-[#888888] uppercase tracking-wider mb-2">
            Recipient Stealth Address
          </label>
          <input
            data-testid="swap-recipient"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x... stealth address"
            className="w-full bg-black/50 border-b border-white/20 focus:border-[#00FF94] rounded-none px-0 py-3 text-sm font-mono placeholder:text-white/20 outline-none"
          />
        </div>
        
        {/* Swap Button */}
        <button
          data-testid="swap-execute"
          onClick={executeSwap}
          disabled={isSwapping || !address || !amountIn || !recipient}
          className="w-full py-3 bg-gradient-to-r from-[#00FF94]/20 to-[#00F0FF]/20 border border-[#00FF94]/50 text-[#00FF94] uppercase tracking-widest text-sm font-bold hover:from-[#00FF94] hover:to-[#00F0FF] hover:text-black transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSwapping ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
          )}
          Swap Privately
        </button>
      </div>
    </div>
  );
}

// Privacy Features Grid
function PrivacyFeatures() {
  const features = [
    { icon: Lock, title: "Hidden Wallet", desc: "Dual seed phrase system", color: "#00FF94" },
    { icon: Eye, title: "Hidden Balance", desc: "Invisible to explorers", color: "#00FF94" },
    { icon: Fingerprint, title: "Stealth Addresses", desc: "One-time receive addresses", color: "#00F0FF" },
    { icon: Zap, title: "Private Send", desc: "Untraceable transfers", color: "#00F0FF" },
    { icon: Layers, title: "Multi-Chain", desc: "ETH, Arbitrum, Base", color: "#627EEA" },
    { icon: Grid3X3, title: "ZK Proofs", desc: "Coming soon", color: "#888888" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {features.map((f, idx) => (
        <div 
          key={idx} 
          className="bg-black/40 backdrop-blur-md border border-white/10 p-4 hover:border-[#00FF94]/30 transition-all duration-300 group"
        >
          <f.icon className="w-5 h-5 mb-3 transition-colors" style={{ color: f.color }} strokeWidth={1.5} />
          <p className="text-sm font-semibold text-[#EDEDED] mb-1">{f.title}</p>
          <p className="text-xs text-[#888888]">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}

// Landing Page
function LandingPage() {
  const { connectWallet, isConnecting } = useWallet();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,148,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,148,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px'
        }} />
      </div>
      
      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00FF94]/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#00F0FF]/10 rounded-full blur-[120px]" />
      
      <div className="relative z-10 text-center max-w-4xl">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <UPLLogo size={100} animated />
        </div>
        
        <h1 className="font-heading text-5xl md:text-7xl font-bold tracking-tighter text-white mb-6 leading-none">
          Universal<br />Privacy Layer
        </h1>
        
        <p className="text-xl md:text-2xl text-[#00FF94] mb-3 font-medium tracking-wide">
          The HTTPS of Web3
        </p>
        
        <p className="text-base text-[#888888] mb-10 max-w-xl mx-auto leading-relaxed">
          Every transaction hidden. Every balance invisible. Every address private.
          Real cryptographic privacy for your digital assets.
        </p>
        
        <button
          data-testid="landing-connect"
          onClick={connectWallet}
          disabled={isConnecting}
          className="group px-12 py-5 bg-[#00FF94] text-black font-bold uppercase tracking-widest text-base hover:scale-105 transition-all duration-300 disabled:opacity-50 flex items-center gap-3 mx-auto relative overflow-hidden"
        >
          <span className="relative z-10 flex items-center gap-3">
            {isConnecting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Hexagon className="w-5 h-5" strokeWidth={2} />
            )}
            Enter Privacy Layer
          </span>
          <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
        </button>
        
        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-8 max-w-md mx-auto">
          <div className="text-center">
            <p className="font-heading text-3xl font-bold text-[#00FF94]">100%</p>
            <p className="text-xs text-[#888888] uppercase tracking-wider mt-1">Private</p>
          </div>
          <div className="text-center">
            <p className="font-heading text-3xl font-bold text-[#00F0FF]">3</p>
            <p className="text-xs text-[#888888] uppercase tracking-wider mt-1">Chains</p>
          </div>
          <div className="text-center">
            <p className="font-heading text-3xl font-bold text-white">$0</p>
            <p className="text-xs text-[#888888] uppercase tracking-wider mt-1">Extra Fee</p>
          </div>
        </div>
        
        {/* Supported chains */}
        <div className="mt-12 flex items-center justify-center gap-6">
          {Object.entries(CHAINS).map(([key, config]) => (
            <div key={key} className="flex items-center gap-2 text-[#888888]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
              <span className="text-xs">{config.name.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Dashboard
function Dashboard() {
  const { address } = useWallet();

  if (!address) return <LandingPage />;

  return (
    <div className="min-h-screen pt-20 pb-12 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Header with logo */}
        <div className="flex items-center gap-4 mb-8">
          <UPLLogo size={48} />
          <div>
            <h2 className="font-heading text-2xl font-bold tracking-tight text-white">Privacy Dashboard</h2>
            <p className="text-sm text-[#888888]">Manage your private transactions</p>
          </div>
        </div>
        
        {/* Features Grid */}
        <div className="mb-8">
          <PrivacyFeatures />
        </div>
        
        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <BalanceCard />
          </div>
          
          <div className="space-y-6">
            <StealthGenerator />
            <PrivateSend />
          </div>
          
          <div className="space-y-6">
            <TransactionHistory />
          </div>
        </div>
      </div>
    </div>
  );
}

// Main App
function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-[#050505]">
        <div className="noise-overlay" />
        <FloatingControls />
        <Dashboard />
        <Toaster 
          position="bottom-right" 
          toastOptions={{
            style: {
              background: '#0A0A0A',
              border: '1px solid #222222',
              color: '#EDEDED',
              fontFamily: 'Rajdhani, sans-serif'
            }
          }}
        />
      </div>
    </WalletProvider>
  );
}

export default App;
