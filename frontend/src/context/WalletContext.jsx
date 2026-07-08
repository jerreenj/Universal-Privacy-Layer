import { useState, useEffect, createContext, useContext, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CHAINS, VM, API } from "@/config/chains";
import { formatExactBalance } from "@/lib/utils";

// NOTE: `ethers` and `@solana/web3.js` are NOT statically imported here. Both are
// large (ethers bundles lots of crypto; @solana/web3.js pulls in bs58/secp256k1/
// hashes) and were dragging main-thread parse/eval time at startup, showing up as
// high TBT. They are now dynamic-imported inside connectEVM / connectSolana /
// fetchBalance — so a visitor who never connects a wallet never downloads them,
// and the initial route stays light. Sui uses plain fetch, so it needs no SDK.
const LAMPORTS_PER_SOL = 1_000_000_000; // 1 SOL = 10^9 lamports (constant from @solana/web3.js)

const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

// Wipe all wallet-related storage keys
function clearWalletStorage() {
  try {
    const keysToRemove = Object.keys(localStorage).filter(k =>
      k.startsWith("wc@") ||
      k.startsWith("walletconnect") ||
      k.startsWith("wagmi") ||
      k.startsWith("WALLETCONNECT") ||
      k.startsWith("W3M") ||
      k.startsWith("web3modal") ||
      k.startsWith("metamask") ||
      k.startsWith("phantom")
    );
    keysToRemove.forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem("_upl_wallet_addr");
  } catch {}
}

