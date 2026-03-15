"""
Test suite for Universal Privacy Layer - 5 New Features (P1/P2)
Tests: ZKP Proofs, On-Chain Relayer, Cross-Chain Split, Encrypted Messaging, Multisig Privacy
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test addresses
TEST_ADDRESS_1 = "0x742d35Cc6634C0532925a3b844Bc9e7595f5fB21"
TEST_ADDRESS_2 = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199"
TEST_ADDRESS_3 = "0xdD2FD4581271e230360230F9337D5c0430Bf44C0"
TEST_STEALTH = "0x1234567890123456789012345678901234567890"


class TestZKPProofs:
    """ZKP Proofs Integration (Feature 1)"""
    
    def test_zkp_generate_inputs(self):
        """Test /api/zkp/generate-inputs creates ZKP inputs"""
        response = requests.post(
            f"{BASE_URL}/api/zkp/generate-inputs",
            json={
                "stealth_address": TEST_STEALTH,
                "spend_key_hash": "0x" + "a" * 64,
                "view_key_hash": "0x" + "b" * 64
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "input_id" in data, "Missing input_id"
        assert "public_inputs" in data, "Missing public_inputs"
        assert "circuit_type" in data, "Missing circuit_type"
        assert "instructions" in data, "Missing instructions"
        
        # Verify public inputs structure
        inputs = data["public_inputs"]
        assert "stealth_address_hash" in inputs
        assert "spend_key_commitment" in inputs
        assert "view_key_commitment" in inputs
        assert "nullifier" in inputs
        assert "timestamp" in inputs
        
        print(f"✓ ZKP inputs generated: input_id={data['input_id'][:8]}...")
        return data
    
    def test_zkp_submit_proof_valid(self):
        """Test /api/zkp/submit-proof submits and verifies ZKP proof"""
        response = requests.post(
            f"{BASE_URL}/api/zkp/submit-proof",
            json={
                "proof_type": "stealth_ownership",
                "public_inputs": ["0x" + "1" * 64, "0x" + "2" * 64],
                "proof_a": ["0x" + "a" * 64, "0x" + "b" * 64],
                "proof_b": [["0x" + "c" * 64, "0x" + "d" * 64], ["0x" + "e" * 64, "0x" + "f" * 64]],
                "proof_c": ["0x" + "1" * 64, "0x" + "2" * 64]
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "proof_id" in data, "Missing proof_id"
        assert "status" in data, "Missing status"
        assert "message" in data, "Missing message"
        
        # Valid format should be verified
        assert data["status"] == "verified", f"Expected verified, got {data['status']}"
        
        print(f"✓ ZKP proof submitted and verified: proof_id={data['proof_id'][:8]}...")
        return data["proof_id"]
    
    def test_zkp_submit_proof_invalid_format(self):
        """Test /api/zkp/submit-proof rejects invalid proof format"""
        response = requests.post(
            f"{BASE_URL}/api/zkp/submit-proof",
            json={
                "proof_type": "stealth_ownership",
                "public_inputs": ["0x" + "1" * 64],
                "proof_a": ["0x" + "a" * 64],  # Invalid: only 1 element instead of 2
                "proof_b": [["0x" + "c" * 64]],  # Invalid format
                "proof_c": ["0x" + "1" * 64]  # Invalid: only 1 element
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "invalid", f"Expected invalid, got {data['status']}"
        print(f"✓ Invalid proof format correctly rejected")
    
    def test_zkp_get_proof_status(self):
        """Test /api/zkp/proof/{proof_id} retrieves proof status"""
        # First create a proof
        create_response = requests.post(
            f"{BASE_URL}/api/zkp/submit-proof",
            json={
                "proof_type": "amount_range",
                "public_inputs": ["0x" + "3" * 64],
                "proof_a": ["0x" + "a" * 64, "0x" + "b" * 64],
                "proof_b": [["0x" + "c" * 64, "0x" + "d" * 64], ["0x" + "e" * 64, "0x" + "f" * 64]],
                "proof_c": ["0x" + "1" * 64, "0x" + "2" * 64]
            }
        )
        proof_id = create_response.json()["proof_id"]
        
        # Get proof status
        response = requests.get(f"{BASE_URL}/api/zkp/proof/{proof_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data["proof_id"] == proof_id
        assert "proof_type" in data
        assert "status" in data
        assert "public_inputs" in data
        assert "proof" in data
        
        print(f"✓ ZKP proof status retrieved: {data['status']}")
    
    def test_zkp_get_proof_not_found(self):
        """Test /api/zkp/proof/{invalid_id} returns 404"""
        response = requests.get(f"{BASE_URL}/api/zkp/proof/nonexistent-proof-id")
        assert response.status_code == 404
        print(f"✓ Non-existent proof returns 404")


class TestOnChainRelayer:
    """On-Chain Relayer Routing (Feature 2)"""
    
    def test_relayer_prepare_tx(self):
        """Test /api/relayer/prepare-tx prepares on-chain relayer transaction"""
        response = requests.post(
            f"{BASE_URL}/api/relayer/prepare-tx",
            json={
                "from_address": TEST_ADDRESS_1,
                "stealth_address": TEST_STEALTH,
                "amount_wei": "100000000000000000",  # 0.1 ETH
                "ephemeral_key": "0x" + "a" * 64,
                "view_tag": 42,
                "chain": "base"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "to" in data, "Missing to address"
        assert "value" in data, "Missing value"
        assert "data" in data, "Missing tx data"
        assert "gas" in data, "Missing gas estimate"
        assert "gasPrice" in data, "Missing gas price"
        assert "chain" in data, "Missing chain"
        assert "chainId" in data, "Missing chainId"
        assert "fee_bps" in data, "Missing fee_bps"
        assert "fee_amount" in data, "Missing fee_amount"
        assert "net_amount" in data, "Missing net_amount"
        assert "relayer_contract" in data, "Missing relayer_contract"
        
        # Verify relayer contract address
        assert data["relayer_contract"] == "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        assert data["chain"] == "base"
        assert data["chainId"] == 8453
        
        print(f"✓ Relayer tx prepared: fee={data['fee_bps']}bps, net={data['net_amount']}")
    
    def test_relayer_prepare_tx_multiple_chains(self):
        """Test relayer prepare works on multiple chains"""
        chains = ["base", "arbitrum", "polygon", "optimism"]
        for chain in chains:
            response = requests.post(
                f"{BASE_URL}/api/relayer/prepare-tx",
                json={
                    "from_address": TEST_ADDRESS_1,
                    "stealth_address": TEST_STEALTH,
                    "amount_wei": "50000000000000000",
                    "ephemeral_key": "0x" + "b" * 64,
                    "view_tag": 100,
                    "chain": chain
                }
            )
            assert response.status_code == 200, f"Failed for chain {chain}: {response.text}"
            data = response.json()
            assert data["chain"] == chain
        
        print(f"✓ Relayer prepare works on {len(chains)} chains")
    
    def test_relayer_prepare_tx_invalid_chain(self):
        """Test relayer prepare rejects invalid chain"""
        response = requests.post(
            f"{BASE_URL}/api/relayer/prepare-tx",
            json={
                "from_address": TEST_ADDRESS_1,
                "stealth_address": TEST_STEALTH,
                "amount_wei": "100000000000000000",
                "ephemeral_key": "0x" + "a" * 64,
                "view_tag": 42,
                "chain": "invalid_chain"
            }
        )
        assert response.status_code == 400
        print(f"✓ Invalid chain correctly rejected")
    
    def test_relayer_stats(self):
        """Test /api/relayer/stats/{chain} returns relayer statistics"""
        response = requests.get(f"{BASE_URL}/api/relayer/stats/base")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "chain" in data, "Missing chain"
        assert "relayer_address" in data, "Missing relayer_address"
        assert "total_relayed_wei" in data, "Missing total_relayed_wei"
        assert "total_relayed" in data, "Missing total_relayed"
        assert "fee_bps" in data, "Missing fee_bps"
        assert "fee_percentage" in data, "Missing fee_percentage"
        
        assert data["chain"] == "base"
        assert data["relayer_address"] == "0x0A81ea0f61fF91E1E0F54A8A645E7174a1FEfB5c"
        
        print(f"✓ Relayer stats: total_relayed={data['total_relayed']}, fee={data['fee_percentage']}")
    
    def test_relayer_stats_invalid_chain(self):
        """Test relayer stats rejects invalid chain"""
        response = requests.get(f"{BASE_URL}/api/relayer/stats/invalid_chain")
        assert response.status_code == 400
        print(f"✓ Invalid chain stats correctly rejected")


class TestCrossChainSplit:
    """Cross-Chain Privacy Splitting (Feature 3)"""
    
    def test_split_prepare(self):
        """Test /api/split/prepare creates cross-chain split plan"""
        response = requests.post(
            f"{BASE_URL}/api/split/prepare",
            json={
                "from_address": TEST_ADDRESS_1,
                "total_amount_wei": "1000000000000000000",  # 1 ETH
                "splits": [
                    {"chain": "base", "stealth_address": TEST_STEALTH, "percentage": 40},
                    {"chain": "arbitrum", "stealth_address": TEST_ADDRESS_2, "percentage": 35},
                    {"chain": "polygon", "stealth_address": TEST_ADDRESS_3, "percentage": 25}
                ]
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "split_id" in data, "Missing split_id"
        assert "total_amount" in data, "Missing total_amount"
        assert "num_chains" in data, "Missing num_chains"
        assert "transactions" in data, "Missing transactions"
        assert "instructions" in data, "Missing instructions"
        
        assert data["num_chains"] == 3
        assert len(data["transactions"]) == 3
        
        # Verify each transaction
        for tx in data["transactions"]:
            assert "chain" in tx
            assert "chain_id" in tx
            assert "stealth_address" in tx
            assert "amount_wei" in tx
            assert "amount" in tx
            assert "percentage" in tx
            assert "ephemeral_key" in tx
            assert "view_tag" in tx
            assert "relayer_contract" in tx
            assert "status" in tx
        
        print(f"✓ Split plan created: {data['num_chains']} chains, total={data['total_amount']}")
        return data["split_id"]
    
    def test_split_prepare_invalid_percentage(self):
        """Test split prepare rejects percentages not totaling 100%"""
        response = requests.post(
            f"{BASE_URL}/api/split/prepare",
            json={
                "from_address": TEST_ADDRESS_1,
                "total_amount_wei": "1000000000000000000",
                "splits": [
                    {"chain": "base", "stealth_address": TEST_STEALTH, "percentage": 40},
                    {"chain": "arbitrum", "stealth_address": TEST_ADDRESS_2, "percentage": 40}
                    # Total: 80%, not 100%
                ]
            }
        )
        assert response.status_code == 400
        print(f"✓ Invalid percentage total correctly rejected")
    
    def test_split_get_status(self):
        """Test /api/split/{split_id} retrieves split status"""
        # First create a split
        create_response = requests.post(
            f"{BASE_URL}/api/split/prepare",
            json={
                "from_address": TEST_ADDRESS_1,
                "total_amount_wei": "500000000000000000",
                "splits": [
                    {"chain": "base", "stealth_address": TEST_STEALTH, "percentage": 60},
                    {"chain": "optimism", "stealth_address": TEST_ADDRESS_2, "percentage": 40}
                ]
            }
        )
        split_id = create_response.json()["split_id"]
        
        # Get split status
        response = requests.get(f"{BASE_URL}/api/split/{split_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data["split_id"] == split_id
        assert "from_address" in data
        assert "total_amount_wei" in data
        assert "transactions" in data
        assert "status" in data
        assert "created_at" in data
        
        print(f"✓ Split status retrieved: status={data['status']}")
    
    def test_split_get_not_found(self):
        """Test /api/split/{invalid_id} returns 404"""
        response = requests.get(f"{BASE_URL}/api/split/nonexistent-split-id")
        assert response.status_code == 404
        print(f"✓ Non-existent split returns 404")


class TestEncryptedMessaging:
    """Encrypted Messaging (Feature 4)"""
    
    def test_messaging_send(self):
        """Test /api/messaging/send sends encrypted message"""
        response = requests.post(
            f"{BASE_URL}/api/messaging/send",
            json={
                "sender_address": TEST_ADDRESS_1,
                "recipient_address": TEST_ADDRESS_2,
                "message": "Hello, this is a private message!",
                "recipient_public_key": "0x" + "a" * 64,
                "chain": "base"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "message_id" in data, "Missing message_id"
        assert "encrypted_content" in data, "Missing encrypted_content"
        assert "recipient" in data, "Missing recipient"
        
        assert data["recipient"] == TEST_ADDRESS_2
        # Encrypted content should be base64 encoded
        assert len(data["encrypted_content"]) > 0
        
        print(f"✓ Encrypted message sent: message_id={data['message_id'][:8]}...")
        return data["message_id"]
    
    def test_messaging_send_with_tx_attachment(self):
        """Test messaging with attached transaction hash"""
        response = requests.post(
            f"{BASE_URL}/api/messaging/send",
            json={
                "sender_address": TEST_ADDRESS_1,
                "recipient_address": TEST_ADDRESS_2,
                "message": "Payment for services",
                "recipient_public_key": TEST_ADDRESS_2,
                "chain": "base",
                "attached_tx_hash": "0x" + "f" * 64
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["attached_to_tx"] == "0x" + "f" * 64
        print(f"✓ Message with tx attachment sent")
    
    def test_messaging_inbox(self):
        """Test /api/messaging/inbox/{address} retrieves encrypted inbox"""
        # First send a message
        requests.post(
            f"{BASE_URL}/api/messaging/send",
            json={
                "sender_address": TEST_ADDRESS_1,
                "recipient_address": TEST_ADDRESS_3,
                "message": "Test inbox message",
                "recipient_public_key": TEST_ADDRESS_3
            }
        )
        
        # Get inbox
        response = requests.get(f"{BASE_URL}/api/messaging/inbox/{TEST_ADDRESS_3}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "address" in data, "Missing address"
        assert "messages" in data, "Missing messages"
        assert "total_count" in data, "Missing total_count"
        assert "unread_count" in data, "Missing unread_count"
        
        assert data["address"].lower() == TEST_ADDRESS_3.lower()
        assert isinstance(data["messages"], list)
        
        # Verify message structure if messages exist
        if len(data["messages"]) > 0:
            msg = data["messages"][0]
            assert "message_id" in msg
            assert "sender_address" in msg
            assert "recipient_address" in msg
            assert "encrypted_content" in msg
            assert "created_at" in msg
        
        print(f"✓ Inbox retrieved: {data['total_count']} messages, {data['unread_count']} unread")
    
    def test_messaging_inbox_empty(self):
        """Test inbox for address with no messages"""
        random_address = "0x" + "9" * 40
        response = requests.get(f"{BASE_URL}/api/messaging/inbox/{random_address}")
        assert response.status_code == 200
        data = response.json()
        assert data["total_count"] == 0
        assert data["unread_count"] == 0
        print(f"✓ Empty inbox returns correctly")


class TestMultisigPrivacy:
    """Multisig Privacy (Feature 5)"""
    
    def test_multisig_create(self):
        """Test /api/multisig/create creates multisig wallet"""
        response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Test Multisig Wallet",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2, TEST_ADDRESS_3],
                "threshold": 2,
                "chain": "base"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "multisig_id" in data, "Missing multisig_id"
        assert "name" in data, "Missing name"
        assert "owners" in data, "Missing owners"
        assert "threshold" in data, "Missing threshold"
        assert "chain" in data, "Missing chain"
        assert "message" in data, "Missing message"
        
        assert data["name"] == "Test Multisig Wallet"
        assert len(data["owners"]) == 3
        assert data["threshold"] == 2
        assert "2 of 3" in data["message"]
        
        print(f"✓ Multisig created: {data['threshold']} of {len(data['owners'])} signatures required")
        return data["multisig_id"]
    
    def test_multisig_create_invalid_threshold(self):
        """Test multisig create rejects invalid threshold"""
        # Threshold > owners
        response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Invalid Multisig",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 5,  # More than 2 owners
                "chain": "base"
            }
        )
        assert response.status_code == 400
        
        # Threshold < 1
        response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Invalid Multisig",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 0,
                "chain": "base"
            }
        )
        assert response.status_code == 400
        
        print(f"✓ Invalid threshold correctly rejected")
    
    def test_multisig_propose(self):
        """Test /api/multisig/propose creates multisig proposal"""
        # First create a multisig
        create_response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Proposal Test Multisig",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 2,
                "chain": "base"
            }
        )
        multisig_id = create_response.json()["multisig_id"]
        
        # Create proposal
        response = requests.post(
            f"{BASE_URL}/api/multisig/propose",
            json={
                "multisig_id": multisig_id,
                "proposer": TEST_ADDRESS_1,
                "to_address": TEST_STEALTH,
                "amount_wei": "500000000000000000",
                "description": "Payment to vendor"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "proposal_id" in data, "Missing proposal_id"
        assert "multisig_id" in data, "Missing multisig_id"
        assert "to_address" in data, "Missing to_address"
        assert "amount" in data, "Missing amount"
        assert "threshold" in data, "Missing threshold"
        assert "signatures_needed" in data, "Missing signatures_needed"
        assert "status" in data, "Missing status"
        
        assert data["status"] == "pending"
        assert data["threshold"] == 2
        
        print(f"✓ Proposal created: proposal_id={data['proposal_id'][:8]}...")
        return multisig_id, data["proposal_id"]
    
    def test_multisig_propose_non_owner(self):
        """Test proposal from non-owner is rejected"""
        # Create multisig without TEST_ADDRESS_3
        create_response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Non-owner Test",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 1,
                "chain": "base"
            }
        )
        multisig_id = create_response.json()["multisig_id"]
        
        # Try to propose from non-owner
        response = requests.post(
            f"{BASE_URL}/api/multisig/propose",
            json={
                "multisig_id": multisig_id,
                "proposer": TEST_ADDRESS_3,  # Not an owner
                "to_address": TEST_STEALTH,
                "amount_wei": "100000000000000000"
            }
        )
        assert response.status_code == 403
        print(f"✓ Non-owner proposal correctly rejected")
    
    def test_multisig_sign(self):
        """Test /api/multisig/sign signs multisig proposal"""
        # Create multisig and proposal
        create_response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Sign Test Multisig",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 2,
                "chain": "base"
            }
        )
        multisig_id = create_response.json()["multisig_id"]
        
        propose_response = requests.post(
            f"{BASE_URL}/api/multisig/propose",
            json={
                "multisig_id": multisig_id,
                "proposer": TEST_ADDRESS_1,
                "to_address": TEST_STEALTH,
                "amount_wei": "100000000000000000"
            }
        )
        proposal_id = propose_response.json()["proposal_id"]
        
        # Sign the proposal
        response = requests.post(
            f"{BASE_URL}/api/multisig/sign",
            json={
                "multisig_id": multisig_id,
                "proposal_id": proposal_id,
                "signer_address": TEST_ADDRESS_1,
                "signature": "0x" + "a" * 130
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "proposal_id" in data, "Missing proposal_id"
        assert "signer" in data, "Missing signer"
        assert "signatures_count" in data, "Missing signatures_count"
        assert "threshold" in data, "Missing threshold"
        assert "threshold_reached" in data, "Missing threshold_reached"
        assert "status" in data, "Missing status"
        
        assert data["signatures_count"] == 1
        assert data["threshold_reached"] == False  # Need 2 signatures
        
        print(f"✓ Proposal signed: {data['signatures_count']}/{data['threshold']} signatures")
        
        # Sign with second owner to reach threshold
        response2 = requests.post(
            f"{BASE_URL}/api/multisig/sign",
            json={
                "multisig_id": multisig_id,
                "proposal_id": proposal_id,
                "signer_address": TEST_ADDRESS_2,
                "signature": "0x" + "b" * 130
            }
        )
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2["signatures_count"] == 2
        assert data2["threshold_reached"] == True
        assert data2["status"] == "ready_to_execute"
        
        print(f"✓ Threshold reached: status={data2['status']}")
    
    def test_multisig_sign_duplicate(self):
        """Test duplicate signature is rejected"""
        # Create multisig and proposal
        create_response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Duplicate Sign Test",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 2,
                "chain": "base"
            }
        )
        multisig_id = create_response.json()["multisig_id"]
        
        propose_response = requests.post(
            f"{BASE_URL}/api/multisig/propose",
            json={
                "multisig_id": multisig_id,
                "proposer": TEST_ADDRESS_1,
                "to_address": TEST_STEALTH,
                "amount_wei": "100000000000000000"
            }
        )
        proposal_id = propose_response.json()["proposal_id"]
        
        # Sign once
        requests.post(
            f"{BASE_URL}/api/multisig/sign",
            json={
                "multisig_id": multisig_id,
                "proposal_id": proposal_id,
                "signer_address": TEST_ADDRESS_1,
                "signature": "0x" + "a" * 130
            }
        )
        
        # Try to sign again
        response = requests.post(
            f"{BASE_URL}/api/multisig/sign",
            json={
                "multisig_id": multisig_id,
                "proposal_id": proposal_id,
                "signer_address": TEST_ADDRESS_1,
                "signature": "0x" + "c" * 130
            }
        )
        assert response.status_code == 400
        print(f"✓ Duplicate signature correctly rejected")
    
    def test_multisig_get_details(self):
        """Test /api/multisig/{multisig_id} retrieves multisig details"""
        # Create multisig
        create_response = requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "Details Test Multisig",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2, TEST_ADDRESS_3],
                "threshold": 2,
                "chain": "arbitrum"
            }
        )
        multisig_id = create_response.json()["multisig_id"]
        
        # Get details
        response = requests.get(f"{BASE_URL}/api/multisig/{multisig_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert data["multisig_id"] == multisig_id
        assert data["name"] == "Details Test Multisig"
        assert len(data["owners"]) == 3
        assert data["threshold"] == 2
        assert data["chain"] == "arbitrum"
        assert "proposals" in data
        assert "created_at" in data
        
        print(f"✓ Multisig details retrieved: {data['name']}")
    
    def test_multisig_get_not_found(self):
        """Test /api/multisig/{invalid_id} returns 404"""
        response = requests.get(f"{BASE_URL}/api/multisig/nonexistent-multisig-id")
        assert response.status_code == 404
        print(f"✓ Non-existent multisig returns 404")
    
    def test_multisig_user_list(self):
        """Test /api/multisig/user/{address} retrieves user's multisigs"""
        # Create a multisig with TEST_ADDRESS_1
        requests.post(
            f"{BASE_URL}/api/multisig/create",
            json={
                "name": "User List Test",
                "owners": [TEST_ADDRESS_1, TEST_ADDRESS_2],
                "threshold": 1,
                "chain": "base"
            }
        )
        
        # Get user's multisigs
        response = requests.get(f"{BASE_URL}/api/multisig/user/{TEST_ADDRESS_1}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "address" in data, "Missing address"
        assert "multisigs" in data, "Missing multisigs"
        assert "count" in data, "Missing count"
        
        assert data["address"].lower() == TEST_ADDRESS_1.lower()
        assert isinstance(data["multisigs"], list)
        assert data["count"] >= 1
        
        print(f"✓ User multisigs retrieved: {data['count']} multisigs")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
