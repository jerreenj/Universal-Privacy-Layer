import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { ethers } from 'ethers';
import { ApiService, StorageService } from '../services/api';

// Chain configuration
export const CHAINS = {
  base: { name: 'Base', color: '#0052FF', symbol: 'ETH', chainId: '0x2105', rpc: 'https://mainnet.base.org' },
  arbitrum: { name: 'Arbitrum', color: '#28A0F0', symbol: 'ETH', chainId: '0xa4b1', rpc: 'https://arb1.arbitrum.io/rpc' },
  polygon: { name: 'Polygon', color: '#8247E5', symbol: 'POL', chainId: '0x89', rpc: 'https://rpc-mainnet.matic.quiknode.pro' },
  optimism: { name: 'Optimism', color: '#FF0420', symbol: 'ETH', chainId: '0xa', rpc: 'https://mainnet.optimism.io' },
  bnb: { name: 'BNB Chain', color: '#F3BA2F', symbol: 'BNB', chainId: '0x38', rpc: 'https://bsc-dataseed1.binance.org/' },
  avalanche: { name: 'Avalanche', color: '#E84142', symbol: 'AVAX', chainId: '0xa86a', rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  hyperliquid: { name: 'Hyperliquid', color: '#00FF88', symbol: 'HYPE', chainId: '0x3e7', rpc: 'https://rpc.hyperliquid.xyz/evm' },
};

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chain, setChain] = useState<keyof typeof CHAINS>('base');
  const [balance, setBalance] = useState<string | null>(null);
  const [hiddenBalance, setHiddenBalance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [privacyWallet, setPrivacyWallet] = useState<any>(null);

  // Load saved privacy wallet on init
  useEffect(() => {
    StorageService.getPrivacyWallet().then(wallet => {
      if (wallet) setPrivacyWallet(wallet);
    });
  }, []);

  const connect = useCallback(async (connector: any) => {
    setLoading(true);
    try {
      // Web3Modal integration - connector comes from @web3modal/react-native
      if (connector) {
        const accounts = await connector.enable();
        if (accounts.length > 0) {
          setAddress(accounts[0]);
          return true;
        }
      }
      throw new Error('No accounts');
    } catch (error: any) {
      Alert.alert('Connection Failed', error.message || 'Could not connect wallet');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setBalance(null);
    setHiddenBalance(null);
  }, []);

  const switchChain = useCallback((newChain: keyof typeof CHAINS) => {
    setChain(newChain);
    setBalance(null);
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const chainConfig = CHAINS[chain];
      const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
      const bal = await provider.getBalance(address);
      setBalance(ethers.formatEther(bal));
    } catch (error) {
      console.error('Balance fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [address, chain]);

  const fetchHiddenBalance = useCallback(async () => {
    if (!address) return;
    try {
      const data = await ApiService.getHiddenBalance(address);
      setHiddenBalance(data);
    } catch (error) {
      console.error('Hidden balance fetch error:', error);
    }
  }, [address]);

  const generateStealthAddress = useCallback(async () => {
    if (!privacyWallet) {
      Alert.alert('Error', 'Set up privacy wallet first');
      return null;
    }
    try {
      const result = await ApiService.generateStealthAddress(
        privacyWallet.spending_public_key,
        privacyWallet.viewing_public_key
      );
      await StorageService.addStealthAddress({
        ...result,
        chain,
        createdAt: new Date().toISOString(),
      });
      return result;
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate stealth address');
      return null;
    }
  }, [privacyWallet, chain]);

  const setupPrivacyWallet = useCallback(async (mainSeed: string, privacySeed: string) => {
    try {
      // Derive keys from seeds
      const mainWallet = ethers.Wallet.fromPhrase(mainSeed);
      const privacyWalletDerived = ethers.Wallet.fromPhrase(privacySeed);
      
      const wallet = {
        main_address: mainWallet.address,
        spending_private_key: mainWallet.privateKey,
        spending_public_key: mainWallet.publicKey,
        viewing_private_key: privacyWalletDerived.privateKey,
        viewing_public_key: privacyWalletDerived.publicKey,
      };
      
      await StorageService.savePrivacyWallet(wallet);
      setPrivacyWallet(wallet);
      return wallet;
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to setup privacy wallet');
      return null;
    }
  }, []);

  // Refresh balance when chain changes
  useEffect(() => {
    if (address) {
      fetchBalance();
      fetchHiddenBalance();
    }
  }, [address, chain, fetchBalance, fetchHiddenBalance]);

  return {
    address,
    chain,
    balance,
    hiddenBalance,
    loading,
    privacyWallet,
    connect,
    disconnect,
    switchChain,
    fetchBalance,
    fetchHiddenBalance,
    generateStealthAddress,
    setupPrivacyWallet,
    setAddress,
  };
}

export function useTransactions(address: string | null) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const data = await ApiService.getTransactionHistory(address);
      setTransactions(data.transactions || []);
    } catch (error) {
      console.error('Transaction history error:', error);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { transactions, loading, refresh: fetch };
}
