"""
Regression tests for /api/stealth/store + /api/stealth/list.

The customer pilot's EOA↔stealth mapping was previously stored as
plaintext in db.stealth_addresses.recipient_address → stealth_address.
A MongoDB leak would have exposed every customer's received link.

K4 closes that side-channel via a sealed-envelope path:
  - POST /api/stealth/store accepts {ciphertext, iv, salt, addr}
    and writes ONLY the sealed envelope.
  - GET /api/stealth/list/{address} returns sealed envelopes (no
    plaintext) so the customer-pilot history tile's stealth lookup
    is server-blind.

These tests lock the privacy invariant: a row written under the
sealed path must NOT contain any plaintext stealth_address field
on disk.
"""

import hashlib


def test_stealth_store_accepts_ciphertext_envelope(client, auth_token):
    addr = "0xBEEF" + "0" * 36
    ciphertext = "ZW5jcnlwdGVkLXN0ZWFsdGg="  # "encrypted-stealth" base64
    iv = "MTIzNDU2Nzg5MDEy"
    salt = "QkJCQ0RERUZHSElKS0xNTk9QUVJTVFVWV1hZWg=="

    resp = client.post(
        "/api/stealth/store",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"ciphertext": ciphertext, "iv": iv, "salt": salt, "addr": addr, "chain": "base"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    expected_id = "sha256:" + hashlib.sha256(
        f"stealth|{addr}|{ciphertext}|{salt}".encode("utf-8")
    ).hexdigest()
    assert body["envelope_id"] == expected_id


def test_stealth_store_does_not_write_plaintext_on_disk(client, auth_token):
    addr = "0xC0DE" + "0" * 36
    ciphertext = "Y2lwaGVydGV4dC1zZWFsZWQ="
    iv = "MDEyMzQ1Njc4OTAxMjM="
    salt = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5"

    client.post(
        "/api/stealth/store",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"ciphertext": ciphertext, "iv": iv, "salt": salt, "addr": addr, "chain": "base"},
    )

    import server as server_module
    matching = [dict(r) for r in server_module.db._collections["stealth_addresses"]._docs if r.get("addr") == addr]
    assert len(matching) == 1
    stored = matching[0]
    # The K4 invariant: no plaintext stealth-link marker is on disk.
    for prohibited in ("stealth_address", "ephemeral_public_key", "view_tag", "recipient_address"):
        assert prohibited not in stored, (
            f"server leaked plaintext field {prohibited!r} in the sealed-stealth store path"
        )
    assert stored["encrypted"] is True
    assert stored["ciphertext"] == ciphertext


def test_stealth_list_returns_only_sealed_envelopes(client, auth_token):
    """The list endpoint must NOT return plaintext stealth addresses.
    Server can only return the sealed envelope rows; the customer's
    Privacy Pool / history tile is responsible for unsealing."""
    addr = "0xA1B2" + "0" * 36
    ciphertext = "ZW5jcnlwdGVkLW1hcHAtMg=="
    iv = "MTIzNDU2Nzg5MDEy"
    salt = "QkJCQ0RERUZHSElKS0xNTk9QUVJTVFVWV1hZWg=="

    client.post(
        "/api/stealth/store",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"ciphertext": ciphertext, "iv": iv, "salt": salt, "addr": addr, "chain": "base"},
    )

    resp = client.get(
        f"/api/stealth/list/{addr}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    sealed = body.get("sealed", [])
    legacy = body.get("legacy_plaintext", [])
    assert len(sealed) == 1
    assert sealed[0]["encrypted"] is True
    assert sealed[0]["ciphertext"] == ciphertext
    # No plaintext stealth_address field in the sealed list.
    assert "stealth_address" not in sealed[0]
    # legacy plaintext is empty for this addr (we never posted plaintext).
    assert legacy == []


def test_stealth_store_rejects_envelope_with_empty_address(client, auth_token):
    """Sanity: a missing addr is rejected so the lookup key stays
    consistent with the seal-unseal flow."""
    resp = client.post(
        "/api/stealth/store",
        headers={"Authorization": f"Bearer {auth_token}"},
        json={"ciphertext": "abc", "iv": "abc", "salt": "abc"},
    )
    # FastAPI returns 422 on missing required body field.
    assert resp.status_code in (400, 422), resp.text
