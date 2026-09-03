// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.6.2;

import './IArkSwapRouter01.sol';

/// @notice ArkSwap V1 router, stage 2 -- adds fee-on-transfer token support.
/// @dev See IArkSwapRouter01 for the ETH/KASH naming note (llm.txt s12, s41).
interface IArkSwapRouter02 is IArkSwapRouter01 {
    /// @notice Ark-native alias for {WETH}. Returns the canonical WKASH address.
    /// @dev ARKSWAP ADDITION (additive, non-breaking): upstream Router02 exposes
    ///      only `WETH()`. Both getters return the same immutable, so integrators
    ///      written against Uniswap V2 keep working while Ark tooling can read a
    ///      correctly named getter (llm.txt s30). See docs/UPSTREAM-DIFF.md.
    function WKASH() external pure returns (address);

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountETH);

    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountETH);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
}
