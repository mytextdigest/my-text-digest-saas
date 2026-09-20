/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      canvas: './src/lib/canvas-empty.js',
    },
  },
  // @resvg/resvg-wasm ships wasm-bindgen-generated glue code that neither
  // webpack nor Turbopack bundle cleanly (its loader dynamically imports an
  // internal "wbg" namespace the bundler can't resolve) — same category of
  // issue as sharp/canvas, so it's excluded from bundling and loaded via a
  // plain `require`/`import` at runtime instead, same as this repo already
  // does for other native/wasm-touching server-only packages.
  serverExternalPackages: ["@resvg/resvg-wasm"],
  images: {
    unoptimized: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
