// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkSwapTest} from "../utils/ArkSwapTest.sol";
import {IArkSwapPair, IToken} from "../utils/Interfaces.sol";

/// @notice ArkSwapERC20 (LP token) unit tests (llm.txt s10, s18).
contract LPTokenTest is ArkSwapTest {
    IToken internal tokenA;
    IToken internal tokenB;
    IArkSwapPair internal p;

    uint256 internal ownerKey = 0xA11CE;
    address internal owner;

    function setUp() public {
        _deployStack();
        tokenA = _deployToken("Token A", "TKNA", 18, 0);
        tokenB = _deployToken("Token B", "TKNB", 18, 0);
        p = _createPair(address(tokenA), address(tokenB));

        owner = vm.addr(ownerKey);
        _addLiquidityDirect(p, 1_000e18, 1_000e18, owner);
    }

    // ---------------------------------------------------------------- metadata

    function test_lpMetadata() public view {
        assertEq(p.name(), "ArkSwap V1");
        assertEq(p.symbol(), "ARK-V1-LP");
        assertEq(p.decimals(), 18);
    }

    function test_permitTypehash() public view {
        assertEq(
            p.PERMIT_TYPEHASH(),
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")
        );
    }

    /// @dev The EIP-712 domain binds the LP token name, so ArkSwap's separator
    ///      necessarily differs from Uniswap V2's. Signatures are not portable
    ///      between the two, which is the intended outcome of the rebrand.
    function test_domainSeparator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("ArkSwap V1")),
                keccak256(bytes("1")),
                block.chainid,
                address(p)
            )
        );
        assertEq(p.DOMAIN_SEPARATOR(), expected);
    }

    // ---------------------------------------------------------------- transfers

    function test_lpTransfer() public {
        uint256 amount = 100e18;
        uint256 before = p.balanceOf(owner);

        vm.prank(owner);
        p.transfer(bob, amount);

        assertEq(p.balanceOf(bob), amount);
        assertEq(p.balanceOf(owner), before - amount);
    }

    function test_lpTransferRevertsOnInsufficientBalance() public {
        vm.expectRevert(bytes("ds-math-sub-underflow"));
        vm.prank(bob);
        p.transfer(alice, 1);
    }

    function test_lpApprove() public {
        vm.prank(owner);
        p.approve(bob, 500e18);
        assertEq(p.allowance(owner, bob), 500e18);
    }

    function test_lpTransferFrom() public {
        vm.prank(owner);
        p.approve(bob, 500e18);

        vm.prank(bob);
        p.transferFrom(owner, alice, 200e18);

        assertEq(p.balanceOf(alice), 200e18);
        assertEq(p.allowance(owner, bob), 300e18, "allowance must decrease");
    }

    /// @dev An infinite allowance is not decremented (upstream V2 behaviour).
    function test_lpTransferFromInfiniteAllowanceNotDecremented() public {
        vm.prank(owner);
        p.approve(bob, type(uint256).max);

        vm.prank(bob);
        p.transferFrom(owner, alice, 200e18);

        assertEq(p.allowance(owner, bob), type(uint256).max);
    }

    function test_lpTransferFromRevertsWithoutAllowance() public {
        vm.expectRevert(bytes("ds-math-sub-underflow"));
        vm.prank(bob);
        p.transferFrom(owner, alice, 1);
    }

    // ------------------------------------------------------------------- permit

    function _permitDigest(address _owner, address spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                p.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(p.PERMIT_TYPEHASH(), _owner, spender, value, nonce, deadline))
            )
        );
    }

    function test_permit() public {
        uint256 value = 123e18;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, _permitDigest(owner, bob, value, p.nonces(owner), deadline));

        p.permit(owner, bob, value, deadline, v, r, s);

        assertEq(p.allowance(owner, bob), value);
        assertEq(p.nonces(owner), 1, "nonce must increment");
    }

    function test_permitRevertsWhenExpired() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, _permitDigest(owner, bob, 1e18, p.nonces(owner), deadline));

        vm.expectRevert(bytes("ArkSwap: EXPIRED"));
        p.permit(owner, bob, 1e18, deadline, v, r, s);
    }

    function test_permitRevertsOnWrongSigner() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, _permitDigest(owner, bob, 1e18, p.nonces(owner), deadline));

        vm.expectRevert(bytes("ArkSwap: INVALID_SIGNATURE"));
        p.permit(owner, bob, 1e18, deadline, v, r, s);
    }

    /// @dev Replay protection: the same signature cannot be used twice.
    function test_permitCannotBeReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, _permitDigest(owner, bob, 1e18, p.nonces(owner), deadline));

        p.permit(owner, bob, 1e18, deadline, v, r, s);

        vm.expectRevert(bytes("ArkSwap: INVALID_SIGNATURE"));
        p.permit(owner, bob, 1e18, deadline, v, r, s);
    }

    /// @dev LP tokens must carry no transfer tax or restriction (llm.txt s10).
    function testFuzz_lpTransferIsLossless(uint256 amount) public {
        uint256 balance = p.balanceOf(owner);
        amount = bound(amount, 0, balance);

        vm.prank(owner);
        p.transfer(bob, amount);

        assertEq(p.balanceOf(bob), amount, "recipient must receive exactly the sent amount");
        assertEq(p.balanceOf(owner) + p.balanceOf(bob), balance, "supply conserved across transfer");
    }
}
