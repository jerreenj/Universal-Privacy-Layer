import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Zap, Lock, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";

export function SendContent() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const send = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    if (!ethers.isAddress(to)) return toast.error("Invalid address");
    if (!signer) return toast.error("Wallet not connected");
    setSending(true);
    try {
      // ── RELAYER FLOW ──────────────────────────────────────────
      // Routes through the on-chain PrivacyRelayer so the customer's
      // EOA never appears as msg.sender on BaseScan. Same EIP-712
      // intent → signTypedData → /relayer/submit pattern as
      // StealthSend and OnChainRelayer.
      const amountWei = ethers.parseEther(amount);
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: to,
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

      // Seal the metadata: server stores ciphertext only.
      const envelope = await seal({
        tx_hash:      relayTxHash,
        from_address: address,
        to_address:   to,
        amount_wei:   amountWei.toString(),
        chain:        chain || "base",
        tx_type:      "private_send",
        status:       "pending",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "private_send",
        status: "pending",
        chain: chain || "base",
      });
      toast.success("Transaction relayed on-chain!");
      fetchBalance();
      setTo(""); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    }
    setSending(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        Routed through PrivacyRelayer on {CHAINS[chain]?.name} - your wallet never appears as sender
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient (stealth address)</label>
        <input data-testid="send-to-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input data-testid="send-amount-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button data-testid="send-btn" onClick={send} disabled={sending}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send Privately
      </button>
      {txHash && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}
