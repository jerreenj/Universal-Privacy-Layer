// NOTE: do NOT `import { clusterApiUrl } from "@solana/web3.js"` here. This
// config module is imported by WalletContext and the landing page on startup,
// so a static import would drag the whole @solana/web3.js SDK (bs58, secp256k1,
// hashes…) into the main bundle and defeat the dynamic-import in
// WalletContext.connectSolana. clusterApiUrl("mainnet-beta") resolves to this
// exact string, so we inline it instead.
//
// P2.10 Step 10a: Solana runs on DEVNET by default ($0 pilot-ready path — the
// program is deployed to devnet, not mainnet, until SOL funding is secured).
// Set REACT_APP_SOL_RPC_URL to a mainnet URL + REACT_APP_SOL_DEVNET=false to
// switch the UI to mainnet after the funded deploy (Step 10b). The program ID
// is identical on both because the deployer keypair is reused.
const SOLANA_RPC = process.env.REACT_APP_SOL_RPC_URL || "https://api.devnet.solana.com";
const SOLANA_IS_DEVNET = (process.env.REACT_APP_SOL_DEVNET ?? "true") !== "false";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// VM Types
export const VM = { EVM: "evm", SOLANA: "solana", SUI: "sui" };

// EVM contract addresses (same on all 7 EVM chains)
// TODO: replace with real deployed addresses after on-chain deployment (P1.5/P1.9)
export const EVM_CONTRACTS = {
  privacyRelayer: "0x0000000000000000000000000000000000000000",
  stealthRegistry: "0x0000000000000000000000000000000000000000",
};

/**
 * USDC addresses per EVM chain — the primary stablecoin people actually hold.
 * Powers the wallet balance shown in the Dashboard hero. Cached here so the
 * WalletContext can look it up in O(1) via CHAINS[chain].contracts.usdc.
 */
const USDC_BY_CHAIN = {
  base:         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // 6 decimals
  arbitrum:     "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // 6
  polygon:      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // 6 (native USDC)
  optimism:     "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // 6
  bnb:          "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // 18 (BEP20 bridged USDC)
  avalanche:    "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // 6
  hyperliquid:  "0xb88339CB719cd1391f0D5f401C2c28e7fBa60a36", // (placeholder until mainnet USDC address is confirmed)
};

function withUsdc(chainKey) {
  return { ...EVM_CONTRACTS, usdc: USDC_BY_CHAIN[chainKey] || null };
}

// Chain registry
export const CHAINS = {
  base:         { vm: VM.EVM,    name: "Base",         chainId: "0x2105", chainIdDec: 8453,   rpcUrl: "https://mainnet.base.org",                  explorer: "https://basescan.org",                    symbol: "ETH",  color: "#0052FF", live: true,  contracts: withUsdc("base") },
  arbitrum:     { vm: VM.EVM,    name: "Arbitrum",     chainId: "0xa4b1", chainIdDec: 42161,  rpcUrl: "https://arb1.arbitrum.io/rpc",              explorer: "https://arbiscan.io",                     symbol: "ETH",  color: "#28A0F0", live: true,  contracts: withUsdc("arbitrum") },
  polygon:      { vm: VM.EVM,    name: "Polygon",      chainId: "0x89",   chainIdDec: 137,    rpcUrl: "https://rpc-mainnet.matic.quiknode.pro",    explorer: "https://polygonscan.com",                 symbol: "POL",  color: "#8247E5", live: true,  contracts: withUsdc("polygon") },
  optimism:     { vm: VM.EVM,    name: "Optimism",     chainId: "0xa",    chainIdDec: 10,     rpcUrl: "https://mainnet.optimism.io",               explorer: "https://optimistic.etherscan.io",         symbol: "ETH",  color: "#FF0420", live: true,  contracts: withUsdc("optimism") },
  bnb:          { vm: VM.EVM,    name: "BNB Chain",    chainId: "0x38",   chainIdDec: 56,     rpcUrl: "https://bsc-dataseed1.binance.org/",        explorer: "https://bscscan.com",                     symbol: "BNB",  color: "#F3BA2F", live: true,  contracts: withUsdc("bnb") },
  avalanche:    { vm: VM.EVM,    name: "Avalanche",    chainId: "0xa86a", chainIdDec: 43114,  rpcUrl: "https://api.avax.network/ext/bc/C/rpc",     explorer: "https://snowtrace.io",                    symbol: "AVAX", color: "#E84142", live: true,  contracts: withUsdc("avalanche") },
  hyperliquid:  { vm: VM.EVM,    name: "Hyperliquid",  chainId: "0x3e7",  chainIdDec: 999,    rpcUrl: "https://rpc.hyperliquid.xyz/evm",           explorer: "https://purrsec.com",                     symbol: "HYPE", color: "#00FF88", live: true,  contracts: withUsdc("hyperliquid") },
  solana:       { vm: VM.SOLANA, name: "Solana",       chainId: null,     chainIdDec: null,   rpcUrl: SOLANA_RPC,                                  explorer: "https://solscan.io",                      symbol: "SOL",  color: "#9945FF", live: true,  comingSoon: false, devnet: SOLANA_IS_DEVNET, contracts: { programId: null, usdc: "EPjFWdd5AufqSSqeM2qN1xzybafCcuG4f2u3jGx1gcG" } },
  sui:          { vm: VM.SUI,    name: "Sui",          chainId: null,     chainIdDec: null,   rpcUrl: "https://fullnode.mainnet.sui.io:443",       explorer: "https://suiexplorer.com",                 symbol: "SUI",  color: "#6FBCF0", live: false, comingSoon: true, contracts: { packageId: null } },
};

export const VM_GROUPS = {
  [VM.EVM]:    { label: "EVM Chains",  walletName: "MetaMask",  icon: "M" },
  [VM.SOLANA]: { label: "Solana",      walletName: "Phantom",   icon: "P" },
  [VM.SUI]:    { label: "Sui",         walletName: "Sui Wallet",icon: "S" },
};

export const TOKENS = {
  base:        [{ symbol: "ETH",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
  arbitrum:    [{ symbol: "ETH",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }],
  polygon:     [{ symbol: "POL",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" }],
  optimism:    [{ symbol: "ETH",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" }],
  bnb:         [{ symbol: "BNB",  decimals: 18, address: "native" }, { symbol: "USDC", decimals: 18, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" }],
  avalanche:   [{ symbol: "AVAX", decimals: 18, address: "native" }, { symbol: "USDC", decimals: 6,  address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" }],
  hyperliquid: [{ symbol: "HYPE", decimals: 18, address: "native" }],
  solana:      [{ symbol: "SOL",  decimals: 9,  address: "native" }],
  sui:         [{ symbol: "SUI",  decimals: 9,  address: "native" }],
};

export const LIVE_COUNT = Object.values(CHAINS).filter(c => c.live).length;

// True when Solana is pointed at devnet (UI surfaces a "devnet / test mode" badge).
export const SOLANA_DEVNET = SOLANA_IS_DEVNET;
