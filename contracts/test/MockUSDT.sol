// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/// @notice Ark devnet mock stablecoin, 6 decimals (llm.txt s15).
/// @dev NOT Tether USD. Not issued by Tether. Not redeemable. No real value.
contract MockUSDT is MockERC20 {
    constructor(uint256 initialSupply) MockERC20("Mock Tether USD (Ark Devnet)", "mUSDT", 6, initialSupply) {}
}
