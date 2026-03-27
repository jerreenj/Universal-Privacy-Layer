import { useState, useEffect } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function MultisigPrivacy() {
  const { address, chain } = useWallet();
  const [tab, setTab] = useState("create");
  const [name, setName] = useState("");
  const [owners, setOwners] = useState(["", ""]);
  const [threshold, setThreshold] = useState(2);
  const [loading, setLoading] = useState(false);
  const [multisigs, setMultisigs] = useState([]);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (address && tab === "list") {
      axios.get(`${API}/multisig/user/${address}`).then(r => setMultisigs(r.data.multisigs || [])).catch(() => {});
    }
  }, [address, tab]);

  const addOwner = () => setOwners([...owners, ""]);
  const updateOwner = (idx, val) => { const n = [...owners]; n[idx] = val; setOwners(n); };

  const createMultisig = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!name) return toast.error("Enter multisig name");
    const validOwners = owners.filter(o => o.trim());
    if (validOwners.length < 2) return toast.error("Need at least 2 owners");
    if (threshold > validOwners.length) return toast.error("Threshold cannot exceed owners");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/multisig/create`, { name, owners: validOwners, threshold, chain });
      setCreated(res.data);
      toast.success("Multisig created!");
    } catch { toast.error("Failed to create multisig"); }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setTab("create")} className={`flex-1 py-2 text-sm font-medium ${tab === "create" ? "bg-white text-black" : "bg-white/10"}`}>Create</button>
        <button onClick={() => setTab("list")} className={`flex-1 py-2 text-sm font-medium ${tab === "list" ? "bg-white text-black" : "bg-white/10"}`}>My Multisigs</button>
      </div>
      {tab === "create" ? (
        <div className="space-y-3">
          <p className="text-sm text-white/50">Create a privacy-focused multisig wallet with off-chain signature collection.</p>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Multisig Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Treasury, Team Fund..."
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs text-gray-500 uppercase">Owners</label>
              <button onClick={addOwner} className="text-xs text-green-400">+ Add Owner</button>
            </div>
            {owners.map((owner, idx) => (
              <input key={idx} value={owner} onChange={(e) => updateOwner(idx, e.target.value)}
                placeholder={`Owner ${idx + 1} address`}
                className="w-full bg-white/5 border border-white/20 p-2 font-mono text-xs outline-none focus:border-white mb-2" />
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">Threshold (required signatures)</label>
            <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} min={1} max={owners.length}
              className="w-full bg-white/5 border border-white/20 p-3 text-sm outline-none focus:border-white" />
          </div>
          <button onClick={createMultisig} disabled={loading}
            className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50">
            {loading ? "Creating..." : `Create ${threshold} of ${owners.filter(o => o).length} Multisig`}
          </button>
          {created && (
            <div className="bg-green-500/10 border border-green-500/30 p-3 text-sm">
              <div className="text-green-400 font-medium">{created.name}</div>
              <div className="text-xs text-white/50 mt-1">{created.message}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {multisigs.length === 0 ? (
            <div className="text-center py-8 text-white/50">No multisigs found</div>
          ) : (
            multisigs.map((ms, i) => (
              <div key={i} className="bg-white/5 border border-white/10 p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">{ms.name}</span>
                  <span className="text-xs text-white/50">{ms.threshold} of {ms.owners?.length}</span>
                </div>
                <div className="text-xs text-white/30">{ms.proposals?.filter(p => p.status === 'pending').length || 0} pending proposals</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
