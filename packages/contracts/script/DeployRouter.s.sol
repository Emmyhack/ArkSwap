// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from "./ArkScript.sol";
import {console2} from "forge-std/Script.sol";

interface IRouterCheck {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function WKASH() external view returns (address);
}

interface IFactoryPairFor {
    function getPair(address, address) external view returns (address);
}

/// @notice Step 8 of the deployment order: deploy ArkSwapRouter02 (llm.txt s26, s30).
/// @dev BLOCKING PRECONDITION (llm.txt s7, s20, s29): the pair init-code hash baked
///      into ArkSwapLibrary must match the compiled ArkSwapPair creation code. Run
///      `forge test --match-path 'test/core/{InitCodeHash,PairAddress}.t.sol'` and
///      do NOT deploy the router if it fails.
contract DeployRouter is ArkScript {
    function run() external {
        _assertArkChain();
        address factory = _requireAddress("ARKSWAP_FACTORY_ADDRESS");
        address wkash = _requireAddress("WKASH_ADDRESS");

        _requireCode(factory, "ARKSWAP_FACTORY_ADDRESS");
        _assertCanonicalWkash(wkash);

        // The library constant must describe the pair bytecode this repo compiles.
        bytes32 compiled = keccak256(vm.getCode("ArkSwapPair.sol:ArkSwapPair"));
        require(
            compiled == 0x30820c342fc28c16c80e536d138c0c5290a90de3583c2a126a9e19b519432e74,
            "DeployRouter: pair init-code hash changed -- run `make init-code-hash`, re-run tests, re-audit"
        );

        _startBroadcast();
        address router = deployCode("ArkSwapRouter02.sol:ArkSwapRouter02", abi.encode(factory, wkash));
        vm.stopBroadcast();

        _requireCode(router, "ArkSwapRouter02");
        require(IRouterCheck(router).factory() == factory, "router factory mismatch");
        require(IRouterCheck(router).WETH() == wkash, "router WETH() mismatch");
        require(IRouterCheck(router).WKASH() == wkash, "router WKASH() mismatch");

        _logAddress("ARKSWAP_ROUTER_ADDRESS", router);
        console2.log("Reminder: WETH() is inherited ABI naming. It returns canonical WKASH.");
    }
}
