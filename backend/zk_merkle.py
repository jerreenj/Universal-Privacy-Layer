"""
Pure-Python implementation of the incremental Poseidon Merkle tree used by
PrivacyPool.sol (depth 20, Poseidon(2) per level).

This matches the on-chain tree bit-for-bit (verified via zk_prove_e2e.js +
verify_poseidon_ref.js). It is used by the backend to:
  - Build the current Merkle root from on-chain deposits (for /api/zk-pool/state)
  - Generate Merkle paths for withdrawal proofs (P3.5-B)

The constants (C, M, P, S) are extracted from circomlib poseidon_constants.circom
at t=3 (Poseidon(2)) and t=2 (Poseidon(1) for nullifierHash). They are the
exact same values used by the withdraw.circom circuit.
"""

from __future__ import annotations
from typing import List, Tuple
import re
from pathlib import Path

Q = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001

def mod(a: int, b: int = Q) -> int:
    return ((a % b) + b) % b

# ── Poseidon constants (extracted at import time) ─────────────────────────────
_POSEIDON_RE = re.compile(
    r"function\s+(\w+)\s*\(\s*t\s*\)|"           # function header  -> group(1)
    r"(\b(?:if|else if)\b)\s*\(\s*t\s*==\s*(\d+)\s*\)"  # t-switch       -> group(2,3)
)
_HEX_RE = re.compile(r"0x[0-9a-fA-F]+")


def _parse_poseidon_constants_from_text(text: str) -> dict | None:
    """Parse the circomlib poseidon_constants.circom text into a constants
    dict, or return None if anything looks off. None means 'caller should
    raise loudly' — we should NEVER silently substitute a degenerate
    fallback (see the audit note in the module docstring)."""
    by_fn: dict[str, list] = {}
    order: list[str] = []
    cur_fn = None
    for m in _POSEIDON_RE.finditer(text):
        if m.group(1):
            cur_fn = m.group(1)
            if cur_fn not in by_fn:
                by_fn[cur_fn] = []
                order.append(cur_fn)
            continue
        if cur_fn is None:
            # We hit a t-switch outside any function — that's malformed.
            return None
        by_fn[cur_fn].append({"t": int(m.group(3)), "s": m.start()})

    if not order or "POSEIDON_C" not in by_fn:
        return None

    out: dict = {}
    for fn in order:
        arr = by_fn[fn]
        out[fn] = {}
        for i in range(len(arr)):
            # Defensive: if there is only one entry, len(arr)==1, so
            # arr[i+1] doesn't exist. Take the remainder of the text.
            end = arr[i + 1]["s"] if i + 1 < len(arr) else len(text)
            body = text[arr[i]["s"]:end]
            out[fn][arr[i]["t"]] = [int(x, 16) for x in _HEX_RE.findall(body)]

    # Sanity: t=3 (Poseidon-2) MUST be present in POSEIDON_C, otherwise the
    # tree will be all-zero (privacy-broken). Bail loudly.
    if 3 not in out.get("POSEIDON_C", {}):
        return None
    return out


def _load_poseidon_constants() -> dict:
    """Read circomlib + parse, OR raise with a clear error.

    Audit-P3 fix: this used to silently fall back to all-zero constants
    when circomlib wasn't present. That fed every commitment into the
    same zero-tree (privacy-broken). Any code path that used the
    fallback would have shipped an indistinguishable Merkle tree.
    The fix: never ship a default-zero constants table. If we can't
    read the real ones, raise — endpoints must surface 503, NOT
    quietly use zeros."""
    circuits_dir = Path(__file__).parent.parent / "contracts" / "circuits"
    consts_file = circuits_dir / "circomlib" / "circuits" / "poseidon_constants.circom"
    if not consts_file.exists():
        raise RuntimeError(
            f"circomlib poseidon_constants.circom not found at {consts_file}. "
            "The backend cannot derive a real Merkle tree without it; "
            "/api/zk-pool/* will correctly return 503 ready=false rather "
            "than ship a privacy-broken all-zero tree."
        )
    text = consts_file.read_text(encoding="utf-8")
    parsed = _parse_poseidon_constants_from_text(text)
    if parsed is None:
        raise RuntimeError(
            "circomlib poseidon_constants.circom exists but did not parse cleanly. "
            "Refusing to use a degenerate fallback — /api/zk-pool/* will return 503."
        )
    return parsed

ALL = _load_poseidon_constants()

# t=3 (Poseidon(2) for tree nodes)
t, nRoundsF, nRoundsP = 3, 8, 57
C = ALL.get("POSEIDON_C", {}).get(3, [])
Mflat = ALL.get("POSEIDON_M", {}).get(3, [])
Pflat = ALL.get("POSEIDON_P", {}).get(3, [])
S = ALL.get("POSEIDON_S", {}).get(3, [])
M = [Mflat[i*t:(i+1)*t] for i in range(t)]
P = [Pflat[i*t:(i+1)*t] for i in range(t)]

def sigma(x: int) -> int:
    x2 = mod(x * x)
    return mod(x2 * x2 * x)

def mix_full(state: List[int], matrix: List[List[int]]) -> List[int]:
    out = [0] * t
    for i in range(t):
        acc = 0
        for j in range(t):
            acc = mod(acc + matrix[j][i] * state[j])
        out[i] = acc
    return out

def mix_s(state: List[int], r: int) -> List[int]:
    base = r * (2 * t - 1)
    out = [0] * t
    acc = 0
    for i in range(t):
        acc = mod(acc + S[base + i] * state[i])
    out[0] = acc
    for i in range(1, t):
        out[i] = mod(state[i] + S[base + (t - 1) + i] * state[0])
    return out

