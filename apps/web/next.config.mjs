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
};

export default nextConfig;
