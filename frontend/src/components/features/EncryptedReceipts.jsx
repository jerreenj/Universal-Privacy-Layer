import { useState } from "react";
import axios from "axios";
import { FileText, Lock, Unlock, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { copyToClip } from "@/components/common/CopyButton";

export function EncryptedReceipts() {
  const { address, chain } = useWallet();
  const [tab, setTab] = useState("create");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);

  // Create
  const [txHash, setTxHash] = useState("");
  const [recipientStealth, setRecipientStealth] = useState("");
  const [amountWei, setAmountWei] = useState("");
  const [createdReceipt, setCreatedReceipt] = useState(null);

  // Decrypt
  const [receiptId, setReceiptId] = useState("");
  const [oneTimeCode, setOneTimeCode] = useState("");
  const [decryptedData, setDecryptedData] = useState(null);

  const createReceipt = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!txHash || !recipientStealth || !amountWei) return toast.error("Fill all fields");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/receipt/create`, {
        transaction_hash: txHash,
        sender_address: address,
        recipient_stealth_address: recipientStealth,
        amount_wei: amountWei,
        chain: chain,
        timestamp: new Date().toISOString(),
      });
      setCreatedReceipt(res.data);
      toast.success("Encrypted receipt created");
    } catch {
      toast.error("Failed to create receipt");
    }
    setLoading(false);
  };

  const decryptReceipt = async () => {
    if (!receiptId || !oneTimeCode) return toast.error("Fill both fields");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/receipt/decrypt`, {
        receipt_id: receiptId,
        one_time_code: oneTimeCode,
      });
      setDecryptedData(res.data.receipt);
      toast.success("Receipt decrypted");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Decryption failed — invalid code?");
    }
    setLoading(false);
  };

  const doCopy = (text, key) => {
    copyToClip(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4" data-testid="encrypted-receipts">
      <p className="text-sm text-white/50">
        Generate encrypted proof-of-payment for stealth sends. Receipts are AES-256-GCM encrypted and stored in the database. Only the one-time code can unlock them.
      </p>

      {/* Tabs */}
      <div className="flex gap-0 border border-white/20">
        {["create", "decrypt"].map((t) => (
          <button
            key={t}
            data-testid={`receipt-tab-${t}`}
            onClick={() => setTab(t)}
            className={`flex-1 p-2.5 text-sm font-medium transition-all ${tab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
          >
            {t === "create" ? "Create Receipt" : "Decrypt Receipt"}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Transaction Hash</label>
            <input
              data-testid="receipt-tx-hash"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="0x..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Recipient Stealth Address</label>
            <input
              data-testid="receipt-stealth-addr"
              value={recipientStealth}
              onChange={(e) => setRecipientStealth(e.target.value)}
              placeholder="0x..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Amount (wei)</label>
            <input
              data-testid="receipt-amount"
              value={amountWei}
              onChange={(e) => setAmountWei(e.target.value)}
              placeholder="1000000000000000000"
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div className="text-xs text-white/30">
            Chain: <span style={{ color: CHAINS[chain]?.color }}>{CHAINS[chain]?.name}</span>
          </div>
          <button
            data-testid="receipt-create-button"
            onClick={createReceipt}
            disabled={loading}
            className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Encrypt & Store Receipt
          </button>

          {createdReceipt && (
            <div className="bg-green-500/10 border border-green-500/30 p-4 space-y-2" data-testid="receipt-created-result">
              <div className="text-sm font-semibold text-green-400 flex items-center gap-2">
                <FileText className="w-4 h-4" /> Receipt Created
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Receipt ID</span>
                  <button onClick={() => doCopy(createdReceipt.receipt_id, "rid")} className="flex items-center gap-1 text-xs font-mono text-white/70 hover:text-white">
                    {createdReceipt.receipt_id.slice(0, 12)}...
                    {copied === "rid" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">One-Time Code</span>
                  <button onClick={() => doCopy(createdReceipt.one_time_code, "code")} className="flex items-center gap-1 text-xs font-mono text-red-400 hover:text-red-300">
                    {createdReceipt.one_time_code.slice(0, 12)}...
                    {copied === "code" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
              <div className="text-xs text-red-400/80 mt-2">
                Save the one-time code — it cannot be recovered. Share it only with the recipient.
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "decrypt" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Receipt ID</label>
            <input
              data-testid="receipt-decrypt-id"
              value={receiptId}
              onChange={(e) => setReceiptId(e.target.value)}
              placeholder="uuid..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">One-Time Code</label>
            <input
              data-testid="receipt-decrypt-code"
              value={oneTimeCode}
              onChange={(e) => setOneTimeCode(e.target.value)}
              placeholder="hex code..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <button
            data-testid="receipt-decrypt-button"
            onClick={decryptReceipt}
            disabled={loading}
            className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
            Decrypt Receipt
          </button>

          {decryptedData && (
            <div className="bg-white/5 border border-white/20 p-4 space-y-2" data-testid="receipt-decrypted-result">
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <Unlock className="w-4 h-4 text-green-400" /> Decrypted Receipt
              </div>
              {Object.entries(decryptedData).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-white/40">{k}</span>
                  <span className="text-white/70 font-mono text-right max-w-[60%] truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
