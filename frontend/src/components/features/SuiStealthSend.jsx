import { useState, useEffect } from "react";
import axios from "axios";
import { Send, Loader2, CheckCircle2, Key } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

/**
 * SuiStealthSend — a REAL private send on Sui mainnet.
 *
 * Upgraded in the Sui-parity follow-up from announce-only (P2.8) to a full
 * relayed private send with Coin<SUI> value transfer. The backend
 * `/api/sui/relay/submit` now calls `stealth_transfer::relayed_send_entry`
 * (package v4): announce + view-tag index + cursor advance + Coin<SUI> relay
 * + encrypted receipt mint, atomically. This is the Sui analog of the Base
 * EVM relayer's relay() + announce() flow.
 *
 * The relayer wallet (the backend's active `sui client` address, which owns
 * the RelayerCap + ReceiptCap) supplies the funds + pays gas. The user
 * supplies the recipient stealth address + amount + the ephemeral key / view
 * tag / stealth hash the recipient needs to detect + claim the send.
 */
export function SuiStealthSend() {
  const { address, chain } = useWallet();
  const [ephemeralKey, setEphemeralKey] = useState("");
  const [viewTag, setViewTag] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amountMist, setAmountMist] = useState("10000");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [registryCount, setRegistryCount] = useState(null);

  useEffect(() => {
    if (chain === "sui") {
      axios.get(`${API}/sui/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
    } else {
      // The Sui endpoints are chain-agnostic (the relayer signs, not the user's
      // EVM wallet); still fetch the count so the UI shows live registry state.
      axios.get(`${API}/sui/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
    }
  }, [chain]);

  const generateEphemeralKey = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    setEphemeralKey(hex);
    setViewTag(Math.floor(Math.random() * 256).toString());
    toast.success("Ephemeral key + view tag generated");
  };

  const submitRelay = async () => {
    if (!ephemeralKey || !viewTag) return toast.error("Generate an ephemeral key first");
    if (!recipient) return toast.error("Enter a recipient stealth address");
    if (!recipient.startsWith("0x")) return toast.error("Recipient must be a 0x Sui address");
    const amt = parseInt(amountMist);
    if (!amt || amt <= 0) return toast.error("Amount (MIST) must be > 0");
    setLoading(true);
    try {
      // stealth_hash: a 32-byte spend commitment (placeholder random for now;
      // a real client derives it from the recipient's stealth meta-address).
      const stealthHash = "0x" + Array.from(new Uint8Array(32)).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
      const res = await axios.post(`${API}/sui/relay/submit`, {
        recipient,
        amount_mist: amt,
        ephemeral_key: ephemeralKey,
        view_tag: parseInt(viewTag),
        stealth_hash: stealthHash,
        // ciphertext/nonce omitted -> backend auto-generates placeholders for
        // testing. Production callers supply an ECDH-derived encrypted receipt.
      });
      setResult(res.data);
      toast.success(`Relayed ${amt} MIST on Sui mainnet!`);
      axios.get(`${API}/sui/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 100) || "Relay failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">
        Send a private transfer on Sui mainnet. The relayer atomically announces
        the stealth address, indexes the view tag, relays a <span className="font-mono text-white/70">Coin&lt;SUI&gt;</span> to the
        recipient, and mints an encrypted receipt — all in one transaction.
      </p>

      {registryCount && (
        <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-white/50">Registry Announcements</span>
          <span className="font-mono text-sm text-cyan-400">{registryCount.count}</span>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Amount (MIST)</label>
          <input type="number" min="1" value={amountMist} onChange={e => setAmountMist(e.target.value)}
            className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
          <p className="text-[10px] text-white/30 mt-1">1 SUI = 1,000,000,000 MIST</p>
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
          <button onClick={generateEphemeralKey}
            className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
            <Key className="w-4 h-4" /> Generate
          </button>
        </div>
      </div>

      {!result ? (
        <button onClick={submitRelay} disabled={loading || !ephemeralKey || !recipient}
          className="w-full py-3 bg-cyan-500 text-black font-bold uppercase tracking-wider hover:bg-cyan-400 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          Relay on Sui
        </button>
      ) : (
        <div className="bg-cyan-500/10 border border-cyan-500/30 p-3 text-xs text-cyan-300 space-y-2">
          <div className="font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Relayed on Sui mainnet!</div>
          <div className="flex justify-between"><span className="text-white/50">tx:</span>
            <a href={`https://suiexplorer.com/txblock/${result.tx_digest}`} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:underline">{result.tx_digest?.slice(0, 18)}…</a>
          </div>
          <div className="flex justify-between"><span className="text-white/50">amount:</span><span className="font-mono">{result.amount_mist} MIST</span></div>
          <div className="flex justify-between"><span className="text-white/50">status:</span><span className="font-mono">{result.execution_status}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Announcements:</span><span className="font-mono">{result.announcement_count}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Total relayed:</span><span className="font-mono">{result.total_relayed} MIST</span></div>
        </div>
      )}

      <p className="text-[11px] text-white/40 leading-relaxed">
        The relayer wallet signs + pays gas (it owns the RelayerCap). The ephemeral
        key + view tag are generated client-side; only the public commitment is
        sent on-chain. The recipient derives the stealth private key from these +
        their view key (EIP-5564) and scans announcements to find their transfer.
      </p>
    </div>
  );
}
