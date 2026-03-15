// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title UPLVerifier
 * @notice Simple ZKP verifier for Universal Privacy Layer
 * @dev Uses bn128 precompiles for pairing verification
 */
contract UPLVerifier {
    uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    mapping(bytes32 => bool) public nullifierUsed;
    mapping(bytes32 => bool) public verifiedProofs;
    
    uint256 public totalVerifications;
    uint256 public successfulVerifications;
    
    event ProofVerified(bytes32 indexed proofHash, address indexed verifier, bool result);
    event NullifierUsed(bytes32 indexed nullifier);
    
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory input
    ) public returns (bool) {
        totalVerifications++;
        
        // Validate inputs are in field
        require(a[0] < SNARK_SCALAR_FIELD && a[1] < SNARK_SCALAR_FIELD, "Invalid a");
        require(input[0] < SNARK_SCALAR_FIELD && input[1] < SNARK_SCALAR_FIELD, "Invalid input");
        
        // Check nullifier
        bytes32 nullifier = bytes32(input[1]);
        require(!nullifierUsed[nullifier], "Nullifier used");
        
        bytes32 proofHash = keccak256(abi.encodePacked(a, b, c, input));
        
        // Verify using pairing precompile
        bool success = _pairing(a, b, c, input);
        
        if (success) {
            successfulVerifications++;
            nullifierUsed[nullifier] = true;
            verifiedProofs[proofHash] = true;
            emit NullifierUsed(nullifier);
        }
        
        emit ProofVerified(proofHash, msg.sender, success);
        return success;
    }
    
    function _pairing(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory input
    ) internal view returns (bool) {
        uint256[12] memory pairingInput;
        
        // Negate A.y for pairing check
        pairingInput[0] = a[0];
        pairingInput[1] = (SNARK_SCALAR_FIELD - a[1]) % SNARK_SCALAR_FIELD;
        pairingInput[2] = b[0][1];
        pairingInput[3] = b[0][0];
        pairingInput[4] = b[1][1];
        pairingInput[5] = b[1][0];
        pairingInput[6] = c[0];
        pairingInput[7] = c[1];
        // Generator G2 points
        pairingInput[8] = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
        pairingInput[9] = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
        pairingInput[10] = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
        pairingInput[11] = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
        
        uint256[1] memory out;
        bool success;
        
        assembly {
            success := staticcall(sub(gas(), 2000), 8, pairingInput, 384, out, 32)
        }
        
        return success && out[0] == 1;
    }
    
    function verifyProofView(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory input
    ) external view returns (bool) {
        if (a[0] >= SNARK_SCALAR_FIELD || input[1] >= SNARK_SCALAR_FIELD) return false;
        if (nullifierUsed[bytes32(input[1])]) return false;
        return _pairing(a, b, c, input);
    }
    
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifierUsed[nullifier];
    }
    
    function getStats() external view returns (uint256, uint256, uint256) {
        return (totalVerifications, successfulVerifications, 
                totalVerifications > 0 ? (successfulVerifications * 100) / totalVerifications : 0);
    }
}
