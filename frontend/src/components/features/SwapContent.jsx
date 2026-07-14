/**
 * SwapContent — Private Swap on Base.
 *
 * Two directions:
 *   USDC → ETH   (stealth signs permit, relayer swaps on Uniswap V3)
 *   ETH → USDC   (stealth sends ETH, relayer swaps on Uniswap V3)
 *
 * No vault. Real market price via Uniswap V3. The stealth signs
 * locally (no gas needed for USDC→ETH). The relayer does the
 * actual on-chain swap and sends the output to the recipient.
 *
 * Uses the stealth address from the user's local archive as the
 * sender. Auto button fills the user's own stealth address as
 * the recipient. The "You Get" column shows the expected output
 * amount live as the user types.
 *
 * No proxy wallet, no privacy pool funding, no view tags on the
 * UI. Just: pick direction → enter amount → see output → swap.
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Loader2, ExternalLink, Check, Lock, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { getAddressArchive } from "@/lib/wallet-stealth";
import { readUsdcBalance, readEthBalance } from "@/lib/balance-reader";

// No vault — swap goes through Uniswap V3 via the relayer.
const UNISWAP_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C0CEdAbf5";
const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_ADDR = "0x4200000000000000000000000000000000000006";

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)",
];

const RPCS = [
  "https://base.publicnode.com",
  "https://mainnet.base.org",
  "https://1rpc.io/base",
];

async function getProvider() {
  for (const rpc of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      return p;
    } catch {}
  }
  return new ethers.JsonRpcProvider(RPCS[0]);
}

export function SwapContent() {
  const { address, chain, signer, fetchBalance, fetchUsdcBalance, fetchStealthBalance } = useWallet();
  const [direction, setDirection] = useState("usdc2eth"); // usdc2eth | eth2usdc
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [expectedOut, setExpectedOut] = useState("");
  const [rate, setRate] = useState(null);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [stealthInfo, setStealthInfo] = useState(null); // {address, privateKey, usdcBalance, ethBalance}

  const isUSDC2ETH = direction === "usdc2eth";
  const inputSymbol = isUSDC2ETH ? "USDC" : "ETH";
  const outputSymbol = isUSDC2ETH ? "ETH" : "USDC";

  // Live quote: calculate expected output using a cached rate.
  // The rate is fetched ONCE on mount from a fast price API,
  // not from the Uniswap quoter (which was too slow — each
  // keystroke triggered an RPC call that took 2-3 seconds).
  const [cachedRate, setCachedRate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch ETH price from a fast public API.
        const resp = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
        const data = await resp.json();
        const ethPrice = parseFloat(data?.data?.amount || "2500");
        if (!cancelled) setCachedRate(ethPrice.toString());
      } catch {
        if (!cancelled) setCachedRate("2500"); // fallback
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0 || !cachedRate) {
      setExpectedOut("");
      return;
    }
    if (isUSDC2ETH) {
      // USDC → ETH: usdcAmount / ethPrice = ethAmount
      const usdcIn = parseFloat(amount);
      const ethOut = usdcIn / parseFloat(cachedRate);
      setExpectedOut(ethOut.toFixed(8));
      setRate(cachedRate);
    } else {
      // ETH → USDC: ethAmount * ethPrice = usdcAmount
      const ethIn = parseFloat(amount);
      const usdcOut = ethIn * parseFloat(cachedRate);
      setExpectedOut(usdcOut.toFixed(2));
      setRate(cachedRate);
    }
  }, [amount, cachedRate, direction]);
  useEffect(() => {
    if (!address) { setStealthInfo(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const list = getAddressArchive(address);
        if (!list.length) { if (!cancelled) setStealthInfo(null); return; }
        // Find the stealth with the highest USDC balance (for USDC→ETH)
        // or highest ETH balance (for ETH→USDC).
        const probes = await Promise.all(list.map(async (entry) => {
          try {
            const usdc = await readUsdcBalance(entry.address);
            const eth = await readEthBalance(entry.address);
            return { entry, usdc, eth };
          } catch { return { entry, usdc: 0n, eth: 0n }; }
        }));
        if (cancelled) return;
        // Pick the one with the most of the INPUT token.
        const sorted = probes.sort((a, b) =>
          isUSDC2ETH
            ? (b.usdc > a.usdc ? 1 : -1)
            : (b.eth > a.eth ? 1 : -1)
        );
        const best = sorted[0];
        if (best) {
          setStealthInfo({
            address: best.entry.address,
            privateKey: best.entry.privateKey,
            usdcBalance: ethers.formatUnits(best.usdc, 6),
            ethBalance: ethers.formatEther(best.eth),
          });
        }
      } catch { if (!cancelled) setStealthInfo(null); }
    })();
    return () => { cancelled = true; };
  }, [address, direction]);

  // Live quote: calculate expected output as the user types.
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0 || !rate) {
      setExpectedOut("");
      return;
    }
    if (isUSDC2ETH) {
      // USDC → ETH: usdcAmount / rate = ethAmount
      const usdcIn = parseFloat(amount);
      const ethOut = usdcIn / parseFloat(rate);
      setExpectedOut(ethOut.toFixed(8));
    } else {
      // ETH → USDC: ethAmount * rate = usdcAmount
      const ethIn = parseFloat(amount);
      const usdcOut = ethIn * parseFloat(rate);
      setExpectedOut(usdcOut.toFixed(2));
    }
  }, [amount, rate, direction]);

  // Auto: fill the user's own stealth address as recipient.
  const autoFillRecipient = () => {
    if (stealthInfo) {
      setRecipient(stealthInfo.address);
      toast.success("Filled with your stealth address");
    } else {
      // Try to get from archive directly
      const list = getAddressArchive(address);
      if (list.length > 0) {
        setRecipient(list[0].address);
        toast.success("Filled with your stealth address");
      } else {
        toast.error("Generate a stealth address in Private Receive first");
      }
    }
  };

  const doSwap = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    if (!recipient) return toast.error("Enter a recipient address");
    if (!ethers.isAddress(recipient)) return toast.error("Invalid recipient address");
    if (!stealthInfo) return toast.error("No stealth address available — generate one first");

    setSwapping(true);
    try {
      if (isUSDC2ETH) {
        // USDC → ETH: stealth signs permit, relayer swaps on Uniswap V3.
        // Stealth needs ZERO ETH for gas — relayer pays everything.
        // Sender is hidden: only the relayer appears on BaseScan.
        const amountRaw = ethers.parseUnits(amount, 6);

        // Check stealth has enough USDC.
        const stealthUsdc = await readUsdcBalance(stealthInfo.address);
        if (stealthUsdc < amountRaw) {
          toast.error(`Stealth only has ${ethers.formatUnits(stealthUsdc, 6)} USDC. Deposit more first.`);
          setSwapping(false);
          return;
        }

        // Read USDC nonce for the permit signature.
        const { readUsdcNonce, readUsdcName, readUsdcVersion } =
          await import("@/lib/balance-reader");
        const stealthWallet = new ethers.Wallet(stealthInfo.privateKey);
        const [nonce, name, version] = await Promise.all([
          readUsdcNonce(stealthWallet.address),
          readUsdcName().catch(() => "USD Coin"),
          readUsdcVersion().catch(() => "2"),
        ]);

        // Get relayer address from backend.
        const prepRes = await axios.post(`${API}/usdc-permit-forwarder/prepare-tx`, {
          from_address: address,
          stealth_source: stealthInfo.address,
          recipient,
          amount,
          chain: "base",
        });
        const spender = prepRes.data.relayer_address;
        const chainId = prepRes.data.chainId;

        // Sign the permit with the stealth key locally (no wallet popup).
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const domain = { name, version, chainId, verifyingContract: USDC_ADDR };
        const types = {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        };
        const message = {
          owner: stealthWallet.address,
          spender,
          value: amountRaw.toString(),
          nonce: nonce.toString(),
          deadline,
        };
        const sig = await stealthWallet.signTypedData(domain, types, message);
        const { v, r, s } = ethers.Signature.from(sig);

        // Submit via the native swap relay — relayer does the swap
        // on Uniswap V3 and sends ETH to the recipient. Sender hidden.
        await axios.post(`${API}/swap/native-relay`, {
          stealth_source: stealthInfo.address,
          recipient,
          amount_raw: amountRaw.toString(),
          spender,
          deadline,
          v,
          r,
          s,
        });

        // Silent success — just refresh balances. No toast spam.
      } else {
        // ETH → USDC: stealth signs permit is not possible for ETH.
        // Instead, stealth sends ETH to relayer, relayer swaps on
        // Uniswap V3 and sends USDC to recipient.
        // Stealth needs a tiny bit of ETH for gas.
        const provider = await getProvider();
        const stealthWallet = new ethers.Wallet(stealthInfo.privateKey, provider);
        const amountWei = ethers.parseEther(amount);

        const stealthEth = await readEthBalance(stealthInfo.address);
        if (stealthEth < amountWei + 100000n) {
          toast.error(`Stealth needs ETH for gas. Current: ${ethers.formatEther(stealthEth)} ETH.`);
          setSwapping(false);
          return;
        }

        // Send ETH from stealth to relayer. Relayer swaps on Uniswap
        // and sends USDC to the recipient.
        const prepRes = await axios.post(`${API}/usdc-permit-forwarder/prepare-tx`, {
          from_address: address,
          stealth_source: stealthInfo.address,
          recipient,
          amount,
          chain: "base",
        });
        const relayerAddr = prepRes.data.relayer_address;

        // Send ETH to relayer — stealth pays gas for this one tx.
        const tx = await stealthWallet.sendTransaction({
          to: relayerAddr,
          value: amountWei,
        });
        await tx.wait();

        // Tell backend to swap the ETH → USDC on Uniswap and send
        // USDC to the recipient.
        await axios.post(`${API}/swap/native-relay-eth`, {
          stealth_source: stealthInfo.address,
          recipient,
          amount: amount,
          chain: "base",
        });

        // Silent success — just refresh balances.
      }

      // Refresh balances silently — dashboard updates automatically.
      fetchBalance && fetchBalance();
      fetchUsdcBalance && fetchUsdcBalance();
      try { if (typeof fetchStealthBalance === "function") await fetchStealthBalance(); } catch {}
      setAmount("");
      setExpectedOut("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Swap failed";
      toast.error(msg);
    }
    setSwapping(false);
  };

  return (
    <div className="space-y-4" data-testid="swap-content">
      <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 p-2">
        <Lock className="w-3 h-3" /> Private swap on Base — routed through your stealth address.
      </div>

      {/* Stealth balance display */}
      {stealthInfo && (
        <div className="bg-white/5 border border-white/10 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-white/40">Stealth address</span>
            <span className="font-mono text-white/50">{stealthInfo.address.slice(0, 8)}…{stealthInfo.address.slice(-6)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">USDC balance</span>
            <span className="font-mono text-white/70">{parseFloat(stealthInfo.usdcBalance).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/40">ETH balance</span>
            <span className="font-mono text-white/70">{parseFloat(stealthInfo.ethBalance).toFixed(5)}</span>
          </div>
        </div>
      )}

      {/* Direction toggle */}
      <div className="flex items-center gap-1 text-xs">
        <button
          data-testid="swap-dir-usdc2eth"
          onClick={() => { setDirection("usdc2eth"); setAmount(""); setExpectedOut(""); }}
          className={`flex-1 py-2 border ${isUSDC2ETH ? "border-white bg-white/10 text-white" : "border-white/20 text-white/40 hover:bg-white/5"}`}
        >
          USDC → ETH
        </button>
        <button
          data-testid="swap-dir-eth2usdc"
          onClick={() => { setDirection("eth2usdc"); setAmount(""); setExpectedOut(""); }}
          className={`flex-1 py-2 border ${!isUSDC2ETH ? "border-white bg-white/10 text-white" : "border-white/20 text-white/40 hover:bg-white/5"}`}
        >
          ETH → USDC
        </button>
      </div>

      {/* You Pay / You Get */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Pay ({inputSymbol})</label>
          <input
            data-testid="swap-amount-input"
            type="number"
            value={amount}
            onChange={e => { setAmount(e.target.value); }}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl font-mono outline-none"
          />
          <div className="text-[10px] text-white/30 mt-1">
            {rate ? `rate: 1 ETH ≈ ${Number(rate).toFixed(2)} USDC` : "loading rate…"}
          </div>
        </div>
        <div className="bg-white/5 border border-white/20 p-4">
          <label className="block text-xs text-gray-500 uppercase mb-2">You Get ({outputSymbol})</label>
          <div className="w-full bg-transparent text-2xl font-mono outline-none py-1">
            {expectedOut || "0.0"}
          </div>
          <div className="text-[10px] text-white/30 mt-1">
            {rate ? `rate: 1 ${inputSymbol} ≈ ${rate} ${outputSymbol}` : "fetching rate…"}
          </div>
        </div>
      </div>

      {/* Recipient */}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Address</label>
        <div className="flex gap-2">
          <input
            data-testid="swap-recipient-input"
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="0x..."
            className="flex-1 bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white"
          />
          <button data-testid="swap-auto-stealth-btn" onClick={autoFillRecipient}
            className="px-3 border border-white/20 hover:bg-white/10 text-xs">Auto</button>
        </div>
      </div>

      {/* Swap button */}
      <button data-testid="swap-btn" onClick={doSwap}
        disabled={swapping || !amount || !recipient}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {swapping ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
        Swap {inputSymbol} → {outputSymbol}
      </button>

      {/* Tx hash link */}
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
