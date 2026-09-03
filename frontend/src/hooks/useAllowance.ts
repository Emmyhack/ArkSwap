'use client';

import {maxUint256} from 'viem';
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from 'wagmi';

import {erc20Abi} from '@/config/abis';
import {ARKSWAP_ROUTER_ADDRESS} from '@/config/contracts';
import type {Token} from '@/config/tokens';

/**
 * ERC-20 approval flow for the router (llm.txt s44).
 *
 * Native KASH needs no approval. Approval is requested for the exact amount by
 * default rather than an unlimited allowance, so a future router compromise
 * cannot drain more than the user intended for this trade.
 */
export function useAllowance(token: Token | undefined, amount: bigint | undefined) {
  const {address} = useAccount();
  const needsErc20 = Boolean(token && !token.isNative && token.address && ARKSWAP_ROUTER_ADDRESS);

  const allowance = useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && ARKSWAP_ROUTER_ADDRESS ? [address, ARKSWAP_ROUTER_ADDRESS] : undefined,
    query: {enabled: Boolean(needsErc20 && address), refetchInterval: 12_000},
  });

  const {writeContract, data: hash, isPending, reset} = useWriteContract();
  const receipt = useWaitForTransactionReceipt({hash});

  const current = (allowance.data as bigint | undefined) ?? 0n;
  const needsApproval = Boolean(needsErc20 && amount !== undefined && amount > 0n && current < amount);

  function approve(exact = true) {
    if (!token?.address || !ARKSWAP_ROUTER_ADDRESS || amount === undefined) return;
    writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ARKSWAP_ROUTER_ADDRESS, exact ? amount : maxUint256],
    });
  }

  return {
    allowance: current,
    needsApproval,
    approve,
    isApproving: isPending || receipt.isLoading,
    approvalConfirmed: receipt.isSuccess,
    refetchAllowance: allowance.refetch,
    reset,
  };
}
