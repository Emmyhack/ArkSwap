// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

/// @notice TEST DOUBLE for canonical WKASH. NEVER DEPLOY THIS.
/// @dev ArkSwap must always be pointed at the canonical Ark WKASH deployment;
///      it never ships its own wrapper (llm.txt s14, s57). This fixture exists
///      only so the local Foundry suite can exercise wrap/unwrap paths.
///
///      Behaviourally faithful to the WETH9-derived canonical contract, including
///      `withdraw()` using `.transfer()` (2300 gas stipend). That stipend is the
///      reason ArkSwapRouter02.receive() must stay cheap -- it reads an immutable,
///      not storage. Keeping the stipend here means the suite would catch a
///      regression that made the router's receive path too expensive.
contract WKASH9 {
    string public name = "Wrapped KASH";
    string public symbol = "WKASH";
    uint8 public decimals = 18;

    event Approval(address indexed src, address indexed guy, uint256 wad);
    event Transfer(address indexed src, address indexed dst, uint256 wad);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad, "WKASH: INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint256) {
        return address(this).balance;
    }

    function approve(address guy, uint256 wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(balanceOf[src] >= wad, "WKASH: INSUFFICIENT_BALANCE");
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "WKASH: INSUFFICIENT_ALLOWANCE");
            allowance[src][msg.sender] -= wad;
        }
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        emit Transfer(src, dst, wad);
        return true;
    }
}
