/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/upl_sol.json`.
 */
export type UplSol = {
  "address": "F7MQRA15YwswZoLK319rs1sr35Km2KBfqvPgR7TPnp1t",
  "metadata": {
    "name": "uplSol",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Universal Privacy Layer — Solana program (parity with Base + Sui)"
  },
  "instructions": [
    {
      "name": "announce",
      "discriminator": [
        7,
        30,
        100,
        250,
        110,
        253,
        3,
        149
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "announcement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  110,
                  110,
                  111,
                  117,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "registry.next_id",
                "account": "registryState"
              }
            ]
          }
        },
        {
          "name": "announcer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ephemeralPubKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "viewTag",
          "type": "u8"
        },
        {
          "name": "stealthHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "close",
      "discriminator": [
        98,
        165,
        201,
        177,
        108,
        65,
        206,
        96
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "relayer",
          "docs": [
            "The authorized relayer wallet. For solo-relayer MVP this is the deployer."
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "issueReceipt",
      "discriminator": [
        128,
        231,
        32,
        119,
        210,
        139,
        80,
        68
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "relayer",
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "registry.next_receipt_id",
                "account": "registryState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "announcementId",
          "type": "u64"
        },
        {
          "name": "ciphertext",
          "type": "bytes"
        },
        {
          "name": "nonce",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "relay",
      "discriminator": [
        109,
        130,
        24,
        215,
        1,
        255,
        37,
        114
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "relayer",
          "docs": [
            "The authorized relayer — must match registry.relayer. Enforced by has_one."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        },
        {
          "name": "recipient",
          "docs": [
            "Receives `amount - fee` via system_program transfer."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ephemeralKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "viewTag",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "relayAndAnnounce",
      "discriminator": [
        58,
        4,
        90,
        176,
        251,
        179,
        139,
        210
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "relayer",
          "docs": [
            "The authorized relayer — must match registry.relayer. Enforced by has_one."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        },
        {
          "name": "recipient",
          "docs": [
            "Receives `amount - fee` via system_program transfer."
          ],
          "writable": true
        },
        {
          "name": "announcement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  110,
                  110,
                  111,
                  117,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "registry.next_id",
                "account": "registryState"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "registry.next_receipt_id",
                "account": "registryState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ephemeralPubKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "viewTag",
          "type": "u8"
        },
        {
          "name": "stealthHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "ciphertext",
          "type": "bytes"
        },
        {
          "name": "nonce",
          "type": "bytes"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setFeeBps",
      "discriminator": [
        2,
        161,
        245,
        141,
        111,
        32,
        39,
        198
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "admin",
          "docs": [
            "The admin — must match registry.admin. Enforced by has_one."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        }
      ],
      "args": [
        {
          "name": "newFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "withdrawFees",
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        },
        {
          "name": "to",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "announcement",
      "discriminator": [
        73,
        38,
        210,
        135,
        9,
        143,
        191,
        105
      ]
    },
    {
      "name": "privacyReceipt",
      "discriminator": [
        97,
        93,
        233,
        209,
        64,
        226,
        109,
        22
      ]
    },
    {
      "name": "registryState",
      "discriminator": [
        29,
        34,
        224,
        195,
        175,
        183,
        99,
        97
      ]
    }
  ],
  "events": [
    {
      "name": "feeRateUpdated",
      "discriminator": [
        90,
        28,
        42,
        224,
        39,
        78,
        81,
        27
      ]
    },
    {
      "name": "feesWithdrawn",
      "discriminator": [
        234,
        15,
        0,
        119,
        148,
        241,
        40,
        21
      ]
    },
    {
      "name": "privateSendCompleted",
      "discriminator": [
        169,
        158,
        26,
        179,
        168,
        136,
        157,
        166
      ]
    },
    {
      "name": "privateTransfer",
      "discriminator": [
        253,
        142,
        153,
        237,
        77,
        46,
        209,
        132
      ]
    },
    {
      "name": "receiptIssued",
      "discriminator": [
        233,
        140,
        157,
        214,
        59,
        46,
        229,
        231
      ]
    },
    {
      "name": "stealthAnnouncement",
      "discriminator": [
        197,
        85,
        83,
        203,
        142,
        88,
        5,
        176
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be > 0"
    },
    {
      "code": 6001,
      "name": "zeroRecipient",
      "msg": "Invalid recipient (zero address)"
    },
    {
      "code": 6002,
      "name": "notAuthorizedRelayer",
      "msg": "Not authorised relayer — only the configured relayer may call this"
    },
    {
      "code": 6003,
      "name": "notAuthorizedAdmin",
      "msg": "Not authorised admin — only the initializer may call this"
    },
    {
      "code": 6004,
      "name": "feeTooHigh",
      "msg": "Fee too high — exceeds MAX_FEE_BPS (1%)"
    },
    {
      "code": 6005,
      "name": "emptyEphemeralKey",
      "msg": "Empty ephemeral public key"
    },
    {
      "code": 6006,
      "name": "emptyViewTag",
      "msg": "Empty view tag"
    },
    {
      "code": 6007,
      "name": "registryNotInitialized",
      "msg": "Registry not initialized — call initialize first"
    },
    {
      "code": 6008,
      "name": "recipientIsProgram",
      "msg": "Recipient == program — would self-lock fees"
    },
    {
      "code": 6009,
      "name": "emptyCiphertext",
      "msg": "Empty ciphertext"
    },
    {
      "code": 6010,
      "name": "emptyNonce",
      "msg": "Empty nonce"
    },
    {
      "code": 6011,
      "name": "announcementAlreadyExists",
      "msg": "Announcement already exists at this id"
    },
    {
      "code": 6012,
      "name": "receiptAlreadyExists",
      "msg": "Receipt already exists at this id"
    }
  ],
  "types": [
    {
      "name": "announcement",
      "docs": [
        "Announcement — a single stealth address announcement record.",
        "PDA derived from seeds `[\"announce\", id.to_le_bytes()]`.",
        "Mirrors Sui `Announcement` struct + Base StealthAddressRegistry.Announcement.",
        "",
        "Space: 8 (discriminator) + 8 (id) + 32 (ephemeral_pub_key) + 1 (view_tag) +",
        "32 (stealth_hash) + 32 (announcer) + 8 (timestamp) = 121"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "docs": [
              "Announcement id (0-based, matches RegistryState.next_id at creation time)."
            ],
            "type": "u64"
          },
          {
            "name": "ephemeralPubKey",
            "docs": [
              "32-byte ephemeral public key commitment (x-only coord or hash).",
              "The recipient uses this to derive the shared secret. Mirrors Sui ephemeral_pub_key."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "viewTag",
            "docs": [
              "1-byte EIP-5564 view tag for fast client-side scan filtering."
            ],
            "type": "u8"
          },
          {
            "name": "stealthHash",
            "docs": [
              "keccak256 of the derived stealth address (recipient lookup — NOT the address)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "announcer",
            "docs": [
              "The relayer/announcer Pubkey (msg.sender analog). Mirrors Sui announcer."
            ],
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp (seconds). Mirrors Sui timestamp_ms (divided to seconds)."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeRateUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldRate",
            "type": "u16"
          },
          {
            "name": "newRate",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "feesWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "privacyReceipt",
      "docs": [
        "PrivacyReceipt — encrypted delivery receipt owned by the recipient.",
        "PDA derived from seeds `[\"receipt\", id.to_le_bytes()]`.",
        "Mirrors Sui `PrivacyReceipt` owned object + Base event-log receipt.",
        "",
        "Space: 8 (discriminator) + 8 (id) + 32 (recipient) + 4 (ciphertext len) +",
        "256 (ciphertext max) + 4 (nonce len) + 32 (nonce max) + 8 (announcement_id) +",
        "8 (timestamp) = 360"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "docs": [
              "Receipt id (0-based, matches RegistryState.next_receipt_id at creation)."
            ],
            "type": "u64"
          },
          {
            "name": "recipient",
            "docs": [
              "The recipient's Pubkey — who owns this receipt account."
            ],
            "type": "pubkey"
          },
          {
            "name": "ciphertext",
            "docs": [
              "Encrypted delivery payload (the recipient decrypts with their view key).",
              "Max 256 bytes — sufficient for the MVP encrypted metadata."
            ],
            "type": {
              "array": [
                "u8",
                256
              ]
            }
          },
          {
            "name": "ciphertextLen",
            "docs": [
              "Length of the ciphertext (the fixed array is zero-padded beyond this)."
            ],
            "type": "u16"
          },
          {
            "name": "nonce",
            "docs": [
              "Nonce for the encrypted payload."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nonceLen",
            "docs": [
              "Length of the nonce."
            ],
            "type": "u16"
          },
          {
            "name": "announcementId",
            "docs": [
              "The announcement id this receipt corresponds to."
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp (seconds)."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "privateSendCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "relayed",
            "type": "bool"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "announcementId",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "privateTransfer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stealthHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ephemeralKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "viewTag",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "receiptIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receiptId",
            "type": "u64"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "announcementId",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "ciphertextLen",
            "type": "u64"
          },
          {
            "name": "nonceLen",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "registryState",
      "docs": [
        "Registry state — the single shared configuration + stats account.",
        "PDA derived from seeds `[\"registry\"]`. Created once by `initialize`.",
        "Mirrors Sui's `Registry` (next_id) + `RelayerState` (fee, total_relayed)",
        "combined into one account (Solana favors fewer accounts per tx).",
        "",
        "Space: 8 (discriminator) + 32 (relayer) + 32 (admin) + 2 (fee_bps) +",
        "8 (next_id) + 8 (total_relayed) + 8 (accumulated_fees) + 8 (next_receipt_id) = 106"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "relayer",
            "docs": [
              "The authorized relayer wallet (msg.sender analog). Only this address",
              "may call `relay` / `relay_and_announce`. Mirrors Base `relayer` slot."
            ],
            "type": "pubkey"
          },
          {
            "name": "admin",
            "docs": [
              "The admin (initializer). Only this address may call `set_fee_bps` /",
              "`withdraw_fees`. Usually the deployer. Mirrors Sui AdminCap holder."
            ],
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "docs": [
              "Fee in basis points (5 = 0.05%). Capped at MAX_FEE_BPS. Mirrors Base feeBps."
            ],
            "type": "u16"
          },
          {
            "name": "nextId",
            "docs": [
              "Monotonic announcement counter — also the next announcement id.",
              "Mirrors Sui Registry.next_id."
            ],
            "type": "u64"
          },
          {
            "name": "totalRelayed",
            "docs": [
              "Cumulative lamports forwarded to stealth recipients. Mirrors Base totalRelayed."
            ],
            "type": "u64"
          },
          {
            "name": "accumulatedFees",
            "docs": [
              "Accrued fees in lamports, withdrawable by admin. Mirrors Base accumulatedFees."
            ],
            "type": "u64"
          },
          {
            "name": "nextReceiptId",
            "docs": [
              "Monotonic receipt counter — also the next receipt id.",
              "Mirrors Sui PrivacyReceipt issuance sequence."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "stealthAnnouncement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "viewTag",
            "type": "u8"
          },
          {
            "name": "announcer",
            "type": "pubkey"
          },
          {
            "name": "stealthHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ephemeralPubKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
