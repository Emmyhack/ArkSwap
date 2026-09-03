// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

/// @notice Canonical wrapped-native interface for Ark Constellation.
/// @dev Structurally identical to Uniswap V2 Periphery's IWETH. On Ark the
///      native value asset is KASH, so `deposit()` wraps KASH into WKASH and
///      `withdraw()` unwraps it (llm.txt s14). ArkSwap must always be pointed at
///      the canonical WKASH deployment -- it never deploys its own wrapper.
interface IWKASH {
    function deposit() external payable;
    function transfer(address to, uint value) external returns (bool);
    function withdraw(uint) external;
}
