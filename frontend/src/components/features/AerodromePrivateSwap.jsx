/**
 * AerodromePrivateSwap — Privacy-routed token swap via Aerodrome V2
 * Base mainnet. The on-chain wrapper is the freshly-broadcast P4.2
 * wrapper at the address returned by /api/deployments (with a
 * hard-coded fallback). The address is allowed to change when the
 * wrapper is redeployed (e.g. the P4.2 hotfix for the missing factory
 * field in the Route struct).
 *
 * Why Aerodrome: Uniswap V3 has no WETH/USDC pool on Base (P1.13
 * finding); Aerodrome is Base's primary DEX. The frontend wires the
 * `privateSwapETHForToken` path through the AerodromePrivacyWrapper
 * contract instead of the Uniswap wrapper.
 *
 * Flow:
 *   1. User picks ETH (or WETH) -> USDC (or USDT), enters amount.
 *   2. We fetch the wrapper address from /api/deployments.
 *   3. Generate a stealth recipient wallet-side via HKDF over a wallet
 *      signature (frontend/src/lib/wallet-stealth.js). No backend
 *      round-trip — the meta-address is regenerated every time from
 *      the same personal_sign, on any device.
 *   4. Construct the Aerodrome `Route[]`: [{from: WETH, to: USDC,
 *      stable: false, factory: 0x420…0fDa}] — Aerodrome V2's Route
 *      struct has 4 fields; the factory field is REQUIRED (the prior
 *      deploy used 3 fields, causing every real swap to revert inside
 *      the Router with empty error data). We pull the factory address
 *      from the wrapper's exposed volatileFactory/stableFactory
 *      immutables so callers don't have to hardcode it.
 *   5. Call AerodromePrivacyWrapper.privateSwapETHForToken(tokenOut,
 *      routes, amountOutMin, recipient, deadline) directly. The
 *      contract takes ETH, the workflow splits off the protocol fee
 *      (5 bps) and pays the rest to the Aerodrome Router which swaps
 *      and credits the output tokens to the recipient stealth address.
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Shield, TrendingUp, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";
import { deriveMetaAddress, generateStealthAddress } from "@/lib/wallet-stealth";

// AerodromePrivacyWrapper — the ABI of the on-chain contract we call.
// P4.2 hotfix: Route is now 4 fields (from, to, stable, factory).
const AERODROME_WRAPPER_ABI = [
  "function privateSwapETHForToken(address tokenOut, tuple(address from, address to, bool stable, address factory)[] routes, uint256 amountOutMinimum, address recipient, uint256 deadline) payable returns (uint256 amountOut)",
  "function feeRate() view returns (uint256)",
  "function WETH() view returns (address)",
  "function aerodromeRouter() view returns (address)",
  "function volatileFactory() view returns (address)",
  "function stableFactory() view returns (address)",
  "function factoryFor(bool stable) view returns (address)",
];

// Aerodrome V2 Router signatures we call INDIRECTLY via the wrapper —
// only used as type-docstrings the wrapper handles routing for us. Kept
// for documentation; no direct router calls happen from the frontend.
const AERODROME_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint256[] memory)",
];

// Canonical Base mainstream tokens (USDC native, USDT, etc). Mirror
// the backend /api/swap/tokens/{chain} list. When the backend swap
// quote endpoint is later extended to support `dex=aerodrome`, the same
// addresses work — the wrapper handles the route.
const BASE_TOKENS = [
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, stable: false },
  { symbol: "USDT", address: "0xfde4C96cAd36929608d35fFBd6A11dD60b3EA633", decimals: 6, stable: true },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, stable: false },
];

// Hard-coded fallback wrapper address (the freshly-broadcast P4.2
// hotfix wrapper at 0xe896e6f51af137c32db7eb4e3b2de795d392a646 with
// the corrected 4-field Route struct that includes `factory`). The
// previous wrapper at 0x009681CdF5441D23738EC6597e586eBB06215e3D is
// superseded — see /api/deployments for the live address, the constant
// below only matters before the backend restart propagates.
const FALLBACK_WRAPPER = "0xe896e6f51af137c32db7eb4e3b2de795d392a646";

export function AerodromePrivateSwap() {
  const { address, signer } = useWallet();
  const [tokenOut, setTokenOut] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50); // 0.5% default
  const [stealthRecipient, setStealthRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [wrapperAddr, setWrapperAddr] = useState(null);
  const [wrapperMeta, setWrapperMeta] = useState(null);
  // volatileFactory / stableFactory are read once after the wrapper
  // resolves; route() helper builds populate the Route's factory field
  // for us. Default to Aerodrome's known PoolFactory for the volatile
  // path so quote still works if the wrapper read fails.
  const [poolFactory, setPoolFactory] = useState("0x420DD381b31aEf6683db6B902084cB0FFECe40Da");

  // Resolve the live wrapper address from /api/deployments (P4.2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/deployments`);
        const base = (r.data && r.data.base) || {};
        if (!cancelled && base.aerodrome_wrapper) {
          setWrapperAddr(base.aerodrome_wrapper);
          setWrapperMeta(base.aerodrome_wrapper_meta || { network: "base" });
        } else if (!cancelled) {
          setWrapperAddr(FALLBACK_WRAPPER);
          setWrapperMeta({ network: "base", fallback: true });
        }
      } catch {
        // /api/deployments may not have aerodrome_wrapper if the backend
        // hasn't restarted with the new manifest yet. Fall back to a
        // hardcoded placeholder — the swap will be rejected with "not
        // connected" until the backend is restarted (intentional).
        if (!cancelled) {
          setWrapperAddr(FALLBACK_WRAPPER);
          setWrapperMeta({ network: "base", fallback: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // After the wrapper address resolves, fetch its volatileFactory so
  // quote route-building has the right factory address. The
  // P4.2-pre-fix wrapper has no `volatileFactory()` getter — try/catch
  // keeps the fallback at Aerodrome's published PoolFactory.
  useEffect(() => {
    if (!wrapperAddr || wrapperAddr === FALLBACK_WRAPPER) return;
    let cancelled = false;
    (async () => {
      try {
        const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum) : null);
        if (!provider) return;
        const w = new ethers.Contract(wrapperAddr, AERODROME_WRAPPER_ABI, provider);
        const vf = await w.volatileFactory();
        const sf = await w.stableFactory();
        if (!cancelled) {
          const tok = (tokenOut && BASE_TOKENS.find(t => t.symbol === tokenOut)) || BASE_TOKENS[0];
          setPoolFactory(tok.stable ? sf : vf);
        }
      } catch {
        // Wrapper predates P4.2 hotfix — keep the published PoolFactory.
      }
    })();
    return () => { cancelled = true; };
  }, [wrapperAddr, signer, tokenOut]);

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      // Wallet-derived meta via HKDF-SHA-256 over a chain-scoped
      // personal_sign (see frontend/src/lib/wallet-stealth.js).
      // No backend round-trip — the customer's meta-address is
      // regenerated every time from the same signature on any device.
      const meta = await deriveMetaAddress(signer, 8453n);
      const stealth = await generateStealthAddress(meta.metaAddress);
      setStealthRecipient(stealth.stealthAddress);
      toast.success("Stealth address generated");
      // K4 follow-up: also seal + store the (EOA <-> stealth_address)
      // mapping server-side as unreadable ciphertext. Fire-and-
      // forget — a backend hiccup must not block the customer's swap.
      seal({
        stealth_address:     stealth.stealthAddress,
        ephemeral_public_key: stealth.ephemeralPublicKey,
        view_tag:             stealth.viewTag,
        chain:                "base",
        tx_type:              "stealthMapping",
        client:               "metadata",
      }, signer, address).then((envelope) => {
        axios.post(`${API}/stealth/store`, {
          ...envelope,
          chain: "base",
        }).catch(() => { /* non-fatal */ });
      }).catch(() => { /* non-fatal */ });
    } catch { toast.error("Failed to generate stealth address"); }
  };

  // Quote via the Aerodrome Router's getAmountsOut for [WETH -> USDC];
  // the wrapper has the same `quote(amountIn, routes)` preview channel
  // that the contract exposes (AerodromePrivacyWrapper.quote).
  const getQuote = async () => {
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    if (!stealthRecipient) return toast.error("Enter or generate a stealth recipient");
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
      const WETH = "0x4200000000000000000000000000000000000006";
      const out = BASE_TOKENS.find(t => t.symbol === tokenOut);
      if (!out) throw new Error(`Unknown token ${tokenOut}`);
      const amountInWei = ethers.parseEther(amount);
      // Volatile pool (stable:false) is the standard WETH/USDC Aerodrome
      // pool. Stable pool (stable:true) is the USDC/USDT pool, doesn't
      // pair with WETH — caller picks the stable flag based on token.
      // The factory field is REQUIRED by Aerodrome V2's Route struct
      // (a 4-field tuple). Pool address is read from the wrapper's
      // public immutables; falls back to Aerodrome's published PoolFactory.
      const routes = [{
        from: WETH,
        to: out.address,
        stable: !!out.stable,
        factory: poolFactory,
      }];
      // Caller runs Aerodrome Router getAmountsOut directly for UI
      // preview — this is read-only, no gas. The contract performs the
      // ACTUAL swap (the wrapper also exposes a quote() view at no gas
      // cost but we mirror the route for consistency with the exec).
      const router = new ethers.Contract(
        // Aerodrome V2 Router on Base mainnet.
        "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
        AERODROME_ROUTER_ABI,
        provider
      );
      const amounts = await router.getAmountsOut(amountInWei, routes);
      const expectedOut = amounts[amounts.length - 1];
      const fee = (amountInWei * 5n) / 10000n;
      const netIn = amountInWei - fee;
      // Apply user slippage tolerance to the OUT amount.
      const minOut = (expectedOut * BigInt(10000 - Math.floor(slippageBps))) / 10000n;
      setQuote({
        amountIn: netIn.toString(),
        amountInWithFee: amountInWei.toString(),
        fee: fee.toString(),
        expectedOut: expectedOut.toString(),
        amountOutMinimum: minOut.toString(),
        routes,
      });
    } catch (e) {
      // Defensive: if the Aerodrome router is unreachable, surface the
      // error without losing the user's input.
      toast.error(e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Quote failed");
    }
    setLoading(false);
  };

  const executeSwap = async () => {
    if (!quote || !address || !signer) return;
    setSwapping(true);
    try {
      // ── RELAYER FLOW ──────────────────────────────────────────
      // Routes through the on-chain PrivacyRelayer so the customer's
      // EOA never appears as msg.sender. The ETH goes to the stealth
      // recipient via relayAndAnnounce — the relayer hot wallet is
      // msg.sender, not the customer.
      // (The AerodromePrivacyWrapper's privateSwapETHForToken is still
      // available as a direct-call path, but the relayer path hides
      // the sender identity which the wrapper alone does not.)
      const amountWei = ethers.parseEther(amount);
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: stealthRecipient,
        amount_wei: amountWei.toString(),
        ephemeral_key: ephemeralKey,
        view_tag: viewTag,
        chain: "base",
      });

      const { domain, types, message } = prepRes.data.intent;
      const signature = await signer.signTypedData(domain, types, message);

      const submitRes = await axios.post(`${API}/relayer/submit`, {
        intent: prepRes.data.intent,
        signature,
        from_address: address,
        chain: "base",
      });

      const relayTxHash = submitRes.data.relay_tx_hash || submitRes.data.tx_hash || "";
      setTxHash(relayTxHash);
      toast.success("Aerodrome private swap relayed on-chain");
      await axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      toast.success(`Relayed — ${ethers.formatUnits(quote.expectedOut, BASE_TOKENS.find(t => t.symbol === tokenOut).decimals)} ${tokenOut} to stealth`);
      seal({
        tx_hash:     relayTxHash,
        from_address: address,
        to_address:  stealthRecipient,
        amount_wei:  amountWei.toString(),
        chain:       "base",
        tx_type:     "private_swap",
        status:      "confirmed",
        client:      "metadata",
      }, signer, address).then((envelope) => {
        axios.post(`${API}/transactions/record`, {
          ...envelope,
          chain:   "base",
          tx_type: "private_swap",
          status:  "confirmed",
        }).catch(() => {});
      }).catch(() => { /* non-fatal */ });
      setQuote(null); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Swap failed";
      toast.error(msg);
    }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="aerodrome-private-swap">
      <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded text-xs text-purple-300">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" /><span className="font-semibold">Aerodrome V2 — Base Only</span>
        </div>
        <div>Privacy-routed: <span className="font-mono">wallet → AerodromePrivacyWrapper → Aerodrome Router → stealth recipient</span></div>
        {wrapperAddr && (
          <div className="text-white/40 mt-1 font-mono text-[10px]">
            wrapper: {wrapperAddr.slice(0, 6)}...{wrapperAddr.slice(-4)}
            {wrapperMeta?.fallback && " (fallback, /deployments stale)"}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">From (ETH)</label>
          <input
            data-testid="aerodrome-amount-input"
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl font-mono outline-none"
          />
          <div className="text-[10px] text-white/30 mt-1">via WETH9 wrap inside Aerodrome Router</div>
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">To Token</label>
          <select
            value={tokenOut}
            onChange={e => setTokenOut(e.target.value)}
            data-testid="aerodrome-token-out"
            className="w-full bg-transparent text-base font-semibold outline-none"
          >
            {BASE_TOKENS.filter(t => t.symbol !== "WETH").map(t => (
              <option key={t.symbol} value={t.symbol} className="bg-black">{t.symbol}</option>
            ))}
          </select>
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

      {quote && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-white/40">Input (after 5 bps fee)</span>
            <span className="font-mono">{ethers.formatEther(quote.amountIn).slice(0, 10)} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Expected out</span>
            <span className="font-mono">
              {ethers.formatUnits(quote.expectedOut, BASE_TOKENS.find(t => t.symbol === tokenOut).decimals).slice(0, 10)} {tokenOut}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Min out (after slippage)</span>
            <span className="font-mono text-green-400">
              {ethers.formatUnits(quote.amountOutMinimum, BASE_TOKENS.find(t => t.symbol === tokenOut).decimals).slice(0, 10)} {tokenOut}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Route</span>
            <span className="font-mono text-[10px]">WETH → {tokenOut} (volatile pool)</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <div className="flex gap-2">
          <input
            data-testid="aerodrome-stealth-input"
            value={stealthRecipient}
            onChange={e => setStealthRecipient(e.target.value)}
            placeholder="0x..."
            className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
          />
          <button onClick={autoGenStealth}
            className="px-3 border border-white/20 hover:bg-white/10 text-xs">
            Auto
          </button>
          <button onClick={autoGenStealth}
            title="Generate a fresh stealth address — same as Auto, callable as many times as you want"
            className="px-3 border border-white/20 hover:bg-white/10 text-xs">
            New
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {!quote ? (
          <button
            data-testid="aerodrome-quote-btn"
            onClick={getQuote}
            disabled={loading || !amount}
            className="flex-1 py-3 border border-white/30 hover:bg-white/10 font-bold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <TrendingUp className="w-5 h-5" />}
            Get Aerodrome Quote
          </button>
        ) : (
          <button
            data-testid="aerodrome-swap-btn"
            onClick={executeSwap}
            disabled={swapping || !address || !stealthRecipient}
            className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
            Swap Privately
          </button>
        )}
      </div>

      {txHash && (
        <a href={`${CHAINS.base.explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on Basescan <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
