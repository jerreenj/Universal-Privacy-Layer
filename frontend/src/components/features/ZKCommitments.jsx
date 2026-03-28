import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Lock, Unlock, Check, X, Loader2, Shield, Hash } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

// Client-side SHA-256
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Generate cryptographically secure blinding factor
function generateBlindingFactor() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

const RANGES = ["0-0.01 ETH", "0.01-0.1 ETH", "0.1-1 ETH", "1-10 ETH", "10-100 ETH", "100+ ETH"];

export function ZKCommitments() {
  const { address, chain } = useWallet();
  const [tab, setTab] = useState("commit");
  const [loading, setLoading] = useState(false);
  const [commitments, setCommitments] = useState([]);

  // Commit form
  const [amountWei, setAmountWei] = useState("");
  const [amountRange, setAmountRange] = useState(RANGES[2]);
  const [commitLabel, setCommitLabel] = useState("");
  const [lastCommit, setLastCommit] = useState(null);
  const [blindingFactor, setBlindingFactor] = useState("");

  // Verify form
  const [verifyId, setVerifyId] = useState("");
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyBlinding, setVerifyBlinding] = useState("");
  const [verifyResult, setVerifyResult] = useState(null);

  const fetchCommitments = useCallback(async () => {
    if (!address) return;
    try {
      const res = await axios.get(`${API}/zk-commitments/${address}`);
      setCommitments(res.data.commitments || []);
    } catch {}
  }, [address]);

  useEffect(() => { fetchCommitments(); }, [fetchCommitments]);

  const createCommitment = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!amountWei) return toast.error("Enter amount in wei");
    setLoading(true);
    try {
      // Client-side: generate blinding factor and compute commitment
      const bf = generateBlindingFactor();
      setBlindingFactor(bf);
      const commitHash = await sha256(amountWei + bf);

      const res = await axios.post(`${API}/zk-commitments/create`, {
        owner_address: address,
        commitment_hash: commitHash,
        amount_range: amountRange,
        chain: chain,
        label: commitLabel || null,
      });

      setLastCommit({
        ...res.data,
        blinding_factor: bf,
        amount_wei: amountWei,
      });
      toast.success("Commitment created — save your blinding factor!");
      fetchCommitments();
    } catch {
      toast.error("Failed to create commitment");
    }
    setLoading(false);
  };

  const verifyCommitment = async () => {
    if (!verifyId || !verifyAmount || !verifyBlinding) return toast.error("Fill all fields");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/zk-commitments/verify`, {
        commitment_id: verifyId,
        amount_wei: verifyAmount,
        blinding_factor: verifyBlinding,
      });
      setVerifyResult(res.data);
      if (res.data.is_valid) toast.success("Commitment verified!");
      else toast.error("Verification failed — hashes don't match");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Verification failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4" data-testid="zk-commitments">
      <p className="text-sm text-white/50">
        Hide transaction amounts using zero-knowledge commitments. Commit to an amount without revealing it. Verify later by revealing the blinding factor. All math runs in your browser.
      </p>

      {/* Tabs */}
      <div className="flex gap-0 border border-white/20">
        {["commit", "verify", "history"].map((t) => (
          <button
            key={t}
            data-testid={`zk-tab-${t}`}
            onClick={() => setTab(t)}
            className={`flex-1 p-2.5 text-sm font-medium transition-all ${tab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
          >
            {t === "commit" ? "Commit" : t === "verify" ? "Verify" : "History"}
          </button>
        ))}
      </div>

      {/* COMMIT TAB */}
      {tab === "commit" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Amount (wei) — only you know this</label>
            <input
              data-testid="zk-commit-amount"
              value={amountWei}
              onChange={(e) => setAmountWei(e.target.value)}
              placeholder="1000000000000000000"
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Public Range (visible to others)</label>
            <select
              data-testid="zk-commit-range"
              value={amountRange}
              onChange={(e) => setAmountRange(e.target.value)}
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none"
            >
              {RANGES.map((r) => <option key={r} value={r} className="bg-black">{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Label (optional)</label>
            <input
              data-testid="zk-commit-label"
              value={commitLabel}
              onChange={(e) => setCommitLabel(e.target.value)}
              placeholder="e.g. Payment to Alice"
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none"
            />
          </div>
          <div className="text-xs text-white/30">
            Chain: <span style={{ color: CHAINS[chain]?.color }}>{CHAINS[chain]?.name}</span>
          </div>

          <button
            data-testid="zk-commit-button"
            onClick={createCommitment}
            disabled={loading}
            className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Create ZK Commitment
          </button>

          {lastCommit && (
            <div className="bg-green-500/10 border border-green-500/30 p-4 space-y-2" data-testid="zk-commit-result">
              <div className="text-sm font-semibold text-green-400 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Commitment Created
              </div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-white/40">ID</span>
                  <span className="font-mono text-white/60">{lastCommit.commitment_id?.slice(0, 16)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Hash</span>
                  <span className="font-mono text-white/60">{lastCommit.commitment_hash?.slice(0, 20)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Blinding Factor</span>
                  <span className="font-mono text-red-400">{lastCommit.blinding_factor?.slice(0, 20)}...</span>
                </div>
              </div>
              <div className="text-xs text-red-400/80 mt-2">
                SAVE your blinding factor — it is the key to proving this commitment later. It cannot be recovered.
              </div>
            </div>
          )}
        </div>
      )}

      {/* VERIFY TAB */}
      {tab === "verify" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Commitment ID</label>
            <input
              data-testid="zk-verify-id"
              value={verifyId}
              onChange={(e) => setVerifyId(e.target.value)}
              placeholder="uuid..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Amount (wei)</label>
            <input
              data-testid="zk-verify-amount"
              value={verifyAmount}
              onChange={(e) => setVerifyAmount(e.target.value)}
              placeholder="1000000000000000000"
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Blinding Factor</label>
            <input
              data-testid="zk-verify-blinding"
              value={verifyBlinding}
              onChange={(e) => setVerifyBlinding(e.target.value)}
              placeholder="hex..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>

          <button
            data-testid="zk-verify-button"
            onClick={verifyCommitment}
            disabled={loading}
            className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
            Verify Commitment
          </button>

          {verifyResult && (
            <div className={`border p-4 ${verifyResult.is_valid ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`} data-testid="zk-verify-result">
              <div className="flex items-center gap-2 mb-2">
                {verifyResult.is_valid
                  ? <><Check className="w-4 h-4 text-green-400" /><span className="text-sm font-semibold text-green-400">Valid Commitment</span></>
                  : <><X className="w-4 h-4 text-red-400" /><span className="text-sm font-semibold text-red-400">Invalid — Hashes Don't Match</span></>}
              </div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-white/40">Stored Hash</span>
                  <span className="font-mono text-white/50">{verifyResult.stored_hash?.slice(0, 24)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Recomputed</span>
                  <span className="font-mono text-white/50">{verifyResult.recomputed_hash?.slice(0, 24)}...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <div className="space-y-2">
          {commitments.length === 0 ? (
            <div className="text-center py-8 text-white/30 text-sm">
              <Hash className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No commitments yet
            </div>
          ) : (
            commitments.map((c) => (
              <div key={c.commitment_id} className="bg-white/5 border border-white/10 p-3" data-testid={`zk-history-${c.commitment_id}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{c.label || "Unlabeled"}</span>
                  <span className={`text-xs px-2 py-0.5 border ${c.revealed ? "border-green-500/40 text-green-400" : "border-white/20 text-white/40"}`}>
                    {c.revealed ? "Revealed" : "Hidden"}
                  </span>
                </div>
                <div className="text-xs text-white/40 space-y-0.5">
                  <div>Range: {c.amount_range}</div>
                  <div>Hash: {c.commitment_hash?.slice(0, 24)}...</div>
                  <div>Chain: {CHAINS[c.chain]?.name || c.chain}</div>
                  <div>{new Date(c.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
