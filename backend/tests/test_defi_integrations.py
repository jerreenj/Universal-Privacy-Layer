"""
Backend API Tests for DeFi Integrations:
- Uniswap V3 Private Swap
- Hyperliquid Private Trading
- Polymarket Private Betting

All endpoints test the new privacy-routed DeFi features.
"""

import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test addresses
TEST_ADDRESS = "0x1234567890123456789012345678901234567890"
TEST_STEALTH = "0xaBcDeF1234567890aBcDeF1234567890aBcDeF12"


class TestUniswapV3Integration:
    """Uniswap V3 Private Swap API Tests"""
    
    def test_uniswap_supported_chains(self):
        """GET /api/uniswap/supported-chains - should list base, arbitrum, polygon, optimism"""
        response = requests.get(f"{BASE_URL}/api/uniswap/supported-chains")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Data assertions
        assert "chains" in data, "Response should have 'chains' key"
        assert isinstance(data["chains"], list), "chains should be a list"
        
        expected_chains = ["base", "arbitrum", "polygon", "optimism"]
        for chain in expected_chains:
            assert chain in data["chains"], f"Chain '{chain}' should be in supported chains"
        
        assert "contracts" in data, "Response should have 'contracts' key"
        print(f"✓ Uniswap supported chains: {data['chains']}")
    
    def test_uniswap_quote_base(self):
        """POST /api/uniswap/quote - should return quote with amount_out_human"""
        payload = {
            "chain": "base",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_in": "0.1",
            "stealth_recipient": TEST_STEALTH,
            "fee_tier": "medium"
        }
        response = requests.post(f"{BASE_URL}/api/uniswap/quote", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Required fields
        assert "amount_out_human" in data, "Response should have 'amount_out_human'"
        assert "amount_in" in data, "Response should have 'amount_in'"
        assert "chain" in data, "Response should have 'chain'"
        assert "privacy_fee_pct" in data, "Response should have 'privacy_fee_pct'"
        assert "router" in data, "Response should have 'router'"
        assert "stealth_recipient" in data, "Response should have 'stealth_recipient'"
        assert "routing" in data, "Response should have 'routing'"
        
        # Value assertions
        assert data["chain"] == "base", f"Expected chain 'base', got {data['chain']}"
        assert data["amount_in"] == "0.1", f"Expected amount_in '0.1', got {data['amount_in']}"
        assert data["stealth_recipient"] == TEST_STEALTH
        assert "privacy" in data["routing"].lower()
        
        print(f"✓ Uniswap quote: {data['amount_in']} ETH → {data['amount_out_human']} USDC")
    
    def test_uniswap_quote_arbitrum(self):
        """POST /api/uniswap/quote - test on Arbitrum chain"""
        payload = {
            "chain": "arbitrum",
            "token_in": "WETH",
            "token_out": "USDC",
            "amount_in": "0.05",
            "stealth_recipient": TEST_STEALTH,
            "fee_tier": "low"
        }
        response = requests.post(f"{BASE_URL}/api/uniswap/quote", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["chain"] == "arbitrum"
        assert "amount_out_human" in data
        print(f"✓ Uniswap quote on Arbitrum: {data['amount_out_human']} USDC")
    
    def test_uniswap_quote_unsupported_chain(self):
        """POST /api/uniswap/quote - should reject unsupported chain"""
        payload = {
            "chain": "solana",  # Not supported for Uniswap
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_in": "0.1",
            "stealth_recipient": TEST_STEALTH,
            "fee_tier": "medium"
        }
        response = requests.post(f"{BASE_URL}/api/uniswap/quote", json=payload)
        
        assert response.status_code == 400, f"Expected 400 for unsupported chain, got {response.status_code}"
        print("✓ Unsupported chain correctly rejected")


class TestHyperliquidIntegration:
    """Hyperliquid Private Trading API Tests"""
    
    def test_hyperliquid_markets(self):
        """GET /api/hyperliquid/markets - should return markets list"""
        response = requests.get(f"{BASE_URL}/api/hyperliquid/markets")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "markets" in data, "Response should have 'markets' key"
        assert "count" in data, "Response should have 'count' key"
        assert isinstance(data["markets"], list)
        assert len(data["markets"]) > 0, "Should have at least one market"
        
        # Check market structure
        first_market = data["markets"][0]
        assert "name" in first_market, "Market should have 'name'"
        assert "maxLeverage" in first_market, "Market should have 'maxLeverage'"
        
        print(f"✓ Hyperliquid markets: {data['count']} markets found")
    
    def test_hyperliquid_price_eth(self):
        """GET /api/hyperliquid/price/ETH - should return price data"""
        response = requests.get(f"{BASE_URL}/api/hyperliquid/price/ETH")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "asset" in data, "Response should have 'asset' key"
        assert data["asset"] == "ETH", f"Expected asset 'ETH', got {data['asset']}"
        
        # Price may be None if API is unavailable, but key should exist
        assert "price" in data or "error" in data, "Response should have 'price' or 'error'"
        
        if data.get("price"):
            assert isinstance(data["price"], (int, float)), "Price should be a number"
            assert data["price"] > 0, "Price should be positive"
            print(f"✓ Hyperliquid ETH price: ${data['price']}")
        else:
            print(f"✓ Hyperliquid ETH price endpoint working (price unavailable: {data.get('error', 'N/A')})")
    
    def test_hyperliquid_price_btc(self):
        """GET /api/hyperliquid/price/BTC - should return price data"""
        response = requests.get(f"{BASE_URL}/api/hyperliquid/price/BTC")
        
        assert response.status_code == 200
        data = response.json()
        assert data["asset"] == "BTC"
        print(f"✓ Hyperliquid BTC price: {data.get('price', 'N/A')}")
    
    def test_hyperliquid_prepare_private_trade_long(self):
        """POST /api/hyperliquid/prepare-private-trade - should return trade_id and proxy_address"""
        payload = {
            "trader_address": TEST_ADDRESS,
            "asset": "ETH",
            "is_buy": True,  # LONG
            "size": 100,
            "leverage": 5,
            "chain": "arbitrum"
        }
        response = requests.post(f"{BASE_URL}/api/hyperliquid/prepare-private-trade", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Required fields
        assert "trade_id" in data, "Response should have 'trade_id'"
        assert "proxy_address" in data, "Response should have 'proxy_address'"
        assert "platform" in data, "Response should have 'platform'"
        assert "direction" in data, "Response should have 'direction'"
        assert "size_usd" in data, "Response should have 'size_usd'"
        assert "routing" in data, "Response should have 'routing'"
        assert "instructions" in data, "Response should have 'instructions'"
        
        # Value assertions
        assert data["platform"] == "hyperliquid"
        assert data["direction"] == "LONG"
        assert data["size_usd"] == 100
        assert data["proxy_address"].startswith("0x")
        assert len(data["trade_id"]) > 10
        
        print(f"✓ Hyperliquid LONG trade prepared: {data['trade_id'][:16]}... proxy: {data['proxy_address'][:12]}...")
        return data["trade_id"]
    
    def test_hyperliquid_prepare_private_trade_short(self):
        """POST /api/hyperliquid/prepare-private-trade - SHORT position"""
        payload = {
            "trader_address": TEST_ADDRESS,
            "asset": "BTC",
            "is_buy": False,  # SHORT
            "size": 500,
            "leverage": 10,
            "chain": "arbitrum"
        }
        response = requests.post(f"{BASE_URL}/api/hyperliquid/prepare-private-trade", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["direction"] == "SHORT"
        assert data["asset"] == "BTC"
        assert data["size_usd"] == 500
        print(f"✓ Hyperliquid SHORT trade prepared: proxy={data['proxy_address'][:12]}...")


class TestPolymarketIntegration:
    """Polymarket Private Betting API Tests"""
    
    def test_polymarket_markets(self):
        """GET /api/polymarket/markets?limit=5 - should return markets list"""
        response = requests.get(f"{BASE_URL}/api/polymarket/markets", params={"limit": 5})
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "markets" in data, "Response should have 'markets' key"
        assert "count" in data, "Response should have 'count' key"
        assert isinstance(data["markets"], list)
        
        # May return demo data if CLOB API is unavailable
        assert "source" in data, "Response should have 'source' key"
        
        if len(data["markets"]) > 0:
            market = data["markets"][0]
            # Check market has some structure (can be CLOB or demo format)
            assert "condition_id" in market or "question" in market, "Market should have identifier"
        
        print(f"✓ Polymarket markets: {data['count']} markets (source: {data['source']})")
    
    def test_polymarket_markets_limit(self):
        """GET /api/polymarket/markets - test with different limit"""
        response = requests.get(f"{BASE_URL}/api/polymarket/markets", params={"limit": 3})
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["markets"]) <= 3, "Should respect limit parameter"
        print(f"✓ Polymarket markets with limit=3: {len(data['markets'])} returned")
    
    def test_polymarket_prepare_private_bet_yes(self):
        """POST /api/polymarket/prepare-private-bet - should return bet_id and proxy_address"""
        payload = {
            "bettor_address": TEST_ADDRESS,
            "condition_id": "test_condition_123",
            "token_id": "yes_token_456",
            "outcome": "YES",
            "amount_usdc": 10,
            "chain": "polygon"
        }
        response = requests.post(f"{BASE_URL}/api/polymarket/prepare-private-bet", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Required fields
        assert "bet_id" in data, "Response should have 'bet_id'"
        assert "proxy_address" in data, "Response should have 'proxy_address'"
        assert "platform" in data, "Response should have 'platform'"
        assert "outcome" in data, "Response should have 'outcome'"
        assert "amount_usdc" in data, "Response should have 'amount_usdc'"
        assert "routing" in data, "Response should have 'routing'"
        assert "instructions" in data, "Response should have 'instructions'"
        
        # Value assertions
        assert data["platform"] == "polymarket"
        assert data["outcome"] == "YES"
        assert data["amount_usdc"] == 10
        assert data["proxy_address"].startswith("0x")
        assert len(data["bet_id"]) > 10
        assert "privacy_fee_usdc" in data
        assert "estimated_payout_if_win" in data
        
        print(f"✓ Polymarket YES bet prepared: {data['bet_id'][:16]}... proxy: {data['proxy_address'][:12]}...")
    
    def test_polymarket_prepare_private_bet_no(self):
        """POST /api/polymarket/prepare-private-bet - NO outcome"""
        payload = {
            "bettor_address": TEST_ADDRESS,
            "condition_id": "test_condition_789",
            "token_id": "no_token_xyz",
            "outcome": "NO",
            "amount_usdc": 25,
            "chain": "polygon"
        }
        response = requests.post(f"{BASE_URL}/api/polymarket/prepare-private-bet", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["outcome"] == "NO"
        assert data["amount_usdc"] == 25
        assert "net_bet_usdc" in data, "Response should have 'net_bet_usdc'"
        
        # Verify privacy fee is deducted
        assert data["net_bet_usdc"] < data["amount_usdc"], "Net bet should be less than amount (privacy fee)"
        
        print(f"✓ Polymarket NO bet prepared: ${data['amount_usdc']} USDC, net: ${data['net_bet_usdc']:.4f}")


class TestDeFiEndpointResponses:
    """Cross-cutting tests for DeFi endpoint response structure"""
    
    def test_uniswap_quote_privacy_fields(self):
        """Verify privacy-related fields in Uniswap quote"""
        payload = {
            "chain": "base",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_in": "1.0",
            "stealth_recipient": TEST_STEALTH,
            "fee_tier": "medium"
        }
        response = requests.post(f"{BASE_URL}/api/uniswap/quote", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        # Privacy-specific fields
        assert data.get("privacy_layer") == "enabled"
        assert "privacy_fee" in str(data)
        assert "stealth" in data.get("routing", "").lower() or "privacy" in data.get("routing", "").lower()
        print("✓ Uniswap quote contains proper privacy fields")
    
    def test_hyperliquid_trade_privacy_routing(self):
        """Verify routing info in Hyperliquid trade"""
        payload = {
            "trader_address": TEST_ADDRESS,
            "asset": "ETH",
            "is_buy": True,
            "size": 50,
            "leverage": 2,
            "chain": "arbitrum"
        }
        response = requests.post(f"{BASE_URL}/api/hyperliquid/prepare-private-trade", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify routing contains privacy elements
        routing = data.get("routing", "")
        assert "stealth" in routing.lower() or "proxy" in routing.lower()
        assert "hyperliquid" in routing.lower()
        print(f"✓ Hyperliquid routing: {routing}")
    
    def test_polymarket_bet_privacy_fee_calculation(self):
        """Verify privacy fee is correctly calculated"""
        amount = 100.0
        payload = {
            "bettor_address": TEST_ADDRESS,
            "condition_id": "fee_test_condition",
            "token_id": "fee_test_token",
            "outcome": "YES",
            "amount_usdc": amount,
            "chain": "polygon"
        }
        response = requests.post(f"{BASE_URL}/api/polymarket/prepare-private-bet", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        privacy_fee = data.get("privacy_fee_usdc", 0)
        net_bet = data.get("net_bet_usdc", 0)
        
        # 0.05% fee = 0.0005 * 100 = 0.05
        expected_fee = amount * 0.0005
        assert abs(privacy_fee - expected_fee) < 0.001, f"Expected fee ~{expected_fee}, got {privacy_fee}"
        assert abs(net_bet - (amount - expected_fee)) < 0.001
        
        print(f"✓ Polymarket privacy fee: ${privacy_fee:.4f} (0.05% of ${amount})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
