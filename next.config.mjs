/** @type {import('next').NextConfig} */
// Files named `*.dev.js` (e.g. src/app/dev/home-facts/page.dev.js) are routes
// only under `next dev`. A production build never sees them, so neither the
// route nor its fixture-filled client chunk exists in a deployment.
const developmentOnly = process.env.NODE_ENV !== 'production';

const nextConfig = {
  pageExtensions: developmentOnly ? ['dev.js', 'js', 'jsx', 'ts', 'tsx'] : ['js', 'jsx', 'ts', 'tsx'],
};

export default nextConfig;
