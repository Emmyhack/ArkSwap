// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair, IToken} from "../utils/Interfaces.sol";

/// @notice ArkSwapLibrary unit tests (llm.txt s11).
/// @dev Every case runs against the real =0.6.6 library through
///      ArkSwapLibraryHarness, and checks results against an independently
///      written reference formula in ArkSwapTest rather than the library itself.
contract LibraryTest is ArkSwapTest {
    IToken internal tokenA;
    IToken internal tokenB;

    function setUp() public {
        _deployStack();
        tokenA = _deployToken("Token A", "TKNA", 18, 0);
        tokenB = _deployToken("Token B", "TKNB", 18, 0);
    }

    // ------------------------------------------------------------ sortTokens

    function test_sortTokens() public view {
        (address t0, address t1) = lib.sortTokens(address(tokenA), address(tokenB));
        assertTrue(t0 < t1);

        (address s0, address s1) = lib.sortTokens(address(tokenB), address(tokenA));
        assertEq(s0, t0, "sort must be order independent");
        assertEq(s1, t1);
    }

    function test_sortTokensRejectsIdentical() public {
        vm.expectRevert(bytes("ArkSwapLibrary: IDENTICAL_ADDRESSES"));
        lib.sortTokens(address(tokenA), address(tokenA));
    }

    function test_sortTokensRejectsZero() public {
        vm.expectRevert(bytes("ArkSwapLibrary: ZERO_ADDRESS"));
        lib.sortTokens(address(0), address(tokenA));
    }

    function testFuzz_sortTokensIsOrderIndependent(address a, address b) public view {
        vm.assume(a != b && a != address(0) && b != address(0));
        (address x0, address x1) = lib.sortTokens(a, b);
        (address y0, address y1) = lib.sortTokens(b, a);
        assertEq(x0, y0);
        assertEq(x1, y1);
        assertTrue(x0 < x1);
    }

    // ----------------------------------------------------------- getReserves

    function test_getReservesRespectsArgumentOrientation() public {
        IArkSwapPair p = _createPair(address(tokenA), address(tokenB));
        // Deliberately asymmetric so an orientation bug cannot hide.
        uint256 amountA = 1_000e18;
        uint256 amountB = 7_000e18;
        tokenA.mint(address(p), amountA);
        tokenB.mint(address(p), amountB);
        p.mint(alice);

        (uint256 rA, uint256 rB) = lib.getReserves(address(factory), address(tokenA), address(tokenB));
        assertEq(rA, amountA, "reserveA must correspond to tokenA");
        assertEq(rB, amountB, "reserveB must correspond to tokenB");

        (uint256 rB2, uint256 rA2) = lib.getReserves(address(factory), address(tokenB), address(tokenA));
        assertEq(rA2, amountA);
        assertEq(rB2, amountB);
    }

    // ----------------------------------------------------------------- quote

    function test_quote() public view {
        assertEq(lib.quote(1e18, 100e18, 200e18), 2e18);
        assertEq(lib.quote(2e18, 200e18, 100e18), 1e18);
    }

    function test_quoteRejectsZeroAmount() public {
        vm.expectRevert(bytes("ArkSwapLibrary: INSUFFICIENT_AMOUNT"));
        lib.quote(0, 100e18, 200e18);
    }

    function test_quoteRejectsZeroLiquidity() public {
        vm.expectRevert(bytes("ArkSwapLibrary: INSUFFICIENT_LIQUIDITY"));
        lib.quote(1e18, 0, 200e18);

        vm.expectRevert(bytes("ArkSwapLibrary: INSUFFICIENT_LIQUIDITY"));
        lib.quote(1e18, 100e18, 0);
    }

    function testFuzz_quoteMatchesReference(uint256 amountA, uint256 reserveA, uint256 reserveB) public view {
        amountA = bound(amountA, 1, 1e30);
        reserveA = bound(reserveA, 1, type(uint112).max);
        reserveB = bound(reserveB, 1, type(uint112).max);
        unchecked {
            if (amountA != 0 && (amountA * reserveB) / amountA != reserveB) return; // skip overflow
        }
        assertEq(lib.quote(amountA, reserveA, reserveB), (amountA * reserveB) / reserveA);
    }

    // ---------------------------------------------------------- getAmountOut

    function test_getAmountOut() public view {
        // The canonical Uniswap V2 example: 1 in, 5/10 reserves -> 0.30% fee applied.
        assertEq(lib.getAmountOut(1e18, 5e18, 10e18), _expectedAmountOut(1e18, 5e18, 10e18));
        assertEq(lib.getAmountOut(1e18, 5e18, 10e18), 1662497915624478906);
    }

    function test_getAmountOutRejectsZeroInput() public {
        vm.expectRevert(bytes("ArkSwapLibrary: INSUFFICIENT_INPUT_AMOUNT"));
        lib.getAmountOut(0, 5e18, 10e18);
    }

    function test_getAmountOutRejectsZeroLiquidity() public {
        vm.expectRevert(bytes("ArkSwapLibrary: INSUFFICIENT_LIQUIDITY"));
        lib.getAmountOut(1e18, 0, 10e18);
    }

    /// @dev Pins the 0.30% fee by recovering the fee numerator algebraically from
    ///      the library's own output, independently of how it is implemented.
    ///
    ///      out = (F*A*Rout) / (1000*Rin + F*A), with Rin == Rout == R, gives
    ///      F = 1000*R*out / (A*(R - out)). Recovering F == 997 pins the fee at
    ///      0.30%. A change here is a protocol-level change that must be reviewed
    ///      and propagated to pair math, quoting, the frontend and docs
    ///      (llm.txt s9, s54).
    function test_feeIsThirtyBasisPoints() public view {
        uint256 r = 1_000_000e18;
        uint256 amountIn = 1e18;

        uint256 out = lib.getAmountOut(amountIn, r, r);

        uint256 numerator = 1000 * r * out;
        uint256 denominator = amountIn * (r - out);
        uint256 feeNumerator = (numerator + denominator / 2) / denominator; // round to nearest

        assertEq(feeNumerator, 997, "ArkSwap V1 amount-in-with-fee must be 997/1000");
        assertEq(10_000 - feeNumerator * 10, 30, "ArkSwap V1 trade fee must be 0.30%");
    }

    // ----------------------------------------------------------- getAmountIn

    function test_getAmountIn() public view {
        assertEq(lib.getAmountIn(1e18, 5e18, 10e18), _expectedAmountIn(1e18, 5e18, 10e18));
    }

    function test_getAmountInRejectsZeroOutput() public {
        vm.expectRevert(bytes("ArkSwapLibrary: INSUFFICIENT_OUTPUT_AMOUNT"));
        lib.getAmountIn(0, 5e18, 10e18);
    }

    /// @dev getAmountIn rounds UP so the pool is never shortchanged: feeding the
    ///      result back through getAmountOut must yield at least the target.
    function testFuzz_getAmountInRoundsInFavourOfThePool(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public
        view
    {
        reserveIn = bound(reserveIn, 1e6, 1e30);
        reserveOut = bound(reserveOut, 1e6, 1e30);
        amountOut = bound(amountOut, 1, reserveOut - 1);

        uint256 amountIn = lib.getAmountIn(amountOut, reserveIn, reserveOut);
        vm.assume(amountIn < 1e40); // keep the round-trip inside sane bounds

        uint256 roundTrip = lib.getAmountOut(amountIn, reserveIn, reserveOut);
        assertGe(roundTrip, amountOut, "getAmountIn must never undercharge");
    }

    // ------------------------------------------------------- getAmounts{Out,In}

    function test_getAmountsOutMultiHop() public {
        _seedThreePools();

        address[] memory path = _path3(address(tokenA), address(wkash), address(tokenB));
        uint256[] memory amounts = lib.getAmountsOut(address(factory), 1e18, path);

        assertEq(amounts.length, 3);
        assertEq(amounts[0], 1e18);

        (uint256 rIn0, uint256 rOut0) = lib.getReserves(address(factory), address(tokenA), address(wkash));
        assertEq(amounts[1], _expectedAmountOut(1e18, rIn0, rOut0));

        (uint256 rIn1, uint256 rOut1) = lib.getReserves(address(factory), address(wkash), address(tokenB));
        assertEq(amounts[2], _expectedAmountOut(amounts[1], rIn1, rOut1));
    }

    function test_getAmountsInMultiHop() public {
        _seedThreePools();

        address[] memory path = _path3(address(tokenA), address(wkash), address(tokenB));
        uint256[] memory amounts = lib.getAmountsIn(address(factory), 1e18, path);

        assertEq(amounts.length, 3);
        assertEq(amounts[2], 1e18);

        // Round-tripping the required input must deliver at least the target output.
        uint256[] memory out = lib.getAmountsOut(address(factory), amounts[0], path);
        assertGe(out[2], 1e18);
    }

    function test_getAmountsOutRejectsShortPath() public {
        address[] memory path = new address[](1);
        path[0] = address(tokenA);

        vm.expectRevert(bytes("ArkSwapLibrary: INVALID_PATH"));
        lib.getAmountsOut(address(factory), 1e18, path);
    }

    function test_getAmountsInRejectsShortPath() public {
        address[] memory path = new address[](1);
        path[0] = address(tokenA);

        vm.expectRevert(bytes("ArkSwapLibrary: INVALID_PATH"));
        lib.getAmountsIn(address(factory), 1e18, path);
    }

    function _seedThreePools() internal {
        IArkSwapPair pAW = _createPair(address(tokenA), address(wkash));
        IArkSwapPair pWB = _createPair(address(wkash), address(tokenB));

        vm.deal(address(this), 1_000e18);
        wkash.deposit{value: 400e18}();

        tokenA.mint(address(pAW), 100e18);
        wkash.transfer(address(pAW), 200e18);
        pAW.mint(alice);

        wkash.transfer(address(pWB), 200e18);
        tokenB.mint(address(pWB), 300e18);
        pWB.mint(alice);
    }
}
