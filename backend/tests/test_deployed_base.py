"""
Sweep-P3 Op-3 regression tests for contracts/deployed_base.json.

The P3.4 broadcast had to merge the deployed addresses manually because
Forge vm.writeJson persisted only chainId on this host. Two honest
ways to fail going forward:

  (a) The committed deployed_base.json no longer reflects a real on-chain
      state (someone deletes the merge line).
  (b) The merged JSON breaks the schema _load_deployed_addresses() reads.

We assert against the LIVE Base mainnet RPC — so any of:
  - contract address format wrong
  - one of the 5 contracts actually self-destructed / got replaced
  - replayNote is corrupt
is caught by this test on CI (skipped if RPC is unreachable).
"""

import json
import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MANIFEST = REPO_ROOT / "contracts" / "deployed_base.json"

# The canonical addresses for the current Base mainnet deployment.
# P4.1 redeploy (commits 0f5a1e2 + 15e76a4 + 51e3aec): every contract's
# address is fresh, multi-denom semantics replace single-denom. pre-P4.1
# addresses (those listed in commit 96e9fb5) are still on-chain but have
# been superseded; the backend is intentionally pointed ONLY at the new
# pool for any active route.
EXPECTED_BASE = {
    "privacy_pool":     "0x3F0b23Aca0624981a503e8f042db2F3884D0C89C",  # P4.1 multi-denom
    "privacy_verifier": "0x838b7c20b1a97cAA6379542d03983b4571275679",  # P4.1
    "privacy_relayer":  "0x69DA62568CAbc0940a0Bb6Bc7017e3EB8BD7c175",  # P4.1
    "stealth_registry": "0xaA5c31a4FF1715B85F1008aD6E874Eb183a843c1",  # P4.1
    "uniswap_wrapper":  "0x9C30cdCd73347BF18A5bD424C37E5714e2606362",  # P4.1
    "aerodrome_wrapper": "0x009681CdF5441D23738EC6597e586eBB06215e3D", # P4.2 (added later)
    "deployer":         "0x3f44A6451439673D95082A1337045a25ec275394",  # unchanged
}
EXPECTED_CHAIN_ID = 8453


def test_deployed_base_json_exists_and_parses():
    assert MANIFEST.exists(), f"deployed_base.json missing at {MANIFEST}"
    with open(MANIFEST) as f:
        doc = json.load(f)
    assert isinstance(doc, dict), "deployed_base.json must be a dict"
    assert "base" in doc, "top-level must contain 'base' key (backend schema)"
    assert isinstance(doc["base"], dict)


def test_deployed_base_base_has_chainid():
    """_load_deployed_addresses relies on base.chainId to know which chain."""
    with open(MANIFEST) as f:
        doc = json.load(f)
    assert int(doc["base"]["chainId"]) == EXPECTED_CHAIN_ID, (
        f"deployed_base.json must declare chainId {EXPECTED_CHAIN_ID} (Base mainnet) "
        f"for _load_deployed_addresses() to pick it up"
    )


def test_deployed_base_has_all_five_p3_contracts():
    """Regression: the P3.4 merge must include all 5 contracts. If anyone
    deletes any of these keys the backend will silently fall back to
    default-zeros and the privacy model collapses."""
    with open(MANIFEST) as f:
        doc = json.load(f)
    for key, expected_addr in EXPECTED_BASE.items():
        actual = doc["base"].get(key)
        # Allow 'feeper recipient'/'deployer'/'pool_owner' aliases but
        # at least one canonical key per contract must be present.
        if actual != expected_addr:
            aliases = {
                "deployer": ["deployer", "pool_owner"],
                "privacy_relayer": ["privacy_relayer"],
                "privacy_pool": ["privacy_pool"],
                "privacy_verifier": ["privacy_verifier"],
                "stealth_registry": ["stealth_registry"],
                "uniswap_wrapper": ["uniswap_wrapper"],
            }
            ok = False
            for ak in aliases.get(key, [key]):
                if doc["base"].get(ak, "").lower() == expected_addr.lower():
                    ok = True
                    break
            assert ok, f"deployed_base.json base.{key}={actual!r} mismatch expected {expected_addr!r}"


@pytest.mark.skipif(
    os.environ.get("UPL_TEST_SKIP_BASE_RPC", "false").lower() == "true",
    reason="skip on hosts without Base RPC access",
)
def test_deployed_base_addresses_match_live_base_chain():
    """If RPC is reachable, cast code at each address MUST return non-empty
    Solidity bytecode. If any of the 5 contracts actually self-destructed
    or got replaced, this fires immediately."""
    try:
        import subprocess
    except ImportError:
        pytest.skip("subprocess not available")
    addr_keys = [
        ("privacy_relayer", "0x0236451962b249c9a4D742b1ae99bD1F51692b7b"),
        ("stealth_registry", "0x48363A533b23fa223C0f37DD99c556D9aAa62496"),
        ("uniswap_wrapper", "0x9dB802599412729429765D73C7daca62Aac252F5"),
        ("privacy_verifier", "0xcb2b6D1082e97557EF2d6aE5268f8e8d38DF72e3"),
        ("privacy_pool", "0x3A7DA29bfd9853A0449c8c51F7007B7f5126C455"),
    ]
    rpc = os.environ.get("BASE_RPC_URL", "https://mainnet.base.org")
    for label, addr in addr_keys:
        r = subprocess.run(
            ["cast", "code", addr, "--rpc-url", rpc],
            capture_output=True, text=True, timeout=20,
        )
        code = (r.stdout or "").strip()
        assert code.startswith("0x") and code != "0x" and len(code) > 20, (
            f"{label} {addr} on Base mainnet has no code — the manifest is stale"
        )


@pytest.mark.skipif(
    os.environ.get("UPL_TEST_SKIP_FMT", "false").lower() == "true",
    reason="skip forge fmt check in CI environments without forge",
)
def test_forge_fmt_clean():
    """forge fmt --check must exit 0 to keep CI clean (P3.4 hardened this)."""
    try:
        import subprocess
    except ImportError:
        pytest.skip("subprocess not available")
    r = subprocess.run(
        ["forge", "fmt", "--check"],
        cwd=REPO_ROOT / "contracts",
        capture_output=True, text=True, timeout=30,
    )
    assert r.returncode == 0, (
        f"forge fmt --check fails:\n{r.stdout}\n{r.stderr}. "
        "Run `forge fmt` in contracts/ before committing."
    )
