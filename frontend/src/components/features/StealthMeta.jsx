import { useState, useEffect } from "react";
import { Copy, Check, Shield, RefreshCw, ChevronDown, ChevronUp, History, Lock } from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import { ethers } from "ethers";
import { API } from "../../config/chains";
import {
  deriveStealthEOA,
  getAddressArchive,
  addAddressToArchive,
  getViewKeyForArchiveEntry,
} from "@/lib/wallet-stealth";

function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-white/20 hover:border-white/60 transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * StealthMeta — the customer's PRIVATE receive address(es).
 *
 * ONE primary address (the latest) is displayed front-and-centre
 * with a recycling icon on the right so the customer can mint a
 * FRESH receive address on demand. Every address the customer has
 * minted is stored LOCALLY in `localStorage` —
 * `upl:stealth-archive:<wallet>` — and NEVER leaves the browser
 *
 * Self-custodial guarantee:
 *   - No backend call stores a private key.
 *   - No backend call returns a private key.
 *   - `deriveStealthEOA(walletSignature)` is computed in the
 *     browser from a HKDF over a wallet-signed domain string.
 *   - The backend's `/stealth/meta/register` only sees the
 *     PUBLIC address (the `0x...` part) — useful for the
 *     stealth directory so others can announce payments to the
 *     customer. The backend never sees the private key.
 *
 * The customer sees:
 *   - Their `st:eth:0x...` link (current active address).
 *   - A recycling icon: click → mint a fresh address derived
 *     from the same wallet signature with new entropy. Old
 *     addresses drop into a local archive the customer can
 *     sweep from but the dashboard stops tracking them.
 *   - An expandable "Archive" panel listing every address the
 *     customer has minted.
 */
