// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {
    IArkSwapFactory,
    IArkSwapLibraryHarness,
    IArkSwapPair,
    IArkSwapRouter02,
    IFlashBorrower,
    IToken,
    IWKASH
} from "./Interfaces.sol";

/// @notice Shared fixture for the ArkSwap suite.
/// @dev Every protocol contract is instantiated from its REAL compiled artifact
///      via `vm.deployCode`, so tests exercise the exact bytecode destined for
///      Ark Constellation across all three compiler versions.
abstract contract ArkSwapTest is Test {
    uint256 internal constant MINIMUM_LIQUIDITY = 1000;

    address internal feeToSetter = makeAddr("feeToSetter");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    IArkSwapFactory internal factory;
    IArkSwapRouter02 internal router;
    IArkSwapLibraryHarness internal lib;
    IWKASH internal wkash;

    IToken internal usdc;
    IToken internal usdt;

    // ---------------------------------------------------------------- deploy

    function _deployFactory(address _feeToSetter) internal returns (IArkSwapFactory) {
        return IArkSwapFactory(vm.deployCode("ArkSwapFactory.sol:ArkSwapFactory", abi.encode(_feeToSetter)));
    }

    function _deployWkash() internal returns (IWKASH) {
        return IWKASH(vm.deployCode("WKASH9.sol:WKASH9"));
    }

    function _deployRouter(address _factory, address _wkash) internal returns (IArkSwapRouter02) {
        return IArkSwapRouter02(vm.deployCode("ArkSwapRouter02.sol:ArkSwapRouter02", abi.encode(_factory, _wkash)));
    }

    function _deployLibraryHarness() internal returns (IArkSwapLibraryHarness) {
        return IArkSwapLibraryHarness(vm.deployCode("ArkSwapLibraryHarness.sol:ArkSwapLibraryHarness"));
    }

    function _deployToken(string memory name, string memory symbol, uint8 decimals, uint256 supply)
        internal
        returns (IToken)
    {
        return IToken(vm.deployCode("MockERC20.sol:MockERC20", abi.encode(name, symbol, decimals, supply)));
    }

    function _deployFlashBorrower() internal returns (IFlashBorrower) {
        return IFlashBorrower(vm.deployCode("FlashBorrower.sol:FlashBorrower"));
    }

    /// @dev Full core+periphery stack, matching the intended Ark devnet topology.
    function _deployStack() internal {
        factory = _deployFactory(feeToSetter);
        wkash = _deployWkash();
        router = _deployRouter(address(factory), address(wkash));
        lib = _deployLibraryHarness();

        usdc = IToken(vm.deployCode("MockUSDC.sol:MockUSDC", abi.encode(uint256(0))));
        usdt = IToken(vm.deployCode("MockUSDT.sol:MockUSDT", abi.encode(uint256(0))));
    }

    // --------------------------------------------------------------- helpers

    function pair(address tokenA, address tokenB) internal view returns (IArkSwapPair) {
        return IArkSwapPair(factory.getPair(tokenA, tokenB));
    }

    function _createPair(address tokenA, address tokenB) internal returns (IArkSwapPair) {
        return IArkSwapPair(factory.createPair(tokenA, tokenB));
    }

    /// @dev Seeds a pair by transferring tokens directly and calling mint(), the
    ///      low-level path. Router-level seeding is covered separately.
    function _addLiquidityDirect(IArkSwapPair p, uint256 amount0, uint256 amount1, address to)
        internal
        returns (uint256 liquidity)
    {
        IToken(p.token0()).mint(address(p), amount0);
        IToken(p.token1()).mint(address(p), amount1);
        liquidity = p.mint(to);
    }

    function _reservesFor(IArkSwapPair p, address token) internal view returns (uint256 reserveOfToken, uint256 other) {
        (uint112 r0, uint112 r1,) = p.getReserves();
        return p.token0() == token ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _path2(address a, address b) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = a;
        path[1] = b;
    }

    function _path3(address a, address b, address c) internal pure returns (address[] memory path) {
        path = new address[](3);
        path[0] = a;
        path[1] = b;
        path[2] = c;
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    /// @dev Reference implementation of the 0.30%-fee constant-product formula,
    ///      written independently of ArkSwapLibrary so the library is checked
    ///      against an oracle rather than against itself.
    function _expectedAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function _expectedAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        return ((reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997)) + 1;
    }
}
