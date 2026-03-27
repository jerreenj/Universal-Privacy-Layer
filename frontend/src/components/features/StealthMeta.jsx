/**
 * StealthMeta — Generate, store, and share your stealth meta-address
 * Step 1 of the privacy flow: set up your identity
 */
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Copy, Check, Download, Shield, Eye, Key, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { generateMetaAddress } from "../../utils/stealth";
import { API } from "../../config/chains";
import axios from "axios";

function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); toast.success(`${label} copied`); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1 px-2 py-1 text-xs border border-white/20 hover:border-white/60 transition-colors"
    >
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
  const [step, setStep] = useState("check"); // check | generate | save | done

  // Check if user already has a meta-address
  useEffect(() => {
    if (!address) return;
    axios.get(`${API}/stealth/meta/${address}`)
      .then(r => { setExisting(r.data); setStep("done"); })
      .catch(() => setStep("generate"));
  }, [address]);

  const generate = () => {
    const result = generateMetaAddress();
    setMeta(result);
    setKeys({
      spendPriv: result.spendPriv,
      viewPriv:  result.viewPriv,
      spendPub:  result.spendPub,
      viewPub:   result.viewPub,
    });
    setStep("save");
  };

  const downloadKeys = () => {
    const data = JSON.stringify({
      warning: "KEEP THIS FILE PRIVATE. NEVER share spend_priv or view_priv.",
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
    toast.success("Keys downloaded — store safely");
  };

  const register = async () => {
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
      toast.success("Stealth meta-address registered");
    } catch {
      toast.error("Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (!address) return (
    <div className="flex items-center justify-center h-40 text-white/30 text-sm">
      Connect your wallet to set up stealth receiving
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-5 h-5 text-green-400" />
        <div>
          <h3 className="font-semibold text-white">Stealth Meta-Address</h3>
          <p className="text-xs text-white/40">Your permanent privacy identity — share publicly, receive privately</p>
        </div>
      </div>

      {/* Already registered */}
      {step === "done" && existing && (
        <div className="space-y-4">
          <div className="bg-green-400/5 border border-green-400/20 p-4 space-y-3">
            <p className="text-xs text-green-400 font-semibold uppercase tracking-wider">Active Meta-Address</p>
            <div className="flex items-start gap-2">
              <p className="text-xs font-mono text-white/70 break-all flex-1" data-testid="meta-address-display">
                {existing.meta_address}
              </p>
              <CopyBtn text={existing.meta_address} label="Meta-address" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-white/5 border border-white/10 p-3">
              <p className="text-white/40 mb-1 flex items-center gap-1"><Eye className="w-3 h-3" /> View Public Key</p>
              <p className="font-mono text-white/60 break-all">{existing.view_pub}</p>
            </div>
            <div className="bg-white/5 border border-white/10 p-3">
              <p className="text-white/40 mb-1 flex items-center gap-1"><Key className="w-3 h-3" /> Spend Public Key</p>
              <p className="font-mono text-white/60 break-all">{existing.spend_pub}</p>
            </div>
          </div>
          <p className="text-xs text-white/30">
            Share your meta-address publicly. Anyone can derive a unique stealth address from it to pay you privately.
          </p>
        </div>
      )}

      {/* Generate step */}
      {step === "generate" && (
        <div className="space-y-4">
          <div className="bg-blue-400/5 border border-blue-400/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-white">No meta-address found</p>
            <p className="text-xs text-white/50">
              Generate a stealth meta-address to start receiving private payments. 
              This creates a spend keypair and view keypair — both are required to receive funds.
            </p>
          </div>
          <button
            data-testid="generate-meta-btn"
            onClick={generate}
            className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 transition-colors flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Generate Stealth Meta-Address
          </button>
        </div>
      )}

      {/* Save keys step */}
      {step === "save" && meta && (
        <div className="space-y-4">
          <div className="bg-yellow-400/5 border border-yellow-400/30 p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-200/80">
              <strong>Save your private keys now.</strong> They cannot be recovered if lost. 
              Download the key file and store it securely (password manager or encrypted drive).
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider">Your Meta-Address (share publicly)</p>
            <div className="flex items-start gap-2 bg-white/5 border border-white/10 p-3">
              <p className="text-xs font-mono text-white/70 break-all flex-1">{meta.metaAddress}</p>
              <CopyBtn text={meta.metaAddress} label="Meta-address" />
            </div>
          </div>

          <button
            onClick={() => setShowPrivate(!showPrivate)}
            className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors"
          >
            <Eye className="w-3 h-3" />
            {showPrivate ? "Hide" : "Show"} private keys
          </button>

          {showPrivate && (
            <div className="space-y-2 bg-red-400/5 border border-red-400/20 p-3">
              <div className="space-y-1">
                <p className="text-xs text-red-400/70">Spend Private Key (NEVER share)</p>
                <p className="text-xs font-mono text-white/50 break-all">{keys.spendPriv}</p>
              </div>
              <div className="space-y-1 pt-2 border-t border-white/10">
                <p className="text-xs text-yellow-400/70">View Private Key (share only with trusted scanner)</p>
                <p className="text-xs font-mono text-white/50 break-all">{keys.viewPriv}</p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={downloadKeys}
              className="flex-1 py-2.5 border border-white/20 hover:border-white/60 text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Keys
            </button>
            <button
              data-testid="register-meta-btn"
              onClick={register}
              disabled={loading}
              className="flex-1 py-2.5 bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Registering…" : "Register & Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
