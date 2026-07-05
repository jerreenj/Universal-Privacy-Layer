import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { CHAINS, VM, VM_GROUPS, LIVE_COUNT } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";

export function Landing() {
  const { connectWallet, connecting, switchChain, chain } = useWallet();
  const [showChains, setShowChains] = useState(false);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-white/20 text-[10px] sm:text-xs cursor-pointer hover:border-white/40 transition-all"
          onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70">{LIVE_COUNT} Live</span>
          <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
        </div>

        <MagnetizeButton onClick={connectWallet} disabled={connecting} particleCount={14} className="px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-2.5 text-xs sm:text-sm">
          {connecting ? "..." : `Connect Wallet`}
        </MagnetizeButton>
      </div>

      {showChains && (
        <div className="fixed top-12 sm:top-14 left-3 sm:left-4 md:left-6 z-50 bg-black border border-white/20 min-w-[220px] sm:min-w-[260px] max-h-[70vh] overflow-y-auto">
          {vmGroups.map(({ vmKey, label, chains }) => (
            <div key={vmKey}>
              <div className="px-3 py-2 text-[10px] text-white/40 uppercase tracking-wider border-b border-white/10 bg-white/3 flex items-center gap-2">
                <span>{label}</span>
                <span className="text-white/20">·</span>
                <span className="text-white/20">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
              </div>
              {chains.map(([k, v]) => (
                <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-left text-xs sm:text-sm ${!v.live ? 'opacity-50' : ''}`}
                  disabled={!v.live}>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                  <span>{v.name}</span>
                  <span className="text-white/30 text-xs ml-auto">{v.symbol}</span>
                  {v.deployed && <span className="text-[9px] text-green-400 font-semibold">● Deployed</span>}
                  {!v.live && <span className="text-[10px] text-yellow-400" title="Mainnet deployment pending — currently disabled">Soon</span>}
                  {chain === k && v.live && !v.deployed && <div className="w-2 h-2 rounded-full bg-green-400" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="pt-16 md:pt-20 flex justify-center">
        <div className="w-[200px] h-[200px] md:w-[350px] md:h-[350px]">
          <RotatingEarth width={350} height={350} />
        </div>
      </div>

      <div className="text-center px-4 md:px-6 mt-6 md:mt-10">
        <h1 className="font-heading text-2xl sm:text-4xl md:text-6xl font-bold tracking-tight text-white mb-3 md:mb-6">
          Privacy Cloak
        </h1>
        <p className="text-white/40 text-xs sm:text-sm md:text-base mb-5 md:mb-8 max-w-md mx-auto px-2">
          Private transactions across every chain. One interface, all networks.
        </p>

        <div className="flex items-center justify-center gap-4 sm:gap-8 md:gap-12 mb-6 md:mb-8">
          {[
            ["100%", "Non-Custodial"],
            [LIVE_COUNT.toString(), "Live Chains"],
            [String(Object.keys(VM_GROUPS).length), "VM Families"],
          ].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <span className="block text-lg sm:text-xl md:text-2xl font-bold text-white">{val}</span>
              <span className="text-[9px] sm:text-[10px] md:text-xs text-white/40 uppercase tracking-wider">{lbl}</span>
            </div>
          ))}
        </div>

        <div className="max-w-md mx-auto px-2 mb-6 md:mb-10">
          <p className="text-white/30 text-[11px] sm:text-xs leading-relaxed">
            Send privately, receive at one-time stealth addresses, swap through
            Uniswap, trade perps on Hyperliquid, bet on Polymarket, join
            multisigs, sign EIP-712 messages, generate Groth16 proofs — all
            without doxxing your wallet.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-4 md:mb-6 px-2">
          {Object.entries(VM_GROUPS).map(([vmKey, info]) => (
            <div key={vmKey} className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 border border-white/10 text-[10px] sm:text-xs whitespace-nowrap">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-white/60">{info.label}</span>
              <span className="text-white/20 hidden sm:inline">·</span>
              <span className="text-white/30 hidden sm:inline">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mb-6 md:mb-8 px-2">
          {Object.entries(CHAINS).map(([k, v]) => (
            <div key={k} className={`flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 border border-white/10 text-[10px] sm:text-xs cursor-pointer hover:border-white/30 transition-all ${!v.live ? 'opacity-50' : ''}`}
              onClick={() => { if (v.live) { switchChain(k); } }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
              <span className="text-white/60">{v.name}</span>
              {!v.live && <span className="text-[8px] sm:text-[10px] text-yellow-400 ml-0.5" title="Mainnet deployment pending — currently disabled">Soon</span>}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-4 text-[10px] text-white/30">
          <a href="/terms" className="hover:text-white/50 transition-colors">Terms of Service</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-white/50 transition-colors">Privacy Policy</a>
          <span>·</span>
          <a href="/guide" className="hover:text-white/50 transition-colors">Getting Started</a>
        </div>
      </div>
    </div>
  );
}
