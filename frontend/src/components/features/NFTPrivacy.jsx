import { useState } from "react";
import axios from "axios";
import { Image, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { CopyButton } from "@/components/common/CopyButton";

export function NFTPrivacy() {
  const { address, chain } = useWallet();
  const [nftContract, setNftContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [action, setAction] = useState("buy");
  const [loading, setLoading] = useState(false);
  const [proxy, setProxy] = useState(null);

  const createProxy = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!nftContract || !tokenId) return toast.error("Enter NFT details");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/nft/proxy`, { user_address: address, nft_contract: nftContract, token_id: tokenId, action, chain });
      setProxy(res.data);
      toast.success("NFT proxy created!");
    } catch { toast.error("Failed to create proxy"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Create a privacy proxy for NFT transactions. Your wallet won't be linked to the NFT purchase.</p>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">NFT Contract Address</label>
        <input value={nftContract} onChange={(e) => setNftContract(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Token ID</label>
        <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="1234"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Action</label>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none">
          <option value="buy" className="bg-black">Buy</option>
          <option value="sell" className="bg-black">Sell</option>
          <option value="transfer" className="bg-black">Transfer</option>
          <option value="bid" className="bg-black">Bid</option>
        </select>
      </div>
      <button onClick={createProxy} disabled={loading}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Image className="w-5 h-5" />}
        Create NFT Proxy
      </button>
      {proxy && (
        <div className="bg-white/5 border border-green-500/30 p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-green-400 uppercase">Proxy Address</span>
            <CopyButton text={proxy.proxy_address} />
          </div>
          <p className="font-mono text-sm break-all">{proxy.proxy_address}</p>
          <p className="text-xs text-white/50">Send funds to this address, then complete your NFT transaction from here.</p>
        </div>
      )}
    </div>
  );
}
