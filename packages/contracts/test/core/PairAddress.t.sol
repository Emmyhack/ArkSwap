// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair} from "../utils/Interfaces.sol";

/// @notice MANDATORY deployment gate (llm.txt s20).
/// @dev Asserts the address the Factory actually CREATE2-deploys equals the one
///      ArkSwapLibrary.pairFor() derives off-chain. If any test here fails, the
///      Router MUST NOT be deployed.
contract PairAddressTest is ArkSwapTest {
    IArkSwapPair internal p;

    function setUp() public {
        _deployStack();
    }

    function test_factoryPairMatchesLibraryPairFor() public {
        address created = address(_createPair(address(usdc), address(usdt)));
        assertEq(created, lib.pairFor(address(factory), address(usdc), address(usdt)));
    }

    function test_pairForIsOrderIndependent() public {
        address created = address(_createPair(address(usdc), address(usdt)));
        assertEq(lib.pairFor(address(factory), address(usdc), address(usdt)), created);
        assertEq(lib.pairFor(address(factory), address(usdt), address(usdc)), created);
    }

    function test_pairForMatchesForWkashPairs() public {
        address created = address(_createPair(address(wkash), address(usdc)));
        assertEq(created, lib.pairFor(address(factory), address(wkash), address(usdc)));
    }

    /// @dev The derivation must hold for arbitrary token addresses, not just the
    ///      handful the fixture happens to deploy.
    function testFuzz_pairForMatchesCreatedPair(address tokenA, address tokenB) public {
        vm.assume(tokenA != tokenB);
        vm.assume(tokenA != address(0) && tokenB != address(0));

        address created = factory.createPair(tokenA, tokenB);
        assertEq(created, lib.pairFor(address(factory), tokenA, tokenB));
    }

    function test_pairForDerivesDeterministicallyBeforeCreation() public {
        address predicted = lib.pairFor(address(factory), address(usdc), address(usdt));
        assertEq(predicted.code.length, 0, "pair should not exist yet");

        address created = address(_createPair(address(usdc), address(usdt)));
        assertEq(created, predicted);
        assertGt(created.code.length, 0);
    }
}
