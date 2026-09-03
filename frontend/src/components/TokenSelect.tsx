'use client';

import {useState} from 'react';

import {TOKEN_LIST, type Token, sameToken, tokenKey} from '@/config/tokens';

export function TokenSelect({
  value,
  exclude,
  onChange,
}: {
  value: Token;
  exclude?: Token;
  onChange: (token: Token) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="token-button" onClick={() => setOpen(true)} type="button">
        {value.symbol}
        <span aria-hidden style={{color: 'var(--muted)', fontSize: 11}}>▼</span>
      </button>

      {open && (
        <div className="modal" onClick={() => setOpen(false)} role="presentation">
          <div className="modal__body" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">Select a token</h2>
                <button className="settings__chip" onClick={() => setOpen(false)} type="button">
                  Close
                </button>
              </div>
              <ul className="token-list">
                {TOKEN_LIST.map((token) => {
                  const disabled = exclude ? sameToken(token, exclude) : false;
                  return (
                    <li key={tokenKey(token)}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onChange(token);
                          setOpen(false);
                        }}
                      >
                        <div style={{flex: 1}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                            <strong>{token.symbol}</strong>
                            {token.isDevnetMock && <span className="badge badge--devnet">devnet</span>}
                          </div>
                          <div className="token-list__meta">
                            {token.name}
                            {token.warning ? ` · ${token.warning}` : ''}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="muted" style={{fontSize: 12, marginBottom: 0, lineHeight: 1.6}}>
                Native KASH and WKASH are distinct assets. Selecting one never substitutes the other.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
