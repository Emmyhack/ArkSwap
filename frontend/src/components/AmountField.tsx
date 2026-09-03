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
  hint,
  onValueChange,
  onTokenChange,
}: {
  label: string;
  token: Token;
  exclude?: Token;
  value: string;
  balance?: bigint;
  readOnly?: boolean;
  hint?: string;
  onValueChange?: (value: string) => void;
  onTokenChange: (token: Token) => void;
}) {
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      <div className="field__row">
        <input
          className="field__input mono"
          inputMode="decimal"
          placeholder="0"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onValueChange?.(e.target.value)}
          aria-label={label}
        />
        <TokenSelect value={token} exclude={exclude} onChange={onTokenChange} />
      </div>
      <div className="field__foot">
        <span>
          {token.isDevnetMock && <span className="badge badge--devnet">devnet · no real value</span>}
          {hint && !token.isDevnetMock && hint}
        </span>
        {balance !== undefined && (
          <span>
            Balance: {formatAmount(balance, token.decimals)}
            {!readOnly && onValueChange && (
              <>
                {' '}
                <button
                  type="button"
                  className="field__max"
                  onClick={() =>
                    // Native KASH deliberately fills only 99%, leaving gas behind.
                    onValueChange(
                      formatAmount(
                        token.isNative ? (balance * 99n) / 100n : balance,
                        token.decimals,
                        token.decimals,
                      ),
                    )
                  }
                >
                  Max
                </button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
