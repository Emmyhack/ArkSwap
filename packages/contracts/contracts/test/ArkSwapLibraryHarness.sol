// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.6.6;

import '../periphery/libraries/ArkSwapLibrary.sol';

/// @notice External wrapper around {ArkSwapLibrary}.
/// @dev Test-only. ArkSwapLibrary's members are `internal`, so a 0.8.x Foundry
///      test cannot call them across the compiler boundary. This harness is
///      compiled at =0.6.6 alongside the real library and exposed to tests via
///      `vm.deployCode`, so the suite exercises the exact library code the
///      Router links against -- not a reimplementation (llm.txt s11).
contract ArkSwapLibraryHarness {
    function pairInitCodeHash() external pure returns (bytes32) {
        return ArkSwapLibrary.PAIR_INIT_CODE_HASH;
    }

    function sortTokens(address tokenA, address tokenB) external pure returns (address, address) {
        return ArkSwapLibrary.sortTokens(tokenA, tokenB);
    }

    function pairFor(address factory, address tokenA, address tokenB) external pure returns (address) {
        return ArkSwapLibrary.pairFor(factory, tokenA, tokenB);
    }

    function getReserves(address factory, address tokenA, address tokenB) external view returns (uint, uint) {
        return ArkSwapLibrary.getReserves(factory, tokenA, tokenB);
    }

    function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint) {
        return ArkSwapLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) external pure returns (uint) {
        return ArkSwapLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) external pure returns (uint) {
        return ArkSwapLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(address factory, uint amountIn, address[] calldata path)
        external
        view
        returns (uint[] memory)
    {
        return ArkSwapLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(address factory, uint amountOut, address[] calldata path)
        external
        view
        returns (uint[] memory)
    {
        return ArkSwapLibrary.getAmountsIn(factory, amountOut, path);
    }
}
