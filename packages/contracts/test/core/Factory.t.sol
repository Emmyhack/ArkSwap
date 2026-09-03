// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapFactory, IArkSwapPair} from "../utils/Interfaces.sol";

/// @notice ArkSwapFactory unit tests (llm.txt s8, s18).
contract FactoryTest is ArkSwapTest {
    function setUp() public {
        _deployStack();
    }

    function test_factoryFeeToSetter() public view {
        assertEq(factory.feeToSetter(), feeToSetter);
    }

    /// @dev Protocol fee must ship DISABLED on devnet V1 (llm.txt s8, s49).
    function test_feeToIsZeroAtDeployment() public view {
        assertEq(factory.feeTo(), address(0));
    }

    function test_allPairsLengthInitiallyZero() public view {
        assertEq(factory.allPairsLength(), 0);
    }

    function test_createPair() public {
        address p = address(_createPair(address(usdc), address(usdt)));

        assertGt(p.code.length, 0, "pair has no code");
        assertEq(factory.allPairsLength(), 1);
        assertEq(factory.allPairs(0), p);

        (address token0, address token1) =
            address(usdc) < address(usdt) ? (address(usdc), address(usdt)) : (address(usdt), address(usdc));
        assertEq(IArkSwapPair(p).token0(), token0, "token0 not sorted");
        assertEq(IArkSwapPair(p).token1(), token1, "token1 not sorted");
        assertEq(IArkSwapPair(p).factory(), address(factory));
    }

    function test_cannotCreateIdenticalPair() public {
        vm.expectRevert(bytes("ArkSwap: IDENTICAL_ADDRESSES"));
        factory.createPair(address(usdc), address(usdc));
    }

    function test_cannotCreateZeroAddressPair() public {
        vm.expectRevert(bytes("ArkSwap: ZERO_ADDRESS"));
        factory.createPair(address(0), address(usdc));

        vm.expectRevert(bytes("ArkSwap: ZERO_ADDRESS"));
        factory.createPair(address(usdc), address(0));
    }

    function test_cannotCreateDuplicatePair() public {
        _createPair(address(usdc), address(usdt));

        vm.expectRevert(bytes("ArkSwap: PAIR_EXISTS"));
        factory.createPair(address(usdc), address(usdt));

        // reversed argument order must hit the same guard
        vm.expectRevert(bytes("ArkSwap: PAIR_EXISTS"));
        factory.createPair(address(usdt), address(usdc));
    }

    function test_pairStoredBothDirections() public {
        address p = address(_createPair(address(usdc), address(usdt)));
        assertEq(factory.getPair(address(usdc), address(usdt)), p);
        assertEq(factory.getPair(address(usdt), address(usdc)), p);
    }

    function test_pairCreatedEvent() public {
        (address token0, address token1) =
            address(usdc) < address(usdt) ? (address(usdc), address(usdt)) : (address(usdt), address(usdc));
        address predicted = lib.pairFor(address(factory), address(usdc), address(usdt));

        vm.expectEmit(true, true, false, true, address(factory));
        emit IArkSwapFactory.PairCreated(token0, token1, predicted, 1);
        factory.createPair(address(usdc), address(usdt));
    }

    function test_onlyFeeToSetterCanSetFeeTo() public {
        vm.expectRevert(bytes("ArkSwap: FORBIDDEN"));
        vm.prank(alice);
        factory.setFeeTo(treasury);

        vm.prank(feeToSetter);
        factory.setFeeTo(treasury);
        assertEq(factory.feeTo(), treasury);
    }

    function test_onlyFeeToSetterCanChangeFeeToSetter() public {
        vm.expectRevert(bytes("ArkSwap: FORBIDDEN"));
        vm.prank(alice);
        factory.setFeeToSetter(alice);

        vm.prank(feeToSetter);
        factory.setFeeToSetter(alice);
        assertEq(factory.feeToSetter(), alice);

        // old setter loses the privilege
        vm.expectRevert(bytes("ArkSwap: FORBIDDEN"));
        vm.prank(feeToSetter);
        factory.setFeeTo(treasury);
    }

    /// @dev feeToSetter is scoped strictly to fee configuration: it grants no
    ///      power over pair creation or user funds (llm.txt s8, s25).
    function test_feeToSetterCannotBlockPairCreation() public {
        vm.prank(alice);
        address p = factory.createPair(address(usdc), address(usdt));
        assertGt(p.code.length, 0);
    }

    function test_pairIsInitializedExactlyOnce() public {
        IArkSwapPair p = _createPair(address(usdc), address(usdt));
        vm.expectRevert(bytes("ArkSwap: FORBIDDEN"));
        p.initialize(address(usdc), address(usdt));
    }

    function testFuzz_allPairsGrowsMonotonically(uint8 n) public {
        n = uint8(bound(n, 1, 12));
        for (uint256 i = 0; i < n; i++) {
            address a = address(uint160(0x1000 + i * 2));
            address b = address(uint160(0x1000 + i * 2 + 1));
            factory.createPair(a, b);
            assertEq(factory.allPairsLength(), i + 1);
        }
    }
}
