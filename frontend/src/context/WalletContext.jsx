import { useState, useEffect, createContext, useContext, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CHAINS, VM, API } from "@/config/chains";

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
  const [hiddenBalance, setHiddenBalance] = useState(null);
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
        const { evm, sui } = res.data;
        // Update each EVM chain's contracts with real addresses where deployed.
        if (evm && typeof evm === "object") {
          for (const [key, info] of Object.entries(evm)) {
            if (CHAINS[key] && info?.deployed) {
              CHAINS[key].contracts = {
                privacyRelayer: info.privacy_relayer ?? CHAINS[key].contracts?.privacyRelayer,
                stealthRegistry: info.stealth_registry ?? CHAINS[key].contracts?.stealthRegistry,
                ...(info.uniswap_wrapper ? { uniswapWrapper: info.uniswap_wrapper } : {}),
              };
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
        setDeploymentsLoaded(true);
      } catch {
        // Non-fatal: deployments endpoint unreachable → keep static config
        // (zero-address EVM placeholders, Sui "coming soon"). This is the
        // same shape as before P1.6, so no regression for existing users.
      }
    })();
    return () => { mounted = false; };
  }, []);

  const connectEVM = useCallback(async () => {
    if (!window.ethereum) return toast.error("MetaMask not found — install it first");
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const { ethers } = await import("ethers");
      const provider = new ethers.BrowserProvider(window.ethereum);
      setAddress(accounts[0]);
      setSigner(await provider.getSigner());
      toast.success("Wallet connected");
    } catch { toast.error("Connection failed"); }
    setConnecting(false);
  }, []);

  const connectSolana = useCallback(async () => {
    const phantom = window.phantom?.solana ?? window.solana;
    if (!phantom?.isPhantom) return toast.error("Phantom wallet not found");
    setConnecting(true);
    try {
      const resp = await phantom.connect();
      const { Connection } = await import("@solana/web3.js");
      setAddress(resp.publicKey.toBase58());
      setSigner(phantom);
      setSolConn(new Connection(CHAINS.solana.rpcUrl, "confirmed"));
      toast.success("Wallet connected");
    } catch { toast.error("Connection failed"); }
    setConnecting(false);
  }, []);

  const connectSui = useCallback(async () => {
    const suiWallet = window.suiWallet ?? window.sui;
    if (!suiWallet) return toast.error("Sui Wallet not found");
    setConnecting(true);
    try {
      await suiWallet.requestPermissions();
      const accounts = await suiWallet.getAccounts();
      if (accounts.length === 0) throw new Error("No accounts");
      setAddress(accounts[0]);
      setSigner(suiWallet);
      toast.success("Wallet connected");
    } catch { toast.error("Connection failed"); }
    setConnecting(false);
  }, []);

  const connectWallet = useCallback(() => {
    if (vm === VM.EVM) return connectEVM();
    if (vm === VM.SOLANA) return connectSolana();
    if (vm === VM.SUI) return connectSui();
  }, [vm, connectEVM, connectSolana, connectSui]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setSigner(null);
    setBalance(null);
    setHiddenBalance(null);
    setPrivacyWallet(null);
    clearWalletStorage();
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
        setBalance({ formatted: parseFloat(ethers.formatEther(bal)).toFixed(6), symbol: CHAINS[chain].symbol });
      } else if (vm === VM.SOLANA) {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = solConn || new Connection(CHAINS.solana.rpcUrl, "confirmed");
        const bal = await conn.getBalance(new PublicKey(address));
        setBalance({ formatted: (bal / LAMPORTS_PER_SOL).toFixed(6), symbol: "SOL" });
      } else if (vm === VM.SUI) {
        const res = await fetch(CHAINS.sui.rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getBalance", params: [address, "0x2::sui::SUI"] })
        });
        const data = await res.json();
        setBalance({ formatted: ((parseInt(data?.result?.totalBalance ?? "0")) / 1e9).toFixed(6), symbol: "SUI" });
      }
    } catch {}
  }, [address, chain, vm, solConn]);

  const fetchHiddenBalance = useCallback(async () => {
    if (!address) return;
    try {
      const res = await axios.get(`${API}/balance/hidden/${address}`);
      setHiddenBalance(res.data);
    } catch {}
  }, [address]);

  useEffect(() => { if (address) { fetchBalance(); fetchHiddenBalance(); } }, [address, chain, fetchBalance, fetchHiddenBalance]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (a) => a.length > 0 ? setAddress(a[0]) : disconnect());
    }
  }, [disconnect]);

  return (
    <WalletContext.Provider value={{ chain, address, balance, hiddenBalance, signer, solConn, vm, connecting, privacyWallet, setPrivacyWallet, connectWallet, disconnect, switchChain, fetchBalance, fetchHiddenBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
