"""
UPL SDK - Universal Privacy Layer
Private transactions across 7 EVM chains

Usage:
    from upl_sdk import UPL
    
    upl = UPL()
    
    # Create privacy wallet
    wallet = upl.create_privacy_wallet()
    
    # Generate stealth address
    stealth = upl.generate_stealth_address(
        wallet.spending_public_key,
        wallet.viewing_public_key
    )
    
    # Get hidden balance
    balance = upl.get_hidden_balance(address)
    
    # Get Uniswap V3 quote (privacy-routed)
    quote = upl.get_uniswap_quote('base', 'ETH', 'USDC', '0.1', '0x...')
    
    # Prepare Hyperliquid private trade
    trade = upl.prepare_hyperliquid_trade('0x...', 'ETH', True, 100, leverage=5)
    
    # Prepare Polymarket private bet  
    bet = upl.prepare_polymarket_bet('0x...', 'cond_123', '1', 'YES', 50.0)
"""

from .client import UPL, CHAINS, StealthAddress, PrivacyWallet

__version__ = "1.1.0"
__all__ = ["UPL", "CHAINS", "StealthAddress", "PrivacyWallet"]
