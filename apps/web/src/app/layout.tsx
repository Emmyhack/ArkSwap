import type {Metadata, Viewport} from 'next';

import {Nav} from '@/components/Nav';
import {Orbs} from '@/components/Orbs';
import {THEME_BOOT_SCRIPT} from '@/config/theme';

import {Providers} from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArkSwap',
  description: 'Swap and provide liquidity on Ark Constellation.',
};

export const viewport: Viewport = {
  themeColor: [
    {media: '(prefers-color-scheme: dark)', color: '#050505'},
    {media: '(prefers-color-scheme: light)', color: '#ececec'},
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint; see state/theme.tsx. */}
        <script dangerouslySetInnerHTML={{__html: THEME_BOOT_SCRIPT}} />
      </head>
      <body>
        <Providers>
          <Orbs />
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
