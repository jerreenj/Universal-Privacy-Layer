// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AerodromePrivacyWrapper, IAerodromeRouter} from "../src/AerodromePrivacyWrapper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock Aerodrome Router — models swapExactETHForTokens /
///         swapExactTokensForETH / swapExactTokensForTokens with a
///         1-to-1 mapping for any route in tests (real swaps go through
///         Aerodrome's actual pool factory — that's outside this contract).
///         Mirrors Aerodrome V2's 4-field Route struct (from, to,
///         stable, factory).
contract MockAerodromeRouter {
    bool public failNext = false;
    uint256 public nextAmountOut = 0;

    function setFailNext(bool v) external {
        failNext = v;
    }

    function setNextAmountOut(uint256 v) external {
        nextAmountOut = v;
    }

    function getAmountsOut(uint256 amountIn, IAerodromeRouter.Route[] calldata)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = nextAmountOut == 0 ? amountIn : nextAmountOut;
    }

    function swapExactETHForTokens(uint256, IAerodromeRouter.Route[] calldata routes, address to, uint256)
        external
        payable
        returns (uint256 amountOut)
    {
        if (failNext) {
            failNext = false;
            revert("mock fail");
        }
        // Real Aerodrome has the router wrap WETH and swap through the
        // pool. We just transfer the test token directly.
        amountOut = nextAmountOut == 0 ? msg.value : nextAmountOut;
        if (routes[0].to != address(0)) {
            // assume tokenOut = routes[routes.length-1].to
            IERC20(routes[routes.length - 1].to).transfer(to, amountOut);
        }
    }

    function swapExactTokensForETH(uint256 amountIn, uint256, IAerodromeRouter.Route[] calldata, address to, uint256)
        external
        returns (uint256 amountOut)
    {
        if (failNext) {
            failNext = false;
            revert("mock fail");
        }
        amountOut = nextAmountOut == 0 ? amountIn : nextAmountOut;
        // transferFrom was already done by caller; we just pay ETH.
        (bool ok,) = to.call{value: amountOut}("");
        require(ok, "mock ETH send");
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256,
        IAerodromeRouter.Route[] calldata routes,
        address to,
        uint256
    ) external returns (uint256 amountOut) {
        if (failNext) {
            failNext = false;
            revert("mock fail");
        }
        // router pulls tokenIn via transferFrom — but caller (the wrapper)
        // already pulled tokenIn to the wrapper, then approved router, so
        // we transferFrom here. To keep this simple we just pretend.
        amountOut = nextAmountOut == 0 ? amountIn : nextAmountOut;
        if (routes[routes.length - 1].to != address(0)) {
            IERC20(routes[routes.length - 1].to).transfer(to, amountOut);
            // pull tokenIn back from msg.sender for accounting
            IERC20(routes[0].from).transferFrom(msg.sender, address(this), amountIn);
        }
    }

    receive() external payable {}
}

/// @notice Mock WETH9 — minimal deposit/withdraw/transfer.
contract MockWETH9 {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    /// @notice Test helper — mint balance to a target without ETH. In
    ///         production this contract has no minter; the deposit() path
    ///         is the only way to mint via WETH9 on Base. Used here to
    ///         seed the MockAerodromeRouter with USDC liquidity.
    function mintTo(address to, uint256 wad) external {
        balanceOf[to] += wad;
        totalSupply += wad;
    }

    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "balance");
        balanceOf[msg.sender] -= wad;
        totalSupply -= wad;
        (bool ok,) = msg.sender.call{value: wad}("");
        require(ok, "weth send");
    }

    function approve(address guy, uint256 wad) external returns (bool) {
        allowance[msg.sender][guy] = wad;
        return true;
    }

    function transfer(address dst, uint256 wad) external returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(balanceOf[src] >= wad, "balance");
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "allowance");
            allowance[src][msg.sender] -= wad;
        }
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        return true;
    }
}

/// @notice Mock ERC20 token for the test pool.
contract MockERC20 is MockWETH9 {
    constructor(string memory s) {
        symbol = s;
    }
}

