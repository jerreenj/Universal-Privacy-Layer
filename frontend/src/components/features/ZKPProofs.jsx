import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Fingerprint, Check, AlertTriangle, Loader2, Shield, FileUp } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import {
  computeCommitment,
  computeNullifierHash,
  fetchPoolState,
  generateWithdrawProof,
} from "@/lib/zk-browser";

// Match backend ABI kept in lock-step
const PRIVACY_POOL_WITHDRAW_ABI = [
  "function withdraw(uint256 nullifierHash, uint256 root, address recipient, uint256[2] proof_a, uint256[2][2] proof_b, uint256[2] proof_c) external",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
];

function parseNote(text) {
  if (!text) return null;
  try {
    // Accept either a JSON object directly or a paste of the JSON.
    const obj = JSON.parse(text);
    if (!obj.nullifier || !obj.secret) throw new Error("Note missing nullifier or secret");
    return obj;
  } catch (e) {
    throw new Error("Invalid note JSON: " + (e?.message ?? ""));
  }
}

function truncate(s, n = 18) {
  if (!s) return "";
  return s.slice(0, n) + "…";
}

export function ZKPProofs() {
  const { address } = useWallet();
  const [noteText, setNoteText] = useState("");
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(null);
  const [pool, setPool] = useState(null);
  const [recipient, setRecipient] = useState("");
  const [path, setPath] = useState(null);
  const [proof, setProof] = useState(null);
  const [txResult, setTxResult] = useState(null);

  const refreshPool = useCallback(async () => {
    try { setPool(await fetchPoolState()); } catch {}
  }, []);

  useEffect(() => { refreshPool(); }, [refreshPool]);

  const loadNote = async () => {
    if (!noteText.trim()) return toast.error("Paste a deposit note first");
    try {
      setNote(parseNote(noteText));
      toast.success("Note loaded");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const loadNoteFromFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setNoteText(String(reader.result || ""));
    reader.readAsText(file);
  };

  // Step 1 — verify the commitment, compute nullifier hash, fetch Merkle path.
  const prepareWithdraw = async () => {
    if (!note) return toast.error("Load a note first");
    if (!recipient || !ethers.isAddress(recipient))
      return toast.error("Enter a valid recipient address");
    if (!pool?.live) return toast.error("PrivacyPool not live on Base yet");

    setLoading(true);
    setStage("Recomputing commitment…");
    try {
      const commitment = await computeCommitment(note.nullifier, note.secret);
      const nullifierHash = await computeNullifierHash(note.nullifier);

      setStage("Fetching Merkle path from backend…");
      const res = await axios.post(`${API}/zk-pool/path`, {
        commitment: "0x" + BigInt(commitment).toString(16).padStart(64, "0"),
        nullifier_hash: "0x" + BigInt(nullifierHash).toString(16).padStart(64, "0"),
      });
      setPath(res.data);

      setStage("Generating Groth16 proof in browser (~5–20 s)…");
      const proof = await generateWithdrawProof({
        nullifier: note.nullifier,
        secret: note.secret,
        root: res.data.root,
        recipient: recipient,
        merklePathElements: res.data.merklePathElements,
        merklePathIndices: res.data.merklePathIndices,
      });
      setProof(proof);
      toast.success("Proof ready — submit when ready");
      setStage(null);
    } catch (e) {
      console.error(e);
      toast.error(e?.shortMessage ?? e?.message ?? "Withdraw prep failed");
      setStage(null);
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — sign and broadcast PrivacyPool.withdraw on Base.
  const submitWithdraw = async () => {
    if (!proof) return toast.error("Generate the proof first");
    if (!pool?.live) return toast.error("PrivacyPool not live on Base yet");
    const poolAddr = CHAINS.base?.contracts?.privacyPool;
    if (!poolAddr) return toast.error("PrivacyPool address missing — refresh /api/deployments");

    setLoading(true);
    setStage("Broadcasting PrivacyPool.withdraw(proof)…");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const poolContract = new ethers.Contract(poolAddr, PRIVACY_POOL_WITHDRAW_ABI, signer);

      const toBytes = (s) => BigInt(String(s).startsWith("0x") ? String(s) : String(s));
      const a = proof.proof.a.map(toBytes);
      const b = proof.proof.b.map((row) => row.map(toBytes));
      const c = proof.proof.c.map(toBytes);

      // Root + nullifierHash from the public signals (snarkjs order:
      // [nullifierHash, root, recipient]).
      const nullifierHash = BigInt(proof.publicSignals[0]);
      const root = BigInt(proof.publicSignals[1]);

      const tx = await poolContract.withdraw(
        nullifierHash,
        root,
        recipient,
        a,
        b,
        c,
        { gasLimit: 600_000 }
      );
      setStage("Waiting for confirmation…");
      const receipt = await tx.wait();
      const explorer = CHAINS.base?.explorer ?? "https://basescan.org";
      setTxResult({
        hash: receipt?.hash ?? tx.hash,
        url: `${explorer}/tx/${receipt?.hash ?? tx.hash}`,
        recipient,
        amount: pool?.denomination
          ? Number(BigInt(pool.denomination)) / 1e18
          : null,
      });
      toast.success("Withdrawal succeeded");
      setStage(null);
    } catch (e) {
      console.error(e);
      toast.error(e?.shortMessage ?? e?.message ?? "Withdraw failed");
    } finally {
      setLoading(false);
      setStage(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="zk-proofs">
      <div className="text-sm text-white/50">
        Generate a zero-knowledge proof from a saved deposit note and withdraw
        privately. The deposit is unlinkable from this withdrawal.
      </div>

      <div className={`border p-3 text-xs ${pool?.live ? "border-green-500/30 bg-green-500/5 text-green-300" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-300"}`}>
        {pool?.live ? (
          <>
            <Shield className="w-3 h-3 inline mr-1" />
            Pool live on Base · notes served · prover ready
          </>
        ) : (
          <>PrivacyPool not live on Base yet — {pool?.message ?? pool?.error ?? "deploy pending"}</>
        )}
      </div>

      <div>
        <label className="block text-xs text-white/50 uppercase mb-1">Deposit Note (JSON paste)</label>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
          placeholder='{"nullifier":"…","secret":"…","commitment":"…","pool":"0x…"}'
          rows={4}
          className="w-full bg-white/5 border border-white/20 p-3 text-xs font-mono outline-none focus:border-white" />
        <div className="flex gap-2 mt-2">
          <button onClick={loadNote} className="flex-1 py-2 bg-white/5 border border-white/20 text-xs uppercase tracking-wider hover:bg-white/10">
            Load Note
          </button>
          <label className="flex-1 py-2 bg-white/5 border border-white/20 text-xs uppercase tracking-wider hover:bg-white/10 flex items-center justify-center gap-2 cursor-pointer">
            <FileUp className="w-4 h-4" /> From File
            <input type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => loadNoteFromFile(e.target.files?.[0])} />
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs text-white/50 uppercase mb-1">Recipient (stealth / fresh)</label>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none focus:border-white" />
      </div>

      <div className="flex gap-2">
        <button onClick={prepareWithdraw} disabled={loading || !note}
          data-testid="zk-prepare-btn"
          className="flex-1 py-3 bg-white/10 border border-white/20 font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
          {stage ?? "Generate Proof"}
        </button>
        <button onClick={submitWithdraw} disabled={!proof}
          data-testid="zk-submit-btn"
          className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-white/90 disabled:opacity-50">
          Withdraw
        </button>
      </div>

      {path && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="text-white/40 uppercase">Merkle path (depth 20)</div>
          <div>root: <span className="font-mono">{truncate(path.root, 20)}</span></div>
          <div>leaf index: {path.leafIndex}</div>
          <div>path elements: present</div>
        </div>
      )}

      {proof && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="text-green-400 uppercase">✓ Proof generated</div>
          {proof.publicSignals.map((s, i) => (
            <div key={i}>public[{i}]: <span className="font-mono">{truncate(s, 24)}</span></div>
          ))}
        </div>
      )}

      {txResult && (
        <div className="border border-green-500/30 bg-green-500/10 p-3 text-xs space-y-1" data-testid="zk-tx-result">
          <div className="flex items-center gap-2 text-green-400">
            <Check className="w-4 h-4" />
            <span>Withdrawal confirmed</span>
          </div>
          <div>recipient: <span className="font-mono">{txResult.recipient}</span></div>
          <div>amount: {txResult.amount ?? "?"} ETH</div>
          <a href={txResult.url} target="_blank" rel="noopener noreferrer"
            className="text-blue-300 underline break-all">View on Basescan ↗</a>
        </div>
      )}
    </div>
  );
}
