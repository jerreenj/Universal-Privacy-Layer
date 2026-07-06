import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const UniswapPrivateSwap    = lazy(() => import("@/components/features/UniswapPrivateSwap").then(m => ({ default: m.UniswapPrivateSwap })));
const AerodromePrivateSwap = lazy(() => import("@/components/features/AerodromePrivateSwap").then(m => ({ default: m.AerodromePrivateSwap })));

// All-In-One Swap picker. Each row points to a privacy wrapper
// contract that's LIVE on Base mainnet today:
//
//   Uniswap V3     - UniswapPrivacyWrapper.sol       (P4.1 broadcast)
//   Aerodrome V2   - AerodromePrivacyWrapper.sol     (P4.2 broadcast)
//
// We deliberately ship ONLY the two rows that have a real on-chain
// deployment, and NO placeholder entries (1inch / CoW / OpenOcean /
// Matcha). Showing 'coming soon' buttons that don't actually do a
// swap was overreach - customers looking for a swap should see only
// what ships. To add a real DEX later: deploy the wrapper to Base,
// add the sub-component + SubComponent reference below.
const DEXES = [
  {
    id: "uniswap",
    label: "Uniswap V3",
    desc:  "UniswapPrivacyWrapper.sol live on Base (P4.1 broadcast) — note: no WETH/USDC pool on Base, will revert for ETH/USDC routes",
    color: "text-blue-400",
    SubComponent: UniswapPrivateSwap,
    subProps: {},
  },
  {
    id: "aerodrome",
    label: "Aerodrome V2",
    desc:  "AerodromePrivacyWrapper.sol live on Base (P4.2 broadcast, 4-field Route struct with factory) — recommended: has the deep WETH/USDC pool",
    color: "text-purple-400",
    SubComponent: AerodromePrivateSwap,
    subProps: {},
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
  // Default to Aerodrome V2 — Base's only DEX with a deep WETH/USDC
  // pool, so the swap picker opens with a working route on the very
  // first customer click (P1.13 finding; Uniswap V3 has no WETH/USDC
  // pool on Base and would revert). Customer can still pick Uniswap
  // V3 explicitly to see that failure path.
  const [dexId, setDexId] = useState("aerodrome");
  const dex = DEXES.find(d => d.id === dexId);
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
        <dex.SubComponent {...dex.subProps} />
      </Suspense>
    </div>
  );
}
