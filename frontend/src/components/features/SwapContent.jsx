/**
 * SwapContent — the **native** private swap on Base.
 *
 * Mounted on the Core Actions grid via the 'Private Swap' tile. This is the
 * single-DEX, no-picker baseline: ETH in, a Base-mainstream ERC20 out (USDC
 * or USDT), paid to a stealth recipient via Aerodrome V2's
 * `AerodromePrivacyWrapper.privateSwapETHForToken` (the post-P4.2-hotfix
 * wrapper at 0xe896e6f51af137c32db7eb4e3b2de795d392a646).
 *
 * Kept deliberately different from SwapSVM (multi-DEX picker) which mounts
 * on the PrivateDeFi 'All in One Swap' tile. Same backing contract family
 * (AerodromePrivacyWrapper) but a much simpler surface — the customer who
 * just wants "private ETH -> USDC on Base" lands here, the customer who
 * wants to pick a DEX lands in SwapSVM.
 *
 * Quote path is read-only: a direct call to Aerodrome Router's
 * `getAmountsOut(amountIn, routes)` so the customer sees the exact output
 * the Router will credit (no extra backend round-trip).
 *
 * Switch path is one wallet tx: it hands ETH straight to the wrapper, which
 * sends the 5 bps protocol fee to the deployer (`feeRecipient`) and the
 * remainder to Aerodrome Router. The Router wraps/unwraps WETH internally
 * for ETH -> ERC20 and credits the ERC20 straight to the stealth recipient.
 * The customer's EOA never appears as the swap sender on-chain.
 *
 * After settlement we record the tx to /api/transactions/record so it shows
 * up in the customer's Transaction History tile — and only there. No
 * counter is added to the swap tile, no banner anywhere else.
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { RefreshCw, Loader2, ExternalLink, Check, Lock } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";

// AerodromePrivacyWrapper ABI — only the calls the customer surface makes
// (quote + swap + read stable/volatile factory so the Route struct can be
// built fully populated; mirrors the same 4-field Route shape that the
// P4.2 hotfix landed).
const AERODROME_WRAPPER_ABI = [
  "function privateSwapETHForToken(address tokenOut, tuple(address from, address to, bool stable, address factory)[] routes, uint256 amountOutMinimum, address recipient, uint256 deadline) payable returns (uint256 amountOut)",
  "function feeRate() view returns (uint256)",
  "function WETH() view returns (address)",
  "function aerodromeRouter() view returns (address)",
  "function volatileFactory() view returns (address)",
  "function stableFactory() view returns (address)",
  "function factoryFor(bool stable) view returns (address)",
];

// Aerodrome Router — we only call `getAmountsOut` (preview, no gas).
const AERODROME_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint256[] memory)",
];

// Base mainstream tokens Aerodrome V2 has live pools for. USDC = volatile
// pool paired against WETH; USDT = stable pool (stableusd-stableusd). Keep
// the list short — native swap is meant to be "ETH -> a stable" in one
// click; anything more exotic lives in SwapSVM's picker.
const NATIVE_OUTPUT_TOKENS = [
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, stable: false },
  { symbol: "USDT", address: "0xfde4C96cAd36929608d35fFBd6A11dD60b3EA633", decimals: 6, stable: true  },
];
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

// Hard-coded fallback for the wrapper address — confirms the post-P4.2
// hotfix v2 wrapper if /api/deployments hasn't been reloaded since the
// hotfix broadcast. Constant-only — a stale value surfaces immediately
// as a 'not connected' error to the user rather than silently swapping
// against a stale wrapper.
const FALLBACK_WRAPPER = "0xe896e6f51af137c32db7eb4e3b2de795d392a646";

// Hard-coded fallback for the Aerodrome PoolFactory on Base — handles
// both stable and volatile pools (PoolFactory stores them in a bool-keyed
// mapping per upstream contracts/factories/PoolFactory.sol).
const FALLBACK_AERODROME_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";

export function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [outputSymbol, setOutputSymbol] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50); // 0.5 %
  const [stealthRecipient, setStealthRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [wrapperAddr, setWrapperAddr] = useState(FALLBACK_WRAPPER);
  const [wrapperMeta, setWrapperMeta] = useState({ network: "base", fallback: false });

  // Resolve the live wrapper address from /api/deployments (P4.2 hotfix v2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/deployments`);
        const base = (r.data && r.data.evm && r.data.evm.base) || {};
        if (!cancelled && base.aerodrome_wrapper) {
          setWrapperAddr(base.aerodrome_wrapper);
          setWrapperMeta({ network: "base", fallback: false });
          return;
        }
      } catch { /* fall through */ }
      if (!cancelled) {
        setWrapperAddr(FALLBACK_WRAPPER);
        setWrapperMeta({ network: "base", fallback: true });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      const r = await axios.post(`${API}/stealth/generate`, {
        public_address: address,
        chain: chain === "base" ? "base" : "ethereum_sepolia",
      });
      setStealthRecipient(r.data.stealth_address);
      toast.success("Stealth address generated");
    } catch { toast.error("Failed to generate stealth address"); }
  };

  const getQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    if (!stealthRecipient) return toast.error("Enter or generate a stealth recipient");
    if (!ethers.isAddress(stealthRecipient)) return toast.error("Invalid stealth recipient address");
    setLoading(true); setQuote(null);
    try {
      const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
        ? new ethers.BrowserProvider(window.ethereum) : null);
      if (!provider) throw new Error("Connect a wallet");
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== 8453) {
        toast.error("Switch MetaMask to Base mainnet");
        setLoading(false);
        return;
      }
      const out = NATIVE_OUTPUT_TOKENS.find(t => t.symbol === outputSymbol);
      if (!out) throw new Error(`Unknown output token ${outputSymbol}`);
      const amountInWei = ethers.parseEther(amount);

      // Pull volatileFactory / stableFactory from the wrapper so the
      // 4-field Route struct matches what Aerodrome Router's decoder
      // expects. Fallback to the canonical Aerodrome PairFactory on Base
      // if the wrapper is the not-yet-restarted v1 (selector-less).
      let factory = FALLBACK_AERODROME_FACTORY;
      try {
        const w = new ethers.Contract(wrapperAddr, AERODROME_WRAPPER_ABI, provider);
        factory = await w.factoryFor(!!out.stable);
      } catch (e) {
        // Stale FALLBACK_WRAPPER (pre-hotfix) or RPC hiccup — use the
        // canonical Aerodrome PairFactory so quote preview still works.
      }

      const routes = [{
        from:    WETH_ADDRESS,
        to:      out.address,
        stable:  !!out.stable,
        factory: factory,
      }];

      const router = new ethers.Contract(
        "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
        AERODROME_ROUTER_ABI,
        provider
      );
      const amounts = await router.getAmountsOut(amountInWei, routes);
      const expectedOut = amounts[amounts.length - 1];
      const fee = (amountInWei * 5n) / 10000n;
      const netIn = amountInWei - fee;
      const minOut = (expectedOut * BigInt(10000 - Math.floor(slippageBps))) / 10000n;

      setQuote({
        amountIn: netIn.toString(),
        amountInWithFee: amountInWei.toString(),
        fee: fee.toString(),
        expectedOut: expectedOut.toString(),
        amountOutMinimum: minOut.toString(),
        routes,
        outputToken: out,
      });
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Quote failed");
    }
    setLoading(false);
  };

  const swap = async () => {
    if (!quote) return toast.error("Get a quote first");
    if (!address) return toast.error("Connect wallet");
    if (!stealthRecipient || !ethers.isAddress(stealthRecipient)) {
      return toast.error("Invalid stealth recipient");
    }
    setSwapping(true);
    try {
      const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
        ? new ethers.BrowserProvider(window.ethereum) : null);
      if (!provider) { toast.error("No wallet connected"); setSwapping(false); return; }
      const activeSigner = signer || await provider.getSigner();
      if (!activeSigner) { toast.error("No signer"); setSwapping(false); return; }

      const wrapper = new ethers.Contract(wrapperAddr, AERODROME_WRAPPER_ABI, activeSigner);
      const tx = await wrapper.privateSwapETHForToken(
        quote.outputToken.address,
        quote.routes,
        quote.amountOutMinimum,
        stealthRecipient,
        Math.floor(Date.now() / 1000) + 600, // 10 min
        { value: quote.amountInWithFee }
      );
      setTxHash(tx.hash);
      toast.success("Private swap broadcast");
      // Stealth-use counter (used in the backend for stats).
      axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      await tx.wait();
      toast.success(`Confirmed — ${ethers.formatUnits(quote.expectedOut, quote.outputToken.decimals).slice(0, 8)} ${outputSymbol} to stealth`);
      // Record the swap so it shows up in the Transaction History tile
      // (the /transactions/history/{address} endpoint is consumed ONLY
      // by TransactionHistory.jsx, so this never surfaces anywhere else).
      // Sealed record: server stores ciphertext only — wallet-derived
      // seal key keeps the row unreadable without the user's wallet
      // signature. The /transactions/history tile unseals locally.
      seal({
        tx_hash:      tx.hash,
        from_address: address,
        to_address:   stealthRecipient,
        amount_wei:   quote.amountInWithFee,
        chain:        "base",
        tx_type:      "private_swap",
        status:       "confirmed",
        client:       "metadata",
      }, activeSigner, address).then((envelope) => {
        axios.post(`${API}/transactions/record`, {
          ...envelope,
          chain:  "base",
          tx_type: "private_swap",
          status:  "confirmed",
        }).catch(() => {});
      }).catch(() => { /* non-fatal */ });
      fetchBalance && fetchBalance();
      setQuote(null); setAmount("");
    } catch (e) {
      toast.error(e.message?.slice(0, 60) || "Swap failed");
    }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="swap-content">
      <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 p-2">
        <Lock className="w-3 h-3" /> Native private swap on Base via Aerodrome V2 — ETH in, output to a stealth recipient.
      </div>

      {wrapperMeta?.fallback && (
        <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 p-2">
          Using hard-coded wrapper fallback (waiting for /api/deployments to refresh after P4.2 hotfix).
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Pay (ETH)</label>
          <input
            data-testid="swap-amount-input"
            type="number"
            value={amount}
            onChange={e => { setAmount(e.target.value); setQuote(null); }}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl font-mono outline-none"
          />
          <div className="text-[10px] text-white/30 mt-1">via Aerodrome Router ETH→WETH→output</div>
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Get</label>
          <select
            data-testid="swap-output-token"
            value={outputSymbol}
            onChange={e => { setOutputSymbol(e.target.value); setQuote(null); }}
            className="w-full bg-transparent text-base font-semibold outline-none"
          >
            {NATIVE_OUTPUT_TOKENS.map(t => (
              <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>
            ))}
          </select>
          <div className="text-[10px] text-white/30 mt-1">
            {quote
              ? `~${ethers.formatUnits(quote.expectedOut, NATIVE_OUTPUT_TOKENS.find(t => t.symbol === outputSymbol)?.decimals ?? 6).slice(0, 8)} ${outputSymbol}`
              : "—"}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Slippage (basis points)</label>
        <input
          type="number"
          min="1"
          max="500"
          value={slippageBps}
          onChange={e => setSlippageBps(Math.max(1, Math.min(500, Number(e.target.value) || 50)))}
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
        />
        <div className="text-[10px] text-white/30 mt-1">{slippageBps / 100}% (max 5%)</div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <div className="flex gap-2">
          <input
            data-testid="swap-recipient-input"
            value={stealthRecipient}
            onChange={e => setStealthRecipient(e.target.value)}
            placeholder="0x..."
            className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
          />
          <button
            data-testid="swap-auto-stealth-btn"
            onClick={autoGenStealth}
            className="px-3 border border-white/20 hover:bg-white/10 text-xs"
          >
            Auto
          </button>
        </div>
      </div>

      {quote && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-white/40">Input (after 5 bps fee)</span>
            <span className="font-mono">{ethers.formatEther(quote.amountIn).slice(0, 10)} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Expected out</span>
            <span className="font-mono">
              {ethers.formatUnits(quote.expectedOut, quote.outputToken.decimals).slice(0, 10)} {outputSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Min out (after slippage)</span>
            <span className="font-mono text-green-400">
              {ethers.formatUnits(quote.amountOutMinimum, quote.outputToken.decimals).slice(0, 10)} {outputSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Route</span>
            <span className="font-mono text-[10px]">Aerodrome V2 ({quote.outputToken.stable ? "stable" : "volatile"} pool)</span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!quote ? (
          <button
            data-testid="swap-quote-btn"
            onClick={getQuote}
            disabled={loading || !amount || !stealthRecipient}
            className="flex-1 py-3 border border-white/30 hover:bg-white/10 font-bold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />} Get Quote
          </button>
        ) : (
          <button
            data-testid="swap-btn"
            onClick={swap}
            disabled={swapping || !address || !stealthRecipient}
            className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Swap Privately
          </button>
        )}
      </div>

      {txHash && (
        <a href={`${CHAINS[chain]?.explorer || "https://basescan.org"}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
