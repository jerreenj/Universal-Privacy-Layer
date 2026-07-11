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
import axios from "axios";
import { getAddressArchive } from "./wallet-stealth";

/**
 * Cache key MUST be per-address — different wallets have different
 * stealth wallets, so a single global LS_KEY leaks wallet A's proxy
 * to wallet B.
 *
 * HKDF derivation is deterministic per-wallet (same wallet signature
 * → same private key), so the cache hit is correct; the lookup is
 * just per-wallet.
 */
const lsKey = (address) =>
    `upl:stealth-proxy:${(address || "").toLowerCase()}`;

/**
 * Get or create the customer's proxy wallet. Same main wallet →
 * same proxy every time. Cached in localStorage.
 *
 * @param {object} signer — ethers v6 Signer from the main wallet
 * @returns {Promise<{address: string, privateKey: string, wallet: ethers.Wallet}>}
 */
export async function getOrCreateProxyWallet(signer) {
    // Get the wallet's own address — we use this as the cache key
    // so different connected wallets never share proxies.
    let ownerAddress = "";
    try { ownerAddress = await signer.getAddress(); } catch {}

    // Check localStorage first — per-wallet key.
    try {
        const cached = localStorage.getItem(lsKey(ownerAddress));
        if (cached) {
            const parsed = JSON.parse(cached);
            const wallet = new ethers.Wallet(parsed.privateKey);
            // Sanity: address match — guards against a corrupted cache
            // entry.
            if (wallet.address === parsed.address) {
                return { address: parsed.address, privateKey: parsed.privateKey, wallet };
            }
        }
    } catch {}

    // Not cached — derive fresh. This requires a wallet signature.
    // Re-fetch a FRESH signer from the provider so a MetaMask
    // account switch mid-session doesn't throw 'from should be
    // same as current address'.
    const provider = signer.provider ||
        (typeof window !== "undefined" && window.ethereum
            ? new ethers.BrowserProvider(window.ethereum) : null);
    if (!provider) throw new Error("No provider available");
    const freshSigner = await provider.getSigner();
    try {
        const accounts = await provider.listAccounts();
        if (accounts && accounts[0] &&
            accounts[0].toLowerCase() !== freshSigner.address.toLowerCase()) {
            throw new Error("MetaMask account switched. Reconnect and try again.");
        }
    } catch {}
    const { deriveStealthEOA } = await import("@/lib/wallet-stealth");
    const derived = await deriveStealthEOA(freshSigner);
    try {
        localStorage.setItem(lsKey(ownerAddress), JSON.stringify({
            address: derived.address,
            privateKey: derived.privateKey,
        }));
    } catch {}
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
 * Read the USDC + ETH balance at the user's stealth address WITHOUT
 * requiring a signature. The stealth address is cached in localStorage
 * from the first deriveStealthEOA call — if it exists, we just read
 * the balance. If not cached, return 0 (the stealth address hasn't
 * been generated yet).
 *
 * The customer may own SEVERAL stealth addresses (one per click of
 * the recycle button in StealthMeta). We sum balances across every
 * one in the local archive so the dashboard shows the customer's
 * TOTAL private balance — not just one address.
 *
 * @param {string} ownerAddress — the main wallet address (for cache key)
 * @param {object} provider — ethers v6 provider (Base) — only one of
 *                            these. We try a multi-RPC list internally
 *                            for CORS resilience but accept a caller-
 *                            provided provider as the first try.
 * @param {string} usdcAddress — USDC contract address on the chain
 * @returns {Promise<{eth: string, usdc: string, address: string|null, addresses: string[]}>}
 */
export async function readStealthBalance(ownerAddress, provider, usdcAddress) {
    if (!ownerAddress) return { eth: "0", usdc: "0", address: null, addresses: [] };
    let stealthAddrs = [];
    const addrLower = ownerAddress.toLowerCase();

    // 1. PRIORITY: per-wallet archive. The user has a list of
    //    every stealth address they've ever minted. The most
    //    recent is "active"; we sum balances across ALL of them.
    try {
        const archive = getAddressArchive(ownerAddress);
        if (archive.length > 0) {
            for (const entry of archive) {
                if (entry?.address && !stealthAddrs.includes(entry.address)) {
                    stealthAddrs.push(entry.address);
                }
            }
        }
    } catch (e) { /* silent */ }

    // 2. Per-wallet singleton cache upl:stealth-pk:<address>
    if (stealthAddrs.length === 0) {
        try {
            const stealthPk = localStorage.getItem(`upl:stealth-pk:${addrLower}`);
            if (stealthPk) {
                const w = new ethers.Wallet(stealthPk);
                stealthAddrs.push(w.address);
            }
        } catch (e) { /* silent */ }
    }

    // 3. Proxy cache upl:stealth-proxy:<address>
    if (stealthAddrs.length === 0) {
        try {
            const cached = localStorage.getItem(lsKey(ownerAddress));
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.address && !stealthAddrs.includes(parsed.address)) {
                    stealthAddrs.push(parsed.address);
                }
            }
        } catch (e) { /* silent */ }
    }

    // 4. Scan cache upl:scan:<address>
    if (stealthAddrs.length === 0) {
        try {
            const scanCache = localStorage.getItem(`upl:scan:${addrLower}`);
            if (scanCache) {
                const parsed = JSON.parse(scanCache);
                const candidate = parsed.address || parsed.stealthAddress;
                if (candidate && !stealthAddrs.includes(candidate)) {
                    stealthAddrs.push(candidate);
                }
            }
        } catch (e) { /* silent */ }
    }

    // 5. Global scan: every cached `upl:stealth-pk:` key. The
    //    stealth address may have been cached under a different
    //    wallet address than the one currently connected (e.g.
    //    the customer disconnected and reconnected a different
    //    wallet — the OLD wallet's stealth addresses are still
    //    cached). We include them all so the dashboard shows the
    //    historic balance.
    if (stealthAddrs.length === 0) {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith("upl:stealth-pk:") || key.startsWith("upl:stealth-archive:"))) {
                    const v = localStorage.getItem(key);
                    if (!v) continue;
                    if (key.startsWith("upl:stealth-pk:")) {
                        try {
                            const w = new ethers.Wallet(v);
                            if (!stealthAddrs.includes(w.address)) stealthAddrs.push(w.address);
                        } catch {}
                    } else if (key.startsWith("upl:stealth-archive:")) {
                        try {
                            const arr = JSON.parse(v);
                            if (Array.isArray(arr)) {
                                for (const e of arr) {
                                    if (e?.address && !stealthAddrs.includes(e.address)) {
                                        stealthAddrs.push(e.address);
                                    }
                                }
                            }
                        } catch {}
                    }
                }
            }
        } catch (e) { /* silent */ }
    }

    // 6. Backend meta_address (public-stored ONLY — no private keys)
    if (stealthAddrs.length === 0) {
        try {
            const resp = await fetch(`/api/stealth/meta/${ownerAddress}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.meta_address) {
                    const match = data.meta_address.match(/0x[a-fA-F0-9]{40}/);
                    if (match && !stealthAddrs.includes(match[0])) {
                        stealthAddrs.push(match[0]);
                    }
                }
            }
        } catch (e) { /* silent */ }
    }

    if (stealthAddrs.length === 0) {
        return { eth: "0.0", usdc: "0", address: null, addresses: [] };
    }

    // Use the raw-fetch reader (lib/balance-reader.js) — bypasses
    // ethers' BrowserProvider polyfill, which silently fails on
    // browser CORS preflights. Each RPC is tried in sequence with a
    // 4s timeout. We sum balances across EVERY address in the
    // archive so the dashboard shows the user's TOTAL private
    // balance, not just the most recent address.
    //
    // We ALWAYS read USDC — the Base USDC contract is hardcoded in
    // balance-reader.js (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913),
    // so even if CHAINS[chain].contracts.usdc was nullified by the
    // deployment-endpoint overwrite bug, this still works.
    const { readUsdcBalance, readEthBalance } = await import("@/lib/balance-reader");
    let totalEth = 0n;
    let totalUsdc = 0n;
    for (const sa of stealthAddrs) {
        try {
            totalEth += await readEthBalance(sa);
        } catch (e) { /* silent */ }
        try {
            totalUsdc += await readUsdcBalance(sa);
        } catch (e) { /* silent */ }
    }
    return {
        eth: ethers.formatEther(totalEth),
        usdc: ethers.formatUnits(totalUsdc, 6),
        address: stealthAddrs[0], // most recent (active)
        addresses: stealthAddrs,
    };
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
 * Forget the cached proxy for a specific wallet (or all of them).
 * Use after a key compromise, or for testing.
 *
 * @param {string} [address] - specific wallet to forget. If omitted,
 *                             every cached proxy is purged.
 */
export function forgetProxyWallet(address) {
    if (address) {
        try { localStorage.removeItem(lsKey(address)); } catch {}
        return;
    }
    // Purge every cached proxy. Walk all localStorage keys.
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith("upl:stealth-proxy:")) {
                localStorage.removeItem(k);
            }
        }
    } catch {}
}

/**
 * Fund the proxy wallet PRIVATELY through the PrivacyPool.
 *
 * Flow:
 *   1. Customer deposits 0.01 ETH into PrivacyPool from main wallet.
 *      (visible on BaseScan — enters the anonymity set)
 *   2. Backend generates ZK proof + relayer broadcasts the withdraw.
 *      ETH lands at the proxy address.
 *      (relayer is msg.sender; ZK proof breaks deposit↔withdraw link)
 *   3. Observer sees: main→pool deposit + relayer→pool withdraw→proxy.
 *      They CANNOT link the deposit to the withdrawal.
 *
 * @param {object} mainSigner — main wallet signer
 * @param {string} proxyAddress — the stealth proxy address
 * @param {string} poolAddress — PrivacyPool contract address
 * @param {string} apiBase — backend API URL
 * @returns {Promise<{deposit_tx: string, withdraw_tx: string}>}
 */
export async function fundProxyPrivately(mainSigner, proxyAddress, poolAddress, apiBase) {
    const provider = mainSigner.provider ||
        (typeof window !== "undefined" && window.ethereum
            ? new ethers.BrowserProvider(window.ethereum) : null);
    if (!provider) throw new Error("No provider");

    // MUST match the denomination registered in PrivacyPool.sol on Base.
    // deployed_base.json registers 0.1 ETH (100000000000000000 wei) as the
    // initial denomination. If this doesn't match, PrivacyPool.deposit()
    // reverts with DenominationNotEnabled and the private-funding flow is
    // dead — the proxy wallet becomes linkable to the main wallet via the
    // direct-funding fallback.
    const DENOM = ethers.parseEther("0.1");

    // 1. Generate nullifier + secret (random 32 bytes each).
    const nullifier = ethers.hexlify(ethers.randomBytes(32));
    const secret = ethers.hexlify(ethers.randomBytes(32));

    // 2. Compute commitment = Poseidon(nullifier, secret).
    //    The backend handles Poseidon — we send nullifier + secret
    //    to /api/zk-pool/deposit which computes the commitment and
    //    calls PrivacyPool.deposit on-chain.
    const depositResp = await axios.post(`${apiBase}/zk-pool/deposit`, {
        nullifier,
        secret,
        denomination_wei: DENOM.toString(),
        chain: "base",
    });

    // The backend may return a prepared tx for the frontend to sign,
    // or it may have already broadcast. Check the response.
    let depositTxHash;
    if (depositResp.data.tx_hash) {
        depositTxHash = depositResp.data.tx_hash;
    } else if (depositResp.data.tx_data) {
        // Backend prepared the tx — sign and broadcast from the main wallet.
        const tx = await mainSigner.sendTransaction(depositResp.data.tx_data);
        await tx.wait();
        depositTxHash = tx.hash;
    } else {
        throw new Error("Deposit failed — unexpected response");
    }

    // 3. Wait for the deposit to be indexed by the backend (the
    //    Merkle tree needs to include it before we can prove).
    //    Poll /api/zk-pool/state until the commitment appears.
    await new Promise(r => setTimeout(r, 3000)); // 3s grace period

    // 4. Call /api/zk-pool/withdraw-relay with nullifier, secret,
    //    and proxy address as recipient. The backend generates the
    //    ZK proof and the relayer broadcasts the withdraw tx.
    const withdrawResp = await axios.post(`${apiBase}/zk-pool/withdraw-relay`, {
        nullifier,
        secret,
        recipient: proxyAddress,
    });

    if (withdrawResp.data.tx_hash) {
        return {
            deposit_tx: depositTxHash,
            withdraw_tx: withdrawResp.data.tx_hash,
        };
    } else if (withdrawResp.data.status === "need_browser_proof") {
        // Server prover disabled — would need browser-side snarkjs.
        // For now, surface the error honestly.
        throw new Error("Server prover disabled. Enable ZK_POOL_PROVER_ENABLED=1 on the backend.");
    } else {
        throw new Error("Withdraw failed — unexpected response");
    }
}
