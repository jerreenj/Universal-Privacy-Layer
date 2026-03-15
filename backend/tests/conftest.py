# Patch web3 pytest plugin loading issue
import sys
import unittest.mock as mock

# Pre-patch eth_typing to avoid web3 pytest plugin load failure
try:
    import eth_typing
    if not hasattr(eth_typing, 'ContractName'):
        eth_typing.ContractName = str
except Exception:
    pass