def poseidon2(a: int, b: int) -> int:
    """Poseidon(2) — matches the on-chain PoseidonT3.poseidon and the circuit."""
    st = [0, a, b]
    st = [mod(v + C[i]) for i, v in enumerate(st)]
    for r in range(nRoundsF // 2 - 1):
        st = [sigma(x) for x in st]
        st = [mod(v + C[(r + 1) * t + i]) for i, v in enumerate(st)]
        st = mix_full(st, M)
    st = [sigma(x) for x in st]
    st = [mod(v + C[(nRoundsF // 2) * t + i]) for i, v in enumerate(st)]
    st = mix_full(st, P)
    for r in range(nRoundsP):
        st[0] = sigma(st[0])
        st[0] = mod(st[0] + C[(nRoundsF // 2 + 1) * t + r])
        st = mix_s(st, r)
    for r in range(nRoundsF // 2 - 1):
        st = [sigma(x) for x in st]
        st = [mod(v + C[(nRoundsF // 2 + 1) * t + nRoundsP + r * t + i]) for i, v in enumerate(st)]
        st = mix_full(st, M)
    st = [sigma(x) for x in st]
    acc = 0
    for j in range(t):
        acc = mod(acc + M[j][0] * st[j])
    return acc

# t=2 (Poseidon(1) for nullifierHash)
t2, nRoundsF2, nRoundsP2 = 2, 8, 56
C2 = ALL.get("POSEIDON_C", {}).get(2, [])
M2flat = ALL.get("POSEIDON_M", {}).get(2, [])
P2flat = ALL.get("POSEIDON_P", {}).get(2, [])
S2 = ALL.get("POSEIDON_S", {}).get(2, [])
M2 = [M2flat[i*t2:(i+1)*t2] for i in range(t2)]
P2 = [P2flat[i*t2:(i+1)*t2] for i in range(t2)]

def poseidon1(a: int) -> int:
    """Poseidon(1) — matches the circuit's nullifierHash = Poseidon(nullifier)."""
    st = [0, a]
    st = [mod(v + C2[i]) for i, v in enumerate(st)]
    for r in range(nRoundsF2 // 2 - 1):
        st = [sigma(x) for x in st]
        st = [mod(v + C2[(r + 1) * t2 + i]) for i, v in enumerate(st)]
        st = mix_full(st, M2)
    st = [sigma(x) for x in st]
    st = [mod(v + C2[(nRoundsF2 // 2) * t2 + i]) for i, v in enumerate(st)]
    st = mix_full(st, P2)
    for r in range(nRoundsP2):
        st[0] = sigma(st[0])
        st[0] = mod(st[0] + C2[(nRoundsF2 // 2 + 1) * t2 + r])
        st = mix_s(st, r)  # reuse mix_s (same structure)
    for r in range(nRoundsF2 // 2 - 1):
        st = [sigma(x) for x in st]
        st = [mod(v + C2[(nRoundsF2 // 2 + 1) * t2 + nRoundsP2 + r * t2 + i]) for i, v in enumerate(st)]
        st = mix_full(st, M2)
    st = [sigma(x) for x in st]
    acc = 0
    for j in range(t2):
        acc = mod(acc + M2[j][0] * st[j])
    return acc

# ── Incremental Merkle tree (depth 20, matches PrivacyPool.sol) ──────────────
DEPTH = 20
_zeros = [0]
for l in range(1, DEPTH + 1):
    _zeros.append(poseidon2(_zeros[l-1], _zeros[l-1]))
ZEROS = tuple(_zeros)

class IncrementalMerkleTree:
    """Incremental Poseidon Merkle tree (depth 20). Matches PrivacyPool._insert exactly."""

    def __init__(self):
        self.filled_subtrees: List[int] = list(ZEROS[:DEPTH])
        self.current_root: int = ZEROS[DEPTH]
        self.next_leaf_index: int = 0

    def insert(self, leaf: int) -> int:
        """Insert a leaf and return its index. Updates root."""
        index = self.next_leaf_index
        current = leaf
        for l in range(DEPTH):
            is_right = ((index >> l) & 1) == 1
            if is_right:
                left = self.filled_subtrees[l]
                self.filled_subtrees[l] = ZEROS[l]
                current = poseidon2(left, current)
            else:
                self.filled_subtrees[l] = current
                current = poseidon2(current, ZEROS[l])
        self.current_root = current
        self.next_leaf_index = index + 1
        return index

    def get_path(self, leaf: int) -> Tuple[int, List[int], List[int]]:
        """
        Insert the leaf and return (index, merklePathElements, merklePathIndices).
        This is the exact path the withdraw.circom circuit expects.
        """
        index = self.next_leaf_index
        current = leaf
        elements: List[int] = []
        indices: List[int] = []
        for l in range(DEPTH):
            is_right = ((index >> l) & 1) == 1
            indices.append(1 if is_right else 0)
            if is_right:
                sibling = self.filled_subtrees[l]
                elements.append(sibling)
                self.filled_subtrees[l] = ZEROS[l]
                current = poseidon2(sibling, current)
            else:
                elements.append(ZEROS[l])
                self.filled_subtrees[l] = current
                current = poseidon2(current, ZEROS[l])
        self.current_root = current
        self.next_leaf_index = index + 1
        return index, elements, indices

    @property
    def root(self) -> int:
        return self.current_root

    @property
    def leaf_count(self) -> int:
        return self.next_leaf_index


def compute_commitment(nullifier: int, secret: int) -> int:
    return poseidon2(nullifier, secret)

def compute_nullifier_hash(nullifier: int) -> int:
    return poseidon1(nullifier)