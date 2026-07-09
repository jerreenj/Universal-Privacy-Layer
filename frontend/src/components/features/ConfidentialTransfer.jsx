/**
 * ConfidentialTransfer — Send USDC privately with amount hidden.
 *
 * This is the P2 feature: the amount is a private input in a ZK
 * proof. Between two Privacy Cloak users, the amount is NEVER
 * plaintext on Base. The EVM verifies the proof without seeing it.
 *
 * Flow:
 *   1. User has a deposited note (from the deposit step)
 *   2. User enters recipient's stealth address + amount to send
 *   3. Browser generates ZK proof (amount as private input)
 *   4. Proof submitted to backend → relayer broadcasts
 *   5. Recipient scans, finds their note, decrypts amount
 *
 * What's hidden on BaseScan:
 *   - Sender (relayer broadcasts)
 *   - Recipient (stealth address)
 *   - Amount (encrypted in ZK proof, never plaintext)
 */
import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Lock, Send, Loader2, Check, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import {
  randomFieldElement,
  computeCommitment,
  computeNullifierHash,
  generateConfidentialTransferProof,
} from "@/lib/zk-browser";

// Deployed on Base mainnet
const VAULT_ADDRESS = "0x5fC8608ae28D493DBF7088822C48DeCBd20cCFBa";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const VAULT_ABI = [
  "function deposit(uint256 nullifier, uint256 secret, uint256 amount, uint256 blindingFactor) external",
  "function currentRootOf() view returns (bytes32)",
  "function depositCount() view returns (uint32)",
  "function reserveBalance() view returns (uint256)",
  "function noteEncryptedAmounts(bytes32) view returns (bytes32)",
];

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

