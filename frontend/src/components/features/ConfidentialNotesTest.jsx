/**
 * ConfidentialNotesTest — STANDALONE test component for P6.
 *
 * NOT merged into SendContent or any dashboard tile. This exists
 * so the technology can be tested independently before the user
 * says "merge it".
 *
 * To access: navigate to #/notes-test (not linked from dashboard).
 *
 * Tests:
 *   1. Read note state from the contract
 *   2. Generate a ZK proof in-browser
 *   3. Submit createNote() via the relayer
 *   4. Scan NoteCreated events
 */
import { useState, useEffect } from "react";
import { Loader2, Lock, CheckCircle2, Eye } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { createHiddenNote, scanNotes, NOTES_ADDR } from "@/lib/confidential-notes";

export function ConfidentialNotesTest() {
  const { address } = useWallet();
  const [amount, setAmount] = useState("0.01");
  const [recipientViewKey, setRecipientViewKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [notes, setNotes] = useState([]);
  const [state, setState] = useState(null);

  // Read contract state on mount
  useEffect(() => {
    fetchState();
  }, []);

  const fetchState = async () => {
    try {
      const axios = (await import("axios")).default;
      const res = await axios.get(`${API}/confidential/note-state`);
      setState(res.data);
    } catch (e) {
      toast.error("Could not read note state");
    }
  };

  const handleCreateNote = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!amount || !recipientViewKey) return toast.error("Enter amount + recipient view key");
    setLoading(true);
    try {
      const archive = JSON.parse(localStorage.getItem(`upl:stealth-archive:${address.toLowerCase()}`) || "[]");
      if (!archive.length) return toast.error("No stealth in archive");

      const res = await createHiddenNote({
        amount,
        recipientViewKey,
        senderStealthPrivateKey: archive[0].privateKey,
        apiBase: API,
      });
      setResult(res);
      toast.success("Note created on-chain — amount hidden!");
      fetchState();
      handleScan();
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 120) || e.message?.slice(0, 120) || "Failed";
      toast.error(msg);
    }
    setLoading(false);
  };

  const handleScan = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const found = await scanNotes(address);
      setNotes(found);
    } catch (e) {
      toast.error("Scan failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        P6 Confidential Notes — STANDALONE TEST (not merged into Send)
      </div>

      {/* Contract state */}
      {state && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="font-semibold text-white/70">Contract State</div>
          <div>Root: <span className="font-mono text-white/50">{state.current_root?.slice(0, 18)}…</span></div>
          <div>Next leaf: <span className="font-mono text-white/50">{state.next_leaf_index}</span></div>
          <div>Contract: <span className="font-mono text-white/50">{NOTES_ADDR.slice(0, 18)}…</span></div>
        </div>
      )}

      {/* Create note form */}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount (USDC)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="0.01"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient View Key (hex)</label>
        <input value={recipientViewKey} onChange={(e) => setRecipientViewKey(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button onClick={handleCreateNote} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
        Create Hidden Note
      </button>

      {/* Result */}
      {result && (
        <div className="bg-green-500/5 border border-green-500/20 p-3 space-y-1 text-xs">
          <div className="flex items-center gap-1 text-green-400 font-semibold">
            <CheckCircle2 className="w-4 h-4" /> Note Created
          </div>
          <div>Tx: <span className="font-mono text-white/50">{result.noteTxHash?.slice(0, 18)}…</span></div>
          <div>Commitment: <span className="font-mono text-white/50">{result.commitment?.slice(0, 18)}…</span></div>
          <div>Encrypted Amount: <span className="font-mono text-white/50">{result.encryptedAmount?.slice(0, 18)}…</span></div>
          <div className="text-green-400/70 text-[10px] mt-1">
            Zero USDC moved on-chain. Amount is hidden. Only hashes recorded.
          </div>
        </div>
      )}

      {/* Scan results */}
      <div className="pt-4 border-t border-white/10">
        <button onClick={handleScan} disabled={loading}
          className="text-xs text-white/60 hover:text-white flex items-center gap-1">
          <Eye className="w-3 h-3" /> Scan Notes
        </button>
        {notes.length > 0 && (
          <div className="mt-2 space-y-2">
            {notes.map((n, i) => (
              <div key={i} className="bg-white/5 border border-white/10 p-2 text-xs">
                <div className="font-mono text-white/50">Commitment: {n.commitment?.slice(0, 18)}…</div>
                <div className="font-mono text-white/30">Block: {n.blockNumber}</div>
                {n.isMine && <div className="text-green-400 text-[10px]">Possibly mine</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
