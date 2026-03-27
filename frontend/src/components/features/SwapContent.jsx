import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { RefreshCw, ArrowDown, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS, TOKENS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function SwapContent() {
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
        tx_hash: tx.hash, from_address: address, token_in: tokenIn, token_out: CHAINS[chain].symbol,
        amount_in: ethers.parseEther(amountIn).toString(), amount_out: ethers.parseEther(amountIn).toString(),
        chain, recipient_stealth: recipient
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
