// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IArkSwapFactory, IArkSwapPair, IArkSwapRouter02, IToken, IWKASH} from "../utils/Interfaces.sol";

/// @notice Action driver for the ArkSwap invariant suite (llm.txt s22).
/// @dev Every action routes through ArkSwapRouter02 or the pair's own low-level
///      entry points, so the invariants observe the same call paths a real user
///      or an adversary would take -- including donations, skim and sync, which
///      are the classic ways to desynchronise reserves from balances.
contract ArkSwapHandler is Test {
    IArkSwapFactory public factory;
    IArkSwapRouter02 public router;
    IWKASH public wkash;
    IToken public usdc;
    IToken public usdt;

    IArkSwapPair public kashUsdc;
    IArkSwapPair public usdcUsdt;

    address[3] public actors;

    // ------------------------------------------------------------- ghost state
    uint256 public kashWrapped;
    uint256 public kashUnwrapped;
    uint256 public swapCount;
    uint256 public liquidityAddCount;
    uint256 public liquidityRemoveCount;

    constructor(
        IArkSwapFactory _factory,
        IArkSwapRouter02 _router,
        IWKASH _wkash,
        IToken _usdc,
        IToken _usdt,
        IArkSwapPair _kashUsdc,
        IArkSwapPair _usdcUsdt
    ) {
        factory = _factory;
        router = _router;
        wkash = _wkash;
        usdc = _usdc;
        usdt = _usdt;
        kashUsdc = _kashUsdc;
        usdcUsdt = _usdcUsdt;

        actors[0] = makeAddr("inv_actor_0");
        actors[1] = makeAddr("inv_actor_1");
        actors[2] = makeAddr("inv_actor_2");

        for (uint256 i = 0; i < actors.length; i++) {
            address a = actors[i];
            vm.deal(a, 1_000_000e18);
            usdc.mint(a, 1_000_000e6);
            usdt.mint(a, 1_000_000e6);

            vm.startPrank(a);
            usdc.approve(address(router), type(uint256).max);
            usdt.approve(address(router), type(uint256).max);
            kashUsdc.approve(address(router), type(uint256).max);
            usdcUsdt.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1;
    }

    // ------------------------------------------------------------------ swaps

    function swapUsdcForUsdt(uint256 actorSeed, uint256 amountIn) public {
        address actor = _actor(actorSeed);
        amountIn = bound(amountIn, 1e3, usdc.balanceOf(actor) / 4 + 1e3);
        if (usdc.balanceOf(actor) < amountIn) return;

        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt);

        vm.prank(actor);
        try router.swapExactTokensForTokens(amountIn, 0, path, actor, _deadline()) {
            swapCount++;
        } catch {}
    }

    function swapUsdtForUsdc(uint256 actorSeed, uint256 amountIn) public {
        address actor = _actor(actorSeed);
        amountIn = bound(amountIn, 1e3, usdt.balanceOf(actor) / 4 + 1e3);
        if (usdt.balanceOf(actor) < amountIn) return;

        address[] memory path = new address[](2);
        path[0] = address(usdt);
        path[1] = address(usdc);

        vm.prank(actor);
        try router.swapExactTokensForTokens(amountIn, 0, path, actor, _deadline()) {
            swapCount++;
        } catch {}
    }

    /// @dev Native KASH in: exercises the WKASH deposit path.
    function swapKashForUsdc(uint256 actorSeed, uint256 amountIn) public {
        address actor = _actor(actorSeed);
        amountIn = bound(amountIn, 1e12, 1_000e18);
        if (actor.balance < amountIn) return;

        address[] memory path = new address[](2);
        path[0] = address(wkash);
        path[1] = address(usdc);

        vm.prank(actor);
        try router.swapExactETHForTokens{value: amountIn}(0, path, actor, _deadline()) {
            swapCount++;
            kashWrapped += amountIn;
        } catch {}
    }

    /// @dev Native KASH out: exercises the WKASH withdraw path.
    function swapUsdcForKash(uint256 actorSeed, uint256 amountIn) public {
        address actor = _actor(actorSeed);
        amountIn = bound(amountIn, 1e3, usdc.balanceOf(actor) / 4 + 1e3);
        if (usdc.balanceOf(actor) < amountIn) return;

        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(wkash);

        uint256 before = actor.balance;
        vm.prank(actor);
        try router.swapExactTokensForETH(amountIn, 0, path, actor, _deadline()) {
            swapCount++;
            kashUnwrapped += actor.balance - before;
        } catch {}
    }

    // -------------------------------------------------------------- liquidity

    function addLiquidityUsdcUsdt(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1e4, 100_000e6);
        if (usdc.balanceOf(actor) < amount || usdt.balanceOf(actor) < amount) return;

        vm.prank(actor);
        try router.addLiquidity(address(usdc), address(usdt), amount, amount, 0, 0, actor, _deadline()) {
            liquidityAddCount++;
        } catch {}
    }

    function addLiquidityKashUsdc(uint256 actorSeed, uint256 amountToken, uint256 amountKash) public {
        address actor = _actor(actorSeed);
        amountToken = bound(amountToken, 1e4, 100_000e6);
        amountKash = bound(amountKash, 1e15, 10_000e18);
        if (usdc.balanceOf(actor) < amountToken || actor.balance < amountKash) return;

        uint256 before = actor.balance;
        vm.prank(actor);
        try router.addLiquidityETH{value: amountKash}(address(usdc), amountToken, 0, 0, actor, _deadline()) {
            liquidityAddCount++;
            kashWrapped += before - actor.balance;
        } catch {}
    }

    function removeLiquidityUsdcUsdt(uint256 actorSeed, uint256 bps) public {
        address actor = _actor(actorSeed);
        bps = bound(bps, 1, 10_000);
        uint256 balance = usdcUsdt.balanceOf(actor);
        if (balance == 0) return;
        uint256 liquidity = (balance * bps) / 10_000;
        if (liquidity == 0) return;

        vm.prank(actor);
        try router.removeLiquidity(address(usdc), address(usdt), liquidity, 0, 0, actor, _deadline()) {
            liquidityRemoveCount++;
        } catch {}
    }

    function removeLiquidityKashUsdc(uint256 actorSeed, uint256 bps) public {
        address actor = _actor(actorSeed);
        bps = bound(bps, 1, 10_000);
        uint256 balance = kashUsdc.balanceOf(actor);
        if (balance == 0) return;
        uint256 liquidity = (balance * bps) / 10_000;
        if (liquidity == 0) return;

        uint256 before = actor.balance;
        vm.prank(actor);
        try router.removeLiquidityETH(address(usdc), liquidity, 0, 0, actor, _deadline()) {
            liquidityRemoveCount++;
            kashUnwrapped += actor.balance - before;
        } catch {}
    }

    // ------------------------------------------- reserve/balance desync attacks

    /// @dev Donate tokens straight to a pair, pushing balance above reserves.
    function donateToPair(uint256 pairSeed, uint256 amount) public {
        amount = bound(amount, 1, 10_000e6);
        IArkSwapPair p = pairSeed % 2 == 0 ? kashUsdc : usdcUsdt;
        usdc.mint(address(p), amount);
    }

    function syncPair(uint256 pairSeed) public {
        IArkSwapPair p = pairSeed % 2 == 0 ? kashUsdc : usdcUsdt;
        try p.sync() {} catch {}
    }

    function skimPair(uint256 pairSeed, uint256 actorSeed) public {
        IArkSwapPair p = pairSeed % 2 == 0 ? kashUsdc : usdcUsdt;
        try p.skim(_actor(actorSeed)) {} catch {}
    }

    // ------------------------------------------------------------ pair registry

    function createPair(uint256 seedA, uint256 seedB) public {
        address a = address(uint160(bound(seedA, 1, type(uint160).max)));
        address b = address(uint160(bound(seedB, 1, type(uint160).max)));
        if (a == b) return;
        try factory.createPair(a, b) {} catch {}
    }

    function warp(uint256 secs) public {
        vm.warp(block.timestamp + bound(secs, 1, 7 days));
    }

    receive() external payable {}
}
