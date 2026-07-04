import { useEffect, useState } from "react";
import axios from "axios";
import { ScanLine, Loader2 } from "lucide-react";
import { API } from "@/config/chains";

// Solana Announcement Scanner — Deployed On panel.
//
// Per the design rule, the chain name is shown ONLY on the Dashboard
// home (the chain-select pill row). Inside this feature we render
// ONLY the live "Deployed on" data block — no chain identity chrome.
export function SolScanner() {
  const [loading, setLoading] = useState(true);
  const [sol, setSol] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data } = await axios.get(`${API}/sol/status`);
        if (!cancelled) setSol(data || null);
      } catch {
        if (!cancelled) setSol(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  return (
    <div className="space-y-4" data-testid="sol-scanner">
      <div className="bg-white/5 border border-white/10 p-4 text-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-white/60 uppercase tracking-wider text-xs">Deployed on</span>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="text-xs text-white/50 hover:text-white underline"
            disabled={loading}
          >
            refresh
          </button>
        </div>
        {loading ? (
          <div className="text-white/60 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> loading...
          </div>
        ) : sol?.live ? (
          <div className="space-y-1 font-mono text-xs break-all">
            <div><span className="text-white/40">program</span> {sol.program_id}</div>
          </div>
        ) : (
          <div className="text-yellow-300 text-xs">
            Program not deployed — see /api/sol/status. PoC UI; full form
            behind audit gate.
          </div>
        )}
      </div>
    </div>
  );
}
