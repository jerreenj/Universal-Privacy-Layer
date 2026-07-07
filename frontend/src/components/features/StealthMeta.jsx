import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Copy, Check, Download, Shield, Eye, Key, AlertTriangle } from "lucide-react";
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
    <button onClick={copy} className="flex items-center gap-1 px-2 py-1 text-xs border border-white/20 hover:border-white/60 transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function StealthMeta({ address }) {
  const [meta, setMeta] = useState(null);
  const [keys, setKeys] = useState(null);
  const [showPrivate, setShowPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
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
    const data = JSON.stringify({
      warning: "KEEP THIS FILE PRIVATE.",
      wallet_address: address,
      meta_address: meta.metaAddress,
      spend_pub: keys.spendPub,
      view_pub: keys.viewPub,
      spend_priv: keys.spendPriv,
      view_priv: keys.viewPriv,
      generated_at: new Date().toISOString(),
    }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `stealth-keys-${address.slice(0, 8)}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("File saved");
  };

  const register = async () => {
    if (!address) { toast.error("Connect your wallet first"); return; }
    if (!keys || !meta) { toast.error("Click 'Generate' first"); return; }
    setLoading(true);
    try {
      await axios.post(`${API}/stealth/meta/register`, {
        wallet_address: address,
        spend_pub: keys.spendPub,
        view_pub: keys.viewPub,
        meta_address: meta.metaAddress,
        chain: "all",
      });
      setRegistered(true);
      setExisting({ ...keys, meta_address: meta.metaAddress });
      setStep("done");
      toast.success("Saved");
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || "Unknown error";
      toast.error(`Could not save: ${msg}`);
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
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-green-400" />
        <div>
          <h3 className="font-semibold text-white">Your Private Receive Link</h3>
          <p className="text-xs text-white/40">One link to get paid. Nobody can link it to your wallet.</p>
        </div>
      </div>

      {step === "done" && existing && (
        <div className="space-y-4">
          {/* Your Private Receive Link */}
          <div className="bg-green-400/5 border border-green-400/20 p-4 space-y-3">
            <p className="text-xs text-green-400 font-semibold uppercase tracking-wider">Your Link</p>
            <p className="text-[11px] text-white/50 leading-snug">
              This is the link people send money to.<br />
              Don't send it to anyone. Keep it for yourself so the system can find your payments.
            </p>
            <div className="flex items-start gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(existing.meta_address);
                  toast.success("Link copied");
                }}
                data-testid="meta-address-display"
                className="text-xs font-mono text-white/70 break-all text-left flex-1 hover:text-white cursor-pointer bg-white/5 p-2 border border-white/10"
                title="Click to copy"
              >
                {existing.meta_address}
              </button>
              <CopyBtn text={existing.meta_address} label="Link" />
            </div>
          </div>

          {/* Section: How a Payment Reaches You — what each part does */}
          <div className="space-y-3">
            <p className="text-xs text-white/40 uppercase tracking-wider">How a Payment Reaches You</p>

            <div className="bg-white/5 border border-white/10 p-3 space-y-1">
              <p className="text-xs text-white/60 flex items-center gap-1">
                <Eye className="w-3 h-3" /> Public Numbers for Receiving
              </p>
              <p className="text-[11px] text-white/40 leading-snug">
                Two public numbers anyone can see. Together they make your link above.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  data-testid="view-pub-copy-btn"
                  onClick={() => { navigator.clipboard.writeText(existing.view_pub); toast.success("Copied"); }}
                  className="text-left bg-black/30 hover:bg-black/60 p-2 cursor-pointer"
                >
                  <p className="text-[10px] text-white/30">Finder code</p>
                  <p className="font-mono text-[10px] text-white/60 break-all">{existing.view_pub}</p>
                </button>
                <button
                  data-testid="spend-pub-copy-btn"
                  onClick={() => { navigator.clipboard.writeText(existing.spend_pub); toast.success("Copied"); }}
                  className="text-left bg-black/30 hover:bg-black/60 p-2 cursor-pointer"
                >
                  <p className="text-[10px] text-white/30">Address key</p>
                  <p className="font-mono text-[10px] text-white/60 break-all">{existing.spend_pub}</p>
                </button>
              </div>
              <p className="text-[10px] text-white/30 mt-2">
                Safe to share. They only let people find your payments.
              </p>
            </div>
          </div>

          <p className="text-xs text-white/30">
            Done. Anyone with your link can pay you — and no one can tell the payment came to you.
          </p>
        </div>
      )}

      {step === "generate" && (
        <div className="space-y-4">
          <div className="bg-blue-400/5 border border-blue-400/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-white">No link yet</p>
            <p className="text-xs text-white/50 leading-snug">
              Click the button. We'll make one that only you can spend from.
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
            <div className="text-xs text-yellow-200/80 leading-snug">
              <strong>Save the next step before continuing.</strong><br />
              We can't recover these if you lose them.
            </div>
          </div>

          {/* Your Private Receive Link */}
          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">Your Private Receive Link</p>
            <p className="text-[11px] text-white/50 leading-snug">
              Share this with people who want to pay you.<br />
              Each payment creates a fresh address. Nobody can link them.
            </p>
            <div className="flex items-start gap-2 bg-white/5 border border-white/10 p-3">
              <button
                onClick={() => { navigator.clipboard.writeText(meta.metaAddress); toast.success("Link copied"); }}
                className="text-xs font-mono text-white/70 break-all flex-1 text-left hover:text-white cursor-pointer"
                title="Click to copy"
              >
                {meta.metaAddress}
              </button>
              <CopyBtn text={meta.metaAddress} label="Link" />
            </div>
          </div>

          <button
            onClick={() => setShowPrivate(!showPrivate)}
            className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors"
          >
            <Eye className="w-3 h-3" />
            {showPrivate ? "Hide" : "Show"} secret numbers
          </button>

          {showPrivate && keys && (
            <div className="space-y-2 bg-red-400/5 border border-red-400/20 p-3">
              <p className="text-[11px] text-white/50 leading-snug">
                <strong>Two secret numbers.</strong> Only you should see these. Anyone with them can spend your money.
              </p>
              <button
                data-testid="spend-priv-copy-btn"
                onClick={() => { navigator.clipboard.writeText(keys.spendPriv); toast.success("Copied"); }}
                className="text-left w-full hover:bg-white/5 cursor-pointer p-2"
              >
                <p className="text-xs text-red-400/70 flex items-center gap-1">
                  <Key className="w-3 h-3" /> Key to spend your money (PIN-style)
                </p>
                <p className="text-xs font-mono text-white/50 break-all">{keys.spendPriv}</p>
              </button>
              <button
                data-testid="view-priv-copy-btn"
                onClick={() => { navigator.clipboard.writeText(keys.viewPriv); toast.success("Copied"); }}
                className="text-left w-full hover:bg-white/5 cursor-pointer p-2 mt-2 border-t border-white/10 pt-3"
              >
                <p className="text-xs text-yellow-400/70 flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Key to find your payments (looker-style)
                </p>
                <p className="text-xs font-mono text-white/50 break-all">{keys.viewPriv}</p>
              </button>
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
