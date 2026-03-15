"""UPL SDK Client"""

import requests
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from eth_account import Account
from web3 import Web3

# Chain configuration
CHAINS = {
    "base": {"chain_id": 8453, "name": "Base", "rpc": "https://mainnet.base.org", "symbol": "ETH"},
    "arbitrum": {"chain_id": 42161, "name": "Arbitrum", "rpc": "https://arb1.arbitrum.io/rpc", "symbol": "ETH"},
    "polygon": {"chain_id": 137, "name": "Polygon", "rpc": "https://rpc-mainnet.matic.quiknode.pro", "symbol": "POL"},
    "optimism": {"chain_id": 10, "name": "Optimism", "rpc": "https://mainnet.optimism.io", "symbol": "ETH"},
    "bnb": {"chain_id": 56, "name": "BNB Chain", "rpc": "https://bsc-dataseed1.binance.org/", "symbol": "BNB"},
    "avalanche": {"chain_id": 43114, "name": "Avalanche", "rpc": "https://api.avax.network/ext/bc/C/rpc", "symbol": "AVAX"},
    "hyperliquid": {"chain_id": 999, "name": "Hyperliquid", "rpc": "https://rpc.hyperliquid.xyz/evm", "symbol": "HYPE"},
}


@dataclass
class StealthAddress:
    """Generated stealth address"""
    stealth_address: str
    ephemeral_public_key: str
    view_tag: str


@dataclass
class PrivacyWallet:
    """Privacy wallet with spending and viewing keys"""
    spending_private_key: str
    spending_public_key: str
    viewing_private_key: str
    viewing_public_key: str


