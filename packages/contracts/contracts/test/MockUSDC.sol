// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/// @notice Ark devnet mock stablecoin, 6 decimals (llm.txt s15).
/// @dev NOT USD Coin. Not issued by Circle. Not redeemable. No real value.
contract MockUSDC is MockERC20 {
    constructor(uint256 initialSupply) MockERC20("Mock USD Coin (Ark Devnet)", "mUSDC", 6, initialSupply) {}
}
