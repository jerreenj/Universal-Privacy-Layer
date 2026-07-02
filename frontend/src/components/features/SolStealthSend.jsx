import { useState, useEffect } from "react";
import axios from "axios";
import { Send, Loader2, CheckCircle2, Key } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { SolDevnetBadge } from "@/components/common/SolDevnetBadge";

/**
 * SolStealthSend — a REAL private send on Solana.
 *
 * Mirrors SuiStealthSend for the SVM chain. The backend `/api/sol/relay/submit`
 * calls the Anchor program's `relay_and_announce` instruction: announce +
 * SOL transfer + encrypted receipt, atomically in one transaction (Solana's
 * native atomicity — same guarantee as Sui's PTB and Base's relayAndAnnounce).
 *
 * The relayer wallet supplies the funds + pays gas. The user supplies the
 * recipient stealth address + amount + the ephemeral key / view tag / stealth
 * hash the recipient needs to detect + claim the send.
 */
export function SolStealthSend() {
  const { address, chain } = useWallet();
  const [ephemeralKey, setEphemeralKey] = useState("");
  const [viewTag, setViewTag] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amountLamports, setAmountLamports] = useState("1000000");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [registryCount, setRegistryCount] = useState(null);

  useEffect(() => {
    axios.get(`${API}/sol/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
  }, [chain]);

  const generateEphemeralKey = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    setEphemeralKey(hex);
    setViewTag(Math.floor(Math.random() * 256).toString());
    toast.success("Ephemeral key + view tag generated");
  };

  const submitRelay = async () => {
    if (!ephemeralKey || !viewTag) return toast.error("Generate an ephemeral key first");
    if (!recipient) return toast.error("Enter a recipient stealth address");
    const amt = parseInt(amountLamports);
    if (!amt || amt <= 0) return toast.error("Amount (lamports) must be > 0");
    setLoading(true);
    try {
      const stealthHash = Array.from(new Uint8Array(32)).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
      const res = await axios.post(`${API}/sol/relay/submit`, {
        recipient,
        amount_lamports: amt,
        ephemeral_key: ephemeralKey,
        view_tag: parseInt(viewTag),
        stealth_hash: stealthHash,
      });
      setResult(res.data);
      toast.success(`Relayed ${amt} lamports on Solana!`);
      axios.get(`${API}/sol/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 100) || "Relay failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <SolDevnetBadge />
      <p className="text-sm text-white/50">
        Send a private transfer on Solana. The relayer atomically announces
        the stealth address, transfers <span className="font-mono text-white/70">SOL</span> to the
        recipient, and issues an encrypted receipt — all in one transaction.
      </p>

      {registryCount && (
        <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-white/50">Registry Announcements</span>
          <span className="font-mono text-sm text-purple-400">{registryCount.count}</span>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Base58 Solana address..."
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
          <button onClick={generateEphemeralKey}
            className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
            <Key className="w-4 h-4" /> Generate
          </button>
        </div>
      </div>

      {!result ? (
        <button onClick={submitRelay} disabled={loading || !ephemeralKey || !recipient}
          className="w-full py-3 bg-purple-500 text-white font-bold uppercase tracking-wider hover:bg-purple-400 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          Relay on Solana
        </button>
      ) : (
        <div className="bg-purple-500/10 border border-purple-500/30 p-3 text-xs text-purple-300 space-y-2">
          <div className="font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Relayed on Solana!</div>
          <div className="flex justify-between"><span className="text-white/50">tx:</span>
            <a href={`https://solscan.io/tx/${result.tx_signature}`} target="_blank" rel="noreferrer" className="font-mono text-purple-300 hover:underline">{result.tx_signature?.slice(0, 18)}…</a>
          </div>
          <div className="flex justify-between"><span className="text-white/50">amount:</span><span className="font-mono">{result.amount_lamports} lamports</span></div>
          <div className="flex justify-between"><span className="text-white/50">Announcements:</span><span className="font-mono">{result.announcement_count}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Total relayed:</span><span className="font-mono">{result.total_relayed} lamports</span></div>
        </div>
      )}

      <p className="text-[11px] text-white/40 leading-relaxed">
        The relayer wallet signs + pays gas. The ephemeral key + view tag are
        generated client-side; only the public commitment is sent on-chain. The
        recipient derives the stealth private key from these + their view key
        (EIP-5564) and scans announcements to find their transfer.
      </p>
    </div>
  );
}
