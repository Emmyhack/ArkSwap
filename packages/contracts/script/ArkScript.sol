// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IErc20Meta {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @notice Shared preflight guards for every ArkSwap deployment script.
/// @dev llm.txt s3/s57 are categorical: never invent Ark network values, and verify
///      deployed addresses by checking code on-chain. Every helper here fails
///      LOUDLY on a missing or mismatched value rather than defaulting, so a
///      half-configured environment cannot produce a half-deployed protocol.
abstract contract ArkScript is Script {
    function _requireAddress(string memory key) internal view returns (address value) {
        value = vm.envOr(key, address(0));
        require(value != address(0), string.concat("ArkScript: missing required env var ", key, " (see .env.example)"));
    }

    function _requireUint(string memory key) internal view returns (uint256 value) {
        value = vm.envOr(key, uint256(0));
        require(value != 0, string.concat("ArkScript: missing required env var ", key, " (see .env.example)"));
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length > 0, string.concat("ArkScript: no code at ", label));
    }

    /// @dev Refuses to act against any chain but the configured Ark network.
    function _assertArkChain() internal view {
        uint256 expected = _requireUint("ARK_EVM_CHAIN_ID");
        require(
            block.chainid == expected,
            string.concat(
                "ArkScript: chain id mismatch -- connected to ",
                vm.toString(block.chainid),
                " but ARK_EVM_CHAIN_ID is ",
                vm.toString(expected)
            )
        );
    }

    /// @dev Verifies the configured WKASH really is a canonical 18-decimal WKASH.
    ///      ArkSwap must never deploy or accept a substitute wrapper (llm.txt s14).
    function _assertCanonicalWkash(address wkash) internal view {
        _requireCode(wkash, "WKASH_ADDRESS");
        require(
            keccak256(bytes(IErc20Meta(wkash).symbol())) == keccak256(bytes("WKASH")),
            'ArkScript: WKASH_ADDRESS symbol() is not "WKASH"'
        );
        require(IErc20Meta(wkash).decimals() == 18, "ArkScript: WKASH_ADDRESS decimals() is not 18");
    }

    function _deployer() internal view returns (address) {
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        require(pk != 0, "ArkScript: missing required env var DEPLOYER_PRIVATE_KEY");
        return vm.addr(pk);
    }

    function _startBroadcast() internal {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
    }

    function _logAddress(string memory label, address value) internal pure {
        console2.log(label, value);
    }
}
