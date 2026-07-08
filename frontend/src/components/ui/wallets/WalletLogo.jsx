/**
 * Wallet logos used in the wallet-family picker and any other
 * connect UI.
 *
 * All four logos are loaded as <img> from /public/wallets/, which
 * holds the true brand-correct SVG for each:
 *   - metamask.svg : official fox from metamask.io/assets CDN
 *   - phantom.svg  : phantom ghost from @web3icons/core (branded)
 *   - rabby.svg    : rabbit mascot from @web3icons/core (branded)
 *   - sui.svg      : mystic water-drop from MystenLabs/sui
 *
 * Loading as <img> keeps the React tree light (no inline SVG path
 * strings) and lets the browser cache the SVG asset once per tab.
 */
import React from "react";

/* eslint-disable react/prop-types */

const SOURCES = {
  metamask: "/wallets/metamask.svg",
  phantom:  "/wallets/phantom.svg",
  sui:      "/wallets/sui.svg",
  rabby:    "/wallets/rabby.svg",
};

export function MetaMaskLogo({ size = 28, ...rest }) {
  return <ImgLogo kind="metamask" size={size} {...rest} />;
}
export function PhantomLogo({ size = 28, ...rest }) {
  return <ImgLogo kind="phantom"  size={size} {...rest} />;
}
export function SuiLogo({ size = 28, ...rest }) {
  return <ImgLogo kind="sui"      size={size} {...rest} />;
}
export function RabbyLogo({ size = 28, ...rest }) {
  return <ImgLogo kind="rabby"    size={size} {...rest} />;
}

function ImgLogo({ kind, size = 28, title, ...rest }) {
  const src = SOURCES[kind];
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={title || kind}
      title={title}
      loading="lazy"
      draggable={false}
      style={{ display: "block", userSelect: "none" }}
      {...rest}
    />
  );
}

/**
 * Convenience dispatcher — picks the right WalletLogo by string key.
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
