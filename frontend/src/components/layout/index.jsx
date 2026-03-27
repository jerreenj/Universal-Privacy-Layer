import { useState } from "react";
import { ArrowLeft, Copy, Check, ChevronDown } from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { CHAINS, VM_GROUPS } from "@/config/chains";

export function BackButton({ onClick }) {
  return (
    <button onClick={onClick} data-testid="back-button"
      className="flex items-center gap-2 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black transition-all duration-200 text-sm font-medium mb-6 group">
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
      Back
    </button>
  );
}

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const el = Object.assign(document.createElement("textarea"), { value: text });
    Object.assign(el.style, { position: "fixed", top: 0, left: 0, opacity: "0" });
    document.body.appendChild(el); el.focus(); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy}>
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-500 hover:text-white" />}
    </button>
  );
}

export function Navbar() {
  const { address, chain, switchChain, disconnect } = useWallet();
  const [showChains, setShowChains] = useState(false);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-white rounded-full flex items-center justify-center">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-black rounded-full" />
          </div>
          <span className="font-heading text-lg md:text-xl font-bold tracking-tight">UPL</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button data-testid="chain-selector" onClick={() => setShowChains(!showChains)}
              className="flex items-center gap-2 px-3 py-2 border border-white/20 hover:border-white/40 transition-all text-sm">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAINS[chain].color }} />
              {CHAINS[chain].name}
              <ChevronDown className={`w-4 h-4 transition-transform ${showChains ? "rotate-180" : ""}`} />
            </button>

            {showChains && (
              <div className="absolute top-full mt-2 right-0 bg-black border border-white/20 min-w-[200px] z-50">
                {vmGroups.map(({ vmKey, label, chains }) => (
                  <div key={vmKey}>
                    <div className="px-3 py-1.5 text-[10px] text-white/30 uppercase tracking-widest border-b border-white/5 bg-white/3">{label}</div>
                    {chains.map(([k, v]) => (
                      <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-sm ${!v.live ? 'opacity-50' : ''}`}
                        disabled={!v.live}>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                        {v.name}
                        {!v.live && <span className="text-[10px] text-yellow-400 ml-auto">Soon</span>}
                        {chain === k && v.live && <div className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {address && (
            <button onClick={disconnect} className="px-3 py-2 border border-white/20 hover:bg-white hover:text-black transition-all text-sm font-mono">
              {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
