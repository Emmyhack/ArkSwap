// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair, IToken} from "../utils/Interfaces.sol";

/// @notice Fuzz coverage for swap and liquidity math (llm.txt s21).
/// @dev Bounds respect the uint112 reserve ceiling that ArkSwapPair enforces.
contract SwapFuzzTest is ArkSwapTest {
    IToken internal tokenA;
    IToken internal tokenB;
    IArkSwapPair internal p;
    address internal token0;
    address internal token1;

    uint256 internal constant MAX_RESERVE = uint256(type(uint112).max) / 2;

    function setUp() public {
        _deployStack();
        tokenA = _deployToken("Token A", "TKNA", 18, 0);
        tokenB = _deployToken("Token B", "TKNB", 18, 0);
        p = _createPair(address(tokenA), address(tokenB));
        token0 = p.token0();
        token1 = p.token1();
    }

    // ------------------------------------------------------------------ swaps

    /// @dev THE core safety property: a swap may never reduce the fee-adjusted
    ///      constant product (llm.txt s21).
    function testFuzz_swapNeverDecreasesAdjustedK(uint256 reserve0, uint256 reserve1, uint256 amountIn) public {
        reserve0 = bound(reserve0, 1e12, MAX_RESERVE / 2);
        reserve1 = bound(reserve1, 1e12, MAX_RESERVE / 2);
        _addLiquidityDirect(p, reserve0, reserve1, alice);

        // Keep reserve0 + amountIn inside the uint112 ceiling the pair enforces.
        amountIn = bound(amountIn, 1, MAX_RESERVE / 2);

        uint256 amountOut = _expectedAmountOut(amountIn, reserve0, reserve1);
        vm.assume(amountOut > 0 && amountOut < reserve1);

        uint256 kBefore = reserve0 * reserve1;

        IToken(token0).mint(address(p), amountIn);
        p.swap(0, amountOut, bob, "");

        (uint112 r0, uint112 r1,) = p.getReserves();
        assertGe(uint256(r0) * uint256(r1), kBefore, "adjusted constant product decreased");
    }

    /// @dev No free output: requesting one wei more than the formula allows must revert.
    function testFuzz_cannotExtractMoreThanFormulaAllows(uint256 reserve0, uint256 reserve1, uint256 amountIn) public {
        reserve0 = bound(reserve0, 1e15, MAX_RESERVE / 2);
        reserve1 = bound(reserve1, 1e15, MAX_RESERVE / 2);
        _addLiquidityDirect(p, reserve0, reserve1, alice);

        amountIn = bound(amountIn, 1e6, MAX_RESERVE / 2);
        uint256 amountOut = _expectedAmountOut(amountIn, reserve0, reserve1);
        vm.assume(amountOut > 0 && amountOut + 1 < reserve1);

        IToken(token0).mint(address(p), amountIn);
        vm.expectRevert(bytes("ArkSwap: K"));
        p.swap(0, amountOut + 1, bob, "");
    }

    function testFuzz_swapOutputMatchesLibraryQuote(uint256 reserve0, uint256 reserve1, uint256 amountIn) public {
        reserve0 = bound(reserve0, 1e12, MAX_RESERVE / 2);
        reserve1 = bound(reserve1, 1e12, MAX_RESERVE / 2);
        _addLiquidityDirect(p, reserve0, reserve1, alice);

        amountIn = bound(amountIn, 1, MAX_RESERVE / 2);

        (uint256 rIn, uint256 rOut) = lib.getReserves(address(factory), token0, token1);
        uint256 quoted = lib.getAmountOut(amountIn, rIn, rOut);
        assertEq(quoted, _expectedAmountOut(amountIn, reserve0, reserve1), "library disagrees with reference");
    }

    /// @dev Reserves are packed into uint112; exceeding that must revert, not wrap.
    function testFuzz_reserveOverflowReverts(uint256 excess) public {
        uint256 nearMax = uint256(type(uint112).max) - 1e18;
        _addLiquidityDirect(p, nearMax, 1e18, alice);

        excess = bound(excess, 1e18 + 1, 1e30);
        IToken(token0).mint(address(p), excess);

        vm.expectRevert(bytes("ArkSwap: OVERFLOW"));
        p.sync();
    }

    // -------------------------------------------------------------- liquidity

    /// @dev An LP can never redeem more than they deposited via mint/burn alone
    ///      (no swaps in between, so no fees accrue to them).
    function testFuzz_mintBurnRoundTripDoesNotCreateValue(uint256 amount0, uint256 amount1) public {
        amount0 = bound(amount0, 1e6, MAX_RESERVE / 2);
        amount1 = bound(amount1, 1e6, MAX_RESERVE / 2);
        vm.assume(amount0 * amount1 > MINIMUM_LIQUIDITY * MINIMUM_LIQUIDITY);

        // Seed the pool first so `alice` is not the one locking MINIMUM_LIQUIDITY.
        _addLiquidityDirect(p, 1e12, 1e12, address(this));

        uint256 liquidity = _addLiquidityDirect(p, amount0, amount1, alice);
        vm.assume(liquidity > 0);

        vm.prank(alice);
        p.transfer(address(p), liquidity);
        (uint256 out0, uint256 out1) = p.burn(alice);

        assertLe(out0, amount0, "burn returned more token0 than was deposited");
        assertLe(out1, amount1, "burn returned more token1 than was deposited");
    }

    /// @dev Over-issuing LP tokens would dilute existing providers. Floor division
    ///      in the mint path must always round against the depositor, never for them.
    function testFuzz_lpMintNeverExceedsProportionalShare(uint256 seed0, uint256 seed1, uint256 add0) public {
        seed0 = bound(seed0, 1e12, MAX_RESERVE / 4);
        seed1 = bound(seed1, 1e12, MAX_RESERVE / 4);
        _addLiquidityDirect(p, seed0, seed1, alice);

        uint256 supplyBefore = p.totalSupply();

        // Floor at seed0/1e6 so the deposit is always large enough to mint a
        // non-zero share, which the pair would otherwise reject outright.
        add0 = bound(add0, seed0 / 1_000_000 + 1, MAX_RESERVE / 4);
        uint256 add1 = (add0 * seed1) / seed0; // deposit on-ratio
        vm.assume(add1 > 0 && add1 <= MAX_RESERVE / 4);

        uint256 liquidity = _addLiquidityDirect(p, add0, add1, bob);

        assertGt(liquidity, 0);
        assertLe(liquidity, (add0 * supplyBefore) / seed0, "LP mint over-issued relative to the deposited share");
    }

    // -------------------------------------------------------------- quoting

    function testFuzz_getAmountOutIsMonotonic(uint256 reserveIn, uint256 reserveOut, uint256 a, uint256 b) public view {
        reserveIn = bound(reserveIn, 1e12, MAX_RESERVE);
        reserveOut = bound(reserveOut, 1e12, MAX_RESERVE);
        a = bound(a, 1, 1e30);
        b = bound(b, 1, 1e30);
        vm.assume(a < b);

        assertLe(
            lib.getAmountOut(a, reserveIn, reserveOut),
            lib.getAmountOut(b, reserveIn, reserveOut),
            "larger input must never yield less output"
        );
    }

    /// @dev Output is strictly bounded by the opposing reserve.
    function testFuzz_getAmountOutNeverDrainsPool(uint256 reserveIn, uint256 reserveOut, uint256 amountIn) public view {
        reserveIn = bound(reserveIn, 1e12, MAX_RESERVE);
        reserveOut = bound(reserveOut, 1e12, MAX_RESERVE);
        amountIn = bound(amountIn, 1, type(uint128).max);

        assertLt(lib.getAmountOut(amountIn, reserveIn, reserveOut), reserveOut, "output must stay below reserves");
    }

    function testFuzz_priceImpactGrowsWithSize(uint256 reserve, uint256 tradeA, uint256 tradeB) public view {
        reserve = bound(reserve, 1e18, MAX_RESERVE);

        // Draw the two sizes from disjoint magnitude bands. They must differ by
        // enough that the real price impact dominates floor-division rounding:
        // at trade sizes near 1 wei the rounding error (~1/out) is far larger
        // than the true rate difference (~(larger-smaller)/reserve), and the
        // comparison would be measuring rounding rather than price impact.
        uint256 smaller = bound(tradeA, reserve / 1_000_000, reserve / 10_000);
        uint256 larger = bound(tradeB, reserve / 100, reserve / 10);

        uint256 outSmaller = lib.getAmountOut(smaller, reserve, reserve);
        uint256 outLarger = lib.getAmountOut(larger, reserve, reserve);

        // Marginal execution price must worsen as size grows: out/in decreases.
        assertGe(
            (outSmaller * 1e18) / smaller, (outLarger * 1e18) / larger, "execution price must worsen with trade size"
        );
    }
}