class UPL:
    """
    Universal Privacy Layer SDK
    
    Provides privacy features for EVM chains including stealth addresses,
    cross-chain splits, and ZKP verification.
    
    Args:
        api_url: Base URL for the UPL API (default: https://privacycloak.in/api)
        api_key: Optional API key for authenticated requests
        
    Example:
        >>> upl = UPL()
        >>> wallet = upl.create_privacy_wallet()
        >>> stealth = upl.generate_stealth_address(
        ...     wallet.spending_public_key,
        ...     wallet.viewing_public_key
        ... )
        >>> print(stealth.stealth_address)
    """
    
    def __init__(
        self,
        api_url: str = "https://privacycloak.in/api",
        api_key: Optional[str] = None
    ):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
        })
        if api_key:
            self.session.headers["X-API-Key"] = api_key
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make API request"""
        url = f"{self.api_url}{endpoint}"
        response = self.session.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json()
    
    def create_privacy_wallet(self) -> PrivacyWallet:
        """
        Create a new privacy wallet with random spending and viewing keys.
        
        Returns:
            PrivacyWallet with spending and viewing key pairs
        """
        Account.enable_unaudited_hdwallet_features()
        
        spending_account = Account.create()
        viewing_account = Account.create()
        
        return PrivacyWallet(
            spending_private_key=spending_account.key.hex(),
            spending_public_key=spending_account.address,
            viewing_private_key=viewing_account.key.hex(),
            viewing_public_key=viewing_account.address,
        )
    
    def import_privacy_wallet(
        self,
        spending_seed: str,
        viewing_seed: str
    ) -> PrivacyWallet:
        """
        Import a privacy wallet from existing seed phrases.
        
        Args:
            spending_seed: 12-word mnemonic for spending key
            viewing_seed: 12-word mnemonic for viewing key
            
        Returns:
            PrivacyWallet with imported keys
        """
        Account.enable_unaudited_hdwallet_features()
        
        spending_account = Account.from_mnemonic(spending_seed)
        viewing_account = Account.from_mnemonic(viewing_seed)
        
        return PrivacyWallet(
            spending_private_key=spending_account.key.hex(),
            spending_public_key=spending_account.address,
            viewing_private_key=viewing_account.key.hex(),
            viewing_public_key=viewing_account.address,
        )
    
    def generate_stealth_address(
        self,
        spending_public_key: str,
        viewing_public_key: str
    ) -> StealthAddress:
        """
        Generate a one-time stealth address for private receiving.
        
        Args:
            spending_public_key: Public key for spending
            viewing_public_key: Public key for scanning
            
        Returns:
            StealthAddress with the generated address and metadata
        """
        data = self._request("POST", "/stealth/generate", json={
            "spending_public_key": spending_public_key,
            "viewing_public_key": viewing_public_key,
        })
        
        return StealthAddress(
            stealth_address=data["stealth_address"],
            ephemeral_public_key=data["ephemeral_public_key"],
            view_tag=data["view_tag"],
        )
    
    def get_balance(self, address: str, chain: str) -> Dict[str, str]:
        """
        Get balance for an address on a specific chain.
        
        Args:
            address: Ethereum address
            chain: Chain key (e.g., 'base', 'arbitrum')
            
        Returns:
            Dictionary with balance and symbol
        """
        data = self._request("GET", f"/balance/{chain}/{address}")
        return {
            "balance": data.get("total_balance_eth", "0"),
            "symbol": CHAINS.get(chain, {}).get("symbol", "ETH"),
        }
    
    def get_hidden_balance(self, address: str) -> Dict[str, Any]:
        """
        Get aggregated hidden balance across all stealth addresses.
        
        Args:
            address: Main wallet address
            
        Returns:
            Dictionary with balance breakdown by chain
        """
        return self._request("GET", f"/balance/hidden/{address}")
    
    def get_transaction_history(
        self,
        address: str,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get transaction history for an address.
        
        Args:
            address: Wallet address
            limit: Maximum number of transactions
            
        Returns:
            List of transactions
        """
        data = self._request("GET", f"/transactions/history/{address}?limit={limit}")
        return data.get("transactions", [])
    
    def prepare_split(
        self,
        from_address: str,
        total_amount_eth: str,
        splits: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Prepare a cross-chain split transaction.
        
        Args:
            from_address: Sender address
            total_amount_eth: Total amount in ETH
            splits: List of split configurations with chain, stealth_address, percentage
            
        Returns:
            Split plan with transaction details
        """
        w3 = Web3()
        total_wei = w3.to_wei(float(total_amount_eth), "ether")
        
        return self._request("POST", "/split/prepare", json={
            "from_address": from_address,
            "total_amount_wei": str(total_wei),
            "splits": splits,
        })
    
    def verify_zkp(
        self,
        proof: Dict[str, Any],
        public_inputs: List[Any],
        proof_type: str,
        chain: str
    ) -> Dict[str, Any]:
        """
        Verify a zero-knowledge proof.
        
        Args:
            proof: The ZKP proof object
            public_inputs: Public inputs for verification
            proof_type: Type of proof (stealth_ownership, amount_range, membership)
            chain: Chain to verify on
            
        Returns:
            Verification result
        """
        return self._request("POST", "/zkp/verify", json={
            "proof": proof,
            "public_inputs": public_inputs,
            "proof_type": proof_type,
            "chain": chain,
        })
    
    def create_receipt(
        self,
        tx_hash: str,
        sender: str,
        recipient: str,
        amount: str,
        chain: str,
        note: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create an encrypted transaction receipt.
        
        Args:
            tx_hash: Transaction hash
            sender: Sender address
            recipient: Recipient address
            amount: Amount transferred
            chain: Chain name
            note: Optional note
            
        Returns:
            Receipt data with encrypted content
        """
        return self._request("POST", "/receipt/create", json={
            "tx_hash": tx_hash,
            "sender": sender,
            "recipient": recipient,
            "amount": amount,
            "chain": chain,
            "note": note,
        })
    
    def get_chains(self) -> Dict[str, Dict[str, Any]]:
        """
        Get list of supported chains.
        
        Returns:
            Dictionary of chain configurations
        """
        return CHAINS.copy()
    
    def get_provider(self, chain: str) -> Web3:
        """
        Get Web3 provider for a specific chain.
        
        Args:
            chain: Chain key
            
        Returns:
            Web3 instance connected to the chain
        """
        if chain not in CHAINS:
            raise ValueError(f"Unknown chain: {chain}")
        
        return Web3(Web3.HTTPProvider(CHAINS[chain]["rpc"]))
