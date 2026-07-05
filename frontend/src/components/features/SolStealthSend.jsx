import { useState } from "react";
import axios from "axios";
import { Send, Loader2, CheckCircle2, Key, Shield, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";

/**
 * Stealth Send — relayer-backed private send on Solana.
 *
 * Same UX as the Sui panel: user enters (or auto-generates) ephemeral keys
 * + recipient + amount (lamports) → POST /sol/relay/submit. The backend's
 * relayer (which owns the on-chain RelayerCap) announces the stealth
 * address, indexes the view tag, relays lamports to the recipient, and
 * mints the encrypted receipt atomically.
 *
 * If the Solana program is not yet deployed, the backend returns 503 and
 * we surface a friendly "not yet live" notice — the form stays interactive
 * so the user can see exactly what the flow WILL be once deployed.
 */
const HEX = () => "0x" + Array.from(new Uint8Array(32)).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");

export function SolStealthSend() {
  const [ephemeralKey, setEphemeralKey] = useState("");
  const [viewTag, setViewTag] = useState("");
  const [stealthHash, setStealthHash] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amountLamports, setAmountLamports] = useState("10000");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [notLive, setNotLive] = useState(false);

  const generateKeys = () => {
    setEphemeralKey(HEX());
    setStealthHash(HEX());
    setViewTag(Math.floor(Math.random() * 256).toString());
    toast.success("Ephemeral key + view tag + stealth hash generated");
  };

  const submit = async () => {
    if (!ephemeralKey || !viewTag) return toast.error("Generate ephemeral keys first");
    if (!stealthHash) return toast.error("Missing stealth hash");
    if (!recipient) return toast.error("Enter a recipient stealth address");
    const amt = parseInt(amountLamports);
    if (!amt || amt <= 0) return toast.error("Amount must be > 0");
    setLoading(true);
    setNotLive(false);
    try {
      const res = await axios.post(`${API}/sol/relay/submit`, {
        recipient,
        amount_lamports: amt,
        ephemeral_key: ephemeralKey,
        view_tag: parseInt(viewTag),
        stealth_hash: stealthHash,
      });
      setResult(res.data);
      toast.success(`Relayed ${amt} lamports privately!`);
    } catch (e) {
      if (e.response?.status === 503) {
        setNotLive(true);
        toast.error("Solana program not yet deployed — try again after launch");
      } else {
        const detail = e.response?.data?.detail;
        toast.error((typeof detail === "string" ? detail : JSON.stringify(detail || "Relay failed")).slice(0, 120));
      }
    }
    setLoading(false);
  };

  const reset = () => {
    setResult(null);
    setRecipient(""); setAmountLamports("10000");
  };

  return (
    <div className="space-y-4" data-testid="sol-stealth-send">
      <div className="bg-purple-500/10 border border-purple-500/30 p-3 text-xs text-purple-300 flex items-start gap-2">
        <Shield className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold mb-1">Relayed Private Send</div>
          The relayer wallet announces the stealth address, indexes the view tag, relays lamports, and mints an encrypted receipt — all atomically. The relayer signs + pays gas; you only supply the commitment.
        </div>
      </div>

      {notLive && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Solana program not yet live</div>
            The on-chain program isn't deployed yet. The form below shows the exact flow that will work once it's live. Check /api/sol/status for deployment state.
          </div>
        </div>
      )}

      {!result ? (
        <>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
            <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="base58 address..."
              className="w-full bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-2">Amount (lamports)</label>
              <input type="number" min="1" value={amountLamports} onChange={e => setAmountLamports(e.target.value)}
                className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
              <p className="text-[10px] text-white/30 mt-1">1 SOL = 1,000,000,000 lamports</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-2">View Tag (0-255)</label>
              <input type="number" min="0" max="255" value={viewTag} onChange={e => setViewTag(e.target.value)} placeholder="auto"
                className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Ephemeral Public Key</label>
            <div className="flex gap-2">
              <input value={ephemeralKey} readOnly placeholder="Click generate..."
                className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
              <button onClick={generateKeys}
                className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
                <Key className="w-4 h-4" /> Generate
              </button>
            </div>
            {stealthHash && (
              <p className="text-[10px] text-white/30 mt-1 font-mono break-all">stealth_hash: {stealthHash.slice(0, 40)}…</p>
            )}
          </div>

          <button onClick={submit} disabled={loading || !ephemeralKey || !recipient}
            className="w-full py-3 bg-purple-500 text-white font-bold uppercase tracking-wider hover:bg-purple-400 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            Relay Private Send
          </button>
        </>
      ) : (
        <div className="bg-purple-500/10 border border-purple-500/30 p-4 text-xs text-purple-300 space-y-2">
          <div className="font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Relayed successfully!</div>
          {result.tx_signature && (
            <div className="flex justify-between">
              <span className="text-white/50">tx:</span>
              <a href={`https://solscan.io/tx/${result.tx_signature}`} target="_blank" rel="noreferrer" className="font-mono text-purple-300 hover:underline">{result.tx_signature.slice(0, 18)}…</a>
            </div>
          )}
          {result.amount_lamports != null && <div className="flex justify-between"><span className="text-white/50">amount:</span><span className="font-mono">{result.amount_lamports} lamports</span></div>}
          {result.status && <div className="flex justify-between"><span className="text-white/50">status:</span><span className="font-mono">{result.status}</span></div>}
          <button onClick={reset} className="w-full mt-3 py-2 border border-white/20 text-white/60 text-sm hover:bg-white/5">Send Another</button>
        </div>
      )}

      <p className="text-[11px] text-white/40 leading-relaxed">
        The ephemeral key + view tag + stealth hash are generated client-side; only the public commitment is sent on-chain. The recipient derives the stealth private key from these + their view key (EIP-5564) and scans announcements to detect this transfer.
      </p>
    </div>
  );
}
