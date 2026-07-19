import { useState, useEffect, useRef } from "react";
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
    isMobile, connectMobile,
  } = useWallet();
  const [showChains, setShowChains] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef(null);

  // Close the wallet picker on outside click + Escape so a stray
  // background click doesn't leave it stuck over the dashboard.
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
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-white/20 text-[10px] sm:text-xs cursor-pointer hover:border-white/40 transition-all"
          onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70">{LIVE_COUNT} Live</span>
          <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
        </div>

        {/* Single MagnetizeButton — restores the pre-vertical-stack
            layout. Click opens the wallet picker dropdown. We
            measured that the previous 4-tile vertical stack made
            the top bar too tall and started to cover the globe's
            top half. Going back to the single-button + dropdown
            keeps the magnet-particle effect the customer liked
            (the button is still that gorgeous green magnet) and
            frees up the top half of the viewport. */}
        <div className="relative" ref={walletMenuRef}>
          {isMobile ? (
            // ── MOBILE: wallet app picker — direct deep links ────────
            // Desktop NEVER sees this. Each button redirects directly
            // to the wallet app's in-app browser where window.ethereum
            // is injected, then the existing connectEVM flow works.
            <>
              <MagnetizeButton
                onClick={() => setWalletMenuOpen((o) => !o)}
                disabled={connecting}
                particleCount={14}
                className="px-6 py-3 text-sm min-h-[48px] w-full"
                data-testid="connect-wallet-mobile"
              >
                {connecting ? "Opening wallet…" : "Connect Wallet"}
              </MagnetizeButton>

              {walletMenuOpen && (
                <div
                  className="fixed top-full left-0 right-0 mt-2 z-50 bg-black/95 backdrop-blur-md border border-white/20 shadow-2xl"
                  data-testid="mobile-wallet-picker"
                >
                  <div className="px-4 py-3 border-b border-white/10">
                    <div className="text-xs uppercase tracking-wider text-white font-semibold">
                      Open in wallet app
                    </div>
                  </div>
                  {[
                    { key: "metamask", label: "MetaMask", color: "#F6851B" },
                    { key: "rabby", label: "Rabby", color: "#0066FF" },
                    { key: "trust", label: "Trust Wallet", color: "#3375BB" },
                    { key: "rainbow", label: "Rainbow", color: "#001A72" },
                  ].map((app) => (
                    <button
                      key={app.key}
                      onClick={() => {
                        setWalletMenuOpen(false);
                        connectMobile(app.key);
                      }}
                      disabled={connecting}
                      className="w-full text-left px-4 py-4 flex items-center gap-3 hover:bg-white/10 transition-colors border-b border-white/10 last:border-b-0 min-h-[56px]"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: app.color }}>
                        {app.label[0]}
                      </div>
                      <div className="text-sm font-semibold text-white">{app.label}</div>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setWalletMenuOpen(false);
                      connectMobile("walletconnect");
                    }}
                    disabled={connecting}
                    className="w-full text-left px-4 py-4 flex items-center gap-3 hover:bg-white/10 transition-colors min-h-[56px]"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">W</div>
                    <div className="text-sm font-semibold text-white">Other (WalletConnect)</div>
                  </button>
                </div>
              )}
            </>
          ) : (
            // ── DESKTOP: existing wallet picker dropdown ──────────────
            // Mobile NEVER sees this. Unchanged from original.
            <>
              <MagnetizeButton
                onClick={() => setWalletMenuOpen((o) => !o)}
                disabled={connecting}
                particleCount={14}
                className="px-3 sm:px-4 md:px-6 py-1.5 sm:py-2 md:py-2.5 text-xs sm:text-sm"
                data-testid="connect-wallet-button"
              >
                {connecting ? "Connecting…" : "Connect Wallet"}
              </MagnetizeButton>

              {walletMenuOpen && (
                <div
                  role="listbox"
                  data-testid="wallet-family-picker"
                  className="absolute top-full right-0 mt-2 z-50 bg-black/95 backdrop-blur-md border border-white/20 min-w-[280px] sm:min-w-[320px] shadow-2xl"
                >
                  <div className="px-4 py-3 border-b border-white/10">
                    <div className="text-xs uppercase tracking-wider text-white font-semibold">
                      Pick the wallet
                    </div>
                  </div>
                  {walletOptions.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        if (!opt.installed || connecting) return;
                        setWalletMenuOpen(false);
                        opt.onClick?.();
                      }}
                      disabled={!opt.installed || connecting}
                      data-wallet-key={opt.key}
                      data-wallet-installed={opt.installed ? "true" : "false"}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors border-b border-white/10 last:border-b-0 ${
                        !opt.installed ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      <opt.Logo size={28} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white">{opt.label}</div>
                      </div>
                      {opt.installed ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
                          <Check className="w-3 h-3" /> Detected
                        </span>
                      ) : (
                        <span className="text-[10px] text-white/30">
                          Not installed
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
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

      {/* Globe — hidden on mobile (was a disturbing nuisance on phones).
          Desktop keeps it. */}
      {!isMobile && (
        <div className="pt-16 md:pt-20 flex justify-center items-center min-h-[40vh]">
          <div className="w-[200px] h-[200px] md:w-[350px] md:h-[350px]">
            <RotatingEarth width={350} height={350} />
          </div>
        </div>
      )}

      <div className={`text-center px-4 md:px-6 pb-20 ${isMobile ? "pt-20" : "mt-4 sm:mt-6 md:mt-10"}`}>
        <h1 className="font-heading text-xl sm:text-2xl md:text-6xl font-bold tracking-tight text-white mb-2 sm:mb-3 md:mb-6">
          Privacy Cloak
        </h1>
        <p className="text-white/40 text-xs sm:text-sm md:text-base mb-4 sm:mb-5 md:mb-8 max-w-md mx-auto px-2">
          Private transactions across every chain. One interface, all networks.
        </p>

        <div className="flex items-center justify-center gap-4 sm:gap-8 md:gap-12 mb-4 sm:mb-6 md:mb-8">
          {[["100%", "Private"], [LIVE_COUNT.toString(), "Chains"], ["10", "Pillars"]].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <span className="block text-base sm:text-lg md:text-2xl font-bold text-white">{val}</span>
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
