import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const UniswapPrivateSwap = lazy(() => import("@/components/features/UniswapPrivateSwap").then(m => ({ default: m.UniswapPrivateSwap })));
const AerodromePrivateSwap = lazy(() => import("@/components/features/AerodromePrivateSwap").then(m => ({ default: m.AerodromePrivateSwap })));

// P4.2 umbrella: pick between Uniswap V3 and Aerodrome V2 routers on
// EVM. Order: legacy Uniswap first (most-tested), then Aerodrome
// (Base's primary DEX — the only one with real WETH/USDC liquidity
// per P1.13).
const DEXES = [
  { id: "uniswap",   label: "Uniswap V3",   desc: "ETH-mainnet + L2s (Arb/OP/Polygon)",         kind: "all-evm",     color: "text-blue-400" },
  { id: "aerodrome", label: "Aerodrome V2", desc: "Base only — WETH/USDC liquidity",          kind: "base-only", color: "text-purple-400" },
];

function Fallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-white/40" />
    </div>
  );
}

export function SwapSVM() {
  const [dexId, setDexId] = useState(DEXES[0].id);
  return (
    <div className="space-y-4" data-testid="swap-svm">
      <div className="flex flex-wrap gap-2">
        {DEXES.map(d => (
          <button
            key={d.id}
            data-testid={`swap-dex-${d.id}`}
            onClick={() => setDexId(d.id)}
            title={d.desc}
            className={`flex-1 min-w-[160px] py-2.5 text-xs font-semibold border transition-all ${
              dexId === d.id
                ? `border-white/60 bg-white/10 ${d.color}`
                : "border-white/10 bg-white/5 text-white/40 hover:border-white/30"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <Suspense key={dexId} fallback={<Fallback />}>
        {dexId === "uniswap"
          ? <UniswapPrivateSwap />
          : <AerodromePrivateSwap />}
      </Suspense>
    </div>
  );
}
