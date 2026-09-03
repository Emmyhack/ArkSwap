'use client';

import {useMemo, useState} from 'react';

import {TOKEN_LIST, type Token, sameToken, tokenKey} from '@/config/tokens';

import {TokenIcon} from './TokenIcon';

/**
 * Shared token picker. Used by the amount fields and by the nav search, so the
 * search box is a real filter over the registry rather than decoration.
 *
 * The registry is an explicit allowlist; matching on address as well as
 * symbol/name lets a user confirm they are picking the token they mean, which
 * is the main defence against look-alike symbols (llm.txt s48).
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

  return (
    <div className="modal" onClick={onClose} role="presentation">
      <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" onClick={onClose} type="button" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__search">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol or address"
            aria-label="Search tokens"
          />
        </div>

        {results.length === 0 ? (
          <div className="token-list__empty">
            No token matches “{query}”.
            <div style={{marginTop: 6, fontSize: 12.5}}>
              ArkSwap only lists reviewed tokens; arbitrary addresses are not accepted here.
            </div>
          </div>
        ) : (
          <ul className="token-list">
            {results.map((token) => {
              const disabled = exclude ? sameToken(token, exclude) : false;
              return (
                <li key={tokenKey(token)}>
                  <button type="button" disabled={disabled} onClick={() => onSelect(token)}>
                    <TokenIcon token={token} size={34} />
                    <span style={{flex: 1, minWidth: 0}}>
                      <span className="token-list__name">
                        {token.symbol}
                        {token.isDevnetMock && <span className="badge badge--devnet">devnet</span>}
                      </span>
                      <span className="token-list__meta">{token.name}</span>
                      {token.warning && (
                        <span className="token-list__meta" style={{color: 'var(--warn)'}}>
                          {token.warning}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="modal__note">
          Native KASH and WKASH are distinct assets. Selecting one never substitutes the other.
        </p>
      </div>
    </div>
  );
}
