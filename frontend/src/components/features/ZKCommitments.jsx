import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { Lock, Loader2, Shield, Hash, Download, Eye, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import {
  computeCommitment,
  computeNullifierHash,
  fetchPoolState,
  normalisePoolState,
  ZK_ASSETS_BASE,
} from "@/lib/zk-browser";

// P4.1 multi-denom PrivacyPool ABI — the deposit() call now takes the
// denomination as a second arg (was a `value:` only on P3.4). Reads are
// multi-denom too: getDenominationList / currentRootOf(d) / depositCount(d).
// `event Deposit(commitment, denomination, leafIndex, root)` is the new
// shape on-chain; we parse leaf_index off it directly.
const PRIVACY_POOL_DEPOSIT_ABI = [
  "function deposit(uint256 commitment, uint256 denomination) external payable",
  "function getDenominationList() view returns (uint256[])",
  "function currentRootOf(uint256 denomination) view returns (bytes32)",
  "function depositCount(uint256 denomination) view returns (uint32)",
  "function isDenominationEnabled(uint256 denomination) view returns (bool)",
  "function denomination() view returns (uint256)",
  "event Deposit(bytes32 indexed commitment, uint256 indexed denomination, uint32 indexed leafIndex, bytes32 root)",
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

function formatEth(wei) {
  if (wei == null) return "?";
  try { return (Number(BigInt(wei)) / 1e18).toString(); } catch { return "?"; }
}

export function ZKCommitments() {
  const { address, chain } = useWallet();
  const [tab, setTab] = useState("deposit");
  const [loading, setLoading] = useState(false);
  const [poolState, setPoolState] = useState(null);
  const [denomination, setDenomination] = useState(null); // user's chosen denom (wei string)

  // Deposit form
  const [depositNote, setDepositNote] = useState(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [txStatus, setTxStatus] = useState(null);
  const [savedToDisk, setSavedToDisk] = useState(false);

  // Pool liveness check (Base only)
  const baseChain = CHAINS.base;
  const poolAddr = baseChain?.contracts?.privacyPool;

  // Helper — for end-state display only: read the deposit note's denom
  // (the note carries the denomination we used at deposit time).
  const denominationOptions = useMemo(() => {
    if (!poolState?.denominations) return [];
    return poolState.denominations.map((d) => ({ wei: d, eth: formatEth(d) }));
  }, [poolState]);

  const refreshPool = useCallback(async () => {
    try {
      const raw = await fetchPoolState();
      const norm = normalisePoolState(raw);
      setPoolState(norm);
      // Default the denomination picker to whatever the backend says is
      // the defaultDenomination (the first registered denom: 0.1 ETH on
      // Base). Falls back to legacy single-denom `denomination` field
      // if the backend still serves old shape.
      if (!denomination && norm.defaultDenomination) {
        setDenomination(norm.defaultDenomination);
      } else if (!denomination && norm.denomination) {
        setDenomination(norm.denomination);
      }
    } catch (e) {
      setPoolState({ live: false, kind: "unknown", error: e?.message ?? String(e) });
    }
  }, [denomination]);

  useEffect(() => { refreshPool(); }, [refreshPool]);

  const onDeposit = async () => {
    if (!address) return toast.error("Connect wallet to Base first");
    if (!poolState?.live) return toast.error("PrivacyPool not live on Base yet");
    if (!poolAddr) return toast.error("PrivacyPool address missing — refresh or wait for /api/deployments");
    if (!denomination) return toast.error("Pick a denomination first");
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

      setTxStatus("Sending tx to PrivacyPool.deposit(commitment, denomination)…");

      // 3. Send the on-chain deposit. P4.1: the denomination is passed
      //    as both the 2nd argument AND the msg.value; if the user picks
      //    a denom that is not yet enabled, the contract reverts with
      //    DenominationNotEnabled — caught below.
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const pool = new ethers.Contract(poolAddr, PRIVACY_POOL_DEPOSIT_ABI, signer);

      const denom = BigInt(denomination);
      const tx = await pool.deposit(
        toBytes32(commitmentHex),
        denom,
        { value: denom, gasLimit: 200_000 }
      );
      setTxStatus("Waiting for confirmation…");
      const receipt = await tx.wait();

      // 4. Extract leafIndex + denomination from the Deposit event emitted
      //    by PrivacyPool._insert. The event signature is:
      //      Deposit(bytes32 commitment, uint256 denomination, uint32 leafIndex, bytes32 root)
      // so args[0]=commitment, args[1]=denomination, args[2]=leafIndex.
      // leafIndex is authoritative — the backend uses it to skip tree
      // scan on the post-deposit path lookup.
      let leafIndex = null;
      try {
        for (const log of receipt?.logs ?? []) {
          try {
            const parsed = pool.interface.parseLog(log);
            if (parsed?.name === "Deposit") {
              leafIndex = Number(parsed.args.leafIndex);
              break;
            }
          } catch { /* not our event — skip */ }
        }
      } catch (e) {
        console.warn("ZKCommitments: leafIndex parse failed", e);
      }

      // 5. Build the "note" the user MUST save to withdraw later. The
      //    note carries `denomination_wei` so withdraw can re-pick the
      //    right sub-pool (multi-denom awareness).
      const note = {
        chain: "base",
        pool: poolAddr,
        denomination_wei: denom.toString(),
        nullifier,
        secret,
        commitment: commitmentHex,
        nullifierHash,
        tx_hash: receipt?.hash ?? tx.hash,
        leaf_index: leafIndex,
        note_id: "upl-zk-" + crypto.randomUUID().slice(0, 8),
        saved_at: new Date().toISOString(),
      };

      setDepositNote(note);
      setSavedToDisk(false);
      // 6. Tell the backend about the deposit so it can serve Merkle
      //    paths scoped per denom. Non-fatal if it fails — the chain is
      //    the source of truth and the backend can re-rebuild from the
      //    Deposit event later.
      try {
        await axios.post(`${API}/zk-pool/deposit`, {
          commitment: toBytes32(commitmentHex),
          tx_hash: receipt?.hash ?? tx.hash,
          leaf_index: leafIndex,
          denomination_wei: Number(denom),
        });
      } catch (e) {
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
  const denomEth = denomination ? formatEth(denomination) : "?";
  const denomState = (poolState?.perDenomination || {})[denomination || ""] || null;
  const denomRoot = denomState?.currentRoot || poolState?.currentRoot || null;
  const denomLeafCount = denomState?.nextLeafIndex ?? poolState?.nextLeafIndex ?? null;

  return (
    <div className="space-y-4">
      <div className="text-sm text-white/50">
        Make a private deposit into the UPL PrivacyPool on Base. The deposit is
        unlinkable from any future withdrawal — only you can spend it, and only
        if you save the note this page gives you. The pool supports multiple
        denominations; each has its own Merkle tree.
      </div>

      {/* Pool status bar */}
      <div className={`border p-3 text-xs ${live ? "border-green-500/30 bg-green-500/5 text-green-300" : "border-yellow-500/30 bg-yellow-500/5 text-yellow-300"}`}>
        {live ? (
          <>
            <Shield className="w-3 h-3 inline mr-1" />
            Pool live on Base · denominations {denominationOptions.map(d => `${d.eth} ETH`).join(", ") || "?"}
            {denomRoot && (
              <> · root <span className="font-mono">{truncate(denomRoot, 14)}</span></>
            )}
            {denomLeafCount != null && (
              <> · {denomLeafCount} leaf{denomLeafCount === 1 ? "" : "s"}</>
            )}
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

          {/* Denomination picker — the P4.1 multi-denom surface. */}
          <div>
            <label className="block text-xs text-white/50 uppercase mb-1">Denomination</label>
            <div className="flex gap-2">
              <select
                data-testid="zk-denom-select"
                value={denomination ?? ""}
                onChange={e => setDenomination(e.target.value)}
                disabled={!denominationOptions.length}
                className="flex-1 bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white"
              >
                {denominationOptions.length === 0 ? (
                  <option value="">Loading…</option>
                ) : (
                  denominationOptions.map(d => (
                    <option key={d.wei} value={d.wei} className="bg-black">{d.eth} ETH</option>
                  ))
                )}
              </select>
              <button onClick={refreshPool} data-testid="zk-refresh-btn"
                className="px-3 border border-white/20 hover:bg-white/10 text-xs">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[10px] text-white/30 mt-1">
              Each denomination has its own Poseidon Merkle tree. Withdrawals
              must redeem against the same tree the deposit lives in.
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-3 text-xs text-white/60 space-y-1">
            <div>• A Poseidon commitment is generated locally (nullifier + secret).</div>
            <div>• The commitment + chosen denomination is sent to <code>PrivacyPool.deposit()</code> as a new leaf.</div>
            <div>• The pool stores the leaf in the depth-20 Merkle tree for that denom; you receive a note.</div>
            <div>• To withdraw: load the note in the <Link to="/zk-proofs" className="underline">ZK Proofs</Link> tab — pick the matching denomination (the note carries it).</div>
          </div>
          <button onClick={onDeposit} disabled={loading || !live || !denomination}
            data-testid="zk-deposit-btn"
            className="w-full py-3 bg-white/10 border border-white/20 font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Lock className="w-5 h-5" />}
            {txStatus ?? (live ? `Deposit ${denomEth} ETH` : "Pool not live")}
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
                recovered. Without them you cannot withdraw. The
                <code> denomination_wei</code> field pins you to the matching
                sub-pool at withdraw time.
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
