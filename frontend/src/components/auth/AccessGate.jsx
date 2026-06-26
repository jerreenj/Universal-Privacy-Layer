import { useState } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { setSessionToken } from "@/lib/session";

export function AccessGate({ onGranted }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);

  const attempt = async () => {
    if (!code) return;
    setLoading(true);
    try {
      const res = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/auth/verify-access`, { code });
      setSessionToken(res.data.token);
      onGranted();
    } catch {
      setError(true);
      setShake(true);
      setCode("");
      setTimeout(() => setShake(false), 600);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-full max-w-xs px-8 py-10 border border-white/10 bg-white/[0.02] text-center"
        style={{ animation: shake ? "shake 0.5s" : "none" }}>
        <div className="w-2 h-2 rounded-full bg-green-400 mx-auto mb-6 animate-pulse" />
        <h2 className="text-sm font-semibold tracking-[0.2em] uppercase text-white/60 mb-1">Privacy Cloak</h2>
        <p className="text-xs text-white/20 mb-8">Restricted Access</p>
        <input
          data-testid="access-code-input"
          type="password"
          value={code}
          onChange={e => { setCode(e.target.value); setError(false); }}
          onKeyDown={e => e.key === "Enter" && attempt()}
          placeholder="Enter access code"
          autoFocus
          className={`w-full bg-transparent border ${error ? "border-red-500/60 text-red-400" : "border-white/20 text-white"} p-3 text-center font-mono text-sm outline-none focus:border-white/50 tracking-widest`}
        />
        {error && <p className="text-red-400 text-xs mt-2">Invalid access code</p>}
        <button
          data-testid="access-code-submit"
          onClick={attempt}
          disabled={loading || !code}
          className="w-full mt-4 py-3 bg-white text-black font-semibold text-sm uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Enter
        </button>
      </div>
    </div>
  );
}
