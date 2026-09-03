// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair, IFlashBorrower, IToken} from "../utils/Interfaces.sol";

interface IReentrantCallee {
    function attack(address pair, uint256 amount0Out, uint256 amount1Out, uint8 mode) external;
}

/// @notice ArkSwapPair unit tests (llm.txt s9, s18).
/// @dev Swap accounting, the 0.30% fee and MINIMUM_LIQUIDITY are inherited from
///      Uniswap V2 unchanged; these tests pin that behaviour so an unreviewed
///      change to the core math is caught (llm.txt s54).
contract PairTest is ArkSwapTest {
    IToken internal tokenA;
    IToken internal tokenB;
    IArkSwapPair internal p;

    address internal token0;
    address internal token1;

    function setUp() public {
        _deployStack();
        tokenA = _deployToken("Token A", "TKNA", 18, 0);
        tokenB = _deployToken("Token B", "TKNB", 18, 0);
        p = _createPair(address(tokenA), address(tokenB));
        token0 = p.token0();
        token1 = p.token1();
    }

    // ------------------------------------------------------------ initialize

    function test_initialize() public view {
        assertEq(p.factory(), address(factory));
        assertTrue(token0 < token1, "tokens not sorted");
        assertEq(p.MINIMUM_LIQUIDITY(), MINIMUM_LIQUIDITY);
        (uint112 r0, uint112 r1, uint32 ts) = p.getReserves();
        assertEq(r0, 0);
        assertEq(r1, 0);
        assertEq(ts, 0);
    }

    function test_cannotInitializeTwice() public {
        vm.expectRevert(bytes("ArkSwap: FORBIDDEN"));
        p.initialize(address(tokenA), address(tokenB));
    }

    // ------------------------------------------------------------------ mint

    function test_mintInitialLiquidity() public {
        uint256 amount0 = 1_000e18;
        uint256 amount1 = 4_000e18;
        uint256 expected = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;

        IToken(token0).mint(address(p), amount0);
        IToken(token1).mint(address(p), amount1);

        vm.expectEmit(true, false, false, true, address(p));
        emit IArkSwapPair.Mint(address(this), amount0, amount1);
        uint256 liquidity = p.mint(alice);

        assertEq(liquidity, expected);
        assertEq(p.balanceOf(alice), expected);
        assertEq(p.totalSupply(), expected + MINIMUM_LIQUIDITY);

        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(uint256(r0), amount0);
        assertEq(uint256(r1), amount1);
    }

    function test_minimumLiquidityLocked() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);

        // MINIMUM_LIQUIDITY is minted to address(0) and can never be redeemed.
        assertEq(p.balanceOf(address(0)), MINIMUM_LIQUIDITY);

        // Burning every user LP token still leaves the locked amount outstanding.
        // NB: read the balance BEFORE vm.prank -- a call would consume the prank.
        uint256 aliceLp = p.balanceOf(alice);
        vm.prank(alice);
        p.transfer(address(p), aliceLp);
        p.burn(alice);

        assertEq(p.totalSupply(), MINIMUM_LIQUIDITY);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertGt(uint256(r0), 0, "reserves fully drained");
        assertGt(uint256(r1), 0, "reserves fully drained");
    }

    function test_mintAdditionalLiquidity() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        uint256 supplyBefore = p.totalSupply();

        uint256 liquidity = _addLiquidityDirect(p, 500e18, 500e18, bob);

        assertEq(liquidity, supplyBefore / 2, "proportional mint");
        assertEq(p.balanceOf(bob), liquidity);
    }

    /// @dev Depositing an off-ratio amount mints against the WORSE side, so the
    ///      depositor donates the excess to the pool rather than extracting value.
    function test_mintUsesMinimumOfBothSides() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        uint256 supplyBefore = p.totalSupply();

        uint256 liquidity = _addLiquidityDirect(p, 500e18, 100e18, bob);

        assertEq(liquidity, (supplyBefore * 100e18) / 1_000e18, "must mint on the scarcer side");
    }

    function test_cannotMintZeroLiquidity() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        vm.expectRevert(bytes("ArkSwap: INSUFFICIENT_LIQUIDITY_MINTED"));
        p.mint(bob);
    }

    // ------------------------------------------------------------------ burn

    function test_burnLiquidity() public {
        uint256 amount0 = 1_000e18;
        uint256 amount1 = 4_000e18;
        uint256 liquidity = _addLiquidityDirect(p, amount0, amount1, alice);
        uint256 totalSupply = p.totalSupply();

        vm.prank(alice);
        p.transfer(address(p), liquidity);

        uint256 expected0 = (liquidity * amount0) / totalSupply;
        uint256 expected1 = (liquidity * amount1) / totalSupply;

        vm.expectEmit(true, true, false, true, address(p));
        emit IArkSwapPair.Burn(address(this), expected0, expected1, alice);
        (uint256 got0, uint256 got1) = p.burn(alice);

        assertEq(got0, expected0);
        assertEq(got1, expected1);
        assertEq(IToken(token0).balanceOf(alice), expected0);
        assertEq(IToken(token1).balanceOf(alice), expected1);
        assertEq(p.balanceOf(alice), 0);
    }

    function test_cannotBurnZero() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        vm.expectRevert(bytes("ArkSwap: INSUFFICIENT_LIQUIDITY_BURNED"));
        p.burn(alice);
    }

    // ------------------------------------------------------------------ swap

    function test_swapToken0ForToken1() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);

        uint256 amountIn = 10e18;
        uint256 expectedOut = _expectedAmountOut(amountIn, 1_000e18, 1_000e18);

        IToken(token0).mint(address(p), amountIn);

        vm.expectEmit(true, true, false, true, address(p));
        emit IArkSwapPair.Swap(address(this), amountIn, 0, 0, expectedOut, bob);
        p.swap(0, expectedOut, bob, "");

        assertEq(IToken(token1).balanceOf(bob), expectedOut);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(uint256(r0), 1_000e18 + amountIn);
        assertEq(uint256(r1), 1_000e18 - expectedOut);
    }

    function test_swapToken1ForToken0() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);

        uint256 amountIn = 10e18;
        uint256 expectedOut = _expectedAmountOut(amountIn, 1_000e18, 1_000e18);

        IToken(token1).mint(address(p), amountIn);
        p.swap(expectedOut, 0, bob, "");

        assertEq(IToken(token0).balanceOf(bob), expectedOut);
    }

    function test_cannotSwapMoreThanReserves() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        IToken(token0).mint(address(p), 10e18);

        vm.expectRevert(bytes("ArkSwap: INSUFFICIENT_LIQUIDITY"));
        p.swap(0, 1_000e18, bob, "");
    }

    function test_cannotSwapWithZeroOutput() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        vm.expectRevert(bytes("ArkSwap: INSUFFICIENT_OUTPUT_AMOUNT"));
        p.swap(0, 0, bob, "");
    }

    /// @dev No free output: asking for tokens without funding the pair reverts.
    function test_cannotSwapWithoutInput() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        vm.expectRevert(bytes("ArkSwap: INSUFFICIENT_INPUT_AMOUNT"));
        p.swap(0, 1e18, bob, "");
    }

    /// @dev Underpaying by one wei must trip the k check.
    function test_swapRevertsWhenUnderpayingByOneWei() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);

        uint256 amountIn = 10e18;
        uint256 out = _expectedAmountOut(amountIn, 1_000e18, 1_000e18);

        IToken(token0).mint(address(p), amountIn - 1);
        vm.expectRevert(bytes("ArkSwap: K"));
        p.swap(0, out, bob, "");
    }

    function test_cannotSwapToTokenAddress() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        IToken(token0).mint(address(p), 10e18);

        vm.expectRevert(bytes("ArkSwap: INVALID_TO"));
        p.swap(0, 1e18, token1, "");
    }

    function test_constantProductInvariant() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        (uint112 r0Before, uint112 r1Before,) = p.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);

        uint256 amountIn = 50e18;
        uint256 out = _expectedAmountOut(amountIn, r0Before, r1Before);
        IToken(token0).mint(address(p), amountIn);
        p.swap(0, out, bob, "");

        (uint112 r0After, uint112 r1After,) = p.getReserves();
        // k strictly grows because the 0.30% fee stays in the pool.
        assertGt(uint256(r0After) * uint256(r1After), kBefore, "k must not decrease");
    }

    // ------------------------------------------------------------ sync/skim

    function test_sync() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        IToken(token0).mint(address(p), 5e18); // donation

        p.sync();

        (uint112 r0,,) = p.getReserves();
        assertEq(uint256(r0), 1_005e18, "sync must adopt the donated balance");
    }

    function test_skim() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        IToken(token0).mint(address(p), 5e18); // donation

        p.skim(bob);

        assertEq(IToken(token0).balanceOf(bob), 5e18, "skim must return the excess");
        (uint112 r0,,) = p.getReserves();
        assertEq(uint256(r0), 1_000e18, "reserves unchanged by skim");
    }

    // ------------------------------------------------------- price cumulative

    function test_priceCumulativeUpdates() public {
        _addLiquidityDirect(p, 1_000e18, 2_000e18, alice);

        assertEq(p.price0CumulativeLast(), 0);
        assertEq(p.price1CumulativeLast(), 0);

        (uint112 r0, uint112 r1,) = p.getReserves();
        uint256 elapsed = 3600;
        vm.warp(block.timestamp + elapsed);
        p.sync();

        uint256 expected0 = ((uint256(r1) << 112) / uint256(r0)) * elapsed;
        uint256 expected1 = ((uint256(r0) << 112) / uint256(r1)) * elapsed;

        assertEq(p.price0CumulativeLast(), expected0, "price0 TWAP accumulator");
        assertEq(p.price1CumulativeLast(), expected1, "price1 TWAP accumulator");
    }

    function test_priceCumulativeDoesNotAdvanceWithinSameBlock() public {
        _addLiquidityDirect(p, 1_000e18, 2_000e18, alice);
        vm.warp(block.timestamp + 100);
        p.sync();
        uint256 snapshot = p.price0CumulativeLast();

        p.sync(); // same block, timeElapsed == 0
        assertEq(p.price0CumulativeLast(), snapshot);
    }

    // ------------------------------------------------------------ reentrancy

    function test_reentrancyLockBlocksSwap() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        address attacker = vm.deployCode("ReentrantCallee.sol:ReentrantCallee");

        vm.expectRevert(bytes("ArkSwap: LOCKED"));
        IReentrantCallee(attacker).attack(address(p), 0, 1e18, 0);
    }

    function test_reentrancyLockBlocksSync() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        address attacker = vm.deployCode("ReentrantCallee.sol:ReentrantCallee");

        vm.expectRevert(bytes("ArkSwap: LOCKED"));
        IReentrantCallee(attacker).attack(address(p), 0, 1e18, 1);
    }

    function test_reentrancyLockBlocksSkim() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        address attacker = vm.deployCode("ReentrantCallee.sol:ReentrantCallee");

        vm.expectRevert(bytes("ArkSwap: LOCKED"));
        IReentrantCallee(attacker).attack(address(p), 0, 1e18, 2);
    }

    // ------------------------------------------------------------ flash swap

    function test_flashSwapRepaidWithFeeSucceeds() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        IFlashBorrower borrower = _deployFlashBorrower();
        IToken(token1).mint(address(borrower), 10e18); // to cover the fee

        borrower.flash(address(p), 0, 5e18, 10_000);

        assertTrue(borrower.called(), "callback not invoked");
        assertEq(borrower.lastSender(), address(borrower));
    }

    function test_flashSwapUnderRepaidReverts() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        IFlashBorrower borrower = _deployFlashBorrower();
        IToken(token1).mint(address(borrower), 10e18);

        // repay only 99% of what the fee-adjusted invariant requires
        vm.expectRevert(bytes("ArkSwap: K"));
        borrower.flash(address(p), 0, 5e18, 9_900);
    }

    // ----------------------------------------------------------- protocol fee

    function test_noProtocolFeeMintedWhenFeeToIsZero() public {
        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        uint256 supplyBefore = p.totalSupply();

        uint256 amountIn = 100e18;
        uint256 out = _expectedAmountOut(amountIn, 1_000e18, 1_000e18);
        IToken(token0).mint(address(p), amountIn);
        p.swap(0, out, bob, "");

        _addLiquidityDirect(p, 10e18, 10e18, alice); // triggers _mintFee
        assertEq(p.balanceOf(treasury), 0, "no protocol fee expected");
        assertEq(p.kLast(), 0, "kLast must stay 0 while feeTo is unset");
        assertGt(p.totalSupply(), supplyBefore);
    }

    function test_protocolFeeMintedWhenFeeToIsSet() public {
        vm.prank(feeToSetter);
        factory.setFeeTo(treasury);

        _addLiquidityDirect(p, 1_000e18, 1_000e18, alice);
        assertGt(p.kLast(), 0, "kLast must track once feeOn");

        uint256 amountIn = 100e18;
        uint256 out = _expectedAmountOut(amountIn, 1_000e18, 1_000e18);
        IToken(token0).mint(address(p), amountIn);
        p.swap(0, out, bob, "");

        _addLiquidityDirect(p, 10e18, 10e18, alice); // triggers _mintFee
        assertGt(p.balanceOf(treasury), 0, "protocol fee should have been minted");
    }
}

library Math {
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
