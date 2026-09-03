// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.24;

import {ArkScript} from "./ArkScript.sol";
import {console2} from "forge-std/Script.sol";

interface ITokenOps {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function mint(address, uint256) external;
}

interface IRouterSeed {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

interface IPairRead {
    function getReserves() external view returns (uint112, uint112, uint32);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Step 13: seed the WKASH/mUSDC pool (llm.txt s16, s32).
/// @dev Uses addLiquidityETH because KASH is Ark's native asset -- the `ETH` in the
///      name is inherited Uniswap V2 ABI terminology (llm.txt s12, s41).
///
///      SLIPPAGE: this script uses a configurable tolerance rather than zero
///      minimums. Zero minimums are acceptable ONLY for the very first deposit
///      into an empty pool, where the depositor sets the price (llm.txt s32, s43).
contract SeedLiquidity is ArkScript {
    struct Config {
        address router;
        address wkash;
        address musdc;
        address factory;
        address deployer;
        uint256 kashAmount;
        uint256 usdcAmount;
        uint256 minToken;
        uint256 minKash;
    }

    function run() external {
        Config memory c = _loadConfig();
        _seed(c);
        _seedSecondaryPools(c);
    }

    /// @dev Optional WKASH/mUSDT and mUSDC/mUSDT pools. The mUSDC/mUSDT pool is
    ///      what makes a multi-hop route testable (llm.txt s16, s34). Skipped
    ///      entirely when MOCK_USDT_ADDRESS is unset.
    function _seedSecondaryPools(Config memory c) internal {
        address musdt = vm.envOr("MOCK_USDT_ADDRESS", address(0));
        if (musdt == address(0)) {
            console2.log("MOCK_USDT_ADDRESS unset -- skipping secondary pools");
            return;
        }

        uint256 kashAmount = vm.envOr("SEED_KASH_AMOUNT_USDT", uint256(15 ether));
        uint256 usdtAmount = vm.envOr("SEED_MUSDT_AMOUNT", uint256(15e6));
        uint256 stableAmount = vm.envOr("SEED_STABLE_AMOUNT", uint256(50_000e6));

        require(
            c.deployer.balance >= kashAmount, "SeedLiquidity: insufficient native KASH for the secondary WKASH pool"
        );

        _startBroadcast();

        // WKASH / mUSDT
        ITokenOps(musdt).mint(c.deployer, usdtAmount);
        ITokenOps(musdt).approve(c.router, usdtAmount);
        (, uint256 kashUsed,) = IRouterSeed(c.router).addLiquidityETH{value: kashAmount}(
            musdt, usdtAmount, 0, 0, c.deployer, block.timestamp + 20 minutes
        );

        // mUSDC / mUSDT -- costs no native KASH, both sides are mintable mocks.
        ITokenOps(c.musdc).mint(c.deployer, stableAmount);
        ITokenOps(musdt).mint(c.deployer, stableAmount);
        ITokenOps(c.musdc).approve(c.router, stableAmount);
        ITokenOps(musdt).approve(c.router, stableAmount);
        IRouterSeed(c.router)
            .addLiquidity(c.musdc, musdt, stableAmount, stableAmount, 0, 0, c.deployer, block.timestamp + 20 minutes);

        vm.stopBroadcast();

        console2.log("WKASH/mUSDT seeded, KASH used", kashUsed);
        console2.log("mUSDC/mUSDT seeded, each side", stableAmount);
    }

    function _loadConfig() internal view returns (Config memory c) {
        _assertArkChain();

        c.router = _requireAddress("ARKSWAP_ROUTER_ADDRESS");
        c.wkash = _requireAddress("WKASH_ADDRESS");
        c.musdc = _requireAddress("MOCK_USDC_ADDRESS");
        c.factory = _requireAddress("ARKSWAP_FACTORY_ADDRESS");
        c.deployer = _deployer();

        _requireCode(c.router, "ARKSWAP_ROUTER_ADDRESS");
        _assertCanonicalWkash(c.wkash);

        // Devnet reference pricing: 1 KASH = 1 mUSDC (llm.txt s16). Arbitrary test value.
        c.kashAmount = vm.envOr("SEED_KASH_AMOUNT", uint256(10_000 ether));
        c.usdcAmount = vm.envOr("SEED_MUSDC_AMOUNT", uint256(10_000e6));

        require(c.deployer.balance >= c.kashAmount, "SeedLiquidity: deployer has insufficient native KASH");

        (c.minToken, c.minKash) = _minimums(c);
    }

    /// @dev Zero minimums are acceptable ONLY for the first deposit into an empty
    ///      pool, where the depositor alone sets the price. Every later deposit is
    ///      protected by SEED_SLIPPAGE_BPS (llm.txt s32, s43).
    function _minimums(Config memory c) internal view returns (uint256 minToken, uint256 minKash) {
        uint256 slippageBps = vm.envOr("SEED_SLIPPAGE_BPS", uint256(50)); // 0.50%
        (uint112 r0, uint112 r1,) = IPairRead(_pairOf(c.factory, c.wkash, c.musdc)).getReserves();

        if (r0 == 0 && r1 == 0) return (0, 0);
        minToken = (c.usdcAmount * (10_000 - slippageBps)) / 10_000;
        minKash = (c.kashAmount * (10_000 - slippageBps)) / 10_000;
    }

    function _seed(Config memory c) internal {
        _startBroadcast();

        if (ITokenOps(c.musdc).balanceOf(c.deployer) < c.usdcAmount) {
            // Devnet faucet mint. Never available on a canonical asset.
            ITokenOps(c.musdc).mint(c.deployer, c.usdcAmount);
        }
        ITokenOps(c.musdc).approve(c.router, c.usdcAmount);

        (uint256 amountToken, uint256 amountKash, uint256 liquidity) = IRouterSeed(c.router)
        .addLiquidityETH{value: c.kashAmount}(
            c.musdc, c.usdcAmount, c.minToken, c.minKash, c.deployer, block.timestamp + 20 minutes
        );

        vm.stopBroadcast();

        console2.log("seeded mUSDC", amountToken);
        console2.log("seeded KASH ", amountKash);
        console2.log("LP minted   ", liquidity);
    }

    function _pairOf(address factory, address a, address b) internal view returns (address p) {
        (bool ok, bytes memory data) = factory.staticcall(abi.encodeWithSignature("getPair(address,address)", a, b));
        require(ok, "SeedLiquidity: getPair failed");
        p = abi.decode(data, (address));
        require(p != address(0), "SeedLiquidity: pair does not exist -- run CreatePairs first");
    }
}
