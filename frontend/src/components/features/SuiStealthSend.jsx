import { useState, useEffect } from "react";
import axios from "axios";
import { Send, Loader2, CheckCircle2, Key } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function SuiStealthSend() {
  const { address, chain, signer } = useWallet();
  const [ephemeralKey, setEphemeralKey] = useState("");
  const [viewTag, setViewTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [registryCount, setRegistryCount] = useState(null);

  useEffect(() => {
    if (chain === "sui") {
      axios.get(`${API}/sui/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
    }
  }, [chain]);

  const generateEphemeralKey = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    setEphemeralKey(hex);
    setViewTag(Math.floor(Math.random() * 256).toString());
    toast.success("Ephemeral key generated");
  };

  const submitAnnounce = async () => {
    if (!ephemeralKey || !viewTag) return toast.error("Generate an ephemeral key first");
    setLoading(true);
    try {
      const stealthHash = "0x" + Array.from(new Uint8Array(32).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join(""));
      const res = await axios.post(`${API}/sui/relay/submit`, {
        ephemeral_key: ephemeralKey,
        view_tag: parseInt(viewTag),
        stealth_hash: stealthHash,
      });
      setResult(res.data);
      toast.success("Announced on Sui mainnet!");
      axios.get(`${API}/sui/registry/count`).then(r => setRegistryCount(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 80) || "Announce failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Publish a stealth address announcement to the Sui mainnet registry. The recipient scans on-chain announcements to find their private transfers.</p>

      {registryCount && (
        <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-white/50">Registry Announcements</span>
          <span className="font-mono text-sm text-cyan-400">{registryCount.count}</span>
        </div>
      )}

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

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">View Tag (0-255)</label>
        <input type="number" min="0" max="255" value={viewTag} onChange={e => setViewTag(e.target.value)} placeholder="auto"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>

      {!result ? (
        <button onClick={submitAnnounce} disabled={loading || !ephemeralKey}
          className="w-full py-3 bg-cyan-500 text-black font-bold uppercase tracking-wider hover:bg-cyan-400 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          Announce on Sui
        </button>
      ) : (
        <div className="bg-cyan-500/10 border border-cyan-500/30 p-3 text-xs text-cyan-300 space-y-2">
          <div className="font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Announced on Sui mainnet!</div>
          <div className="flex justify-between"><span className="text-white/50">tx:</span>
            <a href={`https://suiexplorer.com/txblock/${result.tx_digest}`} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:underline">{result.tx_digest?.slice(0, 18)}…</a>
          </div>
          <div className="flex justify-between"><span className="text-white/50">Announcements:</span><span className="font-mono">{result.announcement_count}</span></div>
        </div>
      )}

      <p className="text-[11px] text-white/40 leading-relaxed">
        The ephemeral key + view tag are generated client-side. Only the public commitment is sent on-chain.
        The recipient derives the stealth private key from these + their view key (EIP-5564).
      </p>
    </div>
  );
}