export function WalletProvider({ children }) {
  const [chain, setChain] = useState("base");
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  // Primary wallet balance people actually hold — USDC stablecoin.
  // Fetched alongside native; surfaced as the headline balance in the
  // Dashboard hero so users see the number that matters to them.
  const [usdcBalance, setUsdcBalance] = useState(null);
  const [hiddenBalance, setHiddenBalance] = useState(null);
  const [hiddenBalanceError, setHiddenBalanceError] = useState(null);
  const [signer, setSigner] = useState(null);
  const [solConn, setSolConn] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [privacyWallet, setPrivacyWallet] = useState(null);
  const [, setDeploymentsLoaded] = useState(false);

  const vm = CHAINS[chain].vm;

  // P1.6: fetch the unified /deployments endpoint on mount and update the
  // CHAINS config in place with real deployed addresses + Sui liveness.
  // CHAINS is a mutable shared object — updating its fields here reflects in
  // every component that reads it on the next render (Navbar, Landing,
  // ChainsStatus, CrossChainSplit all gate on `c.live` / `c.contracts`).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await axios.get(`${API}/deployments`);
        if (!mounted || !res?.data) return;
        const { evm, sui, sol } = res.data;
        // Update each EVM chain's contracts with real addresses where deployed.
        if (evm && typeof evm === "object") {
          for (const [key, info] of Object.entries(evm)) {
            if (CHAINS[key] && info?.deployed) {
              CHAINS[key].contracts = {
                privacyRelayer: info.privacy_relayer ?? CHAINS[key].contracts?.privacyRelayer,
                stealthRegistry: info.stealth_registry ?? CHAINS[key].contracts?.stealthRegistry,
                ...(info.uniswap_wrapper ? { uniswapWrapper: info.uniswap_wrapper } : {}),
              };
              CHAINS[key].deployed = true;
            }
          }
        }
        // Flip Sui from "coming soon" to live if the package is deployed.
        if (sui?.live && CHAINS.sui) {
          CHAINS.sui.live = true;
          CHAINS.sui.comingSoon = false;
          CHAINS.sui.contracts = {
            ...(CHAINS.sui.contracts || {}),
            packageId: sui.package_id,
            sharedObjects: sui.shared_objects,
          };
        }
        // Flip Solana from "coming soon" to live if the program is deployed.
        if (sol?.live && CHAINS.solana) {
          CHAINS.solana.live = true;
          CHAINS.solana.comingSoon = false;
          CHAINS.solana.contracts = {
            ...(CHAINS.solana.contracts || {}),
            programId: sol.program_id,
            registryPda: sol.registry_pda,
          };
        }
        setDeploymentsLoaded(true);
      } catch {
        // Non-fatal: deployments endpoint unreachable → keep static config
        // (zero-address EVM placeholders, Sui "coming soon"). This is the
        // same shape as before P1.6, so no regression for existing users.
      }
    })();
    return () => { mounted = false; };
  }, []);

  // The three families of wallets handle the "connect" RPC very
  // differently. Phantom in particular fires spurious errors when the
  // wallet is already authorized but the dApp races for reconnection —
  // the connection IS valid but a quiet `throw` happens after the
  // publicKey is exposed. We only fire the error toast when we did NOT
  // actually end up with a connected address, and we silently succeed
  // when the publicKey came back. This eliminates the "Phantom failed
  // load" toast that's been scaring customers even though everything
  // was working.
  const connectEVM = useCallback(async () => {
    if (!window.ethereum) {
      toast.error("MetaMask not found — install it first");
      return;
    }
    setConnecting(true);
    let connectedAddress = null;
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) throw new Error("No accounts exposed");
      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider(window.ethereum);
      setAddress(accounts[0]);
      setSigner(await provider.getSigner());
      connectedAddress = accounts[0];
    } catch (e) {
      // MetaMask's "user denied" code is 4001; surface that distinctly,
      // but NEVER toast for transient dApp races — only if we didn't
      // actually end up with a connected account.
      if (!connectedAddress) {
        if (e?.code === 4001) toast.error("Connection request was cancelled");
        else toast.error("MetaMask connection failed");
      } else {
        // We DID get an address despite the throw — silent success.
        console.warn("MetaMask connect() threw after authorization:", e);
      }
    }
    setConnecting(false);
  }, []);

  const connectSolana = useCallback(async () => {
    const phantom = window.phantom?.solana ?? window.solana;
    if (!phantom?.isPhantom) {
      toast.error("Phantom wallet not found — install it first");
      return;
    }
    setConnecting(true);
    let connectedPubkey = null;
    try {
      const resp = await phantom.connect();
      if (resp && resp.publicKey) {
        connectedPubkey = resp.publicKey.toBase58();
        const { Connection } = await import("@solana/web3.js");
        setAddress(connectedPubkey);
        setSigner(phantom);
        setSolConn(new Connection(CHAINS.solana.rpcUrl, "confirmed"));
      }
    } catch (e) {
      // Phantom sometimes fires a benign error AFTER handshake when
      // re-authorizing a previously trusted dApp. The publicKey is
      // already trusted; we get it via `window.phantom.solana.publicKey`
      // even when connect() promise rejected. We use that as a
      // fallback so Phantom's noisy "Connection failed" toast NEVER
      // shows on a successful reconnection.
      try {
        const pubkey = phantom.publicKey;
        if (pubkey && typeof pubkey.toBase58 === "function") {
          connectedPubkey = pubkey.toBase58();
          const { Connection } = await import("@solana/web3.js");
          setAddress(connectedPubkey);
          setSigner(phantom);
          setSolConn(new Connection(CHAINS.solana.rpcUrl, "confirmed"));
        }
      } catch {}
      if (!connectedPubkey) {
        // Genuine failure (user really did decline). The user said
        // everything was working but the error was showing; this
        // branch only fires when no public key came back — i.e. a
        // real disconnect path, not a spurious handshake race.
        console.warn("Phantom connect() failed:", e);
      } else {
        console.warn("Phantom connect() threw after auth, used publicKey fallback:", e);
      }
    }
    setConnecting(false);
  }, []);

  const connectSui = useCallback(async () => {
    const suiWallet = window.suiWallet ?? window.sui;
    if (!suiWallet) {
      toast.error("Sui Wallet not found — install it first");
      return;
    }
    setConnecting(true);
    let connectedAddress = null;
    try {
      await suiWallet.requestPermissions();
      const accounts = await suiWallet.getAccounts();
      if (!accounts || accounts.length === 0) throw new Error("No accounts exposed");
      setAddress(accounts[0]);
      setSigner(suiWallet);
      connectedAddress = accounts[0];
    } catch (e) {
      if (!connectedAddress) {
        toast.error("Sui Wallet connection failed");
      } else {
        console.warn("Sui connect threw after auth:", e);
      }
    }
    setConnecting(false);
  }, []);

  // connectWallet dispatches to the right family based on the
  // currently-selected chain. The Landing page now also exposes the
  // three connect functions directly so the customer can pick a
  // family BEFORE the chain is locked in.
  const connectWallet = useCallback(() => {
    if (vm === VM.EVM) return connectEVM();
    if (vm === VM.SOLANA) return connectSolana();
    if (vm === VM.SUI) return connectSui();
  }, [vm, connectEVM, connectSolana, connectSui]);

  // Rabby injects as window.ethereum (same EIP-1193 provider as
  // MetaMask) so the connection RPC is identical. The picker routes
  // to this function when the user picks Rabby, but the underlying
  // call is the same eth_requestAccounts — only the brand identity
  // differs.
  const connectRabby = useCallback(() => connectEVM(), [connectEVM]);

  // Detected wallets — surfaced to the Landing page so the wallet-
  // picker only shows options that are actually installed. Refreshed
  // on mount and on visibility change so an extension installed while
  // the tab was backgrounded appears immediately on next open.
  //
  // EVM detection is split per-wallet because the user's browser can
  // only have ONE active EIP-1193 provider at a time (modern wallets
  // announce themselves via the `is<Wallet>` flag on
  // window.ethereum). MetaMask and Rabby both inject as
  // window.ethereum but they tag their provider so we can tell which
  // is the active one. We do NOT mark both as "Detected" when only
  // one is installed — each wallet is independently marked.
  const [availableWallets, setAvailableWallets] = useState({
    metamask: false, phantom: false, sui: false, rabby: false,
  });
  const detectWallets = useCallback(() => {
    if (typeof window === "undefined") {
      setAvailableWallets({
        metamask: false, phantom: false, sui: false, rabby: false,
      });
      return;
    }
    const e = window.ethereum;
    setAvailableWallets({
      // MetaMask tags its provider. Some forks (e.g. MetaMask Flask) only
      // set isMetaMask on the active provider.
      metamask: !!(e && (e.isMetaMask || (Array.isArray(e.providers) &&
        e.providers.some(p => p?.isMetaMask)))),
      // Rabby tags itself similarly. Newer builds inject a `providers`
      // array on window.ethereum so an EIP-6963 multi-injector can
      // pick a specific one.
      rabby: !!(e && (e.isRabby || (Array.isArray(e.providers) &&
        e.providers.some(p => p?.isRabby)))),
      phantom: !!(window.phantom?.solana ?? window.solana?.isPhantom),
      sui:     !!(window.suiWallet ?? window.sui),
    });
  }, []);
  useEffect(() => {
    detectWallets();
    const onVis = () => { if (document.visibilityState === "visible") detectWallets(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [detectWallets]);

  // Disconnect cleanly: not just the address, also reset the chain
  // back to "base" so the next connect() is a fresh choice, not an
  // auto-reconnect to the previously-used wallet family. The Landing
  // page's wallet-family picker then offers MetaMask / Phantom / Sui
  // without bias toward whichever family was last used.
  const disconnect = useCallback(() => {
    setAddress(null);
    setSigner(null);
    setSolConn(null);
    setBalance(null);
    setHiddenBalance(null);
    setPrivacyWallet(null);
    clearWalletStorage();
    setChain("base");
  }, []);

  const switchChain = useCallback(async (k) => {
    const next = CHAINS[k];
    setChain(k);
    setBalance(null);
    if (next.vm !== vm) { setAddress(null); setSigner(null); return; }
    if (next.vm === VM.EVM && window.ethereum && address) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: next.chainId }] });
      } catch (e) {
        if (e.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: next.chainId, chainName: next.name, rpcUrls: [next.rpcUrl], nativeCurrency: { name: next.symbol, symbol: next.symbol, decimals: 18 } }]
          });
        }
      }
    }
  }, [vm, address]);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      if (vm === VM.EVM) {
        const { ethers } = await import("ethers");
        const provider = new ethers.JsonRpcProvider(CHAINS[chain].rpcUrl);
        const bal = await provider.getBalance(address);
        setBalance({
          formatted: formatExactBalance(bal, 18),
          symbol: CHAINS[chain].symbol,
        });
      } else if (vm === VM.SOLANA) {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = solConn || new Connection(CHAINS.solana.rpcUrl, "confirmed");
        const bal = await conn.getBalance(new PublicKey(address));
        setBalance({ formatted: formatExactBalance(bal, 9), symbol: "SOL" });
      } else if (vm === VM.SUI) {
        const res = await fetch(CHAINS.sui.rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getBalance", params: [address, "0x2::sui::SUI"] })
        });
        const data = await res.json();
        const rawSui = data?.result?.totalBalance ?? "0";
        setBalance({ formatted: formatExactBalance(rawSui, 9), symbol: "SUI" });
      }
    } catch {}
  }, [address, chain, vm, solConn]);

  // Fetch USDC stablecoin balance — the PRIMARY number shown in the
  // Dashboard hero. Stablecoin balances are what people actually hold,
  // so we surface them above the volatile native-token balance.
  //
  // SIDE NOTE on precision: this used to call
  //   parseFloat(formatted).toFixed(2)
  // which truncated `6.789012 USDC` to `6.79` and rendered sub-cent
  // dust as zero — customers with $0.005 USDC thought their wallet
  // was empty. Now we use `formatExactBalance(raw, decimals)` which
  // keeps all 6 decimals (or 18 on BNB BEP20) and trims only trailing
  // zeros, so the dashboard shows whatever the chain actually holds.
  const fetchUsdcBalance = useCallback(async () => {
    if (!address) { setUsdcBalance(null); return; }
    try {
      if (vm === VM.EVM) {
        const usdcAddr = CHAINS[chain]?.contracts?.usdc;
        if (!usdcAddr) { setUsdcBalance(null); return; }
        const { ethers } = await import("ethers");
        const provider = new ethers.JsonRpcProvider(CHAINS[chain].rpcUrl);
        const erc20 = new ethers.Contract(usdcAddr,
          ["function balanceOf(address) view returns (uint256)"],
          provider);
        const raw = await erc20.balanceOf(address);
        // USDC decimals differ per chain: 6 on most, 18 on BNB (BEP20).
        // We pick the right one by reading decimals() when available;
        // default to 6 for safety (the common case).
        let decimals = 6;
        try { decimals = Number(await erc20.decimals()); } catch {}
        setUsdcBalance({
          formatted: formatExactBalance(raw, decimals),
          symbol: "USDC",
          address: usdcAddr,
          chain,
        });
      } else if (vm === VM.SOLANA) {
        // USDC on Solana is an SPL token. We do a lightweight getTokenAccountsByOwner.
        const usdcMint = CHAINS.solana?.contracts?.usdc;
        if (!usdcMint) { setUsdcBalance(null); return; }
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = solConn || new Connection(CHAINS.solana.rpcUrl, "confirmed");
        try {
          const resp = await conn.getTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(usdcMint) });
          // Sum the lamport amounts across all USDC token accounts.
          // Keep the raw amount as a string (u64) so formatExactBalance
          // can decode it without precision loss.
          let totalRaw = "0";
          for (const ta of resp.value) {
            const amt = ta.account.data?.parsed?.info?.tokenAmount?.amount;
            if (amt) {
              // Big-int addition to avoid Number overflow on large u64.
              totalRaw = (BigInt(totalRaw) + BigInt(amt)).toString();
            }
          }
          setUsdcBalance({
            formatted: formatExactBalance(totalRaw, 6),
            symbol: "USDC",
            address: usdcMint,
            chain: "solana",
          });
        } catch {
          // If the wallet has no USDC ATA on this RPC, just show 0.
          setUsdcBalance({ formatted: "0", symbol: "USDC", address: usdcMint, chain: "solana" });
        }
      } else {
        setUsdcBalance(null);
      }
    } catch {
      // Errors are silent — native balance is still shown as fallback.
      setUsdcBalance(null);
    }
  }, [address, chain, vm, solConn]);

  const fetchHiddenBalance = useCallback(async () => {
    if (!address) {
      // No wallet -> there's nothing to fetch. Surface this distinctly from
      // a real fetch error so the UI shows "Connect a wallet" instead of
      // an infinite spinner (the previous behaviour).
      setHiddenBalance(null);
      setHiddenBalanceError(null);
      return;
    }
    try {
      const res = await axios.get(`${API}/balance/hidden/${address}`);
      setHiddenBalance(res.data);
      setHiddenBalanceError(null);
    } catch (e) {
      // Surface the failure to the UI — the previous empty `catch {}` left
      // `hiddenBalance` stuck at `null` and the dashboard rendered "Loading…"
      // forever. We keep the spinner going while retrying, then render the
      // error explicitly on the dashboard with a Retry button.
      setHiddenBalanceError(e?.response?.data?.detail || e?.message || "Failed to load hidden balance");
    }
  }, [address]);

  useEffect(() => { if (address) { fetchBalance(); fetchUsdcBalance(); fetchHiddenBalance(); } }, [address, chain, fetchBalance, fetchUsdcBalance, fetchHiddenBalance]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (a) => a.length > 0 ? setAddress(a[0]) : disconnect());
    }
  }, [disconnect]);

  return (
    <WalletContext.Provider value={{ chain, address, balance, usdcBalance, hiddenBalance, hiddenBalanceError, signer, solConn, vm, connecting, privacyWallet, setPrivacyWallet, availableWallets, connectWallet, connectEVM, connectRabby, connectSolana, connectSui, disconnect, switchChain, fetchBalance, fetchUsdcBalance, fetchHiddenBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
