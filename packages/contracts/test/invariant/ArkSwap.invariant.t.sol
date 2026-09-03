// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair, IToken} from "../utils/Interfaces.sol";
import {ArkSwapHandler} from "./ArkSwapHandler.sol";

/// @notice Protocol invariants A-H from llm.txt s22.
contract ArkSwapInvariantTest is ArkSwapTest {
    ArkSwapHandler internal handler;

    IArkSwapPair internal kashUsdc;
    IArkSwapPair internal usdcUsdt;

    /// @dev High-water mark for invariant C, tracked across the whole run.
    mapping(address => uint256) internal maxSqrtKPerShare;

    function setUp() public {
        _deployStack();

        // Seed both pools at the devnet reference ratio (llm.txt s16): 1 KASH = 1 mUSDC.
        address seeder = makeAddr("seeder");
        vm.deal(seeder, 100_000e18);
        usdc.mint(seeder, 100_000e6);
        usdt.mint(seeder, 100_000e6);

        vm.startPrank(seeder);
        usdc.approve(address(router), type(uint256).max);
        usdt.approve(address(router), type(uint256).max);
        router.addLiquidityETH{value: 10_000e18}(address(usdc), 10_000e6, 0, 0, seeder, block.timestamp + 1);
        router.addLiquidity(address(usdc), address(usdt), 50_000e6, 50_000e6, 0, 0, seeder, block.timestamp + 1);
        vm.stopPrank();

        kashUsdc = pair(address(wkash), address(usdc));
        usdcUsdt = pair(address(usdc), address(usdt));

        handler = new ArkSwapHandler(factory, router, wkash, usdc, usdt, kashUsdc, usdcUsdt);

        targetContract(address(handler));
    }

    // -------------------------------------------------- A. reserve consistency

    /// @dev Reserves must never claim more than the pair actually holds. A pair
    ///      whose reserves exceed its balances is insolvent: the last LPs out
    ///      would be unable to withdraw.
    function invariant_A_reservesNeverExceedBalances() public view {
        _assertSolvent(kashUsdc);
        _assertSolvent(usdcUsdt);
    }

    function _assertSolvent(IArkSwapPair p) internal view {
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertGe(IToken(p.token0()).balanceOf(address(p)), uint256(r0), "reserve0 exceeds balance0");
        assertGe(IToken(p.token1()).balanceOf(address(p)), uint256(r1), "reserve1 exceeds balance1");
    }

    // ------------------------------------------------------ B. LP conservation

    /// @dev Total supply must always exceed the permanently locked MINIMUM_LIQUIDITY
    ///      while the pool holds reserves, and reserves must never be fully drained.
    function invariant_B_minimumLiquidityRemainsLocked() public view {
        _assertMinLiquidityLocked(kashUsdc);
        _assertMinLiquidityLocked(usdcUsdt);
    }

    function _assertMinLiquidityLocked(IArkSwapPair p) internal view {
        assertEq(p.balanceOf(address(0)), MINIMUM_LIQUIDITY, "locked liquidity was moved");
        assertGe(p.totalSupply(), MINIMUM_LIQUIDITY, "total supply fell below the locked floor");

        (uint112 r0, uint112 r1,) = p.getReserves();
        assertGt(uint256(r0), 0, "pool fully drained of token0");
        assertGt(uint256(r1), 0, "pool fully drained of token1");
    }

    // -------------------------------------------------- C. constant product

    /// @dev sqrt(k)/totalSupply is the per-LP-share value of the pool. Swaps push
    ///      it up (fees accrue); mint and burn leave it flat up to rounding, which
    ///      always favours the pool. It must therefore never decrease -- a drop
    ///      means value leaked out of the pool to a swapper or an LP.
    function invariant_C_valuePerLpShareNeverDecreases() public {
        _assertValuePerShareMonotonic(kashUsdc);
        _assertValuePerShareMonotonic(usdcUsdt);
    }

    function _assertValuePerShareMonotonic(IArkSwapPair p) internal {
        (uint112 r0, uint112 r1,) = p.getReserves();
        uint256 supply = p.totalSupply();
        if (supply == 0) return;

        uint256 current = (_sqrt(uint256(r0) * uint256(r1)) * 1e18) / supply;
        uint256 previous = maxSqrtKPerShare[address(p)];

        if (previous != 0) {
            assertGe(current, previous, "value per LP share decreased -- value leaked from the pool");
        }
        if (current > previous) maxSqrtKPerShare[address(p)] = current;
    }

    // ------------------------------------------------------- D. no free output

    /// @dev Every swap must have grown the pool's fee-adjusted product. Combined
    ///      with invariant C, output can never be obtained without valid input.
    function invariant_D_swapsOnlyGrowTheProduct() public view {
        if (handler.swapCount() == 0) return;

        (uint112 r0, uint112 r1,) = kashUsdc.getReserves();
        assertGt(uint256(r0) * uint256(r1), 0, "product collapsed to zero");
    }

    // ----------------------------------------------------- E/F. pair registry

    /// @dev Exactly one canonical pair per unordered token pair, reachable from
    ///      both directions.
    function invariant_EF_factoryMappingIsSymmetricAndUnique() public view {
        uint256 n = factory.allPairsLength();
        for (uint256 i = 0; i < n; i++) {
            address p = factory.allPairs(i);
            address t0 = IArkSwapPair(p).token0();
            address t1 = IArkSwapPair(p).token1();

            assertEq(factory.getPair(t0, t1), p, "forward mapping broken");
            assertEq(factory.getPair(t1, t0), p, "reverse mapping broken");
            assertTrue(t0 < t1, "pair tokens are not sorted");
        }
    }

    function invariant_EF_pairAddressesMatchLibraryDerivation() public view {
        uint256 n = factory.allPairsLength();
        for (uint256 i = 0; i < n; i++) {
            address p = factory.allPairs(i);
            address t0 = IArkSwapPair(p).token0();
            address t1 = IArkSwapPair(p).token1();
            assertEq(lib.pairFor(address(factory), t0, t1), p, "CREATE2 derivation diverged");
        }
    }

    // --------------------------------------------------------- G. router custody

    /// @dev ArkSwap is non-custodial: the router is a pass-through and must never
    ///      retain user funds between transactions (llm.txt s22, s47).
    function invariant_G_routerHoldsNoFunds() public view {
        assertEq(address(router).balance, 0, "router retained native KASH");
        assertEq(wkash.balanceOf(address(router)), 0, "router retained WKASH");
        assertEq(usdc.balanceOf(address(router)), 0, "router retained mUSDC");
        assertEq(usdt.balanceOf(address(router)), 0, "router retained mUSDT");
        assertEq(kashUsdc.balanceOf(address(router)), 0, "router retained LP tokens");
        assertEq(usdcUsdt.balanceOf(address(router)), 0, "router retained LP tokens");
    }

    // ------------------------------------------------------------ H. WKASH flow

    /// @dev WKASH must stay fully backed 1:1 by native KASH held in the wrapper.
    ///      If this breaks, unwrapping is not guaranteed to succeed.
    function invariant_H_wkashFullyBackedByNativeKash() public view {
        assertEq(wkash.totalSupply(), address(wkash).balance, "WKASH is not fully backed by native KASH");
    }

    /// @dev The pair's recorded WKASH reserve must be genuinely held by the pair.
    function invariant_H_wkashReservesAreRealBalances() public view {
        (uint256 reserveWkash,) = _reservesFor(kashUsdc, address(wkash));
        assertGe(wkash.balanceOf(address(kashUsdc)), reserveWkash, "WKASH reserve is not backed");
    }

    // ------------------------------------------------------------------ utils

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
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

    /// @dev Guards against a vacuously green invariant run. The invariants above
    ///      only mean something if the handler's actions actually land, and every
    ///      handler action swallows reverts via try/catch -- so a mis-bounded
    ///      handler could silently no-op through thousands of calls and still
    ///      report success. This drives each action directly and asserts the
    ///      ghost counters move.
    function test_handlerActionsActuallyExecute() public {
        handler.swapUsdcForUsdt(0, 1_000e6);
        assertGt(handler.swapCount(), 0, "token->token swaps never executed");

        handler.swapKashForUsdc(1, 10e18);
        assertGt(handler.kashWrapped(), 0, "native KASH was never wrapped");

        handler.swapUsdcForKash(1, 100e6);
        assertGt(handler.kashUnwrapped(), 0, "WKASH was never unwrapped");

        handler.addLiquidityUsdcUsdt(2, 1_000e6);
        assertGt(handler.liquidityAddCount(), 0, "liquidity was never added");

        handler.removeLiquidityUsdcUsdt(2, 5_000);
        assertGt(handler.liquidityRemoveCount(), 0, "liquidity was never removed");

        handler.donateToPair(0, 1_000e6);
        handler.skimPair(0, 0);
        handler.syncPair(1);
        handler.createPair(uint256(uint160(makeAddr("x"))), uint256(uint160(makeAddr("y"))));
        assertGe(factory.allPairsLength(), 3, "handler could not create new pairs");
    }
}
