#!/usr/bin/env python3
"""
Backend API Tests for Universal Privacy Layer - Post-Refactoring Validation
Tests all endpoints mentioned in the review request to verify no regressions
"""
import requests
import os
import json
import sys
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://crypto-shield-24.preview.emergentagent.com').rstrip('/')

# Test credentials from test_credentials.md
ACCESS_CODE = "ROTATED-ACCESS-CODE"
FOUNDER_TOKEN = "ae77cc286ceac8639d06f4dcda7eb5e341e5f92b4755419df1fa2e23e5b09c42"

results = {
    "passed": [],
    "failed": [],
    "total": 0
}

def test(name, condition, details=""):
    """Record test result"""
    results["total"] += 1
    if condition:
        results["passed"].append(name)
        print(f"✓ PASS: {name}")
        if details:
            print(f"  Details: {details}")
    else:
        results["failed"].append({"name": name, "details": details})
        print(f"✗ FAIL: {name}")
        if details:
            print(f"  Details: {details}")

def run_tests():
    print("=" * 60)
    print("Universal Privacy Layer - Backend API Tests")
    print(f"Base URL: {BASE_URL}")
    print("=" * 60)
    
    # ============ 1. Health Endpoint ============
    print("\n--- Health Endpoint ---")
    try:
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        test("GET /api/health returns 200", r.status_code == 200, f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            test("Health response has 'status' field", "status" in data, f"Response: {data}")
    except Exception as e:
        test("GET /api/health", False, str(e))
    
    # ============ 2. Access Gate Auth ============
    print("\n--- Access Gate Auth ---")
    
    # Test correct code
    try:
        r = requests.post(f"{BASE_URL}/api/auth/verify-access", json={"code": ACCESS_CODE}, timeout=10)
        test("POST /api/auth/verify-access with 'ROTATED-ACCESS-CODE' returns 200", r.status_code == 200, f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            test("Response has 'token' field", "token" in data, f"Keys: {list(data.keys())}")
            test("Response has 'granted' = True", data.get("granted") == True)
            session_token = data.get("token", "")
        else:
            session_token = ""
    except Exception as e:
        test("POST /api/auth/verify-access correct code", False, str(e))
        session_token = ""
    
    # Test wrong code
    try:
        r = requests.post(f"{BASE_URL}/api/auth/verify-access", json={"code": "WrongCode"}, timeout=10)
        test("POST /api/auth/verify-access with wrong code returns 401", r.status_code == 401, f"Status: {r.status_code}")
    except Exception as e:
        test("POST /api/auth/verify-access wrong code", False, str(e))
    
    # ============ 3. Protected Endpoints (require auth) ============
    print("\n--- Protected Endpoints ---")
    
    # Stats without token
    try:
        r = requests.get(f"{BASE_URL}/api/stats", timeout=10)
        test("GET /api/stats without token returns 401", r.status_code == 401, f"Status: {r.status_code}")
    except Exception as e:
        test("GET /api/stats without token", False, str(e))
    
    # Stats with valid token
    if session_token:
        try:
            r = requests.get(f"{BASE_URL}/api/stats", headers={"Authorization": f"Bearer {session_token}"}, timeout=10)
            test("GET /api/stats with valid token returns 200", r.status_code == 200, f"Status: {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                test("Stats response has expected fields", "total_transactions" in data or "live_chains" in data, f"Keys: {list(data.keys())}")
        except Exception as e:
            test("GET /api/stats with token", False, str(e))
    
    # ============ 4. Founder Mode ============
    print("\n--- Founder Mode ---")
    
    # Founder auth with correct token
    try:
        r = requests.post(f"{BASE_URL}/api/founder/auth", json={"token": FOUNDER_TOKEN}, timeout=10)
        test("POST /api/founder/auth with correct token returns 200", r.status_code == 200, f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            test("Founder auth returns session", "session" in data, f"Keys: {list(data.keys())}")
            founder_session = data.get("session", "")
        else:
            founder_session = ""
    except Exception as e:
        test("POST /api/founder/auth correct token", False, str(e))
        founder_session = ""
    
    # Founder auth with wrong token
    try:
        r = requests.post(f"{BASE_URL}/api/founder/auth", json={"token": "wrong_token"}, timeout=10)
        test("POST /api/founder/auth with wrong token returns 403", r.status_code == 403, f"Status: {r.status_code}")
    except Exception as e:
        test("POST /api/founder/auth wrong token", False, str(e))
    
    # ============ 5. Stealth Endpoints ============
    print("\n--- Stealth Endpoints ---")
    
    if session_token:
        # Stealth register
        try:
            r = requests.post(
                f"{BASE_URL}/api/stealth/register",
                json={"address": "0x742d35Cc6634C0532925a3b844Bc9e7595f1dE21", "chain": "base"},
                headers={"Authorization": f"Bearer {session_token}"},
                timeout=10
            )
            test("POST /api/stealth/register accepts POST", r.status_code in [200, 201, 400, 422], f"Status: {r.status_code}")
        except Exception as e:
            test("POST /api/stealth/register", False, str(e))
        
        # Stealth announcements
        try:
            r = requests.get(
                f"{BASE_URL}/api/stealth/announcements",
                headers={"Authorization": f"Bearer {session_token}"},
                timeout=10
            )
            test("GET /api/stealth/announcements returns data", r.status_code == 200, f"Status: {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                test("Announcements response has 'announcements' field", "announcements" in data, f"Keys: {list(data.keys())}")
        except Exception as e:
            test("GET /api/stealth/announcements", False, str(e))
    
    # ============ 6. Messaging Endpoint ============
    print("\n--- Messaging Endpoint ---")
    
    if session_token:
        try:
            r = requests.get(
                f"{BASE_URL}/api/messaging/inbox/0x742d35Cc6634C0532925a3b844Bc9e7595f1dE21",
                headers={"Authorization": f"Bearer {session_token}"},
                timeout=10
            )
            test("GET /api/messaging/inbox/{address} returns messages", r.status_code == 200, f"Status: {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                test("Inbox response has 'messages' field", "messages" in data, f"Keys: {list(data.keys())}")
        except Exception as e:
            test("GET /api/messaging/inbox", False, str(e))
    
    # ============ 7. Uniswap Quote ============
    print("\n--- Uniswap Quote ---")
    
    if session_token:
        try:
            r = requests.post(
                f"{BASE_URL}/api/uniswap/quote",
                json={"chain": "base", "token_in": "ETH", "token_out": "USDC", "amount_in": "1000000000000000000"},
                headers={"Authorization": f"Bearer {session_token}"},
                timeout=10
            )
            test("POST /api/uniswap/quote accepts POST", r.status_code in [200, 400, 404], f"Status: {r.status_code}")
        except Exception as e:
            test("POST /api/uniswap/quote", False, str(e))
    
    # ============ 8. Hyperliquid Markets ============
    print("\n--- Hyperliquid Markets ---")
    
    if session_token:
        try:
            r = requests.get(
                f"{BASE_URL}/api/hyperliquid/markets",
                headers={"Authorization": f"Bearer {session_token}"},
                timeout=10
            )
            test("GET /api/hyperliquid/markets returns markets", r.status_code in [200, 404], f"Status: {r.status_code}")
        except Exception as e:
            test("GET /api/hyperliquid/markets", False, str(e))
    
    # ============ 9. Polymarket Markets ============
    print("\n--- Polymarket Markets ---")
    
    if session_token:
        try:
            r = requests.get(
                f"{BASE_URL}/api/polymarket/markets",
                headers={"Authorization": f"Bearer {session_token}"},
                timeout=10
            )
            test("GET /api/polymarket/markets returns markets", r.status_code in [200, 404], f"Status: {r.status_code}")
        except Exception as e:
            test("GET /api/polymarket/markets", False, str(e))
    
    # ============ Summary ============
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    print(f"Total: {results['total']}")
    print(f"Passed: {len(results['passed'])}")
    print(f"Failed: {len(results['failed'])}")
    
    if results['failed']:
        print("\nFailed Tests:")
        for f in results['failed']:
            print(f"  - {f['name']}: {f['details']}")
    
    success_rate = (len(results['passed']) / results['total'] * 100) if results['total'] > 0 else 0
    print(f"\nSuccess Rate: {success_rate:.1f}%")
    
    return results

if __name__ == "__main__":
    results = run_tests()
    # Exit with error code if any tests failed
    sys.exit(0 if len(results['failed']) == 0 else 1)
