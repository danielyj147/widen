/** @type {import('next').NextConfig} */
const nextConfig = {
  // @widen/core ships TypeScript source (no build step) — let Next transpile it.
  transpilePackages: ['@widen/core'],
  // The Firecrawl SDK is a Node library (undici/axios) — load it at runtime
  // instead of bundling it through webpack.
  serverExternalPackages: ['firecrawl'],
  webpack: (config) => {
    // core uses ESM-style ".js" specifiers that point at ".ts" sources; teach
    // webpack to resolve them.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
