/**
 * StealthSend — Send ETH privately to any stealth meta-address
 * Derives a fresh stealth address, sends via MetaMask, posts announcement
 */
import { useState } from "react";
import { ethers } from "ethers";
import { ArrowUpRight, Shield, Loader2, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";
import { deriveStealthAddress } from "../../utils/stealth";
import { API, CHAINS } from "../../config/chains";
import axios from "axios";

const authHeaders = () => ({
  Authorization: `Bearer ${sessionStorage.getItem("_upl_tok") || ""}`,
});

const EXPLORERS = {
  base: "https://basescan.org/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  bnb: "https://bscscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/",
  hyperliquid: "https://purrsec.com/tx/",
};

export function StealthSend({ address, chain, provider }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState("input"); // input | preview | sending | done
  const [derived, setDerived] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);

  const derive = async () => {
    if (!recipient.trim() || !amount) return;
    setLoading(true);
    try {
      // Lookup meta-address by wallet address or use directly if it's already a meta-address
      let metaAddress = recipient.trim();
      if (!metaAddress.startsWith("st:eth:")) {
        // Try lookup by wallet address
        const r = await axios.get(`${API}/stealth/meta/${recipient.trim()}`, { headers: authHeaders() });
        metaAddress = r.data.meta_address;
      }
      const result = deriveStealthAddress(metaAddress);
      setDerived({ ...result, metaAddress });
      setStep("preview");
    } catch (e) {
      if (e.response?.status === 404) {
        toast.error("Recipient has no stealth meta-address registered");
      } else {
        toast.error("Invalid meta-address or wallet not found");
      }
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    if (!derived || !provider) return;
    setLoading(true);
    setStep("sending");
    try {
      const signer = await provider.getSigner();
      const amountWei = ethers.parseEther(amount);

      // Send ETH to derived stealth address
      const tx = await signer.sendTransaction({
        to: derived.stealthAddress,
        value: amountWei,
      });
      setTxHash(tx.hash);

      // Post announcement to backend relay (off-chain)
      await axios.post(`${API}/stealth/announce`, {
        sender_address: address,
        stealth_address: derived.stealthAddress,
        ephemeral_pub: derived.ephemeralPub,
        view_tag: derived.viewTag,
        amount_wei: amountWei.toString(),
        chain: chain,
        tx_hash: tx.hash,
      }, { headers: authHeaders() });

      setStep("done");
      toast.success("Private transfer announced");
    } catch (e) {
      toast.error(e.message?.slice(0, 80) || "Transaction failed");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("input"); setDerived(null); setTxHash("");
    setRecipient(""); setAmount("");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ArrowUpRight className="w-5 h-5 text-green-400" />
        <div>
          <h3 className="font-semibold text-white">Send Privately</h3>
          <p className="text-xs text-white/40">
            Recipient gets a unique stealth address — no on-chain link to them
          </p>
        </div>
      </div>

      {/* Input */}
      {step === "input" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-white/40 uppercase tracking-wider">
              Recipient wallet address or stealth meta-address
            </label>
            <input
              data-testid="stealth-recipient-input"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="0x... or st:eth:0x..."
              className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/50 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-white/40 uppercase tracking-wider">
              Amount ({CHAINS[chain]?.symbol || "ETH"})
            </label>
            <input
              data-testid="stealth-amount-input"
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.01"
              min="0"
              step="0.001"
              className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/50"
            />
          </div>
          <button
            data-testid="stealth-derive-btn"
            onClick={derive}
            disabled={loading || !recipient || !amount || !address}
            className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {loading ? "Deriving stealth address…" : "Preview Private Send"}
          </button>
          {!address && <p className="text-xs text-yellow-400/70 text-center">Connect wallet to send</p>}
        </div>
      )}

      {/* Preview */}
      {step === "preview" && derived && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 p-4 space-y-3">
            <p className="text-xs text-white/40 uppercase tracking-wider">Privacy Preview</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Stealth address</span>
                <span className="font-mono text-green-400 text-xs">{derived.stealthAddress.slice(0,12)}…{derived.stealthAddress.slice(-6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Amount</span>
                <span className="text-white font-semibold">{amount} {CHAINS[chain]?.symbol || "ETH"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Chain</span>
                <span className="text-white capitalize">{chain}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">View tag</span>
                <span className="font-mono text-white/60 text-xs">{derived.viewTag}</span>
              </div>
            </div>
          </div>
          <div className="bg-green-400/5 border border-green-400/15 p-3">
            <p className="text-xs text-green-300/80">
              A unique stealth address has been derived from the recipient's public keys. 
              ETH will land at this address — only the recipient's view key can identify it as theirs.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="flex-1 py-2.5 border border-white/20 text-sm hover:border-white/50 transition-colors">
              Back
            </button>
            <button
              data-testid="stealth-send-btn"
              onClick={send}
              disabled={loading}
              className="flex-1 py-2.5 bg-green-400 text-black font-bold text-sm hover:bg-green-300 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Send Privately
            </button>
          </div>
        </div>
      )}

      {/* Sending */}
      {step === "sending" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="w-8 h-8 animate-spin text-green-400" />
          <p className="text-sm text-white/60">Broadcasting to {chain}…</p>
          <p className="text-xs text-white/30">Confirm in MetaMask</p>
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-12 h-12 bg-green-400/10 border border-green-400/30 flex items-center justify-center">
              <Check className="w-6 h-6 text-green-400" />
            </div>
            <p className="font-semibold text-white">Private Transfer Complete</p>
            <p className="text-xs text-white/40 text-center">
              {amount} {CHAINS[chain]?.symbol || "ETH"} sent to stealth address.<br />
              Announcement posted — recipient can scan to claim.
            </p>
          </div>
          {txHash && (
            <a
              href={`${EXPLORERS[chain] || ""}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 py-2 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View on explorer
            </a>
          )}
          <button onClick={reset} className="w-full py-2.5 border border-white/20 text-sm hover:border-white/50 transition-colors">
            Send Another
          </button>
        </div>
      )}
    </div>
  );
}
