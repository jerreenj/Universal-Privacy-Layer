import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { RefreshCw, ArrowDown, Loader2, ExternalLink, Shield, Check } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS, TOKENS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

/**
 * Private Swap — privacy-routed token swap.
 *
 * Flow: user picks token-in + amount + a stealth recipient → we fetch a real
 * quote from the backend (/swap/quote returns amount_after_fee, fee, router)
 * → user confirms → we send the on-chain tx (native ETH to stealth address)
 * → record the swap to /swap/record so it shows up in Transaction History.
 *
 * The "private" layer is the stealth recipient: an observer sees a payment
 * to a fresh address with no on-chain link to the recipient's main wallet.
 */
export function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [tokenIn, setTokenIn] = useState(TOKENS[chain]?.[0]?.symbol || "ETH");
  const [amountIn, setAmountIn] = useState("");
  const [recipient, setRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const tokens = TOKENS[chain] || [];

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      const r = await axios.post(`${API}/stealth/generate`, { public_address: address, chain });
      setRecipient(r.data.stealth_address);
      toast.success("Stealth address generated");
    } catch { toast.error("Failed to generate stealth address"); }
  };

  const getQuote = async () => {
    if (!amountIn || parseFloat(amountIn) <= 0) return toast.error("Enter an amount");
    setQuoting(true);
    setQuote(null);
    try {
      const amountWei = ethers.parseEther(amountIn).toString();
      const r = await axios.post(`${API}/swap/quote`, {
        chain, token_in: tokenIn, token_out: CHAINS[chain].symbol, amount_in: amountWei,
      });
      setQuote(r.data);
      toast.success("Quote ready");
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 80) || "Quote failed");
    }
    setQuoting(false);
  };

  const swap = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient) return toast.error("Enter or generate a stealth address");
    if (!quote) return toast.error("Get a quote first");
    setSwapping(true);
    try {
      const provider = signer?.provider || (window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null);
      const activeSigner = signer || (provider ? await provider.getSigner() : null);
      if (!activeSigner) return toast.error("No wallet connected");

      const tx = await activeSigner.sendTransaction({ to: recipient, value: ethers.parseEther(amountIn) });
      setTxHash(tx.hash);
      await axios.post(`${API}/swap/record`, {
        tx_hash: tx.hash, from_address: address, token_in: tokenIn, token_out: CHAINS[chain].symbol,
        amount_in: quote.amount_in, amount_out: quote.estimated_output,
        chain, recipient_stealth: recipient
      });
      axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      toast.success("Private swap broadcast");
      await tx.wait();
      toast.success("Confirmed!");
      fetchBalance();
      setAmountIn(""); setQuote(null);
    } catch (e) { toast.error(e.message?.slice(0, 60) || "Failed"); }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="swap-content">
      <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 p-2">
        <Shield className="w-3 h-3" /> Privacy-routed: wallet → stealth recipient. No on-chain link to recipient.
      </div>

      <div className="bg-white/5 border border-white/20 p-4">
        <div className="flex justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase">You Pay</span>
          <select value={tokenIn} onChange={(e) => { setTokenIn(e.target.value); setQuote(null); }}
            className="bg-transparent text-sm font-semibold outline-none">
            {tokens.map(t => <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>)}
          </select>
        </div>
        <input data-testid="swap-amount-input" type="number" value={amountIn}
          onChange={(e) => { setAmountIn(e.target.value); setQuote(null); }} placeholder="0.0"
          className="w-full bg-transparent text-2xl font-mono outline-none" />
      </div>

      <div className="flex justify-center">
        <div className="w-10 h-10 bg-white/10 border border-white/20 flex items-center justify-center">
          <ArrowDown className="w-5 h-5" />
        </div>
      </div>

      <div className="bg-white/5 border border-white/20 p-4">
        <span className="text-xs text-gray-500 uppercase">Stealth Recipient Gets</span>
        <div className="text-2xl font-mono text-white/70">
          {quote ? `~${ethers.formatEther(quote.estimated_output).slice(0, 8)}` : amountIn || "0.0"} {CHAINS[chain]?.symbol}
        </div>
      </div>

      {quote && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-white/40">Input</span><span className="font-mono">{ethers.formatEther(quote.amount_in).slice(0,10)} {tokenIn}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Privacy fee (0.05%)</span><span className="font-mono text-green-400">{ethers.formatEther(quote.fee).slice(0,10)}</span></div>
          <div className="flex justify-between"><span className="text-white/40">Output</span><span className="font-mono">{ethers.formatEther(quote.estimated_output).slice(0,10)} {CHAINS[chain]?.symbol}</span></div>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <div className="flex gap-2">
          <input data-testid="swap-recipient-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..."
            className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
          <button onClick={autoGenStealth} className="px-3 border border-white/20 hover:bg-white/10 text-xs">Auto</button>
        </div>
      </div>

      <div className="flex gap-2">
        {!quote ? (
          <button data-testid="swap-quote-btn" onClick={getQuote} disabled={quoting || !amountIn}
            className="flex-1 py-3 border border-white/30 hover:bg-white/10 font-bold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {quoting ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />} Get Quote
          </button>
        ) : (
          <button data-testid="swap-btn" onClick={swap} disabled={swapping || !address || !recipient}
            className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Swap Privately
          </button>
        )}
      </div>

      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
