import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import * as ethersUtils from "@/lib/ethers-lazy";
import { Fingerprint, Check, AlertTriangle, Loader2, Shield, FileUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import {
  computeCommitment,
  computeNullifierHash,
  fetchPoolState,
  normalisePoolState,
  generateWithdrawProof,
} from "@/lib/zk-browser";

// Match the backend ABI kept in lock-step. P4.1 multi-denom: `withdraw`
// is unchanged on calldata but the on-chain payout amount is resolved
// via _findDenomByRoot(payload[1]) — so the proof is denomination-agnostic
// but the AMOUNT paid out is the denomination whose recent-roots buffer
// contains the supplied `root`. Customer must redeem against the SAME
// sub-pool their deposit lives in.
const PRIVACY_POOL_WITHDRAW_ABI = [
  "function withdraw(uint256 nullifierHash, uint256 root, address recipient, uint256[2] proof_a, uint256[2][2] proof_b, uint256[2] proof_c) external",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function getDenominationList() view returns (uint256[])",
  "function currentRootOf(uint256 denomination) view returns (bytes32)",
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

function formatEth(wei) {
  if (wei == null) return "?";
  try { return (Number(BigInt(wei)) / 1e18).toString(); } catch { return "?"; }
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
    try {
      const raw = await fetchPoolState();
      setPool(normalisePoolState(raw));
    } catch {}
  }, []);

  useEffect(() => { refreshPool(); }, [refreshPool]);

  // Resolved denomination for the loaded note (P4.1 multi-denom: each
  // note carries its own denomination_wei; we MUST use that exact value
  // when fetching the Merkle path so siblings come from the right tree).
  const noteDenomination = useMemo(() => {
    if (!note) return null;
    return note.denomination_wei ?? note.denomination ?? null;
  }, [note]);

  const noteDenominationEth = noteDenomination ? formatEth(noteDenomination) : "?";

  const loadNote = async () => {
    if (!noteText.trim()) return toast.error("Paste a deposit note first");
    try {
      const parsed = parseNote(noteText);
      setNote(parsed);
      toast.success(parsed.denomination_wei
        ? `Note loaded · ${formatEth(parsed.denomination_wei)} ETH denomination`
        : "Note loaded (legacy single-denom)");
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
    if (!noteDenomination) return toast.error("Note missing denomination_wei — re-export from the deposit note");

    setLoading(true);
    setStage("Recomputing commitment…");
    try {
      const commitment = await computeCommitment(note.nullifier, note.secret);
      const nullifierHash = await computeNullifierHash(note.nullifier);

      setStage("Fetching Merkle path from backend (scoped to " + noteDenominationEth + " ETH)…");
      // P4.1: we MUST pass denomination_wei so the path is rebuilt from
      // siblings in the same sub-pool that the deposit lives in.
      // Cross-tree paths would compute wrong path indices and the
      // on-chain proof would revert.
      const res = await axios.post(`${API}/zk-pool/path`, {
        commitment: "0x" + BigInt(commitment).toString(16).padStart(64, "0"),
        nullifier_hash: "0x" + BigInt(nullifierHash).toString(16).padStart(64, "0"),
        denomination_wei: Number(noteDenomination),
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

  // Step 2 — relay the withdraw through the backend so the customer's
  // EOA never appears as msg.sender. The backend's /zk-pool/withdraw-relay
  // endpoint generates the proof server-side (if prover enabled) OR
  // accepts the browser-generated proof, then calls PrivacyPool.withdraw
  // via the relayer hot wallet. The recipient is a fresh address (not
  // the customer's EOA), so deposit↔withdraw unlinkability is preserved.
  const submitWithdraw = async () => {
    if (!proof) return toast.error("Generate the proof first");
    if (!pool?.live) return toast.error("PrivacyPool not live on Base yet");
    const poolAddr = CHAINS.base?.contracts?.privacyPool;
    if (!poolAddr) return toast.error("PrivacyPool address missing — refresh /api/deployments");

    setLoading(true);
    setStage("Relaying withdraw via backend (customer EOA hidden)…");
    try {
      const toBytes = (s) => BigInt(String(s).startsWith("0x") ? String(s) : String(s));
      const a = proof.proof.a.map(toBytes);
      const b = proof.proof.b.map((row) => row.map(toBytes));
      const c = proof.proof.c.map(toBytes);

      const nullifierHash = BigInt(proof.publicSignals[0]);
      const root = BigInt(proof.publicSignals[1]);

      // Submit the proof + recipient to the backend's relayer endpoint.
      // The backend broadcasts PrivacyPool.withdraw() via the relayer hot
      // wallet — the customer's EOA is never msg.sender.
      const res = await axios.post(`${API}/zk-pool/withdraw-relay`, {
        nullifier_hash: nullifierHash.toString(),
        root: root.toString(),
        recipient,
        proof: { a, b, c },
        chain: "base",
      });

      const txHash = res.data?.tx_hash || res.data?.relay_tx_hash || "";
      const explorer = CHAINS.base?.explorer ?? "https://basescan.org";
      setTxResult({
        hash: txHash,
        url: `${explorer}/tx/${txHash}`,
        recipient,
        amount: noteDenominationEth,
      });
      toast.success("Withdrawal relayed on-chain");
      setStage(null);
    } catch (e) {
      console.error(e);
      const msg = e.response?.data?.detail?.slice(0, 80) || e?.shortMessage || e?.message || "Withdraw relay failed";
      toast.error(msg);
    } finally {
      setLoading(false);
      setStage(null);
    }
  };

  // Compute the per-denom subtree state for the active note, so the
  // status bar reflects the sub-pool the customer is withdrawing from.
  const noteDenomState = (pool?.perDenomination || {})[String(noteDenomination) ?? ""] || null;

  return (
    <div className="space-y-4" data-testid="zk-proofs">
      <div className="text-sm text-white/50">
        Generate a zero-knowledge proof from a saved deposit note and withdraw
        privately. The deposit is unlinkable from this withdrawal. The note's
        denomination pins you to the matching sub-pool — withdrawing against
        the wrong tree reverts.
      </div>

      <div className={`border p-3 text-xs flex items-center gap-2 ${pool?.live ? "border-green-500/30 bg-green-500/5 text-green-300" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-300"}`}>
        {pool?.live ? (
          <>
            <Shield className="w-3 h-3" />
            <span>
              Pool live on Base · {pool.denominations?.length ?? 0} denominations:
              {" "}
              {(pool.denominations || []).map((d) => `${formatEth(d)}`).join(", ")}
            </span>
            <button onClick={refreshPool} className="ml-auto px-2 border border-white/20 hover:bg-white/10 text-[10px] flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> refresh
            </button>
          </>
        ) : (
          <>PrivacyPool not live on Base yet — {pool?.message ?? pool?.error ?? "deploy pending"}</>
        )}
      </div>

      <div>
        <label className="block text-xs text-white/50 uppercase mb-1">Deposit Note (JSON paste)</label>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
          placeholder='{"nullifier":"…","secret":"…","commitment":"…","denomination_wei":"…","pool":"0x…"}'
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
        {note && (
          <div className="text-[10px] text-white/40 mt-1">
            Note denomination: <span className="text-white/70 font-mono">{noteDenominationEth} ETH</span>
            {note.denomination_wei && (
              <> ({note.denomination_wei} wei)</>
            )}
            . Withdraw will target this sub-pool.
          </div>
        )}
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
          className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50">
          Withdraw
        </button>
      </div>

      {path && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="text-white/40 uppercase">Merkle path (depth 20, scoped to {noteDenominationEth} ETH)</div>
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
          <div>amount: {txResult.amount ?? "?"} ETH (paid from {noteDenominationEth} ETH sub-pool)</div>
          <a href={txResult.url} target="_blank" rel="noopener noreferrer"
            className="text-blue-300 underline break-all">View on Basescan ↗</a>
        </div>
      )}
    </div>
  );
}
