import { useState } from "react";
import { RefreshCw, ChevronDown, Loader2 } from "lucide-react";
import { CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function HiddenBalanceDashboard() {
  const { hiddenBalance, fetchHiddenBalance } = useWallet();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const refresh = async () => { setLoading(true); await fetchHiddenBalance(); setLoading(false); };

  if (!hiddenBalance) return (
    <div className="text-center py-8">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-white/50" />
      <p className="text-white/50">Loading hidden balances...</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Hidden Balance</h2>
          <p className="text-sm text-white/50">Aggregated across {hiddenBalance.stealth_address_count || 0} stealth addresses</p>
        </div>
        <button onClick={refresh} className="p-2 hover:bg-white/10 rounded" disabled={loading}>
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(hiddenBalance.chains || {}).slice(0, 4).map(([chainKey, data]) => (
          <div key={chainKey} className="bg-white/5 border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHAINS[chainKey]?.color || '#666' }} />
              <span className="text-xs text-white/50">{data.name}</span>
            </div>
            <div className="text-lg font-bold">{parseFloat(data.total_balance || 0).toFixed(4)}</div>
            <div className="text-xs text-white/30">{data.symbol}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">All Chains</h3>
        {Object.entries(hiddenBalance.chains || {}).map(([chainKey, data]) => (
          <div key={chainKey} className="bg-white/5 border border-white/10">
            <button onClick={() => setExpanded(expanded === chainKey ? null : chainKey)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/5">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHAINS[chainKey]?.color || '#666' }} />
                <span className="font-medium">{data.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="font-mono">{parseFloat(data.total_balance || 0).toFixed(6)} {data.symbol}</div>
                  <div className="text-xs text-white/30">
                    Main: {parseFloat(data.main_balance || 0).toFixed(4)} | Stealth: {parseFloat(data.stealth_balance || 0).toFixed(4)}
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform ${expanded === chainKey ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {expanded === chainKey && data.stealth_addresses_with_balance?.length > 0 && (
              <div className="border-t border-white/10 p-4 space-y-2">
                <div className="text-xs text-white/50 uppercase tracking-wider mb-2">Stealth Addresses with Balance</div>
                {data.stealth_addresses_with_balance.map((sa, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-white/5 p-2">
                    <span className="font-mono text-xs">{sa.address.slice(0, 10)}...{sa.address.slice(-8)}</span>
                    <span className="font-mono">{parseFloat(sa.balance).toFixed(6)} {data.symbol}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
