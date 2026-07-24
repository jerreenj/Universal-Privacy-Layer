import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import * as ethersUtils from "@/lib/ethers-lazy";
import { ArrowUpRight, ArrowDownLeft, History, Loader2 } from "lucide-react";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { unsealMany } from "@/lib/crypto-seal";

export function TransactionHistory() {
  const { address, signer } = useWallet();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address || !signer) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await axios.get(`${API}/transactions/history/${address}`);
      const raw = res.data.transactions || [];

      // Each row may be a legacy plaintext record (pre-K2) or a
      // sealed envelope (K2+). Plaintext rows are used as-is;
      // envelopes are unsealed locally with the wallet-derived seal
      // key so the server never had to read the row contents.
      const sealed = raw.filter((r) => r && r.encrypted === true);
      const plaintext = raw.filter((r) => r && r.encrypted !== true);
      const unsealed = await unsealMany(sealed, signer);

      // Re-merge and sort by created_at desc. Direction inference
      // happens here for sealed rows (server can't see contents); for
      // plaintext rows the backend already set tx.direction.
      const myAddr = (address || "").toLowerCase();
      const merged = [...plaintext, ...unsealed]
        .filter((r) => r && !r.__sealFailed)
        .map((r) => {
          if (r.direction) return r;
          // First-time inference for unsealed rows: out if user paid, in if user received.
          if (!r.from_address) return r;
          r.direction = String(r.from_address).toLowerCase() === myAddr ? "out" : "in";
          return r;
        })
        .sort((a, b) => (b?.created_at || "").localeCompare(a?.created_at || ""));
      setTransactions(merged);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [address, signer]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return (
    <div className="text-center py-8">
      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-white/50" />
      <p className="text-white/50">Loading transactions...</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Transaction History</h2>
      {transactions.length === 0 ? (
        <div className="text-center py-12 bg-white/5 border border-white/10">
          <History className="w-12 h-12 mx-auto mb-4 text-white/20" />
          <p className="text-white/50">No transactions yet</p>
          <p className="text-sm text-white/30">Your private transactions will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.direction === 'out' ? 'bg-red-500/20' : 'bg-green-500/20'}`}>
                  {tx.direction === 'out' ? <ArrowUpRight className="w-4 h-4 text-red-400" /> : <ArrowDownLeft className="w-4 h-4 text-green-400" />}
                </div>
                <div>
                  <div className="font-medium text-sm">{tx.tx_type?.replace('_', ' ').toUpperCase() || 'Transfer'}</div>
                  <div className="text-xs text-white/50">{new Date(tx.created_at).toLocaleDateString()}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm">
                  {tx.direction === 'out' ? '-' : '+'}{ethers.formatEther(tx.amount_wei || '0').slice(0, 8)}
                </div>
                <div className="text-xs text-white/30">{tx.chain}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
