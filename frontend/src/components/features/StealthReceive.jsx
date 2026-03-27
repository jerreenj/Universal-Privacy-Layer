/**
 * StealthReceive — Scan all announcements and find payments meant for you
 * Uses view key only (spend key stays private)
 */
import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { ScanLine, Eye, EyeOff, Loader2, ArrowDownLeft, ExternalLink, Key, Zap } from "lucide-react";
import { toast } from "sonner";
import { scanAnnouncements, computeStealthPrivKey, parseMetaAddress } from "../../utils/stealth";
import { API, CHAINS } from "../../config/chains";
import axios from "axios";

const authHeaders = () => ({
  Authorization: `Bearer ${sessionStorage.getItem("_upl_tok") || ""}`,
});

const CHAIN_LIST = ["all", "base", "arbitrum", "polygon", "optimism", "bnb", "avalanche", "hyperliquid"];
const EXPLORERS = {
  base: "https://basescan.org",
  arbitrum: "https://arbiscan.io",
  polygon: "https://polygonscan.com",
  optimism: "https://optimistic.etherscan.io",
  bnb: "https://bscscan.com",
  avalanche: "https://snowtrace.io",
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

function MatchCard({ match, onSweep }) {
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
        disabled={sweeping || balance === "0"}
        className="w-full py-2 bg-green-400 text-black font-bold text-xs hover:bg-green-300 disabled:opacity-30 transition-colors flex items-center justify-center gap-2"
      >
        <Zap className="w-3 h-3" />
        {sweeping ? "Sweeping…" : balance === "0" ? "Empty" : "Sweep to My Wallet"}
      </button>
    </div>
  );
}

export function StealthReceive({ address, provider }) {
  const [viewPriv, setViewPriv] = useState("");
  const [spendPub, setSpendPub] = useState("");
  const [spendPriv, setSpendPriv] = useState(""); // only for sweep
  const [selectedChain, setSelectedChain] = useState("all");
  const [matches, setMatches] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [useFile, setUseFile] = useState(false);

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
        toast.success("Keys loaded from file");
      } catch { toast.error("Invalid key file"); }
    };
    reader.readAsText(file);
  };

  const scan = useCallback(async () => {
    if (!viewPriv || !spendPub) return;
    setScanning(true);
    setScanned(false);
    setMatches([]);
    try {
      const r = await axios.get(`${API}/stealth/announcements`, {
        params: { chain: selectedChain, limit: 1000 },
        headers: authHeaders(),
      });
      const announcements = r.data.announcements || [];
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
    if (!spendPriv || !provider) { toast.error("Spend private key required to sweep"); return; }
    try {
      const stealthPrivKey = computeStealthPrivKey(spendPriv, viewPriv, match.ephemeral_pub);
      const rpc = RPC[match.chain];
      const ethProvider = new ethers.JsonRpcProvider(rpc);
      const stealthWallet = new ethers.Wallet(stealthPrivKey, ethProvider);

      // Get balance
      const balance = await ethProvider.getBalance(match.derivedStealth);
      if (balance === 0n) { toast.error("Stealth address is empty"); return; }

      // Estimate gas
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ArrowDownLeft className="w-5 h-5 text-blue-400" />
        <div>
          <h3 className="font-semibold text-white">Scan & Receive</h3>
          <p className="text-xs text-white/40">Find private payments sent to your stealth addresses</p>
        </div>
      </div>

      {/* Key input */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setUseFile(false)}
            className={`text-xs px-3 py-1.5 border transition-colors ${!useFile ? "border-white text-white" : "border-white/20 text-white/40"}`}
          >
            Manual
          </button>
          <button
            onClick={() => setUseFile(true)}
            className={`text-xs px-3 py-1.5 border transition-colors ${useFile ? "border-white text-white" : "border-white/20 text-white/40"}`}
          >
            Load Key File
          </button>
        </div>

        {useFile ? (
          <label className="flex items-center justify-center gap-2 border border-dashed border-white/20 py-4 cursor-pointer hover:border-white/40 transition-colors text-sm text-white/40">
            <Key className="w-4 h-4" />
            Click to load stealth-keys.json
            <input type="file" accept=".json" onChange={loadFromFile} className="hidden" />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-1">
                <Eye className="w-3 h-3" /> View Private Key
              </label>
              <input
                data-testid="view-priv-input"
                type={showKeys ? "text" : "password"}
                value={viewPriv}
                onChange={e => setViewPriv(e.target.value)}
                placeholder="0x..."
                className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-white/50 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-white/40 uppercase tracking-wider flex items-center gap-1">
                <Key className="w-3 h-3" /> Spend Public Key
              </label>
              <input
                data-testid="spend-pub-input"
                type={showKeys ? "text" : "password"}
                value={spendPub}
                onChange={e => setSpendPub(e.target.value)}
                placeholder="0x..."
                className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-white/50 font-mono"
              />
            </div>
            <button
              onClick={() => setShowKeys(!showKeys)}
              className="text-xs text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors"
            >
              {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showKeys ? "Hide" : "Show"} keys
            </button>
          </div>
        )}

        {/* Chain filter */}
        <div className="flex flex-wrap gap-2">
          {CHAIN_LIST.map(c => (
            <button
              key={c}
              onClick={() => setSelectedChain(c)}
              className={`text-xs px-3 py-1 border capitalize transition-colors ${selectedChain === c ? "border-blue-400 text-blue-400 bg-blue-400/10" : "border-white/20 text-white/40 hover:border-white/40"}`}
            >
              {c}
            </button>
          ))}
        </div>

        <button
          data-testid="scan-btn"
          onClick={scan}
          disabled={scanning || !viewPriv || !spendPub}
          className="w-full py-3 bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          {scanning ? "Scanning announcements…" : "Scan for Payments"}
        </button>
      </div>

      {/* Results */}
      {scanned && (
        <div className="space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-wider">
            {matches.length > 0 ? `${matches.length} payment${matches.length !== 1 ? "s" : ""} found` : "No payments found"}
          </p>
          {matches.length === 0 ? (
            <div className="border border-white/10 p-4 text-center">
              <ScanLine className="w-6 h-6 text-white/20 mx-auto mb-2" />
              <p className="text-sm text-white/30">No payments detected</p>
              <p className="text-xs text-white/20 mt-1">Ask someone to send to your meta-address and announce</p>
            </div>
          ) : (
            <div className="space-y-3">
              {matches.map((m, i) => (
                <MatchCard key={i} match={m} onSweep={sweep} />
              ))}
              {!spendPriv && (
                <div className="space-y-1.5 border-t border-white/10 pt-3">
                  <label className="text-xs text-white/40 uppercase tracking-wider">
                    Spend Private Key (required to sweep)
                  </label>
                  <input
                    type="password"
                    value={spendPriv}
                    onChange={e => setSpendPriv(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-transparent border border-red-400/30 px-3 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-red-400/60 font-mono"
                  />
                  <p className="text-xs text-red-400/60">Your spend private key is used locally to sign the sweep tx and is never sent to any server.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
