import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Lock, Copy, Check, Loader2, MessageSquare, ShieldCheck, X } from "lucide-react";
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
  const [sentMode, setSentMode] = useState(null);
  const [decrypted, setDecrypted] = useState({});
  const [copied, setCopied] = useState(false);
  const [msgKeys, setMsgKeys] = useState(null);
  const [deriving, setDeriving] = useState(false);
  const [openMsg, setOpenMsg] = useState(null);
  const [stealthAddr, setStealthAddr] = useState(null);
  const [msgCount, setMsgCount] = useState({ total: 0, unread: 0 });

  // Load message count on mount (before tab switch)
  useEffect(() => {
    if (!address) return;
    axios.get(`${API}/messaging/count/${address}`).then(r => {
      setMsgCount({ total: r.data.total || 0, unread: r.data.unread || 0 });
    }).catch(() => {});
  }, [address]);

  // Load user's stealth meta-address for sharing — NEVER expose raw public address
  useEffect(() => {
    if (!address) return;
    // Try stealth meta first (preferred)
    axios.get(`${API}/stealth/meta/${address}`).then(r => {
      if (r.data.meta_address) setStealthAddr(r.data.meta_address);
    }).catch(() => {
      // Fallback: check stealth/scan
      axios.get(`${API}/stealth/scan/${address}`).then(r => {
        const addrs = r.data.stealth_addresses || [];
        if (addrs.length > 0) setStealthAddr(addrs[0].meta_address || addrs[0].stealth_address);
      }).catch(() => {});
    });
  }, [address]);

  // Silently derive E2E keys — register with stealth address, not real wallet
  useEffect(() => {
    if (!signer || !address || msgKeys || deriving) return;
    let cancelled = false;
    setDeriving(true);
    (async () => {
      try {
        const keys = await deriveMessagingKeys(signer);
        if (cancelled) return;
        setMsgKeys(keys);
        // Register with both stealth and real address for receiving
        const registerAddr = stealthAddr ? stealthAddr.toLowerCase() : address.toLowerCase();
        await axios.post(`${API}/messaging/register-key`, { address: registerAddr, public_key: keys.publicKey }).catch(() => {});
        // Also register real address as fallback for receiving
        if (stealthAddr) {
          await axios.post(`${API}/messaging/register-key`, { address: address.toLowerCase(), public_key: keys.publicKey }).catch(() => {});
        }
      } catch {}
      if (!cancelled) setDeriving(false);
    })();
    return () => { cancelled = true; };
  }, [signer, address, stealthAddr, msgKeys, deriving]);

  // Decrypt a single message — try client-side first, then server fallback
  const tryDecrypt = async (m) => {
    // E2E messages: client-side only
    if (m.e2e && m.ciphertext && m.ephemeral_pub && m.nonce && msgKeys) {
      const plain = await decryptMessage(m.ciphertext, m.ephemeral_pub, m.nonce, msgKeys.privateKey);
      if (plain) return plain;
    }
    // Legacy: ask server to decrypt (it encrypted them, it can decrypt them)
    if (m.encrypted_content && !m.e2e) {
      try {
        const r = await axios.post(`${API}/messaging/decrypt`, {
          message_id: m.message_id,
          recipient_address: address,
        });
        if (r.data.plaintext) return r.data.plaintext;
      } catch {}
    }
    return null;
  };

  const loadInbox = useCallback(async () => {
    if (!address) return;
    try {
      const r = await axios.get(`${API}/messaging/inbox/${address}`);
      const msgs = r.data.messages || [];
      setInbox(msgs);
      setMsgCount({ total: r.data.total_count || msgs.length, unread: r.data.unread_count || 0 });
      const dec = {};
      for (const m of msgs) {
        const plain = await tryDecrypt(m);
        if (plain) dec[m.message_id] = plain;
      }
      setDecrypted(dec);
    } catch {}
  }, [address, msgKeys]);

  // Load inbox on mount AND on tab switch
  useEffect(() => {
    if (address) loadInbox();
  }, [address, loadInbox]);

  const sendMessage = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient || !message) return toast.error("Fill in recipient and message");
    if (!stealthAddr) return toast.error("Generate a stealth meta-address in Private Receive first — never expose your real address");
    setLoading(true);
    setSentMode(null);
    let recipientAddr = recipient.trim();
    // Extract address if user pasted a URL
    const msgParam = recipientAddr.match(/[?&]msg=([^&]+)/);
    if (msgParam) recipientAddr = msgParam[1];
    recipientAddr = recipientAddr.toLowerCase();
    // Use stealth address as sender — NEVER leak real public address
    const senderIdentity = stealthAddr.toLowerCase();
    try {
      let usedE2E = false;
      if (msgKeys) {
        try {
          const r = await axios.get(`${API}/messaging/pubkey/${recipientAddr}`);
          if (r.data.public_key) {
            const encrypted = await encryptMessage(message, r.data.public_key);
            await axios.post(`${API}/messaging/send-e2e`, {
              sender_address: senderIdentity,
              recipient_address: recipientAddr,
              ciphertext: encrypted.ciphertext,
              ephemeral_pub: encrypted.ephemeralPub,
              nonce: encrypted.nonce,
            });
            usedE2E = true;
          }
        } catch {}
      }
      if (!usedE2E) {
        await axios.post(`${API}/messaging/send`, {
          sender_address: senderIdentity,
          recipient_address: recipientAddr,
          message,
          recipient_public_key: recipientAddr,
        });
      }
      setSentMode(usedE2E ? "e2e" : "encrypted");
      setMessage("");
      toast.success(usedE2E ? "Sent with E2E encryption" : "Encrypted message sent");
      // Record stealth address usage
      axios.post(`${API}/stealth/use/${address}`, { feature: "messaging" }).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail || "Send failed");
    }
    setLoading(false);
  };

  const formatDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleDateString() + " " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // PRIVACY: Never share raw public address — stealth only
  const shareAddr = stealthAddr;

  return (
    <div className="space-y-4" data-testid="encrypted-messaging">
      {msgKeys && (
        <div className="bg-green-500/10 border border-green-500/30 p-3 text-xs text-green-300 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          <span><span className="font-semibold">E2E Active</span> — messages to other E2E users are end-to-end encrypted.</span>
        </div>
      )}

      <div className="flex gap-2">
        {["send", "inbox"].map(t => (
          <button key={t} onClick={() => setTab(t)} data-testid={`msg-tab-${t}`}
            className={`flex-1 py-2 text-sm font-medium capitalize ${tab === t ? "bg-white text-black" : "bg-white/10"}`}>
            {t === "inbox" ? `Inbox${msgCount.unread > 0 ? ` (${msgCount.unread})` : ""}` : "Send"}
          </button>
        ))}
      </div>

      {tab === "send" && (
        <div className="space-y-3">
          {shareAddr ? (
            <button onClick={() => { copyToClip(shareAddr); setCopied(true); toast.success("Stealth address copied — your real address stays hidden"); setTimeout(() => setCopied(false), 2000); }}
              className="w-full py-2 border border-white/20 hover:border-white/50 text-xs text-white/50 hover:text-white flex items-center justify-center gap-2 transition-colors">
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : (
                <span>
                  Share stealth address: <span className="font-mono">{shareAddr.slice(0, 12)}...{shareAddr.slice(-6)}</span>
                </span>
              )}
            </button>
          ) : (
            <div className="w-full py-3 border border-red-500/30 bg-red-500/10 text-xs text-red-400 text-center">
              Generate a stealth meta-address in <span className="font-semibold">Private Receive</span> first — your public address will never be exposed here.
            </div>
          )}
          <p className="text-xs text-white/30">All messages are encrypted. E2E when both wallets are connected.</p>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Recipient address</label>
            <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x... or stealth address"
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
                <div className="flex items-center gap-2"><ShieldCheck className="w-3 h-3" /><span>Sent with true E2E — server cannot read this.</span></div>
              ) : (
                <div className="flex items-center gap-2"><Lock className="w-3 h-3" /><span>Sent encrypted. Upgrades to E2E when recipient connects wallet.</span></div>
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
            </div>
          ) : (
            inbox.map((msg, i) => (
              <button key={i} data-testid={`msg-item-${i}`}
                onClick={() => setOpenMsg(msg)}
                className={`w-full text-left border p-4 transition-all hover:bg-white/5 cursor-pointer ${msg.read ? "border-white/10 bg-white/[0.02]" : "border-green-500/30 bg-green-400/5"}`}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-white/30" />
                    <span className="text-xs font-mono text-white/50">
                      {msg.sender_address?.startsWith("st:") ? "stealth:" + msg.sender_address?.slice(-8) : msg.sender_address?.slice(0, 6) + "..." + msg.sender_address?.slice(-4)}
                    </span>
                    {msg.e2e && <span className="text-[9px] border border-green-500/40 text-green-400 px-1 py-0.5">E2E</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {!msg.read && <span className="text-[10px] text-green-400 font-semibold">NEW</span>}
                    <span className="text-xs text-white/30">{formatDate(msg.created_at)}</span>
                  </div>
                </div>
                <p className="text-sm text-white/40 mt-2 truncate">
                  {decrypted[msg.message_id]
                    ? decrypted[msg.message_id].slice(0, 60) + (decrypted[msg.message_id].length > 60 ? "..." : "")
                    : "Tap to read"}
                </p>
              </button>
            ))
          )}
        </div>
      )}

      {/* Message popup */}
      {openMsg && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={() => setOpenMsg(null)}>
          <div className="bg-black border border-white/20 w-full max-w-md p-6 space-y-4 relative"
            onClick={e => e.stopPropagation()}>
            <button onClick={() => setOpenMsg(null)} data-testid="msg-modal-close"
              className="absolute top-4 right-4 text-white/40 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              {openMsg.e2e ? <ShieldCheck className="w-5 h-5 text-green-400" /> : <Lock className="w-5 h-5 text-blue-400" />}
              <span className="text-sm font-semibold">{openMsg.e2e ? "E2E Encrypted" : "Encrypted Message"}</span>
            </div>
            <div className="space-y-2 text-xs text-white/50">
              <div className="flex justify-between"><span>From</span><span className="font-mono">{openMsg.sender_address?.startsWith("st:") ? "stealth:" + openMsg.sender_address?.slice(-8) : openMsg.sender_address?.slice(0,6) + "..." + openMsg.sender_address?.slice(-4)}</span></div>
              <div className="flex justify-between"><span>Date</span><span>{formatDate(openMsg.created_at)}</span></div>
            </div>
            <div className="border-t border-white/10 pt-4">
              {decrypted[openMsg.message_id] ? (
                <p className="text-base text-white leading-relaxed whitespace-pre-wrap">{decrypted[openMsg.message_id]}</p>
              ) : (
                <div className="text-center py-4">
                  <Lock className="w-8 h-8 text-white/20 mx-auto mb-2" />
                  <p className="text-sm text-white/40">Decrypting failed for this message.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
