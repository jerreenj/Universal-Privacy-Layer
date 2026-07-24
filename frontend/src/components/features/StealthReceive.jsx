/**
 * StealthReceive — Scan announcements to find payments meant for you.
 *
 * Customer flow:
 *   1. One Derive click → wallet signs once → HKDF produces view_priv,
 *      spend_pub, spend_priv. Browser caches it.
 *   2. Optional: a saved key file from another device.
 *   3. The Meta-Address + scannable QR are rendered so a payer can
 *      scan it. No pasting of view_priv/spend_pub — the customer
 *      never sees those strings anywhere on this tile.
 *   4. Scan → wallet scans base announcements, lists matches →
 *      sweep any matches into the customer's normal wallet.
 */
import { useState, useCallback, useEffect } from "react";
import * as ethersUtils from "@/lib/ethers-lazy";
import { QRCodeSVG } from "qrcode.react";
import { ScanLine, Loader2, ArrowDownLeft, ExternalLink, Zap, Upload, Key, QrCode, Download } from "lucide-react";
import { toast } from "sonner";
import { scanAnnouncements, computeStealthPrivKey } from "../../utils/stealth";
import { CHAINS } from "@/config/chains";
import { fetchAnnouncements as fetchAnnouncementsDirect } from "@/lib/direct-rpc-scanner";
import { deriveMetaAddress } from "@/lib/wallet-stealth";
import { useWallet } from "@/context/WalletContext";

const EXPLORERS = {
  base: "https://basescan.org",
  arbitrum: "https://arbiscan.io",
  polygon: "https://polygonscan.com",
  optimism: "https://optimistic.etherscan.com",
  bnb: "https://bscscan.com",
  avalanche: "https://snowtrace.com",
  hyperliquid: "https://purrsec.com",
};
const RPC = {
  base:        "https://rpc.ankr.com/base",
  arbitrum:    "https://rpc.ankr.com/arbitrum",
  polygon:     "https://rpc.ankr.com/polygon",
  optimism:    "https://rpc.ankr.com/optimism",
  bnb:         "https://rpc.ankr.com/bsc",
  avalanche:   "https://rpc.ankr.com/avalanche",
  hyperliquid: "https://rpc.hyperliquid.xyz/evm",
};

function fmtEth(wei) {
  if (!wei || wei === "0") return "0";
  return parseFloat(ethers.formatEther(wei)).toFixed(6);
}

