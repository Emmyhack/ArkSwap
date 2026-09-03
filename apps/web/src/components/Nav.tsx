'use client';

import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {useEffect, useState} from 'react';

import type {Token} from '@/config/tokens';
import {useSwapTokens} from '@/state/swap';

import {ConnectButton} from './ConnectButton';
import {TokenSelectModal} from './TokenSelectModal';

const LINKS = [
  {href: '/swap', label: 'Trade'},
  {href: '/pool', label: 'Pool'},
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const {setTokenOut, tokenIn} = useSwapTokens();
  const [searchOpen, setSearchOpen] = useState(false);

  // "/" focuses search, matching the shortcut the reference layout advertises.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pick(token: Token) {
    setTokenOut(token);
    setSearchOpen(false);
    router.push('/swap');
  }

  return (
    <>
      <nav className="nav">
        <Link href="/swap" className="nav__brand">
          <span className="nav__mark" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 32 32" fill="none">
              <path d="M16 5 L26 27 H20 L16 18 L12 27 H6 Z" fill="white" />
            </svg>
          </span>
          ArkSwap
        </Link>

        <div className="nav__links">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="nav__link"
              data-active={pathname?.startsWith(link.href) ?? false}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="nav__spacer" />

        <button className="nav__search" onClick={() => setSearchOpen(true)} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Search tokens
          <kbd>/</kbd>
        </button>

        <div className="nav__spacer" />

        <ConnectButton />
      </nav>

      {searchOpen && (
        <TokenSelectModal
          title="Search tokens"
          exclude={tokenIn}
          onClose={() => setSearchOpen(false)}
          onSelect={pick}
        />
      )}
    </>
  );
}
