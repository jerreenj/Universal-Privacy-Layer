pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/*
 * Amount Range Proof
 * 
 * Proves that an amount is within a valid range [0, maxAmount]
 * without revealing the actual amount.
 *
 * Public Inputs:
 *   - commitment: Poseidon(amount, salt)
 *   - maxAmount: Maximum allowed amount
 *
 * Private Inputs:
 *   - amount: The actual transfer amount
 *   - salt: Random blinding factor
 */
template AmountRangeProof(n) {
    // Private inputs
    signal input amount;
    signal input salt;
    
    // Public inputs
    signal input commitment;
    signal input maxAmount;
    
    // Output
    signal output valid;
    
    // Step 1: Verify commitment = Poseidon(amount, salt)
    component hasher = Poseidon(2);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== salt;
    
    component commitmentCheck = IsEqual();
    commitmentCheck.in[0] <== hasher.out;
    commitmentCheck.in[1] <== commitment;
    
    // Step 2: Verify amount <= maxAmount
    component lt = LessEqThan(n);
    lt.in[0] <== amount;
    lt.in[1] <== maxAmount;
    
    // Step 3: Verify amount >= 0 by decomposing into bits
    // This ensures amount is a valid positive number
    component bits = Num2Bits(n);
    bits.in <== amount;
    
    // Reconstruct from bits to verify
    var sum = 0;
    for (var i = 0; i < n; i++) {
        sum += bits.out[i] * (1 << i);
    }
    
    // Both conditions must be satisfied
    valid <== commitmentCheck.out * lt.out;
    valid === 1;
}

// 64-bit amounts support up to ~18 ETH at 18 decimals
component main {public [commitment, maxAmount]} = AmountRangeProof(64);
