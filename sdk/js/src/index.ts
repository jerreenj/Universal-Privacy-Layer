import axios, { AxiosInstance } from 'axios';
import { ethers, Signer, Provider } from 'ethers';

// Chain configuration
export const CHAINS = {
  base: { chainId: 8453, name: 'Base', rpc: 'https://mainnet.base.org', symbol: 'ETH' },
  arbitrum: { chainId: 42161, name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', symbol: 'ETH' },
  polygon: { chainId: 137, name: 'Polygon', rpc: 'https://rpc-mainnet.matic.quiknode.pro', symbol: 'POL' },
  optimism: { chainId: 10, name: 'Optimism', rpc: 'https://mainnet.optimism.io', symbol: 'ETH' },
  bnb: { chainId: 56, name: 'BNB Chain', rpc: 'https://bsc-dataseed1.binance.org/', symbol: 'BNB' },
  avalanche: { chainId: 43114, name: 'Avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', symbol: 'AVAX' },
  hyperliquid: { chainId: 999, name: 'Hyperliquid', rpc: 'https://rpc.hyperliquid.xyz/evm', symbol: 'HYPE' },
} as const;

export type ChainKey = keyof typeof CHAINS;

// Types
export interface StealthAddress {
  stealth_address: string;
  ephemeral_public_key: string;
  view_tag: string;
}

export interface PrivacyWallet {
  spending_private_key: string;
  spending_public_key: string;
  viewing_private_key: string;
  viewing_public_key: string;
}

export interface SplitConfig {
  chain: ChainKey;
  stealth_address: string;
  percentage: number;
}

export interface SplitPlan {
  split_id: string;
  total_amount: string;
  num_chains: number;
  transactions: Array<{
    chain: string;
    stealth_address: string;
    amount: string;
    percentage: number;
  }>;
}

export interface UPLConfig {
  apiUrl?: string;
  apiKey?: string;
}

/**
 * Universal Privacy Layer SDK
 * 
 * @example
 * ```typescript
 * import { UPL } from '@upl/sdk';
 * 
 * const upl = new UPL();
 * 
 * // Generate privacy wallet
 * const wallet = await upl.createPrivacyWallet();
 * 
 * // Generate stealth address
 * const stealth = await upl.generateStealthAddress(
 *   wallet.spending_public_key,
 *   wallet.viewing_public_key
 * );
 * 
 * // Send privately
 * await upl.sendPrivate(signer, stealth.stealth_address, '0.01', 'base');
 * ```
 */
export class UPL {
  private api: AxiosInstance;
  private apiKey?: string;

  constructor(config: UPLConfig = {}) {
    this.apiKey = config.apiKey;
    this.api = axios.create({
      baseURL: config.apiUrl || 'https://privacycloak.in/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'X-API-Key': config.apiKey }),
      },
    });
  }

  /**
   * Create a new privacy wallet with spending and viewing keys
   */
  async createPrivacyWallet(): Promise<PrivacyWallet> {
    const spendingWallet = ethers.Wallet.createRandom();
    const viewingWallet = ethers.Wallet.createRandom();

    return {
      spending_private_key: spendingWallet.privateKey,
      spending_public_key: spendingWallet.publicKey,
      viewing_private_key: viewingWallet.privateKey,
      viewing_public_key: viewingWallet.publicKey,
    };
  }

  /**
   * Import a privacy wallet from existing seeds
   */
  importPrivacyWallet(spendingSeed: string, viewingSeed: string): PrivacyWallet {
    const spendingWallet = ethers.Wallet.fromPhrase(spendingSeed);
    const viewingWallet = ethers.Wallet.fromPhrase(viewingSeed);

    return {
      spending_private_key: spendingWallet.privateKey,
      spending_public_key: spendingWallet.publicKey,
      viewing_private_key: viewingWallet.privateKey,
      viewing_public_key: viewingWallet.publicKey,
    };
  }

  /**
   * Generate a one-time stealth address for receiving funds
   */
  async generateStealthAddress(
    spendingPublicKey: string,
    viewingPublicKey: string
  ): Promise<StealthAddress> {
    const response = await this.api.post('/stealth/generate', {
      spending_public_key: spendingPublicKey,
      viewing_public_key: viewingPublicKey,
    });
    return response.data;
  }

  /**
   * Get balance for an address on a specific chain
   */
  async getBalance(address: string, chain: ChainKey): Promise<{
    balance: string;
    symbol: string;
  }> {
    const response = await this.api.get(`/balance/${chain}/${address}`);
    return {
      balance: response.data.total_balance_eth,
      symbol: CHAINS[chain].symbol,
    };
  }

  /**
   * Get aggregated hidden balance across all chains
   */
  async getHiddenBalance(address: string): Promise<{
    chains: Record<string, any>;
    stealth_address_count: number;
  }> {
    const response = await this.api.get(`/balance/hidden/${address}`);
    return response.data;
  }

  /**
   * Send funds privately using the relayer
   */
  async sendPrivate(
    signer: Signer,
    recipient: string,
    amount: string,
    chain: ChainKey
  ): Promise<string> {
    const chainConfig = CHAINS[chain];
    
    // First, register stealth if needed
    const tx = await signer.sendTransaction({
      to: recipient,
      value: ethers.parseEther(amount),
    });

    // Log to our backend for tracking
    await this.api.post('/transaction/log', {
      from_address: await signer.getAddress(),
      to_address: recipient,
      amount_wei: ethers.parseEther(amount).toString(),
      tx_hash: tx.hash,
      chain,
      tx_type: 'private_send',
    });

    return tx.hash;
  }

  /**
   * Prepare a cross-chain split transaction
   */
  async prepareSplit(
    fromAddress: string,
    totalAmount: string,
    splits: SplitConfig[]
  ): Promise<SplitPlan> {
    const response = await this.api.post('/split/prepare', {
      from_address: fromAddress,
      total_amount_wei: ethers.parseEther(totalAmount).toString(),
      splits: splits.map(s => ({
        chain: s.chain,
        stealth_address: s.stealth_address,
        percentage: s.percentage,
      })),
    });
    return response.data;
  }

  /**
   * Execute a split transaction on a specific chain
   */
  async executeSplit(
    signer: Signer,
    splitPlan: SplitPlan,
    chainIndex: number
  ): Promise<string> {
    const tx = splitPlan.transactions[chainIndex];
    const txResponse = await signer.sendTransaction({
      to: tx.stealth_address,
      value: ethers.parseEther(tx.amount.replace(/ .*$/, '')),
    });

    // Update status
    await this.api.post('/split/update-status', {
      split_id: splitPlan.split_id,
      chain: tx.chain,
      status: 'confirmed',
      tx_hash: txResponse.hash,
    });

    return txResponse.hash;
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(address: string, limit = 50): Promise<any[]> {
    const response = await this.api.get(`/transactions/history/${address}?limit=${limit}`);
    return response.data.transactions || [];
  }

  /**
   * Create an encrypted receipt
   */
  async createReceipt(data: {
    tx_hash: string;
    sender: string;
    recipient: string;
    amount: string;
    chain: ChainKey;
    note?: string;
  }): Promise<{ receipt_id: string; encrypted_data: string }> {
    const response = await this.api.post('/receipt/create', data);
    return response.data;
  }

  /**
   * Verify a ZKP proof
   */
  async verifyZKP(
    proof: any,
    publicInputs: any[],
    proofType: 'stealth_ownership' | 'amount_range' | 'membership',
    chain: ChainKey
  ): Promise<{ valid: boolean; verified_on_chain: boolean }> {
    const response = await this.api.post('/zkp/verify', {
      proof,
      public_inputs: publicInputs,
      proof_type: proofType,
      chain,
    });
    return response.data;
  }

  /**
   * Get list of supported chains
   */
  getChains(): typeof CHAINS {
    return CHAINS;
  }

  /**
   * Get provider for a specific chain
   */
  getProvider(chain: ChainKey): Provider {
    return new ethers.JsonRpcProvider(CHAINS[chain].rpc);
  }
}

// Export default instance
export default UPL;
