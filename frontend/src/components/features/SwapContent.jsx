/**
 * SwapContent — Private Swap on Base.
 *
 * ETH in, USDC out, paid straight to a stealth recipient.
 * Uses the in-house vault. The customer sees one swap tile — the
 * tile routes through the amount-hidden vault underneath. No
 * mode toggle, no name on the tile.
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Loader2, ExternalLink, Check, Lock } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";
import { deriveMetaAddress, generateStealthAddress } from "@/lib/wallet-stealth";
import {
    buildConfidentialSwapArgs,
    deriveDefaultViewTag,
    quoteConfidentialUsdcOut,
} from "@/lib/confidential-amount";

// Vault ABI. Same contract address on Base; address picked up from
// /api/deployments; hard-coded fallback so first-paint works before
// the backend reloads.
const SWAP_ABI = [
  "function swapUSDCViaCommitment(address recipient, bytes32 amountCommit, bytes1 viewTagByte, uint256 minUsdcOut) payable",
  "function quote(uint256 ethIn) view returns (uint256)",
  "function usdcPerEth() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
];

const USDC = {
  symbol: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
};

const FALLBACK_VAULT = "0x66f71263436da696ec3ffdff925b101585d04e0f";

export function SwapContent() {
  const { address, chain, signer, fetchBalance, fetchUsdcBalance } = useWallet();
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [stealthRecipient, setStealthRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [vaultAddr, setVaultAddr] = useState(FALLBACK_VAULT);
  const [vaultMeta, setVaultMeta] = useState({ network: "base", fallback: true });
  const [reserve, setReserve] = useState(null);
  const [rate, setRate] = useState(null);
  // Session-scoped 1-byte view tag derived from the customer's
  // wallet signature. Persists across quote/swap, regenerates on
  // wallet reconnect.
  const [viewTagHex, setViewTagHex] = useState(null);

  // Resolve the live vault address from /api/deployments.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/deployments`);
        const v = r?.data?.evm?.base?.confidential_swap_wrapper;
        if (!cancelled && v) {
          setVaultAddr(v);
          setVaultMeta({ network: "base", fallback: false });
        }
      } catch { /* fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live reserve + rate from the vault. Cached once per mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum) : null);
        if (!provider) return;
        const net = await provider.getNetwork();
        if (Number(net.chainId) !== 8453) return;
        const vault = new ethers.Contract(vaultAddr, SWAP_ABI, provider);
        const [bal, r] = await Promise.all([vault.reserveBalance(), vault.usdcPerEth()]);
        if (cancelled) return;
        setReserve(ethers.formatUnits(bal, USDC.decimals));
        setRate(ethers.formatUnits(r, USDC.decimals));
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [vaultAddr, signer]);

  // Derive the per-session view tag from the wallet signature. Same
  // HKDF flow we use for stealth meta — no extra wallet popup.
  useEffect(() => {
    if (!signer) { setViewTagHex(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const vt = await deriveDefaultViewTag(signer, 8453n);
        if (!cancelled) setViewTagHex(vt);
      } catch { if (!cancelled) setViewTagHex(null); }
    })();
    return () => { cancelled = true; };
  }, [signer]);

  // Auto-generate a stealth recipient for the customer's meta.
  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      const meta = await deriveMetaAddress(signer, 8453n);
      const stealth = await generateStealthAddress(meta.metaAddress);
      setStealthRecipient(stealth.stealthAddress);
      toast.success("Stealth address generated");
      seal({
        stealth_address:      stealth.stealthAddress,
        ephemeral_public_key: stealth.ephemeralPublicKey,
        view_tag:             stealth.viewTag,
        chain:                "base",
        tx_type:              "stealthMapping",
        client:               "metadata",
      }, signer, address).then((envelope) => {
        axios.post(`${API}/stealth/store`, { ...envelope, chain: "base" }).catch(() => {});
      }).catch(() => {});
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
      const vault = new ethers.Contract(vaultAddr, SWAP_ABI, provider);
      const [expectedOut, r, bal] = await Promise.all([
        vault.quote(amountInWei),
        vault.usdcPerEth(),
        vault.reserveBalance(),
      ]);
      if (bal < expectedOut) {
        toast.error("Vault reserves too low for this amount");
        setLoading(false);
        return;
      }
      // Vault fee is hardcoded 5 bps inside the contract (matches the
      // standard NativePrivateSwap value).
      const feeBps = 5n;
      const minOut = (expectedOut * BigInt(10000 - Math.floor(slippageBps))) / 10000n;
      const fee = (amountInWei * feeBps) / 10000n;
      setReserve(ethers.formatUnits(bal, USDC.decimals));
      setRate(ethers.formatUnits(r, USDC.decimals));
      setQuote({
        amountIn: (amountInWei - fee).toString(),
        amountInWithFee: amountInWei.toString(),
        fee: fee.toString(),
        feeBps: Number(feeBps),
        expectedOut: expectedOut.toString(),
        amountOutMinimum: minOut.toString(),
        outputToken: USDC,
        rate: ethers.formatUnits(r, USDC.decimals),
        vault: vaultAddr,
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
    if (!viewTagHex) {
      toast.error("View tag not ready — reconnect wallet and try again");
      return;
    }
    setSwapping(true);
    try {
      const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
        ? new ethers.BrowserProvider(window.ethereum) : null);
      if (!provider) { toast.error("No wallet connected"); setSwapping(false); return; }
      const activeSigner = signer || await provider.getSigner();
      if (!activeSigner) { toast.error("No signer"); setSwapping(false); return; }
      const vault = new ethers.Contract(vaultAddr, SWAP_ABI, activeSigner);
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
      const tx = await vault.swapUSDCViaCommitment(
        args.recipient,
        args.amountCommit,
        args.viewTagByte,
        args.minUsdcOut,
        { value: quote.amountInWithFee }
      );
      setTxHash(tx.hash);
      toast.success("Swap broadcast");
      axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      await tx.wait();
      const previewAmt = quoteConfidentialUsdcOut(
        BigInt(quote.amountInWithFee),
        ethers.parseUnits(quote.rate || "0", USDC.decimals),
        quote.feeBps || 5,
      );
      toast.success(`Confirmed — ${ethers.formatUnits(previewAmt, USDC.decimals).slice(0, 8)} ${USDC.symbol} to stealth`);
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
          ...envelope, chain: "base", tx_type: "private_swap", status: "confirmed",
        }).catch(() => {});
      }).catch(() => {});
      fetchBalance && fetchBalance();
      fetchUsdcBalance && fetchUsdcBalance();
      setQuote(null); setAmount("");
    } catch (e) {
      toast.error(e.message?.slice(0, 60) || "Swap failed");
    }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="swap-content">
      <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 p-2">
        <Lock className="w-3 h-3" /> Private swap on Base. ETH in, USDC to a stealth recipient.
      </div>

      {vaultMeta?.fallback && (
        <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 p-2">
          Waiting for /api/deployments to refresh.
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
            {rate ? `vault rate: 1 ETH ≈ ${Number(rate).toFixed(2)} USDC` : "loading rate…"}
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
              : `vault reserve${reserve ? `: ${Number(reserve).toFixed(2)} ${USDC.symbol}` : ""}`}
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
            <span className="font-mono text-[10px]">Private swap vault (in-house)</span>
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
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Get Quote
          </button>
        ) : (
          <button
            data-testid="swap-btn"
            onClick={swap}
            disabled={swapping || !address || !stealthRecipient || !viewTagHex}
            className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Swap
          </button>
        )}
      </div>

      {txHash && (
        <a href={`${CHAINS[chain]?.explorer || "https://basescan.org"}/tx/${txHash}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
