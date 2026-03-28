"""
Backend API Tests for Universal Privacy Layer - 4 New Features
- Wallet Privacy Analyzer
- Privacy Address Book
- ZK Commitments
- Encrypted Receipts
"""

import pytest
import requests
import os
import hashlib
import secrets
from datetime import datetime

# Get backend URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL environment variable is required")

ACCESS_CODE = "ROTATED-ACCESS-CODE"

# Test wallet addresses
TEST_OWNER_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"  # vitalik.eth
TEST_OWNER_ADDRESS_2 = "0x742d35Cc6634C0532925a3b844Bc9e7595f1e123"


class TestAuth:
    """Authentication tests - get session token"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token for all tests"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200, f"Auth failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        assert data.get("granted") == True
        return data["token"]
    
    def test_auth_with_valid_code(self):
        """Test authentication with valid access code"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("granted") == True
        assert "token" in data
        assert "expires_in" in data
        print(f"✓ Auth successful, token received")
    
    def test_auth_with_invalid_code(self):
        """Test authentication with invalid access code"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": "wrong_code"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 401
        print(f"✓ Invalid code correctly rejected")


class TestHealthAndBasics:
    """Basic health check tests"""
    
    def test_health_endpoint(self):
        """Test health endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health check passed")


class TestWalletPrivacyAnalyzer:
    """Tests for Wallet Privacy Analyzer feature - GET /api/analyzer/scan/{address}"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        return response.json()["token"]
    
    def test_scan_known_address(self, auth_token):
        """Test scanning vitalik.eth address - should have activity on multiple chains"""
        response = requests.get(
            f"{BASE_URL}/api/analyzer/scan/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Scan failed: {response.text}"
        data = response.json()
        
        # Verify required fields
        assert "address" in data
        assert data["address"] == TEST_OWNER_ADDRESS
        assert "privacy_score" in data
        assert isinstance(data["privacy_score"], int)
        assert 0 <= data["privacy_score"] <= 100
        
        assert "grade" in data
        assert data["grade"] in ["A+", "A", "B", "C", "D", "F"]
        
        assert "chain_data" in data
        assert isinstance(data["chain_data"], dict)
        
        assert "risks" in data
        assert isinstance(data["risks"], list)
        
        assert "recommendations" in data
        assert isinstance(data["recommendations"], list)
        
        assert "total_tx_count" in data
        assert "chains_with_balance" in data
        assert "chains_with_activity" in data
        assert "scanned_at" in data
        
        print(f"✓ Wallet analyzer scan successful")
        print(f"  - Privacy Score: {data['privacy_score']}")
        print(f"  - Grade: {data['grade']}")
        print(f"  - Total TX Count: {data['total_tx_count']}")
        print(f"  - Chains with activity: {data['chains_with_activity']}")
        print(f"  - Risks found: {len(data['risks'])}")
    
    def test_scan_returns_chain_data(self, auth_token):
        """Test that chain_data contains expected chains"""
        response = requests.get(
            f"{BASE_URL}/api/analyzer/scan/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        expected_chains = ["base", "arbitrum", "polygon", "optimism", "bnb", "avalanche"]
        for chain in expected_chains:
            assert chain in data["chain_data"], f"Missing chain: {chain}"
            chain_info = data["chain_data"][chain]
            assert "balance_wei" in chain_info
            assert "tx_count" in chain_info
        
        print(f"✓ Chain data contains all expected chains")
    
    def test_scan_without_auth_fails(self):
        """Test that scan without auth token fails"""
        response = requests.get(f"{BASE_URL}/api/analyzer/scan/{TEST_OWNER_ADDRESS}")
        assert response.status_code == 401
        print(f"✓ Unauthorized scan correctly rejected")


class TestPrivacyAddressBook:
    """Tests for Privacy Address Book feature - CRUD operations"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        return response.json()["token"]
    
    @pytest.fixture
    def test_entry_data(self):
        """Generate unique test entry data"""
        return {
            "owner_address": TEST_OWNER_ADDRESS,
            "label": f"TEST_Contact_{secrets.token_hex(4)}",
            "stealth_meta_address": "st:eth:0x" + secrets.token_hex(66),
            "public_address": "0x" + secrets.token_hex(20),
            "notes_encrypted": "encrypted_notes_here",
            "chain": "base"
        }
    
    def test_add_contact(self, auth_token, test_entry_data):
        """Test adding a contact to address book"""
        response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json=test_entry_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Add contact failed: {response.text}"
        data = response.json()
        
        assert "entry_id" in data
        assert "label" in data
        assert data["label"] == test_entry_data["label"]
        
        print(f"✓ Contact added successfully: {data['entry_id']}")
        return data["entry_id"]
    
    def test_add_and_get_contacts(self, auth_token, test_entry_data):
        """Test adding a contact and then retrieving it"""
        # Add contact
        add_response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json=test_entry_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert add_response.status_code == 200
        entry_id = add_response.json()["entry_id"]
        
        # Get contacts for owner
        get_response = requests.get(
            f"{BASE_URL}/api/addressbook/{test_entry_data['owner_address']}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert get_response.status_code == 200, f"Get contacts failed: {get_response.text}"
        data = get_response.json()
        
        assert "entries" in data
        assert "count" in data
        assert isinstance(data["entries"], list)
        
        # Find our entry
        found = False
        for entry in data["entries"]:
            if entry.get("entry_id") == entry_id:
                found = True
                assert entry["label"] == test_entry_data["label"]
                assert entry["chain"] == test_entry_data["chain"]
                break
        
        assert found, f"Entry {entry_id} not found in address book"
        print(f"✓ Contact retrieved successfully, total contacts: {data['count']}")
    
    def test_delete_contact(self, auth_token, test_entry_data):
        """Test deleting a contact from address book"""
        # First add a contact
        add_response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json=test_entry_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert add_response.status_code == 200
        entry_id = add_response.json()["entry_id"]
        
        # Delete the contact
        delete_response = requests.delete(
            f"{BASE_URL}/api/addressbook/{entry_id}",
            json={"owner_address": test_entry_data["owner_address"]},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        data = delete_response.json()
        
        assert data.get("deleted") == True
        assert data.get("entry_id") == entry_id
        
        # Verify it's deleted by trying to find it
        get_response = requests.get(
            f"{BASE_URL}/api/addressbook/{test_entry_data['owner_address']}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        entries = get_response.json().get("entries", [])
        for entry in entries:
            assert entry.get("entry_id") != entry_id, "Entry should be deleted"
        
        print(f"✓ Contact deleted successfully")
    
    def test_delete_nonexistent_contact(self, auth_token):
        """Test deleting a non-existent contact returns 404"""
        response = requests.delete(
            f"{BASE_URL}/api/addressbook/nonexistent-id-12345",
            json={"owner_address": TEST_OWNER_ADDRESS},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 404
        print(f"✓ Delete non-existent contact correctly returns 404")
    
    def test_get_empty_addressbook(self, auth_token):
        """Test getting address book for address with no contacts"""
        random_address = "0x" + secrets.token_hex(20)
        response = requests.get(
            f"{BASE_URL}/api/addressbook/{random_address}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["entries"] == []
        print(f"✓ Empty address book returns correctly")


class TestZKCommitments:
    """Tests for ZK Commitments feature - create, list, verify"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        return response.json()["token"]
    
    def _create_commitment(self, amount_wei: str, blinding_factor: str) -> str:
        """Helper to create commitment hash: SHA-256(amount_wei + blinding_factor)"""
        return hashlib.sha256((amount_wei + blinding_factor).encode()).hexdigest()
    
    def test_create_commitment(self, auth_token):
        """Test creating a ZK commitment"""
        amount_wei = "1000000000000000000"  # 1 ETH in wei
        blinding_factor = secrets.token_hex(32)
        commitment_hash = self._create_commitment(amount_wei, blinding_factor)
        
        response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "base",
                "label": "TEST_Commitment"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Create commitment failed: {response.text}"
        data = response.json()
        
        assert "commitment_id" in data
        assert "commitment_hash" in data
        assert data["commitment_hash"] == commitment_hash
        
        print(f"✓ ZK Commitment created: {data['commitment_id']}")
        return data["commitment_id"], amount_wei, blinding_factor
    
    def test_get_commitments(self, auth_token):
        """Test getting commitments for an address"""
        # First create a commitment
        amount_wei = "2000000000000000000"
        blinding_factor = secrets.token_hex(32)
        commitment_hash = self._create_commitment(amount_wei, blinding_factor)
        
        create_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "arbitrum",
                "label": "TEST_GetCommitment"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert create_response.status_code == 200
        commitment_id = create_response.json()["commitment_id"]
        
        # Get commitments
        get_response = requests.get(
            f"{BASE_URL}/api/zk-commitments/{TEST_OWNER_ADDRESS}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert get_response.status_code == 200, f"Get commitments failed: {get_response.text}"
        data = get_response.json()
        
        assert "commitments" in data
        assert "count" in data
        assert isinstance(data["commitments"], list)
        
        # Find our commitment
        found = False
        for c in data["commitments"]:
            if c.get("commitment_id") == commitment_id:
                found = True
                assert c["commitment_hash"] == commitment_hash
                assert c["amount_range"] == "1-10 ETH"
                assert c["revealed"] == False
                break
        
        assert found, f"Commitment {commitment_id} not found"
        print(f"✓ Commitments retrieved, count: {data['count']}")
    
    def test_verify_commitment_valid(self, auth_token):
        """Test verifying a commitment with correct amount and blinding factor"""
        # Create commitment
        amount_wei = "5000000000000000000"  # 5 ETH
        blinding_factor = secrets.token_hex(32)
        commitment_hash = self._create_commitment(amount_wei, blinding_factor)
        
        create_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "polygon"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert create_response.status_code == 200
        commitment_id = create_response.json()["commitment_id"]
        
        # Verify with correct values
        verify_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/verify",
            json={
                "commitment_id": commitment_id,
                "amount_wei": amount_wei,
                "blinding_factor": blinding_factor
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert verify_response.status_code == 200, f"Verify failed: {verify_response.text}"
        data = verify_response.json()
        
        assert data["commitment_id"] == commitment_id
        assert data["is_valid"] == True
        assert data["recomputed_hash"] == commitment_hash
        assert data["stored_hash"] == commitment_hash
        
        print(f"✓ ZK Commitment verified successfully")
    
    def test_verify_commitment_invalid(self, auth_token):
        """Test verifying a commitment with wrong values returns is_valid=False"""
        # Create commitment
        amount_wei = "3000000000000000000"
        blinding_factor = secrets.token_hex(32)
        commitment_hash = self._create_commitment(amount_wei, blinding_factor)
        
        create_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={
                "owner_address": TEST_OWNER_ADDRESS,
                "commitment_hash": commitment_hash,
                "amount_range": "1-10 ETH",
                "chain": "optimism"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert create_response.status_code == 200
        commitment_id = create_response.json()["commitment_id"]
        
        # Verify with WRONG blinding factor
        verify_response = requests.post(
            f"{BASE_URL}/api/zk-commitments/verify",
            json={
                "commitment_id": commitment_id,
                "amount_wei": amount_wei,
                "blinding_factor": "wrong_blinding_factor"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert verify_response.status_code == 200
        data = verify_response.json()
        
        assert data["is_valid"] == False
        assert data["recomputed_hash"] != data["stored_hash"]
        
        print(f"✓ Invalid commitment correctly rejected")
    
    def test_verify_nonexistent_commitment(self, auth_token):
        """Test verifying a non-existent commitment returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/zk-commitments/verify",
            json={
                "commitment_id": "nonexistent-id-12345",
                "amount_wei": "1000000000000000000",
                "blinding_factor": "test"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 404
        print(f"✓ Non-existent commitment correctly returns 404")


class TestEncryptedReceipts:
    """Tests for Encrypted Receipts feature - create and decrypt"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/verify-access",
            json={"code": ACCESS_CODE}
        )
        return response.json()["token"]
    
    def test_create_receipt(self, auth_token):
        """Test creating an encrypted receipt"""
        receipt_data = {
            "transaction_hash": "0x" + secrets.token_hex(32),
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "1000000000000000000",
            "chain": "base",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json=receipt_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Create receipt failed: {response.text}"
        data = response.json()
        
        assert "receipt_id" in data
        assert "encrypted_data" in data
        assert "one_time_code" in data
        assert "created_at" in data
        
        # Verify encrypted_data is base64 encoded
        assert len(data["encrypted_data"]) > 0
        
        # Verify one_time_code is hex
        assert len(data["one_time_code"]) == 32  # 16 bytes = 32 hex chars
        
        print(f"✓ Encrypted receipt created: {data['receipt_id']}")
        return data
    
    def test_create_and_decrypt_receipt(self, auth_token):
        """Test full cycle: create receipt and decrypt it"""
        # Create receipt
        tx_hash = "0x" + secrets.token_hex(32)
        receipt_data = {
            "transaction_hash": tx_hash,
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "2500000000000000000",
            "chain": "arbitrum",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json=receipt_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert create_response.status_code == 200
        created = create_response.json()
        
        receipt_id = created["receipt_id"]
        one_time_code = created["one_time_code"]
        
        # Decrypt receipt
        decrypt_response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={
                "receipt_id": receipt_id,
                "one_time_code": one_time_code
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert decrypt_response.status_code == 200, f"Decrypt failed: {decrypt_response.text}"
        data = decrypt_response.json()
        
        assert "receipt" in data
        decrypted = data["receipt"]
        
        # Verify decrypted data matches original
        assert decrypted["transaction_hash"] == tx_hash
        assert decrypted["sender"] == receipt_data["sender_address"]
        assert decrypted["amount_wei"] == receipt_data["amount_wei"]
        assert decrypted["chain"] == receipt_data["chain"]
        
        print(f"✓ Receipt decrypted successfully, tx_hash matches")
    
    def test_decrypt_with_wrong_code(self, auth_token):
        """Test decrypting with wrong one-time code fails"""
        # Create receipt
        receipt_data = {
            "transaction_hash": "0x" + secrets.token_hex(32),
            "sender_address": TEST_OWNER_ADDRESS,
            "recipient_stealth_address": "0x" + secrets.token_hex(20),
            "amount_wei": "1000000000000000000",
            "chain": "polygon",
            "timestamp": datetime.utcnow().isoformat()
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json=receipt_data,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert create_response.status_code == 200
        receipt_id = create_response.json()["receipt_id"]
        
        # Try to decrypt with wrong code
        decrypt_response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={
                "receipt_id": receipt_id,
                "one_time_code": "wrong_code_here"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert decrypt_response.status_code == 401
        print(f"✓ Wrong one-time code correctly rejected")
    
    def test_decrypt_nonexistent_receipt(self, auth_token):
        """Test decrypting non-existent receipt returns 404"""
        response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={
                "receipt_id": "nonexistent-receipt-id",
                "one_time_code": "some_code"
            },
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 404
        print(f"✓ Non-existent receipt correctly returns 404")


class TestAPIWithoutAuth:
    """Test that protected endpoints require authentication"""
    
    def test_addressbook_requires_auth(self):
        """Test address book endpoints require auth"""
        response = requests.post(
            f"{BASE_URL}/api/addressbook/add",
            json={"owner_address": TEST_OWNER_ADDRESS, "label": "test"}
        )
        assert response.status_code == 401
        
        response = requests.get(f"{BASE_URL}/api/addressbook/{TEST_OWNER_ADDRESS}")
        assert response.status_code == 401
        
        print(f"✓ Address book endpoints require auth")
    
    def test_zk_commitments_requires_auth(self):
        """Test ZK commitments endpoints require auth"""
        response = requests.post(
            f"{BASE_URL}/api/zk-commitments/create",
            json={"owner_address": TEST_OWNER_ADDRESS, "commitment_hash": "test", "amount_range": "1-10 ETH"}
        )
        assert response.status_code == 401
        
        response = requests.get(f"{BASE_URL}/api/zk-commitments/{TEST_OWNER_ADDRESS}")
        assert response.status_code == 401
        
        print(f"✓ ZK commitments endpoints require auth")
    
    def test_receipts_requires_auth(self):
        """Test receipt endpoints require auth"""
        response = requests.post(
            f"{BASE_URL}/api/receipt/create",
            json={
                "transaction_hash": "0x123",
                "sender_address": TEST_OWNER_ADDRESS,
                "recipient_stealth_address": "0x456",
                "amount_wei": "1000",
                "chain": "base",
                "timestamp": "2024-01-01T00:00:00Z"
            }
        )
        assert response.status_code == 401
        
        response = requests.post(
            f"{BASE_URL}/api/receipt/decrypt",
            json={"receipt_id": "test", "one_time_code": "test"}
        )
        assert response.status_code == 401
        
        print(f"✓ Receipt endpoints require auth")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
