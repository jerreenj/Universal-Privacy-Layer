import { useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { AlertTriangle, Fingerprint, Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { checkStealthOwnership } from "@/lib/stealth-browser";

// ============================================================
// ⚠ RESEARCH / PROOF-OF-CONCEPT ONLY ⚠
//
// See docs/secp256k1-stealth-zk.md BEFORE merging any production
// capability that surfaces this component. Every render below carries
// the same disclaimer in three separate places so it cannot be missed.
// ============================================================

const DISCLAIMER = "⚠ PoC only. NOT audited. Do not use with real funds.";

export function StealthOwnership() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Inputs (public field elements)
  const [ephemeralPubkeyX, setEphemeralPubkeyX] = useState("");
  const [stealthCommitment, setStealthCommitment] = useState("");

  const onCheck = async () => {
    if (!ephemeralPubkeyX || !stealthCommitment) {
      return toast.error("Both fields required");
    }
    setLoading(true);
    try {
      const r = await checkStealthOwnership({
        ephemeral_pubkey_x: ephemeralPubkeyX,
        stealth_commitment: stealthCommitment,
        witness_hash: null,
        proof_payload: null,
      });
      setResult(r);
      toast.warning("PoC check returned — DO NOT trust the result for real funds");
    } catch (e) {
      toast.error(e?.message ?? "Check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="stealth-ownership">
      {/* Banner #1 — top of the component */}
      <div className="bg-yellow-500/15 border border-yellow-500/40 p-3 text-xs text-yellow-200 flex items-start gap-2">
        <ShieldOff className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold uppercase tracking-wider">Research PoC only</div>
          <div className="mt-1">
            Poseidon(spend, view, eph.x) = commitment scheme. <strong>Not EIP-5564
            compatible.</strong> Not audited. Not for production. See{" "}
            <Link to="/docs/secp256k1-stealth-zk.md" className="underline">
              docs/secp256k1-stealth-zk.md
            </Link>
            .
          </div>
        </div>
      </div>

      <div className="text-sm text-white/50">
        Front-end fingerprint of the public Poseidon commitment + the ephemeral
        pubkey x. Server checks well-formedness; <strong>not a real proof</strong>.
      </div>

      <div className="grid gap-3">
        <div>
          <label className="block text-xs text-white/50 uppercase mb-1">
            ephemeral_pubkey_x (0x-prefixed 32-byte hex)
          </label>
          <input value={ephemeralPubkeyX} onChange={(e) => setEphemeralPubkeyX(e.target.value)}
            placeholder="0x…"
            className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none focus:border-white" />
        </div>
        <div>
          <label className="block text-xs text-white/50 uppercase mb-1">
            stealth_commitment (Recipient-published Poseidon digest)
          </label>
          <input value={stealthCommitment} onChange={(e) => setStealthCommitment(e.target.value)}
            placeholder="0x…"
            className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none focus:border-white" />
        </div>
      </div>

      <button onClick={onCheck} disabled={loading}
        className="w-full py-3 bg-white/10 border border-white/20 font-bold uppercase tracking-wider hover:bg-white/15 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
        {loading ? "Checking (PoC)…" : DISCLAIMER}
      </button>

      {result && (
        <div className="space-y-2" data-testid="stealth-result">
          {/* Banner #2 — every result also carries the disclaimer */}
          <div className="bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              PoC result — research only. Treat the response below as
              untrusted unless it came from a POST to an audited, on-chain
              <code> StealthOwnerVerifier.sol</code>.
            </div>
          </div>
          <pre className="bg-black border border-white/20 p-3 text-xs font-mono break-all whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
          {/* Banner #3 — bottom of the component */}
          <div className="text-center text-xs text-yellow-400 uppercase tracking-wider">
            ⚠ DO NOT act on this result with real funds ⚠
          </div>
        </div>
      )}
    </div>
  );
}
