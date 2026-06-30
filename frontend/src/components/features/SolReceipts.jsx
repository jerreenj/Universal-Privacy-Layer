import { useState } from "react";
import axios from "axios";
import { Receipt, Loader2 } from "lucide-react";
import { API } from "@/config/chains";

/**
 * SolReceipts — encrypted receipt viewer for Solana.
 * Mirrors SuiReceipts. Calls GET /api/sol/receipts/{owner} with an
 * auth token to list PrivacyReceipt PDA accounts owned by an address.
 */
export function SolReceipts() {
  const [owner, setOwner] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReceipts = async () => {
    if (!owner) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/sol/receipts/${owner}`, {
        headers: { Authorization: `Bearer ${localStorage.upl_token}` },
      });
      setData(res.data);
    } catch (e) {
      setData(null);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">
        View encrypted delivery receipts on Solana. PrivacyReceipt PDA accounts
        are owned by the recipient and contain the encrypted payload the
        recipient decrypts with their view key.
      </p>

      <div className="flex gap-2">
        <input value={owner} onChange={e => setOwner(e.target.value)}
          placeholder="Owner address (base58)..."
          className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
        <button onClick={fetchReceipts} disabled={loading || !owner}
          className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          Fetch
        </button>
      </div>

      {data && (
        <div className="space-y-2">
          <div className="text-xs text-white/50">Found {data.count} receipts for {data.owner?.slice(0, 12)}…</div>
          {data.receipts.map((r, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Receipt #{r.id}</span>
                <span className="font-mono text-purple-300">{r.object_id?.slice(0, 18)}…</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Announcement:</span>
                <span className="font-mono text-white/70">#{r.announcement_id}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Ciphertext:</span>
                <span className="font-mono text-white/70">{r.ciphertext_len} bytes</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
