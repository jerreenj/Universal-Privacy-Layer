import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Lock, Copy, Check, Loader2, MessageSquare, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { copyToClip } from "@/components/common/CopyButton";
import { deriveMessagingKeys, encryptMessage, decryptMessage } from "@/lib/messageCrypto";

export function EncryptedMessaging() {
  const { address, signer } = useWallet();
  const [tab, setTab] = useState("send");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [sentMode, setSentMode] = useState(null); // null | "e2e" | "encrypted"
  const [decrypted, setDecrypted] = useState({});
  const [copied, setCopied] = useState(false);
  const [msgKeys, setMsgKeys] = useState(null);
  const [deriving, setDeriving] = useState(false);

  // Silently derive E2E keys in background when wallet is available
  useEffect(() => {
    if (!signer || !address || msgKeys || deriving) return;
    let cancelled = false;
    setDeriving(true);
    (async () => {
      try {
        const keys = await deriveMessagingKeys(signer);
        if (cancelled) return;
        setMsgKeys(keys);
        await axios.post(`${API}/messaging/register-key`, { address, public_key: keys.publicKey }).catch(() => {});
      } catch { /* user rejected sig — no problem, legacy works */ }
      if (!cancelled) setDeriving(false);
    })();
    return () => { cancelled = true; };
  }, [signer, address, msgKeys, deriving]);

  // Legacy decrypt (SHA256-AES-CBC)
  const legacyDecrypt = async (encrypted_b64, addr) => {
    try {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(addr));
      const key = await crypto.subtle.importKey("raw", hash, { name: "AES-CBC" }, false, ["decrypt"]);
      const raw = Uint8Array.from(atob(encrypted_b64), c => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: raw.slice(0, 16) }, key, raw.slice(16));
      const text = new TextDecoder().decode(plain);
      return text.slice(0, text.length - text.charCodeAt(text.length - 1));
    } catch { return null; }
  };

  const loadInbox = useCallback(async () => {
    if (!address) return;
    try {
      const r = await axios.get(`${API}/messaging/inbox/${address}`);
      const msgs = r.data.messages || [];
      setInbox(msgs);
      const dec = {};
      for (const m of msgs) {
        if (m.e2e && m.ciphertext && m.ephemeral_pub && m.nonce && msgKeys) {
          const plain = await decryptMessage(m.ciphertext, m.ephemeral_pub, m.nonce, msgKeys.privateKey);
          if (plain) dec[m.message_id] = plain;
        } else if (m.encrypted_content) {
          const plain = await legacyDecrypt(m.encrypted_content, address);
          if (plain) dec[m.message_id] = plain;
        }
      }
      setDecrypted(dec);
    } catch {}
  }, [address, msgKeys]);

  useEffect(() => {
    if (address && tab === "inbox") loadInbox();
  }, [address, tab, loadInbox]);

  // Send: try E2E → silent fallback to legacy. Never block.
  const sendMessage = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient || !message) return toast.error("Fill in recipient and message");
    setLoading(true);
    setSentMode(null);
    try {
      let usedE2E = false;

      // Attempt E2E if we have our own keys
      if (msgKeys) {
        try {
          const r = await axios.get(`${API}/messaging/pubkey/${recipient.trim()}`);
          if (r.data.public_key) {
            const encrypted = await encryptMessage(message, r.data.public_key);
            await axios.post(`${API}/messaging/send-e2e`, {
              sender_address: address,
              recipient_address: recipient.trim(),
              ciphertext: encrypted.ciphertext,
              ephemeral_pub: encrypted.ephemeralPub,
              nonce: encrypted.nonce,
            });
            usedE2E = true;
          }
        } catch { /* recipient not registered — fall through to legacy */ }
      }

      // Fallback: server-encrypted delivery
      if (!usedE2E) {
        await axios.post(`${API}/messaging/send`, {
          sender_address: address,
          recipient_address: recipient.trim(),
          message,
          recipient_public_key: recipient.trim(),
        });
      }

      setSentMode(usedE2E ? "e2e" : "encrypted");
      setMessage("");
      toast.success(usedE2E ? "Sent with E2E encryption" : "Encrypted message sent");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Send failed");
    }
    setLoading(false);
  };

  const copyLink = () => {
    copyToClip(`${window.location.origin}?msg=${address}`);
    setCopied(true);
    toast.success("Contact link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const msg = params.get("msg");
    if (msg) { setRecipient(msg); setTab("send"); }
  }, []);

  return (
    <div className="space-y-4" data-testid="encrypted-messaging">
      {/* E2E status — informational only, never blocks */}
      {msgKeys && (
        <div className="bg-green-500/10 border border-green-500/30 p-3 text-xs text-green-300 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          <span><span className="font-semibold">E2E Active</span> — messages to other E2E users are end-to-end encrypted via ECDH.</span>
        </div>
      )}

      <div className="flex gap-2">
        {["send", "inbox"].map(t => (
          <button key={t} onClick={() => setTab(t)} data-testid={`msg-tab-${t}`}
            className={`flex-1 py-2 text-sm font-medium capitalize ${tab === t ? "bg-white text-black" : "bg-white/10"}`}>
            {t === "inbox" ? `Inbox (${inbox.filter(m => !m.read).length})` : "Send"}
          </button>
        ))}
      </div>

      {tab === "send" && (
        <div className="space-y-3">
          {address && (
            <button onClick={copyLink}
              className="w-full py-2 border border-white/20 hover:border-white/50 text-xs text-white/50 hover:text-white flex items-center justify-center gap-2 transition-colors">
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "Link copied!" : "Copy your contact link"}
            </button>
          )}
          <p className="text-xs text-white/30">All messages are encrypted. When both parties have wallets connected, messages use true E2E encryption (ECDH + AES-256-GCM).</p>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Recipient wallet address</label>
            <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x..."
              data-testid="msg-recipient-input"
              className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Your private message..."
              data-testid="msg-body-input"
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white h-24 resize-none" />
          </div>
          <button onClick={sendMessage} disabled={loading} data-testid="msg-send-btn"
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {loading ? "Encrypting..." : "Send Encrypted"}
          </button>
          {sentMode && (
            <div className={`p-3 text-xs border ${sentMode === "e2e" ? "bg-green-400/10 border-green-400/30 text-green-300" : "bg-blue-400/10 border-blue-400/30 text-blue-300"}`}>
              {sentMode === "e2e" ? (
                <div className="flex items-center gap-2"><ShieldCheck className="w-3 h-3" /><span>Sent with true E2E encryption — server cannot read this message.</span></div>
              ) : (
                <div className="flex items-center gap-2"><Lock className="w-3 h-3" /><span>Sent encrypted. Auto-upgrades to E2E when recipient connects their wallet.</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "inbox" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/30">Messages sent to your wallet</p>
            <button onClick={loadInbox} data-testid="msg-refresh-btn" className="text-xs text-white/40 hover:text-white transition-colors">Refresh</button>
          </div>
          {inbox.length === 0 ? (
            <div className="text-center py-10 text-white/30 space-y-2">
              <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Share your contact link so people can message you</p>
            </div>
          ) : (
            inbox.map((msg, i) => (
              <div key={i} data-testid={`msg-item-${i}`}
                className={`border p-4 space-y-2 ${msg.read ? "border-white/10 bg-white/[0.02]" : "border-green-500/30 bg-green-400/5"}`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/50">From: {msg.sender_address?.slice(0, 10)}...{msg.sender_address?.slice(-4)}</span>
                    {msg.e2e && <span className="text-[9px] border border-green-500/40 text-green-400 px-1 py-0.5">E2E</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!msg.read && <span className="text-[10px] text-green-400 font-semibold">NEW</span>}
                    <span className="text-xs text-white/30">{msg.created_at ? new Date(msg.created_at).toLocaleDateString() : ""}</span>
                  </div>
                </div>
                {decrypted[msg.message_id] ? (
                  <p className="text-sm text-white leading-relaxed">{decrypted[msg.message_id]}</p>
                ) : (
                  <div className="flex items-center gap-2 py-1">
                    <Lock className="w-3 h-3 text-white/20" />
                    <p className="text-xs text-white/30 font-mono">{msg.e2e ? "Encrypted message — connect the recipient wallet to decrypt" : "Encrypted message — decrypting..."}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
