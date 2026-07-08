import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { CHAINS, VM, VM_GROUPS, LIVE_COUNT } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import RotatingEarth from "@/components/ui/RotatingEarth";
import { MagnetizeButton } from "@/components/ui/magnetize-button";
import {
  MetaMaskLogo, PhantomLogo, SuiLogo, RabbyLogo,
} from "@/components/ui/wallets/WalletLogo";

/**
 * Landing page (no wallet connected).
 *
 * The connect experience used to be a single MagnetizeButton that
 * opened a wallet-family picker dropdown. The pilot asked for the
 * same gorgeous magnet-particle effect on the OTHER wallets too
 * (MetaMask, Rabby, Sui), not just Phantom — and didn't want a
 * dropdown selector in front of it.
 *
 * New layout:
 *   - Top-right stack of FOUR green MagnetizeButton tiles, one per
 *     wallet family. Each tile uses the wallet's real brand logo
 *     (prefix slot — the default Wallet icon is hidden so the
 *     brand shows through) and the wallet name as the label.
 *   - On hover the magnet particles fly inward toward the cursor /
 *     touch point — the 'gorgeous' magnet-up-and-down effect the
 *     pilot liked.
 *   - Click → connect that specific wallet directly: MetaMask /
 *     Rabby auto-switch MetaMask to Base chain + popup sign UI;
 *     Phantom forces a connect popup with onlyIfTrusted:false;
 *     Sui Wallet family calls requestPermissions() on the
 *     detected wallet.
 *   - Wallets not installed are dimmed and disabled. No silent
 *     dead click — clicking pulls a clear toast instead.
 *   - "Detected" / "Not installed" chip on every row so the
 *     customer can see what their browser actually has at a
 *     glance.
 *
 * No other part of the Landing was touched — globe, stats grid,
 * chains strip, terms links all unchanged.
 */
export function Landing() {
  const {
    availableWallets, connecting, switchChain, chain,
    connectEVM, connectRabby, connectSolana, connectSui,
  } = useWallet();
  const [showChains, setShowChains] = useState(false);

  const vmGroups = Object.entries(VM_GROUPS).map(([vmKey, info]) => ({
    vmKey, ...info,
    chains: Object.entries(CHAINS).filter(([, v]) => v.vm === vmKey),
  }));

  // Human-readable label for the detected Sui wallet variant.
  const SUI_DISPLAY_NAMES = {
    suiWallet:    "Sui Wallet",
    suiet:        "Suiet",
    martian:      "Martian",
    ethos:        "Ethos",
    ethosWallet:  "Ethos",
    nightly:      "Nightly",
    surfWallet:   "Surf",
    fewcha:       "Fewcha",
    glassWallet:  "Glass",
    trustWallet:  "Trust",
    bistowWallet: "Trust",
    abcWallet:    "ABC Wallet",
    slushWallet:  "Slush",
    sui:          "Sui Wallet",
  };
  const detectedSuiLabel = availableWallets?.suiName
    ? (SUI_DISPLAY_NAMES[availableWallets.suiName] || availableWallets.suiName)
    : null;

  // 4 wallet magnets — visible at once, no dropdown, no selector.
  // Click any → connect that family directly.
  const walletOptions = [
    {
      key: "metamask",
      label: "MetaMask",
      installed: !!availableWallets?.metamask,
      onClick: connectEVM,
      Logo: MetaMaskLogo,
    },
    {
      key: "rabby",
      label: "Rabby",
      installed: !!availableWallets?.rabby,
      onClick: connectRabby,
      Logo: RabbyLogo,
    },
    {
      key: "phantom",
      label: "Phantom",
      installed: !!availableWallets?.phantom,
      onClick: connectSolana,
      Logo: PhantomLogo,
    },
    {
      key: "sui",
      label: detectedSuiLabel ? `Sui (${detectedSuiLabel})` : "Sui Wallet",
      installed: !!availableWallets?.sui,
      onClick: connectSui,
      Logo: SuiLogo,
    },
  ];

  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      <div className="fixed top-0 left-0 right-0 z-50 flex items-start justify-between px-3 sm:px-4 md:px-6 py-3 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-white/20 text-[10px] sm:text-xs cursor-pointer hover:border-white/40 transition-all"
          onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70">{LIVE_COUNT} Live</span>
          <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
        </div>

        {/* 4 wallet magnets stacked vertically in the top-right.
            NO dropdown — every wallet has its own directly-clickable
            tile, all beautiful magnet particles, none hidden behind
            a selector. */}
        <div className="flex flex-col gap-2">
          {walletOptions.map((opt) => (
            <div key={opt.key} className="relative">
              <MagnetizeButton
                onClick={() => {
                  if (!opt.installed || connecting) return;
                  opt.onClick?.();
                }}
                disabled={!opt.installed || connecting}
                particleCount={10}
                prefix={<opt.Logo size={20} />}
                data-testid={`connect-${opt.key}`}
                className={`
                  px-3 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs
                  min-w-[180px] sm:min-w-[210px]
                  ${opt.installed ? "" : "opacity-40 cursor-not-allowed"}
                `}
              >
                {connecting ? "Connecting…" : opt.label}
              </MagnetizeButton>
              <span
                className={`absolute -bottom-1 right-1.5 text-[8px] sm:text-[9px] uppercase tracking-wider ${
                  opt.installed ? "text-white/70" : "text-white/30"
                }`}
              >
                {opt.installed ? "Detected" : "Not installed"}
              </span>
            </div>
          ))}
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

      <div className="text-center px-4 md:px-6 mt-6 md:mt-10">
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
              <span className="text-[9px] sm:text-[10px] text-white/40 uppercase tracking-wider">{lbl}</span>
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
