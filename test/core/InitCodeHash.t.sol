// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";

/// @notice Guards the CREATE2 init-code hash baked into ArkSwapLibrary (llm.txt s7).
/// @dev If this fails, ArkSwapPair bytecode or a compiler setting changed without
///      `make init-code-hash` being re-run. DO NOT DEPLOY THE ROUTER until it passes:
///      a stale constant makes ArkSwapLibrary.pairFor() derive addresses that no
///      pair will ever occupy, and every router swap would revert or, worse, send
///      tokens to an address an attacker could occupy via CREATE2.
contract InitCodeHashTest is ArkSwapTest {
    function setUp() public {
        lib = _deployLibraryHarness();
    }

    function test_libraryHashMatchesCompiledPairCreationCode() public view {
        bytes32 compiled = keccak256(vm.getCode("ArkSwapPair.sol:ArkSwapPair"));
        assertEq(
            lib.pairInitCodeHash(), compiled, "PAIR_INIT_CODE_HASH is stale -- run `make init-code-hash` and re-audit"
        );
    }

    /// @dev Pins the exact value so an unreviewed bytecode change is visible in
    ///      the diff rather than silently regenerated.
    function test_initCodeHashIsPinnedValue() public view {
        assertEq(
            lib.pairInitCodeHash(),
            0x30820c342fc28c16c80e536d138c0c5290a90de3583c2a126a9e19b519432e74,
            "pair init-code hash changed -- this is a protocol-level change, see docs/UPSTREAM-DIFF.md"
        );
    }
}
