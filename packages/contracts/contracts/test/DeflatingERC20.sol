// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @notice Fee-on-transfer token that burns 1% of every transfer.
/// @dev Test fixture mirroring Uniswap V2 Periphery's DeflatingERC20. Used to
///      exercise the Router's SupportingFeeOnTransferTokens paths (llm.txt s19, s48).
contract DeflatingERC20 {
    string public constant name = 'Deflating Test Token';
    string public constant symbol = 'DTT';
    uint8 public constant decimals = 18;

    uint public totalSupply;
    mapping(address => uint) public balanceOf;
    mapping(address => mapping(address => uint)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    constructor(uint _totalSupply) {
        _mint(msg.sender, _totalSupply);
    }

    function mint(address to, uint value) external {
        _mint(to, value);
    }

    function _mint(address to, uint value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint value) internal {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function approve(address spender, uint value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint).max) {
            allowance[from][msg.sender] -= value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// @dev Burns 1% of `value`; the recipient receives the remaining 99%.
    function _transfer(address from, address to, uint value) internal {
        uint burnAmount = value / 100;
        _burn(from, burnAmount);
        uint transferAmount = value - burnAmount;
        balanceOf[from] -= transferAmount;
        balanceOf[to] += transferAmount;
        emit Transfer(from, to, transferAmount);
    }
}
