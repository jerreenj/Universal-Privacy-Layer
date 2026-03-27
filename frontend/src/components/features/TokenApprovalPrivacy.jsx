import { useState } from "react";
import axios from "axios";
import { Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { CopyButton } from "@/components/common/CopyButton";

export function TokenApprovalPrivacy() {
  const { address, chain } = useWallet();
  const [tokenAddress, setTokenAddress] = useState("");
  const [spenderAddress, setSpenderAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [disposal, setDisposal] = useState(null);

  const createDisposable = async () => {
    if (!address) return toast.error("Connect wallet first");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/approval/create-disposable`, {
        user_address: address, token_address: tokenAddress, spender_address: spenderAddress,
        amount: amount || "unlimited", chain
      });
      setDisposal(res.data);
      toast.success("Disposable approval address created!");
    } catch { toast.error("Failed to create"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Create a disposable address for token approvals. Prevents wallet-protocol fingerprinting.</p>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Token Contract</label>
        <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Spender (Protocol)</label>
        <input value={spenderAddress} onChange={(e) => setSpenderAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button onClick={createDisposable} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
        Create Disposable Approval
      </button>
      {disposal && (
        <div className="bg-white/5 border border-green-500/30 p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 uppercase">Disposable Address</span>
            <CopyButton text={disposal.disposable_address} />
          </div>
          <p className="font-mono text-sm break-all">{disposal.disposable_address}</p>
          <p className="text-xs text-white/50">{disposal.instructions}</p>
        </div>
      )}
    </div>
  );
}
