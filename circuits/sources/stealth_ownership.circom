pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/*
 * Stealth Address Ownership Proof
 * 
 * Proves ownership of a stealth address without revealing the private key.
 * Uses Poseidon hash for efficiency on-chain.
 *
 * Public Inputs:
 *   - stealthAddressHash: Hash of the stealth address being claimed
 *   - nullifier: Unique identifier to prevent double-spending
 *
 * Private Inputs:
 *   - spendPrivKey: Private spending key
 *   - viewPrivKey: Private viewing key  
 *   - ephemeralPubKeyX: X coordinate of ephemeral public key
 *   - ephemeralPubKeyY: Y coordinate of ephemeral public key
 *   - salt: Random salt for nullifier generation
 */
template StealthOwnership() {
    // Private inputs
    signal input spendPrivKey;
    signal input viewPrivKey;
    signal input ephemeralPubKeyX;
    signal input ephemeralPubKeyY;
    signal input salt;
    
    // Public inputs
    signal input stealthAddressHash;
    signal input nullifier;
    
    // Output
    signal output valid;
    
    // Step 1: Compute shared secret S = hash(viewPrivKey, ephemeralPubKey)
    component sharedSecret = Poseidon(3);
    sharedSecret.inputs[0] <== viewPrivKey;
    sharedSecret.inputs[1] <== ephemeralPubKeyX;
    sharedSecret.inputs[2] <== ephemeralPubKeyY;
    
    // Step 2: Derive stealth private key = hash(spendPrivKey, sharedSecret)
    component stealthPrivKey = Poseidon(2);
    stealthPrivKey.inputs[0] <== spendPrivKey;
    stealthPrivKey.inputs[1] <== sharedSecret.out;
    
    // Step 3: Compute stealth address hash from stealth private key
    component computedHash = Poseidon(1);
    computedHash.inputs[0] <== stealthPrivKey.out;
    
    // Step 4: Verify the computed hash matches the public stealth address hash
    component hashCheck = IsEqual();
    hashCheck.in[0] <== computedHash.out;
    hashCheck.in[1] <== stealthAddressHash;
    
    // Step 5: Verify nullifier = hash(stealthPrivKey, salt)
    component nullifierCheck = Poseidon(2);
    nullifierCheck.inputs[0] <== stealthPrivKey.out;
    nullifierCheck.inputs[1] <== salt;
    
    component nullifierEqual = IsEqual();
    nullifierEqual.in[0] <== nullifierCheck.out;
    nullifierEqual.in[1] <== nullifier;
    
    // Both checks must pass
    valid <== hashCheck.out * nullifierEqual.out;
    
    // Constraint: valid must be 1
    valid === 1;
}

component main {public [stealthAddressHash, nullifier]} = StealthOwnership();