contract AerodromePrivacyWrapperTest is Test {
    AerodromePrivacyWrapper internal wrapper;
    MockAerodromeRouter internal mockRouter;
    MockWETH9 internal weth;
    MockERC20 internal usdc; // 6-decimal USDC clone
    address internal feeRecipient = address(0xFEED);

    // Aerodrome V2 uses ONE PoolFactory for both stable + volatile pools
    // — match AERODROME_VOLATILE_FACTORY and AERODROME_STABLE_FACTORY in
    // the wrapper constructor. Use the canonical Base Mainnet address
    // for tests to mirror what deployments/wrapper config expects.
    address internal poolFactoryV = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    address internal poolFactoryS = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    address internal user = address(0xBEEF);
    address internal recipientStealth = address(0xC0FFEE);

    uint256 internal constant AMOUNT_IN = 1 ether; // 1 ETH in
    uint256 internal constant AMOUNT_OUT_USDC = 2500e6; // 2500 USDC out

    function setUp() public {
        mockRouter = new MockAerodromeRouter();
        weth = new MockWETH9();
        usdc = new MockERC20("USDC");
        wrapper =
            new AerodromePrivacyWrapper(address(mockRouter), address(weth), feeRecipient, poolFactoryV, poolFactoryS);
        mockRouter.setNextAmountOut(AMOUNT_OUT_USDC);
        vm.label(feeRecipient, "feeRecipient");

        // Pre-mint USDC into the mock router so its transfer(to, amountOut)
        // in swapExactETHForTokens has source balance. (In prod, the
        // Aerodrome Router pulls from the underlying pool which has real
        // liquidity; here we just hard-code source balance.)
        usdc.mintTo(address(mockRouter), AMOUNT_OUT_USDC);

        vm.deal(user, 100 ether);
    }

    /// @notice Helper — builds a single-hop Route with the canonical
    ///         Aerodrome PoolFactory — mirrors what the wrapper's
    ///         `route()` helper emits.
    function _routeVolatile() internal view returns (IAerodromeRouter.Route[] memory r) {
        r = new IAerodromeRouter.Route[](1);
        r[0] = IAerodromeRouter.Route(address(weth), address(usdc), false, poolFactoryV);
    }

    /// @notice Constructor enforces non-zero addresses on every arg.
    function testRevert_ConstructorZeroAddress() public {
        vm.expectRevert(AerodromePrivacyWrapper.InvalidRecipient.selector);
        new AerodromePrivacyWrapper(address(0), address(weth), feeRecipient, poolFactoryV, poolFactoryS);
        vm.expectRevert(AerodromePrivacyWrapper.InvalidRecipient.selector);
        new AerodromePrivacyWrapper(address(mockRouter), address(0), feeRecipient, poolFactoryV, poolFactoryS);
        vm.expectRevert(AerodromePrivacyWrapper.InvalidRecipient.selector);
        new AerodromePrivacyWrapper(address(mockRouter), address(weth), address(0), poolFactoryV, poolFactoryS);
        vm.expectRevert(AerodromePrivacyWrapper.InvalidRecipient.selector);
        new AerodromePrivacyWrapper(address(mockRouter), address(weth), feeRecipient, address(0), poolFactoryS);
        vm.expectRevert(AerodromePrivacyWrapper.InvalidRecipient.selector);
        new AerodromePrivacyWrapper(address(mockRouter), address(weth), feeRecipient, poolFactoryV, address(0));
    }

    /// @notice Immutable address set is what we passed at deploy.
    function test_Immutables() public {
        assertEq(wrapper.aerodromeRouter(), address(mockRouter));
        assertEq(wrapper.WETH(), address(weth));
        assertEq(wrapper.volatileFactory(), poolFactoryV);
        assertEq(wrapper.stableFactory(), poolFactoryS);
    }

    /// @notice `route(from, to, stable)` returns a struct with the
    ///         correct factory for the stable flag — this is the
    ///         helper the frontend uses to build Route arrays.
    function test_Route() public {
        IAerodromeRouter.Route memory r = wrapper.route(address(weth), address(usdc), true);
        assertEq(r.from, address(weth));
        assertEq(r.to, address(usdc));
        assertTrue(r.stable);
        assertEq(r.factory, poolFactoryS);

        IAerodromeRouter.Route memory r2 = wrapper.route(address(usdc), address(weth), false);
        assertEq(r2.from, address(usdc));
        assertEq(r2.to, address(weth));
        assertFalse(r2.stable);
        assertEq(r2.factory, poolFactoryV);
    }

    /// @notice factoryFor(stable) toggles between volatile/stable immutables.
    function test_FactoryFor() public {
        assertEq(wrapper.factoryFor(false), poolFactoryV);
        assertEq(wrapper.factoryFor(true), poolFactoryS);
    }

    /// @notice ETH -> USDC private swap succeeds; output lands at stealth
    ///         recipient, fee lands at feeRecipient, msg.sender pays exactly
    ///         msg.value and gets nothing back.
    function test_PrivateSwapETHForTokenPaysOut() public {
        IAerodromeRouter.Route[] memory routes = _routeVolatile();

        uint256 feeBefore = feeRecipient.balance;

        vm.prank(user);
        uint256 out = wrapper.privateSwapETHForToken{value: AMOUNT_IN}(
            address(usdc), routes, 0, recipientStealth, block.timestamp + 1 hours
        );
        assertEq(out, AMOUNT_OUT_USDC, "swap returned wrong amount");
        assertEq(usdc.balanceOf(recipientStealth), AMOUNT_OUT_USDC, "USDC didn't reach stealth");
        assertEq(feeRecipient.balance - feeBefore, (AMOUNT_IN * 5) / 10000, "fee wasn't 5bps");
    }

    /// @notice The ETH <=> WETH wrap factor doesn't exist on Aerodrome's
    ///         router — it does the wrap internally — so the wrapper
    ///         MUST NOT also call WETH.deposit. Sanity: the wrapper
    ///         shouldn't hold any WETH after the swap.
    function test_PrivateSwapETHForTokenDoesNotHoldWETH() public {
        IAerodromeRouter.Route[] memory routes = _routeVolatile();
        vm.prank(user);
        wrapper.privateSwapETHForToken{value: AMOUNT_IN}(
            address(usdc), routes, 0, recipientStealth, block.timestamp + 1 hours
        );
        assertEq(weth.balanceOf(address(wrapper)), 0, "wrapper should not hold WETH");
        assertEq(address(wrapper).balance, 0, "wrapper should not hold ETH");
    }

    /// @notice Reverts when msg.value is zero.
    function testRevert_NoETHSent() public {
        IAerodromeRouter.Route[] memory routes = _routeVolatile();
        vm.prank(user);
        vm.expectRevert(AerodromePrivacyWrapper.NoETHSent.selector);
        wrapper.privateSwapETHForToken(address(usdc), routes, 0, recipientStealth, block.timestamp + 1);
    }

    /// @notice Reverts when recipient is zero.
    function testRevert_InvalidRecipient() public {
        IAerodromeRouter.Route[] memory routes = _routeVolatile();
        vm.prank(user);
        vm.expectRevert(AerodromePrivacyWrapper.InvalidRecipient.selector);
        wrapper.privateSwapETHForToken{value: AMOUNT_IN}(address(usdc), routes, 0, address(0), block.timestamp + 1);
    }

    /// @notice Reverts when routes is empty (would cause Aerodrome router
    ///         itself to revert with a non-friendly error).
    function testRevert_EmptyRoute() public {
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](0);
        vm.prank(user);
        vm.expectRevert(AerodromePrivacyWrapper.RouteEmpty.selector);
        wrapper.privateSwapETHForToken{value: AMOUNT_IN}(
            address(usdc), routes, 0, recipientStealth, block.timestamp + 1
        );
    }

    /// @notice view-quote path returns the amountOut from the router without
    ///         performing a swap.
    function test_Quote() public {
        IAerodromeRouter.Route[] memory routes = _routeVolatile();
        uint256 quoted = wrapper.quote(AMOUNT_IN, routes);
        assertEq(quoted, AMOUNT_OUT_USDC, "quote should match the router's getAmountsOut tail");
    }

    /// @notice quoteNetOfFee subtracts 5 bps from msg.value.
    function test_QuoteNetOfFee() public {
        (uint256 amtIn, uint256 fee) = wrapper.quoteNetOfFee(AMOUNT_IN);
        assertEq(fee, (AMOUNT_IN * 5) / 10000, "fee should be 5 bps");
        assertEq(amtIn + fee, AMOUNT_IN, "amtIn + fee should equal msg.value");
    }

    /// @notice setFeeRecipient lets the deployer rotate the fee wallet.
    function test_SetFeeRecipient() public {
        address newRecipient = address(0xCAFE);
        wrapper.setFeeRecipient(newRecipient);
        // Run an ETH->USDC swap; fee should land at newRecipient now.
        IAerodromeRouter.Route[] memory routes = _routeVolatile();
        uint256 feeBefore = newRecipient.balance;
        vm.prank(user);
        wrapper.privateSwapETHForToken{value: AMOUNT_IN}(
            address(usdc), routes, 0, recipientStealth, block.timestamp + 1
        );
        assertEq(newRecipient.balance - feeBefore, (AMOUNT_IN * 5) / 10000, "new feeRecipient missed fee");
    }

    /// @notice Reverts when feeRecipient is set to zero.
    function testRevert_SetFeeRecipientZero() public {
        vm.expectRevert(bytes("zero"));
        wrapper.setFeeRecipient(address(0));
    }
}
