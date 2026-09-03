// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from './ArkScript.sol';
import {console2} from 'forge-std/Script.sol';

interface ITokenOps {
    function approve(address, uint) external returns (bool);
    function mint(address, uint) external;
}

interface IRouterSeed {
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint, uint, uint);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint, uint, uint);
}

/// @notice Stands up a COMPLETE ArkSwap stack on a LOCAL dev chain, for frontend
///         preview and UI development only.
///
/// @dev NOT A DEPLOYMENT SCRIPT. This is the only script that deploys `WKASH9`,
///      the WETH9-derived test double. Deploying a substitute wrapper on Ark is
///      forbidden (llm.txt s14, s57), so this refuses to run anywhere but a local
///      dev chain — the chain-id guard below is the safety interlock, and it
///      deliberately excludes Ark's chain id 9000.
///
///      Usage:
///        anvil &
///        forge script script/LocalPreview.s.sol:LocalPreview \
///          --rpc-url http://127.0.0.1:8545 --broadcast \
///          --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract LocalPreview is ArkScript {
    uint internal constant ANVIL_CHAIN_ID = 31337;

    function run() external {
        require(
            block.chainid == ANVIL_CHAIN_ID,
            'LocalPreview: local dev chain only -- this deploys a WKASH test double and must never touch Ark'
        );

        uint pk = vm.envOr('LOCAL_PRIVATE_KEY', uint(0));
        require(pk != 0, 'LocalPreview: set LOCAL_PRIVATE_KEY');
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        address wkash = deployCode('WKASH9.sol:WKASH9');
        address factory = deployCode('ArkSwapFactory.sol:ArkSwapFactory', abi.encode(me));
        address router = deployCode('ArkSwapRouter02.sol:ArkSwapRouter02', abi.encode(factory, wkash));
        address musdc = deployCode('MockUSDC.sol:MockUSDC', abi.encode(uint(0)));
        address musdt = deployCode('MockUSDT.sol:MockUSDT', abi.encode(uint(0)));

        // Devnet reference pricing: 1 KASH = 1 mUSDC (llm.txt s16).
        ITokenOps(musdc).mint(me, 500_000e6);
        ITokenOps(musdt).mint(me, 500_000e6);
        ITokenOps(musdc).approve(router, type(uint).max);
        ITokenOps(musdt).approve(router, type(uint).max);

        IRouterSeed(router).addLiquidityETH{value: 2_000 ether}(
            musdc, 2_000e6, 0, 0, me, block.timestamp + 1 hours
        );
        IRouterSeed(router).addLiquidityETH{value: 1_000 ether}(
            musdt, 1_000e6, 0, 0, me, block.timestamp + 1 hours
        );
        IRouterSeed(router).addLiquidity(
            musdc, musdt, 100_000e6, 100_000e6, 0, 0, me, block.timestamp + 1 hours
        );

        vm.stopBroadcast();

        string memory out = 'preview';
        vm.serializeAddress(out, 'wkash', wkash);
        vm.serializeAddress(out, 'factory', factory);
        vm.serializeAddress(out, 'router', router);
        vm.serializeAddress(out, 'musdc', musdc);
        string memory json = vm.serializeAddress(out, 'musdt', musdt);
        vm.writeJson(json, './deployments/local-preview.json');

        console2.log('WKASH9  ', wkash);
        console2.log('FACTORY ', factory);
        console2.log('ROUTER  ', router);
        console2.log('mUSDC   ', musdc);
        console2.log('mUSDT   ', musdt);
    }
}
