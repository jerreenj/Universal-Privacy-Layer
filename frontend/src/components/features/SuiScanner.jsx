import { useState, useEffect } from "react";
import axios from "axios";
import { ScanLine, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";

/**
 * SuiScanner — a recipient-side scanner for Sui stealth-address announcements.
 *
 * The Sui analog of the EVM frontend scanner. Reads `/api/sui/announcements`
 * (the live id range + count from the shared Registry) so a recipient can see
 * how many announcements exist and fetch their ids. The recipient's wallet
 * filters by view tag client-side (EIP-5564): for each announcement whose view
 * tag matches a derived candidate, the wallet attempts to derive the stealth
 * private key and checks whether the spend commitment matches — a match means
 * the announcement is for them.
 *
 * Per-record reads (ephemeral_pub_key / view_tag / stealth_hash) are fetched
 * via the event stream or per-id dynamic-field reads; this surface shows the
 * live id range + count, which is what the scanner polls to detect new
 * announcements addressed to the recipient.
 */
export function SuiScanner() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState("50");

  const scan = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/sui/announcements`, {
        params: { limit: parseInt(limit) || 50 },
      });
      setData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 100) || "Scan failed");
    }
    setLoading(false);
  };

  useEffect(() => { scan(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">
        Scan the Sui mainnet stealth-address registry for announcements. Your
        wallet filters by view tag (EIP-5564) and attempts to derive the stealth
        key for each match — a derived key whose spend commitment matches means
        the announcement is for you.
      </p>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 uppercase mb-2">Limit</label>
          <input type="number" min="1" max="100" value={limit} onChange={e => setLimit(e.target.value)}
            className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
        </div>
        <button onClick={scan} disabled={loading}
          className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Re-scan
        </button>
      </div>

      {data && (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-white/40 uppercase">Total</div>
              <div className="font-mono text-sm text-cyan-400">{data.next_id}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/40 uppercase">Showing</div>
              <div className="font-mono text-sm text-cyan-400">{data.count}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/40 uppercase">From id</div>
              <div className="font-mono text-sm text-cyan-400">{data.after_id}</div>
            </div>
          </div>

          {data.announcements.length === 0 ? (
            <div className="text-center text-white/40 text-sm py-8 flex flex-col items-center gap-2">
              <ScanLine className="w-8 h-8 opacity-40" />
              No announcements in this range
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {data.announcements.map(a => (
                <div key={a.id} className="bg-white/5 border border-white/10 p-2 flex items-center justify-between text-xs">
                  <span className="text-white/50">announcement #</span>
                  <span className="font-mono text-cyan-300">{a.id}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-white/40 leading-relaxed">{data.note}</p>
        </div>
      )}
    </div>
  );
}
