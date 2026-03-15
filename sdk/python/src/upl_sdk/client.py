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

    # ─── Uniswap V3 Private Swap ─────────────────────────────────────────────

    def get_uniswap_quote(
        self,
        chain: str,
        token_in: str,
        token_out: str,
        amount_in: str,
        stealth_recipient: str,
        fee_tier: str = "medium"
    ) -> Dict[str, Any]:
        """
        Get a Uniswap V3 quote routed through the privacy layer.
        
        Args:
            chain: Chain key (base, arbitrum, polygon, optimism)
            token_in: Input token symbol or address
            token_out: Output token symbol or address
            amount_in: Amount to swap (human readable, e.g. '0.1')
            stealth_recipient: Stealth address to receive output
            fee_tier: Fee tier (very_low, low, medium, high)
            
        Returns:
            Quote data including amount_out_human, routing, privacy_fee_pct
            
        Example:
            >>> quote = upl.get_uniswap_quote('base', 'ETH', 'USDC', '0.1', '0x...')
            >>> print(quote['amount_out_human'])
        """
        return self._request("POST", "/uniswap/quote", json={
            "chain": chain,
            "token_in": token_in,
            "token_out": token_out,
            "amount_in": amount_in,
            "stealth_recipient": stealth_recipient,
            "fee_tier": fee_tier,
        })

    def get_uniswap_supported_chains(self) -> List[str]:
        """Get chains where Uniswap V3 is available."""
        data = self._request("GET", "/uniswap/supported-chains")
        return data.get("chains", [])

    # ─── Hyperliquid Private Trading ──────────────────────────────────────────

    def get_hyperliquid_markets(self) -> List[Dict[str, Any]]:
        """
        Get available perpetual markets on Hyperliquid.
        
        Returns:
            List of market objects with name and maxLeverage
        """
        data = self._request("GET", "/hyperliquid/markets")
        return data.get("markets", [])

    def get_hyperliquid_price(self, asset: str) -> Optional[float]:
        """
        Get live mark price for a Hyperliquid asset.
        
        Args:
            asset: Asset symbol (e.g., 'ETH', 'BTC')
            
        Returns:
            Current mark price or None if unavailable
        """
        data = self._request("GET", f"/hyperliquid/price/{asset}")
        return data.get("price")

    def prepare_hyperliquid_trade(
        self,
        trader_address: str,
        asset: str,
        is_buy: bool,
        size_usd: float,
        leverage: int = 1,
        limit_price: Optional[float] = None,
        chain: str = "arbitrum"
    ) -> Dict[str, Any]:
        """
        Prepare a privacy-routed trade on Hyperliquid.
        
        Args:
            trader_address: Your wallet address
            asset: Asset to trade (e.g., 'ETH', 'BTC')
            is_buy: True for LONG, False for SHORT
            size_usd: Position size in USD
            leverage: Leverage multiplier (1-50)
            limit_price: Limit price (None for market order)
            chain: Chain for margin routing (default: arbitrum)
            
        Returns:
            Trade plan with proxy_address, trade_id, instructions
            
        Example:
            >>> trade = upl.prepare_hyperliquid_trade('0x...', 'ETH', True, 100, leverage=5)
            >>> print(trade['proxy_address'])  # Send margin here
        """
        return self._request("POST", "/hyperliquid/prepare-private-trade", json={
            "trader_address": trader_address,
            "asset": asset,
            "is_buy": is_buy,
            "size": size_usd,
            "leverage": leverage,
            "limit_price": limit_price,
            "chain": chain,
        })

    # ─── Polymarket Private Betting ───────────────────────────────────────────

    def get_polymarket_markets(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get active prediction markets from Polymarket.
        
        Args:
            limit: Maximum number of markets to return
            
        Returns:
            List of market objects
        """
        data = self._request("GET", f"/polymarket/markets?limit={limit}")
        return data.get("markets", [])

    def prepare_polymarket_bet(
        self,
        bettor_address: str,
        condition_id: str,
        token_id: str,
        outcome: str,
        amount_usdc: float
    ) -> Dict[str, Any]:
        """
        Prepare a privacy-routed bet on Polymarket.
        
        Args:
            bettor_address: Your wallet address
            condition_id: Polymarket market condition ID
            token_id: YES or NO token ID
            outcome: 'YES' or 'NO'
            amount_usdc: Amount to bet in USDC
            
        Returns:
            Bet plan with proxy_address, bet_id, instructions
            
        Example:
            >>> bet = upl.prepare_polymarket_bet('0x...', 'cond_123', '1', 'YES', 50.0)
            >>> print(bet['proxy_address'])  # Send USDC here
        """
        return self._request("POST", "/polymarket/prepare-private-bet", json={
            "bettor_address": bettor_address,
            "condition_id": condition_id,
            "token_id": token_id,
            "outcome": outcome.upper(),
            "amount_usdc": amount_usdc,
            "chain": "polygon",
        })

