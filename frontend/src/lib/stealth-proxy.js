/**
 * stealth-proxy.js — Customer's swap-wallet that hides their main EOA.
 *
 * PROBLEM:
 *   On every swap today, the customer's main wallet address appears
 *   on BaseScan — either as msg.sender (forward swap) or as `from`
 *   in the USDC Transfer event (reverse swap). The relayer only
 *   hides the swap CALL, not the USDC transfer.
 *
 * SOLUTION:
 *   Derive a STEALTH PROXY WALLET from the customer's wallet
 *   signature. Same wallet → same proxy, every time. The customer
 *   funds it once (visible on BaseScan — one-time cost). After
 *   that, ALL swaps route through the proxy wallet:
 *
 *     forward swap: proxyWallet sends ETH → vault, gets USDC
 *     reverse swap: proxyWallet sends USDC → vault, gets ETH
 *
 *   Neither the swap call nor the USDC transfer shows the
 *   customer's main wallet. Only the proxy wallet appears — and
 *   the proxy wallet has no on-chain link back to the main
 *   wallet (it's derived from a signature, not a funding tx).
 *
 *   The funding tx (main → proxy) IS visible. But it happens
 *   once. After that: invisible.
 *
 * STORAGE:
 *   Proxy private key + address cached in localStorage so the
 *   customer doesn't re-sign every session.
 */
import { ethers } from "ethers";

const LS_KEY = "upl:stealth-proxy";

/**
 * Get or create the customer's proxy wallet. Same main wallet →
 * same proxy every time. Cached in localStorage.
 *
 * @param {object} signer — ethers v6 Signer from the main wallet
 * @returns {Promise<{address: string, privateKey: string, wallet: ethers.Wallet}>}
 */
export async function getOrCreateProxyWallet(signer) {
    // Check localStorage first.
    try {
        const cached = localStorage.getItem(LS_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            const wallet = new ethers.Wallet(parsed.privateKey);
            // Sanity: address match.
            if (wallet.address === parsed.address) {
                return { address: parsed.address, privateKey: parsed.privateKey, wallet };
            }
        }
    } catch {}

    // Not cached — derive fresh. This requires a wallet signature.
    // We use the deriveStealthEOA from wallet-stealth.js (chain-
    // independent, HKDF over a fixed plain-text message).
    const { deriveStealthEOA } = await import("@/lib/wallet-stealth");
    const derived = await deriveStealthEOA(signer);
    // Persist.
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            address: derived.address,
            privateKey: derived.privateKey,
        }));
    } catch {}
    // Build an ethers Wallet instance for signing txs.
    const provider = signer.provider ||
        (typeof window !== "undefined" && window.ethereum
            ? new ethers.BrowserProvider(window.ethereum) : null);
    const wallet = provider
        ? new ethers.Wallet(derived.privateKey, provider)
        : new ethers.Wallet(derived.privateKey);
    return { address: derived.address, privateKey: derived.privateKey, wallet };
}

/**
 * Check if the proxy wallet is funded (has ETH + USDC).
 *
 * @param {string} proxyAddress
 * @param {object} provider — ethers v6 provider (Base)
 * @returns {Promise<{eth: string, usdc: string}>}
 */
export async function checkProxyBalance(proxyAddress, provider, usdcAddress) {
    if (!provider) return { eth: "0", usdc: "0" };
    try {
        const ethBal = await provider.getBalance(proxyAddress);
        const usdc = new ethers.Contract(usdcAddress,
            ["function balanceOf(address) view returns (uint256)"], provider);
        const usdcBal = await usdc.balanceOf(proxyAddress);
        return {
            eth: ethers.formatEther(ethBal),
            usdc: ethers.formatUnits(usdcBal, 6),
        };
    } catch {
        return { eth: "0", usdc: "0" };
    }
}

/**
 * Fund the proxy wallet from the customer's main wallet.
 * One-time setup. After this, the customer never touches the
 * proxy directly — swaps route through it.
 *
 * @param {object} mainSigner — ethers v6 Signer (main wallet)
 * @param {string} proxyAddress
 * @param {string} ethAmount — e.g. "0.005"
 * @returns {Promise<string>} tx hash
 */
export async function fundProxyWallet(mainSigner, proxyAddress, ethAmount) {
    const tx = await mainSigner.sendTransaction({
        to: proxyAddress,
        value: ethers.parseEther(ethAmount),
    });
    await tx.wait();
    return tx.hash;
}

/**
 * Send USDC from main wallet to proxy wallet (if the customer
 * wants to swap USDC→ETH). One-time per USDC batch.
 */
export async function fundProxyUSDC(mainSigner, proxyAddress, usdcAddress, usdcAmountHuman) {
    const usdc = new ethers.Contract(usdcAddress,
        ["function transfer(address,uint256) returns (bool)"], mainSigner);
    const amount6dec = ethers.parseUnits(usdcAmountHuman, 6);
    const tx = await usdc.transfer(proxyAddress, amount6dec);
    await tx.wait();
    return tx.hash;
}

/**
 * Forget the cached proxy (used if the customer wants to derive
 * a new one — e.g. after a key compromise).
 */
export function forgetProxyWallet() {
    try { localStorage.removeItem(LS_KEY); } catch {}
}
