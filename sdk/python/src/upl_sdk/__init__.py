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
        wallet['spending_public_key'],
        wallet['viewing_public_key']
    )
    
    # Get hidden balance
    balance = upl.get_hidden_balance(address)
"""

from .client import UPL, CHAINS

__version__ = "1.0.0"
__all__ = ["UPL", "CHAINS"]
