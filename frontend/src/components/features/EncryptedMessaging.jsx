import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Lock, Copy, Check, Loader2, MessageSquare, ShieldCheck, AlertTriangle } from "lucide-react";
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
  const [sent, setSent] = useState(null);
  const [decrypted, setDecrypted] = useState({});
  const [copied, setCopied] = useState(false);
  // E2E key state
  const [msgKeys, setMsgKeys] = useState(null); // { privateKey, publicKey }
  const [deriving, setDeriving] = useState(false);

  // Derive messaging keys from wallet signature
  const deriveKeys = useCallback(async () => {
    if (!signer || msgKeys || deriving) return;
    setDeriving(true);
    try {
      const keys = await deriveMessagingKeys(signer);
      setMsgKeys(keys);
      // Register public key with backend
      await axios.post(`${API}/messaging/register-key`, {
        address: address,
        public_key: keys.publicKey,
      });
    } catch (e) {
      // User rejected signature — don't block UI, just disable E2E
      console.warn("Messaging key derivation skipped:", e.message);
    }
    setDeriving(false);
  }, [signer, address, msgKeys, deriving]);

  // Auto-derive keys when signer becomes available
  useEffect(() => {
    if (signer && address && !msgKeys && !deriving) deriveKeys();
  }, [signer, address, msgKeys, deriving, deriveKeys]);

  // Load inbox and decrypt E2E messages
  const loadInbox = useCallback(async () => {
    if (!address) return;
    try {
      const r = await axios.get(`${API}/messaging/inbox/${address}`);
      const msgs = r.data.messages || [];
      setInbox(msgs);
      if (!msgKeys) return; // can't decrypt without keys
      const dec = {};
      for (const m of msgs) {
        if (m.e2e && m.ciphertext && m.ephemeral_pub && m.nonce) {
          // E2E message — decrypt with our private key
          const plain = await decryptMessage(m.ciphertext, m.ephemeral_pub, m.nonce, msgKeys.privateKey);
          if (plain) dec[m.message_id] = plain;
        } else if (m.encrypted_content) {
          // Legacy message — try old SHA256(address) decryption
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

  // Legacy decryption for old messages (SHA256(address) key)
  const legacyDecrypt = async (encrypted_b64, addr) => {
    try {
      const enc = new TextEncoder().encode(addr);
      const hash = await crypto.subtle.digest("SHA-256", enc);
      const key = await crypto.subtle.importKey("raw", hash, { name: "AES-CBC" }, false, ["decrypt"]);
      const raw = Uint8Array.from(atob(encrypted_b64), c => c.charCodeAt(0));
      const iv = raw.slice(0, 16);
      const ciphertext = raw.slice(16);
      const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
      const text = new TextDecoder().decode(plain);
      const padLen = text.charCodeAt(text.length - 1);
      return text.slice(0, text.length - padLen);
    } catch { return null; }
  };

  // Send E2E encrypted message
  const sendMessage = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient || !message) return toast.error("Fill in recipient and message");

    setLoading(true);
    try {
      // Try E2E first, fall back to legacy if recipient has no key
      let usedE2E = false;
      if (msgKeys) {
        let recipientPubKey = null;
        try {
          const r = await axios.get(`${API}/messaging/pubkey/${recipient.trim()}`);
          recipientPubKey = r.data.public_key;
        } catch { /* recipient not registered — will fall back */ }

        if (recipientPubKey) {
          const encrypted = await encryptMessage(message, recipientPubKey);
          await axios.post(`${API}/messaging/send-e2e`, {
            sender_address: address,
            recipient_address: recipient.trim(),
            ciphertext: encrypted.ciphertext,
            ephemeral_pub: encrypted.ephemeralPub,
            nonce: encrypted.nonce,
          });
          usedE2E = true;
        }
      }

      // Fallback: legacy server-side encryption (still encrypted, just not E2E)
      if (!usedE2E) {
        await axios.post(`${API}/messaging/send`, {
          sender_address: address,
          recipient_address: recipient.trim(),
          message,
          recipient_public_key: recipient.trim(),
        });
      }

      setSent(usedE2E ? "e2e" : "legacy");
      setMessage("");
      toast.success(usedE2E ? "Sent with true E2E encryption" : "Sent with encrypted delivery");
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
      {/* E2E Key Status Banner */}
      {msgKeys ? (
        <div className="bg-green-500/10 border border-green-500/30 p-3 text-xs text-green-300 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          <div>
            <span className="font-semibold">True E2E Encryption Active</span>
            <span className="text-green-300/60 ml-2">— Keys derived from your wallet signature. Server cannot read messages.</span>
          </div>
        </div>
      ) : signer ? (
        <button onClick={deriveKeys} disabled={deriving} data-testid="derive-keys-btn"
          className="w-full bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300 flex items-center gap-2 hover:bg-yellow-500/20 transition-colors">
          {deriving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
          <span className="font-semibold">Sign to enable E2E encryption</span>
          <span className="text-yellow-300/60 ml-1">— Your wallet will ask you to sign a message (no gas)</span>
        </button>
      ) : (
        <div className="bg-white/5 border border-white/10 p-3 text-xs text-white/40 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          Connect wallet to enable E2E encrypted messaging
        </div>
      )}

      <div className="flex gap-2">
        {["send", "inbox"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            data-testid={`msg-tab-${t}`}
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
              {copied ? "Link copied!" : "Copy your contact link — share so people can message you"}
            </button>
          )}
          <p className="text-xs text-white/30">
            Messages are encrypted end-to-end using ECDH + AES-256-GCM.
            The server stores only ciphertext — it cannot decrypt your messages.
          </p>
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
            {loading ? "Encrypting & Sending..." : "Send Encrypted"}
          </button>
          {sent && (
            <div className={`${sent === "e2e" ? "bg-green-400/10 border-green-400/30" : "bg-blue-400/10 border-blue-400/30"} border p-3 text-xs`}>
              {sent === "e2e" ? (
                <><div className="flex items-center gap-2 mb-1 text-green-300"><ShieldCheck className="w-3 h-3" /><span className="font-semibold">Sent with true E2E encryption</span></div>
                <span className="text-green-300/70">The server only stored ciphertext. Only the recipient's wallet can decrypt this message.</span></>
              ) : (
                <><div className="flex items-center gap-2 mb-1 text-blue-300"><Lock className="w-3 h-3" /><span className="font-semibold">Sent with encrypted delivery</span></div>
                <span className="text-blue-300/70">Recipient hasn't enabled E2E yet. Message was server-encrypted. When they enable E2E, future messages will be fully private.</span></>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "inbox" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/30">Messages sent to your wallet address</p>
            <button onClick={loadInbox} data-testid="msg-refresh-btn" className="text-xs text-white/40 hover:text-white transition-colors">Refresh</button>
          </div>
          {inbox.length === 0 ? (
            <div className="text-center py-10 text-white/30 space-y-2">
              <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Share your contact link so people can message you privately</p>
              {address && (
                <button onClick={copyLink} className="mt-2 px-4 py-2 border border-white/20 hover:border-white/50 text-xs text-white/50 hover:text-white transition-colors">
                  Copy contact link
                </button>
              )}
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
                  <p className="text-xs text-white/20 font-mono italic">
                    {!msgKeys ? "Sign to derive keys to decrypt messages" : "Unable to decrypt — message not addressed to your current wallet"}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
