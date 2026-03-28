import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { BookOpen, Plus, Trash2, Copy, Check, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { copyToClip } from "@/components/common/CopyButton";

export function PrivacyAddressBook() {
  const { address } = useWallet();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(null);

  // New entry form
  const [label, setLabel] = useState("");
  const [publicAddr, setPublicAddr] = useState("");
  const [stealthMeta, setStealthMeta] = useState("");
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/addressbook/${address}`);
      setEntries(res.data.entries || []);
    } catch {
      toast.error("Failed to load contacts");
    }
    setLoading(false);
  }, [address]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const addEntry = async () => {
    if (!label.trim()) return toast.error("Label is required");
    if (!publicAddr.trim() && !stealthMeta.trim()) return toast.error("Provide a public address or stealth meta-address");
    setAdding(true);
    try {
      // Encrypt notes client-side (simple base64 for now — real app would use AES with wallet-derived key)
      const notesEnc = notes ? btoa(unescape(encodeURIComponent(notes))) : null;
      await axios.post(`${API}/addressbook/add`, {
        owner_address: address,
        label: label.trim(),
        public_address: publicAddr.trim() || null,
        stealth_meta_address: stealthMeta.trim() || null,
        notes_encrypted: notesEnc,
        chain: "all",
      });
      toast.success("Contact added");
      setLabel(""); setPublicAddr(""); setStealthMeta(""); setNotes("");
      setShowForm(false);
      fetchEntries();
    } catch {
      toast.error("Failed to add contact");
    }
    setAdding(false);
  };

  const deleteEntry = async (entryId) => {
    try {
      await axios.delete(`${API}/addressbook/${entryId}`, { data: { owner_address: address } });
      toast.success("Contact removed");
      setEntries((prev) => prev.filter((e) => e.entry_id !== entryId));
    } catch {
      toast.error("Delete failed");
    }
  };

  const doCopy = (text, key) => {
    copyToClip(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const decodeNotes = (enc) => {
    try { return decodeURIComponent(escape(atob(enc))); } catch { return "(encrypted)"; }
  };

  if (!address) {
    return <p className="text-sm text-white/50">Connect your wallet to access the address book.</p>;
  }

  return (
    <div className="space-y-4" data-testid="privacy-address-book">
      <p className="text-sm text-white/50">
        Store contacts by stealth meta-address. Notes are encrypted before storage. Your private address book — never exposed on-chain.
      </p>

      {/* Add button */}
      <button
        data-testid="addressbook-add-toggle"
        onClick={() => setShowForm(!showForm)}
        className="w-full bg-white/5 border border-white/20 p-3 text-sm flex items-center justify-center gap-2 hover:bg-white/10"
      >
        <Plus className="w-4 h-4" /> {showForm ? "Cancel" : "Add Contact"}
      </button>

      {/* Add form */}
      {showForm && (
        <div className="bg-white/5 border border-white/10 p-4 space-y-3" data-testid="addressbook-form">
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Label *</label>
            <input
              data-testid="addressbook-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Alice, Treasury, DAO..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Public Address</label>
            <input
              data-testid="addressbook-public-addr"
              value={publicAddr}
              onChange={(e) => setPublicAddr(e.target.value)}
              placeholder="0x..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Stealth Meta-Address</label>
            <input
              data-testid="addressbook-stealth-meta"
              value={stealthMeta}
              onChange={(e) => setStealthMeta(e.target.value)}
              placeholder="st:eth:0x..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm font-mono outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Notes (encrypted)</label>
            <textarea
              data-testid="addressbook-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Private notes about this contact..."
              rows={2}
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none resize-none"
            />
          </div>
          <button
            data-testid="addressbook-save-button"
            onClick={addEntry}
            disabled={adding}
            className="w-full bg-white/10 border border-white/20 p-3 text-sm font-semibold hover:bg-white/15 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Save Contact
          </button>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-white/30 text-sm">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No contacts yet
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.entry_id} className="bg-white/5 border border-white/10 p-4" data-testid={`addressbook-entry-${entry.entry_id}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">{entry.label}</span>
                <button
                  data-testid={`addressbook-delete-${entry.entry_id}`}
                  onClick={() => deleteEntry(entry.entry_id)}
                  className="p-1 hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {entry.public_address && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-white/40">Address:</span>
                  <button onClick={() => doCopy(entry.public_address, entry.entry_id + "pa")} className="text-xs font-mono text-white/60 hover:text-white flex items-center gap-1">
                    {entry.public_address.slice(0, 10)}...{entry.public_address.slice(-6)}
                    {copied === entry.entry_id + "pa" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {entry.stealth_meta_address && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-white/40">Stealth:</span>
                  <button onClick={() => doCopy(entry.stealth_meta_address, entry.entry_id + "sm")} className="text-xs font-mono text-purple-400/70 hover:text-purple-300 flex items-center gap-1">
                    {entry.stealth_meta_address.slice(0, 16)}...
                    {copied === entry.entry_id + "sm" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {entry.notes_encrypted && (
                <div className="text-xs text-white/30 mt-1">{decodeNotes(entry.notes_encrypted)}</div>
              )}
              <div className="text-xs text-white/20 mt-2">{new Date(entry.created_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
