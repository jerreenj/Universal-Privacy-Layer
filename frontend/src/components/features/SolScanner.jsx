import { useState, useEffect } from "react";
import axios from "axios";
import { ScanLine, Loader2 } from "lucide-react";
import { API } from "@/config/chains";
import { SolDevnetBadge } from "@/components/common/SolDevnetBadge";

/**
 * SolScanner — announcement scanner for Solana.
 * Mirrors SuiScanner. Calls GET /api/sol/announcements to show the
 * announcement id range the recipient scanner surface can iterate.
 */
export function SolScanner() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState("50");

  const scan = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/sol/announcements`, {
        params: { limit: parseInt(limit) || 50 },
      });
      setData(res.data);
    } catch (e) {
      setData(null);
    }
    setLoading(false);
  };

  useEffect(() => { scan(); }, []);

  return (
    <div className="space-y-4">
      <SolDevnetBadge />
      <p className="text-sm text-white/50">
        Scan Solana stealth address announcements. The registry tracks all
        announcements by id; the recipient's client iterates these + uses the
        ephemeral pubkey + view tag to detect transfers it can claim (EIP-5564).
      </p>

      <div className="flex gap-2">
        <input type="number" min="1" max="100" value={limit} onChange={e => setLimit(e.target.value)}
          className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
          placeholder="limit (1-100)" />
        <button onClick={scan} disabled={loading}
          className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          Re-scan
        </button>
      </div>

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/5 border border-white/10 p-3 text-center">
              <div className="text-xs text-white/40">Total</div>
              <div className="font-mono text-lg text-purple-400">{data.next_id}</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-3 text-center">
              <div className="text-xs text-white/40">Showing</div>
              <div className="font-mono text-lg text-purple-400">{data.count}</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-3 text-center">
              <div className="text-xs text-white/40">From id</div>
              <div className="font-mono text-lg text-purple-400">{data.after_id}</div>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {data.announcements.map(a => (
              <div key={a.id} className="bg-white/5 border border-white/10 p-2 font-mono text-xs text-white/60">
                announcement #{a.id}
              </div>
            ))}
          </div>
          {data.note && <p className="text-[11px] text-white/30 italic">{data.note}</p>}
        </div>
      )}
    </div>
  );
}
