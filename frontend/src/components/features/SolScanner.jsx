import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { ScanLine, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";

/**
 * Announcement Scanner — reads recent stealth-address announcements.
 *
 * Same UX as the Sui scanner: enter limit + after_id, hit Re-scan, get
 * the live id range + count. The recipient's wallet filters by view tag
 * client-side (EIP-5564). If the Solana program isn't deployed yet, the
 * backend returns 503 and we surface a friendly notice.
 */
export function SolScanner() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState("50");
  const [afterId, setAfterId] = useState("0");
  const [notLive, setNotLive] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    setNotLive(false);
    try {
      const res = await axios.get(`${API}/sol/announcements`, {
        params: { limit: parseInt(limit) || 50, after_id: parseInt(afterId) || 0 },
      });
      setData(res.data);
    } catch (e) {
      if (e.response?.status === 503) {
        setNotLive(true);
      } else {
        toast.error(e.response?.data?.detail?.slice(0, 100) || "Scan failed");
      }
    }
    setLoading(false);
  }, [limit, afterId]);

  useEffect(() => { scan(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4" data-testid="sol-scanner">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 uppercase mb-2">Limit</label>
          <input type="number" min="1" max="100" value={limit} onChange={e => setLimit(e.target.value)}
            className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 uppercase mb-2">After id</label>
          <input type="number" min="0" value={afterId} onChange={e => setAfterId(e.target.value)}
            className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
        </div>
        <button onClick={scan} disabled={loading}
          className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Re-scan
        </button>
      </div>

      {notLive && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300">
          Program not yet live. The scanner will populate automatically once deployed.
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-white/40 uppercase">Total</div>
              <div className="font-mono text-sm text-purple-400">{data.next_id ?? data.count}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/40 uppercase">Showing</div>
              <div className="font-mono text-sm text-purple-400">{data.count}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/40 uppercase">From id</div>
              <div className="font-mono text-sm text-purple-400">{data.after_id ?? 0}</div>
            </div>
          </div>

          {(!data.announcements || data.announcements.length === 0) ? (
            <div className="text-center text-white/40 text-sm py-8 flex flex-col items-center gap-2">
              <ScanLine className="w-8 h-8 opacity-40" />
              No announcements in this range
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {data.announcements.map((a, i) => (
                <div key={a.id ?? i} className="bg-white/5 border border-white/10 p-2 flex items-center justify-between text-xs">
                  <span className="text-white/50">announcement #{a.id ?? i}</span>
                  <span className="font-mono text-purple-300">{a.pubkey ? a.pubkey.slice(0, 16) + "…" : ""}</span>
                </div>
              ))}
            </div>
          )}
          {data.note && <p className="text-[11px] text-white/40 leading-relaxed">{data.note}</p>}
        </div>
      )}
    </div>
  );
}
