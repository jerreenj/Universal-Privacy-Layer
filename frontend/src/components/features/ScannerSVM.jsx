import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { StealthReceive } from "@/components/features/StealthReceive";

const SuiScanner = lazy(() => import("@/components/features/SuiScanner").then(m => ({ default: m.SuiScanner })));
const SolScanner = lazy(() => import("@/components/features/SolScanner").then(m => ({ default: m.SolScanner })));

// All chains we can scan stealth announcements on. Order: EVM (most-used)
// first, then SVM (matches StealthSendSVM.jsx so the two top-level features
// look consistent). `kind` decides which underlying component renders.
const CHAINS = [
  { id: "base",     label: "Base",      color: "text-blue-400",    kind: "evm" },
  { id: "arbitrum", label: "Arbitrum",  color: "text-cyan-300",    kind: "evm" },
  { id: "polygon",  label: "Polygon",   color: "text-purple-300",  kind: "evm" },
  { id: "optimism", label: "Optimism",  color: "text-red-400",     kind: "evm" },
  { id: "bnb",      label: "BNB Chain", color: "text-yellow-400",  kind: "evm" },
  { id: "sui",      label: "Sui",       color: "text-cyan-400",    kind: "svm" },
  { id: "sol",      label: "Solana",    color: "text-purple-400",  kind: "svm" },
];

function Fallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-white/40" />
    </div>
  );
}

export function ScannerSVM() {
  const { address } = useWallet();
  const [chainId, setChainId] = useState(CHAINS[0].id);
  return (
    <div className="space-y-4" data-testid="scanner-svm">
      <div className="flex flex-wrap gap-2">
        {CHAINS.map(c => (
          <button
            key={c.id}
            data-testid={`svm-scan-chain-${c.id}`}
            onClick={() => setChainId(c.id)}
            className={`flex-1 min-w-[80px] py-2.5 text-xs font-semibold border transition-all ${
              chainId === c.id
                ? `border-white/60 bg-white/10 ${c.color}`
                : "border-white/10 bg-white/5 text-white/40 hover:border-white/30"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <Suspense key={chainId} fallback={<Fallback />}>
        {chainId === "sui"
          ? <SuiScanner />
          : chainId === "sol"
            ? <SolScanner />
            : <StealthReceive address={address} chain={chainId} />}
      </Suspense>
    </div>
  );
}
