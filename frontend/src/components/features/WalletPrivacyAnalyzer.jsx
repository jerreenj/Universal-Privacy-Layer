import { useState } from "react";
import axios from "axios";
import { Search, Shield, AlertTriangle, CheckCircle, Loader2, Activity, Globe } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

const GRADE_COLORS = {
  "A+": "text-green-400", A: "text-green-400", B: "text-yellow-400",
  C: "text-orange-400", D: "text-red-400", F: "text-red-500",
};
const RISK_COLORS = { high: "border-red-500/40 bg-red-500/10", medium: "border-orange-500/40 bg-orange-500/10", low: "border-yellow-500/40 bg-yellow-500/10" };
const RISK_ICONS = { high: "text-red-400", medium: "text-orange-400", low: "text-yellow-400" };

export function WalletPrivacyAnalyzer() {
  const { address } = useWallet();
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const scan = async () => {
    const addr = target.trim() || address;
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return toast.error("Enter a valid EVM address");
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.get(`${API}/analyzer/scan/${addr}`);
      setResult(res.data);
    } catch {
      toast.error("Scan failed");
    }
    setLoading(false);
  };

  const useMyAddress = () => {
    if (address) { setTarget(address); }
    else toast.error("Connect wallet first");
  };

  return (
    <div className="space-y-5" data-testid="wallet-privacy-analyzer">
      <p className="text-sm text-white/50">
        Scan any wallet address across 6 EVM chains. Scores privacy posture using public on-chain data. Zero gas, fully free.
      </p>

      <div className="flex gap-2">
        <input
          data-testid="analyzer-address-input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="0x... wallet address"
          className="flex-1 bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none placeholder:text-white/30"
        />
        <button onClick={useMyAddress} className="px-3 bg-white/5 border border-white/20 text-xs text-white/60 hover:bg-white/10">
          My Wallet
        </button>
      </div>

      <button
        data-testid="analyzer-scan-button"
        onClick={scan}
        disabled={loading}
        className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {loading ? "Scanning 6 chains..." : "Analyze Privacy"}
      </button>

      {result && (
        <div className="space-y-4 animate-in fade-in" data-testid="analyzer-results">
          {/* Score Card */}
          <div className="bg-white/5 border border-white/10 p-6 text-center">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Privacy Score</div>
            <div className="flex items-center justify-center gap-4">
              <span className={`text-5xl font-bold ${GRADE_COLORS[result.grade]}`}>{result.privacy_score}</span>
              <span className={`text-3xl font-bold ${GRADE_COLORS[result.grade]}`}>{result.grade}</span>
            </div>
            <div className="mt-3 flex justify-center gap-6 text-xs text-white/50">
              <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {result.total_tx_count} txs</span>
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {result.chains_with_activity} chains active</span>
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> {result.chains_with_balance} with balance</span>
            </div>
          </div>

          {/* Chain Breakdown */}
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-xs text-white/40 uppercase tracking-wider mb-3">Chain Breakdown</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.entries(result.chain_data).map(([key, data]) => {
                const chainInfo = CHAINS[key];
                const balEth = data.balance_wei !== "0"
                  ? (parseInt(data.balance_wei) / 1e18).toFixed(4)
                  : "0";
                return (
                  <div key={key} className="bg-white/5 border border-white/10 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: chainInfo?.color || "#666" }} />
                      <span className="text-xs font-medium">{chainInfo?.name || key}</span>
                    </div>
                    <div className="text-xs text-white/50">
                      <div>{balEth} {chainInfo?.symbol || "ETH"}</div>
                      <div>{data.tx_count} txs</div>
                      {data.is_contract && <div className="text-yellow-400">Contract</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Risks */}
          {result.risks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs text-white/40 uppercase tracking-wider">Risks Found</h3>
              {result.risks.map((r, i) => (
                <div key={i} className={`border p-3 ${RISK_COLORS[r.level]}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${RISK_ICONS[r.level]}`} />
                    <span className="text-sm">{r.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs text-white/40 uppercase tracking-wider">Recommendations</h3>
              {result.recommendations.map((rec, i) => (
                <div key={i} className="border border-green-500/20 bg-green-500/5 p-3 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0" />
                  <span className="text-sm text-white/70">{rec}</span>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-white/30 text-center">
            Scanned {Object.keys(result.chain_data).length} chains via public Ankr RPCs — zero gas cost
          </div>
        </div>
      )}
    </div>
  );
}
