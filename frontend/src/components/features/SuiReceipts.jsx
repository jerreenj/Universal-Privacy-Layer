import { useState } from "react";
import axios from "axios";
import { Receipt, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";

/**
 * SuiReceipts — view the on-chain encrypted receipts (PrivacyReceipt objects)
 * owned by a Sui address.
 *
 * The Sui analog of the EVM encrypted-receipts log. Each private send mints a
 * `privacy_receipt::PrivacyReceipt` owned object to the recipient (via
 * `stealth_transfer::relayed_send_entry`), carrying an opaque ciphertext +
 * nonce the recipient decrypts off-chain with their stealth private key. This
 * component lists the receipts an address owns via `/api/sui/receipts/{owner}`
 * (which reads `suix_getOwnedObjects` filtered to the PrivacyReceipt type).
 *
 * Auth-gated on the backend (the path has a variable owner segment, so it is
 * not in PUBLIC_PATHS; the caller must present a session token).
 */
export function SuiReceipts() {
  const [owner, setOwner] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReceipts = async () => {
    if (!owner || !owner.startsWith("0x")) return toast.error("Enter a 0x Sui address");
    setLoading(true);
    try {
      const token = localStorage.getItem("upl_token");
      const res = await axios.get(`${API}/sui/receipts/${owner}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setData(res.data);
    } catch (e) {
      const detail = e.response?.data?.detail?.slice(0, 120) || "Fetch failed";
      toast.error(detail);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">
        View the on-chain encrypted receipts (PrivacyReceipt objects) owned by a
        Sui address. Each receipt carries an opaque ciphertext the recipient
        decrypts off-chain with their stealth private key.
      </p>

      <div className="flex gap-2">
        <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="0x... (your Sui address)"
          className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
        <button onClick={fetchReceipts} disabled={loading}
          className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Fetch
        </button>
      </div>

      {data && (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
            <span className="text-xs text-white/50">Receipts owned</span>
            <span className="font-mono text-sm text-cyan-400">{data.count}</span>
          </div>

          {data.receipts.length === 0 ? (
            <div className="text-center text-white/40 text-sm py-8 flex flex-col items-center gap-2">
              <Receipt className="w-8 h-8 opacity-40" />
              No receipts for this address
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.receipts.map((r, i) => (
                <div key={r.object_id || i} className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-white/50">object:</span>
                    <span className="font-mono text-cyan-300">{r.object_id?.slice(0, 18)}…</span>
                  </div>
                  {r.announcement_id != null && (
                    <div className="flex justify-between"><span className="text-white/50">announcement:</span>
                      <span className="font-mono">#{r.announcement_id}</span>
                    </div>
                  )}
                  {r.timestamp_ms != null && (
                    <div className="flex justify-between"><span className="text-white/50">time:</span>
                      <span className="font-mono">{new Date(r.timestamp_ms).toISOString().slice(0, 19)}</span>
                    </div>
                  )}
                  {r.ciphertext_len != null && (
                    <div className="flex justify-between"><span className="text-white/50">ciphertext:</span>
                      <span className="font-mono">{r.ciphertext_len} B</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
