import { useState } from "react";
import axios from "axios";
import { FileCode, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { CopyButton } from "@/components/common/CopyButton";

export function ContractPrivacy() {
  const { address, chain } = useWallet();
  const [contractAddress, setContractAddress] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [proxy, setProxy] = useState(null);

  const createProxy = async () => {
    if (!address) return toast.error("Connect wallet first");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/contract/proxy`, {
        user_address: address, contract_address: contractAddress,
        function_name: functionName, function_args: [], chain
      });
      setProxy(res.data);
      toast.success("Contract proxy created!");
    } catch { toast.error("Failed to create"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Execute smart contract calls through an anonymous proxy. Your wallet won't be linked to the interaction.</p>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Contract Address</label>
        <input value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Function Name</label>
        <input value={functionName} onChange={(e) => setFunctionName(e.target.value)} placeholder="stake, swap, mint..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button onClick={createProxy} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCode className="w-5 h-5" />}
        Create Anonymous Proxy
      </button>
      {proxy && (
        <div className="bg-white/5 border border-green-500/30 p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 uppercase">Proxy Address</span>
            <CopyButton text={proxy.proxy_address} />
          </div>
          <p className="font-mono text-sm break-all">{proxy.proxy_address}</p>
          <p className="text-xs text-white/50">{proxy.instructions}</p>
        </div>
      )}
    </div>
  );
}
