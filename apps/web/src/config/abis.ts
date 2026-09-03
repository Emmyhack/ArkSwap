/**
 * Contract ABIs.
 *
 * Re-exported from @arkswap/abis, which scripts/generate-abis.mjs generates from
 * the compiled Foundry artifacts. The web app keeps no hand-written ABI of its
 * own (llm.txt s6, s66, monorepo rules).
 *
 * NAMING: the router's `...ETH...` functions move native KASH. `ETH` is
 * inherited Uniswap V2 ABI terminology and must never be shown to users
 * (llm.txt s12, s41).
 */
export {
  arkSwapFactoryAbi as factoryAbi,
  arkSwapPairAbi as pairAbi,
  arkSwapRouter02Abi as routerAbi,
  erc20Abi,
} from '@arkswap/abis';
