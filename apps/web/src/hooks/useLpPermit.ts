'use client';

import {useState} from 'react';
import type {Address} from 'viem';
import {useAccount, useReadContracts, useSignTypedData} from 'wagmi';

import {pairAbi} from '@/config/abis';
import {ARK_CHAIN_ID} from '@/config/chain';
import {ARKSWAP_ROUTER_ADDRESS} from '@/config/contracts';
import {type SplitSignature, permitTypedData, splitSignature} from '@/lib/permit';

/**
 * Signs an EIP-2612 permit authorising the router to spend `value` LP tokens
 * of `pair`. The nonce and the domain name are read from the pair so the
 * signature can never be built against stale assumptions.
 */
export function useLpPermit(pair: Address | undefined) {
  const {address} = useAccount();
  const {signTypedDataAsync, isPending} = useSignTypedData();
  const [error, setError] = useState<Error | undefined>();

  const reads = useReadContracts({
    allowFailure: true,
    contracts:
      pair && address
        ? [
            {address: pair, abi: pairAbi, functionName: 'nonces' as const, args: [address]},
            {address: pair, abi: pairAbi, functionName: 'name' as const},
          ]
        : [],
    query: {enabled: Boolean(pair && address), refetchInterval: 15_000},
  });

  const nonce = reads.data?.[0]?.result as bigint | undefined;
  const name = reads.data?.[1]?.result as string | undefined;
  const ready = Boolean(pair && address && ARKSWAP_ROUTER_ADDRESS && nonce !== undefined && name);

  async function sign(value: bigint, deadline: bigint): Promise<SplitSignature | undefined> {
    if (!pair || !address || !ARKSWAP_ROUTER_ADDRESS || nonce === undefined || !name) return undefined;
    setError(undefined);
    try {
      const signature = await signTypedDataAsync(
        permitTypedData({
          chainId: ARK_CHAIN_ID,
          pair,
          name,
          owner: address,
          spender: ARKSWAP_ROUTER_ADDRESS,
          value,
          nonce,
          deadline,
        }),
      );
      return splitSignature(signature);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      return undefined;
    }
  }

  return {sign, ready, isSigning: isPending, error, refetchNonce: reads.refetch};
}
