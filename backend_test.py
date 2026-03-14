#!/usr/bin/env python3
"""
Universal Privacy Layer (UPL) Backend API Testing
Tests all API endpoints with real cryptography validation
"""

import requests
import sys
import json
from datetime import datetime
from eth_account import Account

class UPLAPITester:
    def __init__(self, base_url="https://doc-to-deployment.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            print(f"❌ {name} - FAILED: {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })

    def test_health_endpoint(self):
        """Test /api/health endpoint"""
        try:
            response = requests.get(f"{self.api_url}/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "status" in data and data["status"] == "healthy":
                    self.log_test("Health Check", True, f"Status: {data['status']}")
                    return True
                else:
                    self.log_test("Health Check", False, f"Invalid response: {data}")
            else:
                self.log_test("Health Check", False, f"Status code: {response.status_code}")
        except Exception as e:
            self.log_test("Health Check", False, str(e))
        return False

    def test_chains_endpoint(self):
        """Test /api/chains endpoint - now includes contracts info"""
        try:
            response = requests.get(f"{self.api_url}/chains", timeout=10)
            if response.status_code == 200:
                data = response.json()
                if "chains" in data and "contracts" in data:
                    chains = data["chains"]
                    contracts = data["contracts"]
                    expected_chains = ["ethereum_sepolia", "arbitrum_sepolia", "base_sepolia"]
                    
                    # Check if all expected chains are present
                    missing_chains = [chain for chain in expected_chains if chain not in chains]
                    if not missing_chains:
                        # Validate chain structure
                        valid_structure = True
                        for chain_key, chain_data in chains.items():
                            required_fields = ["name", "chain_id", "rpc_url", "explorer", "symbol", "uniswap_router", "weth", "usdc"]
                            if not all(field in chain_data for field in required_fields):
                                valid_structure = False
                                break
                        
                        # Validate contracts structure
                        contracts_valid = True
                        for chain_key in expected_chains:
                            if chain_key in contracts:
                                contract_fields = ["privacy_relayer", "stealth_registry", "uniswap_wrapper"]
                                if not all(field in contracts[chain_key] for field in contract_fields):
                                    contracts_valid = False
                                    break
                            else:
                                contracts_valid = False
                                break
                        
                        if valid_structure and contracts_valid:
                            self.log_test("Chains + Contracts Configuration", True, f"Found {len(chains)} chains with Uniswap integration")
                            return True
                        else:
                            self.log_test("Chains + Contracts Configuration", False, "Invalid chain or contracts structure")
                    else:
                        self.log_test("Chains + Contracts Configuration", False, f"Missing chains: {missing_chains}")
                else:
                    self.log_test("Chains + Contracts Configuration", False, "Missing 'chains' or 'contracts' field in response")
            else:
                self.log_test("Chains + Contracts Configuration", False, f"Status code: {response.status_code}")
        except Exception as e:
            self.log_test("Chains + Contracts Configuration", False, str(e))
        return False

    def test_stealth_address_generation(self):
        """Test /api/stealth/generate endpoint"""
        try:
            # Create a test account for the public address
            test_account = Account.create()
            test_address = test_account.address
            
            payload = {
                "public_address": test_address,
                "chain": "ethereum_sepolia"
            }
            
            response = requests.post(
                f"{self.api_url}/stealth/generate", 
                json=payload, 
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["stealth_address", "ephemeral_public_key", "view_tag", "chain", "created_at"]
                
                if all(field in data for field in required_fields):
                    # Validate stealth address format (should be valid Ethereum address)
                    stealth_addr = data["stealth_address"]
                    if stealth_addr.startswith("0x") and len(stealth_addr) == 42:
                        # Validate view tag (should be 8 character hex)
                        view_tag = data["view_tag"]
                        if len(view_tag) == 8 and all(c in "0123456789abcdef" for c in view_tag.lower()):
                            self.log_test("Stealth Address Generation", True, f"Generated: {stealth_addr[:10]}...")
                            return True
                        else:
                            self.log_test("Stealth Address Generation", False, f"Invalid view tag: {view_tag}")
                    else:
                        self.log_test("Stealth Address Generation", False, f"Invalid address format: {stealth_addr}")
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("Stealth Address Generation", False, f"Missing fields: {missing}")
            else:
                self.log_test("Stealth Address Generation", False, f"Status code: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Stealth Address Generation", False, str(e))
        return False

    def test_wallet_creation(self):
        """Test /api/wallet/create endpoint"""
        try:
            payload = {
                "password": "TestPassword123!"
            }
            
            response = requests.post(
                f"{self.api_url}/wallet/create", 
                json=payload, 
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["wallet_id", "main_address", "privacy_address", "main_seed_phrase", "privacy_seed_phrase"]
                
                if all(field in data for field in required_fields):
                    # Validate addresses
                    main_addr = data["main_address"]
                    privacy_addr = data["privacy_address"]
                    
                    if (main_addr.startswith("0x") and len(main_addr) == 42 and 
                        privacy_addr.startswith("0x") and len(privacy_addr) == 42):
                        
                        # Validate seed phrases (should have 12 words each)
                        main_words = data["main_seed_phrase"].split()
                        privacy_words = data["privacy_seed_phrase"].split()
                        
                        if len(main_words) == 12 and len(privacy_words) == 12:
                            self.log_test("Dual-Key Wallet Creation", True, f"Main: {main_addr[:10]}..., Privacy: {privacy_addr[:10]}...")
                            return True
                        else:
                            self.log_test("Dual-Key Wallet Creation", False, f"Invalid seed phrase lengths: {len(main_words)}, {len(privacy_words)}")
                    else:
                        self.log_test("Dual-Key Wallet Creation", False, "Invalid address formats")
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("Dual-Key Wallet Creation", False, f"Missing fields: {missing}")
            else:
                self.log_test("Dual-Key Wallet Creation", False, f"Status code: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Dual-Key Wallet Creation", False, str(e))
        return False

    def test_receipt_creation_and_decryption(self):
        """Test /api/receipt/create and /api/receipt/decrypt endpoints"""
        try:
            # Create encrypted receipt
            create_payload = {
                "transaction_hash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                "sender_address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b5Da5e",
                "recipient_stealth_address": "0x8ba1f109551bD432803012645Hac136c22C177e9",
                "amount_wei": "1000000000000000000",  # 1 ETH
                "chain": "ethereum_sepolia",
                "timestamp": datetime.now().isoformat()
            }
            
            create_response = requests.post(
                f"{self.api_url}/receipt/create", 
                json=create_payload, 
                timeout=15
            )
            
            if create_response.status_code == 200:
                create_data = create_response.json()
                required_fields = ["receipt_id", "encrypted_data", "one_time_code", "created_at"]
                
                if all(field in create_data for field in required_fields):
                    receipt_id = create_data["receipt_id"]
                    one_time_code = create_data["one_time_code"]
                    
                    # Test decryption
                    decrypt_payload = {
                        "receipt_id": receipt_id,
                        "one_time_code": one_time_code
                    }
                    
                    decrypt_response = requests.post(
                        f"{self.api_url}/receipt/decrypt", 
                        json=decrypt_payload, 
                        timeout=15
                    )
                    
                    if decrypt_response.status_code == 200:
                        decrypt_data = decrypt_response.json()
                        if "receipt" in decrypt_data:
                            receipt = decrypt_data["receipt"]
                            # Verify decrypted data matches original
                            if (receipt.get("transaction_hash") == create_payload["transaction_hash"] and
                                receipt.get("amount_wei") == create_payload["amount_wei"]):
                                self.log_test("Encrypted Receipt System", True, f"Receipt ID: {receipt_id[:8]}...")
                                return True
                            else:
                                self.log_test("Encrypted Receipt System", False, "Decrypted data doesn't match original")
                        else:
                            self.log_test("Encrypted Receipt System", False, "No 'receipt' field in decrypt response")
                    else:
                        self.log_test("Encrypted Receipt System", False, f"Decrypt failed: {decrypt_response.status_code}")
                else:
                    missing = [f for f in required_fields if f not in create_data]
                    self.log_test("Encrypted Receipt System", False, f"Missing fields in create: {missing}")
            else:
                self.log_test("Encrypted Receipt System", False, f"Create failed: {create_response.status_code}, Response: {create_response.text}")
        except Exception as e:
            self.log_test("Encrypted Receipt System", False, str(e))
        return False

    def test_transaction_recording(self):
        """Test /api/transactions/record endpoint"""
        try:
            payload = {
                "tx_hash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                "from_address": "0x742d35Cc6634C0532925a3b8D4C9db96C4b5Da5e",
                "to_address": "0x8ba1f109551bD432803012645Hac136c22C177e9",
                "amount_wei": "500000000000000000",  # 0.5 ETH
                "chain": "ethereum_sepolia",
                "tx_type": "private_send",
                "status": "confirmed"
            }
            
            response = requests.post(
                f"{self.api_url}/transactions/record", 
                json=payload, 
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                if "success" in data and data["success"] and "transaction_id" in data:
                    self.log_test("Transaction Recording", True, f"Transaction ID: {data['transaction_id'][:8]}...")
                    return True
                else:
                    self.log_test("Transaction Recording", False, f"Invalid response: {data}")
            else:
                self.log_test("Transaction Recording", False, f"Status code: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Transaction Recording", False, str(e))
        return False

    def test_balance_endpoint(self):
        """Test /api/balance/{address} endpoint"""
        try:
            # Use a test address (this will likely return 0 balance but should work)
            test_address = "0x742d35Cc6634C0532925a3b8D4C9db96C4b5Da5e"
            
            response = requests.get(
                f"{self.api_url}/balance/{test_address}?chain=ethereum_sepolia", 
                timeout=20  # Longer timeout for RPC calls
            )
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["address", "chain", "main_balance_wei", "stealth_balance_wei", "total_balance_wei", "total_balance_eth", "symbol"]
                
                if all(field in data for field in required_fields):
                    # Validate numeric fields
                    try:
                        int(data["main_balance_wei"])
                        int(data["stealth_balance_wei"])
                        int(data["total_balance_wei"])
                        float(data["total_balance_eth"])
                        self.log_test("Balance Aggregation", True, f"Total: {data['total_balance_eth']} {data['symbol']}")
                        return True
                    except ValueError:
                        self.log_test("Balance Aggregation", False, "Invalid numeric values in balance")
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("Balance Aggregation", False, f"Missing fields: {missing}")
            else:
                self.log_test("Balance Aggregation", False, f"Status code: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Balance Aggregation", False, str(e))
        return False

    def run_all_tests(self):
        """Run all backend API tests"""
        print("🚀 Starting Universal Privacy Layer Backend Tests")
        print(f"🔗 Testing API: {self.api_url}")
        print("=" * 60)
        
        # Core API tests
        self.test_health_endpoint()
        self.test_chains_endpoint()
        
        # Cryptography tests
        self.test_stealth_address_generation()
        self.test_wallet_creation()
        self.test_receipt_creation_and_decryption()
        
        # Transaction tests
        self.test_transaction_recording()
        self.test_balance_endpoint()
        
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All backend tests passed!")
            return True
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return False

def main():
    """Main test execution"""
    tester = UPLAPITester()
    success = tester.run_all_tests()
    
    # Save detailed results
    with open("/app/backend_test_results.json", "w") as f:
        json.dump({
            "summary": {
                "total_tests": tester.tests_run,
                "passed_tests": tester.tests_passed,
                "success_rate": f"{(tester.tests_passed/tester.tests_run)*100:.1f}%",
                "timestamp": datetime.now().isoformat()
            },
            "test_results": tester.test_results
        }, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())