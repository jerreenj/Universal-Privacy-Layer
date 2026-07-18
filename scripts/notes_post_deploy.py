"""
notes_post_deploy.py — Update backend + frontend + deployed_base.json with
the new ConfidentialNotes + ConfidentialNotesVerifier addresses after a
redeploy via scripts/deploy_notes_verifier.sh.

Usage:
  python3 scripts/notes_post_deploy.py <NEW_VERIFIER_ADDR> <NEW_NOTES_ADDR>
"""

import json, re, sys, pathlib

if len(sys.argv) < 3:
    print("Usage: python3 notes_post_deploy.py <NEW_VERIFIER_ADDR> <NEW_NOTES_ADDR>")
    sys.exit(1)

NEW_VERIFIER, NEW_NOTES = sys.argv[1], sys.argv[2]

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

# --- backend/server.py: replace _NOTES_CONTRACT_ADDR + _NOTES_VERIFIER_ADDR ---
server_py = REPO_ROOT / "backend" / "server.py"
text = server_py.read_text()

old_notes_addr = re.search(r'_NOTES_CONTRACT_ADDR\s*=\s*"(0x[0-9a-fA-F]+)"', text)
old_verifier_addr = re.search(r'_NOTES_VERIFIER_ADDR\s*=\s*"(0x[0-9a-fA-F]+)"', text)

if old_notes_addr:
    old_n = old_notes_addr.group(1)
    text = text.replace(f'_NOTES_CONTRACT_ADDR = "{old_n}"', f'_NOTES_CONTRACT_ADDR = "{NEW_NOTES}"')
    print(f"  server.py: _NOTES_CONTRACT_ADDR  {old_n} -> {NEW_NOTES}")

if old_verifier_addr:
    old_v = old_verifier_addr.group(1)
    text = text.replace(f'_NOTES_VERIFIER_ADDR = "{old_v}"', f'_NOTES_VERIFIER_ADDR = "{NEW_VERIFIER}"')
    print(f"  server.py: _NOTES_VERIFIER_ADDR  {old_v} -> {NEW_VERIFIER}")

server_py.write_text(text)

# --- frontend/src/lib/confidential-notes.js: replace NOTES_ADDR ---
notes_js = REPO_ROOT / "frontend" / "src" / "lib" / "confidential-notes.js"
js_text = notes_js.read_text()
old_js_addr = re.search(r'NOTES_ADDR\s*=\s*"(0x[0-9a-fA-F]+)"', js_text)
if old_js_addr:
    old_j = old_js_addr.group(1)
    js_text = js_text.replace(f'NOTES_ADDR = "{old_j}"', f'NOTES_ADDR = "{NEW_NOTES}"')
    print(f"  confidential-notes.js: NOTES_ADDR  {old_j} -> {NEW_NOTES}")
notes_js.write_text(js_text)

# --- deployed_base.json: update confidential_notes + confidential_notes_verifier ---
manifest = REPO_ROOT / "contracts" / "deployed_base.json"
if manifest.exists():
    data = json.loads(manifest.read_text())
    if "base" in data:
        old_cn = data["base"].get("confidential_notes", "<none>")
        data["base"]["confidential_notes"] = NEW_NOTES
        print(f"  deployed_base.json: confidential_notes  {old_cn} -> {NEW_NOTES}")
        old_cv = data["base"].get("confidential_notes_verifier", "<none>")
        data["base"]["confidential_notes_verifier"] = NEW_VERIFIER
        print(f"  deployed_base.json: confidential_notes_verifier  {old_cv} -> {NEW_VERIFIER}")
    manifest.write_text(json.dumps(data, indent=2) + "\n")

print("Done.")
