'use client';

import {useEffect, useMemo, useState} from 'react';
import {isAddress} from 'viem';

import {explorerAddressUrl} from '@/config/chain';
import {COMMON_TOKENS, type Token, sameToken, tokenKey} from '@/config/tokens';
import {useTokenMetadata} from '@/hooks/useTokenMetadata';
import {shortenAddress} from '@/lib/format';
import {IMPORTED_WARNING, useTokens} from '@/state/tokens';

import {AddToWallet} from './AddToWallet';
import {Skeleton} from './Skeleton';
import {TokenIcon} from './TokenIcon';

/**
 * Shared token picker. Used by the amount fields and by the nav search, so the
 * search box is a real filter over the registry rather than decoration.
 *
 * The registry is an explicit allowlist; matching on address as well as
 * symbol/name lets a user confirm they are picking the token they mean, which
 * is the main defence against look-alike symbols (llm.txt s48). Devnet fixtures
 * carry their nature in the name the manifest gives them — "Mock USD Coin (Ark
 * Devnet)" — and the amount field still badges them once selected (s15).
 *
 * Pasting an address that is not listed offers to import it. The import reads
 * name, symbol and decimals from the contract and nothing more; the token is
 * badged "unverified" everywhere and can be removed from this list again.
 */
export function TokenSelectModal({
  exclude,
  onSelect,
  onClose,
  title = 'Select a token',
}: {
  exclude?: Token;
  onSelect: (token: Token) => void;
  onClose: () => void;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const {tokens, importToken, removeToken} = useTokens();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        (t.address ?? '').toLowerCase().includes(q),
    );
  }, [query, tokens]);

  const searching = query.trim().length > 0;
  const pastedAddress = isAddress(query.trim()) && results.length === 0;
  const candidate = useTokenMetadata(pastedAddress ? query.trim() : '');

  return (
    <div className="modal" onClick={onClose} role="presentation">
      <div
        className="modal__body modal__body--token"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" onClick={onClose} type="button" aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="modal__search">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol or paste an address"
            aria-label="Search name, symbol or address"
          />
        </div>

        {!searching && COMMON_TOKENS.length > 0 && (
          <div className="token-quick">
            {COMMON_TOKENS.map((token) => {
              const disabled = exclude ? sameToken(token, exclude) : false;
              return (
                <button
                  key={tokenKey(token)}
                  className="token-quick__chip"
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(token)}
                >
                  <TokenIcon token={token} size={28} />
                  <span>{token.symbol}</span>
                </button>
              );
            })}
          </div>
        )}

        {pastedAddress ? (
          <div className="import">
            {candidate.isLoading && (
              <div className="import__card">
                <Skeleton width={36} height={36} style={{borderRadius: 18}} />
                <span className="token-list__text">
                  <Skeleton width={140} height={16} />
                  <br />
                  <Skeleton width={90} height={12} style={{marginTop: 6}} />
                </span>
              </div>
            )}
            {candidate.notAToken && (
              <div className="token-list__empty">
                <p>Nothing at {shortenAddress(query.trim())} answers like an ERC-20.</p>
                <p>Check the address on the explorer before trying again.</p>
              </div>
            )}
            {candidate.metadata && (
              <>
                <div className="import__card">
                  <TokenIcon
                    token={{address: candidate.metadata.address, symbol: candidate.metadata.symbol, name: candidate.metadata.name, decimals: candidate.metadata.decimals}}
                    size={36}
                  />
                  <span className="token-list__text">
                    <span className="token-list__name">{candidate.metadata.name}</span>
                    <span className="token-list__meta">
                      <span>{candidate.metadata.symbol}</span>
                      <span className="token-list__addr">{shortenAddress(candidate.metadata.address)}</span>
                      <span>{candidate.metadata.decimals} decimals</span>
                    </span>
                  </span>
                  {explorerAddressUrl(candidate.metadata.address) && (
                    <a href={explorerAddressUrl(candidate.metadata.address)} target="_blank" rel="noreferrer">
                      Explorer ↗
                    </a>
                  )}
                </div>
                <div className="alert alert--warn" style={{margin: '10px 20px 0'}}>
                  This token is not on ArkSwap&apos;s reviewed list. Anyone can deploy a token with any name or
                  symbol; confirm the address against a source you trust before trading it.
                </div>
                <div style={{padding: '12px 20px 4px'}}>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    style={{marginTop: 0}}
                    onClick={() => {
                      const token = importToken(candidate.metadata!);
                      onSelect(token);
                    }}
                  >
                    Import {candidate.metadata.symbol}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : results.length === 0 ? (
          <div className="token-list__empty">
            <p>No token matches “{query}”.</p>
            <p>Paste a contract address to import a token that is not on the reviewed list.</p>
          </div>
        ) : (
          <>
            <div className="token-list__label">
              {!searching && <TrendIcon />}
              {searching ? 'Search results' : 'All tokens'}
            </div>
            <ul className="token-list">
              {results.map((token) => {
                const disabled = exclude ? sameToken(token, exclude) : false;
                return (
                  <li key={tokenKey(token)} className="token-list__item">
                    <button type="button" disabled={disabled} onClick={() => onSelect(token)}>
                      <TokenIcon token={token} size={36} />
                      <span className="token-list__text">
                        <span className="token-list__name">
                          {token.name}
                          {token.isImported && <span className="badge badge--warn" style={{marginLeft: 8}}>unverified</span>}
                        </span>
                        <span className="token-list__meta">
                          <span>{token.symbol}</span>
                          {token.address && (
                            <span className="token-list__addr">{shortenAddress(token.address)}</span>
                          )}
                        </span>
                      </span>
                    </button>
                    <span className="token-list__actions">
                      <AddToWallet token={token} compact />
                      {token.isImported && token.address && (
                        <button
                          type="button"
                          className="icon-btn icon-btn--sm"
                          title={`Remove ${token.symbol} from your list`}
                          aria-label={`Remove ${token.symbol} from your list`}
                          onClick={() => removeToken(token.address!)}
                        >
                          <CloseIcon size={13} />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {results.some((t) => t.isImported) && (
              <div className="token-list__note">{IMPORTED_WARNING}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="modal__search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13.6 13.6L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon({size = 18}: {size?: number}) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M5 5L15 15M15 5L5 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M3 13.5L7.5 9L10.5 12L17 5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 5.5H17V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
