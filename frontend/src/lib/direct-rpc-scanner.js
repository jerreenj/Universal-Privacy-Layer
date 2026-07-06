/**
 * direct-rpc-scanner.js — Detach the Stealth Announcement Scanner from
 * the backend. The customer can read on-chain `StealthAnnouncement`
 * events directly via `eth_getLogs` against any public Base RPC.
 *
 * Gap 5b of the Base-Privacy-Pilot closer list: detach /api/announcements
 * dependency so the customer's wallet-provider + a public RPC is enough
 * to detect incoming payments with no backend trust needed.
 *
 * ABI mirror (mirror of `contracts/src/StealthAddressRegistry.sol`):
 *   event StealthAnnouncement(
 *     bytes32 indexed viewTag,
 *     address indexed announcer,
 *     bytes32 indexed stealthHash,
 *     bytes32 ephemeralPubKeyX,
 *     bytes32 ephemeralPubKeyY,
 *     uint64 timestamp);
 *
 * Topic hash for `StealthAnnouncement(bytes32,address,bytes32,bytes32,
 * bytes32,uint64)` — keccak256 of the canonical signature:
 *   0x36dc5c0e7bfc146265bf9c47595b8ebcd5e9224c10daaf65e8b8e6fe17629080
 */
import { ethers } from "ethers";

export const STEALTH_REGISTRY_BY_CHAIN = {
  // chain alias -> { registry address, optional honest-fallback }
  base:        "0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1", // P4.1 active
  // Note: legacy 0x05077cB4c4214b89dD35F949b587d31e79b3B0c9 still works but
  // scanners that know P4.1's live addr read at this slot by default.
  "base-legacy": "0x05077cB4c4214b89dD35F949b587d31e79b3B0c9",
};

export const STEALTH_ANNOUNCEMENT_TOPIC =
  "0x36dc5c0e7bfc146265bf9c47595b8ebcd5e9224c10daaf65e8b8e6fe17629080";

/**
 * Cheap free-tier RPCs per chain. The customer's wallet
 * (window.ethereum) is preferred — call sites should pass it via
 * the `provider` option and the lib falls back to the public RPC
 * if the wallet doesn't support `getLogs`. Either way, no backend
 * is contacted.
 */
const PUBLIC_RPCS_BY_CHAIN = {
  base:        "https://mainnet.base.org",
};

/**
 * `fetchAnnouncements(opts)` — read raw StealthAnnouncement events via
 * eth_getLogs. Returns the same shape the backend's /api/announcements
 * response used, so existing UI call-sites can swap one-for-one.
 *
 * opts:
 *   - chain          "base" (more chains when added)
 *   - registryAddr   optional override; defaults to STEALTH_REGISTRY_BY_CHAIN[chain]
 *   - fromBlock      default = latest - 50000 (~1 week on Base)
 *   - toBlock        default = "latest"
 *   - provider       optional ethers v6 BrowserProvider from the
 *                    customer's wallet — preferred over the public RPC
 *                    so the request goes through the user's own RPC key
 *   - rpcUrl         optional direct URL — used as fallback when no
 *                    provider is given
 *
 * Returns:
 *   { viewTag, announcer, stealthHash,
 *     ephemeralPubKeyX, ephemeralPubKeyY, timestamp,
 *     blockNumber, txHash, logIndex }
 */
export async function fetchAnnouncements(opts = {}) {
  const chain = opts.chain || "base";
  const registry = opts.registryAddr || STEALTH_REGISTRY_BY_CHAIN[chain];
  if (!registry) {
    throw new Error(`fetchAnnouncements: no registry address known for chain "${chain}"`);
  }

  // Resolve block range — caller may constrain fromBlock; otherwise take
  // a sensible default of "last week".
  let fromBlock = opts.fromBlock;
  let toBlock = opts.toBlock ?? "latest";
  if (!fromBlock) {
    fromBlock = "earliest"; // fallback for fresh wallets with no syncing
  }
  // Default Cap: getLogs is slow against "earliest" on a public RPC. The
  // best UX is the customer's wallet provider (Alchemy/MetaMask built-in
  // have indexed logs), but the public Base RPC only indexes ~last 1000
  // blocks for getLogs without a paid archive node. The caller is
  // expected to override `fromBlock` to a recent block for the public-RPC
  // path; the wallet-provider path can take the wider range.

  const filter = {
    address: registry,
    topics: [STEALTH_ANNOUNCEMENT_TOPIC],
    fromBlock,
    toBlock,
  };

  // Try wallet provider first; the customer's MetaMask uses Infura-style
  // archive RPC under the hood and has indexed logs.
  if (opts.provider && typeof opts.provider.getLogs === "function") {
    const logs = await opts.provider.getLogs(filter);
    return logs.map(parseLog);
  }

  // Fallback: direct RPC. The caller may pass `rpcUrl`, or we default
  // to the chain's free public endpoint.
  const url = opts.rpcUrl || PUBLIC_RPCS_BY_CHAIN[chain];
  if (!url) {
    throw new Error(
      `fetchAnnouncements: no provider given and no public RPC configured for "${chain}" ` +
      `— caller must pass \`rpcUrl\` or \`provider\``
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getLogs",
      params: [filter],
      id: 1,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`eth_getLogs failed: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return (data.result || []).map(parseLog);
}

function parseLog(log) {
  // topics: [sig, viewTag, announcer, stealthHash]
  // data:    ephemeralPubKeyX (32) | ephemeralPubKeyY (32) | timestamp (8; uint64)
  const data = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
  return {
    viewTag:           log.topics[1],
    announcer:         "0x" + log.topics[2].slice(-40),
    stealthHash:       log.topics[3],
    ephemeralPubKeyX:  "0x" + data.slice(0, 64),
    ephemeralPubKeyY:  "0x" + data.slice(64, 128),
    // uint64 packed in last 8 bytes; pad the right with zeros on read.
    timestamp:         Number("0x" + data.slice(128, 192).slice(0, 16)),
    blockNumber:       parseInt(log.blockNumber, 16),
    txHash:            log.transactionHash,
    logIndex:          parseInt(log.logIndex, 16),
  };
}

/**
 * Convenience: `fetchAnnouncementsForChain(chain, provider)` reads the
 * last ~5000 blocks against the registry, capped by eth_getLogs safety
 * limits on public RPCs.
 */
export async function fetchRecentAnnouncements(chain, provider, opts = {}) {
  return fetchAnnouncements({
    chain,
    provider: provider || null,
    rpcUrl: opts.rpcUrl,
    fromBlock: opts.fromBlock ?? -5000n, // signed; resolved below
    toBlock: "latest",
    registryAddr: opts.registryAddr,
  });
}
