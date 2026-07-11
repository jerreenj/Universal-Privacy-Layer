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
        // Update each EVM chain's contracts with real addresses where
        // deployed. CRITICAL: PRESERVE the existing fields (notably
        // `usdc`) by spreading `CHAINS[key].contracts` first, then
        // overlaying the deployment map. The previous code REPLACED
        // the contracts object, erasing the `usdc` field — which
        // made USDC reads return 0 even when the wallet held USDC.
        if (evm && typeof evm === "object") {
          for (const [key, info] of Object.entries(evm)) {
            if (CHAINS[key] && info?.deployed) {
              CHAINS[key].contracts = {
                ...(CHAINS[key].contracts || {}),  // preserve usdc + everything else
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
  //
  // Per-wallet EVM connect: window.ethereum may be a single provider
  // (the active EIP-1193 injector) OR an array of providers when the
  // user has both MetaMask and Rabby installed. For MetaMask we
  // pick the provider tagged isMetaMask; for Rabby we pick the
  // provider tagged isRabby. This way clicking "Rabby" in the
  // picker routes the eth_requestAccounts prompt to Rabby, not
  // MetaMask.
  //
  // ORDERING MATTERS: the Sui wallet detector + the EVM provider
  // helper MUST be declared ABOVE the connect functions that
  // reference them in their `useCallback(..., [dep])` dependency
  // arrays. React evaluates the deps array synchronously during
  // render — if the dep is in the Temporal Dead Zone, render
  // throws a ReferenceError and the whole app shows a black screen.
  // (This was the actual cause of the pilot's "black screen"
  // report: detectAnySuiWallet was declared below connectSui, and
  // connectSui's deps array crashed the React tree on first mount.)
  const pickEvmProvider = useCallback((preferTag) => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    const e = window.ethereum;
    // Single-provider mode (most common). Match the tag if provided.
    if (!Array.isArray(e.providers)) {
      if (!preferTag) return e;
      if (preferTag === "isMetaMask" && e.isMetaMask) return e;
      if (preferTag === "isRabby"    && e.isRabby)    return e;
      return null;
    }
    // Multi-provider mode (EIP-6963). Find the matching provider in
    // the array — never the array itself.
    const pp = e.providers.find(p => p && p[preferTag]);
    return pp || null;
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // Generous Sui-wallet detection — any of the major wallet extensions
  // the Sui dApp Kit and Wallet Standard recognize. We probe a list
  // of injection points the wallets use to publish themselves on
  // window. The first one that's a real object with at least one
  // connection method is our wallet.
  //
  // Each candidate is a known property name on window. Older wallets
  // used a single property (window.suiWallet, window.suiet); newer
  // ones follow the Wallet Standard and don't inject anything —
  // announcing themselves via events. We handle both by checking the
  // legacy injections here. If your wallet isn't on this list, an
  // extension PR is one line away.
  const SUI_WALLET_PROBES = [
    // Mysten Labs' official Sui Wallet (the canonical web wallet).
    "suiWallet",
    // Suiet — popular Chinese-developed Sui extension. The pilot's
    // installed wallet — must be on this list.
    "suiet",
    // Martian — early Sui wallet, still installed by some users.
    "martian",
    // Ethos (alternate name history).
    "ethos",
    "ethosWallet",
    // Nightly — multi-chain wallet with Sui support.
    "nightly",
    // Surf — Sui-native DEX wallet.
    "surfWallet",
    // Fewcha — early Sui extension, still around.
    "fewcha",
    // Glass — Bware Labs' Sui extension.
    "glassWallet",
    // Trust (Bifrost) — multi-chain wallet with Sui support.
    "trustWallet",
    "bistowWallet",
    // ABC Wallet / Slush (rebrand) — newer Sui-first wallets.
    "abcWallet",
    "slushWallet",
    // Legacy single injection — Mysten Labs pre-Wallet-Standard.
    "sui",
  ];

  /**
   * detectAnySuiWallet() →
   *   { key, api } | null
   *
   * Returns the first viable Sui wallet from the probe list. `key`
   * is the property name so the toast can name it ("Suiet detected",
   * "Phantom-like: Sui Wallet", etc.). `api` is the window property
   * itself — the object whose methods we call to authenticate.
   */
  const detectAnySuiWallet = useCallback(() => {
    if (typeof window === "undefined") return null;
    for (const key of SUI_WALLET_PROBES) {
      const api = window[key];
      if (!api) continue;
      // The object might be injected but not yet fully loaded (rare
      // race during extension boot). We check for at least one of the
      // known connection methods so a stub doesn't sneak through.
      if (
        typeof api === "object" &&
        (typeof api.requestPermissions === "function" ||
          typeof api.connect === "function" ||
          typeof api.hasPermissions === "function")
      ) {
        return { key, api };
      }
    }
    return null;
  }, []);

  const connectEVM = useCallback(async () => {
    setChain("base");
    setBalance(null);
    setUsdcBalance(null);
    setHiddenBalance(null);

    const provider = pickEvmProvider("isMetaMask");
    if (!provider) {
      toast.error("MetaMask not detected. Install the MetaMask extension to connect.");
      return;
    }
    setConnecting(true);
    let connectedAddress = null;
    try {
      // We try TWO MetaMask RPCs in sequence so the popup is forced
      // even on dApps MetaMask has previously authorized under
      // "connected sites" — there's no public-API for "force a re-
      // auth popup" on MetaMask, but calling wallet_requestPermissions
      // is the closest match (it pops for any ungranted permission;
      // for granted ones, MetaMask queues it for the next connect).
      //
      // Most pilots on a fresh install hit eth_requestAccounts →
      // popup → tap → connected. Returning pilots on a previously-
      // trusted dApp hit eth_requestAccounts → silent re-auth →
      // connected without a popup, so we attempt
      // wallet_requestPermissions next which forces it.
      let accounts = null;
      try {
        accounts = await provider.request({ method: "eth_requestAccounts" });
      } catch {}
      if (!accounts || accounts.length === 0) {
        try {
          await provider.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
          });
          accounts = await provider.request({ method: "eth_accounts" });
        } catch {}
      }
      if (!accounts || accounts.length === 0) throw new Error("No accounts exposed");
      const { ethers } = await import("ethers");
      const browserProvider = new ethers.BrowserProvider(provider);
      try { browserProvider.provider = provider; } catch {}
      setAddress(accounts[0]);
      setSigner(await browserProvider.getSigner());
      connectedAddress = accounts[0];
      // After MetaMask signs us in, force MetaMask to be on Base so
      // any subsequent balance / USDC read is correct on the chain
      // the customer just picked. MetaMask may already be on Base
      // (no-op) or on Ethereum mainnet / Arbitrum / etc — in which
      // case the switch fires and MetaMask pops a small "switch
      // chain to Base?" confirmation.
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAINS.base.chainId }],
        });
      } catch (e) {
        if (e?.code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CHAINS.base.chainId,
              chainName: CHAINS.base.name,
              rpcUrls: [CHAINS.base.rpcUrl],
              nativeCurrency: { name: CHAINS.base.symbol, symbol: CHAINS.base.symbol, decimals: 18 },
            }],
          });
        }
      }
    } catch (e) {
      if (!connectedAddress) {
        if (e?.code === 4001) toast.error("MetaMask connection request was cancelled");
        else toast.error("MetaMask connection failed");
      } else {
        console.warn("MetaMask connect() threw after authorization:", e);
      }
    }
    setConnecting(false);
  }, [pickEvmProvider]);

  const connectRabbyFn = useCallback(async () => {
    setChain("base");
    setBalance(null);
    setUsdcBalance(null);
    setHiddenBalance(null);

    const provider = pickEvmProvider("isRabby");
    if (!provider) {
      toast.error("Rabby not detected. Install the Rabby extension to connect.");
      return;
    }
    setConnecting(true);
    let connectedAddress = null;
    try {
      // Same pattern as connectEVM: try eth_requestAccounts first,
      // fall back to wallet_requestPermissions if it returns nothing
      // (Rabby caches trusted-dApp state).
      let accounts = null;
      try {
        accounts = await provider.request({ method: "eth_requestAccounts" });
      } catch {}
      if (!accounts || accounts.length === 0) {
        try {
          await provider.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
          });
          accounts = await provider.request({ method: "eth_accounts" });
        } catch {}
      }
      if (!accounts || accounts.length === 0) throw new Error("No accounts exposed");
      const { ethers } = await import("ethers");
      const browserProvider = new ethers.BrowserProvider(provider);
      try { browserProvider.provider = provider; } catch {}
      setAddress(accounts[0]);
      setSigner(await browserProvider.getSigner());
      connectedAddress = accounts[0];
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAINS.base.chainId }],
        });
      } catch (e) {
        if (e?.code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CHAINS.base.chainId,
              chainName: CHAINS.base.name,
              rpcUrls: [CHAINS.base.rpcUrl],
              nativeCurrency: { name: CHAINS.base.symbol, symbol: CHAINS.base.symbol, decimals: 18 },
            }],
          });
        }
      }
    } catch (e) {
      if (!connectedAddress) {
        if (e?.code === 4001) toast.error("Rabby connection request was cancelled");
        else toast.error("Rabby connection failed");
      } else {
        console.warn("Rabby connect() threw after authorization:", e);
      }
    }
    setConnecting(false);
  }, [pickEvmProvider]);

  const connectSolana = useCallback(async () => {
    // Picking Phantom means Solana is the active chain. Clear stale
    // EVM balances so the dashboard's refresh hits Solana RPC, not
    // a cached Base state.
    setChain("solana");
    setBalance(null);
    setUsdcBalance(null);
    setHiddenBalance(null);

    const phantom = window.phantom?.solana ?? window.solana;
    if (!phantom || !phantom.isPhantom) {
      toast.error("Phantom not detected. Install the Phantom browser extension to connect.");
      return;
    }
    setConnecting(true);
    let connectedPubkey = null;
    // Phantom's onlyIfTrusted:false forces the connect popup every
    // time, regardless of whether the dApp was previously trusted.
    // This is what makes Connect Wallet actually show the signing
    // UI rather than silently reusing the cached authorization.
    try {
      const resp = await phantom.connect({ onlyIfTrusted: false });
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
      // even when connect() promise rejected. We silently succeed
      // in that case so the user doesn't see a "Connection failed"
      // toast when, in fact, the wallet handed us a public key.
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
        if (e?.code === 4001 || /user rejected|cancelled/i.test(String(e?.message || ""))) {
          // User explicitly declined the popup — don't toast (no
          // action needed; the picker stays open for retry).
        } else {
          // Real failure (not a benign re-auth race): surface it.
          toast.error("Phantom connection failed");
          console.warn("Phantom connect() failed:", e);
        }
      } else {
        console.warn("Phantom connect() threw after auth, used publicKey fallback:", e);
      }
    }
    setConnecting(false);
  }, []);

  const connectSui = useCallback(async () => {
    setChain("sui");
    setBalance(null);
    setUsdcBalance(null);
    setHiddenBalance(null);

    // Find ANY Sui wallet on the page. The probe list covers the
    // dozen-or-so Sui extensions currently shipping, so pilots with
    // Suiet/Martian/Ethos/Nightly/Surf/Fewcha/Glass/Trust/ABC etc.
    // get a working gesture.
    const found = detectAnySuiWallet();
    if (!found) {
      toast.error(
        "No Sui wallet detected. Install a Sui browser extension " +
        "(Sui Wallet, Suiet, Martian, Ethos, Nightly, Surf, Fewcha, " +
        "Glass, Trust, or ABC Wallet)."
      );
      return;
    }
    setConnecting(true);
    let connectedAddress = null;
    // We try the wallet's connection methods IN ORDER:
    //   1) requestPermissions() if it exists — surfaces the popup
    //   2) connect()           if it exists — surfaces the popup in
    //      some wallets (Mist-en / Wallet Standard adapters)
    //   3) getAccounts()       to discover the address — this is the
    //      canonical read for Sui once permission is granted.
    // If the wallet already has us authorized, requestPermissions()
    // is a no-op (no popup pops) — that's fine; we proceed to read
    // the address and connect the dashboard.
    try {
      const api = found.api;
      if (typeof api.requestPermissions === "function") {
        await api.requestPermissions();
      } else if (typeof api.connect === "function") {
        await api.connect();
      }
      // Read the active address. Different wallets expose accounts
      // under different keys, so we try a handful.
      let accounts = null;
      if (typeof api.getAccounts === "function") {
        accounts = await api.getAccounts();
      } else if (typeof api.getAccount === "function") {
        accounts = [await api.getAccount()];
      } else if (typeof api.accounts === "function") {
        accounts = await api.accounts();
      } else if (Array.isArray(api.accounts)) {
        accounts = api.accounts;
      }
      if (!accounts || accounts.length === 0) throw new Error("No accounts exposed");
      const a0 = accounts[0];
      // Some wallets return a string, others a { address } object.
      const addr = typeof a0 === "string" ? a0 : (a0?.address ?? a0?.toString?.() ?? null);
      if (!addr) throw new Error("Sui wallet returned no address");
      setAddress(addr);
      setSigner(api);
      connectedAddress = addr;
    } catch (e) {
      if (!connectedAddress) {
        if (e?.code === 4001 || /user rejected|cancelled/i.test(String(e?.message || ""))) {
          // silent — user dismissed the popup
        } else {
          toast.error(`Sui wallet (${found.key}) connection failed`);
          console.warn("Sui connect threw:", e);
        }
      } else {
        console.warn("Sui connect threw after auth:", e);
      }
    }
    setConnecting(false);
  }, [detectAnySuiWallet]);

  // connectWallet dispatches to the right family based on the
  // currently-selected chain. The Landing page now also exposes the
  // three connect functions directly so the customer can pick a
  // family BEFORE the chain is locked in.
  const connectWallet = useCallback(() => {
    if (vm === VM.EVM) return connectEVM();
    if (vm === VM.SOLANA) return connectSolana();
    if (vm === VM.SUI) return connectSui();
  }, [vm, connectEVM, connectSolana, connectSui]);

  // The named-export alias the picker uses — actual implementation
  // lives in connectRabbyFn above so all four wallet connects share
  // the chain-switch + balance-reset prologue.
  const connectRabby = connectRabbyFn;

  /**
   * Detected wallets — surfaced to the Landing page so the wallet-
   * picker only shows options that are actually installed. Refreshed
   * on mount and on visibility change so an extension installed
   * while the tab was backgrounded appears immediately on next open.
   *
   * EVM detection is split per-wallet because the user's browser can
   * only have ONE active EIP-1193 provider at a time (modern wallets
   * announce themselves via the `is<Wallet>` flag on
   * window.ethereum). For Sui detection is intentionally GENEROUS —
   * any of ~12 known Sui wallet injections flips the picker to
   * "Detected", since the user just wants to sign in with whatever
   * wallet they happen to have installed.
   *
   * detectAnySuiWallet + SUI_WALLET_PROBES live in the function
   * scope ABOVE the connect functions so the useCallback(..., [dep])
   * arrays below don't hit a TDZ ReferenceError on first render.
   * (That crash was the cause of the pilot's black-screen report.)
   */
  const [availableWallets, setAvailableWallets] = useState({
    metamask: false, phantom: false, sui: false, suiName: null, rabby: false,
  });
  const detectWallets = useCallback(() => {
    if (typeof window === "undefined") {
      setAvailableWallets({
        metamask: false, phantom: false, sui: false, suiName: null, rabby: false,
      });
      return;
    }
    const e = window.ethereum;
    const suiFound = detectAnySuiWallet();
    setAvailableWallets({
      // MetaMask tags its provider. Some forks (e.g. MetaMask Flask)
      // only set isMetaMask on the active provider.
      metamask: !!(e && (e.isMetaMask || (Array.isArray(e.providers) &&
        e.providers.some(p => p?.isMetaMask)))),
      // Rabby tags itself similarly. EIP-6963 multi-injector puts
      // every wallet on `providers` so we can pick the right one.
      rabby: !!(e && (e.isRabby || (Array.isArray(e.providers) &&
        e.providers.some(p => p?.isRabby)))),
      phantom: !!(window.phantom?.solana ?? window.solana?.isPhantom),
      // Any Sui wallet (suiet, martian, ethos, nightly, surf, fewcha,
      // glass, trust/abc/slush, suiWallet, sui). The label is the
      // first probe that hits.
      sui:     !!suiFound,
      suiName: suiFound ? suiFound.key : null,
    });
  }, [detectAnySuiWallet]);
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

  // ── Provider helpers — used by all EVM balance fetches ────────────
  //
  // ETHEREUM-SPECIFIC. MetaMask/Rabby's BrowserProvider knows the
  // exact chain the user's wallet is on (its current network) and
  // routes the call through ITS authenticated RPC. We prefer this
  // over the public CHAINS[chain].rpcUrl because, in the pilot's
  // case, the wallet was on Ethereum mainnet while our state said
  // 'base' — and reading "0x833589...USDC on Base" through an
  // Ethereum RPC returned 0 even though the user's wallet had USDC.
  // Using the wallet's own RPC makes the read chain-aware.
  const getEvmReadProvider = useCallback(async () => {
    const { ethers } = await import("ethers");
    if (typeof window !== "undefined" && window.ethereum) {
      try {
        const provider = window.ethereum;
        return new ethers.BrowserProvider(provider);
      } catch {}
    }
    // Fallback: public RPC for the chain the user is on. Less
    // reliable (chain-mismatch risk) but never fully offline.
    return new ethers.JsonRpcProvider(CHAINS[chain]?.rpcUrl);
  }, [chain]);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    try {
      if (vm === VM.EVM) {
        const provider = await getEvmReadProvider();
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
  }, [address, chain, vm, solConn, getEvmReadProvider]);

  // Fetch USDC stablecoin balance — the PRIMARY number shown in the
  // Dashboard hero. Stablecoin balances are what people actually hold,
  // so we surface them above the volatile native-token balance.
  //
  // We use a RAW `fetch()` JSON-RPC call (see lib/balance-reader.js)
  // to read ERC-20 balanceOf. ethers v6's JsonRpcProvider has been
  // observed silently failing on browser CORS preflights for some
  // Base RPCs (returning null/0 instead of throwing), which is why
  // a raw fetch — using the browser's native HTTP layer — is more
  // reliable. We try 4 CORS-friendly RPCs in sequence, and the FIRST
  // one that returns a non-zero balance wins (proves it's on the
  // right chain and talking to the right contract).
  //
  // SIDE NOTE on precision: this used to call
  //   parseFloat(formatted).toFixed(2)
  // which truncated `6.789012 USDC` to `6.79` and rendered sub-cent
  // dust as zero. Now we use `formatExactBalance(raw, decimals)` —
  // keeps all 6 decimals (or 18 on BNB BEP20), trims only trailing
  // zeros.
  const fetchUsdcBalance = useCallback(async () => {
    if (!address) { setUsdcBalance(null); return; }
    try {
      if (vm === VM.EVM) {
        const usdcAddr = CHAINS[chain]?.contracts?.usdc;
        // Don't bail out if CHAINS[chain].contracts.usdc is missing —
        // the deploy-overwrite bug in this WalletContext can null it
        // out. readUsdcBalance from balance-reader.js hardcodes the
        // Base USDC contract, so we just press on.
        if (!usdcAddr && chain !== "base") { setUsdcBalance(null); return; }
        let decimals = (chain === "bnb") ? 18 : 6;
        // Raw-fetch reads across a list of CORS-friendly Base public
        // RPCs. The first non-zero return wins.
        const { readUsdcBalance } = await import("@/lib/balance-reader");
        // For Base, balance-reader.js hardcodes the USDC contract —
        // pass address to override for non-Base chains in the future.
        const erc20Balances = await readUsdcBalance(address);
        setUsdcBalance({
          formatted: formatExactBalance(erc20Balances, decimals),
          symbol: "USDC",
          address: usdcAddr || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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
          let totalRaw = "0";
          for (const ta of resp.value) {
            const amt = ta.account.data?.parsed?.info?.tokenAmount?.amount;
            if (amt) {
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
          setUsdcBalance({ formatted: "0", symbol: "USDC", address: usdcMint, chain: "solana" });
        }
      } else {
        setUsdcBalance(null);
      }
    } catch {
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
