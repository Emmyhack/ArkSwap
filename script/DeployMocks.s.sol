// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from "./ArkScript.sol";
import {console2} from "forge-std/Script.sol";

/// @notice Deploys Ark devnet mock stablecoins (llm.txt s15, s27).
/// @dev DEVNET ONLY. These are not real stablecoins and must be surfaced in the
///      UI as "DEVNET TEST TOKEN - NO REAL VALUE". Their mint() is unrestricted.
contract DeployMocks is ArkScript {
    function run() external {
        _assertArkChain();

        _startBroadcast();
        address musdc = deployCode("MockUSDC.sol:MockUSDC", abi.encode(uint256(0)));
        address musdt = deployCode("MockUSDT.sol:MockUSDT", abi.encode(uint256(0)));
        vm.stopBroadcast();

        _logAddress("MOCK_USDC_ADDRESS", musdc);
        _logAddress("MOCK_USDT_ADDRESS", musdt);
        console2.log('Both mocks use 6 decimals. Verify with: cast call <addr> "decimals()(uint8)"');
    }
}
