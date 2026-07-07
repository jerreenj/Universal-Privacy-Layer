import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Copy, Check, Download, Shield, Eye, Lock, AlertTriangle, ChevronRight } from "lucide-react";
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

export function StealthMeta({ address }) {
  const [meta, setMeta] = useState(null);
  const [keys, setKeys] = useState(null);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState(null);
  const [step, setStep] = useState("check");

  useEffect(() => {
    if (!address) return;
    axios.get(`${API}/stealth/meta/${address}`)
      .then(r => { setExisting(r.data); setStep("done"); })
      .catch(() => setStep("generate"));
  }, [address]);

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
      generated_at: new Date().toISOString(),
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
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-white">Your Private Receive Link</h3>
        <p className="text-xs text-white/40">One link. Nobody knows it's yours.</p>
      </div>

      {step === "done" && existing && (
        <div className="space-y-4">
          {/* ONE link. ONE copy button. ONE line of explanation. */}
          <div className="bg-green-400/5 border border-green-400/20 p-4 space-y-3">
            <p className="text-xs text-green-400 font-semibold uppercase tracking-wider">Your Link</p>
            <p className="text-[11px] text-white/50 leading-snug">
              Share this with anyone who wants to pay you. Each payment gets its own fresh secret address — payments can't be tied back to you.
            </p>
            <div className="flex items-start gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(existing.meta_address); toast.success("Link copied"); }}
                data-testid="meta-address-display"
                className="text-xs font-mono text-white/70 break-all text-left flex-1 hover:text-white cursor-pointer bg-black/30 p-3 border border-white/10"
              >
                {existing.meta_address}
              </button>
              <CopyBtn text={existing.meta_address} label="Link" />
            </div>
          </div>

          <p className="text-xs text-white/30">
            Done. Anyone with your link can pay you — nobody can tell the payment came to you.
          </p>
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="text-xs text-white/40 hover:text-white flex items-center gap-1"
          >
            <Eye className="w-3 h-3" />
            {showSecret ? "Hide" : "Show"} my secret key
            <ChevronRight className={`w-3 h-3 transition-transform ${showSecret ? 'rotate-90' : ''}`} />
          </button>
          {showSecret && (
            <div className="bg-red-400/5 border border-red-400/20 p-4 space-y-2">
              <p className="text-xs text-red-400/80">
                One secret. Use it to spend payments anyone sends to your link.
              </p>
              <div className="flex items-start gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(`spend:${existing.spend_priv}\nview:${existing.view_priv}`); toast.success("Secret key copied"); }}
                  className="text-xs font-mono text-white/50 break-all text-left flex-1 hover:text-white cursor-pointer bg-black/30 p-3 border border-red-400/20"
                >
                  <div>spend: {existing.spend_priv?.slice(0, 30)}…</div>
                  <div>view:&nbsp; {existing.view_priv?.slice(0, 30)}…</div>
                </button>
                <CopyBtn
                  text={`spend:${existing.spend_priv}\nview:${existing.view_priv}`}
                  label="Secret"
                />
              </div>
              <p className="text-[11px] text-white/40 leading-snug">
                Two halves of one secret. Both kept private. One moves money, one finds it. Save it somewhere safe.
              </p>
            </div>
          )}
        </div>
      )}

      {step === "generate" && (
        <div className="space-y-4">
          <div className="bg-blue-400/5 border border-blue-400/20 p-4">
            <p className="text-xs text-white/60 leading-snug">
              No link yet. Click below. We'll create one nobody else controls.
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
          <div className="bg-yellow-400/5 border border-yellow-400/30 p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-200/80 leading-snug">
              Save your secret key below. We can't recover it if you lose it.
            </p>
          </div>

          {/* ONE link in this panel too. */}
          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">Your Link</p>
            <p className="text-[11px] text-white/50 leading-snug">
              People use this to send you money. Each payment gets a fresh hidden address.
            </p>
            <div className="flex items-start gap-2 bg-white/5 border border-white/10 p-3">
              <button
                onClick={() => { navigator.clipboard.writeText(meta.metaAddress); toast.success("Link copied"); }}
                className="text-xs font-mono text-white/70 break-all flex-1 text-left hover:text-white cursor-pointer"
              >
                {meta.metaAddress}
              </button>
              <CopyBtn text={meta.metaAddress} label="Link" />
            </div>
          </div>

          {/* ONE secret in this panel. Save it. */}
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="text-xs text-white/40 hover:text-white flex items-center gap-1"
          >
            <Eye className="w-3 h-3" />
            {showSecret ? "Hide" : "Show"} my secret key
            <ChevronRight className={`w-3 h-3 transition-transform ${showSecret ? 'rotate-90' : ''}`} />
          </button>
          {showSecret && keys && (
            <div className="bg-red-400/5 border border-red-400/20 p-4 space-y-2">
              <p className="text-xs text-red-400/80">
                Your secret. Two halves: one moves your money, one finds it.
              </p>
              <div className="flex items-start gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(`spend:${keys.spendPriv}\nview:${keys.viewPriv}`); toast.success("Secret key copied"); }}
                  className="text-xs font-mono text-white/50 break-all text-left flex-1 hover:text-white cursor-pointer bg-black/30 p-3 border border-red-400/20"
                >
                  <div>spend: {keys.spendPriv?.slice(0, 30)}…</div>
                  <div>view:&nbsp; {keys.viewPriv?.slice(0, 30)}…</div>
                </button>
                <CopyBtn
                  text={`spend:${keys.spendPriv}\nview:${keys.viewPriv}`}
                  label="Secret"
                />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={downloadKeys}
              className="flex-1 py-2.5 border border-white/20 hover:border-white/60 text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Save to file
            </button>
            <button
              data-testid="register-meta-btn"
              onClick={register}
              disabled={loading}
              className="flex-1 py-2.5 bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving…" : "Save & Finish"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
