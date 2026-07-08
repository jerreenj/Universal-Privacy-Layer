import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Shield, Lock, Check, Loader2, Zap, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

/**
 * Polymarket Private Betting — full prepare → execute → record flow.
 *
 *   1. prepare: backend mints a stealth proxy + bet plan (/polymarket/prepare-private-bet)
 *   2. execute: user sends the bet amount (USDC value as native) to the proxy
 *      via MetaMask — this is the on-chain privacy step
 *   3. record: backend marks the bet executed (/polymarket/record-bet) and the
 *      relayer buys the CTF outcome token through the proxy
 */
export function PolymarketPrivateBetting() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [outcome, setOutcome] = useState("YES");
  const [amountUSDC, setAmountUSDC] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [betPlan, setBetPlan] = useState(null);
  const [executedTx, setExecutedTx] = useState(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [pastBets, setPastBets] = useState([]);

  useEffect(() => {
    setLoadingMarkets(true);
    axios.get(`${API}/polymarket/markets?limit=6`)
      .then(r => { setMarkets(r.data.markets || []); if (r.data.markets?.[0]) setSelectedMarket(r.data.markets[0]); })
      .catch(() => {})
      .finally(() => setLoadingMarkets(false));
    if (address) {
      axios.get(`${API}/polymarket/bets/${address}`).then(r => setPastBets(r.data.bets || [])).catch(() => {});
    }
  }, [address]);

  const prepareBet = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!selectedMarket) return toast.error("Select a market");
    if (!amountUSDC || parseFloat(amountUSDC) <= 0) return toast.error("Enter bet amount");
    setPreparing(true); setBetPlan(null); setExecutedTx(null);
    try {
      const res = await axios.post(`${API}/polymarket/prepare-private-bet`, {
        bettor_address: address, condition_id: selectedMarket.condition_id || selectedMarket.conditionId,
        token_id: outcome === "YES" ? "1" : "0", outcome, amount_usdc: parseFloat(amountUSDC), chain: chain || "polygon"
      });
      setBetPlan(res.data);
      toast.success("Bet prepared with privacy routing!");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to prepare bet"); }
    setPreparing(false);
  };

  const executeBet = async () => {
    if (!betPlan) return;
    if (!signer) return toast.error("No wallet connected");
    setExecuting(true);
    try {
      // ── RELAYER FLOW ──────────────────────────────────────────
      // Route the bet funding through the on-chain PrivacyRelayer so
      // the customer's EOA never appears as msg.sender. The bet funds
      // go to the bet plan's proxy_address via relayAndAnnounce.
      const amountWei = ethers.parseEther(parseFloat(amountUSDC).toFixed(6).toString());
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: betPlan.proxy_address,
        amount_wei: amountWei.toString(),
        ephemeral_key: ephemeralKey,
        view_tag: viewTag,
        chain: chain || "base",
      });

      const { domain, types, message } = prepRes.data.intent;
      const signature = await signer.signTypedData(domain, types, message);

      const submitRes = await axios.post(`${API}/relayer/submit`, {
        intent: prepRes.data.intent,
        signature,
        from_address: address,
        chain: chain || "base",
      });

      const relayTxHash = submitRes.data.relay_tx_hash || submitRes.data.tx_hash || "";
      setExecutedTx(relayTxHash);
      toast.success("Bet funds relayed to privacy proxy");

      await axios.post(`${API}/polymarket/record-bet`, {
        bet_id: betPlan.bet_id,
        tx_hash: relayTxHash,
        status: "submitted",
      });
      toast.success("Bet recorded — relayer will place it on Polymarket");
      fetchBalance();
      axios.get(`${API}/polymarket/bets/${address}`).then(r => setPastBets(r.data.bets || [])).catch(() => {});
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Execution failed";
      toast.error(msg);
    }
    setExecuting(false);
  };

  const reset = () => {
    setBetPlan(null); setExecutedTx(null);
    setAmountUSDC(""); setOutcome("YES");
  };

  return (
    <div className="space-y-4" data-testid="polymarket-betting">
      <div className="bg-purple-500/10 border border-purple-500/30 p-3 text-xs text-purple-300">
        <div className="flex items-center gap-2 mb-1"><Shield className="w-4 h-4" /><span className="font-semibold">Privacy-Routed Prediction Markets</span></div>
        Bets are routed through a one-time stealth proxy. Your wallet is never linked to your Polymarket positions.
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Select Market</label>
        {loadingMarkets ? (
          <div className="flex items-center gap-2 text-white/40 text-sm py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading markets...</div>
        ) : markets.length === 0 ? (
          <div className="text-white/40 text-sm py-4">No active markets found right now.</div>
        ) : (
          <div className="space-y-2">
            {markets.map((m, i) => (
              <button key={m.condition_id || i} data-testid={`polymarket-market-${i}`} onClick={() => setSelectedMarket(m)}
                className={`w-full text-left p-3 border transition-all ${selectedMarket?.condition_id === m.condition_id ? "border-purple-500/50 bg-purple-500/10" : "border-white/10 bg-white/5 hover:border-white/30"}`}>
                <div className="text-sm font-medium mb-1">{m.question}</div>
                <div className="flex items-center gap-4 text-xs text-white/50">
                  {m.yes_price && <span>YES: <span className="text-green-400">{(m.yes_price * 100).toFixed(0)}¢</span></span>}
                  {m.no_price && <span>NO: <span className="text-red-400">{(m.no_price * 100).toFixed(0)}¢</span></span>}
                  {m.volume && <span>Vol: <span className="text-white/70">{m.volume}</span></span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedMarket && (
        <>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Your Prediction</label>
            <div className="flex gap-3">
              {["YES", "NO"].map(o => (
                <button key={o} data-testid={`polymarket-outcome-${o.toLowerCase()}`} onClick={() => setOutcome(o)}
                  className={`flex-1 py-3 text-sm font-bold transition-all ${outcome === o ? o === "YES" ? "bg-green-500/20 border border-green-500 text-green-400" : "bg-red-500/20 border border-red-500 text-red-400" : "bg-white/5 border border-white/20 text-white/50 hover:border-white/40"}`}>
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Bet Amount (USDC)</label>
            <input data-testid="polymarket-amount-input" type="number" value={amountUSDC} onChange={e => setAmountUSDC(e.target.value)} placeholder="10.00"
              className="w-full bg-white/5 border border-white/20 p-3 font-mono outline-none focus:border-white" />
          </div>

          {amountUSDC && (
            <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-white/50">Bet Amount</span><span className="font-mono">${parseFloat(amountUSDC || 0).toFixed(2)} USDC</span></div>
              <div className="flex justify-between"><span className="text-white/50">Privacy Fee</span><span className="text-green-400">${(parseFloat(amountUSDC || 0) * 0.0005).toFixed(4)} USDC</span></div>
              {selectedMarket.yes_price && (
                <div className="flex justify-between"><span className="text-white/50">Est. Payout if Win</span>
                  <span className="font-mono text-white">${(parseFloat(amountUSDC || 0) / (outcome === "YES" ? selectedMarket.yes_price : selectedMarket.no_price || 0.5)).toFixed(2)} USDC</span>
                </div>
              )}
            </div>
          )}

          {!betPlan ? (
            <button data-testid="polymarket-prepare-btn" onClick={prepareBet} disabled={preparing || !address}
              className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-40 flex items-center justify-center gap-2">
              {preparing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />} Prepare Private Bet
            </button>
          ) : !executedTx ? (
            <div className="space-y-3">
              <div className="bg-purple-500/10 border border-purple-500/30 p-4 space-y-3">
                <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm"><Check className="w-4 h-4" /> Bet Prepared — Review & Execute</div>
                <div className="text-xs text-white/70 space-y-1.5">
                  {betPlan.instructions?.map((inst, i) => (<div key={i} className="text-white/40">{inst}</div>))}
                </div>
                <div className="pt-2 border-t border-white/10 text-xs">
                  <div className="text-white/50 mb-1">Privacy Proxy Address (send bet here)</div>
                  <div className="font-mono text-xs text-purple-400 break-all">{betPlan.proxy_address}</div>
                </div>
                <div className="flex justify-between text-xs"><span className="text-white/40">Est. payout if win:</span><span className="text-white font-mono">{betPlan.estimated_payout_if_win}</span></div>
                <div className="text-xs text-white/40">Bet ID: <span className="font-mono">{betPlan.bet_id?.slice(0,16)}...</span></div>
              </div>
              <button data-testid="polymarket-execute-btn" onClick={executeBet} disabled={executing || !address}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2">
                {executing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />} Send Bet & Execute
              </button>
              <button onClick={reset} className="w-full py-2 border border-white/20 text-white/50 text-sm hover:bg-white/5">Cancel & Reset</button>
            </div>
          ) : (
            <div className="bg-purple-500/10 border border-purple-500/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm"><Check className="w-4 h-4" /> Bet Funds Sent — Pending</div>
              <a href={`${CHAINS[chain]?.explorer}/tx/${executedTx}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-blue-400 hover:underline">
                View tx: {executedTx.slice(0,18)}… <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-xs text-white/40">Relayer will place your {outcome} bet on Polymarket once funds confirm. Track status below.</p>
              <button onClick={reset} className="w-full py-2 border border-white/20 text-white/50 text-sm hover:bg-white/5">Place Another Bet</button>
            </div>
          )}
        </>
      )}

      {pastBets.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-white/50 uppercase tracking-wider">Your Recent Bets</div>
          {pastBets.slice(0, 5).map((b, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`font-bold ${b.outcome === "YES" ? "text-green-400" : "text-red-400"}`}>{b.outcome}</span>
                <span className="text-white/40 truncate max-w-[180px]">{b.question || b.condition_id?.slice(0,16)}</span>
              </div>
              <span className={`font-mono uppercase ${b.status === "confirmed" ? "text-green-400" : b.status === "submitted" ? "text-yellow-400" : "text-white/40"}`}>{b.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
