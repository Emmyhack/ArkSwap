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
        className="btn-connect"
        disabled={!connector || isPending}
        onClick={() => connector && connect({connector})}
        type="button"
      >
        {isPending ? 'Connecting…' : 'Connect'}
      </button>
    );
  }

  // Wrong network is a hard stop: the same address on another chain is an
  // unrelated contract, so we never let a swap be sent from one.
  if (chainId !== ARK_CHAIN_ID) {
    return (
      <button className="btn-connect btn-connect--warn" onClick={() => switchChain({chainId: ARK_CHAIN_ID})} type="button">
        Wrong network
      </button>
    );
  }

  return (
    <button className="btn-connect" onClick={() => disconnect()} type="button">
      {address ? shortenAddress(address) : 'Connected'}
    </button>
  );
}
