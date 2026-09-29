import {type Address, type Hex, parseSignature} from 'viem';

/**
 * EIP-2612 permit for ArkSwap LP tokens.
 *
 * ArkSwapERC20 (the pair's token) implements `permit`, and the router exposes
 * `removeLiquidityWithPermit` / `removeLiquidityETHWithPermit`. Signing a permit
 * lets a user remove liquidity with one signature and one transaction instead of
 * an approval transaction followed by the removal.
 *
 * The domain name and the nonce are read from the pair itself rather than
 * assumed, so this stays correct if a deployment ever ships a pair with a
 * different name constant. Version is pinned to '1' by ArkSwapERC20.
 */
export const PERMIT_TYPES = {
  Permit: [
    {name: 'owner', type: 'address'},
    {name: 'spender', type: 'address'},
    {name: 'value', type: 'uint256'},
    {name: 'nonce', type: 'uint256'},
    {name: 'deadline', type: 'uint256'},
  ],
} as const;

export function permitTypedData(args: {
  chainId: number;
  pair: Address;
  name: string;
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: {
      name: args.name,
      version: '1',
      chainId: args.chainId,
      verifyingContract: args.pair,
    },
    types: PERMIT_TYPES,
    primaryType: 'Permit' as const,
    message: {
      owner: args.owner,
      spender: args.spender,
      value: args.value,
      nonce: args.nonce,
      deadline: args.deadline,
    },
  };
}

export type SplitSignature = {v: number; r: Hex; s: Hex};

/**
 * Splits a 65-byte signature into the (v, r, s) the router's permit functions
 * take. Some wallets return a bare y-parity instead of the legacy 27/28 `v`;
 * the pair's `ecrecover` needs the latter.
 */
export function splitSignature(signature: Hex): SplitSignature {
  const sig = parseSignature(signature);
  const v = sig.v !== undefined ? Number(sig.v) : sig.yParity === 1 ? 28 : 27;
  return {v, r: sig.r, s: sig.s};
}
