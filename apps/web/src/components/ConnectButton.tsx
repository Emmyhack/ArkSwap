'use client';

import {useEffect, useRef, useState} from 'react';
import {type Connector, useAccount, useConnect, useDisconnect, useSwitchChain} from 'wagmi';

import {ARK_CHAIN_ID, explorerAddressUrl} from '@/config/chain';
import {shortenAddress} from '@/lib/format';

/**
 * Wallet connection.
 *
 * Every connector wagmi discovers is offered: injected wallets announced via
 * EIP-6963 appear by name, and WalletConnect appears when a project id is
 * configured. The generic "Injected" entry is hidden once a named wallet is
 * present, since it would be the same provider twice.
 */
export function ConnectButton() {
  const {address, isConnected, chainId, connector: active} = useAccount();
  const {connect, connectors, isPending, error, reset} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain, isPending: switching} = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  if (!isConnected) {
    // The generic "Injected" entry duplicates any wallet EIP-6963 already named;
    // keep it only when no named injected wallet was discovered.
    const hasNamedInjected = connectors.some((c) => c.type === 'injected' && c.id !== 'injected');
    const offered = hasNamedInjected ? connectors.filter((c) => c.id !== 'injected') : connectors;
    return (
      <>
        <button className="btn-connect" disabled={connectors.length === 0} onClick={() => setOpen(true)} type="button">
          {isPending ? 'Connecting…' : 'Connect'}
        </button>
        {open && (
          <div className="modal" onClick={() => setOpen(false)} role="presentation">
            <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connect a wallet">
              <div className="modal__head">
                <h2>Connect a wallet</h2>
                <button className="modal__close" onClick={() => setOpen(false)} type="button" aria-label="Close">
                  ×
                </button>
              </div>
              <div className="wallets">
                {offered.length === 0 && (
                  <div className="token-list__empty">
                    <p>No wallet found.</p>
                    <p>Install a browser wallet such as MetaMask, or configure WalletConnect to use a mobile wallet.</p>
                  </div>
                )}
                {offered.map((c) => (
                  <WalletRow
                    key={c.uid}
                    connector={c}
                    pending={isPending}
                    onPick={() => {
                      reset();
                      connect({connector: c});
                    }}
                  />
                ))}
                {error && <div className="alert alert--danger">{error.message.slice(0, 160)}</div>}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Wrong network is a hard stop: the same address on another chain is an
  // unrelated contract, so we never let a swap be sent from one.
  if (chainId !== ARK_CHAIN_ID) {
    return (
      <button
        className="btn-connect btn-connect--warn"
        onClick={() => switchChain({chainId: ARK_CHAIN_ID})}
        type="button"
        disabled={switching}
      >
        {switching ? 'Switching…' : 'Wrong network'}
      </button>
    );
  }

  const explorer = address ? explorerAddressUrl(address) : undefined;

  return (
    <div className="account" ref={menuRef}>
      <button className="btn-connect" onClick={() => setMenu((v) => !v)} type="button" aria-expanded={menu}>
        <span className="account__dot" aria-hidden />
        {address ? shortenAddress(address) : 'Connected'}
      </button>
      {menu && (
        <div className="popover popover--account" role="menu">
          <div className="popover__row">
            <span className="popover__label">
              {active?.name ?? 'Wallet'} · <span className="mono">{address && shortenAddress(address)}</span>
            </span>
            <div className="stack" style={{marginTop: 4}}>
              <button
                type="button"
                className="menu-btn"
                onClick={async () => {
                  if (!address) return;
                  try {
                    await navigator.clipboard.writeText(address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard blocked */
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy address'}
              </button>
              {explorer && (
                <a className="menu-btn" href={explorer} target="_blank" rel="noreferrer">
                  View on Blockscout ↗
                </a>
              )}
              <button
                type="button"
                className="menu-btn menu-btn--danger"
                onClick={() => {
                  disconnect();
                  setMenu(false);
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WalletRow({connector, pending, onPick}: {connector: Connector; pending: boolean; onPick: () => void}) {
  return (
    <button type="button" className="wallets__row" disabled={pending} onClick={onPick}>
      {connector.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={connector.icon} alt="" width={28} height={28} style={{borderRadius: 8}} />
      ) : (
        <span className="wallets__icon" aria-hidden>
          {connector.name.slice(0, 1)}
        </span>
      )}
      <span>{connector.name}</span>
      {connector.type === 'walletConnect' && <span className="badge">mobile</span>}
    </button>
  );
}
