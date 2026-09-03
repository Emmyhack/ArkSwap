// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair, IToken} from "../utils/Interfaces.sol";

/// @notice ArkSwapRouter02 unit tests (llm.txt s12, s13, s19).
/// @dev Reminder: the `...ETH...` entry points move native KASH on Ark. The names
///      are inherited Uniswap V2 ABI terminology (llm.txt s41).
contract RouterTest is ArkSwapTest {
    uint256 internal lpKey = 0xA11CE5;
    address internal lp;

    uint256 internal constant KASH_LIQ = 10_000e18;
    uint256 internal constant USDC_LIQ = 10_000e6;

    function setUp() public {
        _deployStack();
        lp = vm.addr(lpKey);

        vm.deal(lp, 1_000_000e18);
        vm.deal(alice, 1_000_000e18);
        usdc.mint(lp, 1_000_000e6);
        usdc.mint(alice, 1_000_000e6);
        usdt.mint(lp, 1_000_000e6);
        usdt.mint(alice, 1_000_000e6);

        vm.startPrank(lp);
        usdc.approve(address(router), type(uint256).max);
        usdt.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(router), type(uint256).max);
        usdt.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- deployment

    function test_routerConfiguration() public view {
        assertEq(router.factory(), address(factory));
        assertEq(router.WETH(), address(wkash), "WETH() must return canonical WKASH");
        assertEq(router.WKASH(), address(wkash), "WKASH() alias must agree with WETH()");
    }

    // ---------------------------------------------------------- add liquidity

    function test_addLiquidity() public {
        vm.prank(lp);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            router.addLiquidity(address(usdc), address(usdt), 1_000e6, 1_000e6, 0, 0, lp, _deadline());

        assertEq(amountA, 1_000e6);
        assertEq(amountB, 1_000e6);
        assertGt(liquidity, 0);

        IArkSwapPair p = pair(address(usdc), address(usdt));
        assertEq(p.balanceOf(lp), liquidity);
    }

    /// @dev Router auto-creates the pair on first deposit.
    function test_addLiquidityCreatesPair() public {
        assertEq(factory.getPair(address(usdc), address(usdt)), address(0));

        vm.prank(lp);
        router.addLiquidity(address(usdc), address(usdt), 1_000e6, 1_000e6, 0, 0, lp, _deadline());

        assertEq(
            factory.getPair(address(usdc), address(usdt)), lib.pairFor(address(factory), address(usdc), address(usdt))
        );
    }

    function test_addLiquidityETH() public {
        _seedKashUsdc();

        IArkSwapPair p = pair(address(wkash), address(usdc));
        (uint256 rKash,) = _reservesFor(p, address(wkash));
        assertEq(rKash, KASH_LIQ, "native KASH must be wrapped into the pool");
        assertEq(wkash.balanceOf(address(p)), KASH_LIQ);
    }

    /// @dev Off-ratio deposits must refund the unused native KASH.
    function test_addLiquidityETHRefundsDust() public {
        _seedKashUsdc();

        uint256 balanceBefore = lp.balance;
        vm.prank(lp);
        // Offer 2x the KASH the ratio needs; only half should be consumed.
        router.addLiquidityETH{value: 200e18}(address(usdc), 100e6, 0, 0, lp, _deadline());

        uint256 spent = balanceBefore - lp.balance;
        assertEq(spent, 100e18, "excess native KASH must be refunded");
    }

    function test_addLiquidityRespectsMinimums() public {
        _seedKashUsdc();

        vm.expectRevert(bytes("ArkSwapRouter: INSUFFICIENT_B_AMOUNT"));
        vm.prank(lp);
        router.addLiquidity(address(usdc), address(wkash), 100e6, 100e18, 0, 200e18, lp, _deadline());
    }

    // ------------------------------------------------------- remove liquidity

    function test_removeLiquidity() public {
        vm.prank(lp);
        (,, uint256 liquidity) =
            router.addLiquidity(address(usdc), address(usdt), 1_000e6, 1_000e6, 0, 0, lp, _deadline());

        IArkSwapPair p = pair(address(usdc), address(usdt));
        vm.startPrank(lp);
        p.approve(address(router), liquidity);
        (uint256 amountA, uint256 amountB) =
            router.removeLiquidity(address(usdc), address(usdt), liquidity, 0, 0, lp, _deadline());
        vm.stopPrank();

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(p.balanceOf(lp), 0);
    }

    function test_removeLiquidityETH() public {
        uint256 liquidity = _seedKashUsdc();
        IArkSwapPair p = pair(address(wkash), address(usdc));

        uint256 kashBefore = lp.balance;
        vm.startPrank(lp);
        p.approve(address(router), liquidity);
        (uint256 amountToken, uint256 amountKash) =
            router.removeLiquidityETH(address(usdc), liquidity, 0, 0, lp, _deadline());
        vm.stopPrank();

        assertGt(amountToken, 0);
        assertGt(amountKash, 0);
        assertEq(lp.balance - kashBefore, amountKash, "native KASH must be unwrapped to the LP");
    }

    function test_removeLiquidityWithPermit() public {
        vm.prank(lp);
        (,, uint256 liquidity) =
            router.addLiquidity(address(usdc), address(usdt), 1_000e6, 1_000e6, 0, 0, lp, _deadline());

        IArkSwapPair p = pair(address(usdc), address(usdt));
        uint256 deadline = _deadline();
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(p, lpKey, liquidity, deadline);

        vm.prank(lp);
        (uint256 amountA, uint256 amountB) = router.removeLiquidityWithPermit(
            address(usdc), address(usdt), liquidity, 0, 0, lp, deadline, false, v, r, s
        );

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(p.balanceOf(lp), 0, "permit path must burn without a prior approve()");
    }

    function test_removeLiquidityETHWithPermit() public {
        uint256 liquidity = _seedKashUsdc();
        IArkSwapPair p = pair(address(wkash), address(usdc));

        uint256 deadline = _deadline();
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(p, lpKey, liquidity, deadline);

        uint256 kashBefore = lp.balance;
        vm.prank(lp);
        (, uint256 amountKash) =
            router.removeLiquidityETHWithPermit(address(usdc), liquidity, 0, 0, lp, deadline, false, v, r, s);

        assertEq(lp.balance - kashBefore, amountKash);
    }

    // ------------------------------------------------------------------ swaps

    function test_swapExactTokensForTokens() public {
        _seedUsdcUsdt();

        address[] memory path = _path2(address(usdc), address(usdt));
        uint256[] memory quoted = router.getAmountsOut(100e6, path);

        uint256 before = usdt.balanceOf(alice);
        vm.prank(alice);
        uint256[] memory amounts = router.swapExactTokensForTokens(100e6, quoted[1], path, alice, _deadline());

        assertEq(amounts[1], quoted[1], "execution must match the quote");
        assertEq(usdt.balanceOf(alice) - before, quoted[1]);
    }

    function test_swapTokensForExactTokens() public {
        _seedUsdcUsdt();

        address[] memory path = _path2(address(usdc), address(usdt));
        uint256[] memory quoted = router.getAmountsIn(100e6, path);

        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        router.swapTokensForExactTokens(100e6, quoted[0], path, alice, _deadline());

        assertEq(usdcBefore - usdc.balanceOf(alice), quoted[0]);
        assertEq(usdt.balanceOf(alice), 1_000_000e6 + 100e6);
    }

    function test_swapExactETHForTokens() public {
        _seedKashUsdc();

        address[] memory path = _path2(address(wkash), address(usdc));
        uint256[] memory quoted = router.getAmountsOut(1e18, path);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        router.swapExactETHForTokens{value: 1e18}(quoted[1], path, alice, _deadline());

        assertEq(usdc.balanceOf(alice) - before, quoted[1], "KASH -> mUSDC");
    }

    function test_swapExactTokensForETH() public {
        _seedKashUsdc();

        address[] memory path = _path2(address(usdc), address(wkash));
        uint256[] memory quoted = router.getAmountsOut(100e6, path);

        uint256 before = alice.balance;
        vm.prank(alice);
        router.swapExactTokensForETH(100e6, quoted[1], path, alice, _deadline());

        assertEq(alice.balance - before, quoted[1], "mUSDC -> KASH");
    }

    function test_swapETHForExactTokens() public {
        _seedKashUsdc();

        address[] memory path = _path2(address(wkash), address(usdc));
        uint256[] memory quoted = router.getAmountsIn(100e6, path);

        uint256 kashBefore = alice.balance;
        uint256 usdcBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        router.swapETHForExactTokens{value: quoted[0] * 2}(100e6, path, alice, _deadline());

        assertEq(usdc.balanceOf(alice) - usdcBefore, 100e6);
        assertEq(kashBefore - alice.balance, quoted[0], "overpayment must be refunded");
    }

    function test_swapTokensForExactETH() public {
        _seedKashUsdc();

        address[] memory path = _path2(address(usdc), address(wkash));
        uint256[] memory quoted = router.getAmountsIn(1e18, path);

        uint256 before = alice.balance;
        vm.prank(alice);
        router.swapTokensForExactETH(1e18, quoted[0], path, alice, _deadline());

        assertEq(alice.balance - before, 1e18);
    }

    function test_multiHopSwap() public {
        _seedKashUsdc();
        _seedKashUsdt();

        address[] memory path = _path3(address(usdt), address(wkash), address(usdc));
        uint256[] memory quoted = router.getAmountsOut(100e6, path);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256[] memory amounts = router.swapExactTokensForTokens(100e6, quoted[2], path, alice, _deadline());

        assertEq(amounts.length, 3);
        assertEq(usdc.balanceOf(alice) - before, quoted[2], "mUSDT -> WKASH -> mUSDC");
    }

    // ----------------------------------------------------------- safety rails

    function test_expiredDeadlineReverts() public {
        _seedUsdcUsdt();
        address[] memory path = _path2(address(usdc), address(usdt));

        vm.warp(block.timestamp + 100);
        vm.expectRevert(bytes("ArkSwapRouter: EXPIRED"));
        vm.prank(alice);
        router.swapExactTokensForTokens(100e6, 0, path, alice, block.timestamp - 1);
    }

    function test_slippageProtectionOnExactInput() public {
        _seedUsdcUsdt();
        address[] memory path = _path2(address(usdc), address(usdt));
        uint256[] memory quoted = router.getAmountsOut(100e6, path);

        vm.expectRevert(bytes("ArkSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT"));
        vm.prank(alice);
        router.swapExactTokensForTokens(100e6, quoted[1] + 1, path, alice, _deadline());
    }

    function test_slippageProtectionOnExactOutput() public {
        _seedUsdcUsdt();
        address[] memory path = _path2(address(usdc), address(usdt));
        uint256[] memory quoted = router.getAmountsIn(100e6, path);

        vm.expectRevert(bytes("ArkSwapRouter: EXCESSIVE_INPUT_AMOUNT"));
        vm.prank(alice);
        router.swapTokensForExactTokens(100e6, quoted[0] - 1, path, alice, _deadline());
    }

    function test_invalidPathReverts() public {
        _seedKashUsdc();

        // A native-KASH swap whose path does not begin at WKASH.
        address[] memory badPath = _path2(address(usdc), address(usdt));
        vm.expectRevert(bytes("ArkSwapRouter: INVALID_PATH"));
        vm.prank(alice);
        router.swapExactETHForTokens{value: 1e18}(0, badPath, alice, _deadline());

        // A swap-to-native path that does not end at WKASH.
        vm.expectRevert(bytes("ArkSwapRouter: INVALID_PATH"));
        vm.prank(alice);
        router.swapExactTokensForETH(100e6, 0, badPath, alice, _deadline());
    }

    // ------------------------------------------------------ WKASH wrap/unwrap

    function test_nativeKashGetsWrapped() public {
        _seedKashUsdc();
        IArkSwapPair p = pair(address(wkash), address(usdc));

        uint256 wkashSupplyBefore = wkash.totalSupply();
        uint256 pairWkashBefore = wkash.balanceOf(address(p));

        address[] memory path = _path2(address(wkash), address(usdc));
        vm.prank(alice);
        router.swapExactETHForTokens{value: 5e18}(0, path, alice, _deadline());

        assertEq(wkash.totalSupply(), wkashSupplyBefore + 5e18, "KASH must be wrapped 1:1");
        assertEq(wkash.balanceOf(address(p)), pairWkashBefore + 5e18);
        assertEq(wkash.balanceOf(address(router)), 0, "router must not retain WKASH");
    }

    function test_wkashGetsUnwrapped() public {
        _seedKashUsdc();

        uint256 supplyBefore = wkash.totalSupply();
        address[] memory path = _path2(address(usdc), address(wkash));
        uint256[] memory quoted = router.getAmountsOut(100e6, path);

        vm.prank(alice);
        router.swapExactTokensForETH(100e6, 0, path, alice, _deadline());

        assertEq(wkash.totalSupply(), supplyBefore - quoted[1], "WKASH must be burned on unwrap");
        assertEq(address(router).balance, 0, "router must not retain native KASH");
    }

    /// @dev The router must only accept native KASH from the WKASH unwrap path
    ///      (llm.txt s13). A direct transfer has to fail.
    function test_routerOnlyAcceptsNativeFromWkashReceivePath() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1e18}("");
        assertFalse(ok, "router accepted native KASH from a non-WKASH sender");
        assertEq(address(router).balance, 0);
    }

    // --------------------------------------------------- fee-on-transfer path

    function test_feeOnTransferSupportingPath() public {
        address dtt = vm.deployCode("DeflatingERC20.sol:DeflatingERC20", abi.encode(uint256(1_000_000e18)));
        IToken deflating = IToken(dtt);

        deflating.transfer(alice, 100_000e18);
        deflating.approve(address(router), type(uint256).max);

        // Seed a DTT/KASH pool. The pool receives 99% of what is sent.
        router.addLiquidityETH{value: 1_000e18}(dtt, 10_000e18, 0, 0, address(this), _deadline());

        vm.prank(alice);
        deflating.approve(address(router), type(uint256).max);

        address[] memory path = _path2(dtt, address(wkash));
        uint256 before = alice.balance;

        vm.prank(alice);
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(100e18, 0, path, alice, _deadline());

        assertGt(alice.balance, before, "fee-on-transfer swap must still deliver KASH");
    }

    /// @dev The non-supporting entry point must REJECT a fee-on-transfer token
    ///      rather than silently shortchange the user.
    function test_feeOnTransferRevertsOnStandardPath() public {
        address dtt = vm.deployCode("DeflatingERC20.sol:DeflatingERC20", abi.encode(uint256(1_000_000e18)));
        IToken deflating = IToken(dtt);

        deflating.transfer(alice, 100_000e18);
        deflating.approve(address(router), type(uint256).max);
        router.addLiquidityETH{value: 1_000e18}(dtt, 10_000e18, 0, 0, address(this), _deadline());

        vm.prank(alice);
        deflating.approve(address(router), type(uint256).max);

        address[] memory path = _path2(dtt, address(wkash));
        uint256[] memory quoted = router.getAmountsOut(100e18, path);

        vm.expectRevert(bytes("ArkSwap: K"));
        vm.prank(alice);
        router.swapExactTokensForETH(100e18, quoted[1], path, alice, _deadline());
    }

    function test_removeLiquidityETHSupportingFeeOnTransferTokens() public {
        address dtt = vm.deployCode("DeflatingERC20.sol:DeflatingERC20", abi.encode(uint256(1_000_000e18)));
        IToken deflating = IToken(dtt);
        deflating.approve(address(router), type(uint256).max);

        (,, uint256 liquidity) =
            router.addLiquidityETH{value: 1_000e18}(dtt, 10_000e18, 0, 0, address(this), _deadline());

        IArkSwapPair p = pair(dtt, address(wkash));
        p.approve(address(router), liquidity);

        uint256 before = address(this).balance;
        uint256 amountKash =
            router.removeLiquidityETHSupportingFeeOnTransferTokens(dtt, liquidity, 0, 0, address(this), _deadline());

        assertGt(amountKash, 0);
        assertEq(address(this).balance - before, amountKash);
    }

    // ---------------------------------------------------------------- helpers

    function _seedKashUsdc() internal returns (uint256 liquidity) {
        vm.prank(lp);
        (,, liquidity) = router.addLiquidityETH{value: KASH_LIQ}(address(usdc), USDC_LIQ, 0, 0, lp, _deadline());
    }

    function _seedKashUsdt() internal returns (uint256 liquidity) {
        vm.prank(lp);
        (,, liquidity) = router.addLiquidityETH{value: KASH_LIQ}(address(usdt), USDC_LIQ, 0, 0, lp, _deadline());
    }

    function _seedUsdcUsdt() internal returns (uint256 liquidity) {
        vm.prank(lp);
        (,, liquidity) = router.addLiquidity(address(usdc), address(usdt), 100_000e6, 100_000e6, 0, 0, lp, _deadline());
    }

    function _signPermit(IArkSwapPair p, uint256 key, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                p.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        p.PERMIT_TYPEHASH(), vm.addr(key), address(router), value, p.nonces(vm.addr(key)), deadline
                    )
                )
            )
        );
        return vm.sign(key, digest);
    }

    receive() external payable {}
}
