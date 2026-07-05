import { useState } from "react";
import axios from "axios";
import { Receipt, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";

/**
 * Encrypted Receipts — list receipt PDAs owned by an address.
 *
 * Mirrors the Sui version. Enter an owner address, hit Fetch, get back the
 * list of receipt accounts. Each carries an opaque ciphertext + nonce the
 * recipient decrypts off-chain with their stealth private key. If the
 * Solana program isn't deployed yet, the backend returns 503.
 */
export function SolReceipts() {
  const [owner, setOwner] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notLive, setNotLive] = useState(false);

  const fetchReceipts = async () => {
    if (!owner) return toast.error("Enter an owner address");
    setLoading(true);
    setNotLive(false);
    setData(null);
    try {
      const res = await axios.get(`${API}/sol/receipts/${owner}`);
      setData(res.data);
    } catch (e) {
      if (e.response?.status === 503) {
        setNotLive(true);
      } else {
        toast.error(e.response?.data?.detail?.slice(0, 100) || "Fetch failed");
      }
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4" data-testid="sol-receipts">
      <div className="flex gap-2">
        <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="base58 owner address"
          className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-xs outline-none focus:border-white" />
        <button onClick={fetchReceipts} disabled={loading || !owner}
          className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Fetch
        </button>
      </div>

      {notLive && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300">
          Program not yet live. Receipts will populate automatically once deployed.
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 text-center">
            <div className="text-[10px] text-white/40 uppercase">Receipts for this owner</div>
            <div className="font-mono text-2xl text-purple-400">{data.count}</div>
          </div>

          {(!data.receipts || data.receipts.length === 0) ? (
            <div className="text-center text-white/40 text-sm py-8 flex flex-col items-center gap-2">
              <Receipt className="w-8 h-8 opacity-40" />
              No receipts yet
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {data.receipts.map((r, i) => (
                <div key={r.pubkey || r.object_id || i} className="bg-white/5 border border-white/10 p-2 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-white/40">account</span>
                    <span className="font-mono text-purple-300 break-all">{(r.pubkey || r.object_id || "").slice(0, 20)}…</span>
                  </div>
                  {r.announcement_id != null && (
                    <div className="flex justify-between"><span className="text-white/40">announcement</span><span className="font-mono">#{r.announcement_id}</span></div>
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
