import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { Lock, Loader2, Shield, Hash, Download, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import {
  computeCommitment,
  computeNullifierHash,
  fetchPoolState,
  ZK_ASSETS_BASE,
} from "@/lib/zk-browser";

// Minimal PrivacyPool ABI — only the deposit() call the user makes themselves.
// Match `backend/server.py` PRIVACY_POOL_ABI kept in lock-step.
const PRIVACY_POOL_DEPOSIT_ABI = [
  "function deposit(uint256 commitment) external payable",
  "function denomination() view returns (uint256)",
  "function currentRoot() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)",
];

// Format a BN254 field element to a 0x-prefixed 32-byte hex string.
function toBytes32(n) {
  const hex = BigInt(n).toString(16);
  return "0x" + hex.padStart(64, "0");
}

function truncate(s, n = 18) {
  if (!s) return "";
  return s.slice(0, n) + "…";
}

export function ZKCommitments() {
  const { address, chain } = useWallet();
  const [tab, setTab] = useState("deposit");
  const [loading, setLoading] = useState(false);
  const [poolState, setPoolState] = useState(null);

  // Deposit form
  const [depositNote, setDepositNote] = useState(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [txStatus, setTxStatus] = useState(null);
  const [savedToDisk, setSavedToDisk] = useState(false);

  // Pool liveness check (Base only)
  const baseChain = CHAINS.base;
  const poolAddr = baseChain?.contracts?.privacyPool;

  const refreshPool = useCallback(async () => {
    try {
      const data = await fetchPoolState();
      setPoolState(data);
    } catch (e) {
      setPoolState({ live: false, error: e?.message ?? String(e) });
    }
  }, []);

  useEffect(() => { refreshPool(); }, [refreshPool]);

  const onDeposit = async () => {
    if (!address) return toast.error("Connect wallet to Base first");
    if (!poolState?.live) return toast.error("PrivacyPool not live on Base yet");
    if (!poolAddr) return toast.error("PrivacyPool address missing — refresh or wait for /api/deployments");
    setLoading(true);
    setTxStatus("Generating secrets…");
    try {
      // 1. Generate the secret materials in the browser (NEVER sent anywhere).
      const { randomFieldElement } = await import("@/lib/zk-browser");
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();

      // 2. Compute commitment = Poseidon(nullifier, secret) and cache
      //    nullifierHash so the user can re-confirm later.
      const commitmentHex = await computeCommitment(nullifier, secret);
      const nullifierHash = await computeNullifierHash(nullifier);

      setTxStatus("Sending tx to PrivacyPool.deposit(commitment)…");

      // 3. Send the on-chain deposit. We pass denomination's worth of ETH.
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const pool = new ethers.Contract(poolAddr, PRIVACY_POOL_DEPOSIT_ABI, signer);

      const denom = BigInt(poolState.denomination);
      const tx = await pool.deposit(toBytes32(commitmentHex), {
        value: denom,
        gasLimit: 200_000,
      });
      setTxStatus("Waiting for confirmation…");
      const receipt = await tx.wait();

      // 4. Build the "note" the user MUST save to withdraw later.
      const note = {
        chain: "base",
        pool: poolAddr,
        denomination_wei: denom.toString(),
        nullifier,
        secret,
        commitment: commitmentHex,
        nullifierHash,
        tx_hash: receipt?.hash ?? tx.hash,
        leaf_index: null, // filled in from /api/zk-pool/state on next refresh
        note_id: "upl-zk-" + crypto.randomUUID().slice(0, 8),
        saved_at: new Date().toISOString(),
      };

      setDepositNote(note);
      setSavedToDisk(false);
      // Also tell the backend about the deposit so it can serve Merkle paths.
      try {
        await axios.post(`${API}/zk-pool/deposit`, {
          commitment: toBytes32(commitmentHex),
          tx_hash: receipt?.hash ?? tx.hash,
        });
      } catch (e) {
        // Non-fatal — the chain is the source of truth.
        console.warn("Backend deposit record failed (non-fatal):", e);
      }
      await refreshPool();
      toast.success("Deposit confirmed — SAVE THE NOTE!");
      setTxStatus(null);
    } catch (e) {
      console.error(e);
      toast.error(e?.shortMessage ?? e?.message ?? "Deposit failed");
      setTxStatus(null);
    } finally {
      setLoading(false);
    }
  };

  // Allow the user to download the note as JSON so they keep it offline.
  const downloadNote = () => {
    if (!depositNote) return;
    const blob = new Blob([JSON.stringify(depositNote, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${depositNote.note_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSavedToDisk(true);
  };

  const live = !!poolState?.live;
  const denomEth = poolState?.denomination
    ? Number(BigInt(poolState.denomination)) / 1e18
    : null;

  return (
    <div className="space-y-4">
      <div className="text-sm text-white/50">
        Make a private deposit into the UPL PrivacyPool on Base. The deposit is
        unlinkable from any future withdrawal — only you can spend it, and only
        if you save the note this page gives you.
      </div>

      {/* Pool status bar */}
      <div className={`border p-3 text-xs ${live ? "border-green-500/30 bg-green-500/5 text-green-300" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-300"}`}>
        {live ? (
          <>
            <Shield className="w-3 h-3 inline mr-1" />
            Pool live on Base · denomination {denomEth ?? "?"} ETH · root <span className="font-mono">{truncate(poolState.currentRoot, 14)}</span>
          </>
        ) : (
          <>PrivacyPool not live on Base yet — {poolState?.message ?? poolState?.error ?? "deploy pending"}</>
        )}
      </div>

      <div className="flex border border-white/10">
        {["deposit", "note"].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs uppercase tracking-wider ${tab === t ? "bg-white/10" : "bg-transparent text-white/50"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* DEPOSIT TAB */}
      {tab === "deposit" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/50 uppercase mb-1">Network</label>
            <input value="Base Mainnet" readOnly
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none text-white/70" />
          </div>
          <div className="bg-white/5 border border-white/10 p-3 text-xs text-white/60 space-y-1">
            <div>• A Poseidon commitment is generated locally (nullifier + secret).</div>
            <div>• The commitment is sent to <code>PrivacyPool.deposit()</code> as the leaf.</div>
            <div>• The pool stores the leaf in a depth-20 Merkle tree; you receive a note.</div>
            <div>• To withdraw: load the note in the <Link to="/zk-proofs" className="underline">ZK Proofs</Link> tab and generate a Groth16 proof.</div>
          </div>
          <button onClick={onDeposit} disabled={loading || !live}
            data-testid="zk-deposit-btn"
            className="w-full py-3 bg-white/10 border border-white/20 font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Lock className="w-5 h-5" />}
            {txStatus ?? (live ? `Deposit ${denomEth ?? "?"} ETH` : "Pool not live")}
          </button>
        </div>
      )}

      {/* NOTE TAB */}
      {tab === "note" && (
        <div className="space-y-3" data-testid="zk-commit-note">
          {!depositNote ? (
            <div className="text-center py-8 text-white/30 text-sm">
              <Hash className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No deposit yet. Make one in the Deposit tab.
            </div>
          ) : (
            <>
              <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-200">
                <strong>Save this note!</strong> The nullifier and secret can never be
                recovered. Without them you cannot withdraw.
              </div>
              <pre className="bg-black border border-white/20 p-3 text-xs font-mono break-all whitespace-pre-wrap">
{JSON.stringify(
  showSecrets
    ? depositNote
    : { ...depositNote, nullifier: "0x…(hidden)", secret: "0x…(hidden)" },
  null, 2
)}
              </pre>
              <div className="flex gap-2">
                <button onClick={() => setShowSecrets((s) => !s)}
                  className="flex-1 py-2 bg-white/5 border border-white/20 text-xs uppercase tracking-wider hover:bg-white/10 flex items-center justify-center gap-2">
                  {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showSecrets ? "Hide" : "Reveal"} secrets
                </button>
                <button onClick={downloadNote}
                  className="flex-1 py-2 bg-white/10 border border-white/20 text-xs uppercase tracking-wider hover:bg-white/15 flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download JSON
                </button>
              </div>
              {savedToDisk && <div className="text-xs text-green-400">Saved ✓</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
