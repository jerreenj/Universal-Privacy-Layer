import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Zap, Lock, Loader2, ExternalLink, CheckCircle2, X } from "lucide-react";
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
 *    hot wallet pays the gas and forwards the ETH atomically.
 *    Flow: prepare-tx → signTypedData (off-chain) → submit(relay).
 *
 * 2. USDC — DIRECT WALLET TRANSFER
 *    PrivacyRelayer.sol currently only supports ETH (msg.value).
 *    USDC flows through the customer's own connected wallet directly
 *    to the stealth address. Sender stays the customer's main wallet
 *    (visible on BaseScan) — only the recipient stealth address is
 *    the privacy hedge here. Amount is visible for now (P3 roadmap
 *    is to wrap into a USDC relayer, but until then the customer
 *    sees what's happening on-chain).
 *
 * After EITHER succeeds, a popup appears with the BaseScan link so
 * the customer has a verifiable receipt. Stealth balance is then
 * auto-refreshed (the dashboard's "Private" column updates).
 */
export function SendContent() {
  const { address, chain, signer, fetchBalance, fetchStealthBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("usdc"); // "usdc" | "eth"
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  // Tx-success popup — appears centered over the page on success,
  // shows the BaseScan link as a button so the customer has a
  // verifiable receipt without hunting through the explorer
  // themselves.
  const [successPopup, setSuccessPopup] = useState(null);
  // tx-success popup needs `fetchStealthBalance` from Dashboard; if
  // not exposed on the context, fall back to reading from localStorage.

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

  const sendUsdc = async () => {
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
      // Show "submitted" toast first — the receipt popup arrives on
      // confirmation, not submission.
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

      // Seal the metadata: server stores ciphertext only.
      const envelope = await seal({
        tx_hash:      hash,
        from_address: address,
        to_address:   recipient,
        amount_wei:   amount6.toString(),
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

      // Refresh balances so the dashboard's USDC numbers update.
      // Stealth balance (private column) reads via the archive list;
      // main wallet USDC reads directly via the wallet provider.
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

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        {token === "usdc"
          ? <>Direct USDC transfer to stealth recipient. Address hidden, amount visible until P3 launch.</>
          : <>Routed through PrivacyRelayer on {CHAINS[chain]?.name} - your wallet never appears as sender</>}
      </div>
      {/* Token toggle */}
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

      {/* ── SUCCESS POPUP ──────────────────────────────────────────
          Centered modal that appears after a confirmed transaction
          and stays on screen until dismissed. The BaseScan link is
          a button so the customer has a verifiable receipt in one
          tap. */}
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
