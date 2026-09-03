'use client';

import type {Token} from '@/config/tokens';
import {formatAmount} from '@/lib/format';

import {TokenSelect} from './TokenSelect';

export function AmountField({
  label,
  token,
  exclude,
  value,
  balance,
  readOnly,
  onValueChange,
  onTokenChange,
}: {
  label: string;
  token: Token;
  exclude?: Token;
  value: string;
  balance?: bigint;
  readOnly?: boolean;
  onValueChange?: (value: string) => void;
  onTokenChange: (token: Token) => void;
}) {
  return (
    <div className="field">
      <div className="field__top">
        <span>{label}</span>
        {balance !== undefined && (
          <button
            type="button"
            className="muted"
            style={{background: 'none', border: 'none', cursor: readOnly ? 'default' : 'pointer', padding: 0, font: 'inherit'}}
            onClick={() => {
              if (!readOnly && onValueChange) {
                // Deliberately not a true "max" for native KASH: gas must be left over.
                onValueChange(formatAmount(balance, token.decimals, token.decimals));
              }
            }}
          >
            Balance: {formatAmount(balance, token.decimals)}
          </button>
        )}
      </div>
      <div className="field__row">
        <input
          className="field__input mono"
          inputMode="decimal"
          placeholder="0"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onValueChange?.(e.target.value)}
        />
        <TokenSelect value={token} exclude={exclude} onChange={onTokenChange} />
      </div>
      {token.isDevnetMock && (
        <div className="field__top" style={{marginTop: 8, marginBottom: 0}}>
          <span className="badge badge--devnet">devnet test token — no real value</span>
        </div>
      )}
    </div>
  );
}
