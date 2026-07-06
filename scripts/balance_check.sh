#!/bin/bash
cd "/mnt/c/Users/AGBS Studio/ZCodeProject/Universal-Privacy-Layer"
CAST_WIN="/mnt/c/Users/AGBS Studio/.foundry/bin/cast.exe"
ADDR=0x3f44A6451439673D95082A1337045a25ec275394

echo "== deployer status after P4.1 multi-denom broadcast =="
$CAST_WIN balance "$ADDR" --rpc-url https://mainnet.base.org --ether 2>/dev/null | awk '{print "balance: " $1 " ETH"}'
$CAST_WIN nonce   "$ADDR" --rpc-url https://mainnet.base.org 2>/dev/null | awk '{print "nonce:   " $1 " (was 29 before broadcast)"}'
$CAST_WIN block-number --rpc-url https://mainnet.base.org 2>/dev/null | awk '{print "block:   " $1 " (latest Base mainnet)"}'
echo
echo "== nonce difference = pre-broadcast nonce was 29; post-broadcast nonce =="
echo "(5 contracts = 6 tx entries: 5 CREATE + library-deploy for PoseidonT3 + final post-deploy sync)"
