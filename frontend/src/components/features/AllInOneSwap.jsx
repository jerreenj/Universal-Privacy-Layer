/**
 * ComingSoonAggregator — placeholder sub-component shown when a user
 * picks a DEX / aggregator entry we haven't shipped yet (1inch,
 * CowSwap, OpenOcean, etc).
 *
 * Why a single placeholder vs N individual files: keeps SwapSVM.jsx
 * the only source of truth for which aggregators are visible to the
 * user, with the same-day-upgrade path being "swap the placeholder
 * sub-component for a real sub-component once the on-chain wrapper
 * broadcasts". Until then, the user sees an honest 'coming soon'
 * rather than a fake 'done' button.
 */
import { Construction, AlertTriangle } from "lucide-react";

export function ComingSoonAggregator({ name, kind, note }) {
  return (
    <div
      data-testid={`aggregator-coming-soon-${name.toLowerCase()}`}
      className="border border-white/20 p-4 space-y-3 bg-yellow-500/5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Construction className="w-5 h-5 text-yellow-400" />
          <span className="font-semibold text-white">{name}</span>
        </div>
        <span className="text-[10px] text-yellow-400 border border-yellow-400/40 px-1.5 py-0.5">
          COMING SOON
        </span>
      </div>
      <div className="flex items-start gap-2 text-xs text-yellow-300/80">
        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <div>
            {name} {kind ? `(${kind})` : ""} is on our roadmap. We're
            still shipping the on-chain wrapper contract that does the
            privacy-routed swap; until that's live this picker entry will
            stay in 'coming soon' state so you don't accidentally send a
            tx that the contract can't accept.
          </div>
          {note && (
            <div className="mt-1 text-white/40">Why we skipped it: {note}</div>
          )}
        </div>
      </div>
    </div>
  );
}
