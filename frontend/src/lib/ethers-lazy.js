/**
 * Lazy-loaded ethers.js helper — reduces initial bundle size by ~400KB.
 * 
 * Instead of importing ethers statically (bloats main bundle), we use dynamic
 * imports and cache the result. All utilities delegate to the cached ethers.
 * 
 * Usage:
 *   import * as ethersUtils from "@/lib/ethers-lazy";
 *   const formatted = ethersUtils.formatEther(amount);
 *   const provider = await ethersUtils.createProvider(url);
 */

let ethersPromise = null;
let ethersInstance = null;

/**
 * Get ethers instance (lazy-loaded, cached after first call).
 * @returns {Promise<ethers>}
 */
async function getEthers() {
  if (!ethersPromise) {
    ethersPromise = import("ethers").then(ethers => {
      ethersInstance = ethers;
      window.ethers = ethers; // Make available for synchronous calls
      return ethers;
    });
  }
  return ethersPromise;
}

/**
 * Format Wei to Ether string.
 * @param {string|bigint} value Wei amount
 * @returns {string} Formatted ether string
 */
export function formatEther(value) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.formatEther(value);
}

/**
 * Format units with specified decimals.
 * @param {string|bigint} value Amount in smallest unit
 * @param {number} decimals Number of decimals (e.g., 6 for USDC, 18 for ETH)
 * @returns {string} Formatted amount
 */
export function formatUnits(value, decimals) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.formatUnits(value, decimals);
}

/**
 * Parse ether string to Wei.
 * @param {string} value Ether amount
 * @returns {bigint} Wei amount
 */
export function parseEther(value) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.parseEther(value);
}

/**
 * Parse units with specified decimals.
 * @param {string} value Amount
 * @param {number} decimals Number of decimals
 * @returns {bigint} Amount in smallest unit
 */
export function parseUnits(value, decimals) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.parseUnits(value, decimals);
}

/**
 * Check if address is valid.
 * @param {string} address Ethereum address
 * @returns {boolean} True if valid
 */
export function isAddress(address) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.isAddress(address);
}

/**
 * Compute keccak256 hash.
 * @param {string} data Input data
 * @returns {string} Keccak256 hash
 */
export function keccak256(data) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.keccak256(data);
}

/**
 * Convert UTF-8 string to bytes.
 * @param {string} text UTF-8 text
 * @returns {Uint8Array} Bytes
 */
export function toUtf8Bytes(text) {
  if (!ethersInstance) throw new Error("ethers not loaded yet - call getEthers() first");
  return ethersInstance.toUtf8Bytes(text);
}

/**
 * Create a JsonRpcProvider instance.
 * @param {string} url RPC URL
 * @returns {Promise<ethers.JsonRpcProvider>}
 */
export async function createProvider(url) {
  const ethers = await getEthers();
  return new ethers.JsonRpcProvider(url);
}

/**
 * Create a BrowserProvider from window.ethereum.
 * @param {object} ethereum window.ethereum object
 * @returns {Promise<ethers.BrowserProvider>}
 */
export async function createBrowserProvider(ethereum) {
  const ethers = await getEthers();
  return new ethers.BrowserProvider(ethereum);
}

/**
 * Create a Wallet instance.
 * @param {string} privateKey Private key
 * @param {ethers.Provider} [provider] Optional provider
 * @returns {Promise<ethers.Wallet>}
 */
export async function createWallet(privateKey, provider) {
  const ethers = await getEthers();
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Create a Contract instance.
 * @param {string} address Contract address
 * @param {array|object} abi Contract ABI
 * @param {ethers.Provider|ethers.Signer} signerOrProvider Provider or signer
 * @returns {Promise<ethers.Contract>}
 */
export async function createContract(address, abi, signerOrProvider) {
  const ethers = await getEthers();
  return new ethers.Contract(address, abi, signerOrProvider);
}

/**
 * Parse signature.
 * @param {string} signature Signature string
 * @returns {Promise<{v: number, r: string, s: string}>}
 */
export async function parseSignature(signature) {
  const ethers = await getEthers();
  return ethers.Signature.from(signature);
}

/**
 * Get MaxUint256 constant.
 * @returns {Promise<bigint>}
 */
export async function getMaxUint256() {
  const ethers = await getEthers();
  return ethers.MaxUint256;
}

// Initialize ethers on first module load (lazy but synchronous after)
getEthers(); // Trigger load on import
