import { useState, useEffect, useRef } from "react";
import { ChevronDown, Wallet, Check, AlertCircle } from "lucide-react";
import { CHAINS, VM, VM_GROUPS, LIVE_COUNT } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";

/**
 * Landing page (no wallet connected).
 *
 * The button on the top-right used to be a single hard-coded
 * "Connect Wallet" that dispatched to whatever the currently-selected
 * chain's wallet was. After a disconnect, that meant:
 *   1. User on Solana clicks Disconnect.
 *   2. Lands here.
 *   3. Clicks "Connect Wallet" — immediately fires Phantom again.
 *      They wanted MetaMask but had no choice.
 *
 * Replaced with a wallet-family picker — MetaMask / Phantom / Sui
 * Wallet — with explicit install-state for each. The customer sees
 * their options, picks one, and that one connects. Phantom's noisy
 * toast (which used to fire even on success) is silenced in
 * `connectSolana`, see WalletContext.
 */
export function Landing() {
  const {
    connectWallet, connectEVM, connectSolana, connectSui,
    availableWallets, connecting, switchChain, chain,
  } = useWallet();
  const [showChains, setShowChains] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef(null);

  // Close the picker on outside click + Escape so a background click
  // doesn't leave it stuck open over the dashboard.
  useEffect(() => {
    if (!walletMenuOpen) return;
    const onDocClick = (e) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target)) {
        setWalletMenuOpen(false);
      }
    };
    const onEsc = (e) => { if (e.key === "Escape") setWalletMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [walletMenuOpen]);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  // Wallet options the customer can pick. Detection state comes from
  // WalletContext's availableWallets (refreshed on mount and on tab
  // visibilitychange so newly-installed extensions show up).
  const walletOptions = [
    {
      key: "evm",
      label: "MetaMask",
      desc: "Browser wallet for EVM chains (Base, Ethereum, Arbitrum, …)",
      installed: availableWallets?.evm,
      onClick: connectEVM,
      accent: "#F6851B", // MetaMask orange
      recommended: true,
    },
    {
      key: "solana",
      label: "Phantom",
      desc: "Solana mainnet / devnet wallet",
      installed: availableWallets?.solana,
      onClick: connectSolana,
      accent: "#AB9FF2", // Phantom purple
      recommended: false,
    },
    {
      key: "sui",
      label: "Sui Wallet",
      desc: "Native Sui / Move wallet",
      installed: availableWallets?.sui,
      onClick: connectSui,
      accent: "#6FBCF0",
      recommended: false,
    },
  ];

  // Helper sub-component: a single wallet row in the picker menu.
  const WalletOption = ({ opt }) => (
    <button
      onClick={() => {
        if (!opt.installed) return; // soft-disable, see below
        setWalletMenuOpen(false);
        opt.onClick?.();
      }}
      disabled={!opt.installed || connecting}
      className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/10 transition-colors border-b border-white/10 last:border-b-0 ${
        !opt.installed ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <div
        className="w-8 h-8 shrink-0 flex items-center justify-center font-bold text-xs"
        style={{ backgroundColor: opt.accent + "22", color: opt.accent }}
      >
        {opt.label[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{opt.label}</span>
          {opt.recommended && (
            <span className="text-[9px] uppercase tracking-wider text-blue-300 border border-blue-400/40 px-1.5 py-0.5">
              Recommended
            </span>
          )}
          {opt.installed ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-green-400">
              <Check className="w-3 h-3" /> Detected
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-white/40">
              <AlertCircle className="w-3 h-3" /> Not installed
            </span>
          )}
        </div>
        <div className="text-[11px] text-white/40 mt-0.5">{opt.desc}</div>
      </div>
    </button>
  );

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-white/20 text-[10px] sm:text-xs cursor-pointer hover:border-white/40 transition-all"
          onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
          <div className="w-1.5 sm:w-2 h-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70">{LIVE_COUNT} Live</span>
          <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
        </div>

        {/* Wallet-family picker — replaces the single
            hard-coded "Connect Wallet" button. Each option routes
            to a specific wallet extension. The MagnetizeButton still
            opens the picker so the visual stays consistent; clicking
            it doesn't auto-connect to anything. */}
        <div className="relative" ref={walletMenuRef}>
          <MagnetizeButton
            onClick={() => setWalletMenuOpen((o) => !o)}
            disabled={connecting}
            particleCount={14}
            className="px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-2.5 text-xs sm:text-sm"
            data-testid="connect-wallet-button"
          >
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              {connecting ? "Connecting…" : "Connect Wallet"}
              <ChevronDown className={`w-3 h-3 transition-transform ${walletMenuOpen ? "rotate-180" : ""}`} />
            </span>
          </MagnetizeButton>

          {walletMenuOpen && (
            <div
              role="listbox"
              data-testid="wallet-family-picker"
              className="absolute top-full right-0 mt-2 z-50 bg-black/95 backdrop-blur-md border border-white/20 min-w-[320px] sm:min-w-[380px] shadow-2xl"
            >
              <div className="px-4 py-3 border-b border-white/10">
                <div className="text-xs uppercase tracking-wider text-white/40">
                  Choose your wallet
                </div>
                <div className="text-[11px] text-white/30 mt-1">
                  Pick the wallet family you want to connect. Each option calls its own extension — no auto-reconnect to the last-used wallet.
                </div>
              </div>
              {walletOptions.map((opt) => (
                <WalletOption key={opt.key} opt={opt} />
              ))}
              <div className="px-4 py-2 border-t border-white/10">
                <button
                  onClick={() => {
                    setWalletMenuOpen(false);
                    connectWallet(); // legacy chain-based connect
                  }}
                  className="text-[11px] text-white/40 hover:text-white/70 transition-colors"
                >
                  Or use the currently-selected chain's wallet →
                </button>
              </div>
            </div>
          )}
        </div>
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

      <div className="text-center px-4 md:px-6 mt-6 md:pt-10">
        <h1 className="font-heading text-2xl sm:text-4xl md:text-6xl font-bold tracking-tight text-white mb-3 md:mb-6">
          Privacy Cloak
        </h1>
        <p className="text-white/40 text-xs sm:text-sm md:text-base mb-5 md:mb-8 max-w-md mx-auto px-2">
          Private transactions across every chain. One interface, all networks.
        </p>

        <div className="flex items-center justify-center gap-4 sm:gap-8 md:gap-12 mb-6 md:mb-8">
          {[["100%", "Private"], [LIVE_COUNT.toString(), "Chains"], ["10", "Pillars"]].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <span className="block text-lg sm:text-xl md:text-2xl font-bold text-white">{val}</span>
              <span className="text-[9px] sm:text-[10px] sm:text-xs text-white/40 uppercase tracking-wider">{lbl}</span>
            </div>
          ))}
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
            <div key={k} className={`flex items-center gap-1 px-2 py-1 sm:py-1.5 border border-white/10 text-[10px] sm:text-xs cursor-pointer hover:border-white/30 transition-all ${!v.live ? 'opacity-50' : ''}`}
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
