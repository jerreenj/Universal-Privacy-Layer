import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { ethers } from "ethers";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import axios from "axios";
import { toast } from "sonner";
import { CHAINS, VM, API } from "@/config/chains";

const WalletContext = createContext();
export const useWallet = () => useContext(WalletContext);

export function WalletProvider({ children }) {
  const [chain, setChain] = useState("base");
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState(null);
  const [hiddenBalance, setHiddenBalance] = useState(null);
  const [signer, setSigner] = useState(null);
  const [solConn, setSolConn] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [privacyWallet, setPrivacyWallet] = useState(null);

  const vm = CHAINS[chain].vm;

  const connectEVM = useCallback(async () => {
    if (!window.ethereum) return toast.error("MetaMask not found — install it first");
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      setAddress(accounts[0]);
      setSigner(await provider.getSigner());
      toast.success("MetaMask connected");
    } catch { toast.error("MetaMask connection failed"); }
    setConnecting(false);
  }, []);

  const connectSolana = useCallback(async () => {
    const phantom = window.phantom?.solana ?? window.solana;
    if (!phantom?.isPhantom) return toast.error("Phantom wallet not found");
    setConnecting(true);
    try {
      const resp = await phantom.connect();
      setAddress(resp.publicKey.toBase58());
      setSigner(phantom);
      setSolConn(new Connection(CHAINS.solana.rpcUrl, "confirmed"));
      toast.success("Phantom connected");
    } catch { toast.error("Phantom connection failed"); }
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
      toast.success("Sui Wallet connected");
    } catch { toast.error("Sui Wallet connection failed"); }
    setConnecting(false);
  }, []);

  const connectWallet = useCallback(() => {
    if (vm === VM.EVM) return connectEVM();
    if (vm === VM.SOLANA) return connectSolana();
    if (vm === VM.SUI) return connectSui();
  }, [vm, connectEVM, connectSolana, connectSui]);

  const disconnect = () => {
    setAddress(null);
    setSigner(null);
    setBalance(null);
    setHiddenBalance(null);
    setPrivacyWallet(null);
  };

  const switchChain = useCallback(async (k) => {
    const next = CHAINS[k];
    setChain(k);
    setBalance(null);
    if (next.vm !== vm) {
      setAddress(null);
      setSigner(null);
      return;
    }
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
        const provider = new ethers.JsonRpcProvider(CHAINS[chain].rpcUrl);
        const bal = await provider.getBalance(address);
        setBalance({ formatted: parseFloat(ethers.formatEther(bal)).toFixed(6), symbol: CHAINS[chain].symbol });
      } else if (vm === VM.SOLANA) {
        const conn = solConn || new Connection(CHAINS.solana.rpcUrl, "confirmed");
        const bal = await conn.getBalance(new PublicKey(address));
        setBalance({ formatted: (bal / LAMPORTS_PER_SOL).toFixed(6), symbol: "SOL" });
      } else if (vm === VM.SUI) {
        const res = await fetch(CHAINS.sui.rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getBalance", params: [address, "0x2::sui::SUI"] })
        });
        const data = await res.json();
        const mist = parseInt(data?.result?.totalBalance ?? "0");
        setBalance({ formatted: (mist / 1e9).toFixed(6), symbol: "SUI" });
      }
    } catch {}
  }, [address, chain, vm, solConn]);

  const fetchHiddenBalance = useCallback(async () => {
    if (!address) return;
    try {
      const res = await axios.get(`${API}/balance/hidden/${address}`);
      setHiddenBalance(res.data);
    } catch (e) {
      console.error("Hidden balance fetch error:", e);
    }
  }, [address]);

  useEffect(() => { if (address) { fetchBalance(); fetchHiddenBalance(); } }, [address, chain, fetchBalance, fetchHiddenBalance]);
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (a) => a.length > 0 ? setAddress(a[0]) : disconnect());
    }
  }, []);

  return (
    <WalletContext.Provider value={{ chain, address, balance, hiddenBalance, signer, solConn, vm, connecting, privacyWallet, setPrivacyWallet, connectWallet, disconnect, switchChain, fetchBalance, fetchHiddenBalance }}>
      {children}
    </WalletContext.Provider>
  );
}
