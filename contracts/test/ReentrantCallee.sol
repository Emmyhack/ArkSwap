// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

interface IPairReentry {
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function sync() external;
    function skim(address to) external;
}

/// @notice Attempts to re-enter a pair from inside the flash-swap callback.
/// @dev Every entry point below is guarded by ArkSwapPair's `lock` modifier, so
///      each attempt must revert with 'ArkSwap: LOCKED' (llm.txt s18, s48).
contract ReentrantCallee {
    enum Mode {
        Swap,
        Sync,
        Skim
    }

    Mode public mode;

    function attack(address pair, uint256 amount0Out, uint256 amount1Out, Mode _mode) external {
        mode = _mode;
        IPairReentry(pair).swap(amount0Out, amount1Out, address(this), abi.encode(uint256(1)));
    }

    function arkSwapCall(address, uint256, uint256, bytes calldata) external {
        if (mode == Mode.Swap) {
            IPairReentry(msg.sender).swap(1, 0, address(this), "");
        } else if (mode == Mode.Sync) {
            IPairReentry(msg.sender).sync();
        } else {
            IPairReentry(msg.sender).skim(address(this));
        }
    }
}
