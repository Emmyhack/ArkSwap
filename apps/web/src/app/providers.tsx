'use client';

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
import {WagmiProvider} from 'wagmi';

import {wagmiConfig} from '@/lib/wagmi';
import {ActivityProvider} from '@/state/activity';
import {PoolProvider} from '@/state/pool';
import {SettingsProvider} from '@/state/settings';
import {SwapProvider} from '@/state/swap';
import {ThemeProvider} from '@/state/theme';
import {TokensProvider} from '@/state/tokens';

export function Providers({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SettingsProvider>
            <TokensProvider>
              <ActivityProvider>
                <SwapProvider>
                  <PoolProvider>{children}</PoolProvider>
                </SwapProvider>
              </ActivityProvider>
            </TokensProvider>
          </SettingsProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
