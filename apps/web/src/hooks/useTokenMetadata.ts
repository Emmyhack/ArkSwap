'use client';

import {type Address, isAddress} from 'viem';
import {useReadContracts} from 'wagmi';

import {erc20Abi} from '@/config/abis';

export type TokenMetadata = {address: Address; name: string; symbol: string; decimals: number};

/**
 * Reads an ERC-20's name, symbol and decimals straight from the contract.
 *
 * Used by the token importer. The read is the whole review: nothing about the
 * contract's behaviour is checked, which is why an imported token is badged
 * "unverified" everywhere it appears.
 */
export function useTokenMetadata(candidate: string) {
  const address = isAddress(candidate) ? (candidate as Address) : undefined;

  const query = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          {address, abi: erc20Abi, functionName: 'name' as const},
          {address, abi: erc20Abi, functionName: 'symbol' as const},
          {address, abi: erc20Abi, functionName: 'decimals' as const},
        ]
      : [],
    query: {enabled: Boolean(address), staleTime: 60_000, retry: 0},
  });

  let metadata: TokenMetadata | undefined;
  if (address && query.data) {
    const name = query.data[0]?.result as string | undefined;
    const symbol = query.data[1]?.result as string | undefined;
    const decimals = query.data[2]?.result as number | undefined;
    // A contract that cannot answer decimals() is not something the swap form
    // can scale amounts for, so it is treated as "not a token" here.
    if (typeof decimals === 'number') {
      metadata = {
        address,
        name: name && name.length > 0 ? name : 'Unknown token',
        symbol: symbol && symbol.length > 0 ? symbol : 'UNKNOWN',
        decimals,
      };
    }
  }

  return {
    address,
    metadata,
    isLoading: Boolean(address) && query.isLoading,
    notAToken: Boolean(address) && query.isFetched && !metadata,
  };
}
