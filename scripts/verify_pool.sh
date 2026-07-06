#!/bin/bash
POOL=0x3F0b23Aca0624981a503e8f042db2F3884D0C89C
CAST="/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe"
RPC=https://mainnet.base.org

echo "== on-chain PrivacyPool @ $POOL =="
echo "code size:    $($CAST codesize $POOL --rpc-url $RPC 2>/dev/null) bytes"
echo "verifier:     $($CAST call $POOL 'verifier()(address)' --rpc-url $RPC 2>/dev/null)"
echo

echo "== multi-denom proof on-chain =="
echo "denom(0.1 ETH) enabled: $($CAST call $POOL 'isDenominationEnabled(uint256)(bool)' 100000000000000000 --rpc-url $RPC 2>/dev/null)"
echo "currentRootOf 0.1 ETH:  $($CAST call $POOL 'currentRootOf(uint256)(bytes32)' 100000000000000000 --rpc-url $RPC 2>/dev/null)"
echo "depositCount 0.1 ETH:   $($CAST call $POOL 'depositCount(uint256)(uint32)' 100000000000000000 --rpc-url $RPC 2>/dev/null)"
echo "owner:                  $($CAST call $POOL 'owner()(address)' --rpc-url $RPC 2>/dev/null)"
echo "denom(0.01 ETH) enabled: $($CAST call $POOL 'isDenominationEnabled(uint256)(bool)' 10000000000000000 --rpc-url $RPC 2>/dev/null)"
echo "denom(1 ETH)   enabled: $($CAST call $POOL 'isDenominationEnabled(uint256)(bool)' 1000000000000000000 --rpc-url $RPC 2>/dev/null)"
$CAST call $POOL 'getDenominationList()(uint256[])' --rpc-url $RPC > /tmp/denoms.out 2>/dev/null
echo "denom list:  $(cat /tmp/denoms.out)"
