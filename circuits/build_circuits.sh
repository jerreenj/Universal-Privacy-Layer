#!/bin/bash
# =============================================================================
# ZKP CIRCUIT BUILD SCRIPT
# Universal Privacy Layer - Circom Circuit Compilation
# =============================================================================
# 
# Prerequisites:
#   - Circom: curl -Ls https://scrypt.io/scripts/setup-circom.sh | sh
#   - snarkjs: npm install -g snarkjs
#   - circomlib: npm install circomlib
#
# This script compiles the UPL ZKP circuits and generates:
#   - R1CS constraint system
#   - WASM for browser proof generation
#   - Proving/Verification keys
#   - Solidity verifier contract
# =============================================================================

set -e

CIRCUIT_DIR="/app/circuits"
SOURCES_DIR="$CIRCUIT_DIR/sources"
BUILD_DIR="$CIRCUIT_DIR/build"
KEYS_DIR="$CIRCUIT_DIR/keys"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  UPL ZKP Circuit Build Script${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Check prerequisites
check_prereqs() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"
    
    if ! command -v circom &> /dev/null; then
        echo "Circom not found. Installing..."
        curl -Ls https://scrypt.io/scripts/setup-circom.sh | sh
        export PATH="$HOME/.circom/bin:$PATH"
    fi
    echo "  ✓ Circom: $(circom --version 2>/dev/null || echo 'installed')"
    
    if ! command -v snarkjs &> /dev/null; then
        echo "snarkjs not found. Installing..."
        npm install -g snarkjs
    fi
    echo "  ✓ snarkjs: $(snarkjs --version 2>/dev/null || echo 'installed')"
    
    # Install circomlib if not present
    if [ ! -d "$CIRCUIT_DIR/node_modules/circomlib" ]; then
        echo "Installing circomlib..."
        cd "$CIRCUIT_DIR"
        npm init -y 2>/dev/null || true
        npm install circomlib
    fi
    echo "  ✓ circomlib: installed"
}

# Download Powers of Tau
download_ptau() {
    echo ""
    echo -e "${YELLOW}Downloading Powers of Tau...${NC}"
    
    PTAU_FILE="$KEYS_DIR/powersOfTau28_hez_final_15.ptau"
    
    if [ -f "$PTAU_FILE" ]; then
        echo "  ✓ Powers of Tau already downloaded"
        return
    fi
    
    mkdir -p "$KEYS_DIR"
    wget -q --show-progress \
        "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau" \
        -O "$PTAU_FILE"
    
    echo "  ✓ Downloaded to $PTAU_FILE"
}

# Compile a circuit
compile_circuit() {
    local circuit_name=$1
    echo ""
    echo -e "${YELLOW}Compiling $circuit_name...${NC}"
    
    mkdir -p "$BUILD_DIR"
    cd "$SOURCES_DIR"
    
    # Compile
    circom "$circuit_name.circom" \
        --r1cs \
        --wasm \
        --sym \
        -o "$BUILD_DIR" \
        -l "$CIRCUIT_DIR/node_modules"
    
    echo "  ✓ Compiled: $BUILD_DIR/${circuit_name}.r1cs"
    echo "  ✓ WASM: $BUILD_DIR/${circuit_name}_js/${circuit_name}.wasm"
}

# Generate proving key
generate_keys() {
    local circuit_name=$1
    echo ""
    echo -e "${YELLOW}Generating keys for $circuit_name...${NC}"
    
    cd "$BUILD_DIR"
    PTAU_FILE="$KEYS_DIR/powersOfTau28_hez_final_15.ptau"
    
    # Phase 1: Setup
    snarkjs groth16 setup \
        "${circuit_name}.r1cs" \
        "$PTAU_FILE" \
        "$KEYS_DIR/${circuit_name}_0000.zkey"
    
    # Phase 2: Contribute
    echo "UPL contribution $(date)" | snarkjs zkey contribute \
        "$KEYS_DIR/${circuit_name}_0000.zkey" \
        "$KEYS_DIR/${circuit_name}_final.zkey" \
        --name="UPL Phase 2 contribution"
    
    # Export verification key
    snarkjs zkey export verificationkey \
        "$KEYS_DIR/${circuit_name}_final.zkey" \
        "$KEYS_DIR/${circuit_name}_vkey.json"
    
    echo "  ✓ Proving key: $KEYS_DIR/${circuit_name}_final.zkey"
    echo "  ✓ Verification key: $KEYS_DIR/${circuit_name}_vkey.json"
}

# Generate Solidity verifier
generate_verifier() {
    local circuit_name=$1
    echo ""
    echo -e "${YELLOW}Generating Solidity verifier for $circuit_name...${NC}"
    
    mkdir -p "$CIRCUIT_DIR/verifiers"
    
    snarkjs zkey export solidityverifier \
        "$KEYS_DIR/${circuit_name}_final.zkey" \
        "$CIRCUIT_DIR/verifiers/${circuit_name}Verifier.sol"
    
    echo "  ✓ Verifier: $CIRCUIT_DIR/verifiers/${circuit_name}Verifier.sol"
}

# Main
main() {
    check_prereqs
    download_ptau
    
    # Build each circuit
    for circuit in stealth_ownership amount_range membership; do
        if [ -f "$SOURCES_DIR/${circuit}.circom" ]; then
            compile_circuit "$circuit"
            generate_keys "$circuit"
            generate_verifier "$circuit"
        fi
    done
    
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  Build Complete!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo "Output files:"
    echo "  - R1CS: $BUILD_DIR/*.r1cs"
    echo "  - WASM: $BUILD_DIR/*_js/*.wasm"
    echo "  - Keys: $KEYS_DIR/*_final.zkey"
    echo "  - Verifiers: $CIRCUIT_DIR/verifiers/*.sol"
    echo ""
    echo "Next steps:"
    echo "  1. Deploy verifier contracts from $CIRCUIT_DIR/verifiers/"
    echo "  2. Copy WASM files to frontend for browser proof generation"
    echo "  3. Update backend with new verification key"
}

main "$@"
