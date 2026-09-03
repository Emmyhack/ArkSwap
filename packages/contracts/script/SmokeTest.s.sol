// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from "./ArkScript.sol";
import {console2} from "forge-std/Script.sol";

interface ITokenOps {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IRouterSmoke {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function WKASH() external view returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory);
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory);
}

interface IFactorySmoke {
    function getPair(address, address) external view returns (address);
    function allPairsLength() external view returns (uint256);
}

interface IPairSmoke {
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
}

/// @notice Live devnet smoke test (llm.txt s33, s51).
/// @dev Performs a small KASH -> mUSDC swap and a small mUSDC -> KASH swap, with
///      real slippage bounds derived from getAmountsOut. Never hardcodes a key:
///      DEPLOYER_PRIVATE_KEY comes from the environment (llm.txt s51).
contract SmokeTest is ArkScript {
    uint256 internal constant SLIPPAGE_BPS = 100; // 1.00% tolerance for devnet

    function run() external {
        _assertArkChain();

        address router = _requireAddress("ARKSWAP_ROUTER_ADDRESS");
        address factory = _requireAddress("ARKSWAP_FACTORY_ADDRESS");
        address wkash = _requireAddress("WKASH_ADDRESS");
        address musdc = _requireAddress("MOCK_USDC_ADDRESS");

        // 1-6: topology assertions.
        _requireCode(wkash, "WKASH_ADDRESS");
        _requireCode(factory, "ARKSWAP_FACTORY_ADDRESS");
        _requireCode(router, "ARKSWAP_ROUTER_ADDRESS");
        _assertCanonicalWkash(wkash);
        require(IRouterSmoke(router).factory() == factory, "SmokeTest: router.factory() mismatch");
        require(IRouterSmoke(router).WETH() == wkash, "SmokeTest: router.WETH() mismatch");
        require(IRouterSmoke(router).WKASH() == wkash, "SmokeTest: router.WKASH() mismatch");

        // 7-8: pair exists and holds reserves.
        address p = IFactorySmoke(factory).getPair(wkash, musdc);
        require(p != address(0), "SmokeTest: WKASH/mUSDC pair does not exist");
        (uint112 r0, uint112 r1,) = IPairSmoke(p).getReserves();
        require(r0 > 0 && r1 > 0, "SmokeTest: pair has no liquidity");
        console2.log("pair            ", p);
        console2.log("reserve0        ", uint256(r0));
        console2.log("reserve1        ", uint256(r1));

        address me = _deployer();
        uint256 kashIn = vm.envOr("SMOKE_KASH_IN", uint256(1 ether));
        require(me.balance > kashIn, "SmokeTest: deployer has insufficient native KASH");

        // 9: KASH -> mUSDC.
        uint256 usdcBefore = ITokenOps(musdc).balanceOf(me);
        uint256 usdcOut = _swapKashForUsdc(router, wkash, musdc, me, kashIn);
        uint256 usdcGained = ITokenOps(musdc).balanceOf(me) - usdcBefore;
        require(usdcGained >= usdcOut, "SmokeTest: mUSDC not received");
        console2.log("KASH -> mUSDC   ", usdcGained);

        // 10: mUSDC -> KASH.
        uint256 kashBefore = me.balance;
        _swapUsdcForKash(router, wkash, musdc, me, usdcGained);
        console2.log("mUSDC -> KASH   ", me.balance > kashBefore ? me.balance - kashBefore : 0);

        // 11-13: post-conditions.
        (uint112 a0, uint112 a1,) = IPairSmoke(p).getReserves();
        require(a0 > 0 && a1 > 0, "SmokeTest: reserves drained");
        console2.log("reserve0 after  ", uint256(a0));
        console2.log("reserve1 after  ", uint256(a1));
        console2.log("SMOKE TEST PASSED");
    }

    function _swapKashForUsdc(address router, address wkash, address musdc, address to, uint256 amountIn)
        internal
        returns (uint256 minOut)
    {
        address[] memory path = new address[](2);
        path[0] = wkash;
        path[1] = musdc;

        uint256[] memory quoted = IRouterSmoke(router).getAmountsOut(amountIn, path);
        minOut = (quoted[1] * (10_000 - SLIPPAGE_BPS)) / 10_000;
        require(minOut > 0, "SmokeTest: quote returned zero output");

        _startBroadcast();
        IRouterSmoke(router).swapExactETHForTokens{value: amountIn}(minOut, path, to, block.timestamp + 20 minutes);
        vm.stopBroadcast();
    }

    function _swapUsdcForKash(address router, address wkash, address musdc, address to, uint256 amountIn) internal {
        address[] memory path = new address[](2);
        path[0] = musdc;
        path[1] = wkash;

        uint256[] memory quoted = IRouterSmoke(router).getAmountsOut(amountIn, path);
        uint256 minOut = (quoted[1] * (10_000 - SLIPPAGE_BPS)) / 10_000;
        require(minOut > 0, "SmokeTest: quote returned zero output");

        _startBroadcast();
        ITokenOps(musdc).approve(router, amountIn);
        IRouterSmoke(router).swapExactTokensForETH(amountIn, minOut, path, to, block.timestamp + 20 minutes);
        vm.stopBroadcast();
    }
}
