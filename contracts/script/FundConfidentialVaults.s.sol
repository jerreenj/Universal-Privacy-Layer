// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * FundConfidentialVaults.s.sol
 *
 * One-off script: funds both confidential swap vaults on Base mainnet
 * so they can execute real swaps. Both vaults were deployed with zero
 * reserves — without this funding, every swap reverts with
 * InsufficientReserves.
 *
 * Forward vault (ConfidentialNativePrivateSwap):
 *   - Needs USDC. We approve + call fundUSDC(5e6) (5 USDC, 6 decimals).
 *
 * Reverse vault (ConfidentialReverseSwap):
 *   - Needs ETH. We send 0.005 ETH via its receive() function.
 *
 * Run:
 *   forge script script/FundConfidentialVaults.s.sol \
 *     --rpc-url $BASE_RPC_URL \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast --slow
 */
import "forge-std/Script.sol";

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IForwardVault {
    function fundUSDC(uint256 amount) external;
    function usdcReserve() external view returns (uint256);
}

contract FundConfidentialVaults is Script {
    // Base mainnet USDC (6 decimals)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Deployed vaults (from deployed_base.json)
    address constant FORWARD_VAULT =
        0x66F71263436dA696eC3fFDFf925b101585D04e0F; // ConfidentialNativePrivateSwap
    address constant REVERSE_VAULT =
        0xbB983A6222966E3E552bdbCB5Fb7620dD34c9526; // ConfidentialReverseSwap

    // Funding amounts — adjusted to the deployer's actual balance
    // (3 USDC, ~0.0002 ETH). We fund 2 USDC + 0.0001 ETH, keeping
    // 1 USDC + ~0.0001 ETH as gas buffer for the funding tx itself.
    uint256 constant USDC_FUND = 2 * 1e6;       // 2 USDC (6 decimals)
    uint256 constant ETH_FUND  = 0.0001 ether;   // 0.0001 ETH

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. Fund forward vault with USDC ──────────────────────────
        // Approve USDC for the forward vault, then call fundUSDC().
        IERC20(USDC).approve(FORWARD_VAULT, USDC_FUND);
        IForwardVault(FORWARD_VAULT).fundUSDC(USDC_FUND);
        console.log("Forward vault funded with", USDC_FUND, "USDC");

        // ── 2. Fund reverse vault with ETH ───────────────────────────
        // The reverse vault has a receive() function — just send ETH.
        (bool ok, ) = payable(REVERSE_VAULT).call{value: ETH_FUND}("");
        require(ok, "ETH funding failed");
        console.log("Reverse vault funded with", ETH_FUND, "wei");

        vm.stopBroadcast();

        // Refund any remaining ETH to the deployer (gas dust).
        if (address(this).balance > 0) {
            payable(deployer).transfer(address(this).balance);
        }
    }
}
