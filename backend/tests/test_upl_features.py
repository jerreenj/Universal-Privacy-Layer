"""
Test suite for Universal Privacy Layer - P0 and P1 Features
Tests: Hidden Balance, Transaction History, Dual Seed Wallet, NFT Privacy, Token Approval Privacy, Contract Privacy
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndStats:
    """Health and Stats endpoint tests"""
    
    def test_health_endpoint(self):
        """Test /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        print(f"✓ Health check passed: {data['status']}")
    
    def test_stats_endpoint(self):
        """Test /api/stats returns platform statistics"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_transactions" in data
        assert "total_stealth_addresses" in data
        assert "total_wallets" in data
        assert "total_receipts" in data
        assert "live_chains" in data
        assert "contracts" in data
        assert data["contracts"]["privacy_relayer"] == "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        print(f"✓ Stats: {data['total_wallets']} wallets, {data['total_stealth_addresses']} stealth addresses")
    
    def test_chains_endpoint(self):
        """Test /api/chains returns chain configuration"""
        response = requests.get(f"{BASE_URL}/api/chains")
        assert response.status_code == 200
        data = response.json()
        assert "chains" in data
        assert "contracts" in data
        assert "tokens" in data
        assert "live_chains" in data
        # Verify 7 EVM chains are configured
        expected_chains = ["base", "arbitrum", "polygon", "optimism", "bnb", "avalanche", "hyperliquid"]
        for chain in expected_chains:
            assert chain in data["chains"], f"Missing chain: {chain}"
        print(f"✓ Chains configured: {len(data['chains'])} chains")


class TestHiddenBalance:
    """Hidden Balance (P0) - Aggregated balance across stealth addresses"""
    
    def test_hidden_balance_endpoint(self):
        """Test /api/balance/hidden/{address} returns aggregated balances"""
        test_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21"
        response = requests.get(f"{BASE_URL}/api/balance/hidden/{test_address}")
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert data["address"] == test_address
        assert "chains" in data
        assert "stealth_address_count" in data
        
        # Verify chain data structure
        for chain_key, chain_data in data["chains"].items():
            assert "name" in chain_data
            assert "symbol" in chain_data
            # Either has balance data or error
            if "error" not in chain_data:
                assert "main_balance" in chain_data
                assert "stealth_balance" in chain_data
                assert "total_balance" in chain_data
        
        print(f"✓ Hidden balance for {test_address[:10]}...: {data['stealth_address_count']} stealth addresses")
    
    def test_hidden_balance_all_chains(self):
        """Test hidden balance returns data for all 7 chains"""
        test_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21"
        response = requests.get(f"{BASE_URL}/api/balance/hidden/{test_address}")
        assert response.status_code == 200
        data = response.json()
        
        expected_chains = ["base", "arbitrum", "polygon", "optimism", "bnb", "avalanche", "hyperliquid"]
        for chain in expected_chains:
            assert chain in data["chains"], f"Missing chain in hidden balance: {chain}"
        
        print(f"✓ All {len(expected_chains)} chains present in hidden balance response")


class TestTransactionHistory:
    """Transaction History (P0) - Complete transaction history"""
    
    def test_transaction_history_endpoint(self):
        """Test /api/transactions/history/{address} returns transaction history"""
        test_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21"
        response = requests.get(f"{BASE_URL}/api/transactions/history/{test_address}")
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert data["address"] == test_address
        assert "transactions" in data
        assert "total_count" in data
        assert "stealth_addresses_count" in data
        assert isinstance(data["transactions"], list)
        
        print(f"✓ Transaction history: {data['total_count']} transactions")
    
    def test_transaction_history_with_limit(self):
        """Test transaction history respects limit parameter"""
        test_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21"
        response = requests.get(f"{BASE_URL}/api/transactions/history/{test_address}?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["transactions"]) <= 10
        print(f"✓ Transaction history limit working")


class TestDualSeedWallet:
    """Dual Seed Wallet (P0) - Main wallet + Privacy envelope"""
    
    def test_wallet_create(self):
        """Test /api/wallet/create creates dual seed wallet"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/create",
            json={"password": "test_password_123"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "wallet_id" in data
        assert "main_address" in data
        assert "privacy_address" in data
        assert "main_seed_phrase" in data
        assert "privacy_seed_phrase" in data
        
        # Verify addresses are valid Ethereum addresses
        assert data["main_address"].startswith("0x")
        assert len(data["main_address"]) == 42
        assert data["privacy_address"].startswith("0x")
        assert len(data["privacy_address"]) == 42
        
        # Verify seed phrases are different
        assert data["main_seed_phrase"] != data["privacy_seed_phrase"]
        
        # Verify seed phrases have 12 words
        assert len(data["main_seed_phrase"].split()) == 12
        assert len(data["privacy_seed_phrase"].split()) == 12
        
        print(f"✓ Dual wallet created: main={data['main_address'][:10]}..., privacy={data['privacy_address'][:10]}...")
    
    def test_wallet_register_privacy(self):
        """Test /api/wallet/register-privacy registers privacy keys"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/register-privacy",
            json={
                "main_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                "privacy_spend_key": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                "privacy_view_key": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["success"] == True
        assert "wallet_id" in data
        
        print(f"✓ Privacy keys registered: wallet_id={data['wallet_id'][:8]}...")
    
    def test_wallet_get_privacy(self):
        """Test /api/wallet/privacy/{address} retrieves privacy wallet info"""
        test_address = "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21"
        response = requests.get(f"{BASE_URL}/api/wallet/privacy/{test_address}")
        assert response.status_code == 200
        data = response.json()
        
        # Should have registered field
        assert "registered" in data
        
        if data["registered"]:
            assert "wallet" in data
            assert data["wallet"]["main_address"] == test_address
        
        print(f"✓ Privacy wallet lookup: registered={data['registered']}")


class TestStealthAddress:
    """Stealth Address Generation"""
    
    def test_stealth_generate(self):
        """Test /api/stealth/generate creates stealth address"""
        response = requests.post(
            f"{BASE_URL}/api/stealth/generate",
            json={
                "public_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                "chain": "base"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "stealth_address" in data
        assert "ephemeral_public_key" in data
        assert "view_tag" in data
        assert "chain" in data
        assert "created_at" in data
        
        # Verify stealth address is valid
        assert data["stealth_address"].startswith("0x")
        assert len(data["stealth_address"]) == 42
        assert data["chain"] == "base"
        
        print(f"✓ Stealth address generated: {data['stealth_address'][:10]}... on {data['chain']}")
    
    def test_stealth_generate_multiple_chains(self):
        """Test stealth generation works on multiple chains"""
        chains = ["base", "arbitrum", "polygon", "optimism"]
        for chain in chains:
            response = requests.post(
                f"{BASE_URL}/api/stealth/generate",
                json={
                    "public_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                    "chain": chain
                }
            )
            assert response.status_code == 200
            data = response.json()
            assert data["chain"] == chain
        
        print(f"✓ Stealth generation works on all {len(chains)} chains")


class TestNFTPrivacy:
    """NFT Privacy Proxy (P1)"""
    
    def test_nft_proxy_create(self):
        """Test /api/nft/proxy creates NFT privacy proxy"""
        response = requests.post(
            f"{BASE_URL}/api/nft/proxy",
            json={
                "user_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                "nft_contract": "0x1234567890123456789012345678901234567890",
                "token_id": "1234",
                "action": "buy",
                "chain": "base"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "proxy_id" in data
        assert "proxy_address" in data
        assert "instructions" in data
        assert "action" in data
        
        # Verify proxy address is valid
        assert data["proxy_address"].startswith("0x")
        assert len(data["proxy_address"]) == 42
        assert data["action"] == "buy"
        
        print(f"✓ NFT proxy created: {data['proxy_address'][:10]}... for action={data['action']}")
    
    def test_nft_proxy_all_actions(self):
        """Test NFT proxy supports all actions: buy, sell, transfer, bid"""
        actions = ["buy", "sell", "transfer", "bid"]
        for action in actions:
            response = requests.post(
                f"{BASE_URL}/api/nft/proxy",
                json={
                    "user_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                    "nft_contract": "0x1234567890123456789012345678901234567890",
                    "token_id": "1234",
                    "action": action,
                    "chain": "base"
                }
            )
            assert response.status_code == 200
            data = response.json()
            assert data["action"] == action
        
        print(f"✓ NFT proxy supports all {len(actions)} actions")


class TestTokenApprovalPrivacy:
    """Token Approval Privacy (P1) - Disposable approval addresses"""
    
    def test_disposable_approval_create(self):
        """Test /api/approval/create-disposable creates disposable approval address"""
        response = requests.post(
            f"{BASE_URL}/api/approval/create-disposable",
            json={
                "user_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                "token_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "spender_address": "0x1234567890123456789012345678901234567890",
                "amount": "1000000",
                "chain": "base"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "approval_id" in data
        assert "disposable_address" in data
        assert "instructions" in data
        
        # Verify disposable address is valid
        assert data["disposable_address"].startswith("0x")
        assert len(data["disposable_address"]) == 42
        
        print(f"✓ Disposable approval created: {data['disposable_address'][:10]}...")


class TestContractPrivacy:
    """Smart Contract Privacy Proxy (P1)"""
    
    def test_contract_proxy_create(self):
        """Test /api/contract/proxy creates anonymous contract proxy"""
        response = requests.post(
            f"{BASE_URL}/api/contract/proxy",
            json={
                "user_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                "contract_address": "0x1234567890123456789012345678901234567890",
                "function_name": "stake",
                "function_args": [],
                "chain": "base"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "proxy_id" in data
        assert "proxy_address" in data
        assert "instructions" in data
        
        # Verify proxy address is valid
        assert data["proxy_address"].startswith("0x")
        assert len(data["proxy_address"]) == 42
        
        print(f"✓ Contract proxy created: {data['proxy_address'][:10]}...")
    
    def test_contract_proxy_with_args(self):
        """Test contract proxy with function arguments"""
        response = requests.post(
            f"{BASE_URL}/api/contract/proxy",
            json={
                "user_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21",
                "contract_address": "0x1234567890123456789012345678901234567890",
                "function_name": "swap",
                "function_args": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "1000000"],
                "chain": "base",
                "value_wei": "100000000000000000"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "proxy_address" in data
        
        print(f"✓ Contract proxy with args created successfully")


class TestTokensEndpoint:
    """Token configuration endpoints"""
    
    def test_tokens_base(self):
        """Test /api/tokens/base returns Base chain tokens"""
        response = requests.get(f"{BASE_URL}/api/tokens/base")
        assert response.status_code == 200
        data = response.json()
        
        assert data["chain"] == "base"
        assert "tokens" in data
        assert "ETH" in data["tokens"]
        assert "USDC" in data["tokens"]
        
        print(f"✓ Base tokens: {list(data['tokens'].keys())}")
    
    def test_tokens_invalid_chain(self):
        """Test /api/tokens/{invalid} returns 400"""
        response = requests.get(f"{BASE_URL}/api/tokens/invalid_chain")
        assert response.status_code == 400
        print(f"✓ Invalid chain returns 400 as expected")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
