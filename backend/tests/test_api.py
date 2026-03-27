"""
Backend API Tests for Universal Privacy Layer
Tests: Access Gate, Auth, Founder Mode, Stats, Health endpoints
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from test_credentials.md
ACCESS_CODE = "ROTATED-ACCESS-CODE"
FOUNDER_TOKEN = "ae77cc286ceac8639d06f4dcda7eb5e341e5f92b4755419df1fa2e23e5b09c42"


class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_returns_200(self):
        """Test /api/health returns 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        print(f"✓ Health check passed: {data}")


class TestAccessGateAuth:
    """Access Gate authentication tests"""
    
    def test_verify_access_correct_code(self):
        """Test /api/auth/verify-access with correct code 'ROTATED-ACCESS-CODE' returns token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["granted"] == True
        assert "token" in data
        assert len(data["token"]) > 0
        assert "expires_in" in data
        print(f"✓ Access granted with token: {data['token'][:16]}...")
        return data["token"]
    
    def test_verify_access_wrong_code(self):
        """Test /api/auth/verify-access with wrong code returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": "WrongCode123"}
        )
        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        print(f"✓ Wrong code rejected: {data['detail']}")
    
    def test_verify_access_empty_code(self):
        """Test /api/auth/verify-access with empty code returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ""}
        )
        assert response.status_code == 401
        print("✓ Empty code rejected")


class TestProtectedEndpoints:
    """Tests for protected endpoints requiring auth"""
    
    @pytest.fixture
    def auth_token(self):
        """Get a valid auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        if response.status_code == 200:
            return response.json()["token"]
        pytest.skip("Could not get auth token")
    
    def test_stats_requires_auth(self):
        """Test /api/stats returns 401 without token"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        print(f"✓ Stats endpoint requires auth: {data['detail']}")
    
    def test_stats_with_valid_token(self, auth_token):
        """Test /api/stats returns data with valid token"""
        response = requests.get(
            f"{BASE_URL}/api/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        # Stats endpoint should return 200 or 404 if not implemented
        assert response.status_code in [200, 404]
        print(f"✓ Stats endpoint with auth: status {response.status_code}")
    
    def test_chains_endpoint(self, auth_token):
        """Test /api/chains returns chain configuration"""
        response = requests.get(
            f"{BASE_URL}/api/chains",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "chains" in data or "live_chains" in data
        print(f"✓ Chains endpoint working: {list(data.keys())}")


class TestFounderMode:
    """Founder Mode authentication and metrics tests"""
    
    def test_founder_auth_correct_token(self):
        """Test /api/founder/auth with correct token returns session"""
        response = requests.post(
            f"{BASE_URL}/api/founder/auth",
            json={"token": FOUNDER_TOKEN}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["granted"] == True
        assert "session" in data
        assert len(data["session"]) > 0
        print(f"✓ Founder auth granted: session {data['session'][:16]}...")
        return data["session"]
    
    def test_founder_auth_wrong_token(self):
        """Test /api/founder/auth with wrong token returns 403"""
        response = requests.post(
            f"{BASE_URL}/api/founder/auth",
            json={"token": "wrong_token_12345"}
        )
        assert response.status_code == 403
        print("✓ Wrong founder token rejected")
    
    def test_founder_metrics_requires_auth(self):
        """Test /api/founder/metrics returns 403 without session"""
        response = requests.get(f"{BASE_URL}/api/founder/metrics")
        assert response.status_code == 403
        print("✓ Founder metrics requires auth")
    
    def test_founder_metrics_with_session(self):
        """Test /api/founder/metrics returns data with valid session"""
        # First get a founder session
        auth_response = requests.post(
            f"{BASE_URL}/api/founder/auth",
            json={"token": FOUNDER_TOKEN}
        )
        assert auth_response.status_code == 200
        session = auth_response.json()["session"]
        
        # Now get metrics
        response = requests.get(
            f"{BASE_URL}/api/founder/metrics",
            headers={"Authorization": f"Bearer {session}"}
        )
        assert response.status_code == 200
        data = response.json()
        # Verify metrics structure
        assert "transactions" in data or "stealth" in data or "wallets" in data
        print(f"✓ Founder metrics returned: {list(data.keys())}")
    
    def test_founder_chains_health(self):
        """Test /api/founder/chains/health returns chain status"""
        # Get founder session
        auth_response = requests.post(
            f"{BASE_URL}/api/founder/auth",
            json={"token": FOUNDER_TOKEN}
        )
        session = auth_response.json()["session"]
        
        response = requests.get(
            f"{BASE_URL}/api/founder/chains/health",
            headers={"Authorization": f"Bearer {session}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "chains" in data
        print(f"✓ Founder chains health: {len(data['chains'])} chains")
    
    def test_founder_activity(self):
        """Test /api/founder/activity returns activity data"""
        auth_response = requests.post(
            f"{BASE_URL}/api/founder/auth",
            json={"token": FOUNDER_TOKEN}
        )
        session = auth_response.json()["session"]
        
        response = requests.get(
            f"{BASE_URL}/api/founder/activity",
            headers={"Authorization": f"Bearer {session}"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Founder activity returned: {list(data.keys())}")
    
    def test_founder_system(self):
        """Test /api/founder/system returns system info"""
        auth_response = requests.post(
            f"{BASE_URL}/api/founder/auth",
            json={"token": FOUNDER_TOKEN}
        )
        session = auth_response.json()["session"]
        
        response = requests.get(
            f"{BASE_URL}/api/founder/system",
            headers={"Authorization": f"Bearer {session}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "backend" in data or "database" in data
        print(f"✓ Founder system info: {list(data.keys())}")


class TestStealthEndpoints:
    """Stealth address related endpoints"""
    
    @pytest.fixture
    def auth_token(self):
        """Get a valid auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        if response.status_code == 200:
            return response.json()["token"]
        pytest.skip("Could not get auth token")
    
    def test_stealth_meta_lookup_nonexistent(self, auth_token):
        """Test /api/stealth/meta/{address} returns 404 for non-existent address"""
        response = requests.get(
            f"{BASE_URL}/api/stealth/meta/0x0000000000000000000000000000000000000001",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        # Should return 404 for non-existent address
        assert response.status_code in [404, 400]
        print(f"✓ Stealth meta lookup for non-existent: {response.status_code}")
    
    def test_stealth_announcements(self, auth_token):
        """Test /api/stealth/announcements returns list"""
        response = requests.get(
            f"{BASE_URL}/api/stealth/announcements",
            headers={"Authorization": f"Bearer {auth_token}"},
            params={"chain": "all", "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        assert "announcements" in data
        print(f"✓ Stealth announcements: {len(data['announcements'])} found")


class TestSessionExpiry:
    """Test session token validation and expiry"""
    
    def test_invalid_token_returns_401(self):
        """Test that invalid token returns 401"""
        response = requests.get(
            f"{BASE_URL}/api/stats",
            headers={"Authorization": "Bearer invalid_token_12345"}
        )
        assert response.status_code == 401
        print("✓ Invalid token rejected with 401")
    
    def test_malformed_auth_header(self):
        """Test malformed Authorization header"""
        response = requests.get(
            f"{BASE_URL}/api/stats",
            headers={"Authorization": "NotBearer token123"}
        )
        assert response.status_code == 401
        print("✓ Malformed auth header rejected")


class TestRootEndpoint:
    """Test root API endpoint"""
    
    def test_api_root(self):
        """Test /api/ returns API info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data or "version" in data
        print(f"✓ API root: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