function MatchCard({ match, onSweep, sweepReady }) {
  const [sweeping, setSweeping] = useState(false);
  const [balance, setBalance] = useState(match.balance || null);
  const exp = EXPLORERS[match.chain] || "";

  const checkBal = async () => {
    try {
      const rpc = RPC[match.chain];
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [match.derivedStealth, "latest"], id: 1 }),
      });
      const data = await res.json();
      setBalance(String(parseInt(data.result, 16)));
    } catch { toast.error("RPC check failed"); }
  };

  return (
    <div className="border border-green-400/30 bg-green-400/5 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <ArrowDownLeft className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold text-white">Incoming Payment</span>
          <span className="text-xs text-green-400/70 capitalize">{match.chain}</span>
        </div>
        {exp && match.tx_hash && (
          <a href={`${exp}/tx/${match.tx_hash}`} target="_blank" rel="noopener noreferrer"
            className="text-white/30 hover:text-white transition-colors">
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-white/40 mb-0.5">Stealth Address</p>
          <p className="font-mono text-white/70">{match.derivedStealth.slice(0, 12)}…{match.derivedStealth.slice(-6)}</p>
        </div>
        <div>
          <p className="text-white/40 mb-0.5">Announced Amount</p>
          <p className="font-semibold text-white">{fmtEth(match.amount_wei)} ETH</p>
        </div>
        <div>
          <p className="text-white/40 mb-0.5">Live Balance</p>
          {balance !== null
            ? <p className={`font-semibold ${balance === "0" ? "text-white/30" : "text-green-400"}`}>{fmtEth(balance)} ETH</p>
            : <button onClick={checkBal} className="text-blue-400 hover:text-blue-300 text-xs">Check balance</button>
          }
        </div>
        <div>
          <p className="text-white/40 mb-0.5">Date</p>
          <p className="text-white/60">{match.created_at ? new Date(match.created_at).toLocaleDateString() : "—"}</p>
        </div>
      </div>
      <button
        data-testid="sweep-btn"
        onClick={() => onSweep(match)}
        disabled={sweeping || balance === "0" || !sweepReady}
        title={!sweepReady ? "Derive from wallet to enable sweep" : ""}
        className="w-full py-2 bg-green-400 text-black font-bold text-xs hover:bg-green-300 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
      >
        <Zap className="w-3 h-3" />
        {sweeping ? "Sweeping…" : balance === "0" ? "Empty" : "Sweep to My Wallet"}
      </button>
    </div>
  );
}

function MetaWithQr({ metaAddress }) {
  const downloadQr = () => {
    // Render the QR as an inline SVG into a Blob and trigger a download.
    const svg = document.querySelector('#meta-qr-svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n' + xml],
      { type: "image/svg+xml" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-stealth-link.svg";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center">
        <div className="p-2 bg-white">
          <QRCodeSVG
            id="meta-qr-svg"
            value={metaAddress}
            size={180}
            level="M"
            includeMargin={false}
          />
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs text-white/50">Show this QR to someone — they scan and pay.</p>
      </div>
      <button
        onClick={downloadQr}
        className="w-full text-xs px-3 py-1.5 text-white/50 hover:text-white border border-white/10"
      >
        <Download className="w-3 h-3 inline mr-1" /> Download QR
      </button>
    </div>
  );
}

export function StealthReceive({ address, chain: chainProp }) {
  const { signer } = useWallet();
  const initialChain = (chainProp && chainProp !== "all") ? chainProp : "base";
  const showChainPicker = !chainProp || chainProp === "all";

  const [viewPriv, setViewPriv] = useState("");
  const [spendPub, setSpendPub] = useState("");
  const [spendPriv, setSpendPriv] = useState("");
  const [metaAddress, setMetaAddress] = useState("");
  const [selectedChain, setSelectedChain] = useState(initialChain);
  const [matches, setMatches] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [inputMode, setInputMode] = useState("derive"); // derive | file
  const [loading, setLoading] = useState(false);

  // Persist derived meta to localStorage so reloads don't force another sign.
  useEffect(() => {
    if (!address) return;
    try {
      const raw = localStorage.getItem(`upl:scan:${address.toLowerCase()}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      setViewPriv(data.view_priv || "");
      setSpendPub(data.spend_pub || "");
      setSpendPriv(data.spend_priv || "");
      setMetaAddress(data.meta_address || "");
    } catch {}
  }, [address]);

  const loadFromFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setViewPriv(data.view_priv || "");
        setSpendPub(data.spend_pub || "");
        setSpendPriv(data.spend_priv || "");
        setMetaAddress(data.meta_address || "");
        toast.success("Keys loaded from file");
      } catch { toast.error("Invalid key file"); }
    };
    reader.readAsText(file);
  };

  // One click: wallet signs once, HKDF produces view_priv + spend_pub +
  // spend_priv + meta_address. Customer sees a QR of the meta so they
  // can hand it to a payer. The view_priv/spend_pub are NOT displayed.
  //
  // Each async step has a hard timeout so the loading state cannot
  // stick at 'Deriving…' indefinitely if the wallet popup never
  // appears (browser popup blocker, dead wallet extension, signed
  // out / reconnected mid-call, etc.). The user gets a clear toast
  // telling them what to do instead of staring at a half-loaded button.
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

  const deriveFromWallet = useCallback(async () => {
    if (!signer) {
      toast.error("Connect your wallet first");
      return;
    }
    // Re-fetch a fresh signer from the provider. Cached signers
    // in React state go stale when the user switches MetaMask
    // accounts; ethers v6 throws 'from should be same as
    // current address' in that case. Catching it here is
    // the whole reason this re-fetch exists.
    let activeSigner = signer;
    try {
      const liveProvider =
        signer.provider ||
        (typeof window !== "undefined" && window.ethereum
          ? new ethers.BrowserProvider(window.ethereum)
          : null);
      if (liveProvider) {
        const fresh = await liveProvider.getSigner();
        // Sanity: make sure MetaMask's currently-selected account
        // matches what we think it is. If not, surface the error
        // and stop before signing.
        try {
          const accounts = await liveProvider.listAccounts();
          if (accounts && accounts[0] &&
              accounts[0].toLowerCase() !== fresh.address.toLowerCase()) {
            toast.error(
              "MetaMask account changed. Reconnect and try again.",
              { duration: 6000 }
            );
            return;
          }
        } catch { /* listAccounts unsupported */ }
        activeSigner = fresh;
      }
    } catch (e) {
      // Fall back to the React-cached signer. If it fails, the
      // catch block below reports the specific case.
    }

    setLoading(true);
    try {
      let chainIdNum = 8453;
      if (chainProp && chainProp !== "all" && signer.provider) {
        try {
          const net = await withTimeout(signer.provider.getNetwork(), 5000, "wallet network");
          chainIdNum = Number(net.chainId) || 8453;
        } catch {
          chainIdNum = 8453;
        }
      }
      let meta;
      try {
        meta = await withTimeout(
          deriveMetaAddress(signer, BigInt(chainIdNum)),
          25000,
          "Wallet sign"
        );
      } catch (signErr) {
        // Specific cause: wallet popup didn't appear or user denied.
        const cause = (signErr?.message || "").toLowerCase().includes("denied") || (signErr?.message || "").toLowerCase().includes("reject")
          ? "You rejected the signature in your wallet. Try again and click Sign."
          : (signErr?.message || "").toLowerCase().includes("timed out")
          ? "Your wallet didn't respond. Open your wallet extension and try again."
          : "Unable to sign with your wallet. Open the wallet extension and ensure it's connected to this page.";
        toast.error("Derive failed: " + cause, { duration: 6000 });
        return;
      }
      setViewPriv(meta.viewPriv);
      setSpendPub(meta.spendPub);
      setSpendPriv(meta.spendPriv || "");
      setMetaAddress(meta.metaAddress);
      // Cache so a page reload doesn't force a fresh signature.
      try {
        localStorage.setItem(`upl:scan:${address.toLowerCase()}`, JSON.stringify({
          meta_address: meta.metaAddress,
          view_priv: meta.viewPriv,
          spend_pub: meta.spendPub,
          spend_priv: meta.spendPriv,
        }));
      } catch {}
      toast.success("Done. Scroll down to see your QR code.", { duration: 5000 });
    } catch (e) {
      toast.error("Derive failed: " + ((e?.message || String(e)).slice(0, 80)));
    } finally {
      setLoading(false);
    }
  }, [signer, chainProp, address]);

  const chainOptions = chainProp === "all"
    ? ["all", ...Object.keys(CHAINS).filter(c => CHAINS[c].vm === "evm")]
    : ["all", chainProp];

  const scan = useCallback(async () => {
    if (!viewPriv || !spendPub) return toast.error("Derive from wallet first");
    setScanning(true);
    setScanned(false);
    setMatches([]);
    try {
      const provider = (typeof window !== "undefined" && window.ethereum)
        ? new ethers.BrowserProvider(window.ethereum)
        : null;
      const chainKey = selectedChain === "all" ? "base" : selectedChain;
      const announcements = await fetchAnnouncementsDirect({
        chain: chainKey,
        provider: provider || undefined,
        fromBlock: -5000n,
        toBlock: "latest",
      });
      const found = scanAnnouncements(announcements, viewPriv, spendPub);
      setMatches(found);
      setScanned(true);
      if (found.length === 0) toast.info(`Scanned ${announcements.length} announcements — no payments found`);
      else toast.success(`Found ${found.length} payment${found.length !== 1 ? "s" : ""}!`);
    } catch {
      toast.error("Scan failed — check keys and try again");
    } finally {
      setScanning(false);
    }
  }, [viewPriv, spendPub, selectedChain]);

  const sweep = async (match) => {
    if (!spendPriv) { toast.error("Spend key required to sweep"); return; }
    try {
      const stealthPrivKey = computeStealthPrivKey(spendPriv, viewPriv, match.ephemeral_pub);
      const rpc = RPC[match.chain];
      const ethProvider = new ethers.JsonRpcProvider(rpc);
      const stealthWallet = new ethers.Wallet(stealthPrivKey, ethProvider);
      const balance = await ethProvider.getBalance(match.derivedStealth);
      if (balance === 0n) { toast.error("Stealth address is empty"); return; }
      const gasPrice = (await ethProvider.getFeeData()).gasPrice;
      const gasCost = gasPrice * 21000n;
      const sendAmount = balance - gasCost;
      if (sendAmount <= 0n) { toast.error("Balance too low to cover gas"); return; }
      const tx = await stealthWallet.sendTransaction({
        to: address,
        value: sendAmount,
      });
      toast.success(`Sweep tx broadcast: ${tx.hash.slice(0, 16)}…`);
    } catch (e) {
      toast.error(e.message?.slice(0, 80) || "Sweep failed");
    }
  };

  const sweepReady = Boolean(spendPriv);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ArrowDownLeft className="w-5 h-5 text-blue-400" />
        <div>
          <h3 className="font-semibold text-white">Scan & Receive</h3>
          <p className="text-xs text-white/40">Find payments sent to your receive link</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setInputMode("derive")}
          className={`text-xs px-3 py-1.5 border transition-colors ${inputMode === "derive" ? "border-white text-white" : "border-white/20 text-white/40"}`}
        >
          Derive
        </button>
        <button
          onClick={() => setInputMode("file")}
          className={`text-xs px-3 py-1.5 border transition-colors ${inputMode === "file" ? "border-white text-white" : "border-white/20 text-white/40"}`}
        >
          Key File
        </button>
      </div>

      {inputMode === "derive" && (
        <button
          data-testid="derive-from-wallet-btn"
          onClick={deriveFromWallet}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 border border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/15 py-3 text-sm text-blue-300 transition-colors disabled:opacity-50"
        >
          <Key className="w-4 h-4" /> {loading ? "Deriving…" : "Derive from wallet (one signature)"}
        </button>
      )}

      {inputMode === "file" && (
        <label className="flex items-center justify-center gap-2 border border-dashed border-white/20 py-4 cursor-pointer hover:border-white/40 transition-colors text-sm text-white/40">
          <Upload className="w-4 h-4" />
          Click to load stealth-keys.json
          <input type="file" accept=".json" onChange={loadFromFile} className="hidden" />
        </label>
      )}

      {/* QR Code — shown after derive OR file load. Customer hands the
          QR to a payer; payer scans → meta-adress goes into their
          send form → broadcast goes to a fresh stealth destination. */}
      {metaAddress && (
        <div className="space-y-2">
          <p className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-1">
            <QrCode className="w-3 h-3" /> Your receive link
          </p>
          <code className="text-[11px] text-white/70 break-all block">{metaAddress}</code>
          <MetaWithQr metaAddress={metaAddress} />
        </div>
      )}

      {showChainPicker && chainOptions.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {chainOptions.map(c => (
            <button
              key={c}
              onClick={() => setSelectedChain(c)}
              className={`text-xs px-3 py-1 border capitalize transition-colors ${selectedChain === c ? "border-blue-400 text-blue-400 bg-blue-400/10" : "border-white/20 text-white/40 hover:border-white/40"}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <button
        data-testid="scan-btn"
        onClick={scan}
        disabled={scanning || !viewPriv || !spendPub}
        className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
      >
        {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
        {scanning ? "Scanning announcements…" : "Scan for Payments"}
      </button>

      {scanned && (
        <div className="space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-wider">
            {matches.length > 0 ? `${matches.length} payment${matches.length !== 1 ? "s" : ""} found` : "No payments found"}
          </p>
          {matches.length === 0 ? (
            <div className="text-center py-4">
              <ScanLine className="w-6 h-6 text-white/20 mx-auto mb-2" />
              <p className="text-sm text-white/30">No payments detected</p>
            </div>
          ) : (
            <div className="space-y-3">
              {matches.map((m, i) => (
                <MatchCard key={i} match={m} onSweep={sweep} sweepReady={sweepReady} />
              ))}
              {!sweepReady && (
                <p className="text-xs text-yellow-400/70">
                  Sweep disabled — your wallet didn't expose a spend key this session. Re-derive from wallet or load a key file to sweep.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
