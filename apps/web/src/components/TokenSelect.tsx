'use client';

import {useState} from 'react';

import type {Token} from '@/config/tokens';

import {TokenIcon} from './TokenIcon';
import {TokenSelectModal} from './TokenSelectModal';

export function TokenSelect({
  value,
  exclude,
  onChange,
}: {
  value?: Token;
  exclude?: Token;
  onChange: (token: Token) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={value ? 'token-pill' : 'token-pill token-pill--empty'}
        onClick={() => setOpen(true)}
        type="button"
      >
        {value && <TokenIcon token={value} />}
        {value ? value.symbol : 'Select token'}
        <span className="token-pill__chev" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <TokenSelectModal
          exclude={exclude}
          onClose={() => setOpen(false)}
          onSelect={(t) => {
            onChange(t);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
