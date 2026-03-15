import { useState, useEffect } from "react";
import axios from "axios";
import { Shield, Loader2, TrendingUp, Check } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";
import { API } from "@/config/chains";

export function HyperliquidPrivateTrading() {
  const { address, chain } = useWallet();
  const [asset, setAsset] = useState("ETH");
  const [direction, setDirection] = useState("LONG");
  const [sizeUSD, setSizeUSD] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [tradePlan, setTradePlan] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [prices, setPrices] = useState({});

  useEffect(() => {
    axios.get(`${API}/hyperliquid/markets`).then(r => setMarkets(r.data.markets || [])).catch(() => {});
    ["BTC", "ETH"].forEach(a => {
      axios.get(`${API}/hyperliquid/price/${a}`).then(r => {
        if (r.data.price) setPrices(p => ({ ...p, [a]: r.data.price }));
      }).catch(() => {});
    });
  }, []);

  const prepareTrade = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!sizeUSD || parseFloat(sizeUSD) <= 0) return toast.error("Enter position size");
    setPreparing(true);
    setTradePlan(null);
    try {
      const res = await axios.post(`${API}/hyperliquid/prepare-private-trade`, {
        trader_address: address,
        asset,
        is_buy: direction === "LONG",
        size: parseFloat(sizeUSD),
        limit_price: limitPrice ? parseFloat(limitPrice) : null,
        leverage,
        chain: chain || "arbitrum"
      });
      setTradePlan(res.data);
      toast.success("Trade prepared with privacy routing!");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to prepare trade"); }
    setPreparing(false);
  };

  const perps = markets.length > 0 ? markets.map(m => m.name) : ["BTC", "ETH", "SOL", "ARB", "MATIC", "AVAX", "DOGE", "LINK", "UNI", "HYPE"];

  return (
    <div className="space-y-4" data-testid="hyperliquid-trading">
      <div className="bg-green-500/10 border border-green-500/30 p-3 rounded text-xs text-green-300">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" />
          <span className="font-semibold">Privacy-Routed Perpetual Trading</span>
        </div>
        Your margin is routed through a stealth proxy before opening positions on Hyperliquid.
      </div>

      {Object.keys(prices).length > 0 && (
        <div className="flex gap-3">
          {Object.entries(prices).map(([a, p]) => (
            <div key={a} className="bg-white/5 border border-white/10 px-3 py-2 text-xs">
              <span className="text-white/50">{a}/USD</span>
              <span className="ml-2 font-mono text-green-400">${parseFloat(p).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Asset</label>
          <select value={asset} onChange={e => setAsset(e.target.value)} data-testid="hl-asset-select"
            className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none">
            {perps.slice(0, 20).map(p => <option key={p} value={p} className="bg-black">{p}-PERP</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Direction</label>
          <div className="flex gap-2">
            {["LONG", "SHORT"].map(d => (
              <button key={d} data-testid={`hl-direction-${d.toLowerCase()}`}
                onClick={() => setDirection(d)}
                className={`flex-1 py-3 text-sm font-bold transition-all ${
                  direction === d
                    ? d === "LONG" ? "bg-green-500/20 border border-green-500 text-green-400" : "bg-red-500/20 border border-red-500 text-red-400"
                    : "bg-white/5 border border-white/20 text-white/50 hover:border-white/40"
                }`}>{d}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Size (USD)</label>
          <input data-testid="hl-size-input" type="number" value={sizeUSD}
            onChange={e => setSizeUSD(e.target.value)} placeholder="100"
            className="w-full bg-white/5 border border-white/20 p-3 font-mono outline-none focus:border-white" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Leverage</label>
          <input data-testid="hl-leverage-input" type="number" value={leverage} min={1} max={50}
            onChange={e => setLeverage(parseInt(e.target.value) || 1)}
            className="w-full bg-white/5 border border-white/20 p-3 font-mono outline-none focus:border-white" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Limit Price (optional)</label>
        <input type="number" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
          placeholder="Market order (leave empty)"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>

      {sizeUSD && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-white/50">Position Value</span><span className="font-mono">${(parseFloat(sizeUSD || 0) * leverage).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-white/50">Required Margin</span><span className="font-mono">${parseFloat(sizeUSD || 0).toFixed(2)} USDC</span></div>
          <div className="flex justify-between"><span className="text-white/50">Privacy Fee</span><span className="text-green-400">${(parseFloat(sizeUSD || 0) * 0.0005).toFixed(4)}</span></div>
        </div>
      )}

      <button data-testid="hl-prepare-trade-btn" onClick={prepareTrade} disabled={preparing || !address}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-40 flex items-center justify-center gap-2">
        {preparing ? <Loader2 className="w-5 h-5 animate-spin" /> : <TrendingUp className="w-5 h-5" />}
        Prepare Private Trade
      </button>

      {tradePlan && (
        <div className="bg-green-500/10 border border-green-500/30 p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
            <Check className="w-4 h-4" /> Trade Prepared Successfully
          </div>
          <div className="text-xs text-white/70 space-y-1.5">
            {tradePlan.instructions?.map((inst, i) => <div key={i} className="text-white/40">{inst}</div>)}
          </div>
          <div className="pt-2 border-t border-white/10 text-xs">
            <div className="text-white/50 mb-1">Privacy Proxy Address</div>
            <div className="font-mono text-xs text-green-400 break-all">{tradePlan.proxy_address}</div>
          </div>
          <div className="text-xs text-white/40">Trade ID: <span className="font-mono">{tradePlan.trade_id?.slice(0,16)}...</span></div>
        </div>
      )}
    </div>
  );
}
