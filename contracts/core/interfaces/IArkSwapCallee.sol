// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

/// @notice Flash-swap callback receiver.
/// @dev ARKSWAP DEVIATION (naming only): upstream declares `uniswapV2Call`.
///      ArkSwap renames the callback to `arkSwapCall` for brand consistency.
///      Semantics, arguments and call ordering are byte-for-byte identical to
///      Uniswap V2; only the 4-byte selector differs. Flash-swap integrators
///      written against Uniswap V2 must rename their callback to compile
///      against ArkSwap. See docs/UPSTREAM-DIFF.md.
interface IArkSwapCallee {
    function arkSwapCall(address sender, uint amount0, uint amount1, bytes calldata data) external;
}
