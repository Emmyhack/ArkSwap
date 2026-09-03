// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from './ArkScript.sol';
import {console2} from 'forge-std/Script.sol';

interface ITokenOps {
    function approve(address, uint256) external returns (bool);
    function mint(address, uint256) external;
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

interface IRouterOps {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256, uint256, uint256);
}

interface IFactoryOps {
    function getPair(address, address) external view returns (address);
    function allPairsLength() external view returns (uint256);
}

/// @notice Deploys additional Ark devnet mock assets and seeds mUSDC markets for them.
///
/// @dev DEVNET ONLY. Every token here is a fixture with unrestricted minting and
///      no value; they must never be presented as the real assets whose tickers
///      they borrow (llm.txt s15).
///
///      Each new market is paired against mUSDC rather than WKASH on purpose:
///      both sides are mintable mocks, so a deep, realistically-priced pool costs
///      no native KASH at all. Routes to and from KASH go through the existing
///      WKASH/mUSDC pool via multi-hop, which the Router already supports and
///      which is exercised on-chain in the smoke test.
///
///      Decimals are deliberately varied — 8 for mWBTC, 18 for the rest, 6 for
///      the existing stablecoins — so the decimal handling in the frontend and
///      the indexer is exercised by real data rather than assumed.
contract PopulateMarkets is ArkScript {
    struct Market {
        string name;
        string symbol;
        uint8 decimals;
        // Whole units of the token to seed, and of mUSDC to pair against it.
        // The ratio sets the initial price (llm.txt s32).
        uint256 tokenUnits;
        uint256 usdcUnits;
    }

    function run() external {
        _assertArkChain();

        address router = _requireAddress('ARKSWAP_ROUTER_ADDRESS');
        address factory = _requireAddress('ARKSWAP_FACTORY_ADDRESS');
        address musdc = _requireAddress('MOCK_USDC_ADDRESS');

        _requireCode(router, 'ARKSWAP_ROUTER_ADDRESS');
        _requireCode(musdc, 'MOCK_USDC_ADDRESS');

        Market[4] memory markets = [
            //          name                       symbol    dp  token     mUSDC
            Market('Mock Wrapped Ether (Ark Devnet)', 'mWETH', 18, 10, 30_000),
            Market('Mock Wrapped Bitcoin (Ark Devnet)', 'mWBTC', 8, 1, 65_000),
            Market('Mock Dai (Ark Devnet)', 'mDAI', 18, 50_000, 50_000),
            Market('Mock Chainlink (Ark Devnet)', 'mLINK', 18, 2_000, 30_000)
        ];

        for (uint256 i = 0; i < markets.length; i++) {
            _deployAndSeed(router, factory, musdc, markets[i]);
        }

        console2.log('total pairs now', IFactoryOps(factory).allPairsLength());
    }

    function _deployAndSeed(address router, address factory, address musdc, Market memory m) internal {
        _startBroadcast();

        address token = deployCode(
            'MockERC20.sol:MockERC20', abi.encode(m.name, m.symbol, m.decimals, uint256(0))
        );

        uint256 tokenAmount = m.tokenUnits * (10 ** m.decimals);
        uint256 usdcAmount = m.usdcUnits * 1e6;

        ITokenOps(token).mint(_deployer(), tokenAmount);
        ITokenOps(musdc).mint(_deployer(), usdcAmount);
        ITokenOps(token).approve(router, tokenAmount);
        ITokenOps(musdc).approve(router, usdcAmount);

        IRouterOps(router).addLiquidity(
            token, musdc, tokenAmount, usdcAmount, 0, 0, _deployer(), block.timestamp + 20 minutes
        );

        vm.stopBroadcast();

        console2.log('---');
        console2.log(m.symbol);
        console2.log('  address ', token);
        console2.log('  decimals', m.decimals);
        console2.log('  pair    ', IFactoryOps(factory).getPair(token, musdc));
        console2.log('  price   ', m.usdcUnits / m.tokenUnits);
    }
}
