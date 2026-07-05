import { useState, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { StealthSend as StealthSendEVM } from "@/components/features/StealthSend";

const SuiStealthSend = lazy(() => import("@/components/features/SuiStealthSend").then(m => ({ default: m.SuiStealthSend })));
const SolStealthSend = lazy(() => import("@/components/features/SolStealthSend").then(m => ({ default: m.SolStealthSend })));

// All chains we can send privately on. Order: EVM (most-used) first, then SVM.
// `kind` decides which underlying component renders.
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

export function StealthSendSVM() {
  const { address, signer } = useWallet();
  const [chainId, setChainId] = useState(CHAINS[0].id);
  const chain = CHAINS.find(c => c.id === chainId);

  return (
    <div className="space-y-4" data-testid="stealth-send-svm">
      <div className="flex flex-wrap gap-2">
        {CHAINS.map(c => (
          <button
            key={c.id}
            data-testid={`stealth-send-chain-${c.id}`}
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
        {chain.kind === "svm"
          ? (chainId === "sui"
              ? <SuiStealthSend />
              : <SolStealthSend />)
          : <StealthSendEVM address={address} chain={chainId} signer={signer} />}
      </Suspense>
    </div>
  );
}
