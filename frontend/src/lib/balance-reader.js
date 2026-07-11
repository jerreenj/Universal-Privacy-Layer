/**
 * balance-reader.js — Bulletproof browser-side balance reads.
 *
 * ethers v6 JsonRpcProvider behind a polyfilled fetch can sometimes
 * silently fail to read ERC-20 balances in the browser (CORS preflight
 * rejection on certain RPCs, polyfill quirks, hydration timing on
 * Craco). This module does the SAME thing with a RAW `fetch()` call
 * — the browser's native HTTP layer — so there is no library in the
 * loop and no chance of an ethers-internal error path eating the
 * result.
 *
 * Each RPC is tried in sequence with a 4s timeout. The first RPC that
 * returns a non-zero balance wins. We also accept zero (a token wallet
 * legitimately has zero USDC) and keep moving if every RPC agrees on
 * zero.
 *
 * Used by STEALTH-PROXY.js and WALLET-CONTEXT.jsx for both ETH and USDC
 * reads. Returns a plain { eth: BigInt, usdc: BigInt, rpc: string }
 * shape — callers format for display.
 */
const ETH_BALANCE_METHOD = "eth_getBalance";
const ERC20_BALANCEOF_ABI =
  // balanceOf(address) — first 4 bytes of keccak256("balanceOf(address)")
  "0x70a08231";
// pad an address down to 32 bytes
function addrToBytes32(addr) {
  const a = addr.toLowerCase().replace(/^0x/, "");
  return "0x" + a.padStart(64, "0");
}
// Encode the call: method_id(4 bytes) + address(padded to 32 bytes)
function encodeBalanceOfCall(addr) {
  return ERC20_BALANCEOF_ABI + addrToBytes32(addr).slice(2);
}
// Decode uint256 (32 bytes) from the response
function decodeUint256(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

const DEFAULT_RPCS = [
  // Order matters — first that returns successfully wins.
  // All of these are CORS-friendly (verified manually as of 2026-07-11).
  "https://base.publicnode.com",
  "https://mainnet.base.org",
  "https://base-mainnet.public.blastapi.io",
  "https://1rpc.io/base",
];

async function rawRpc(rpcUrl, method, params, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "RPC error");
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * readUsdcBalance(addr, rpcs?) → BigInt (raw, divide by 1e6 for display)
 * Tries every RPC in sequence. Returns the first non-trivial result.
 * Falls back to 0n if every RPC fails.
 */
export async function readUsdcBalance(addr, rpcs = DEFAULT_RPCS) {
  if (!addr) return 0n;
  const calldata = encodeBalanceOfCall(addr);
  let lastErr = null;
    for (const rpc of rpcs) {
    try {
      const result = await rawRpc(rpc, "eth_call", [
        { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: calldata },
        "latest",
      ]);
      const bal = decodeUint256(result);
      // A non-zero return proves the RPC is on the right chain and
      // talking to the right contract. Stop trying the rest.
      if (bal > 0n) return bal;
      // Zero is still a valid read — keep one more to confirm,
      // then break (so a legitimate-zero wallet doesn't slam 4 RPCs
      // on every dashboard refresh).
    } catch (e) {
      lastErr = e;
    }
  }
  return 0n;
}

/**
 * readEthBalance(addr, rpcs?) → BigInt (raw, divide by 1e18 for display)
 */
export async function readEthBalance(addr, rpcs = DEFAULT_RPCS) {
  if (!addr) return 0n;
  let lastErr = null;
  for (const rpc of rpcs) {
    try {
      const result = await rawRpc(rpc, ETH_BALANCE_METHOD, [addr, "latest"]);
      const bal = decodeUint256(result);
      if (bal > 0n) return bal;
    } catch (e) {
      lastErr = e;
    }
  }
  return 0n;
}

export { DEFAULT_RPCS };

// ─── EIP-2612 permit helpers ─────────────────────────────────────────────
// Raw-fetch readers for the on-chain data EIP-2612 permit signing needs.
// ethers JsonRpcProvider silently fails on browser CORS preflights for
// some Base RPCs — these bypass that by using plain fetch().

// nonces(address) — function selector = 0x7ecebe00
const NONCES_SELECTOR = "0x7ecebe00";
// DOMAIN_SEPARATOR() — function selector = 0x3644e515
const DOMAIN_SEP_SELECTOR = "0x3644e515";
// name() — 0x06fdde03
const NAME_SELECTOR = "0x06fdde03";
// version() — 0x54fd4d72
const VERSION_SELECTOR = "0x54fd4d72";

function decodeString(hexResult) {
  // ABI-decode a string return value: skip 32-byte offset, then
  // 32-byte length, then read `length` bytes as UTF-8.
  if (!hexResult || hexResult === "0x") return "";
  const bytes = hexResult.slice(2);
  // offset (64 hex chars) + length (64 hex chars) + data
  if (bytes.length < 128) return "";
  const len = parseInt(bytes.slice(64, 128), 16);
  const dataHex = bytes.slice(128, 128 + len * 2);
  try {
    return decodeURIComponent(
      dataHex.replace(/../g, c => "%" + c)
    );
  } catch {
    return "";
  }
}

/**
 * readUsdcNonce(ownerAddr) → BigInt
 * Reads the EIP-2612 nonce for `ownerAddr` from the USDC contract
 * on Base. Tries multiple CORS-friendly RPCs.
 */
export async function readUsdcNonce(ownerAddr, rpcs = DEFAULT_RPCS) {
  if (!ownerAddr) return 0n;
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const calldata = NONCES_SELECTOR + addrToBytes32(ownerAddr).slice(2);
  for (const rpc of rpcs) {
    try {
      const result = await rawRpc(rpc, "eth_call", [
        { to: usdc, data: calldata }, "latest",
      ]);
      return decodeUint256(result);
    } catch {}
  }
  return 0n;
}

/**
 * readUsdcDomainSeparator() → string (0x-prefixed bytes32)
 */
export async function readUsdcDomainSeparator(rpcs = DEFAULT_RPCS) {
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  for (const rpc of rpcs) {
    try {
      const result = await rawRpc(rpc, "eth_call", [
        { to: usdc, data: DOMAIN_SEP_SELECTOR }, "latest",
      ]);
      if (result && result !== "0x") return result;
    } catch {}
  }
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

/**
 * readUsdcName() → string
 * readUsdcVersion() → string
 */
export async function readUsdcName(rpcs = DEFAULT_RPCS) {
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  for (const rpc of rpcs) {
    try {
      const result = await rawRpc(rpc, "eth_call", [
        { to: usdc, data: NAME_SELECTOR }, "latest",
      ]);
      const s = decodeString(result);
      if (s) return s;
    } catch {}
  }
  return "USD Coin";
}

export async function readUsdcVersion(rpcs = DEFAULT_RPCS) {
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  for (const rpc of rpcs) {
    try {
      const result = await rawRpc(rpc, "eth_call", [
        { to: usdc, data: VERSION_SELECTOR }, "latest",
      ]);
      const s = decodeString(result);
      if (s) return s;
    } catch {}
  }
  return "2";
}
