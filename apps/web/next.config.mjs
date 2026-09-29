/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The @arkswap/* workspace packages ship TypeScript source rather than a build
  // step, so Next must compile them. This is also what lets the generated ABIs
  // and the deployment manifest be imported directly with no duplication.
  transpilePackages: [
    '@arkswap/abis',
    '@arkswap/addresses',
    '@arkswap/config',
    '@arkswap/sdk',
    '@arkswap/types',
  ],
  webpack: (config) => {
    // `wagmi/connectors` is a barrel that also pulls in the Base Account
    // connector, whose dependency chain (@base-org/account -> @coinbase/cdp-sdk
    // -> @x402/*) references packages that are not installed. ArkSwap never
    // instantiates that connector, so its SDK is stubbed to an empty module
    // rather than letting one unused import break the WalletConnect connector
    // we do use.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@base-org/account': false,
      // Optional peers of the MetaMask and WalletConnect SDKs that only matter
      // in React Native / Node logging. Stubbing them keeps the build quiet.
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
};

export default nextConfig;
