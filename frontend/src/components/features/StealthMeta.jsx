import { useState, useEffect } from "react";
import { Copy, Check, Shield } from "lucide-react";
import { toast } from "sonner";
import { API } from "../../config/chains";
import axios from "axios";
import { deriveStealthEOA } from "@/lib/wallet-stealth";

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
 * StealthMeta — the customer's ONE private receive address.
 *
 * One per connected wallet. Same address works across every chain
 * (Base, Arbitrum, Optimism, anywhere EVM). Share it once. Anyone
 * who has it can pay you. Nobody else can link it to your main
 * wallet.
 *
 * The customer only sees:
 *   - Their st:eth link (one line of plaintext).
 *   - Copy button.
 *   - Save button.
 *
 * The customer never sees:
 *   - Spend / view key (those only exist if you opt into EIP-5564
 *     meta format elsewhere — the consumer-grade flow just uses ONE
 *     address, derived from your wallet signature, used across
 *     every chain).
 *
 * The internal browser keeps enough state to do inbound streaming:
 * when something arrives at this address, the wallet app watches
 * and surfaces the activity. The customer's main wallet balance
 * grows in their normal place.
 */
export function StealthMeta({ address, signer }) {
  const [existing, setExisting] = useState(null);
  const [step, setStep] = useState("check");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    axios.get(`${API}/stealth/meta/${address}`)
      .then(r => { setExisting(r.data); setStep("done"); })
      .catch(() => setStep("generate"));
  }, [address]);

  /**
   * Generate the ONE address. Same wallet → same address every
   * time, regardless of chain. We keep the st:eth: ERC-5564 prefix
   * so other wallets recognise it; we paste it IN FULL.
   */
  const generate = async () => {
    if (!signer) { toast.error("Connect a wallet first"); return; }
    setLoading(true);
    try {
      const { address: stealthAddr, privateKey } = await deriveStealthEOA(signer);
      // Store the private key in browser so the FE can do inbound
      // activity surfacing. Customer does not see this string
      // anywhere on the UI.
      try {
        localStorage.setItem(`upl:stealth-pk:${address.toLowerCase()}`, privateKey);
      } catch {}
      // The customer's st:eth link — keep the scheme prefix
      // per user request so the format is recognizable.
      const metaAddress = `st:eth:${stealthAddr}`;
      await axios.post(`${API}/stealth/meta/register`, {
        wallet_address: address,
        meta_address: metaAddress,
        chain: "all",
      });
      setExisting({ meta_address: metaAddress });
      setStep("done");
      toast.success("Done");
    } catch (e) {
      toast.error(`Could not generate: ${e.message || "Unknown error"}`);
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
      <div>
        <h3 className="font-semibold text-white">Your Receive Link</h3>
        <p className="text-xs text-white/40">One address. Works on every chain. Share once.</p>
      </div>

      {step === "done" && existing && (
        <div className="bg-green-400/5 border border-green-400/20 p-4 space-y-2">
          <p className="text-xs text-white/50">
            Anyone with this link can pay you on any chain.
          </p>
          <div className="flex items-start gap-2">
            <button
              data-testid="meta-address-display"
              onClick={() => { navigator.clipboard.writeText(existing.meta_address); toast.success("Link copied"); }}
              className="text-xs font-mono text-white/70 break-all text-left flex-1 hover:text-white cursor-pointer bg-black/30 p-3 border border-white/10"
            >
              {existing.meta_address}
            </button>
            <CopyBtn text={existing.meta_address} label="Link" />
          </div>
        </div>
      )}

      {step === "generate" && (
        <div className="space-y-4">
          <div className="bg-blue-400/5 border border-blue-400/20 p-4">
            <p className="text-xs text-white/60">
              No link yet.
            </p>
          </div>
          <button
            data-testid="generate-meta-btn"
            onClick={generate}
            disabled={loading}
            className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Shield className="w-4 h-4" />
            {loading ? "Making…" : "Make My Link"}
          </button>
        </div>
      )}
    </div>
  );
}
