import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'https://privacycloak.in/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Storage keys
const STORAGE_KEYS = {
  PRIVACY_WALLET: '@upl_privacy_wallet',
  STEALTH_ADDRESSES: '@upl_stealth_addresses',
  TRANSACTION_HISTORY: '@upl_tx_history',
};

// API Service
export const ApiService = {
  // Stealth addresses
  async generateStealthAddress(spendingKey: string, viewingKey: string) {
    const response = await api.post('/stealth/generate', {
      spending_public_key: spendingKey,
      viewing_public_key: viewingKey,
    });
    return response.data;
  },

  // Hidden balance
  async getHiddenBalance(address: string) {
    const response = await api.get(`/balance/hidden/${address}`);
    return response.data;
  },

  // Balance on chain
  async getBalance(address: string, chain: string) {
    const response = await api.get(`/balance/${chain}/${address}`);
    return response.data;
  },

  // Transaction history
  async getTransactionHistory(address: string, limit = 50) {
    const response = await api.get(`/transactions/history/${address}?limit=${limit}`);
    return response.data;
  },

  // Prepare split
  async prepareSplit(fromAddress: string, totalAmountWei: string, splits: any[]) {
    const response = await api.post('/split/prepare', {
      from_address: fromAddress,
      total_amount_wei: totalAmountWei,
      splits,
    });
    return response.data;
  },

  // ZKP verification
  async verifyZKP(proof: any, publicInputs: any[], proofType: string, chain: string) {
    const response = await api.post('/zkp/verify', {
      proof,
      public_inputs: publicInputs,
      proof_type: proofType,
      chain,
    });
    return response.data;
  },

  // Create receipt
  async createReceipt(data: any) {
    const response = await api.post('/receipt/create', data);
    return response.data;
  },

  // Get chains
  async getChains() {
    const response = await api.get('/v1/chains');
    return response.data;
  },

  // Developer API
  async createApiKey(ownerAddress: string, name: string, rateLimit = 100) {
    const response = await api.post('/developer/keys/create', {
      owner_address: ownerAddress,
      name,
      rate_limit: rateLimit,
    });
    return response.data;
  },

  async getApiUsage(ownerAddress: string) {
    const response = await api.get(`/developer/usage/${ownerAddress}`);
    return response.data;
  },

  // Encrypted messaging
  async sendEncryptedMessage(data: any) {
    const response = await api.post('/message/send', data);
    return response.data;
  },

  async getMessages(address: string) {
    const response = await api.get(`/message/inbox/${address}`);
    return response.data;
  },
};

// Local storage helpers
export const StorageService = {
  async savePrivacyWallet(wallet: any) {
    await AsyncStorage.setItem(STORAGE_KEYS.PRIVACY_WALLET, JSON.stringify(wallet));
  },

  async getPrivacyWallet() {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.PRIVACY_WALLET);
    return data ? JSON.parse(data) : null;
  },

  async saveStealthAddresses(addresses: any[]) {
    await AsyncStorage.setItem(STORAGE_KEYS.STEALTH_ADDRESSES, JSON.stringify(addresses));
  },

  async getStealthAddresses() {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.STEALTH_ADDRESSES);
    return data ? JSON.parse(data) : [];
  },

  async addStealthAddress(address: any) {
    const existing = await this.getStealthAddresses();
    existing.push(address);
    await this.saveStealthAddresses(existing);
  },

  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  },
};

export default api;
