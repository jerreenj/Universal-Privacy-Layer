import { Layers } from "lucide-react";
import { CHAINS, VM_GROUPS } from "@/config/chains";

export function ChainsStatus() {
  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  return (
    <div className="space-y-6">
      {vmGroups.map(({ vmKey, label, chains }) => (
        <div key={vmKey}>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-white/50" />
            <h2 className="text-base font-semibold">{label}</h2>
          </div>
          <div className="space-y-2">
            {chains.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between bg-white/5 border border-white/10 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: v.color }} />
                  <div>
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-white/30">{v.symbol}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {v.live ? (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-green-400">Live</span>
                    </>
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      <span className="text-yellow-400">Coming Soon</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
