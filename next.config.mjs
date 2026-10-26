/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Turbo SDK loads its optional x402 peer only on demand; bundling it makes
  // the build try to resolve a package that is not installed. Node loads it
  // from node_modules instead.
  serverExternalPackages: ['@ardrive/turbo-sdk'],
};

export default nextConfig;
