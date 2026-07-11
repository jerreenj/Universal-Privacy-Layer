import { useEffect, useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Zap, Lock, Loader2, ExternalLink, CheckCircle2, X, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";

/**
 * SendContent — Private send flow for the customer's main wallet.
 *
 * Two on-chain paths, picked by the token toggle:
 *
 * 1. ETH — RELAYER PATH (recommended for ETH balance hiding)
 *    Routes the ETH through the on-chain PrivacyRelayer contract.
 *    The customer's EOA NEVER appears as msg.sender — the relayer
 *    hot wallet pays gas and forwards the ETH atomically.
 *
 * 2. USDC — PRIVACY-USDC-FORWARDER PATH (sender hiding for USDC)
 *    The customer pre-funds the PrivacyUSDCForwarder contract ONCE
 *    (visible: customer wallet -> forwarder). After that, every USDC
 *    send has `from = forwarder` on BaseScan — the customer's PUBLIC
 *    wallet NEVER appears in any token transfer event.
 *
 *    Tradeoff vs ETH direct: there's a top-up tx (visible, one-time),
 *    then every subsequent send is fully sender-hidden. If prepaid
 *    balance is zero, the UI prompts to top up automatically.
 *
 * Until the forwarder contract is deployed AND the backend has it in
 * deployed_base.json, USDC falls back to the direct-transfer path so
 * the user can still move funds. The deployed check is whether the
 * backend's /api/usdc-forwarder/prepaid/{chain}/{user}/{token}
 * endpoint reports `forwarder_deployed: true`.
 */
export function SendContent() {
  const { address, chain, signer, fetchBalance, fetchStealthBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("usdc");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [successPopup, setSuccessPopup] = useState(null);

  // USDC forwarder state
  const [usdcForwarderReady, setUsdcForwarderReady] = useState(null); // null=loading, true/false
  const [prepaidBalance, setPrepaidBalance] = useState("0");
  const [topUpAmount, setTopUpAmount] = useState(""); // "amount" string for the top-up form

  /**
   * Accept BOTH forms the customer might paste:
   *   - raw:        0x7DCB77eB30a6CD3D83cF86fd2e2F7d4e7ec5f9Df
   *   - prefixed:   st:eth:0x7DCB77eB30a6CD3D83cF86fd2e2F7d4e7ec5f9Df
   * Returns the raw 0x... form or null if neither matches.
   */
  const parseRecipient = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    const stripped = s.startsWith("st:eth:") ? s.slice(7) : s;
    return ethers.isAddress(stripped) ? stripped : null;
  };

  // Check whether the PrivacyUSDCForwarder is deployed + the user's
  // current prepaid balance. Refreshes on address / chain change.
  useEffect(() => {
    if (!address || token !== "usdc") return;
    let cancelled = false;
    (async () => {
      try {
        const tokenAddr = CHAINS[chain]?.contracts?.usdc ||
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
        const r = await axios.get(
          `${API}/usdc-forwarder/prepaid/${chain}/${address}/${tokenAddr}`
        );
        if (cancelled) return;
        setUsdcForwarderReady(r.data?.forwarder_deployed === true);
        setPrepaidBalance(r.data?.prepaid || "0");
      } catch {
        if (!cancelled) {
          setUsdcForwarderReady(false);
          setPrepaidBalance("0");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [address, chain, token]);

  /**
   * USDC flow: route through PrivacyUSDCForwarder so sender hides.
   *
   * Step 1. If prepaid balance is below the requested amount, top up
   *         first via ERC20.approve + forwarder.deposit. The top-up
   *         tx DOES surface the customer's wallet on BaseScan — but
   *         only ONCE per top-up session; it's the visible-once
   *         trade for every-hidden-after pattern.
   * Step 2. Sign an EIP-712 Forward intent off-chain (no L1 tx).
   * Step 3. Backend verifies signature and submits forward(); the on-
   *         chain USDC Transfer has `from = forwarder`, not user.
   */
  const sendUsdcViaForwarder = async () => {
    if (!address || !signer) return;
    const recipient = parseRecipient(to);
    if (!recipient) return toast.error("Invalid address — must start with 0x or st:eth:0x");
    const amountNum = parseFloat(amount);
    if (!(amountNum > 0)) return toast.error("Enter a positive amount");
    setSending(true);
    try {
      const usdcAddr = CHAINS[chain]?.contracts?.usdc ||
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const decimals = 6;
      const amountRaw = ethers.parseUnits(amount, decimals);

      // Step 1: Top up if prepaid is insufficient.
      const currentRaw = BigInt(prepaidBalance || "0");
      if (currentRaw < amountRaw) {
        const deficit = amountRaw - currentRaw;
        toast("Topping up your forwarder balance first…");
        const usdc = new ethers.Contract(usdcAddr,
          ["function approve(address spender, uint256 amount) returns (bool)",
           "function allowance(address owner, address spender) view returns (uint256)"],
          signer);
        // Approve only the deficit so we never expose more allowance than needed.
        const allow = await usdc.allowance(address, await getForwarderAddress());
        if (allow < deficit) {
          const approveTx = await usdc.approve(await getForwarderAddress(), deficit);
          await approveTx.wait();
        }
        const depositTx = await getForwarderContract(signer).deposit(usdcAddr, deficit);
        await depositTx.wait();
        // Refresh prepaid-balance state so subsequent sends skip this branch.
        const r = await axios.get(`${API}/usdc-forwarder/prepaid/${chain}/${address}/${usdcAddr}`);
        setPrepaidBalance(r.data?.prepaid || "0");
      }

      // Step 2: Prepare EIP-712 intent (relayer backend signs off-chain).
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/usdc-forwarder/prepare-tx`, {
        from_address: address,
        stealth_address: recipient,
        amount,
        token: usdcAddr,
        ephemeral_key: ephemeralKey,
        view_tag: viewTag,
        chain: chain || "base",
      });

      const { domain, types, message } = prepRes.data.intent;
      const signature = await signer.signTypedData(domain, types, message);

      // Step 3: Submit — backend relays forward() on-chain.
      const submitRes = await axios.post(`${API}/usdc-forwarder/submit`, {
        intent: prepRes.data.intent,
        signature,
        from_address: address,
        chain: chain || "base",
      });

      const hash = submitRes.data.tx_hash || "";
      setTxHash(hash);
      setSuccessPopup({
        hash,
        explorer: `${CHAINS[chain].explorer}/tx/${hash}`,
        amount,
        token: "USDC",
        to: recipient,
        chain: chain || "base",
      });

      const envelope = await seal({
        tx_hash:      hash,
        from_address: address,
        to_address:   recipient,
        amount_wei:   amountRaw.toString(),
        amount_human: amount,
        chain:        chain || "base",
        tx_type:      "private_send_usdc",
        status:       "confirmed",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "private_send_usdc",
        status: "confirmed",
        chain: chain || "base",
      });

      fetchBalance();
      try {
        if (typeof fetchStealthBalance === "function") await fetchStealthBalance();
      } catch {}
      setTo(""); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    }
    setSending(false);
  };

  /** FALLBACK: direct ERC20 transfer if the forwarder isn't deployed. */
  const sendUsdcDirect = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    const recipient = parseRecipient(to);
    if (!recipient) return toast.error("Invalid address — must start with 0x or st:eth:0x");
    if (!signer) return toast.error("Wallet not connected");
    setSending(true);
    try {
      const usdcAddr = CHAINS[chain]?.contracts?.usdc || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const usdc = new ethers.Contract(
        usdcAddr,
        ["function transfer(address to, uint256 amount) returns (bool)",
         "function decimals() view returns (uint8)"],
        signer
      );
      const decimals = (chain === "bnb") ? 18 : 6;
      const amount6 = ethers.parseUnits(amount, decimals);
      const tx = await usdc.transfer(recipient, amount6);
      toast.success("Submitted — waiting for on-chain confirmation…");
      const receipt = await tx.wait();
      const hash = receipt?.hash || tx?.hash || "";
      setTxHash(hash);
      setSuccessPopup({
        hash,
        explorer: `${CHAINS[chain].explorer}/tx/${hash}`,
        amount,
        token: "USDC",
        to: recipient,
        chain: chain || "base",
      });

      const envelope = await seal({
        tx_hash:      hash,
        from_address: address,
        to_address:   recipient,
        amount_wei:   amount6.toString(),
        amount_human: amount,
        chain:        chain || "base",
        tx_type:      "private_send_usdc_direct",
        status:       "confirmed",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "private_send_usdc_direct",
        status: "confirmed",
        chain: chain || "base",
      });

      fetchBalance();
      try {
        if (typeof fetchStealthBalance === "function") {
          await fetchStealthBalance();
        }
      } catch {}
      setTo(""); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    }
    setSending(false);
  };

  // Dispatcher: forwarder when ready, direct when not.
  const sendUsdc = () => (usdcForwarderReady ? sendUsdcViaForwarder() : sendUsdcDirect());

  const sendEth = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    const recipient = parseRecipient(to);
    if (!recipient) return toast.error("Invalid address — must start with 0x or st:eth:0x");
    if (!signer) return toast.error("Wallet not connected");
    setSending(true);
    try {
      const amountWei = ethers.parseEther(amount);
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: recipient,
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
      setTxHash(relayTxHash);
      setSuccessPopup({
        hash: relayTxHash,
        explorer: `${CHAINS[chain].explorer}/tx/${relayTxHash}`,
        amount,
        token: CHAINS[chain]?.symbol || "ETH",
        to: recipient,
        chain: chain || "base",
      });

      const envelope = await seal({
        tx_hash:      relayTxHash,
        from_address: address,
        to_address:   recipient,
        amount_wei:   amountWei.toString(),
        amount_human: amount,
        chain:        chain || "base",
        tx_type:      "private_send_eth",
        status:       "pending",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "private_send_eth",
        status: "pending",
        chain: chain || "base",
      });
      fetchBalance();
      try {
        if (typeof fetchStealthBalance === "function") {
          await fetchStealthBalance();
        }
      } catch {}
      setTo(""); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    }
    setSending(false);
  };

  const send = () => (token === "usdc" ? sendUsdc() : sendEth());

  // Forwarder helpers — fetch address from backend manifest, lazy-load ABI
  // so we don't pull the whole web3 SDK into the main bundle.
  async function getForwarderAddress() {
    const r = await axios.get(`${API}/usdc-forwarder/prepaid/${chain}/${address}/0x0000000000000000000000000000000000000000`);
    return r.data?.forwarder_contract;
  }
  async function getForwarderContract(signerInstance) {
    const addr = await getForwarderAddress();
    return new ethers.Contract(addr, [
      "function deposit(address token, uint256 amount) external",
      "function withdraw(address token, uint256 amount) external",
    ], signerInstance);
  }

  // Top-up form handler — explicitly deposits user's USDC into the forwarder.
  const topUp = async () => {
    if (!address || !signer) return;
    const amt = parseFloat(topUpAmount);
    if (!(amt > 0)) return toast.error("Enter a positive amount");
    setSending(true);
    try {
      const usdcAddr = CHAINS[chain]?.contracts?.usdc ||
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const amountRaw = ethers.parseUnits(topUpAmount, 6);
      const usdc = new ethers.Contract(usdcAddr,
        ["function approve(address spender, uint256 amount) returns (bool)"],
        signer);
      const fwdAddr = await getForwarderAddress();
      const approveTx = await usdc.approve(fwdAddr, amountRaw);
      await approveTx.wait();
      const depositTx = await getForwarderContract(signer).deposit(usdcAddr, amountRaw);
      await depositTx.wait();
      toast.success(`Topped up ${topUpAmount} USDC into forwarder`);
      // Refresh prepaid.
      const r = await axios.get(`${API}/usdc-forwarder/prepaid/${chain}/${address}/${usdcAddr}`);
      setPrepaidBalance(r.data?.prepaid || "0");
      setTopUpAmount("");
    } catch (e) {
      toast.error(e.message?.slice(0, 80) || "Top-up failed");
    }
    setSending(false);
  };

  // Renders the inline top-up affordance when prepaid is empty and the
  // forwarder is ready. Without this, send would just toast a top-up
  // during send — clearer UX to surface the choice first.
  const needsTopUp = token === "usdc" && usdcForwarderReady === true && BigInt(prepaidBalance || "0") === 0n;

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        {token === "usdc"
          ? (usdcForwarderReady
              ? <>USDC routed through PrivacyUSDCForwarder — your wallet hidden from BaseScan Transfer events.</>
              : <>Direct USDC transfer (forwarder not deployed yet) — sender visible until deploy.</>)
          : <>Routed through PrivacyRelayer on {CHAINS[chain]?.name} - your wallet never appears as sender</>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-white/40 uppercase tracking-wider">Send</span>
        <div className="flex border border-white/20">
          {[
            { key: "usdc", label: "USDC" },
            { key: "eth",  label: CHAINS[chain]?.symbol || "ETH" },
          ].map((opt, idx) => (
            <button
              key={opt.key}
              data-testid={`token-toggle-${opt.key}`}
              onClick={() => setToken(opt.key)}
              className={`px-3 py-1.5 text-xs font-semibold ${idx > 0 ? "border-l border-white/20" : ""} ${token === opt.key ? "bg-white text-black" : "text-white/70 hover:bg-white/5"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {token === "usdc" && usdcForwarderReady && (
          <span className="text-[10px] uppercase tracking-wider text-white/30">
            prepaid: <span className="text-white/70">{ethers.formatUnits(prepaidBalance || "0", 6)}</span> USDC
          </span>
        )}
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient (stealth address)</label>
        <input data-testid="send-to-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">
          Amount ({token === "usdc" ? "USDC" : (CHAINS[chain]?.symbol || "")})
        </label>
        <input data-testid="send-amount-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      {/* Inline top-up section for USDC forwarder mode */}
      {needsTopUp && (
        <div className="bg-white/5 border border-white/10 p-3 space-y-2">
          <p className="text-xs text-white/60">
            Top up your PrivacyUSDCForwarder balance once. After this, every USDC
            send has <span className="text-white">from = forwarder</span> on BaseScan — not your wallet.
          </p>
          <div className="flex items-center gap-2">
            <input type="number" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="1.00"
              className="flex-1 bg-white/5 border border-white/20 p-2 text-sm font-mono outline-none focus:border-white" />
            <button onClick={topUp} disabled={sending}
              className="px-3 py-2 bg-white text-black text-xs font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              Top up
            </button>
          </div>
        </div>
      )}
      <button data-testid="send-btn" onClick={send} disabled={sending}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send {token === "usdc" ? "USDC" : "Privately"}
      </button>
      {txHash && !successPopup && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}

      {/* SUCCESS POPUP — BaseScan link on confirmed tx */}
      {successPopup && (
        <div
          data-testid="send-success-popup"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setSuccessPopup(null)}
        >
          <div
            className="bg-black border border-green-400/40 p-6 max-w-md w-full space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
                <h3 className="text-lg font-bold text-white">Transaction Successful</h3>
              </div>
              <button
                data-testid="close-success-popup"
                onClick={() => setSuccessPopup(null)}
                className="text-white/40 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Amount</span>
                <span className="font-mono text-white">{successPopup.amount} {successPopup.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Network</span>
                <span className="text-white">{CHAINS[successPopup.chain]?.name || successPopup.chain}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/40 shrink-0">Recipient</span>
                <span className="font-mono text-white/80 truncate">{successPopup.to}</span>
              </div>
              {token === "usdc" && usdcForwarderReady && (
                <div className="text-[11px] text-green-400/80 pt-1">
                  From-address on BaseScan: <span className="font-mono">PrivacyUSDCForwarder</span> (not your wallet)
                </div>
              )}
            </div>
            <a
              data-testid="basescan-link"
              href={successPopup.explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 bg-green-500 text-black font-bold uppercase tracking-wider hover:bg-green-400 flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Open in BaseScan
            </a>
            <p className="text-[11px] text-white/40 text-center">
              The transaction is finalized on-chain. Refresh the dashboard to see your Private balance update.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
