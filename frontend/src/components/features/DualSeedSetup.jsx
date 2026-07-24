import { useState, useEffect } from "react";
import axios from "axios";
import * as ethersUtils from "@/lib/ethers-lazy";
import { Check, Key, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { CopyButton } from "@/components/common/CopyButton";

export function DualSeedSetup() {
  const { address, setPrivacyWallet } = useWallet();
  const [step, setStep] = useState(1);
  const [mainSeed, setMainSeed] = useState('');
  const [privacySeed, setPrivacySeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    return () => { setMainSeed(''); setPrivacySeed(''); setCreated(null); };
  }, []);

  const generateWallet = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/wallet/create`, {});
      setCreated(res.data);
      setMainSeed(res.data.main_seed_phrase);
      setPrivacySeed(res.data.privacy_seed_phrase);
      setStep(2);
      toast.success("Dual wallet created — write down your seed phrases NOW!");
    } catch { toast.error("Failed to create wallet"); }
    setLoading(false);
  };

  const registerPrivacyKeys = async () => {
    if (!address) return toast.error("Connect main wallet first");
    setLoading(true);
    try {
      const spendKey = await ethersUtils.keccak256(await ethersUtils.toUtf8Bytes(privacySeed + "_spend"));
      const viewKey = await ethersUtils.keccak256(await ethersUtils.toUtf8Bytes(privacySeed + "_view"));
      await axios.post(`${API}/wallet/register-privacy`, { main_address: address, privacy_spend_key: spendKey, privacy_view_key: viewKey });
      setPrivacyWallet({ spendKey, viewKey, registered: true });
      setMainSeed(''); setPrivacySeed(''); setCreated(null);
      setStep(3);
      toast.success("Privacy keys registered!");
    } catch { toast.error("Failed to register privacy keys"); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex items-center gap-2 ${step >= s ? 'text-white' : 'text-white/30'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= s ? 'bg-white text-black' : 'bg-white/10'}`}>
              {step > s ? <Check className="w-4 h-4" /> : s}
            </div>
            <span className="text-sm hidden md:inline">{s === 1 ? 'Generate' : s === 2 ? 'Backup' : 'Complete'}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-yellow-500/10 border border-yellow-500/30 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-400">Dual Seed Phrase System</p>
                <p className="text-xs text-white/60 mt-1">
                  UPL uses two separate seed phrases: one for your main wallet (funds) and one for your privacy envelope.
                </p>
              </div>
            </div>
          </div>
          <button onClick={generateWallet} disabled={loading}
            className="w-full py-4 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Key className="w-5 h-5" />}
            Generate Dual Wallet
          </button>
        </div>
      )}

      {step === 2 && created && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/10 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-white/50 uppercase tracking-wider">Main Seed Phrase (Funds)</span>
              <CopyButton text={mainSeed} />
            </div>
            <p className="font-mono text-sm bg-black/50 p-3 break-all">{mainSeed}</p>
            <p className="text-xs text-white/30 mt-2">Main Address: {created.main_address}</p>
          </div>
          <div className="bg-white/5 border border-green-500/30 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-green-400 uppercase tracking-wider">Privacy Seed Phrase (Privacy Envelope)</span>
              <CopyButton text={privacySeed} />
            </div>
            <p className="font-mono text-sm bg-black/50 p-3 break-all">{privacySeed}</p>
            <p className="text-xs text-white/30 mt-2">Privacy Address: {created.privacy_address}</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 p-4">
            <p className="text-sm text-red-400">Write down BOTH seed phrases and store them securely. Never share them!</p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="w-4 h-4 accent-white" />
            <span className="text-sm text-white/70">I have written down both seed phrases in a safe place</span>
          </label>
          <button onClick={registerPrivacyKeys} disabled={loading || !address || !confirmed}
            className="w-full py-4 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50">
            {!address ? 'Connect Main Wallet First' : loading ? 'Registering...' : 'Register Privacy Keys'}
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <h3 className="text-xl font-bold mb-2">Dual Wallet Setup Complete!</h3>
          <p className="text-white/50">Your privacy envelope is now active. All transactions will be privacy-wrapped.</p>
        </div>
      )}
    </div>
  );
}
