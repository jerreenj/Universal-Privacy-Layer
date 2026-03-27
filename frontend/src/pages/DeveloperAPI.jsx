import { useState, useEffect } from "react";
import axios from "axios";
import { FileCode, Key, TrendingUp, Copy, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BACKEND_URL, API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { copyToClip } from "@/components/common/CopyButton";

export function DeveloperAPI() {
  const { address } = useWallet();
  const [tab, setTab] = useState("docs");
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyLimit, setNewKeyLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState(null);
  const [usage, setUsage] = useState(null);
  const [docs, setDocs] = useState(null);

  useEffect(() => { axios.get(`${API}/v1/docs`).then(r => setDocs(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    if (address && tab === "keys") axios.get(`${API}/developer/keys/${address}`).then(r => setApiKeys(r.data.keys || [])).catch(() => {});
    if (address && tab === "usage") axios.get(`${API}/developer/usage/${address}`).then(r => setUsage(r.data)).catch(() => {});
  }, [address, tab]);

  const createKey = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!newKeyName) return toast.error("Enter a key name");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/developer/keys/create`, { owner_address: address, name: newKeyName, rate_limit: newKeyLimit });
      setCreatedKey(res.data);
      setApiKeys([...apiKeys, { name: newKeyName, rate_limit: newKeyLimit, active: true }]);
      setNewKeyName("");
      toast.success("API key created!");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create key"); }
    setLoading(false);
  };

  const revokeKey = async (keyName) => {
    if (!address) return;
    try {
      await axios.delete(`${API}/developer/keys/${keyName}`, { data: { owner_address: address } });
      setApiKeys(apiKeys.filter(k => k.name !== keyName));
      toast.success("API key revoked");
    } catch { toast.error("Failed to revoke key"); }
  };

  const copyToClipboard = (text) => { copyToClip(text); toast.success("Copied to clipboard!"); };

  return (
    <div className="space-y-6" data-testid="developer-api">
      <div className="border-b border-white/10 pb-4">
        <h2 className="text-xl font-bold flex items-center gap-2"><FileCode className="w-6 h-6" /> Developer API</h2>
        <p className="text-sm text-white/50 mt-1">Integrate UPL privacy features into your applications</p>
      </div>
      <div className="flex gap-4 border-b border-white/10">
        {[
          { key: "docs", label: "Documentation", icon: <FileCode className="w-4 h-4" /> },
          { key: "keys", label: "API Keys", icon: <Key className="w-4 h-4" /> },
          { key: "usage", label: "Usage Stats", icon: <TrendingUp className="w-4 h-4" /> }
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${tab === t.key ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white/70'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "docs" && docs && (
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-green-400 mb-3">Quick Start</h3>
            <div className="bg-black/50 p-4 font-mono text-xs overflow-x-auto">
              <div className="text-white/50"># Generate a stealth address</div>
              <div className="text-green-400">curl -X POST {BACKEND_URL}/api/v1/stealth/generate \</div>
              <div className="text-white/70 pl-4">-H "Content-Type: application/json" \</div>
              <div className="text-white/70 pl-4">-d '{`{"spending_key": "0x...", "viewing_key": "0x..."}`}'</div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-blue-400 mb-3">Authentication</h3>
            <p className="text-sm text-white/70 mb-2">{docs.authentication?.type}: Include your key in requests</p>
            <div className="bg-black/50 p-3 font-mono text-xs">
              <span className="text-white/50">Header:</span> <span className="text-yellow-400">X-API-Key: upl_your_key_here</span>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-purple-400 mb-3">Endpoints</h3>
            <div className="space-y-3">
              {docs.endpoints?.map((ep, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white/5 hover:bg-white/10 transition-colors">
                  <span className={`px-2 py-1 text-xs font-bold ${ep.method === 'GET' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>{ep.method}</span>
                  <div className="flex-1">
                    <div className="font-mono text-sm">{ep.path}</div>
                    <div className="text-xs text-white/50 mt-1">{ep.description}</div>
                    {ep.body && <div className="mt-2 text-xs"><span className="text-white/30">Body: </span><code className="text-white/50">{JSON.stringify(ep.body)}</code></div>}
                  </div>
                  <div className={`text-xs ${ep.auth_required ? 'text-yellow-400' : 'text-green-400'}`}>{ep.auth_required ? 'Auth' : 'Public'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 p-4">
            <h3 className="text-sm font-bold uppercase text-orange-400 mb-3">Rate Limits</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-white/50">Default</div><div className="font-mono">{docs.rate_limits?.default}</div></div>
              <div><div className="text-white/50">Custom</div><div className="font-mono">{docs.rate_limits?.custom}</div></div>
            </div>
          </div>
        </div>
      )}

      {tab === "keys" && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 p-4 space-y-3">
            <h3 className="text-sm font-bold uppercase text-green-400">Create New API Key</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Key Name</label>
                <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="my-app-key"
                  className="w-full bg-white/5 border border-white/20 p-2 text-sm outline-none focus:border-white" />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Rate Limit (req/min)</label>
                <input type="number" value={newKeyLimit} onChange={(e) => setNewKeyLimit(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/20 p-2 text-sm outline-none focus:border-white" />
              </div>
            </div>
            <button onClick={createKey} disabled={loading || !address}
              className="w-full py-2 bg-white text-black font-bold uppercase text-sm hover:bg-gray-200 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Create API Key"}
            </button>
          </div>
          {createdKey && (
            <div className="bg-yellow-500/20 border border-yellow-500 p-4 space-y-2">
              <div className="flex items-center gap-2 text-yellow-400"><AlertTriangle className="w-5 h-5" /><span className="font-bold">Save Your API Key Now!</span></div>
              <p className="text-xs text-white/70">This key will only be shown once. Save it securely.</p>
              <div className="flex items-center gap-2 bg-black/50 p-3 font-mono text-sm">
                <span className="flex-1 break-all">{createdKey.api_key}</span>
                <button onClick={() => copyToClipboard(createdKey.api_key)} className="text-white/50 hover:text-white"><Copy className="w-4 h-4" /></button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-bold uppercase text-white/50">Your API Keys</h3>
            {apiKeys.length === 0 ? (
              <div className="text-center py-8 text-white/30">No API keys yet</div>
            ) : (
              apiKeys.map((k, i) => (
                <div key={i} className={`flex items-center justify-between p-3 bg-white/5 border ${k.active ? 'border-white/10' : 'border-red-500/30'}`}>
                  <div>
                    <div className="font-medium">{k.name}</div>
                    <div className="text-xs text-white/50">{k.rate_limit} req/min • {k.active ? 'Active' : 'Revoked'}</div>
                  </div>
                  {k.active && <button onClick={() => revokeKey(k.name)} className="text-red-400 hover:text-red-300 text-xs">Revoke</button>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "usage" && (
        <div className="space-y-4">
          {usage ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white/5 border border-white/10 p-4 text-center">
                  <div className="text-3xl font-bold">{usage.total_requests}</div>
                  <div className="text-xs text-white/50 uppercase">Total Requests</div>
                </div>
                <div className="bg-white/5 border border-white/10 p-4 text-center">
                  <div className="text-3xl font-bold">{usage.keys?.length || 0}</div>
                  <div className="text-xs text-white/50 uppercase">Active Keys</div>
                </div>
                <div className="bg-white/5 border border-white/10 p-4 text-center">
                  <div className="text-3xl font-bold text-green-400">∞</div>
                  <div className="text-xs text-white/50 uppercase">Free Tier</div>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 p-4">
                <h3 className="text-sm font-bold uppercase text-white/50 mb-3">Usage by Key</h3>
                {usage.keys?.map((k, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${k.active ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span>{k.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-white/50">{k.usage_count} requests</span>
                      {k.last_used && <span className="text-xs text-white/30">Last: {new Date(k.last_used).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              {address ? <Loader2 className="w-8 h-8 animate-spin mx-auto text-white/30" /> : <div className="text-white/30">Connect wallet to view usage</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
