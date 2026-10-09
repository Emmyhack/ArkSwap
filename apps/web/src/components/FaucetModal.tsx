'use client';

import {useEffect} from 'react';
import {useAccount, useWriteContract} from 'wagmi';

import {ARK_CHAIN_ID} from '@/config/chain';
import {FAUCET_ENABLED, FAUCET_UNITS, mockFaucetAbi} from '@/config/devnet';
import {DEVNET_MOCK_TOKENS, type Token} from '@/config/tokens';
import {useTokenBalance} from '@/hooks/useTokenBalance';
import {formatAmount} from '@/lib/format';
import {useActivity} from '@/state/activity';

import {AddToWallet} from './AddToWallet';
import {TokenIcon} from './TokenIcon';

/**
 * Devnet faucet for the mock tokens.
 *
 * MockERC20.mint is unrestricted on Ark devnet, so anyone can top up test
 * balances. This surface exists only when the app is pointed at the devnet
 * chain; the mocks have no value anywhere (llm.txt s15).
 */
export function FaucetModal({onClose}: {onClose: () => void}) {
  const {isConnected, chainId} = useAccount();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const wrongChain = isConnected && chainId !== ARK_CHAIN_ID;

  return (
    <div className="modal" onClick={onClose} role="presentation">
      <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Devnet faucet">
        <div className="modal__head">
          <h2>Devnet faucet</h2>
          <button className="modal__close" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </div>
        <div className="card__pad" style={{paddingTop: 0}}>
          <p className="muted" style={{margin: '0 0 12px', fontSize: 14, lineHeight: 1.55}}>
            Mint test tokens straight from their contracts. These are devnet fixtures with no value; KASH for gas
            comes from the Ark devnet faucet, not from here.
          </p>
          {!FAUCET_ENABLED && <div className="alert alert--info">The faucet is only available on Ark devnet.</div>}
          {!isConnected && <div className="alert alert--info">Connect a wallet to mint.</div>}
          {wrongChain && <div className="alert alert--warn">Switch your wallet to Ark devnet first.</div>}
        </div>
        <ul className="token-list" style={{maxHeight: 360, paddingBottom: 8}}>
          {DEVNET_MOCK_TOKENS.map((t) => (
            <FaucetRow key={t.address} token={t} disabled={!FAUCET_ENABLED || !isConnected || wrongChain} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function FaucetRow({token, disabled}: {token: Token; disabled: boolean}) {
  const {address} = useAccount();
  const {track} = useActivity();
  const balance = useTokenBalance(token);
  const {writeContract, isPending, error} = useWriteContract();
  const amount = FAUCET_UNITS * 10n ** BigInt(token.decimals);

  function mint() {
    if (!address || !token.address) return;
    writeContract(
      {address: token.address, abi: mockFaucetAbi, functionName: 'mint', args: [address, amount]},
      {onSuccess: (hash) => track({hash, kind: 'mint', summary: `Mint ${FAUCET_UNITS.toString()} ${token.symbol}`})},
    );
  }

  return (
    <li className="faucet__row">
      <TokenIcon token={token} size={32} />
      <span className="token-list__text">
        <span className="token-list__name">{token.symbol}</span>
        <span className="token-list__meta">
          {balance.value !== undefined ? `Balance ${formatAmount(balance.value, token.decimals, 2)}` : token.name}
          {error && <span style={{color: 'var(--danger)'}}> · {error.message.slice(0, 60)}</span>}
        </span>
      </span>
      <AddToWallet token={token} compact />
      <button type="button" className="settings__chip" disabled={disabled || isPending} onClick={mint}>
        {isPending ? 'Minting…' : `Mint ${FAUCET_UNITS.toString()}`}
      </button>
    </li>
  );
}
