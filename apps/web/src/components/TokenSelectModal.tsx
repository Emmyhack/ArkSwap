'use client';

import {useEffect, useMemo, useState} from 'react';

import {COMMON_TOKENS, TOKEN_LIST, type Token, sameToken, tokenKey} from '@/config/tokens';
import {shortenAddress} from '@/lib/format';

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOKEN_LIST;
    return TOKEN_LIST.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        (t.address ?? '').toLowerCase().includes(q),
    );
  }, [query]);

  const searching = query.trim().length > 0;

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
            placeholder="Search tokens"
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

        {results.length === 0 ? (
          <div className="token-list__empty">
            <p>No token matches “{query}”.</p>
            <p>ArkSwap only lists reviewed tokens; arbitrary addresses are not accepted here.</p>
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
                  <li key={tokenKey(token)}>
                    <button type="button" disabled={disabled} onClick={() => onSelect(token)}>
                      <TokenIcon token={token} size={36} />
                      <span className="token-list__text">
                        <span className="token-list__name">{token.name}</span>
                        <span className="token-list__meta">
                          <span>{token.symbol}</span>
                          {token.address && (
                            <span className="token-list__addr">{shortenAddress(token.address)}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
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
