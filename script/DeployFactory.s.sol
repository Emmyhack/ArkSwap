// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from "./ArkScript.sol";
import {console2} from "forge-std/Script.sol";

interface IFactoryCheck {
    function feeToSetter() external view returns (address);
    function feeTo() external view returns (address);
    function allPairsLength() external view returns (uint256);
}

/// @notice Step 5 of the deployment order: deploy ArkSwapFactory (llm.txt s26, s28).
contract DeployFactory is ArkScript {
    function run() external {
        _assertArkChain();
        address feeToSetter = _requireAddress("FEE_TO_SETTER");

        _startBroadcast();
        address factory = deployCode("ArkSwapFactory.sol:ArkSwapFactory", abi.encode(feeToSetter));
        vm.stopBroadcast();

        // Post-deploy assertions (llm.txt s28).
        _requireCode(factory, "ArkSwapFactory");
        require(IFactoryCheck(factory).feeToSetter() == feeToSetter, "feeToSetter mismatch");
        require(IFactoryCheck(factory).feeTo() == address(0), "feeTo must start disabled (llm.txt s49)");
        require(IFactoryCheck(factory).allPairsLength() == 0, "allPairsLength must start at 0");

        _logAddress("ARKSWAP_FACTORY_ADDRESS", factory);
        console2.log("feeTo is address(0): protocol fee is DISABLED, LP fee stays in the pool.");
    }
}
