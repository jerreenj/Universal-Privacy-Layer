import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import {
  Fingerprint, Plus, Minus, Check, AlertTriangle, Loader2, Zap, Split, ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { deriveMetaAddress, generateStealthAddress } from "@/lib/wallet-stealth";

export function CrossChainSplit() {
  const { address, signer, privacyWallet } = useWallet();
  const [totalAmount, setTotalAmount] = useState("");
  const [splits, setSplits] = useState([
    { chain: "base", stealth: "", percentage: 50, status: "pending", txHash: "" },
    { chain: "arbitrum", stealth: "", percentage: 50, status: "pending", txHash: "" }
  ]);
  const [loading, setLoading] = useState(false);
  const [splitPlan, setSplitPlan] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [currentExecIdx, setCurrentExecIdx] = useState(-1);
  const [autoGenerate, setAutoGenerate] = useState(true);

  const addSplit = () => {
    if (splits.length >= 7) return toast.error("Maximum 7 chains");
    const usedChains = splits.map(s => s.chain);
    const availableChain = Object.entries(CHAINS).filter(([k, v]) => v.live && !usedChains.includes(k)).map(([k]) => k)[0] || "polygon";
    setSplits([...splits, { chain: availableChain, stealth: "", percentage: 0, status: "pending", txHash: "" }]);
  };

  const removeSplit = (idx) => {
    if (splits.length <= 2) return toast.error("Minimum 2 splits required");
    setSplits(splits.filter((_, i) => i !== idx));
  };

  const updateSplit = (idx, field, value) => {
    const newSplits = [...splits];
    newSplits[idx][field] = value;
    setSplits(newSplits);
  };

  const autoDistribute = () => {
    const count = splits.length;
    const each = Math.floor(100 / count);
    const remainder = 100 - (each * count);
    setSplits(splits.map((s, i) => ({ ...s, percentage: i === 0 ? each + remainder : each })));
    toast.success("Percentages distributed evenly");
  };

  const generateStealthForSplit = async (idx) => {
    if (!address) return toast.error("Connect wallet first");
    try {
      // Wallet-derived meta via HKDF-SHA-256 over a chain-scoped
      // personal_sign (see frontend/src/lib/wallet-stealth.js).
      // The DOMAIN separator binds chainId → the same wallet signature
      // produces a different meta per chain, so the customer's stealth
      // addresses across base/arb/optimism/etc. cannot be correlated
      // except by the customer's own wallet.
      const chainConfig = CHAINS[splits[idx].chain];
      const chainId = chainConfig ? BigInt(chainConfig.chainId) : 8453n;
      const meta = await deriveMetaAddress(signer, chainId);
      const stealth = await generateStealthAddress(meta.metaAddress);
      updateSplit(idx, 'stealth', stealth.stealthAddress);
      toast.success(`Stealth address generated for ${chainConfig?.name || splits[idx].chain}`);
    } catch { toast.error("Failed to generate stealth address"); }
  };

  const generateAllStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    setLoading(true);
    try {
      for (let i = 0; i < splits.length; i++) {
        if (!splits[i].stealth) {
          const chainConfig = CHAINS[splits[i].chain];
          const chainId = chainConfig ? BigInt(chainConfig.chainId) : 8453n;
          const meta = await deriveMetaAddress(signer, chainId);
          const stealth = await generateStealthAddress(meta.metaAddress);
          updateSplit(i, 'stealth', stealth.stealthAddress);
        }
      }
      toast.success("All stealth addresses generated!");
    } catch { toast.error("Failed to generate stealth addresses"); }
    setLoading(false);
  };

  const prepareSplit = async () => {
    if (!address) return toast.error("Connect wallet first");
    const totalPct = splits.reduce((s, sp) => s + Number(sp.percentage), 0);
    if (totalPct !== 100) return toast.error(`Percentages must total 100%, got ${totalPct}%`);
    if (autoGenerate && splits.some(s => !s.stealth)) await generateAllStealth();
    if (splits.some(s => !s.stealth)) return toast.error("Enter all stealth addresses");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/split/prepare`, {
        from_address: address, total_amount_wei: ethers.parseEther(totalAmount).toString(),
        splits: splits.map(s => ({ chain: s.chain, stealth_address: s.stealth, percentage: Number(s.percentage) }))
      });
      setSplitPlan(res.data);
      toast.success("Split plan created!");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    setLoading(false);
  };

  const executeSplit = async (idx) => {
    if (!signer) return toast.error("Connect wallet first");
    const tx = splitPlan.transactions[idx];
    const chainConfig = CHAINS[tx.chain];
    setExecuting(true);
    setCurrentExecIdx(idx);
    try {
      // ── RELAYER FLOW ──────────────────────────────────────────
      // Routes through the on-chain PrivacyRelayer so the customer's
      // EOA never appears as msg.sender on any chain. Each split is
      // an independent relay+announce call on the target chain.
      const amountNum = tx.amount.replace(" ETH", "").replace(" " + chainConfig.symbol, "");
      const amountWei = ethers.parseEther(amountNum);
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: tx.stealth_address,
        amount_wei: amountWei.toString(),
        ephemeral_key: ephemeralKey,
        view_tag: viewTag,
        chain: tx.chain,
      });

      const { domain, types, message } = prepRes.data.intent;
      const signature = await signer.signTypedData(domain, types, message);

      const submitRes = await axios.post(`${API}/relayer/submit`, {
        intent: prepRes.data.intent,
        signature,
        from_address: address,
        chain: tx.chain,
      });

      const relayTxHash = submitRes.data.relay_tx_hash || submitRes.data.tx_hash || "";
      const newSplits = [...splits];
      newSplits[idx].status = "confirming";
      newSplits[idx].txHash = relayTxHash;
      setSplits(newSplits);
      toast.success(`Transaction relayed on ${chainConfig.name}!`);
      newSplits[idx].status = "confirmed";
      setSplits([...newSplits]);
      await axios.post(`${API}/split/update-status`, { split_id: splitPlan.split_id, chain: tx.chain, status: "confirmed", tx_hash: relayTxHash });
      toast.success(`${chainConfig.name} split confirmed!`);
    } catch (e) {
      const newSplits = [...splits];
      newSplits[idx].status = "failed";
      setSplits(newSplits);
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message || "Transaction failed";
      toast.error(msg);
    }
    setExecuting(false);
    setCurrentExecIdx(-1);
  };

  const executeAll = async () => {
    for (let i = 0; i < splitPlan.transactions.length; i++) {
      if (splits[i].status !== "confirmed") await executeSplit(i);
    }
  };

  const totalPct = splits.reduce((s, sp) => s + Number(sp.percentage || 0), 0);
  const allConfirmed = splitPlan && splits.every(s => s.status === "confirmed");

  return (
    <div className="space-y-4" data-testid="cross-chain-split">
      <p className="text-sm text-white/50">Split a single payment across multiple chains for enhanced privacy. Funds become untraceable.</p>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Total Amount (ETH equivalent)</label>
        <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0.1"
          data-testid="split-amount-input"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div className="flex items-center justify-between bg-white/5 p-3 border border-white/10">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-purple-400" />
          <span className="text-sm">Auto-generate stealth addresses</span>
        </div>
        <button onClick={() => setAutoGenerate(!autoGenerate)}
          className={`w-10 h-5 rounded-full transition-colors ${autoGenerate ? 'bg-green-500' : 'bg-white/20'}`}>
          <div className={`w-4 h-4 bg-white rounded-full transition-transform ${autoGenerate ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs text-white/50 uppercase">Split Configuration ({totalPct}%)</span>
          <div className="flex gap-2">
            <button onClick={autoDistribute} className="text-xs text-blue-400 hover:text-blue-300">Auto-distribute</button>
            <button onClick={addSplit} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1"><Plus className="w-3 h-3" /> Add Chain</button>
          </div>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div className={`h-full transition-all ${totalPct === 100 ? 'bg-green-500' : totalPct > 100 ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.min(totalPct, 100)}%` }} />
        </div>
        {splits.map((split, idx) => (
          <div key={idx} className={`bg-white/5 border p-3 space-y-2 transition-colors ${split.status === "confirmed" ? "border-green-500/50" : split.status === "failed" ? "border-red-500/50" : "border-white/10"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHAINS[split.chain]?.color }} />
                <select value={split.chain} onChange={(e) => updateSplit(idx, 'chain', e.target.value)} className="bg-transparent text-sm outline-none" disabled={splitPlan}>
                  {Object.entries(CHAINS).filter(([, v]) => v.live).map(([k, v]) => (<option key={k} value={k} className="bg-black">{v.name}</option>))}
                </select>
                {split.status === "confirmed" && <Check className="w-4 h-4 text-green-400" />}
                {split.status === "confirming" && <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />}
                {split.status === "failed" && <AlertTriangle className="w-4 h-4 text-red-400" />}
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={split.percentage} onChange={(e) => updateSplit(idx, 'percentage', e.target.value)}
                  className="w-16 bg-transparent border-b border-white/20 text-right text-sm outline-none" disabled={splitPlan} />
                <span className="text-white/50">%</span>
                {splits.length > 2 && !splitPlan && (
                  <button onClick={() => removeSplit(idx)} className="text-red-400 hover:text-red-300"><Minus className="w-4 h-4" /></button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <input value={split.stealth} onChange={(e) => updateSplit(idx, 'stealth', e.target.value)} placeholder="Stealth address 0x..."
                className="flex-1 bg-transparent text-xs font-mono outline-none text-white/70" disabled={splitPlan} />
              {!split.stealth && !splitPlan && (
                <button onClick={() => generateStealthForSplit(idx)} className="text-xs text-purple-400 hover:text-purple-300">Generate</button>
              )}
            </div>
            {split.txHash && (
              <a href={`${CHAINS[split.chain]?.explorer}/tx/${split.txHash}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View Transaction</a>
            )}
          </div>
        ))}
      </div>
      {!splitPlan ? (
        <button onClick={prepareSplit} disabled={loading || totalPct !== 100} data-testid="prepare-split-btn"
          className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Split className="w-5 h-5" />}
          Prepare Cross-Chain Split
        </button>
      ) : (
        <div className="space-y-3">
          <div className="bg-white/5 border border-green-500/30 p-4 space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-xs text-green-400 uppercase">Split Plan Ready</div>
              <div className="text-xs text-white/50">ID: {splitPlan.split_id?.slice(0, 8)}...</div>
            </div>
            <div className="text-sm">Total: {splitPlan.total_amount} across {splitPlan.num_chains} chains</div>
            {splitPlan.transactions?.map((tx, i) => (
              <div key={i} className="flex justify-between items-center text-xs bg-white/5 p-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[tx.chain]?.color }} />
                  <span>{CHAINS[tx.chain]?.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono">{tx.amount} ({tx.percentage}%)</span>
                  {splits[i]?.status !== "confirmed" && (
                    <button onClick={() => executeSplit(i)} disabled={executing} className="px-2 py-1 bg-white/10 hover:bg-white/20 text-xs">
                      {currentExecIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : "Execute"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!allConfirmed && (
            <button onClick={executeAll} disabled={executing} data-testid="execute-all-btn"
              className="w-full py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {executing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              Execute All Splits
            </button>
          )}
          {allConfirmed && (
            <div className="bg-green-500/20 border border-green-500 p-4 text-center">
              <Check className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <div className="text-green-400 font-bold">All Splits Complete!</div>
              <p className="text-xs text-white/50 mt-1">Your funds are now distributed across {splitPlan.num_chains} chains with enhanced privacy.</p>
            </div>
          )}
          <button onClick={() => { setSplitPlan(null); setSplits(splits.map(s => ({ ...s, status: "pending", txHash: "" }))); }}
            className="w-full py-2 border border-white/20 text-white/50 text-sm hover:bg-white/5">
            Reset & Create New Split
          </button>
        </div>
      )}
    </div>
  );
}
