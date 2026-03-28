"""
Test suite for pricing page and Polymarket mock data removal verification.
Tests:
1. Auth flow with access code 'ROTATED-ACCESS-CODE'
2. Polymarket API returns real data (not mock)
3. Stats endpoint works with auth
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://crypto-shield-24.preview.emergentagent.com"

ACCESS_CODE = "ROTATED-ACCESS-CODE"


class TestAuthFlow:
    """Test authentication with access code"""
    
    def test_health_endpoint(self):
        """Health endpoint should be public"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"PASS: Health endpoint returns {data}")
    
    def test_auth_verify_access_correct_code(self):
        """Correct access code should return token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["granted"] == True
        print(f"PASS: Auth with correct code returns token: {data['token'][:20]}...")
    
    def test_auth_verify_access_wrong_code(self):
        """Wrong access code should return 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": "wrong_code"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401
        print("PASS: Wrong code returns 401")


class TestPolymarketNoMockData:
    """Verify Polymarket endpoint returns real data, not mock"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for protected endpoints"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE},
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_polymarket_requires_auth(self):
        """Polymarket endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/polymarket/markets")
        assert response.status_code == 401
        print("PASS: Polymarket endpoint requires auth (401 without token)")
    
    def test_polymarket_returns_real_data_or_503(self, auth_token):
        """
        Polymarket endpoint should return real data from CLOB API
        or 503 if API is unreachable (NOT mock data)
        """
        response = requests.get(
            f"{BASE_URL}/api/polymarket/markets",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Should be 200 (real data) or 503 (API unreachable)
        assert response.status_code in [200, 502, 503], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "markets" in data
            assert "source" in data
            assert data["source"] == "polymarket_clob"
            
            # Verify it's real data - check for real market structure
            if len(data["markets"]) > 0:
                market = data["markets"][0]
                # Real Polymarket data has these fields
                assert "condition_id" in market or "question" in market
                print(f"PASS: Polymarket returns real data with {len(data['markets'])} markets")
                print(f"  Source: {data['source']}")
                if "question" in market:
                    print(f"  Sample market: {market['question'][:50]}...")
        else:
            # 502/503 means API is unreachable - this is acceptable (not mock data)
            data = response.json()
            assert "detail" in data
            assert "unreachable" in data["detail"].lower() or "non-200" in data["detail"].lower()
            print(f"PASS: Polymarket API unreachable (503) - no mock data returned")
            print(f"  Error: {data['detail']}")


class TestStatsEndpoint:
    """Test stats endpoint with authentication"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for protected endpoints"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE},
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_stats_requires_auth(self):
        """Stats endpoint should require authentication"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 401
        print("PASS: Stats endpoint requires auth (401 without token)")
    
    def test_stats_with_auth(self, auth_token):
        """Stats endpoint should work with valid token"""
        response = requests.get(
            f"{BASE_URL}/api/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_transactions" in data
        assert "live_chains" in data
        print(f"PASS: Stats endpoint returns data: {data}")


class TestChainsEndpoint:
    """Test chains endpoint"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for protected endpoints"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE},
            headers={"Content-Type": "application/json"}
        )
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed")
    
    def test_chains_endpoint(self, auth_token):
        """Chains endpoint should return supported chains"""
        response = requests.get(
            f"{BASE_URL}/api/chains",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "chains" in data
        assert "live_chains" in data
        # Should have 7 live chains
        assert len(data["live_chains"]) >= 7
        print(f"PASS: Chains endpoint returns {len(data['live_chains'])} live chains: {data['live_chains']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
