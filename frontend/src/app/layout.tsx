import type {Metadata} from 'next';

import {Nav} from '@/components/Nav';
import {Orbs} from '@/components/Orbs';

import {Providers} from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArkSwap',
  description: 'Swap and provide liquidity on Ark Constellation.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
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
