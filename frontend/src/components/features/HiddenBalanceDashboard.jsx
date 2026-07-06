import { useState } from "react";
import { RefreshCw, ChevronDown, Loader2, Wallet, AlertCircle, Search } from "lucide-react";
import { CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function HiddenBalanceDashboard() {
  const { address, hiddenBalance, hiddenBalanceError, fetchHiddenBalance, connectWallet } = useWallet();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const refresh = async () => { setLoading(true); await fetchHiddenBalance(); setLoading(false); };

  // ───── State machine — never block on "Loading…" forever. The previous
  // implementation showed the spinner when hiddenBalance stayed null, which
  // is true for ANY of: (a) no wallet, (b) silent fetch failure, (c) the
  // fetch simply hasn't returned yet. We split each case so the user gets
  // an actionable response. ─────

  // (a) No wallet connected — nothing to load; prompt to connect.
  if (!address) return (
    <div className="text-center py-12 space-y-3">
      <Wallet className="w-10 h-10 mx-auto text-white/30" />
      <p className="text-white/60 font-semibold">Connect a wallet to view hidden balances</p>
      <p className="text-xs text-white/40">Your stealth-address balances aggregate here once you're connected.</p>
      <button
        onClick={connectWallet}
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-white text-black text-xs font-semibold hover:bg-white/90 transition-colors"
      >
        Connect Wallet
      </button>
    </div>
  );

  // (b) Fetch failed — surface the error + offer Retry. The previous empty
  // `catch {}` left the user staring at a spinner forever.
  if (hiddenBalanceError) return (
    <div className="text-center py-12 space-y-3">
      <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
      <p className="text-white/60 font-semibold">Couldn't load hidden balances</p>
      <p className="text-xs text-red-400/70 max-w-md mx-auto">{hiddenBalanceError}</p>
      <button
        onClick={refresh}
        disabled={loading}
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 border border-white/40 text-white text-xs font-semibold hover:bg-white/10 transition-colors disabled:opacity-40"
      >
        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        {loading ? "Retrying…" : "Retry"}
      </button>
    </div>
  );

  // (c) Loading — the wallet is connected, no error, but the response hasn't
  // come back yet (or has never been triggered). Try to fire the fetch on
  // render if we haven't already — fixes the case where the user lands here
  // before WalletContext's mount-time useEffect ran.
  if (!hiddenBalance) {
    if (!loading) refresh();
    return (
      <div className="text-center py-8">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-white/50" />
        <p className="text-white/50">Loading hidden balances…</p>
      </div>
    );
  }

  // (d) Loaded but no stealth addresses yet — friendly empty state.
  const totalAddresses = hiddenBalance.stealth_address_count || 0;
  if (totalAddresses === 0 && Object.keys(hiddenBalance.chains || {}).length === 0) return (
    <div className="text-center py-12 space-y-3">
      <Search className="w-10 h-10 mx-auto text-white/30" />
      <p className="text-white/60 font-semibold">No stealth addresses yet</p>
      <p className="text-xs text-white/40 max-w-md mx-auto">Send privately to your meta-address, then come back here to see aggregated balances across all chains.</p>
      <button
        onClick={refresh}
        disabled={loading}
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/70 text-xs hover:border-white/40 hover:text-white transition-colors disabled:opacity-40"
      >
        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        {loading ? "Refreshing…" : "Refresh"}
      </button>
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
