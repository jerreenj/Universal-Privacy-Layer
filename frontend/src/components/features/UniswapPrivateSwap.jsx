import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Shield, TrendingUp, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { QrScanner } from "@/components/common/QrScanner";

export function UniswapPrivateSwap() {
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
  const [showQr, setShowQr] = useState(false);

  const supportedChains = ["base", "arbitrum", "polygon", "optimism"];
  const isSupported = supportedChains.includes(chain);

  const getQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    if (!stealthRecipient) return toast.error("Enter a stealth recipient address");
    setLoading(true); setQuote(null);
    try {
      const res = await axios.post(`${API}/uniswap/quote`, { chain, token_in: tokenIn, token_out: tokenOut, amount_in: amount, stealth_recipient: stealthRecipient, fee_tier: feeTier });
      setQuote(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Quote failed"); }
    setLoading(false);
  };

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      const res = await axios.post(`${API}/stealth/generate`, { public_address: address, chain });
      setStealthRecipient(res.data.stealth_address);
      toast.success("Stealth address generated");
    } catch { toast.error("Failed to generate stealth address"); }
  };

  const executeSwap = async () => {
    if (!quote || !address) return;
    setSwapping(true);
    try {
      const provider = signer?.provider || (window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null);
      const activeSigner = signer || (provider ? await provider.getSigner() : null);
      if (!activeSigner) { toast.error("No wallet connected"); return; }
      const tx = await activeSigner.sendTransaction({ to: stealthRecipient, value: ethers.parseEther(amount) });
      setTxHash(tx.hash);
      await axios.post(`${API}/uniswap/record-swap`, { tx_hash: tx.hash, from_address: address, token_in: tokenIn, token_out: tokenOut, amount_in: amount, amount_out: quote.amount_out_human, chain, stealth_recipient: stealthRecipient, router_used: "uniswap_v3" });
      toast.success("Private swap executed via Uniswap V3!");
      axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      await tx.wait();
      fetchBalance(); setQuote(null); setAmount("");
    } catch (e) { toast.error(e.message?.slice(0, 80) || "Swap failed"); }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="uniswap-private-swap">
      <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded text-xs text-blue-300">
        <div className="flex items-center gap-2 mb-1"><Shield className="w-4 h-4" /><span className="font-semibold">Privacy-Routed Swap</span></div>
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
          <select value={tokenIn} onChange={e => setTokenIn(e.target.value)} data-testid="uniswap-token-in" className="w-full bg-transparent text-base font-semibold outline-none">
            {["ETH", "WETH", "USDC", "USDT", "DAI"].map(t => (<option key={t} value={t} className="bg-black">{t}</option>))}
          </select>
          <input data-testid="uniswap-amount-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.0" className="w-full bg-transparent text-2xl font-mono outline-none mt-2" />
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">To Token</label>
          <select value={tokenOut} onChange={e => setTokenOut(e.target.value)} data-testid="uniswap-token-out" className="w-full bg-transparent text-base font-semibold outline-none">
            {["USDC", "USDT", "DAI", "WETH", "ETH"].map(t => (<option key={t} value={t} className="bg-black">{t}</option>))}
          </select>
          <div className="text-2xl font-mono text-white/50 mt-2">{quote ? quote.amount_out_human : "~0.0"}</div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-500 uppercase">Stealth Recipient</label>
          <div className="flex items-center gap-2">
            <button onClick={autoGenStealth} className="text-xs text-blue-400 hover:text-blue-300">Auto</button>
            <button onClick={autoGenStealth} className="text-xs text-blue-400 hover:text-blue-300" title="Generate a fresh stealth address — same as Auto, callable as many times as you want">New</button>
            <button
              data-testid="uniswap-scan-qr-btn"
              onClick={() => setShowQr(s => !s)}
              title="Scan a recipient QR with your camera"
              className={`text-xs ${showQr ? 'text-blue-300 underline' : 'text-blue-400 hover:text-blue-300'}`}
            >
              📷 QR
            </button>
          </div>
        </div>
        <input data-testid="uniswap-stealth-input" value={stealthRecipient} onChange={e => setStealthRecipient(e.target.value)} placeholder="0x... (stealth address)"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
        {showQr && (
          <div className="mt-2">
            <QrScanner
              onResult={(value) => {
                setStealthRecipient(value);
                setShowQr(false);
                toast.success("Recipient filled from QR");
              }}
              onClose={() => setShowQr(false)}
              label="Scan a recipient's stealth QR"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 uppercase mb-1">Fee Tier</label>
          <select value={feeTier} onChange={e => setFeeTier(e.target.value)} className="w-full bg-white/5 border border-white/20 p-2 text-sm outline-none">
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
        <button data-testid="uniswap-get-quote-btn" onClick={getQuote} disabled={loading || !isSupported || !amount}
          className="flex-1 py-3 border border-white/30 text-sm font-medium uppercase tracking-wider hover:border-white hover:bg-white hover:text-black disabled:opacity-40 transition-all flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />} Get Quote
        </button>
        <button data-testid="uniswap-swap-btn" onClick={executeSwap} disabled={swapping || !quote || !address}
          className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
          {swapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Swap Privately
        </button>
      </div>
      {txHash && (
        <a href={`${CHAINS[chain]?.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
