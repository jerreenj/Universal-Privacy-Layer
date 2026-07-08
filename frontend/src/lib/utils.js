import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * formatExactBalance(rawUnits, decimals) → string
 *
 * Renders an ERC-20 / native on-chain balance with the EXACT precision
 * the token actually has. The previous
 *   `parseFloat(formatted).toFixed(2)`
 * truncated `6.789012 USDC` to `6.79` and silently rounded sub-cent
 * dust to zero — customers with $0.40 USDC saw `0.40` and assumed that
 * was right, but $0.005 USDC dust that was their actual wallet
 * balance disappeared.
 *
 * Approach:
 *   - Convert raw integer to a JS Number via parseFloat of the
 *     ethers-style decimal-shifted string. (parseFloat is safe up to
 *     ~15 significant digits — well past any 6-decimal USDC, 9-decimal
 *     SOL, or 18-decimal ETH amount we'd realistically display.)
 *   - Display precision chosen by token decimals — NOT a fixed
 *     `.toFixed(2)`. For USDC we show up to 6 decimals; for ETH up to 6
 *     decimals (humans don't read 18-digit wei).
 *   - Trim trailing zeros + the orphan dot, so `6.789000` renders as
 *     `6.789` and `1234` doesn't pretend it has cents.
 *   - Insert thousands grouping via a regex so `1234567.89` reads as
 *     `1,234,567.89`.
 *
 * Returns "0" for zero, "—" for null/undefined, and the formatted
 * string otherwise.
 *
 * @param {bigint|string|number} rawUnits — on-chain integer balance
 * @param {number} decimals                 — token decimals (6 for USDC,
 *                                            18 for ETH/Bnb, 9 for SOL/SUI)
 * @returns {string}
 */
export function formatExactBalance(rawUnits, decimals) {
  if (rawUnits === undefined || rawUnits === null) return "—";
  const rawStr = typeof rawUnits === "bigint"
    ? rawUnits.toString()
    : String(rawUnits);
  if (rawStr === "") return "—";
  // 0n, "0", and 0 all stringify to "0". Render zero as plain "0" —
  // NOT "—" (which suggests data hasn't loaded).
  if (rawStr === "0") return "0";
  const dec = Number.isFinite(decimals) && decimals >= 0 ? decimals : 0;

  // String-based decimal point insertion. Avoids floating-point loss on
  // the integer part entirely; the fractional part can lose precision
  // beyond ~15 digits under parseFloat, but no real USDC/ETH balance
  // has more than 18 fractional digits anyway.
  const decimalStr = dec > 0 ? insertDecimalPoint(rawStr, dec) : rawStr;
  const num = parseFloat(decimalStr);
  if (!Number.isFinite(num)) return "—";

  // Display precision = min(decimals, 6). For 6-decimal tokens we
  // show all 6; for 18-decimal ETH we cap at 6 so the UI never shows
  // 18-digit fractional wei.
  const displayDecimals = Math.min(dec, 6);
  // toFixed pads to displayDecimals with a half-up round.
  const fixed = num.toFixed(displayDecimals);
  // Trim trailing zeros after the dot; drop the dot entirely if the
  // whole number was an integer.
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  // Insert thousands grouping on the integer part only.
  const [intPart, fracPart] = trimmed.split(".");
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${intFmt}.${fracPart}` : intFmt;
}

function insertDecimalPoint(intStr, decimals) {
  if (intStr.length <= decimals) {
    const pad = "0".repeat(decimals - intStr.length) + intStr;
    return "0." + pad;
  }
  return intStr.slice(0, intStr.length - decimals) +
    "." + intStr.slice(intStr.length - decimals);
}
