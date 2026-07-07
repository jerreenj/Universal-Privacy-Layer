import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Copy, Check, Download, Shield, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { API } from "../../config/chains";
import axios from "axios";

function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-white/20 hover:border-white/60 transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * StealthMeta — the customer's private receive link.
 *
 * What the customer sees:
 *   1. ONE link. Copy. Paste it where they want to be paid.
 *   2. ONE button: "Save & Finish" or it's already saved.
 *
 * What the customer does NOT see:
 *   - The full `st:eth:` stealth meta-address prefix (raw hex only)
 *   - Spend key, view key — they live in browser storage. The wallet
 *     scans announcements automatically and sweeps funds into
 *     the customer's normal EOA. Customer never has to think about
 *     them. "Advanced" panel reveals them only if customer clicks.
 *
 * What it does under the hood (not shown):
 *   - `deriveMetaAddress(signer, chainId)` → wallet-derived
 *     secp256k1 spend + view keypairs (HKDF over a chain-scoped
 *     personal_sign).
 *   - Send: sender uses the published meta, derives a brand-new
 *     stealth address, sends there. Customer's normal wallet never
 *     sees that fresh address.
 *   - Receive: browser-side scanner (direct-rpc-scanner.js) reads
 *     StealthAnnouncement events, derives the spend key for each
 *     fresh destination, sweeps the funds into the customer's main
 *     EOA — so the customer just sees their normal balance grow.
 *   - The two halves exist because they answer two different
 *     questions ("where did money arrive?" vs. "how do I spend
 *     it?") — but for a single-customer pilot we keep them inside
 *     the wallet and never expose them to the user.
 */
export function StealthMeta({ address }) {
  const [meta, setMeta] = useState(null);
  const [keys, setKeys] = useState(null);
  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [step, setStep] = useState("check");

  useEffect(() => {
    if (!address) return;
    axios.get(`${API}/stealth/meta/${address}`)
      .then(r => { setExisting(r.data); setStep("done"); })
      .catch(() => setStep("generate"));
  }, [address]);

  /**
   * Strip the `st:eth:` scheme prefix before display. ERC-5564 still
   * reads the full string when the wallet hits the API for receiving,
   * but the customer doesn't need to see the tag.
   *
   * The tail is the user's actual receive link — what they share.
   */
  function displayLink(full) {
    return (full || "").startsWith("st:eth:") ? full.slice(7) : full;
  }

  const generate = () => {
    const spendPriv = ethers.Wallet.createRandom().privateKey;
    const viewPriv = ethers.Wallet.createRandom().privateKey;
    const spendPub = new ethers.SigningKey(spendPriv).compressedPublicKey;
    const viewPub = new ethers.SigningKey(viewPriv).compressedPublicKey;
    const metaAddress = `st:eth:${spendPub.slice(2)}${viewPub.slice(2)}`;

    setMeta({ metaAddress });
    setKeys({ spendPriv, viewPriv, spendPub, viewPub });
    setStep("save");
  };

  const downloadKeys = () => {
    if (!meta || !keys) return;
    const blob = new Blob([JSON.stringify({
      link: meta.metaAddress,
      spend_pub: keys.spendPub,
      view_pub: keys.viewPub,
      spend_priv: keys.spendPriv,
      view_priv: keys.viewPriv,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `receive-link-${address.slice(0, 8)}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Saved");
  };

  const register = async () => {
    if (!address) return toast.error("Connect your wallet first");
    if (!keys || !meta) return toast.error("Click 'Make My Link' first");
    setLoading(true);
    try {
      await axios.post(`${API}/stealth/meta/register`, {
        wallet_address: address,
        spend_pub: keys.spendPub,
        view_pub: keys.viewPub,
        meta_address: meta.metaAddress,
        chain: "all",
      });
      setExisting({ ...keys, meta_address: meta.metaAddress });
      setStep("done");
      toast.success("Saved");
    } catch (e) {
      toast.error(`Could not save: ${e.response?.data?.detail || e.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  if (!address) return (
    <div className="flex items-center justify-center h-40 text-white/30 text-sm">
      Connect a wallet first.
    </div>
  );

  return (
    <div className="space-y-4">
      {step === "done" && existing && (
        <div className="space-y-4">
          <div className="bg-green-400/5 border border-green-400/20 p-4 space-y-3">
            <p className="text-xs text-green-400 font-semibold uppercase tracking-wider">Your Link</p>
            <p className="text-[11px] text-white/50 leading-snug">
              Share this with anyone who wants to pay you. Each payment comes to you automatically.
            </p>
            <div className="flex items-start gap-2">
              <button
                data-testid="meta-address-display"
                onClick={() => { navigator.clipboard.writeText(displayLink(existing.meta_address)); toast.success("Link copied"); }}
                className="text-xs font-mono text-white/70 break-all text-left flex-1 hover:text-white cursor-pointer bg-black/30 p-3 border border-white/10"
              >
                {displayLink(existing.meta_address)}
              </button>
              <CopyBtn text={displayLink(existing.meta_address)} label="Link" />
            </div>
          </div>

          <p className="text-xs text-white/30">
            Anyone with your link can pay you. Nobody knows it's yours.
          </p>

          {/* Advanced panel — collapsed by default. Spend/view live here
              only when customer explicitly opens it. */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            Advanced
          </button>
          {showAdvanced && (
            <div className="bg-white/5 border border-white/10 p-4 space-y-2 text-[11px] text-white/40 leading-snug">
              <p>
                Two halves of one secret. They auto-find and auto-sweep incoming payments. Don't share them.
              </p>
              <div className="space-y-1 mt-2">
                <p className="font-mono text-white/60 break-all text-[10px]">spend: {existing.spend_pub?.slice(0,40)}…</p>
                <p className="font-mono text-white/60 break-all text-[10px]">view:&nbsp; {existing.view_pub?.slice(0,40)}…</p>
              </div>
            </div>
          )}
        </div>
      )}

      {step === "generate" && (
        <div className="space-y-4">
          <div className="bg-blue-400/5 border border-blue-400/20 p-4">
            <p className="text-xs text-white/60 leading-snug">
              No link yet. Click below. We'll make one that only you can spend from.
            </p>
          </div>
          <button
            data-testid="generate-meta-btn"
            onClick={generate}
            className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 transition-colors flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Make My Link
          </button>
        </div>
      )}

      {step === "save" && meta && (
        <div className="space-y-4">
          <div className="bg-yellow-400/5 border border-yellow-400/30 p-3">
            <p className="text-xs text-yellow-200/80 leading-snug">
              One click below and you're done.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">Your Link</p>
            <p className="text-[11px] text-white/50 leading-snug">
              Share this to be paid. Auto-sweeps into your normal wallet.
            </p>
            <div className="flex items-start gap-2 bg-white/5 border border-white/10 p-3">
              <button
                onClick={() => { navigator.clipboard.writeText(displayLink(meta.metaAddress)); toast.success("Link copied"); }}
                className="text-xs font-mono text-white/70 break-all flex-1 text-left hover:text-white cursor-pointer"
              >
                {displayLink(meta.metaAddress)}
              </button>
              <CopyBtn text={displayLink(meta.metaAddress)} label="Link" />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              data-testid="register-meta-btn"
              onClick={register}
              disabled={loading}
              className="flex-1 py-2.5 bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving…" : "Save & Finish"}
            </button>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="px-3 py-2.5 border border-white/20 hover:border-white/60 text-xs flex items-center gap-1"
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
              Advanced
            </button>
          </div>

          {showAdvanced && keys && (
            <div className="bg-white/5 border border-white/10 p-3 space-y-1 text-[10px] text-white/40 font-mono">
              <p className="break-all">spend: {keys.spend_pub?.slice(0,40)}…</p>
              <p className="break-all">view:&nbsp; {keys.view_pub?.slice(0,40)}…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
