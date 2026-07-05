import { useState } from "react";
import axios from "axios";
import { FileText, Lock, Unlock, Copy, Check, Loader2, RefreshCw, Layers, Receipt as ReceiptIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { copyToClip } from "@/components/common/CopyButton";

/**
 * EncryptedReceipts — UNIFIED receipt panel for ALL chains.
 *
 * Integrates the original EVM create/decrypt flow (sender side) with
 * the new SVM receipts lookup (receiver side). A chain selector at the
 * top lets the user pick which chain's receipts to work with; the form
 * below changes shape based on that selection.
 *
 *  - EVM: sender-side create + recipient-side decrypt (existing form,
 *         unchanged behaviour).
 *  - Sui:  receiver-side lookup — paste an owner address, fetch every
 *         PrivacyReceipt object owned by it.
 *  - Solana: same as Sui, different endpoint + base58 owner.
 *
 * Putting a single button on the Dashboard replaces the need for the
 * 6 chain-specific Sui/Solana wrapper buttons — chains are picked here.
 */
export function EncryptedReceipts() {
  const { address, chain } = useWallet();
  const [family, setFamily] = useState("evm"); // evm | sui | sol

  // ── EVM state ─────────────────────────────────────────────────────
  const [tab, setTab] = useState("create");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);
  const [txHash, setTxHash] = useState("");
  const [recipientStealth, setRecipientStealth] = useState("");
  const [amountWei, setAmountWei] = useState("");
  const [createdReceipt, setCreatedReceipt] = useState(null);
  const [receiptId, setReceiptId] = useState("");
  const [oneTimeCode, setOneTimeCode] = useState("");
  const [decryptedData, setDecryptedData] = useState(null);

  // ── SVM state ─────────────────────────────────────────────────────
  const [svmOwner, setSvmOwner] = useState("");
  const [svmReceipts, setSvmReceipts] = useState(null); // { count, receipts: [...] }
  const [svmLoading, setSvmLoading] = useState(false);
  const [svmNotLive, setSvmNotLive] = useState(false);

  const CHAINS = [
    { id: "evm", label: "EVM", color: "text-blue-300" },
    { id: "sui", label: "Sui", color: "text-cyan-300" },
    { id: "sol", label: "Solana", color: "text-purple-300" },
  ];

  // ── EVM handlers ──────────────────────────────────────────────────
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

  // ── SVM handlers ──────────────────────────────────────────────────
  const fetchSvmReceipts = async () => {
    if (!svmOwner) return toast.error("Enter an owner address");
    setSvmLoading(true);
    setSvmNotLive(false);
    setSvmReceipts(null);
    try {
      const endpoint = family === "sui" ? `${API}/sui/receipts/${svmOwner}` : `${API}/sol/receipts/${svmOwner}`;
      const res = await axios.get(endpoint);
      setSvmReceipts(res.data);
    } catch (e) {
      if (e.response?.status === 503) {
        setSvmNotLive(true);
      } else {
        toast.error(e.response?.data?.detail?.slice(0, 100) || "Fetch failed");
      }
    }
    setSvmLoading(false);
  };

  const doCopy = (text, key) => {
    copyToClip(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4" data-testid="encrypted-receipts">
      <div className="flex items-center gap-2 text-sm text-white/50 bg-white/5 border border-white/10 p-3">
        <Layers className="w-4 h-4 text-white/40" />
        Unified receipts panel — pick the chain family below. EVM supports create + decrypt (sender side); Sui/Solana support receipts lookup (receiver side).
      </div>

      {/* ── Chain selector ─────────────────────────────────────── */}
      <div className="flex gap-0 border border-white/20" data-testid="receipt-family-tabs">
        {CHAINS.map((c) => (
          <button
            key={c.id}
            data-testid={`receipt-family-${c.id}`}
            onClick={() => setFamily(c.id)}
            className={`flex-1 p-2.5 text-sm font-medium transition-all ${
              family === c.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Branch: EVM (sender side: create + decrypt) ────────── */}
      {family === "evm" && (
        <div className="space-y-4" data-testid="evm-receipts">
          {/* Sub-tab: create / decrypt */}
          <div className="flex gap-0 border border-white/10">
            {["create", "decrypt"].map((t) => (
              <button
                key={t}
                data-testid={`receipt-tab-${t}`}
                onClick={() => setTab(t)}
                className={`flex-1 p-2 text-xs font-medium transition-all uppercase tracking-wider ${
                  tab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
                }`}
              >
                {t === "create" ? "Create Receipt" : "Decrypt Receipt"}
              </button>
            ))}
          </div>

          {tab === "create" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Transaction Hash</label>
                <input data-testid="receipt-tx-hash" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x..."
                  className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Recipient Stealth Address</label>
                <input data-testid="receipt-stealth-addr" value={recipientStealth} onChange={(e) => setRecipientStealth(e.target.value)} placeholder="0x..."
                  className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">Amount (wei)</label>
                <input data-testid="receipt-amount" value={amountWei} onChange={(e) => setAmountWei(e.target.value)} placeholder="1000000000000000000"
                  className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none" />
              </div>
              <div className="text-xs text-white/30">
                Chain: <span style={{ color: CHAINS[chain]?.color }}>{CHAINS[chain]?.name}</span>
              </div>
              <button data-testid="receipt-create-button" onClick={createReceipt} disabled={loading}
                className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50">
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
                <input data-testid="receipt-decrypt-id" value={receiptId} onChange={(e) => setReceiptId(e.target.value)} placeholder="uuid..."
                  className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1">One-Time Code</label>
                <input data-testid="receipt-decrypt-code" value={oneTimeCode} onChange={(e) => setOneTimeCode(e.target.value)} placeholder="hex code..."
                  className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none" />
              </div>
              <button data-testid="receipt-decrypt-button" onClick={decryptReceipt} disabled={loading}
                className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50">
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
      )}

      {/* ── Branch: Sui (receiver side: lookup by owner) ──────── */}
      {family === "sui" && (
        <div className="space-y-3" data-testid="sui-receipts">
          <p className="text-xs text-white/40">
            Sui PrivacyReceipt objects owned by the address you provide. Each record carries an opaque ciphertext + nonce — decrypt off-chain with your stealth private key.
          </p>
          <div className="flex gap-2">
            <input
              data-testid="svm-receipts-owner"
              value={svmOwner}
              onChange={(e) => setSvmOwner(e.target.value)}
              placeholder={family === "sui" ? "0x... owner address" : "base58 owner address"}
              className="flex-1 bg-white/5 border border-white/20 p-3 text-xs font-mono outline-none focus:border-white"
            />
            <button
              data-testid="svm-receipts-fetch"
              onClick={fetchSvmReceipts}
              disabled={svmLoading || !svmOwner}
              className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {svmLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Fetch
            </button>
          </div>

          {svmNotLive && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Package not yet deployed on Sui. The query above will populate automatically once it goes live.
            </div>
          )}

          {svmReceipts && (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 p-3 text-center">
                <div className="text-[10px] text-white/40 uppercase">Receipts for this owner</div>
                <div className="font-mono text-2xl text-cyan-300">{svmReceipts.count}</div>
              </div>
              {svmReceipts.receipts.length === 0 ? (
                <div className="text-center text-white/40 text-sm py-8 flex flex-col items-center gap-2">
                  <ReceiptIcon className="w-8 h-8 opacity-40" />
                  No receipts yet
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {svmReceipts.receipts.map((r, i) => (
                    <div key={r.object_id || i} className="bg-white/5 border border-white/10 p-2 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-white/40">object</span>
                        <span className="font-mono text-cyan-300 break-all">{(r.object_id || r.pubkey || "").slice(0, 24)}…</span>
                      </div>
                      {r.announcement_id != null && (
                        <div className="flex justify-between">
                          <span className="text-white/40">announcement</span>
                          <span className="font-mono">#{r.announcement_id}</span>
                        </div>
                      )}
                      {r.ciphertext_len != null && (
                        <div className="flex justify-between">
                          <span className="text-white/40">ciphertext</span>
                          <span className="font-mono">{r.ciphertext_len} bytes</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Branch: Solana (receiver side: lookup by owner) ───── */}
      {family === "sol" && (
        <div className="space-y-3" data-testid="sol-receipts">
          <p className="text-xs text-white/40">
            Solana receipt PDAs owned by the address you provide. Mirrors the Sui lookup, using base58 owner format.
          </p>
          <div className="flex gap-2">
            <input
              data-testid="svm-receipts-owner"
              value={svmOwner}
              onChange={(e) => setSvmOwner(e.target.value)}
              placeholder="base58 owner address"
              className="flex-1 bg-white/5 border border-white/20 p-3 text-xs font-mono outline-none focus:border-white"
            />
            <button
              data-testid="svm-receipts-fetch"
              onClick={fetchSvmReceipts}
              disabled={svmLoading || !svmOwner}
              className="px-4 py-3 border border-white/20 hover:bg-white/10 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {svmLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Fetch
            </button>
          </div>

          {svmNotLive && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Program not yet deployed on Solana. The query above will populate automatically once it goes live.
            </div>
          )}

          {svmReceipts && (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 p-3 text-center">
                <div className="text-[10px] text-white/40 uppercase">Receipts for this owner</div>
                <div className="font-mono text-2xl text-purple-300">{svmReceipts.count}</div>
              </div>
              {svmReceipts.receipts.length === 0 ? (
                <div className="text-center text-white/40 text-sm py-8 flex flex-col items-center gap-2">
                  <ReceiptIcon className="w-8 h-8 opacity-40" />
                  No receipts yet
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {svmReceipts.receipts.map((r, i) => (
                    <div key={r.pubkey || r.object_id || i} className="bg-white/5 border border-white/10 p-2 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-white/40">account</span>
                        <span className="font-mono text-purple-300 break-all">{(r.pubkey || r.object_id || "").slice(0, 24)}…</span>
                      </div>
                      {r.announcement_id != null && (
                        <div className="flex justify-between">
                          <span className="text-white/40">announcement</span>
                          <span className="font-mono">#{r.announcement_id}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
