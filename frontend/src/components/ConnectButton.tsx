'use client';

import {useAccount, useConnect, useDisconnect, useSwitchChain} from 'wagmi';

import {ARK_CHAIN_ID} from '@/config/chain';
import {shortenAddress} from '@/lib/format';

export function ConnectButton() {
  const {address, isConnected, chainId} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain} = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <button
        className="token-button"
        disabled={!connector || isPending}
        onClick={() => connector && connect({connector})}
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  // Wrong network is a hard stop: a swap sent to another chain would hit an
  // unrelated contract at the same address.
  if (chainId !== ARK_CHAIN_ID) {
    return (
      <button className="token-button" onClick={() => switchChain({chainId: ARK_CHAIN_ID})}>
        Switch to Ark Constellation
      </button>
    );
  }

  return (
    <button className="token-button" onClick={() => disconnect()}>
      {address ? shortenAddress(address) : 'Connected'}
    </button>
  );
}
