import { useEffect, useState } from "react";
import axios from "axios";
import { Send, Loader2 } from "lucide-react";
import { API } from "@/config/chains";

// Minimal placeholder: title + Chain section + "Deployed on" indicator.
export function SolStealthSend() {
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
    <div className="space-y-4" data-testid="sol-stealth-send">
      <div className="bg-white/5 border border-white/10 p-4 text-sm text-white/70 flex items-center gap-3">
        <Send className="w-4 h-4 text-purple-300" />
        <div>
          <div className="font-semibold text-white">Chain</div>
          <div>Solana {sol?.devnet ? "Devnet" : "Mainnet"} (chain id 1399811149)</div>
        </div>
      </div>

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
            Program not deployed on Solana - see /api/sol/status. PoC UI;
            full form behind audit gate.
          </div>
        )}
      </div>
    </div>
  );
}
