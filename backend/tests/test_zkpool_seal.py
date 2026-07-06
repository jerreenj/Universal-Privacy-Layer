"""
Regression tests for /api/zk-pool/deposit envelope path.

Closes the side-channel DB leak on pool deposit metadata. The
server-stored row can no longer carry the deposit's commitment,
leaf_index, tx_hash, or denomination_wei in plaintext when the
client posts the sealed-envelope shape.
"""

import hashlib


def test_zkpool_deposit_accepts_sealed_envelope(client, auth_token):
    addr = "0xDEED" + "0" * 36
    ciphertext = "ZW5jcnlwdGVkLXprLWRlcG9zaXQ="
    iv = "MTIzNDU2Nzg5MDEy"
    salt = "QkJCQ0RERUZHSElKS0xNTk9QUVJTVFVWV1hZWg=="

    resp = client.post(
        "/api/zk-pool/deposit",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"ciphertext": ciphertext, "iv": iv, "salt": salt, "addr": addr, "chain": "base"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "recorded"
    assert body["encrypted"] is True
    expected_id = "sha256:" + hashlib.sha256(
        f"zkdeposit|{addr}|{ciphertext}|{salt}".encode("utf-8")
    ).hexdigest()
    assert body["envelope_id"] == expected_id


def test_zkpool_deposit_envelope_keeps_server_blind(client, auth_token):
    """Privacy invariant: a row written under the sealed path must
    carry NO plaintext field that the server could leak."""
    addr = "0xBEEF000000000000000000000000000000DEAD5E"  # compact sanity
    ciphertext = "Y2lwaGVydGV4dC16ay1kZXBvc2l0LTI="
    iv = "MDEyMzQ1Njc4OTAxMjM="
    salt = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5"

    client.post(
        "/api/zk-pool/deposit",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"ciphertext": ciphertext, "iv": iv, "salt": salt, "addr": addr, "chain": "base"},
    )

    import server as server_module
    matching = [
        dict(r) for r in server_module.db._collections["pool_deposits"]._docs
        if r.get("addr") == addr
    ]
    assert len(matching) == 1, f"expected 1 stored row, got {len(matching)}"
    stored = matching[0]
    for prohibited in ("commitment", "leaf_index", "tx_hash", "denomination_wei"):
        assert prohibited not in stored, (
            f"server leaked plaintext field {prohibited!r} in the sealed-pool-deposit path"
        )
    assert stored["encrypted"] is True
    assert stored["ciphertext"] == ciphertext


def test_zkpool_deposit_plaintext_path_still_works(client, auth_token):
    """Pre-K5 tools posting the plaintext shape must continue to
    work without changes."""
    resp = client.post(
        "/api/zk-pool/deposit",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={
            "commitment": "0x" + "ab" * 32,
            "tx_hash": "0x" + "de" * 32,
            "leaf_index": 0,
            "denomination_wei": 10**17,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "recorded"
    assert resp.json()["commitment"] == "0x" + "ab" * 32


def test_zkpool_deposit_rejects_neither_shape(client, auth_token):
    resp = client.post(
        "/api/zk-pool/deposit",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"only_partial_keys": True},
    )
    assert resp.status_code == 400, resp.text
