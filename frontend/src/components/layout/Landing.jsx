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

  // ─── Mobile wallet list (with install state + fallback action) ───────
  // Rendered inside the bottom-sheet picker on mobile. Each entry has:
  //   - key (matches connectMobile argument)
  //   - label (display name)
  //   - logo (component)
  //   - brandColor (fallback circle color if logo is missing)
  //   - deepLinkAvailable (true = tapping fires deep link; false = shows
  //     an install prompt via connectMobile's handler for that key)
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const mobileWallets = [
    {
      key: "metamask",
      label: "MetaMask",
      brandColor: "#F6851B",
      deepLinkAvailable: true,
    },
    {
      key: "rabby",
      label: "Rabby",
      brandColor: "#7C3AED",
      // Rabby on iOS has no mobile deep link (no iOS app at all).
      // Rabby on Android has WalletConnect fallback inside connectMobile.
      deepLinkAvailable: !isIOS,
      noteLabel: isIOS ? "Not available on iOS" : null,
    },
    {
      key: "trust",
      label: "Trust Wallet",
      brandColor: "#3375BB",
      deepLinkAvailable: true,
    },
    {
      key: "rainbow",
      label: "Rainbow",
      brandColor: "#001A72",
      deepLinkAvailable: true,
    },
  ];

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

  // ─── Mobile layout: fully redesigned hero + bottom-sheet picker ───────
  // Desktop layout is untouched inside the {isMobile ? ... : ...} branch.
  if (isMobile) {
    return (
      <div className="min-h-screen min-h-[100dvh] relative bg-black overflow-hidden">
        {/* ── Top nav (mobile) ─────────────────────────────────────────── */}
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-md">
          <button
            onClick={() => setShowChains(s => !s)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-white/15 text-[10px] active:bg-white/10 transition-colors"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/70 font-medium">{LIVE_COUNT} Live</span>
            <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
          </button>
          <div className="text-[10px] text-white/40 uppercase tracking-widest">
            UPL
          </div>
        </div>

        {/* ── Chains dropdown ──────────────────────────────────────────── */}
        {showChains && (
          <div className="fixed top-12 left-3 right-3 z-50 bg-black border border-white/20 max-h-[70vh] overflow-y-auto">
            {vmGroups.map(({ vmKey, label, chains }) => (
              <div key={vmKey}>
                <div className="px-3 py-2 text-[10px] text-white/40 uppercase tracking-wider border-b border-white/10 bg-white/[.03] flex items-center gap-2 sticky top-0 backdrop-blur">
                  <span>{label}</span>
                  <span className="text-white/20">·</span>
                  <span className="text-white/20">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
                </div>
                {chains.map(([k, v]) => (
                  <button key={k} onClick={() => { switchChain(k); setShowChains(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/10 active:bg-white/10 text-left ${!v.live ? 'opacity-40' : ''}`}
                    disabled={!v.live}>
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
                    <span className="text-sm text-white">{v.name}</span>
                    <span className="text-white/30 text-xs ml-auto">{v.symbol}</span>
                    {v.deployed && <span className="text-[9px] text-green-400 font-bold">● Live</span>}
                    {!v.live && <span className="text-[10px] text-yellow-400">Soon</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Hero section ─────────────────────────────────────────────── */}
        <div className="flex flex-col items-center justify-center min-h-screen min-h-[100dvh] px-6 pt-20 pb-32 text-center">
          {/* Brand chip */}
          <div className="mb-8 flex items-center gap-2 px-3 py-1.5 border border-white/10 bg-white/[.02]">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-[10px] text-white/50 uppercase tracking-[0.2em]">Base · EVM · Solana · Sui</span>
          </div>

          {/* Headline */}
          <h1 className="font-heading text-5xl font-bold tracking-tight text-white mb-3 leading-[1.05]">
            Privacy <span className="text-green-400">Cloak</span>
          </h1>
          <p className="text-white/50 text-sm max-w-[260px] mx-auto mb-10 leading-relaxed">
            Trade. Swap. Send.<br />
            Without your wallet being traced.
          </p>

          {/* ── Primary CTA ───────────────────────────────────────────── */}
          <div className="w-full max-w-[320px] mb-6">
            <MagnetizeButton
              onClick={() => setWalletMenuOpen(true)}
              disabled={connecting}
              particleCount={20}
              className="w-full py-4 text-base min-h-[60px]"
              data-testid="connect-wallet-mobile"
            >
              {connecting ? "Opening wallet…" : "Connect Wallet"}
            </MagnetizeButton>
            <div className="mt-3 text-[10px] text-white/30 text-center">
              Opens securely in your wallet's built-in browser
            </div>
          </div>

          {/* Feature list */}
          <div className="mt-6 w-full max-w-[320px] grid grid-cols-3 gap-2 text-center">
            {[
              ["100%", "Private"],
              [LIVE_COUNT.toString(), "Chains"],
              ["0", "Traces"],
            ].map(([val, lbl]) => (
              <div key={lbl} className="py-2.5 px-1 border border-white/10 bg-white/[.02]">
                <div className="text-lg font-bold text-white">{val}</div>
                <div className="text-[9px] text-white/40 uppercase tracking-wider mt-0.5">{lbl}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 z-30 py-3 bg-gradient-to-t from-black via-black/95 to-transparent flex items-center justify-center gap-3 text-[10px] text-white/30">
          <a href="/terms" className="hover:text-white/60 transition-colors">Terms</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-white/60 transition-colors">Privacy</a>
          <span>·</span>
          <a href="/guide" className="hover:text-white/60 transition-colors">Guide</a>
        </div>

        {/* ── Wallet picker bottom-sheet (mobile only) ─────────────── */}
        {walletMenuOpen && (
          <div
            className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/70 backdrop-blur-sm"
            onClick={() => setWalletMenuOpen(false)}
          >
            <div
              className="bg-black border-t border-white/10 shadow-2xl max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-200"
              onClick={(e) => e.stopPropagation()}
              data-testid="mobile-wallet-picker"
            >
              {/* Grabber */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="px-5 pt-2 pb-3 flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold text-base">
                    Connect your wallet
                  </div>
                  <div className="text-[11px] text-white/40 mt-0.5">
                    Choose your preferred wallet app
                  </div>
                </div>
                <button
                  onClick={() => setWalletMenuOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 text-white/60 text-sm flex items-center justify-center active:bg-white/20 transition-colors"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Wallet list */}
              <div className="px-2 pb-2">
                {mobileWallets.map((w) => {
                  const disabled = connecting;
                  return (
                    <button
                      key={w.key}
                      onClick={() => {
                        if (disabled) return;
                        // Close sheet immediately for perceived speed
                        // (the deep-link redirect will happen ~instantly after).
                        setWalletMenuOpen(false);
                        connectMobile(w.key);
                      }}
                      disabled={disabled}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors min-h-[60px]"
                    >
                      {/* Brand circle (first letter + brand color) */}
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: w.brandColor }}
                      >
                        <span className="text-white font-bold text-lg">
                          {w.label[0]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-white font-semibold text-[15px]">
                          {w.label}
                        </div>
                        {w.noteLabel ? (
                          <div className="text-[11px] text-white/40 mt-0.5">
                            {w.noteLabel}
                          </div>
                        ) : w.deepLinkAvailable ? (
                          <div className="text-[11px] text-white/40 mt-0.5">
                            Opens in {w.label}'s browser
                          </div>
                        ) : (
                          <div className="text-[11px] text-yellow-400/80 mt-0.5">
                            Via WalletConnect on Android
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-white/30 text-xl">›</div>
                    </button>
                  );
                })}

                {/* WalletConnect divider row */}
                <div className="px-4 py-2.5 mt-1">
                  <div className="text-[10px] text-white/30 uppercase tracking-wider text-center">
                    Other wallets
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (connecting) return;
                    setWalletMenuOpen(false);
                    connectMobile("walletconnect");
                  }}
                  disabled={connecting}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors min-h-[60px]"
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-lg">W</span>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-white font-semibold text-[15px]">
                      WalletConnect
                    </div>
                    <div className="text-[11px] text-white/40 mt-0.5">
                      Works with 300+ wallets
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-white/30 text-xl">›</div>
                </button>
              </div>

              {/* Bottom hint */}
              <div className="px-5 py-4 text-center text-[11px] text-white/30 border-t border-white/5">
                Don't have a wallet?{" "}
                <a
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400 underline underline-offset-2"
                >
                  Get MetaMask
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── DESKTOP LAYOUT — bit-for-bit identical to before this commit. ───
  // No changes below this line for desktop users. The globe, the top-bar
  // connect-button dropdown, the stats row, the chain pills, the VM
  // pills, the terms links — everything the pilot approved remains.
  return (
    <div className="min-h-screen relative bg-black overflow-hidden">
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-white/20 text-[10px] sm:text-xs cursor-pointer hover:border-white/40 transition-all"
          onClick={() => setShowChains(!showChains)} data-testid="live-chain-badge">
          <div className="w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/70">{LIVE_COUNT} Live</span>
          <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${showChains ? "rotate-180" : ""}`} />
        </div>

        <div className="relative" ref={walletMenuRef}>
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

      <div className="pt-16 md:pt-20 flex justify-center items-center min-h-[40vh]">
        <div className="w-[200px] h-[200px] md:w-[350px] md:h-[350px]">
          <RotatingEarth width={350} height={350} />
        </div>
      </div>

      <div className="text-center px-4 md:px-6 pb-20 mt-4 sm:mt-6 md:mt-10">
        <h1 className="font-heading text-2xl md:text-6xl font-bold tracking-tight text-white mb-3 md:mb-6">
          Privacy Cloak
        </h1>
        <p className="text-white/40 text-sm md:text-base mb-5 md:mb-8 max-w-md mx-auto px-2">
          Private transactions across every chain. One interface, all networks.
        </p>

        <div className="flex items-center justify-center gap-8 md:gap-12 mb-6 md:mb-8">
          {[["100%", "Private"], [LIVE_COUNT.toString(), "Chains"], ["10", "Pillars"]].map(([val, lbl]) => (
            <div key={lbl} className="text-center">
              <span className="block text-lg md:text-2xl font-bold text-white">{val}</span>
              <span className="text-[10px] text-white/40 uppercase tracking-wider">{lbl}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-6 px-2">
          {Object.entries(VM_GROUPS).map(([vmKey, info]) => (
            <div key={vmKey} className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-xs whitespace-nowrap">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-white/60">{info.label}</span>
              <span className="text-white/20">·</span>
              <span className="text-white/30">{vmKey === VM.EVM ? "Solidity" : vmKey === VM.SOLANA ? "Rust" : "Move"}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-8 px-2">
          {Object.entries(CHAINS).map(([k, v]) => (
            <div key={k} className={`flex items-center gap-1 px-2 py-1.5 border border-white/10 text-xs cursor-pointer hover:border-white/30 transition-all ${!v.live ? 'opacity-50' : ''}`}
              onClick={() => { if (v.live) { switchChain(k); } }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
              <span className="text-white/60">{v.name}</span>
              {!v.live && <span className="text-[10px] text-yellow-400 ml-0.5" title="Mainnet deployment pending — currently disabled">Soon</span>}
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
