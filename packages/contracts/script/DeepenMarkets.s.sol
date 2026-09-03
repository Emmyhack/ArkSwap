// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from './ArkScript.sol';
import {console2} from 'forge-std/Script.sol';

interface ITokenOps {
    function approve(address, uint256) external returns (bool);
    function mint(address, uint256) external;
}

interface IRouterOps {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256, uint256, uint256);

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256, uint256, uint256);
}

/// @notice Adds depth to existing devnet markets so ordinary trade sizes do not
///         move the price absurdly.
///
/// @dev Deposits are made AT THE CURRENT POOL RATIO. The Router computes the
///      optimal second-side amount itself, so this adds liquidity without
///      repricing anything — topping up a pool must never be a backdoor way to
///      move the market (llm.txt s32).
///
///      Mock/mock pools are effectively free to deepen because both sides are
///      mintable devnet fixtures. The WKASH pool is limited by real faucet KASH,
///      so the native-asset side is deliberately concentrated into the single
///      WKASH/mUSDC pool that every KASH route hops through.
contract DeepenMarkets is ArkScript {
    function run() external {
        _assertArkChain();

        address router = _requireAddress('ARKSWAP_ROUTER_ADDRESS');
        address musdc = _requireAddress('MOCK_USDC_ADDRESS');
        address me = _deployer();

        uint256 kashTopUp = vm.envOr('DEEPEN_KASH', uint256(60 ether));
        require(me.balance > kashTopUp, 'DeepenMarkets: not enough native KASH');

        // --- mock/mock markets: free to deepen -------------------------------
        _topUpMock(router, musdc, vm.envAddress('MWETH_ADDRESS'), 190e18, 570_000e6);
        _topUpMock(router, musdc, vm.envAddress('MWBTC_ADDRESS'), 19e8, 1_235_000e6);
        _topUpMock(router, musdc, vm.envAddress('MDAI_ADDRESS'), 450_000e18, 450_000e6);
        _topUpMock(router, musdc, vm.envAddress('MLINK_ADDRESS'), 18_000e18, 270_000e6);

        // --- the KASH routing hub --------------------------------------------
        // Every KASH <-> token route hops through WKASH/mUSDC, so the scarce
        // native asset is concentrated here rather than spread thin.
        _startBroadcast();
        // Mint generously: the Router consumes only the amount the current ratio
        // requires and the rest is simply not pulled.
        ITokenOps(musdc).mint(me, 5_000_000e6);
        ITokenOps(musdc).approve(router, 5_000_000e6);
        (uint256 usedToken, uint256 usedKash,) = IRouterOps(router).addLiquidityETH{value: kashTopUp}(
            musdc, 5_000_000e6, 0, 0, me, block.timestamp + 20 minutes
        );
        vm.stopBroadcast();

        console2.log('WKASH/mUSDC topped up');
        console2.log('  KASH added ', usedKash);
        console2.log('  mUSDC added', usedToken);
    }

    function _topUpMock(
        address router,
        address musdc,
        address token,
        uint256 tokenAmount,
        uint256 usdcAmount
    ) internal {
        address me = _deployer();
        _startBroadcast();
        ITokenOps(token).mint(me, tokenAmount);
        ITokenOps(musdc).mint(me, usdcAmount);
        ITokenOps(token).approve(router, tokenAmount);
        ITokenOps(musdc).approve(router, usdcAmount);
        IRouterOps(router).addLiquidity(
            token, musdc, tokenAmount, usdcAmount, 0, 0, me, block.timestamp + 20 minutes
        );
        vm.stopBroadcast();
        console2.log('deepened', token);
    }
}
