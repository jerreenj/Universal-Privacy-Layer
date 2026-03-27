import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'https://privacycloak.in/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

const STORAGE_KEYS = {
  PRIVACY_WALLET: '@upl_privacy_wallet',
  STEALTH_ADDRESSES: '@upl_stealth_addresses',
};

export const ApiService = {
  async generateStealthAddress(spendingKey, viewingKey) {
    const response = await api.post('/stealth/generate', {
      spending_public_key: spendingKey,
      viewing_public_key: viewingKey,
    });
    return response.data;
  },

  async getHiddenBalance(address) {
    const response = await api.get(`/balance/hidden/${address}`);
    return response.data;
  },

  async getBalance(address, chain) {
    const response = await api.get(`/balance/${chain}/${address}`);
    return response.data;
  },

  async getTransactionHistory(address, limit = 50) {
    const response = await api.get(`/transactions/history/${address}?limit=${limit}`);
    return response.data;
  },

  async getChains() {
    const response = await api.get('/v1/chains');
    return response.data;
  },
};

export const StorageService = {
  async savePrivacyWallet(wallet) {
    await AsyncStorage.setItem(STORAGE_KEYS.PRIVACY_WALLET, JSON.stringify(wallet));
  },

  async getPrivacyWallet() {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.PRIVACY_WALLET);
    return data ? JSON.parse(data) : null;
  },

  async saveStealthAddresses(addresses) {
    await AsyncStorage.setItem(STORAGE_KEYS.STEALTH_ADDRESSES, JSON.stringify(addresses));
  },

  async getStealthAddresses() {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.STEALTH_ADDRESSES);
    return data ? JSON.parse(data) : [];
  },

  async addStealthAddress(address) {
    const existing = await this.getStealthAddresses();
    existing.push(address);
    await this.saveStealthAddresses(existing);
  },

  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  },
};

export default api;
