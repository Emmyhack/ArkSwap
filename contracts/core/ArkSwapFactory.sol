// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.5.16;

import './interfaces/IArkSwapFactory.sol';
import './ArkSwapPair.sol';

/// @notice Permissionless CREATE2 pair registry for ArkSwap V1.
/// @dev Semantic fork of Uniswap V2 Core's UniswapV2Factory. The CREATE2 salt
///      (keccak256(token0, token1)) and token sorting are UNMODIFIED (llm.txt s54).
///      `feeToSetter` is privileged ONLY over protocol-fee configuration: it can
///      never seize liquidity, pause pairs, or alter swap math (llm.txt s8, s25).
contract ArkSwapFactory is IArkSwapFactory {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);

    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, 'ArkSwap: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'ArkSwap: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'ArkSwap: PAIR_EXISTS'); // single check is sufficient
        bytes memory bytecode = type(ArkSwapPair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IArkSwapPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, 'ArkSwap: FORBIDDEN');
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, 'ArkSwap: FORBIDDEN');
        feeToSetter = _feeToSetter;
    }
}
