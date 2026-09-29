import {ARK_DEVNET_CHAIN_ID} from '@arkswap/addresses';

import {ARK_CHAIN_ID} from './chain';

/**
 * Devnet-only faucet surface.
 *
 * The mock tokens on Ark devnet (MockERC20) expose an unrestricted
 * `mint(address,uint256)`. The shared ABI package deliberately excludes that
 * function so it can never leak into a production surface (see
 * scripts/generate-abis.mjs); the faucet therefore carries its own two-entry
 * fragment here, scoped to tokens the manifest flags `isDevnetMock` on the
 * devnet chain and nowhere else.
 */
export const mockFaucetAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'to', type: 'address'},
      {name: 'value', type: 'uint256'},
    ],
    outputs: [],
  },
] as const;

/** Whole units minted per faucet click. */
export const FAUCET_UNITS = 1_000n;

export const FAUCET_ENABLED = ARK_CHAIN_ID === ARK_DEVNET_CHAIN_ID;
