"""
Regression tests for the privacy closer on /api/transactions/record.

Lock in two shapes that the endpoint accepts:
  1. Plaintext (legacy) — the original 7-field body, kept for any
     pre-K2 script that posts in the legacy shape.
  2. Ciphertext envelope (K2+) — {ciphertext, iv, salt, addr} — server
     cannot read the inner JSON because it does not have the wallet's
     AES-256-GCM seal key.

The key privacy-relevant assertion: the server MUST NOT synthesise
plaintext fields after receiving the ciphertext envelope. Anyone
dumping the db.transactions collection sees only (addr, ciphertext,
iv, salt) — no tx_hash, no to_address, no amount. The customer
attaches meaning only in the browser where their wallet signature
unlocks the seal key.
"""

import hashlib


def test_transactions_record_accepts_ciphertext_envelope(client, auth_token):
    addr = "0x42A645b5e8d20aa8DC85A6E1FE2D2a44Ee9A8B79"
    ciphertext = "ZW5jcnlwdGVkLWJsb2ItZm9yLWJyb3dzZXItMDEyMzQ1Njc4OQ=="
    iv = "MTIzNDU2Nzg5MDEy"
    salt = "QUFBQkJCQ0NERUZHSElJSktMTU5PUFFSU1RVVldYWVo="

    resp = client.post(
        "/api/transactions/record",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={
            "ciphertext": ciphertext,
            "iv": iv,
            "salt": salt,
            "addr": addr,
            "chain": "base",
            "tx_type": "private_swap",
            "status": "confirmed",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["encrypted"] is True
    # Deterministic envelope id derived from (addr|ciphertext|salt).
    expected_id = "sha256:" + hashlib.sha256(
        f"{addr}|{ciphertext}|{salt}".encode("utf-8")
    ).hexdigest()
    assert body["transaction_id"] == expected_id


def test_transactions_record_envelope_keeps_server_blind(client, auth_token):
    """The server stores ciphertext; NOTHING inside the ciphertext is
    reachable by inspecting db.transactions. This is the core privacy
    invariant: a hypothetical MongoDB leak must not leak the user's
    stealth addresses / amounts / tx hashes."""
    addr = "0xCAFE" + "0" * 36
    ciphertext = "ZW5jcnlwdGVkLWJsb2ItZm9yLXNlYWwtdGVzdA=="
    iv = "MDEyMzQ1Njc4OTAxMjM="
    salt = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODk="

    client.post(
        "/api/transactions/record",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={
            "ciphertext": ciphertext,
            "iv": iv,
            "salt": salt,
            "addr": addr,
            "chain": "base",
            "tx_type": "private_send",
            "status": "pending",
        },
    )

    # Read the row directly from the in-memory fake db. The fake
    # collection exposes its docs in `_docs` so we can assert against
    # what the server actually persisted without standing up motor.
    import server as server_module
    rows = list(server_module.db._collections["transactions"]._docs)

    # Only one row stored for this addr.
    matching = [dict(r) for r in rows if r.get("addr") == addr]
    assert len(matching) == 1, f"expected 1 stored row, got {len(matching)}"
    stored = matching[0]
    # Only the encrypted envelope material is on disk.
    for prohibited in ("tx_hash", "to_address", "from_address", "amount_wei"):
        assert prohibited not in stored, (
            f"server leaked plaintext field {prohibited!r} in the encrypted-store path"
        )
    assert stored["encrypted"] is True
    assert stored["ciphertext"] == ciphertext
    # The chain + tx_type tags are NOT plaintext — they're transactional
    # tags used by the history tile to group rows; the customer's
    # identity is not at risk even if exposed.
    assert stored["chain"] == "base"
    assert stored["tx_type"] == "private_send"


def test_transactions_record_rejects_both_shapes_missing(client, auth_token):
    """If neither the plaintext shape nor the ciphertext envelope is
    complete, the endpoint returns 400 instead of silently writing
    nothing."""
    resp = client.post(
        "/api/transactions/record",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"only_partial_keys": True},
    )
    assert resp.status_code == 400, resp.text
    assert "envelope" in resp.text or "plaintext" in resp.text


def test_transactions_record_plaintext_path_still_works(client, auth_token):
    """Back-compat: pre-K2 tools that post the 7-field plaintext body
    are not broken by the new ciphertext-aware endpoint."""
    resp = client.post(
        "/api/transactions/record",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={
            "tx_hash": "0xABC",
            "from_address": "0x1111111111111111111111111111111111111111",
            "to_address":   "0x2222222222222222222222222222222222222222",
            "amount_wei":   "1000000000000000",
            "chain":        "base",
            "tx_type":      "private_send",
            "status":       "confirmed",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["success"] is True
    assert "encrypted" not in resp.json() or resp.json()["encrypted"] is False
