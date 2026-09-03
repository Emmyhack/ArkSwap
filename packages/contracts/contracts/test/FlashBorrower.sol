// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

interface IPairLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface ITokenLike {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice Flash-swap callback fixture exercising IArkSwapCallee.arkSwapCall.
/// @dev Used to prove the pair's optimistic-transfer + k-check path, and that a
///      borrower which fails to repay enough is reverted by 'ArkSwap: K'
///      (llm.txt s48). `repayBps` controls how much of the required input is
///      returned: 10000 = exactly the 0.30%-fee-adjusted amount.
contract FlashBorrower {
    uint256 public constant BPS = 10_000;

    bool public called;
    address public lastSender;
    uint256 public lastAmount0;
    uint256 public lastAmount1;

    uint256 private repayBps;

    function flash(address pair, uint256 amount0Out, uint256 amount1Out, uint256 _repayBps) external {
        repayBps = _repayBps;
        IPairLike(pair).swap(amount0Out, amount1Out, address(this), abi.encode(uint256(1)));
    }

    function arkSwapCall(address sender, uint256 amount0, uint256 amount1, bytes calldata) external {
        called = true;
        lastSender = sender;
        lastAmount0 = amount0;
        lastAmount1 = amount1;

        // Repay the borrowed side with the same token, covering the 0.30% fee.
        // required = borrowed * 1000 / 997, rounded up.
        address pair = msg.sender;
        if (amount0 > 0) {
            uint256 required = (amount0 * 1000) / 997 + 1;
            require(ITokenLike(IPairLike(pair).token0()).transfer(pair, (required * repayBps) / BPS), "repay0");
        }
        if (amount1 > 0) {
            uint256 required = (amount1 * 1000) / 997 + 1;
            require(ITokenLike(IPairLike(pair).token1()).transfer(pair, (required * repayBps) / BPS), "repay1");
        }
    }
}
