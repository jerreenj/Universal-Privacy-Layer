#!/usr/bin/env python3
"""
Deploy UPL Move contracts to Sui Mainnet using pysui
Run after: pip install pysui
"""

import subprocess
import json
import os
import sys

MNEMONIC = "inside post tool solar phone biology render blade broken draw hockey senior"
SUI_ADDRESS = "0xfde77f3867fd0ab7c76fcebc4f0190460d80dc9d1da016bda033e675cb99ff35"
MOVE_PROJECT_DIR = "/app/contracts/sui/privacy_layer"


def check_sui_cli():
    """Check if Sui CLI is available"""
    try:
        result = subprocess.run(["sui", "--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"Sui CLI: {result.stdout.strip()}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False


def install_sui_cli():
    """Install Sui CLI via cargo or download binary"""
    print("Installing Sui CLI...")

    # Try downloading pre-built binary
    import platform
    system = platform.system().lower()

    # Download latest sui binary
    cmd = [
        "bash", "-c",
        """
        export LATEST=$(curl -s https://api.github.com/repos/MystenLabs/sui/releases/latest | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
        echo "Latest Sui: $LATEST"
        wget -q "https://github.com/MystenLabs/sui/releases/download/$LATEST/sui-$LATEST-ubuntu-x86_64.tgz" -O /tmp/sui.tgz 2>&1 | tail -3
        tar -xzf /tmp/sui.tgz -C /tmp/ 2>/dev/null || true
        find /tmp -name "sui" -type f -executable 2>/dev/null | head -1
        """
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    print(result.stdout)

    # Find the binary
    find_result = subprocess.run(["find", "/tmp", "-name", "sui", "-type", "f"], capture_output=True, text=True)
    sui_bin = find_result.stdout.strip().split("\n")[0] if find_result.stdout.strip() else None

    if sui_bin and os.path.exists(sui_bin):
        os.chmod(sui_bin, 0o755)
        subprocess.run(["cp", sui_bin, "/usr/local/bin/sui"], check=True)
        print(f"Sui CLI installed from: {sui_bin}")
        return True

    print("Could not install Sui CLI automatically")
    return False


def setup_wallet():
    """Import wallet from mnemonic into Sui CLI"""
    print("\nSetting up Sui wallet from mnemonic...")

    # Initialize sui config
    subprocess.run(["sui", "client", "new-env", "--alias", "mainnet",
                   "--rpc", "https://fullnode.mainnet.sui.io:443"], capture_output=True)
    subprocess.run(["sui", "client", "switch", "--env", "mainnet"], capture_output=True)

    # Import from mnemonic
    result = subprocess.run(
        ["sui", "keytool", "import", MNEMONIC, "ed25519"],
        capture_output=True, text=True, timeout=30
    )
    print(f"Import result: {result.stdout} {result.stderr}")

    # Set active address
    result = subprocess.run(["sui", "client", "switch", "--address", SUI_ADDRESS],
                           capture_output=True, text=True)
    print(f"Switch address: {result.stdout} {result.stderr}")

    # Check balance
    result = subprocess.run(["sui", "client", "balance", "--address", SUI_ADDRESS],
                           capture_output=True, text=True)
    print(f"Balance: {result.stdout}")


def build_and_deploy():
    """Build Move package and deploy to Sui mainnet"""
    print(f"\nBuilding Move package at {MOVE_PROJECT_DIR}...")

    # Build
    build_result = subprocess.run(
        ["sui", "move", "build"],
        capture_output=True, text=True,
        cwd=MOVE_PROJECT_DIR, timeout=120
    )
    print("BUILD STDOUT:", build_result.stdout[-2000:] if build_result.stdout else "")
    print("BUILD STDERR:", build_result.stderr[-2000:] if build_result.stderr else "")

    if build_result.returncode != 0:
        print("BUILD FAILED")
        return None

    print("\nDeploying to Sui Mainnet...")

    # Publish
    publish_result = subprocess.run(
        ["sui", "client", "publish",
         "--gas-budget", "100000000",  # 0.1 SUI
         "--json"],
        capture_output=True, text=True,
        cwd=MOVE_PROJECT_DIR, timeout=180
    )

    print("PUBLISH STDOUT:", publish_result.stdout[-3000:] if publish_result.stdout else "")
    if publish_result.stderr:
        print("PUBLISH STDERR:", publish_result.stderr[-1000:])

    if publish_result.returncode != 0:
        print("PUBLISH FAILED")
        return None

    # Parse result
    try:
        data = json.loads(publish_result.stdout)
        package_id = None

        # Extract package ID from effects
        if "objectChanges" in data:
            for change in data["objectChanges"]:
                if change.get("type") == "published":
                    package_id = change.get("packageId")
                    break

        if package_id:
            print(f"\n{'='*55}")
            print(f"DEPLOYED PACKAGE ID: {package_id}")
            print(f"Explorer: https://suiexplorer.com/object/{package_id}")
            print(f"{'='*55}")

            result = {
                "network": "sui_mainnet",
                "package_id": package_id,
                "deployer": SUI_ADDRESS,
                "explorer": f"https://suiexplorer.com/object/{package_id}",
                "modules": ["privacy_relayer", "stealth_registry"]
            }

            with open("/app/contracts/deployed_sui.json", "w") as f:
                json.dump(result, f, indent=2)

            return result
        else:
            print("Could not extract package ID from result")
            print("Full result:", json.dumps(data, indent=2)[:2000])
    except json.JSONDecodeError:
        print("Could not parse JSON output")

    return None


if __name__ == "__main__":
    print("="*55)
    print("UPL MOVE CONTRACT DEPLOYMENT — SUI MAINNET")
    print("="*55)
    print(f"Deployer: {SUI_ADDRESS}")
    print()

    if not check_sui_cli():
        print("Sui CLI not found. Installing...")
        if not install_sui_cli():
            print("\nSui CLI installation failed.")
            print("Manual deploy steps:")
            print("  1. Install Sui CLI: https://docs.sui.io/guides/developer/getting-started/sui-install")
            print("  2. Run: sui keytool import '<mnemonic>' ed25519")
            print(f"  3. Run: cd {MOVE_PROJECT_DIR} && sui client publish --gas-budget 100000000")
            sys.exit(1)

    setup_wallet()
    result = build_and_deploy()

    if result:
        print("\nDEPLOYMENT SUCCESSFUL!")
        print(json.dumps(result, indent=2))
    else:
        print("\nDeployment failed — check logs above")
