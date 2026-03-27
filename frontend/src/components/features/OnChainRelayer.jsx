import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Lock, Zap, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function OnChainRelayer() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [txData, setTxData] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [relayerStats, setRelayerStats] = useState(null);

  useEffect(() => {
    axios.get(`${API}/relayer/stats/${chain}`).then(r => setRelayerStats(r.data)).catch(() => {});
  }, [chain]);

  const prepareRelayTx = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount) return toast.error("Enter recipient and amount");
    setLoading(true);
    try {
      const ephemeralKey = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      const viewTag = Math.floor(Math.random() * 256);
      const res = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address, stealth_address: to, amount_wei: ethers.parseEther(amount).toString(),
        ephemeral_key: ephemeralKey, view_tag: viewTag, chain
      });
      setTxData(res.data);
      toast.success("Transaction prepared!");
    } catch { toast.error("Failed to prepare transaction"); }
    setLoading(false);
  };

  const executeRelayTx = async () => {
    if (!txData || !signer) return;
    setLoading(true);
    try {
      const tx = await signer.sendTransaction({ to: txData.to, value: txData.value, data: txData.data, gasLimit: txData.gas });
      setTxHash(tx.hash);
      toast.success("Transaction sent through relayer!");
      await tx.wait();
      toast.success("Confirmed on-chain!");
      fetchBalance();
    } catch (e) { toast.error(e.message?.slice(0, 60) || "Failed"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Route transactions through the on-chain PrivacyRelayer contract for enhanced privacy with 0.05% fee.</p>
      {relayerStats && (
        <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-white/50">Total Relayed on {CHAINS[chain]?.name}</span>
          <span className="font-mono text-sm">{parseFloat(relayerStats.total_relayed || 0).toFixed(4)} {CHAINS[chain]?.symbol}</span>
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      {!txData ? (
        <button onClick={prepareRelayTx} disabled={loading}
          className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
          Prepare Relayer Transaction
        </button>
      ) : (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-white/50">Relayer:</span><span className="font-mono">{txData.relayer_contract?.slice(0, 12)}...</span></div>
            <div className="flex justify-between"><span className="text-white/50">Fee:</span><span className="text-yellow-400">{txData.fee_bps / 100}% ({ethers.formatEther(txData.fee_amount || '0').slice(0, 8)})</span></div>
            <div className="flex justify-between"><span className="text-white/50">Net Amount:</span><span className="text-green-400">{ethers.formatEther(txData.net_amount || '0').slice(0, 10)}</span></div>
          </div>
          <button onClick={executeRelayTx} disabled={loading}
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
            Execute Through Relayer
          </button>
        </div>
      )}
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
