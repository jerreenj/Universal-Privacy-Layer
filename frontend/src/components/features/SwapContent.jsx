/**
 * SwapContent — Private Swap on Base.
 *
 * Two directions:
 *   ETH → USDC   (forward vault, amount-hidden event)
 *   USDC → ETH   (reverse vault, amount-hidden event, relayer-submitted)
 *
 * The customer picks direction by tapping ETH or USDC on the input.
 * No privacy jargon on screen. The same tile handles both.
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Loader2, ExternalLink, Check, Lock, ArrowDown } from "lucide-react";
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
import {
    getOrCreateProxyWallet,
    checkProxyBalance,
    fundProxyWallet,
} from "@/lib/stealth-proxy";

const FORWARD_ABI = [
  "function swapUSDCViaCommitment(address recipient, bytes32 amountCommit, bytes1 viewTagByte, uint256 minUsdcOut) payable",
  "function quote(uint256 ethIn) view returns (uint256)",
  "function usdcPerEth() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
];
const REVERSE_ABI = [
  "function quote(uint256 usdcIn) view returns (uint256)",
  "function usdcPerEth() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
  "function nextNonce(address) view returns (uint256)",
  "function hashSwapRequest(address recipient, bytes32 amountCommit, bytes1 viewTagByte, uint256 minEthOut, uint256 usdcIn, uint256 deadline, uint256 nonce) view returns (bytes32)",
  "function domainSeparator() view returns (bytes32)",
];

const USDC = {
  symbol: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
};
const FALLBACK_FORWARD = "0x66f71263436da696ec3ffdff925b101585d04e0f";
const FALLBACK_REVERSE = "0xbb983a6222966e3e552bdbcb5fb7620dd34c9526";

export function SwapContent() {
  const { address, chain, signer, fetchBalance, fetchUsdcBalance } = useWallet();
  const [direction, setDirection] = useState("eth2usdc"); // eth2usdc | usdc2eth
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [stealthRecipient, setStealthRecipient] = useState("");
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [forwardVault, setForwardVault] = useState(FALLBACK_FORWARD);
  const [reverseVault, setReverseVault] = useState(FALLBACK_REVERSE);
  const [reserve, setReserve] = useState(null);
  const [rate, setRate] = useState(null);
  const [viewTagHex, setViewTagHex] = useState(null);
  const [proxy, setProxy] = useState(null);
  const [proxyBal, setProxyBal] = useState(null);
  const [proxyBusy, setProxyBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/deployments`);
        const base = r?.data?.evm?.base || {};
        if (!cancelled && base.confidential_swap_wrapper) setForwardVault(base.confidential_swap_wrapper);
        if (!cancelled && base.confidential_reverse_swap) setReverseVault(base.confidential_reverse_swap);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Live reserve + rate for the active vault.
  const activeVault = direction === "eth2usdc" ? forwardVault : reverseVault;
  const activeAbi = direction === "eth2usdc" ? FORWARD_ABI : REVERSE_ABI;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum) : null);
        if (!provider) return;
        const net = await provider.getNetwork();
        if (Number(net.chainId) !== 8453) return;
        const vault = new ethers.Contract(activeVault, activeAbi, provider);
        const [bal, r] = await Promise.all([vault.reserveBalance(), vault.usdcPerEth()]);
        if (cancelled) return;
        setReserve(ethers.formatUnits(bal, direction === "eth2usdc" ? USDC.decimals : 18));
        setRate(ethers.formatUnits(r, USDC.decimals));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [activeVault, signer, direction]);

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

  // Derive the proxy wallet once per main-wallet session. Same
  // wallet → same proxy every time. Cached in localStorage.
  useEffect(() => {
    if (!signer) { setProxy(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const p = await getOrCreateProxyWallet(signer);
        if (!cancelled) setProxy(p);
      } catch { /* customer may reject */ }
    })();
    return () => { cancelled = true; };
  }, [signer]);

  // Check proxy balance whenever proxy changes.
  useEffect(() => {
    if (!proxy || !signer?.provider) { setProxyBal(null); return; }
    let cancelled = false;
    (async () => {
      const provider = signer.provider || (typeof window !== "undefined" && window.ethereum
        ? new ethers.BrowserProvider(window.ethereum) : null);
      if (!provider) return;
      try {
        const bal = await checkProxyBalance(proxy.address, provider, USDC.address);
        if (!cancelled) setProxyBal(bal);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [proxy, signer]);

  const fundProxy = async (ethAmount) => {
    if (!signer || !proxy) return;
    setProxyBusy(true);
    try {
      await fundProxyWallet(signer, proxy.address, ethAmount);
      const provider = signer.provider || new ethers.BrowserProvider(window.ethereum);
      const bal = await checkProxyBalance(proxy.address, provider, USDC.address);
      setProxyBal(bal);
      toast.success(`Proxy funded with ${ethAmount} ETH`);
    } catch (e) { toast.error("Funding failed: " + (e.message || "").slice(0, 60)); }
    setProxyBusy(false);
  };

  const autoGenStealth = async () => {
    if (!address) return toast.error("Connect wallet first");
    try {
      const meta = await deriveMetaAddress(signer, 8453n);
      const stealth = await generateStealthAddress(meta.metaAddress);
      setStealthRecipient(stealth.stealthAddress);
      toast.success("Stealth address generated");
      seal({
        stealth_address: stealth.stealthAddress,
        ephemeral_public_key: stealth.ephemeralPublicKey,
        view_tag: stealth.viewTag,
        chain: "base", tx_type: "stealthMapping", client: "metadata",
      }, signer, address).then((env) => {
        axios.post(`${API}/stealth/store`, { ...env, chain: "base" }).catch(() => {});
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
      if (Number(net.chainId) !== 8453) { toast.error("Switch to Base mainnet"); setLoading(false); return; }
      const vault = new ethers.Contract(activeVault, activeAbi, provider);
      let expectedOut, feeBps = 5n;
      if (direction === "eth2usdc") {
        const amountInWei = ethers.parseEther(amount);
        expectedOut = await vault.quote(amountInWei);
      } else {
        const usdcIn = ethers.parseUnits(amount, USDC.decimals);
        expectedOut = await vault.quote(usdcIn);
      }
      const minOut = (expectedOut * BigInt(10000 - Math.floor(slippageBps))) / 10000n;
      setQuote({
        expectedOut: expectedOut.toString(),
        amountOutMinimum: minOut.toString(),
        rate: rate,
        feeBps: Number(feeBps),
        direction,
      });
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Quote failed");
    }
    setLoading(false);
  };

  const swap = async () => {
    if (!quote) return toast.error("Get a quote first");
    if (!address) return toast.error("Connect wallet");
    if (!stealthRecipient || !ethers.isAddress(stealthRecipient)) return toast.error("Invalid stealth recipient");
    setSwapping(true);
    try {
      const provider = signer?.provider || (typeof window !== "undefined" && window.ethereum
        ? new ethers.BrowserProvider(window.ethereum) : null);
      if (!provider) { toast.error("No wallet"); setSwapping(false); return; }
      const activeSigner = signer || await provider.getSigner();

      if (direction === "eth2usdc") {
        // FORWARD: proxy wallet sends ETH → vault, gets USDC.
        // The customer's MAIN wallet never appears on this swap.
        // Only the proxy wallet is visible — and it's unlinkable
        // to the main wallet except via the one-time funding tx.
        if (!viewTagHex) { toast.error("View tag not ready"); setSwapping(false); return; }
        if (!proxy) { toast.error("Proxy wallet not ready"); setSwapping(false); return; }
        const amountInWei = ethers.parseEther(amount);
        // Check proxy has enough ETH.
        const provider2 = signer?.provider || new ethers.BrowserProvider(window.ethereum);
        const proxyEthBal = await provider2.getBalance(proxy.address);
        if (proxyEthBal < amountInWei) {
          toast.error("Proxy needs funding. Tap 'Fund proxy' below.");
          setSwapping(false); return;
        }
        const rate6dec = ethers.parseUnits(rate || "0", USDC.decimals);
        const args = buildConfidentialSwapArgs({
          ethInWei: amountInWei,
          usdcPerEth6dec: BigInt(rate6dec.toString()),
          feeBps: 5, viewTagHex,
          recipientStealth: stealthRecipient,
          minUsdcOut: BigInt(quote.amountOutMinimum),
        });
        // Sign the swap tx with the PROXY wallet, not the main wallet.
        const vault = new ethers.Contract(activeVault, FORWARD_ABI, proxy.wallet);
        const tx = await vault.swapUSDCViaCommitment(
          args.recipient, args.amountCommit, args.viewTagByte, args.minUsdcOut,
          { value: amountInWei }
        );
        setTxHash(tx.hash);
        toast.success("Swap broadcast");
        await tx.wait();
        toast.success("Confirmed");
      } else {
        // REVERSE: proxy wallet signs EIP-712, proxy's USDC is
        // used. The customer's MAIN wallet never appears. The
        // USDC Transfer(from=vault, to=proxy, ...) event shows
        // the proxy address — unlinkable to main wallet except
        // via the one-time funding tx.
        if (!viewTagHex) { toast.error("View tag not ready"); setSwapping(false); return; }
        if (!proxy) { toast.error("Proxy wallet not ready"); setSwapping(false); return; }
        const usdcIn = ethers.parseUnits(amount, USDC.decimals);
        const ethOut = BigInt(quote.expectedOut);
        const minEthOut = BigInt(quote.amountOutMinimum);
        // Check proxy has enough USDC.
        const usdcRead2 = new ethers.Contract(USDC.address,
          ["function balanceOf(address) view returns (uint256)"], provider);
        const proxyUsdcBal = await usdcRead2.balanceOf(proxy.address);
        if (proxyUsdcBal < usdcIn) {
          toast.error("Proxy needs USDC. Send USDC to your proxy address first.");
          setSwapping(false); return;
        }

        // Build commitment: keccak256(keccak256(ethOut||viewTagByte) || 0x43)
        const inner = ethers.solidityPackedKeccak256(["uint256","bytes1"], [ethOut, viewTagHex]);
        const amountCommit = ethers.solidityPackedKeccak256(["bytes32","uint8"], [inner, 0x43]);
        // Read nonce from the vault — use PROXY address as the customer.
        const vaultRead = new ethers.Contract(activeVault, REVERSE_ABI, provider);
        const nonce = await vaultRead.nextNonce(proxy.address);
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const digest = await vaultRead.hashSwapRequest(
          stealthRecipient, amountCommit, viewTagHex,
          minEthOut, usdcIn, deadline, nonce
        );

        // PROXY wallet signs the EIP-712 digest — not main wallet.
        const sig = await proxy.wallet.signMessage(ethers.getBytes(digest));

        // PROXY wallet approves USDC for the vault (one-time max).
        const cacheKey = `upl:usdc-approve:${proxy.address.toLowerCase()}:${activeVault.toLowerCase()}`;
        let alreadyApproved = false;
        try { alreadyApproved = localStorage.getItem(cacheKey) === "1"; } catch {}
        if (!alreadyApproved) {
          const usdcAllowance = new ethers.Contract(USDC.address,
            ["function allowance(address,address) view returns (uint256)"], provider);
          const currentAllowance = await usdcAllowance.allowance(proxy.address, activeVault);
          if (currentAllowance < usdcIn) {
            const usdcContract = new ethers.Contract(USDC.address,
              ["function approve(address,uint256) returns (bool)"], proxy.wallet);
            const approveTx = await usdcContract.approve(activeVault, ethers.MaxUint256);
            await approveTx.wait();
            toast.success("Proxy USDC approved — one-time setup");
          }
          try { localStorage.setItem(cacheKey, "1"); } catch {}
        }

        // Post to relayer. Customer field = proxy address.
        const resp = await axios.post(`${API}/swap/reverse/relay`, {
          recipient: stealthRecipient,
          amount_commit: amountCommit,
          view_tag_byte: viewTagHex,
          min_eth_out: minEthOut.toString(),
          usdc_in: usdcIn.toString(),
          deadline,
          nonce: nonce.toString(),
          sig,
          customer: proxy.address,
        });
        setTxHash(resp.data.tx_hash);
        toast.success("Swap broadcast via relayer");
      }
      axios.post(`${API}/stealth/use/${address}`, { feature: "swap" }).catch(() => {});
      fetchBalance && fetchBalance();
      fetchUsdcBalance && fetchUsdcBalance();
      setQuote(null); setAmount("");
    } catch (e) {
      toast.error(e.message?.slice(0, 60) || "Swap failed");
    }
    setSwapping(false);
  };

  const isForward = direction === "eth2usdc";
  const inputSymbol = isForward ? "ETH" : "USDC";
  const outputSymbol = isForward ? "USDC" : "ETH";

  return (
    <div className="space-y-4" data-testid="swap-content">
      <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 p-2">
        <Lock className="w-3 h-3" /> Private swap on Base.
      </div>

      {/* Proxy wallet funding banner. Customer funds the proxy ONCE.
          After that, all swaps route through it — main wallet invisible. */}
      {proxy && proxyBal && (
        <div className="border border-white/10 bg-white/5 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">Proxy wallet</span>
            <span className="font-mono text-white/50">{proxy.address.slice(0, 8)}…{proxy.address.slice(-6)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">ETH balance</span>
            <span className="font-mono text-white/70">{parseFloat(proxyBal.eth).toFixed(5)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/40">USDC balance</span>
            <span className="font-mono text-white/70">{parseFloat(proxyBal.usdc).toFixed(2)}</span>
          </div>
          {parseFloat(proxyBal.eth) < 0.001 && (
            <button
              onClick={() => fundProxy("0.005")}
              disabled={proxyBusy}
              className="w-full py-2 border border-blue-400/40 text-blue-300 text-xs hover:bg-blue-500/10 disabled:opacity-50"
            >
              {proxyBusy ? "Funding…" : "Fund proxy (0.005 ETH)"}
            </button>
          )}
        </div>
      )}

      {/* Direction toggle: ETH → USDC  or  USDC → ETH */}
      <div className="flex items-center gap-1 text-xs">
        <button
          data-testid="swap-dir-eth2usdc"
          onClick={() => { setDirection("eth2usdc"); setQuote(null); }}
          className={`flex-1 py-2 border ${isForward ? "border-white bg-white/10 text-white" : "border-white/20 text-white/40 hover:bg-white/5"}`}
        >
          ETH → USDC
        </button>
        <button
          data-testid="swap-dir-usdc2eth"
          onClick={() => { setDirection("usdc2eth"); setQuote(null); }}
          className={`flex-1 py-2 border ${!isForward ? "border-white bg-white/10 text-white" : "border-white/20 text-white/40 hover:bg-white/5"}`}
        >
          USDC → ETH
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Pay ({inputSymbol})</label>
          <input
            data-testid="swap-amount-input"
            type="number"
            value={amount}
            onChange={e => { setAmount(e.target.value); setQuote(null); }}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl font-mono outline-none"
          />
          <div className="text-[10px] text-white/30 mt-1">
            {rate ? `rate: 1 ETH ≈ ${Number(rate).toFixed(2)} USDC` : "loading rate…"}
          </div>
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Get ({outputSymbol})</label>
          <div className="w-full bg-transparent text-base font-semibold outline-none py-1">
            {outputSymbol}
          </div>
          <div className="text-[10px] text-white/30 mt-1">
            {quote
              ? `~${ethers.formatUnits(quote.expectedOut, isForward ? USDC.decimals : 18).slice(0, 8)} ${outputSymbol}`
              : `reserve${reserve ? `: ${Number(reserve).toFixed(2)}` : ""}`}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Slippage (bps)</label>
        <input
          type="number" min="1" max="500"
          value={slippageBps}
          onChange={e => setSlippageBps(Math.max(1, Math.min(500, Number(e.target.value) || 50)))}
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
        />
        <div className="text-[10px] text-white/30 mt-1">{slippageBps / 100}%</div>
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
          <button data-testid="swap-auto-stealth-btn" onClick={autoGenStealth}
            className="px-3 border border-white/20 hover:bg-white/10 text-xs">Auto</button>
          <button data-testid="swap-new-stealth-btn" onClick={autoGenStealth}
            title="Generate a fresh stealth address"
            className="px-3 border border-white/20 hover:bg-white/10 text-xs">New</button>
        </div>
      </div>

      {quote && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-white/40">Expected out</span>
            <span className="font-mono">
              {ethers.formatUnits(quote.expectedOut, isForward ? USDC.decimals : 18).slice(0, 10)} {outputSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Min out (after slippage)</span>
            <span className="font-mono text-green-400">
              {ethers.formatUnits(quote.amountOutMinimum, isForward ? USDC.decimals : 18).slice(0, 10)} {outputSymbol}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!quote ? (
          <button data-testid="swap-quote-btn" onClick={getQuote}
            disabled={loading || !amount || !stealthRecipient}
            className="flex-1 py-3 border border-white/30 hover:bg-white/10 font-bold uppercase tracking-wider text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Get Quote
          </button>
        ) : (
          <button data-testid="swap-btn" onClick={swap}
            disabled={swapping || !address || !stealthRecipient}
            className="flex-1 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
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
