'use client';

import {useAccount, useBalance, useReadContract} from 'wagmi';

import {erc20Abi} from '@/config/abis';
import type {Token} from '@/config/tokens';

/** Balance of a token, handling native KASH and ERC-20s uniformly. */
export function useTokenBalance(token: Token | undefined) {
  const {address} = useAccount();

  const native = useBalance({
    address,
    query: {enabled: Boolean(address && token?.isNative), refetchInterval: 12_000},
  });

  const erc20 = useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {enabled: Boolean(address && token && !token.isNative), refetchInterval: 12_000},
  });

  if (!token || !address) {
    return {value: undefined as bigint | undefined, isLoading: false, refetch: () => {}};
  }
  if (token.isNative) return {value: native.data?.value, isLoading: native.isLoading, refetch: native.refetch};
  return {value: erc20.data as bigint | undefined, isLoading: erc20.isLoading, refetch: erc20.refetch};
}
