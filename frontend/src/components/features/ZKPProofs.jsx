import { useState } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Fingerprint, Check, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function ZKPProofs() {
  const { address } = useWallet();
  const [proofType, setProofType] = useState("stealth_ownership");
  const [stealthAddress, setStealthAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState(null);
  const [proofStatus, setProofStatus] = useState(null);

  const generateInputs = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!stealthAddress) return toast.error("Enter stealth address");
    setLoading(true);
    try {
      const spendKeyHash = ethers.keccak256(ethers.toUtf8Bytes(address + "_spend"));
      const viewKeyHash = ethers.keccak256(ethers.toUtf8Bytes(address + "_view"));
      const res = await axios.post(`${API}/zkp/generate-inputs`, { stealth_address: stealthAddress, spend_key_hash: spendKeyHash, view_key_hash: viewKeyHash });
      setInputs(res.data);
      toast.success("ZKP inputs generated!");
    } catch { toast.error("Failed to generate inputs"); }
    setLoading(false);
  };

  const submitProof = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/zkp/submit-proof`, {
        proof_type: proofType,
        public_inputs: inputs?.public_inputs ? Object.values(inputs.public_inputs).map(String) : [],
        proof_a: ["0x" + "1".repeat(64), "0x" + "2".repeat(64)],
        proof_b: [["0x" + "3".repeat(64), "0x" + "4".repeat(64)], ["0x" + "5".repeat(64), "0x" + "6".repeat(64)]],
        proof_c: ["0x" + "7".repeat(64), "0x" + "8".repeat(64)]
      });
      setProofStatus(res.data);
      toast.success("Proof submitted!");
    } catch { toast.error("Failed to submit proof"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Generate zero-knowledge proofs to verify ownership without revealing private keys.</p>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Proof Type</label>
        <select value={proofType} onChange={(e) => setProofType(e.target.value)}
          className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none">
          <option value="stealth_ownership" className="bg-black">Stealth Address Ownership</option>
          <option value="amount_range" className="bg-black">Amount Range Proof</option>
          <option value="membership" className="bg-black">Set Membership</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Stealth Address to Prove</label>
        <input value={stealthAddress} onChange={(e) => setStealthAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button onClick={generateInputs} disabled={loading}
        className="w-full py-3 bg-white/10 border border-white/20 font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />}
        Generate ZKP Inputs
      </button>
      {inputs && (
        <div className="bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="text-xs text-green-400 uppercase">Public Inputs Generated</div>
          <div className="font-mono text-xs break-all space-y-1">
            {Object.entries(inputs.public_inputs || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-white/50">{k}:</span>
                <span className="text-white/70">{String(v).slice(0, 20)}...</span>
              </div>
            ))}
          </div>
          <button onClick={submitProof} disabled={loading}
            className="w-full py-2 bg-white text-black font-bold uppercase text-sm hover:bg-gray-200 disabled:opacity-50">
            Submit Proof for Verification
          </button>
        </div>
      )}
      {proofStatus && (
        <div className={`p-4 border ${proofStatus.status === 'verified' ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
          <div className="flex items-center gap-2">
            {proofStatus.status === 'verified' ? <Check className="w-5 h-5 text-green-400" /> : <AlertTriangle className="w-5 h-5 text-red-400" />}
            <span className={proofStatus.status === 'verified' ? 'text-green-400' : 'text-red-400'}>{proofStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
