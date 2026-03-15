pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/*
 * Membership Proof (Merkle Tree Inclusion)
 * 
 * Proves that a value is a member of a set (Merkle tree)
 * without revealing which member.
 *
 * Public Inputs:
 *   - root: Merkle tree root
 *   - nullifierHash: Hash to prevent double-use
 *
 * Private Inputs:
 *   - leaf: The leaf value (stealth address or commitment)
 *   - pathElements: Sibling hashes along the path
 *   - pathIndices: Left/right path indicators (0 or 1)
 *   - secret: Secret for nullifier generation
 */
template MembershipProof(levels) {
    // Private inputs
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input secret;
    
    // Public inputs
    signal input root;
    signal input nullifierHash;
    
    // Output
    signal output valid;
    
    // Compute nullifier = hash(leaf, secret)
    component nullifierCompute = Poseidon(2);
    nullifierCompute.inputs[0] <== leaf;
    nullifierCompute.inputs[1] <== secret;
    
    // Verify nullifier matches
    component nullifierCheck = IsEqual();
    nullifierCheck.in[0] <== nullifierCompute.out;
    nullifierCheck.in[1] <== nullifierHash;
    
    // Compute Merkle root from leaf and path
    signal hashes[levels + 1];
    hashes[0] <== leaf;
    
    component hashers[levels];
    component muxLeft[levels];
    component muxRight[levels];
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        
        // If pathIndices[i] == 0, leaf is on left
        // If pathIndices[i] == 1, leaf is on right
        
        // Constrain pathIndices to be 0 or 1
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        
        // Select left and right inputs based on path
        signal left <== hashes[i] + pathIndices[i] * (pathElements[i] - hashes[i]);
        signal right <== pathElements[i] + pathIndices[i] * (hashes[i] - pathElements[i]);
        
        hashers[i].inputs[0] <== left;
        hashers[i].inputs[1] <== right;
        
        hashes[i + 1] <== hashers[i].out;
    }
    
    // Verify computed root matches public root
    component rootCheck = IsEqual();
    rootCheck.in[0] <== hashes[levels];
    rootCheck.in[1] <== root;
    
    // Both nullifier and root must match
    valid <== nullifierCheck.out * rootCheck.out;
    valid === 1;
}

// 20 levels supports ~1 million members
component main {public [root, nullifierHash]} = MembershipProof(20);