export function StealthMeta({ address, signer }) {
  const [active, setActive] = useState(null);
  const [archive, setArchive] = useState([]);
  const [step, setStep] = useState("check");
  const [loading, setLoading] = useState(false);
  // Hidden Notes state — for the P6 amount-hiding system
  const [notesOpen, setNotesOpen] = useState(false);
  const [hiddenNotes, setHiddenNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // On mount + on address change: pull local archive FIRST. The
  // archive is the source of truth (offline, self-custodial).
  // Backend is a secondary lookup for the meta_address display.
  useEffect(() => {
    if (!address) return;
    const local = getAddressArchive(address);
    if (local.length > 0) {
      setArchive(local);
      setActive(local[0]);
      setStep("done");
      return;
    }
    // No local archive — check the backend for the public
    // meta_address only (NOT looking for private keys there).
    axios.get(`${API}/stealth/meta/${address}`)
      .then((r) => {
        const meta = r?.data?.meta_address || "";
        const match = meta.match(/0x[a-fA-F0-9]{40}/);
        if (match) {
          // We have a public address but no private key. The user
          // can't sign for it from this device — prompt them to
          // generate one (will mint a fresh address).
          setStep("generate");
        } else {
          setStep("generate");
        }
      })
      .catch(() => setStep("generate"));
  }, [address]);

  /**
   * Generate the FIRST address (when the customer has none) OR
   * generate a NEW fresh address on click of the recycling icon.
   * Same wallet signature → different entropy →
   * different secp256k1 private key → independent stealth address.
   *
   * Always re-fetch the signer from the provider before signing.
   * The cached signer in React state goes stale when the user
   * switches MetaMask accounts; ethers v6 then errors with
   * 'from should be same as current address'.
   */
  const generate = async (opts = {}) => {
    if (!signer) { toast.error("Connect a wallet first"); return; }
    setLoading(true);
    const isRefresh = !!opts.refresh;
    try {
      const provider =
        signer.provider ||
        (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum)
          : null);
      if (!provider) { toast.error("No wallet provider"); setLoading(false); return; }
      const freshSigner = await provider.getSigner();

      try {
        const accounts = await provider.listAccounts();
        if (accounts && accounts[0] &&
            accounts[0].toLowerCase() !== freshSigner.address.toLowerCase()) {
          toast.error(
            "Wallet account changed. Reconnect and try again.",
            { duration: 6000 }
          );
          setLoading(false);
          return;
        }
      } catch { /* listAccounts not supported in older wallets */ }

      // For a refresh (recycling icon click), use fresh entropy.
      // For the initial generate, entropy is undefined → the
      // canonical "upl-stealth:wallet-2" derivation runs.
      const entropy = isRefresh
        ? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
        : undefined;
      const { address: stealthAddr, privateKey } =
        await deriveStealthEOA(freshSigner, entropy);
      // Append to the customer's LOCAL archive. Self-custodial —
      // only the user's browser holds the keys.
      addAddressToArchive(address, {
        address: stealthAddr,
        privateKey,
        entropy,
        createdAt: Date.now(),
      });
      // Update the UI from the on-disk archive so all counts
      // are consistent.
      const refreshed = getAddressArchive(address);
      setArchive(refreshed);
      setActive(refreshed[0]);

      // The backend's /stealth/meta/register endpoint stores
      // ONLY the public meta-address — never any private key.
      // This is the directory listing so other wallets know
      // where to send payments to. Safe to call; safe if
      // it fails (we still have the local archive).
      const metaAddress = stealthAddr;
      try {
        await axios.post(`${API}/stealth/meta/register`, {
          wallet_address: address,
          meta_address: metaAddress,
          chain: "all",
        });
      } catch {
        // Non-fatal — the customer's local copy is the source
        // of truth. Backend presence would just let other
        // wallets discover us; we can retry later.
      }
      setStep("done");
      toast.success(
        isRefresh
          ? `New receive address minted (${refreshed.length} total)`
          : "Stealth address ready"
      );
    } catch (e) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("from should be same")) {
        toast.error(
          "Wallet account changed. Reconnect your wallet and try again.",
          { duration: 6000 }
        );
      } else if (msg.includes("user rejected") || msg.includes("user denied")) {
        toast.error("Signature rejected in wallet. Click again and approve.");
      } else {
        toast.error(`Could not generate: ${e.message || "Unknown error"}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Scan for hidden notes sent to this user's stealth addresses
  const scanHiddenNotes = async () => {
    if (!address) return;
    setNotesLoading(true);
    try {
      const { scanNotes } = await import("@/lib/confidential-notes");
      const notes = await scanNotes(address, API);
      setHiddenNotes(notes);
    } catch {
      setHiddenNotes([]);
    }
    setNotesLoading(false);
  };

  // Auto-register view keys for all archive addresses when they're loaded
  useEffect(() => {
    if (!archive.length || !address) return;
    // Register view keys in the background (non-blocking)
    import("@/lib/confidential-notes").then(({ registerViewKey }) => {
      archive.forEach(entry => {
        const viewKey = getViewKeyForArchiveEntry(entry);
        if (viewKey) {
          registerViewKey(entry.address, viewKey, API).catch(() => {});
        }
      });
    }).catch(() => {});
  }, [archive, address]);

  if (!address) return (
    <div className="flex items-center justify-center h-40 text-white/30 text-sm">
      Connect a wallet first.
    </div>
  );

  const metaAddress = active ? active.address : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-white">Your Receive Link</h3>
        <p className="text-xs text-white/40">
          One address per recycle. Works on every chain. Click the recycle icon
          to mint a fresh address — old ones stay in your local archive forever.
        </p>
      </div>

      {step === "done" && active && metaAddress && (
        <>
          <div className="bg-green-400/5 border border-green-400/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/50">
                Share this. Anyone with this link pays you on any chain.
              </p>
              <span className="text-[10px] uppercase tracking-wider text-white/30">
                #{archive.length} of {archive.length}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <button
                data-testid="meta-address-display"
                onClick={() => { navigator.clipboard.writeText(metaAddress); toast.success("Link copied"); }}
                className="text-xs font-mono text-white/70 break-all text-left flex-1 hover:text-white cursor-pointer bg-black/30 p-3 border border-white/10"
              >
                {metaAddress}
              </button>
              <CopyBtn text={metaAddress} label="Link" />
              {/* RECYCLE BUTTON: clicking mints a brand-new stealth
                  address derived from the SAME wallet signature but
                  with fresh entropy. Old addresses drop into the
                  archive below. Self-custodial — the new private
                  key is computed and stored only in the browser. */}
              <button
                data-testid="recycle-stealth-btn"
                onClick={() => generate({ refresh: true })}
                disabled={loading}
                title="Mint a fresh stealth address"
                className="flex items-center justify-center w-10 h-10 border border-white/20 hover:border-white/60 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* ARCHIVE PANEL — every address the customer has minted,
              locally stored, scrollable. Clicking an archive row
              makes it the active receive address (the private key
              is still in the browser, so the customer can sweep
              from any of them later). */}
          <div className="border border-white/10">
            <button
              data-testid="archive-toggle"
              onClick={() => setArchiveOpen(o => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-2">
                <History className="w-3.5 h-3.5" />
                Local archive ({archive.length})
              </span>
              {archiveOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {archiveOpen && (
              <div className="border-t border-white/10 max-h-64 overflow-y-auto">
                {archive.map((entry, idx) => {
                  const isActive = entry.address === active.address;
                  return (
                    <div
                      key={entry.address}
                      className={`flex items-center justify-between px-3 py-2 text-xs border-b border-white/5 last:border-b-0 ${isActive ? "bg-white/5" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isActive && <span className="text-[10px] text-green-400 uppercase tracking-wider">Active</span>}
                          <span className="font-mono text-white/70 truncate">
                            {entry.address}
                          </span>
                        </div>
                        <div className="text-[10px] text-white/30 mt-0.5">
                          {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <CopyBtn text={entry.address} label="Address" />
                        {!isActive && (
                          <button
                            onClick={() => { setActive(entry); toast.success("Switched active receive address"); }}
                            className="px-2 py-1 text-[10px] uppercase tracking-wider border border-white/20 hover:border-white/60 hover:bg-white/5 transition-colors"
                          >
                            Use
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hidden Notes section — for the P6 amount-hiding system.
              Shows notes sent to this user with hidden amounts.
              Purely additive — doesn't affect the existing archive panel. */}
          <div className="border border-white/10 mt-2">
            <button
              data-testid="hidden-notes-toggle"
              onClick={() => { setNotesOpen(o => !o); if (!notesOpen && hiddenNotes.length === 0) scanHiddenNotes(); }}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                Hidden Notes ({hiddenNotes.length})
              </span>
              {notesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {notesOpen && (
              <div className="border-t border-white/10 max-h-64 overflow-y-auto">
                {notesLoading ? (
                  <div className="px-3 py-4 text-xs text-white/30 text-center">Scanning for hidden notes…</div>
                ) : hiddenNotes.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-white/30 text-center">No hidden notes found.</div>
                ) : (
                  hiddenNotes.map((note, i) => (
                    <div key={i} className="px-3 py-2 text-xs border-b border-white/5 last:border-b-0">
                      <div className="font-mono text-white/50 truncate">
                        Commitment: {note.commitment?.slice(0, 18)}…
                      </div>
                      <div className="text-[10px] text-white/30 mt-0.5">
                        Block: {note.blockNumber} · {note.isMine ? "Possibly mine" : "Unknown"}
                      </div>
                    </div>
                  ))
                )}
                {!notesLoading && (
                  <button onClick={scanHiddenNotes} className="w-full px-3 py-2 text-[10px] text-white/40 hover:text-white border-t border-white/5">
                    Re-scan
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {step === "generate" && (
        <div className="space-y-4">
          <div className="bg-blue-400/5 border border-blue-400/20 p-4">
            <p className="text-xs text-white/60">
              No link yet on this device.
            </p>
          </div>
          <button
            data-testid="generate-meta-btn"
            onClick={() => generate({ refresh: false })}
            disabled={loading}
            className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Shield className="w-4 h-4" />
            {loading ? "Making…" : "Make My Link"}
          </button>
        </div>
      )}
    </div>
  );
}
