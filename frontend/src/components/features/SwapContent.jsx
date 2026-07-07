/**
 * SwapContent — the **native** private swap on Base.
 *
 * Mounted on the Core Actions grid via the 'Private Swap' tile. This is the
 * in-house baseline: ETH in, USDC out, paid straight to a stealth recipient
 * via NativePrivateSwap.swapETHForUSDC (the in-house vault at
 * 0x58..d09, deployed via contracts/script/DeployNative.s.sol and surfaced
 * by backend /api/deployments as `native_swap_wrapper`).
 *
 * Kept deliberately different from AerodromePrivateSwap (the third-party
 * picker) which mounts on the PrivateDeFi 'All in One Swap' tile. The Core
 * 'Private Swap' tile is **owned by us** — no Aerodrome, no third-party
 * router; USDC reserves sit in the vault and the vault pays the stealth
 * recipient directly. The third-party Tile keeps the Aerodrome wrapper for
 * customers who explicitly want to route through Aerodrome.
 *
 * Quote path uses two read-only calls:
 *   - vault.usdcPerEth()  — the per-ETH 6-decimal rate
 *   - vault.quote(ethIn) — exact-USDC-out from the vault's own formula
 *     (matches what the contract computes inside _executeSwap), so the
 *     preview is byte-for-byte the amount the tx will deliver (no race
 *     against a public-router pricing curve).
 *
 * Switch path is one wallet tx: it hands ETH straight to the vault, the
 * vault deducts 5 bps protocol fee, sends the fee on-chain to feeRecipient,
 * and credits the equivalent USDC straight to the stealth recipient. No
 * third-party swap logs, no WETH leg, no router. The customer's EOA
 * appears exactly once on-chain as the msg.sender of swapETHForUSDC;
 * the stealth EOA is the `recipient` parameter. Recipients are linked
 * only by the wallet-derived sealed record on /api/transactions/record,
 * never by an on-chain hop.
 *
 * After settlement we record the tx to /api/transactions/record so it shows
 * up in the customer's Transaction History tile — and only there. No
 * counter is added to the swap tile, no banner anywhere else.
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { RefreshCw, Loader2, ExternalLink, Check, Lock, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";
import { deriveMetaAddress, generateStealthAddress } from "@/lib/wallet-stealth";
import {
    buildConfidentialCommitment,
    buildConfidentialSwapArgs,
    deriveDefaultViewTag,
    quoteConfidentialUsdcOut,
} from "@/lib/confidential-amount";

// NativePrivateSwap ABI — only the calls the customer surface makes.
const NATIVE_SWAP_ABI = [
  "function swapETHForUSDC(address recipient, uint256 minUsdcOut) payable returns (uint256)",
  "function quote(uint256 ethIn) view returns (uint256)",
  "function usdcPerEth() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
  "function USDC() view returns (address)",
  "function feeBps() view returns (uint256)",
  "function feeRecipient() view returns (address)",
  "function owner() view returns (address)",
];

// ConfidentialNativePrivateSwap ABI — same vault mechanics; the swap
// entry point REQUIRES a 32-byte commitment + 1-byte view tag in
// place of a plaintext usdcOut, so the swap event on BaseScan shows
// only the commitment, not the amount.
const CONFIDENTIAL_SWAP_ABI = [
  "function swapUSDCViaCommitment(address recipient, bytes32 amountCommit, bytes1 viewTagByte, uint256 minUsdcOut) payable",
  "function lookupCommitment(bytes32 commit) view returns (address recipient, address sender, uint256 amount, uint256 ethIn, uint256 fee, uint256 timestamp)",
  "function quote(uint256 ethIn) view returns (uint256)",
  "function usdcPerEth() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
  "function USDC() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function owner() view returns (address)",
];

// USDC on Base mainnet — the only output token our NativePrivateSwap vault
// holds reserves for. Address is kept as a constant so the customer UI is
// self-explanatory ("ETH -> USDC"). Any future WETH/USDT/wBTC extension
// would add a parallel vault, not a token picker here.
const USDC = {
  symbol: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
};

// Hard-coded fallback for the vault — confirms the broadcast address
// from contracts/deployed_base.json if /api/deployments hasn't reloaded.
const FALLBACK_VAULT = "0x582c57a7ba6e7758e75dc5334a5e8ff096515d09";
// Hard-coded fallback for the new confidential vault (amount-hidden
// variant — emits bytes32 commitment instead of plaintext usdcOut).
const FALLBACK_CONFIDENTIAL_VAULT = "0x66f71263436da696ec3ffdff925b101585d04e0f";

export function SwapContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50); // 0.5 %
  const [stealthRecipient, setStealthRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [vaultAddr, setVaultAddr] = useState(FALLBACK_VAULT);
  const [confidentialVaultAddr, setConfidentialVaultAddr] = useState(FALLBACK_CONFIDENTIAL_VAULT);
  const [vaultMeta, setVaultMeta] = useState({ network: "base", fallback: false });
  const [confidentialMeta, setConfidentialMeta] = useState({ network: "base", fallback: true });
  const [reserve, setReserve] = useState(null);
  const [usdcPerEth, setUsdcPerEth] = useState(null);
  const [confidentialReserve, setConfidentialReserve] = useState(null);
  const [confidentialUsdcPerEth, setConfidentialUsdcPerEth] = useState(null);
  // Privacy mode — 'native' (default) keeps the existing flow untouched.
  // 'confidential' routes through ConfidentialNativePrivateSwap, which
  // emits a 32-byte commitment instead of plaintext usdcOut.
  const [mode, setMode] = useState("native");
  const [viewTagHex, setViewTagHex] = useState(null);

  // Resolve the live vault address(es) from /api/deployments.
  // NativePrivateSwap → 'native_swap_wrapper' (existing flow).
  // ConfidentialNativePrivateSwap → 'confidential_swap_wrapper' (new flow).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/deployments`);
        const base = (r.data && r.data.evm && r.data.evm.base) || {};
        if (!cancelled && base.native_swap_wrapper) {
          setVaultAddr(base.native_swap_wrapper);
          setVaultMeta({ network: "base", fallback: false });
        }
        if (!cancelled && base.confidential_swap_wrapper) {
          setConfidentialVaultAddr(base.confidential_swap_wrapper);
          setConfidentialMeta({ network: "base", fallback: false });
        } else {
          setConfidentialVaultAddr(FALLBACK_CONFIDENTIAL_VAULT);
          setConfidentialMeta({ network: "base", fallback: true });
        }
      } catch {
        if (!cancelled) {
          setVaultAddr(FALLBACK_VAULT);
          setVaultMeta({ network: "base", fallback: true });
          setConfidentialVaultAddr(FALLBACK_CONFIDENTIAL_VAULT);
          setConfidentialMeta({ network: "base", fallback: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pull live reserve + rate so the customer sees current liquidity
  // alongside the swap form. Cached once per mount — no need to
  // re-poll; the rates are owner-set and update only on broadcast.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum) : null);
        if (!provider) return;
        const net = await provider.getNetwork();
        if (Number(net.chainId) !== 8453) return;
        const vault = new ethers.Contract(vaultAddr, NATIVE_SWAP_ABI, provider);
        const [bal, rate] = await Promise.all([
          vault.reserveBalance(),
          vault.usdcPerEth(),
        ]);
        if (cancelled) return;
        setReserve(ethers.formatUnits(bal, USDC.decimals));
        setUsdcPerEth(ethers.formatUnits(rate, USDC.decimals));
      } catch { /* silent — fallback UI shows rate within quote step */ }
    })();
    return () => { cancelled = true; };
  }, [vaultAddr, signer]);

  // Pull live reserve + rate for the confidential vault too. Same
  // CACHED-once-per-mount pattern; only re-polls when the address or
  // signer changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum) : null);
        if (!provider) return;
        const net = await provider.getNetwork();
        if (Number(net.chainId) !== 8453) return;
        const v = new ethers.Contract(confidentialVaultAddr, CONFIDENTIAL_SWAP_ABI, provider);
        const [bal, rate] = await Promise.all([
          v.reserveBalance(),
          v.usdcPerEth(),
        ]);
        if (cancelled) return;
        setConfidentialReserve(ethers.formatUnits(bal, USDC.decimals));
        setConfidentialUsdcPerEth(ethers.formatUnits(rate, USDC.decimals));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [confidentialVaultAddr, signer]);

  // Wallet-derived 1-byte view tag for the confidential commitment.
  // Re-derived on signer reconnect or mode flip — same HKDF-style flow
  // we already use for stealth meta so the customer doesn't carry a
  // separate secret.
  useEffect(() => {
    let cancelled = false;
    if (mode !== "confidential" || !signer) {
      if (!cancelled) setViewTagHex(null);
      return undefined;
    }
    (async () => {
      try {
        const vt = await deriveDefaultViewTag(signer, 8453n);
        if (!cancelled) setViewTagHex(vt);
      } catch { if (!cancelled) setViewTagHex(null); }
    })();
    return () => { cancelled = true; };
  }, [mode, signer]);

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      // Wallet-derived meta via HKDF-SHA-256 over a chain-scoped
      // personal_sign (see frontend/src/lib/wallet-stealth.js).
      // No backend round-trip — the customer's meta-address is
      // regenerated every time from the same personal_sign on any device.
      const meta = await deriveMetaAddress(signer, 8453n);
      const stealth = await generateStealthAddress(meta.metaAddress);
      setStealthRecipient(stealth.stealthAddress);
      toast.success("Stealth address generated");
      // K4 follow-up: seal + store the (EOA <-> stealth_address) mapping
      // server-side so the row the backend stores is unreadable cipher-
      // text, not plaintext. Fire-and-forget — a backend hiccup must
      // not block the customer's swap.
      seal({
        stealth_address:      stealth.stealthAddress,
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
      const amountInWei = ethers.parseEther(amount);

      // Pick the right vault + ABI based on the privacy mode toggle.
      // NativePrivateSwap exposes feeBps() on-chain; the Confidential
      // vault hard-codes 5 bps internally so we read it as a constant.
      const isConfidential = mode === "confidential";
      const targetVault = isConfidential ? confidentialVaultAddr : vaultAddr;
      const abi = isConfidential ? CONFIDENTIAL_SWAP_ABI : NATIVE_SWAP_ABI;
      const feeBpsOnChain = isConfidential ? 5n : null;

      // Read straight from the vault: quote(ethIn) is what the contract
      // will pay the recipient post-fee. We then apply slippage to the
      // result so the customer's "Get Quote" preview is the exact
      // number they'll see in the wallet prompt for `minUsdcOut`.
      const vault = new ethers.Contract(targetVault, abi, provider);
      const expectedOut = await vault.quote(amountInWei);
      const rate = await vault.usdcPerEth();
      const bal = await vault.reserveBalance();
      const feeBps = isConfidential ? feeBpsOnChain : await vault.feeBps();

      if (bal < expectedOut) {
        toast.error("Vault reserves too low for this amount");
        setLoading(false);
        return;
      }

      const minOut = (expectedOut * BigInt(10000 - Math.floor(slippageBps))) / 10000n;
      const fee = (amountInWei * BigInt(feeBps)) / 10000n;

      if (rate && reserve !== ethers.formatUnits(bal, USDC.decimals)) {
        // re-render headline numbers
        setReserve(ethers.formatUnits(bal, USDC.decimals));
        setUsdcPerEth(ethers.formatUnits(rate, USDC.decimals));
      }

      setQuote({
        amountIn: (amountInWei - fee).toString(),
        amountInWithFee: amountInWei.toString(),
        fee: fee.toString(),
        feeBps: Number(feeBps),
        expectedOut: expectedOut.toString(),
        amountOutMinimum: minOut.toString(),
        outputToken: USDC,
        rate: ethers.formatUnits(rate, USDC.decimals),
        vault: targetVault,
        mode,
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

      const isConfidential = mode === "confidential";
      const targetVault = isConfidential ? confidentialVaultAddr : vaultAddr;
      const abi = isConfidential ? CONFIDENTIAL_SWAP_ABI : NATIVE_SWAP_ABI;

      const vault = new ethers.Contract(targetVault, abi, activeSigner);

      let tx;
      if (isConfidential) {
        // To hide the USDC output amount on BaseScan the customer
        // passes a 32-byte commitment (Pedersen-style) and a 1-byte
        // view tag. The vault re-derives the commitment from its own
        // computed usdcOut + viewTagByte and reverts on mismatch.
        if (!viewTagHex) {
          toast.error("View tag not ready — reconnect wallet and try again");
          setSwapping(false); return;
        }
        const rate6dec = ethers.parseUnits(quote.rate || "0", USDC.decimals);
        const args = buildConfidentialSwapArgs({
          ethInWei: BigInt(quote.amountInWithFee),
          usdcPerEth6dec: BigInt(rate6dec.toString()),
          feeBps: quote.feeBps || 5,
          viewTagHex,
          recipientStealth: stealthRecipient,
          minUsdcOut: BigInt(quote.amountOutMinimum),
        });
        setTxHash(null);
        tx = await vault.swapUSDCViaCommitment(
          args.recipient,
          args.amountCommit,
          args.viewTagByte,
          args.minUsdcOut,
          { value: quote.amountInWithFee }
        );
        toast.success("Confidential swap broadcast — USDC amount hidden on-chain");
      } else {
        tx = await vault.swapETHForUSDC(
          stealthRecipient,
          quote.amountOutMinimum,
          { value: quote.amountInWithFee }
        );
        toast.success("Private swap broadcast");
      }
      setTxHash(tx.hash);
      // Stealth-use counter (used in the backend for stats).
      axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      await tx.wait();
      const previewAmt = isConfidential
        ? quoteConfidentialUsdcOut(BigInt(quote.amountInWithFee),
            ethers.parseUnits(quote.rate || "0", USDC.decimals), quote.feeBps || 5)
        : BigInt(quote.expectedOut);
      toast.success(`Confirmed — ${ethers.formatUnits(previewAmt, USDC.decimals).slice(0, 8)} ${USDC.symbol} to stealth`);
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
        <Lock className="w-3 h-3" /> Native private swap on Base via our in-house vault — ETH in, USDC to a stealth recipient. No third-party router.
      </div>

      {/* Privacy-mode toggle. Default = native (existing flow untouched).
          Confidential = the new ConfidentialityNativePrivateSwap vault
          whose swap event hides the USDC out amount via a 32-byte
          Pedersen-style commitment. */}
      <div className="flex items-center gap-1 text-xs">
        <button
          data-testid="swap-mode-native"
          onClick={() => setMode("native")}
          className={`px-3 py-1 border ${mode === "native" ? "border-white bg-white text-black" : "border-white/20 hover:bg-white/10"} uppercase tracking-wider`}
        >Standard Private</button>
        <button
          data-testid="swap-mode-confidential"
          onClick={() => setMode("confidential")}
          className={`px-3 py-1 border flex items-center gap-1 ${mode === "confidential" ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-white/20 hover:bg-white/10"} uppercase tracking-wider`}
        >
          <EyeOff className="w-3 h-3" />Amount-Hidden
        </button>
      </div>

      {mode === "confidential" && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 p-2">
          Confidential swap: BaseScan will show a 32-byte commitment instead of the USDC out amount.
          {" "}msg.value (ETH input) is still visible — only the USDC leg is hidden.
          {confidentialMeta?.fallback && (
            <span className="block text-yellow-300 mt-1">Using hard-coded confidential vault fallback (waiting for /api/deployments to refresh).</span>
          )}
          {viewTagHex && (
            <span className="block text-white/60 mt-1">View tag (session): <span className="font-mono">{viewTagHex}</span></span>
          )}
        </div>
      )}

      {vaultMeta?.fallback && mode === "native" && (
        <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 p-2">
          Using hard-coded vault fallback (waiting for /api/deployments to refresh).
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
          <div className="text-[10px] text-white/30 mt-1">
            {mode === "confidential"
              ? (confidentialUsdcPerEth
                  ? `confidential vault rate: 1 ETH ≈ ${Number(confidentialUsdcPerEth).toFixed(2)} USDC`
                  : "via ConfidentialNativePrivateSwap vault")
              : (usdcPerEth
                  ? `vault rate: 1 ETH ≈ ${Number(usdcPerEth).toFixed(2)} USDC`
                  : "via NativePrivateSwap vault")
            }
          </div>
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Get</label>
          <div
            data-testid="swap-output-token"
            className="w-full bg-transparent text-base font-semibold outline-none py-1"
          >
            {USDC.symbol}
          </div>
          <div className="text-[10px] text-white/30 mt-1">
            {quote
              ? `~${ethers.formatUnits(quote.expectedOut, USDC.decimals).slice(0, 8)} ${USDC.symbol}`
              : (mode === "confidential"
                  ? `confidential vault reserve${confidentialReserve ? `: ${Number(confidentialReserve).toFixed(2)} ${USDC.symbol}` : ""}`
                  : `vault reserve${reserve ? `: ${Number(reserve).toFixed(2)} ${USDC.symbol}` : ""}`)}
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
          <button
            data-testid="swap-new-stealth-btn"
            onClick={autoGenStealth}
            title="Generate a fresh stealth address — same as Auto, callable as many times as you want"
            className="px-3 border border-white/20 hover:bg-white/10 text-xs"
          >
            New
          </button>
        </div>
      </div>

      {quote && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-white/40">Input (after {quote.feeBps} bps fee)</span>
            <span className="font-mono">{ethers.formatEther(quote.amountIn).slice(0, 10)} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Vault rate</span>
            <span className="font-mono">{Number(quote.rate).toFixed(2)} USDC / ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Expected out</span>
            <span className="font-mono">
              {ethers.formatUnits(quote.expectedOut, quote.outputToken.decimals).slice(0, 10)} {USDC.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Min out (after slippage)</span>
            <span className="font-mono text-green-400">
              {ethers.formatUnits(quote.amountOutMinimum, quote.outputToken.decimals).slice(0, 10)} {USDC.symbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Route</span>
            <span className="font-mono text-[10px]">
              {mode === "confidential"
                ? "ConfidentialNativePrivateSwap vault (in-house, amount-hidden)"
                : "NativePrivateSwap vault (in-house)"}
            </span>
          </div>
          {mode === "confidential" && viewTagHex && (
            <div className="flex justify-between">
              <span className="text-white/40">Commitment preview</span>
              <span className="font-mono text-[9px] truncate ml-2" title={buildConfidentialCommitment(
                  BigInt(quote.expectedOut), viewTagHex)}>
                {buildConfidentialCommitment(
                  BigInt(quote.expectedOut), viewTagHex).slice(0, 18)}…
              </span>
            </div>
          )}
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