export function ConfidentialTransfer() {
  const { address, signer, chain } = useWallet();
  const [mode, setMode] = useState("deposit"); // deposit | transfer | withdraw
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState(null);
  const [noteInput, setNoteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [vaultInfo, setVaultInfo] = useState(null);

  // Fetch vault info on mount
  useEffect(() => {
    fetchVaultInfo();
  }, []);

  async function fetchVaultInfo() {
    try {
      const provider = new ethers.JsonRpcProvider(CHAINS.base.rpcUrl);
      const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
      const [root, count, reserve] = await Promise.all([
        vault.currentRootOf(),
        vault.depositCount(),
        vault.reserveBalance(),
      ]);
      setVaultInfo({
        root: root,
        notes: count,
        reserve: ethers.formatUnits(reserve, 6),
      });
    } catch {}
  }

  // ── Deposit: wrap USDC into a confidential note ───────────────
  async function handleDeposit() {
    if (!address || !signer) return toast.error("Connect wallet first");
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter amount");
    setLoading(true);
    try {
      const usdcAmount = ethers.parseUnits(amount, 6);

      // Generate note secrets
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const blindingFactor = randomFieldElement();

      // Approve USDC for the vault
      const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
      const approveTx = await usdc.approve(VAULT_ADDRESS, ethers.MaxUint256);
      await approveTx.wait();

      // Deposit
      const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      const tx = await vault.deposit(
        BigInt(nullifier),
        BigInt(secret),
        usdcAmount,
        BigInt(blindingFactor)
      );
      await tx.wait();
      setTxHash(tx.hash);

      // Save the note locally
      const commitment = await computeCommitment(nullifier, secret);
      const nullifierHash = await computeNullifierHash(nullifier);
      const noteData = {
        chain: "base",
        vault: VAULT_ADDRESS,
        nullifier,
        secret,
        blindingFactor,
        amount: usdcAmount.toString(),
        amountHuman: amount,
        commitment,
        nullifierHash,
        txHash: tx.hash,
        createdAt: new Date().toISOString(),
      };
      setNote(noteData);

      // Store in localStorage
      try {
        const notes = JSON.parse(localStorage.getItem("upl:confidential-notes") || "[]");
        notes.push(noteData);
        localStorage.setItem("upl:confidential-notes", JSON.stringify(notes));
      } catch {}

      toast.success(`${amount} USDC deposited as confidential note`);
      fetchVaultInfo();
    } catch (e) {
      toast.error(e.message?.slice(0, 80) || "Deposit failed");
    }
    setLoading(false);
  }

  // ── Transfer: send confidentially with amount hidden ──────────
  async function handleTransfer() {
    if (!address) return toast.error("Connect wallet first");
    if (!recipient || !ethers.isAddress(recipient)) return toast.error("Enter valid recipient");
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter amount");
    if (!note) return toast.error("Load a note first");
    setLoading(true);
    try {
      // Fetch Merkle path from backend
      const pathRes = await axios.post(`${API}/confidential/path`, {
        commitment: note.commitment,
      });
      const { root, merklePathElements, merklePathIndices } = pathRes.data;

      // Generate new note secrets for the recipient
      const newBlindingFactor = randomFieldElement();
      const usdcAmount = ethers.parseUnits(amount, 6);

      // Generate ZK proof in browser — amount is PRIVATE
      const { proof, publicSignals } = await generateConfidentialTransferProof({
        nullifier: note.nullifier,
        secret: note.secret,
        amount: usdcAmount.toString(),
        blindingFactor: newBlindingFactor,
        root,
        recipient: BigInt(recipient).toString(),
        merklePathElements,
        merklePathIndices,
      });

      // Submit to backend relayer
      const submitRes = await axios.post(`${API}/confidential/transfer-relay`, {
        proof_a: [proof.pi_a[0], proof.pi_a[1]],
        proof_b: [
          [proof.pi_b[0][0], proof.pi_b[0][1]],
          [proof.pi_b[1][0], proof.pi_b[1][1]],
        ],
        proof_c: [proof.pi_c[0], proof.pi_c[1]],
        pub_signals: publicSignals,
        from_address: address,
        chain: "base",
      });

      setTxHash(submitRes.data.tx_hash || submitRes.data.relay_tx_hash || "");
      toast.success("Confidential transfer relayed — amount hidden on BaseScan");

      // Store recipient note in localStorage (not console — privacy leak)
      const recipientNote = {
        chain: "base",
        vault: VAULT_ADDRESS,
        amount: usdcAmount.toString(),
        amountHuman: amount,
        blindingFactor: newBlindingFactor,
        commitment: publicSignals[1],
        encryptedAmount: publicSignals[2],
        recipient,
        txHash: submitRes.data.tx_hash || submitRes.data.relay_tx_hash || "",
        createdAt: new Date().toISOString(),
      };
      try {
        const notes = JSON.parse(localStorage.getItem("upl:confidential-received") || "[]");
        notes.push(recipientNote);
        localStorage.setItem("upl:confidential-received", JSON.stringify(notes));
      } catch {}
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Transfer failed";
      toast.error(msg);
    }
    setLoading(false);
  }

  // ── Withdraw: unwrap confidential note to real USDC ───────────
  async function handleWithdraw() {
    if (!address || !signer) return toast.error("Connect wallet first");
    if (!recipient || !ethers.isAddress(recipient)) return toast.error("Enter valid recipient");
    if (!note) return toast.error("Load a note first");
    setLoading(true);
    try {
      const pathRes = await axios.post(`${API}/confidential/path`, {
        commitment: note.commitment,
      });
      const { root, merklePathElements, merklePathIndices } = pathRes.data;

      const { proof, publicSignals } = await generateConfidentialTransferProof({
        nullifier: note.nullifier,
        secret: note.secret,
        amount: note.amount,
        blindingFactor: randomFieldElement(), // new blinding for the "change" note
        root,
        recipient: BigInt(recipient).toString(),
        merklePathElements,
        merklePathIndices,
      });

      const submitRes = await axios.post(`${API}/confidential/withdraw-relay`, {
        proof_a: [proof.pi_a[0], proof.pi_a[1]],
        proof_b: [
          [proof.pi_b[0][0], proof.pi_b[0][1]],
          [proof.pi_b[1][0], proof.pi_b[1][1]],
        ],
        proof_c: [proof.pi_c[0], proof.pi_c[1]],
        pub_signals: publicSignals,
        amount: note.amount,
        from_address: address,
        chain: "base",
      });

      setTxHash(submitRes.data.tx_hash || "");
      toast.success("Withdrawn to stealth address");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Withdraw failed";
      toast.error(msg);
    }
    setLoading(false);
  }

  function loadNote() {
    try {
      const parsed = JSON.parse(noteInput);
      if (!parsed.nullifier || !parsed.secret || !parsed.commitment || !parsed.amount) {
        throw new Error("Note must have nullifier, secret, commitment, and amount");
      }
      setNote(parsed);
      toast.success("Note loaded");
    } catch {
      toast.error("Invalid note JSON");
    }
  }

  function downloadNote() {
    if (!note) return;
    const blob = new Blob([JSON.stringify(note, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upl-confidential-note-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Lock className="w-5 h-5 text-blue-400" />
        <div>
          <h3 className="font-semibold text-white">Confidential Transfer</h3>
          <p className="text-xs text-white/40">
            Send USDC with amount hidden on BaseScan — ZK proof, zero plaintext
          </p>
        </div>
      </div>

      {vaultInfo && (
        <div className="bg-white/5 border border-white/10 p-3 flex justify-between text-xs">
          <span className="text-white/50">Vault: {vaultInfo.notes} notes</span>
          <span className="text-white/50">Reserve: {vaultInfo.reserve} USDC</span>
        </div>
      )}

      {/* Mode tabs */}
      <div className="flex gap-1">
        {["deposit", "transfer", "withdraw"].map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setTxHash(""); }}
            className={`flex-1 py-2 text-xs uppercase tracking-wider ${
              mode === m ? "bg-white text-black" : "bg-white/5 text-white/50 hover:bg-white/10"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Deposit mode */}
      {mode === "deposit" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 uppercase mb-1">Amount (USDC)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1.0"
              className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/50"
            />
          </div>
          <button
            onClick={handleDeposit}
            disabled={loading || !amount}
            className="w-full py-3 bg-blue-500 text-white font-bold text-sm hover:bg-blue-400 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Deposit as Confidential Note
          </button>
          <p className="text-[11px] text-white/30">
            USDC is wrapped into a ZK note commitment. The deposit amount is visible
            at this boundary (USDC Transfer event), but your identity is hidden via
            the proxy wallet. Between Privacy Cloak users, the amount is fully hidden.
          </p>
        </div>
      )}

      {/* Transfer mode */}
      {mode === "transfer" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 uppercase mb-1">Recipient (stealth address)</label>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/50"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 uppercase mb-1">Amount (USDC)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.5"
              className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/50"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 uppercase mb-1">Your Note (JSON)</label>
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder='{"nullifier":"...","secret":"...","amount":"...","commitment":"..."}'
              rows={3}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/50"
            />
            <button onClick={loadNote} className="text-xs text-blue-400 hover:text-blue-300 mt-1">
              Load Note
            </button>
          </div>
          <button
            onClick={handleTransfer}
            disabled={loading || !recipient || !amount || !note}
            className="w-full py-3 bg-green-500 text-black font-bold text-sm hover:bg-green-400 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Confidentially (Amount Hidden)
          </button>
          <p className="text-[11px] text-green-300/60">
            The amount is a private input in the ZK proof. BaseScan sees only a
            proof verification — no plaintext amount anywhere.
          </p>
        </div>
      )}

      {/* Withdraw mode */}
      {mode === "withdraw" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-white/40 uppercase mb-1">Withdraw To (stealth address)</label>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-transparent border border-white/20 px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-white/50"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 uppercase mb-1">Your Note (JSON)</label>
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder='{"nullifier":"...","secret":"...","amount":"...","commitment":"..."}'
              rows={3}
              className="w-full bg-transparent border border-white/20 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-white/50"
            />
            <button onClick={loadNote} className="text-xs text-blue-400 hover:text-blue-300 mt-1">
              Load Note
            </button>
          </div>
          <button
            onClick={handleWithdraw}
            disabled={loading || !recipient || !note}
            className="w-full py-3 bg-white text-black font-bold text-sm hover:bg-white/90 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Withdraw to Real USDC
          </button>
          <p className="text-[11px] text-white/30">
            Unwraps the confidential note back to real USDC at the recipient address.
            The amount is visible at this boundary, but the recipient is a stealth
            address with no identity link.
          </p>
        </div>
      )}

      {/* Note management */}
      {note && (
        <div className="bg-green-400/5 border border-green-400/20 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-300">
            <Check className="w-3 h-3" /> Note loaded: {note.amountHuman || note.amount} USDC
          </div>
          <button onClick={downloadNote} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            <Download className="w-3 h-3" /> Download note
          </button>
        </div>
      )}

      {/* TX result */}
      {txHash && (
        <a
          href={`https://basescan.org/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-xs text-white/50 hover:text-white border border-white/10 py-2"
        >
          View on BaseScan
        </a>
      )}
    </div>
  );
}
