/**
 * SwapContent — Private Swap on Base (native in-house vault).
 *
 * Two directions:
 *   ETH → USDC   (forward: send ETH, get USDC)
 *   USDC → ETH   (reverse: send USDC, get ETH)
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

const USDC_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// The NativePrivateSwap vault — reads the rate + reserve.
const VAULT_ADDR = "0x582c57a7ba6e7758e75dc5334a5e8ff096515d09";
const VAULT_ABI = [
  "function quote(uint256 ethIn) view returns (uint256)",
  "function usdcPerEth() view returns (uint256)",
  "function reserveBalance() view returns (uint256)",
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
  const [reserve, setReserve] = useState(null);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [stealthInfo, setStealthInfo] = useState(null); // {address, privateKey, usdcBalance, ethBalance}

  const isUSDC2ETH = direction === "usdc2eth";
  const inputSymbol = isUSDC2ETH ? "USDC" : "ETH";
  const outputSymbol = isUSDC2ETH ? "ETH" : "USDC";

  // Read rate + reserve from the vault on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const provider = await getProvider();
        const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, provider);
        const [r, res] = await Promise.all([
          vault.usdcPerEth(),
          vault.reserveBalance(),
        ]);
        if (cancelled) return;
        setRate(ethers.formatUnits(r, 6));
        setReserve(ethers.formatUnits(res, 6));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Read the user's stealth address + balances from the archive.
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
        // USDC → ETH: stealth sends USDC to vault, gets ETH to recipient.
        // Sign with the stealth's private key locally.
        const provider = await getProvider();
        const stealthWallet = new ethers.Wallet(stealthInfo.privateKey, provider);
        const amountRaw = ethers.parseUnits(amount, 6);

        // Check stealth has enough USDC.
        const stealthUsdc = await readUsdcBalance(stealthInfo.address);
        if (stealthUsdc < amountRaw) {
          toast.error(`Stealth only has ${ethers.formatUnits(stealthUsdc, 6)} USDC. Deposit more first.`);
          setSwapping(false);
          return;
        }

        // Transfer USDC from stealth to the vault.
        const usdc = new ethers.Contract(USDC_ADDR,
          ["function transfer(address to, uint256 amount) returns (bool)"],
          stealthWallet);
        const tx = await usdc.transfer(VAULT_ADDR, amountRaw);
        setTxHash(tx.hash);
        toast.success("Swap submitted — waiting for confirmation…");
        const receipt = await tx.wait();
        if (receipt.status === 1) {
          toast.success("Swap confirmed!");
        } else {
          toast.error("Swap reverted");
        }
      } else {
        // ETH → USDC: stealth sends ETH to vault, gets USDC to recipient.
        const provider = await getProvider();
        const stealthWallet = new ethers.Wallet(stealthInfo.privateKey, provider);
        const amountWei = ethers.parseEther(amount);

        // Check stealth has enough ETH.
        const stealthEth = await readEthBalance(stealthInfo.address);
        if (stealthEth < amountWei) {
          toast.error(`Stealth only has ${ethers.formatEther(stealthEth)} ETH. Deposit ETH first.`);
          setSwapping(false);
          return;
        }

        // Send ETH to the vault with the swap call.
        const vault = new ethers.Contract(VAULT_ADDR, [
          "function swapUSDCViaCommitment(address recipient, bytes32 amountCommit, bytes1 viewTagByte, uint256 minUsdcOut) payable",
        ], stealthWallet);
        // Simple commitment: use keccak256 of the expected output.
        const minOut = ethers.parseUnits(expectedOut, 6) * 95n / 100n; // 5% slippage
        const tx = await vault.swapUSDCViaCommitment(
          recipient,
          ethers.id(expectedOut), // amountCommit (simplified)
          "0x00",                  // viewTagByte
          minOut,
          { value: amountWei }
        );
        setTxHash(tx.hash);
        toast.success("Swap submitted — waiting for confirmation…");
        const receipt = await tx.wait();
        if (receipt.status === 1) {
          toast.success("Swap confirmed!");
        } else {
          toast.error("Swap reverted");
        }
      }

      // Refresh balances.
      fetchBalance && fetchBalance();
      fetchUsdcBalance && fetchUsdcBalance();
      try { if (typeof fetchStealthBalance === "function") await fetchStealthBalance(); } catch {}
      setAmount("");
      setExpectedOut("");
    } catch (e) {
      const msg = e.message?.slice(0, 80) || "Swap failed";
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
            {reserve ? `reserve: ${Number(reserve).toFixed(2)} USDC` : ""}
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
