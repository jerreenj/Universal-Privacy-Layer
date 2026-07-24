import { useState, useEffect } from "react";
import axios from "axios";
import * as ethersUtils from "@/lib/ethers-lazy";
import { Lock, PenLine, Loader2, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";

export function OnChainRelayer() {
  const { address, chain, signer, fetchBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState(null);       // EIP-712 payload + quote from /relayer/prepare-tx
  const [signature, setSignature] = useState(null);  // user's off-chain signature over the intent
  const [relayerStats, setRelayerStats] = useState(null);
  const [relayResult, setRelayResult] = useState(null);  // tx hashes from /relayer/submit (P1.12)

  useEffect(() => {
    axios.get(`${API}/relayer/stats/${chain}`).then(r => setRelayerStats(r.data)).catch(() => {});
  }, [chain]);

  const prepareRelayIntent = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount) return toast.error("Enter recipient and amount");
    setLoading(true);
    try {
      // Ephemeral key + view tag are generated client-side; only the ephemeral
      // *public* commitment and the 1-byte tag ever leave the browser. The
      // recipient derives the stealth private key client-side from these + its
      // own view key (EIP-5564) — the server never holds a stealth private key.
      const ephemeralKey = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      const viewTag = Math.floor(Math.random() * 256);
      const res = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address, stealth_address: to, amount_wei: ethersUtils.parseEther(amount).toString(),
        ephemeral_key: ephemeralKey, view_tag: viewTag, chain
      });
      setIntent(res.data);
      setSignature(null);
      setRelayResult(null);
      toast.success("Relay intent prepared — sign next");
    } catch { toast.error("Failed to prepare relay intent"); }
    setLoading(false);
  };

  const signRelayIntent = async () => {
    if (!intent || !signer) return;
    setLoading(true);
    try {
      // The user SIGNS the EIP-712 intent off-chain. They do NOT send a tx.
      // PrivacyRelayer.sol's `relay()` is `onlyRelayer`, so the user calling it
      // directly would revert AND leak the user's wallet as the on-chain sender.
      // Instead the relayer service (P1.10) verifies this signature and submits
      // `relay()` on the user's behalf — the user's wallet never appears as
      // msg.sender. ethers v6 `signTypedData` expects `types` WITHOUT the
      // `EIP712Domain` entry (it injects it), which is how the backend sends it.
      const { domain, types, message } = intent.intent;
      const sig = await signer.signTypedData(domain, types, message);
      setSignature(sig);
      toast.success("Intent signed — submit to relayer next");
      // Balance only changes once the relayer actually settles the tx (P1.10),
      // but refresh so the UI reflects any pending state.
      fetchBalance();
    } catch (e) { toast.error(e.message?.slice(0, 80) || "Signing failed"); }
    setLoading(false);
  };

  // P1.12: Submit the signed intent to the backend relayer, which calls relay()
  // + announce() on-chain. The user's wallet never appears as msg.sender.
  const submitToRelayer = async () => {
    if (!intent || !signature || !address) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/relayer/submit`, {
        intent: intent.intent,
        signature,
        from_address: address,
        chain,
      });
      setRelayResult(res.data);
      toast.success("Relayed on-chain! TX confirmed.");
      fetchBalance();
      // Refresh stats so the total relayed counter updates.
      axios.get(`${API}/relayer/stats/${chain}`).then(r => setRelayerStats(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail?.slice(0, 80) || "Relayer submit failed");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/50">Route transactions through the on-chain PrivacyRelayer contract for enhanced privacy with 0.05% fee.</p>
      {relayerStats && (
        <div className="bg-white/5 border border-white/10 p-3 flex items-center justify-between">
          <span className="text-xs text-white/50">Total Relayed on {CHAINS[chain]?.name}</span>
          <span className="font-mono text-sm">{parseFloat(relayerStats.total_relayed || 0).toFixed(4)} {CHAINS[chain]?.symbol}</span>
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Recipient Stealth Address</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">Amount ({CHAINS[chain]?.symbol})</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      {!intent ? (
        <button onClick={prepareRelayIntent} disabled={loading}
          className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
          Prepare Relayer Intent
        </button>
      ) : (
        <div className="space-y-3">
          <div className="bg-white/5 border border-white/10 p-3 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-white/50">Relayer:</span><span className="font-mono">{intent.relayer_contract?.slice(0, 12)}...</span></div>
            <div className="flex justify-between"><span className="text-white/50">Fee:</span><span className="text-yellow-400">{intent.fee_bps / 100}% ({ethers.formatEther(intent.fee_amount || '0').slice(0, 8)})</span></div>
            <div className="flex justify-between"><span className="text-white/50">Net Amount:</span><span className="text-green-400">{ethers.formatEther(intent.net_amount || '0').slice(0, 10)}</span></div>
            <div className="flex justify-between"><span className="text-white/50">Intent expires:</span><span className="font-mono text-white/70">{new Date((intent.submission?.expires_at || 0) * 1000).toLocaleTimeString()}</span></div>
          </div>
          {!signature ? (
            <button onClick={signRelayIntent} disabled={loading}
              className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />}
              Sign Intent (off-chain)
            </button>
          ) : !relayResult ? (
            <div className="space-y-3">
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-300 space-y-1">
                <div className="font-semibold">Intent signed — submit to relayer.</div>
                <div className="mt-1 font-mono break-all text-white/60">sig: {signature.slice(0, 18)}…{signature.slice(-8)}</div>
              </div>
              <button onClick={submitToRelayer} disabled={loading}
                className="w-full py-3 bg-green-500 text-black font-bold uppercase tracking-wider hover:bg-green-400 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Submit to Relayer (on-chain)
              </button>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-300 space-y-2">
              <div className="font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Relayed on-chain (atomic)!</div>
              <div className="flex justify-between"><span className="text-white/50">Transaction:</span>
                <a href={relayResult.explorer} target="_blank" rel="noreferrer" className="font-mono text-emerald-300 hover:underline">{relayResult.relay_tx_hash?.slice(0, 18)}…</a>
              </div>
              <div className="flex justify-between"><span className="text-white/50">Announcement:</span><span className="font-mono">{relayResult.announcement_count}</span></div>
              <div className="flex justify-between"><span className="text-white/50">Recipient:</span><span className="font-mono">{relayResult.recipient?.slice(0, 10)}…{relayResult.recipient?.slice(-6)}</span></div>
              <div className="text-white/40 italic">Single atomic tx: relay + announce succeed or revert together (P2.9.7).</div>
            </div>
          )}
          <button onClick={() => { setIntent(null); setSignature(null); }}
            className="w-full text-xs text-white/40 hover:text-white/70 underline">
            Discard and start over
          </button>
        </div>
      )}
      {!signature && (
        <p className="text-[11px] text-white/40 leading-relaxed">
          You sign an EIP-712 intent — you never broadcast a transaction. The relayer verifies your
          signature and submits <code className="text-white/60">relay()</code> on-chain, so your wallet
          never appears as the sender.
        </p>
      )}
    </div>
  );
}
