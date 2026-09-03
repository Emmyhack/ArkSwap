'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';

import {ConnectButton} from './ConnectButton';

const LINKS = [
  {href: '/swap', label: 'Swap'},
  {href: '/pool', label: 'Pool'},
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <span className="nav__brand">ArkSwap</span>
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
      <ConnectButton />
    </nav>
  );
}
