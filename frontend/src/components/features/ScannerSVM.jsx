import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

/**
 * Announcement Scanner (SVM) — generic wrapper with a Sui↔Solana toggle.
 */
const SuiScanner = lazy(() => import("@/components/features/SuiScanner"));
const SolScanner = lazy(() => import("@/components/features/SolScanner"));

const CHAINS = [
  { id: "sui", label: "Sui", color: "text-cyan-400" },
  { id: "sol", label: "Solana", color: "text-purple-400" },
];

function Fallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-white/40" />
    </div>
  );
}

export function ScannerSVM() {
  const [chain, setChain] = useState("sui");
  return (
    <div className="space-y-4" data-testid="scanner-svm">
      <div className="flex gap-2">
        {CHAINS.map(c => (
          <button
            key={c.id}
            data-testid={`svm-scan-chain-${c.id}`}
            onClick={() => setChain(c.id)}
            className={`flex-1 py-2.5 text-sm font-semibold border transition-all ${
              chain === c.id
                ? `border-white/60 bg-white/10 ${c.color}`
                : "border-white/10 bg-white/5 text-white/40 hover:border-white/30"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <Suspense key={chain} fallback={<Fallback />}>
        {chain === "sui" && <SuiScanner />}
        {chain === "sol" && <SolScanner />}
      </Suspense>
    </div>
  );
}
