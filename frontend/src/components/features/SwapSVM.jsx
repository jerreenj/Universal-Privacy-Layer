import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const UniswapPrivateSwap    = lazy(() => import("@/components/features/UniswapPrivateSwap").then(m => ({ default: m.UniswapPrivateSwap })));
const AerodromePrivateSwap = lazy(() => import("@/components/features/AerodromePrivateSwap").then(m => ({ default: m.AerodromePrivateSwap })));
const ComingSoonAggregator = lazy(() => import("@/components/features/AllInOneSwap").then(m => ({ default: m.ComingSoonAggregator })));

// All-In-One Swap picker. 'ready' sub-components have a live on-chain
// privacy wrapper (UniswapPrivacyWrapper / AerodromePrivacyWrapper).
// 'soon' sub-components are honest placeholders — the user sees
// "coming soon" with a why-this-skipped note rather than a fake button.
//
// Future on-chain wrappers (e.g. a CurveStablePrivacyWrapper or a
// 1inchRouterPrivacyWrapper) drop in by:
//   1. Adding the wrapper pair to contracts/script/Deploy.s.sol +
//      redeploy.
//   2. Adding a sub-component at frontend/src/components/features/.
//   3. Adding a row here pointing at the new sub-component + the
//      on-chain state in the picker.
const DEXES = [
  {
    id: "uniswap", label: "Uniswap V3", kind: "ready",
    desc:  "Most-tested DEX, live on ETH-mainnet + L2s",
    color: "text-blue-400",
    SubComponent: UniswapPrivateSwap,
    subProps: {},
  },
  {
    id: "aerodrome", label: "Aerodrome V2", kind: "ready",
    desc:  "Base's primary DEX — WETH/USDC liquidity",
    color: "text-purple-400",
    SubComponent: AerodromePrivateSwap,
    subProps: {},
  },
  // === Real products ship below this line ===
  {
    id: "1inch", label: "1inch", kind: "soon",
    desc:  "Aggregator — Base route via 1inch V6 router",
    color: "text-cyan-400",
    SubComponent: ComingSoonAggregator,
    subProps: { name: "1inch", kind: "aggregator" },
  },
  {
    id: "openOcean", label: "OpenOcean", kind: "soon",
    desc:  "Aggregator — cross-chain + same-chain swap routing",
    color: "text-teal-400",
    SubComponent: ComingSoonAggregator,
    subProps: { name: "OpenOcean", kind: "aggregator" },
  },
  {
    id: "cowSwap", label: "CoW Swap", kind: "soon",
    desc:  "Intent-based aggregator — MEV-protected batches",
    color: "text-orange-400",
    SubComponent: ComingSoonAggregator,
    subProps: { name: "CoW Swap", kind: "intent-based aggregator" },
  },
  {
    id: "matcha", label: "Matcha (0x)", kind: "soon",
    desc:  "0x API aggregator — best-execution search",
    color: "text-pink-400",
    SubComponent: ComingSoonAggregator,
    subProps: { name: "Matcha", kind: "0x API aggregator" },
  },
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
  const dex = DEXES.find(d => d.id === dexId);
  return (
    <div className="space-y-4" data-testid="swap-svm">
      {/* Aggregator / DEX picker — presented as a wrap-around tab
          strip. Each chip's color matches the underlying DEX brand. */}
      <div className="flex flex-wrap gap-2">
        {DEXES.map(d => (
          <button
            key={d.id}
            data-testid={`swap-dex-${d.id}`}
            onClick={() => setDexId(d.id)}
            title={d.desc}
            className={`flex-1 min-w-[120px] py-2.5 text-xs font-semibold border transition-all ${
              dexId === d.id
                ? `border-white/60 bg-white/10 ${d.color}`
                : "border-white/10 bg-white/5 text-white/40 hover:border-white/30"
            }`}
          >
            <div>{d.label}</div>
            {d.kind === "soon" && (
              <div className="text-[9px] text-yellow-300/70 mt-0.5 uppercase tracking-wider">
                Soon
              </div>
            )}
          </button>
        ))}
      </div>
      {/* Sub-components are lazy-loaded; the 'ready' ones are real
          wrappers, the 'soon' ones are honest placeholders. */}
      <Suspense key={dexId} fallback={<Fallback />}>
        <dex.SubComponent {...dex.subProps} />
      </Suspense>
    </div>
  );
}
