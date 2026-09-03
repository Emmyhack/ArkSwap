// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from "./ArkScript.sol";
import {console2} from "forge-std/Script.sol";

interface IFactoryCreate {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
    function allPairsLength() external view returns (uint256);
}

/// @notice Steps 11-12: create the initial devnet pairs (llm.txt s16, s31).
contract CreatePairs is ArkScript {
    function run() external {
        _assertArkChain();
        address factory = _requireAddress("ARKSWAP_FACTORY_ADDRESS");
        address wkash = _requireAddress("WKASH_ADDRESS");
        address musdc = _requireAddress("MOCK_USDC_ADDRESS");
        address musdt = vm.envOr("MOCK_USDT_ADDRESS", address(0));

        _requireCode(factory, "ARKSWAP_FACTORY_ADDRESS");
        _assertCanonicalWkash(wkash);
        _requireCode(musdc, "MOCK_USDC_ADDRESS");

        _startBroadcast();
        address kashUsdc = _createIfMissing(factory, wkash, musdc);
        address kashUsdt;
        address usdcUsdt;
        if (musdt != address(0)) {
            kashUsdt = _createIfMissing(factory, wkash, musdt);
            usdcUsdt = _createIfMissing(factory, musdc, musdt);
        }
        vm.stopBroadcast();

        _logAddress("WKASH_MUSDC_PAIR_ADDRESS", kashUsdc);
        if (musdt != address(0)) {
            _logAddress("WKASH_MUSDT_PAIR_ADDRESS", kashUsdt);
            _logAddress("MUSDC_MUSDT_PAIR_ADDRESS", usdcUsdt);
        }
        console2.log("allPairsLength", IFactoryCreate(factory).allPairsLength());
    }

    function _createIfMissing(address factory, address a, address b) internal returns (address p) {
        p = IFactoryCreate(factory).getPair(a, b);
        if (p == address(0)) {
            p = IFactoryCreate(factory).createPair(a, b);
        } else {
            console2.log("pair already exists, skipping", p);
        }
        require(p != address(0), "CreatePairs: pair creation returned address(0)");
    }
}
