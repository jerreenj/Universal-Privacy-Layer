import { Info } from "lucide-react";
import { SOLANA_DEVNET } from "@/config/chains";

/**
 * SolDevnetBadge — shown on Solana screens while Solana runs on DEVNET
 * (P2.10 Step 10a — $0 pilot-ready path). Renders nothing once the UI is
 * flipped to mainnet (REACT_APP_SOL_DEVNET=false), so the same components
 * carry over to Step 10b untouched. Honest labeling — never misrepresent
 * devnet as mainnet to a customer or user.
 */
export function SolDevnetBadge() {
  if (!SOLANA_DEVNET) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
    >
      <Info className="h-3.5 w-3.5" />
      <span>
        Solana — <strong>devnet / test mode</strong>. Funds are not real.
      </span>
    </div>
  );
}
