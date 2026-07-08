/**
 * Wallet logos used in the wallet-family picker and any other
 * connect UI. MetaMask + Sui are real, downloaded from the official
 * sources (metamask.io/assets CDN + MystenLabs/sui GitHub repo at
 * pinned commit) and shipped in /public/wallets/. Phantom + Rabby
 * are inline SVG approximations of their brand marks because the
 * upstream assets aren't hosted at a stable public path we'd be
 * comfortable pinning to a build.
 *
 * All four logos are rendered with `currentColor` where possible so
 * they theme correctly with the picker dropdown background.
 */
import React from "react";

/* eslint-disable react/prop-types */

function SvgWrap({ size = 24, children, viewBox = "0 0 32 32", ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={viewBox}
      role="img"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function MetaMaskLogo({ size = 24, ...rest }) {
  // Real MetaMask fox, downloaded from
  //   https://images.ctfassets.net/clixtyxoaeas/.../MetaMask-icon-fox.svg
  // Loaded as <img> so we don't have to inline the full SVG path here.
  // pixels = 32 default so it lines up with the Phantom/Rabby tiles.
  return (
    <img
      src={"/wallets/metamask.svg"}
      width={size}
      height={size}
      alt="MetaMask"
      style={{ display: "block" }}
      {...rest}
    />
  );
}

export function SuiLogo({ size = 24, ...rest }) {
  return (
    <img
      src={"/wallets/sui.svg"}
      width={size}
      height={size}
      alt="Sui"
      style={{ display: "block" }}
      {...rest}
    />
  );
}

/**
 * Phantom — purple gradient circle with a flowing white
 * "ghost"/"P" mark. The P is an inline SVG path approximation of
 * the brand mark: bold vertical stroke + curved bowl that flows
 * down into a curl at the bottom-right, evoking the phantom
 * ghost-trailing-charcoal-pixel look without infringing.
 */
export function PhantomLogo({ size = 28, ...rest }) {
  return (
    <SvgWrap size={size} viewBox="0 0 32 32" {...rest}>
      <defs>
        <linearGradient id="phantom-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#5347B5" />
          <stop offset="100%" stopColor="#AB9FF2" />
        </linearGradient>
      </defs>
      {/* Square backdrop with rounded corners — matches Phantom's
          app icon ratio. */}
      <rect x="0" y="0" width="32" height="32" rx="7" fill="url(#phantom-bg)" />
      {/* "P" mark. Vertical bar on the left, bowl on the top-right,
          and a flowing tail at the bottom. Three sub-paths to keep
          the mark readable at 16-28px. */}
      <g fill="#FFFFFF">
        <path d="
          M 11 8
          L 11 25
          L 14.5 25
          L 14.5 18.5
          L 19 18.5
          C 22 18.5 24 16.5 24 13.2
          C 24 10 22 8 19 8
          Z
          M 14.5 11
          L 18.5 11
          C 19.7 11 20.7 11.7 20.7 13.2
          C 20.7 14.7 19.7 15.5 18.5 15.5
          L 14.5 15.5
          Z
        " />
        {/* Flowing tail that softens the corner. */}
        <path d="
          M 17 19
          C 18.5 21.2 21 23 23.5 22.5
          L 22.5 20
          C 21.5 19.7 19.5 19.2 17 19
          Z
        " opacity="0.85" />
      </g>
    </SvgWrap>
  );
}

/**
 * Rabby — purple gradient square with two white rabbit ears
 * poking out of the top and a simple round face below. The rabbit
 * mascot is the wallet's namesake and the mark they use on the
 * extension UI.
 */
export function RabbyLogo({ size = 28, ...rest }) {
  return (
    <SvgWrap size={size} viewBox="0 0 32 32" {...rest}>
      <defs>
        <linearGradient id="rabby-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#7084FF" />
          <stop offset="100%" stopColor="#5366E6" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="7" fill="url(#rabby-bg)" />
      {/* Two long ears. */}
      <g fill="#FFFFFF">
        <path d="
          M 10 7
          C 9.5 8.5 9.3 11.5 10.5 13.5
          L 12.7 12.5
          C 12.0 11.0 11.7 9.0 11.6 7.7
          Z
        " />
        <path d="
          M 19 7
          C 18.5 8.5 18.3 11.5 19.5 13.5
          L 21.7 12.5
          C 21.0 11.0 20.7 9.0 20.6 7.7
          Z
        " />
        {/* Round head. */}
        <ellipse cx="14.7" cy="20" rx="6.5" ry="6" />
        {/* Single dot eye. Placeholders can be tweaked. */}
        <circle cx="12.4" cy="19.4" r="0.7" fill="url(#rabby-bg)" />
        <circle cx="17.0" cy="19.4" r="0.7" fill="url(#rabby-bg)" />
      </g>
    </SvgWrap>
  );
}

/**
 * Convenience dispatcher — pick the right WalletLogo by key.
 */
export function WalletLogo({ kind, size = 28, ...rest }) {
  switch (kind) {
    case "metamask": return <MetaMaskLogo size={size} {...rest} />;
    case "phantom":  return <PhantomLogo  size={size} {...rest} />;
    case "sui":      return <SuiLogo      size={size} {...rest} />;
    case "rabby":    return <RabbyLogo    size={size} {...rest} />;
    default:         return null;
  }
}
