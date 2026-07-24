const { override } = require('customize-cra');
const path = require('path');

/**
 * Webpack overrides for UPL frontend.
 *
 * Splitting strategy (DO NOT revert to `chunks: 'all'` + small maxSize —
 * that shattered the initial bundle into ~150 sub-2KB chunks and created a
 * request waterfall on first paint. See session notes 2026-07-24):
 *
 *  - Heavy libraries loaded via dynamic import (ethers-lazy, solana,
 *    walletconnect, crypto) are split into NAMED ASYNC chunks only. They are
 *    fetched on demand and never appear in the initial index.html.
 *  - Initial vendors (react, react-dom, UI libs, http libs, everything else
 *    in node_modules) bundle together at webpack's default maxSize (244KB).
 *    First paint stays a small handful of requests instead of ~160.
 *
 * The `@` -> `src` path alias is also wired here (used by 94 source files).
 */
module.exports = override(
  (config) => {
    // Path alias @ -> src
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname, 'src'),
    };

    config.optimization = config.optimization || {};

    // Only split ASYNC chunks by default; initial bundle stays mostly intact.
    // maxSize 244000 = webpack default — prevents micro-fragmentation.
    config.optimization.splitChunks = {
      chunks: 'async',
      minSize: 20000,
      maxSize: 244000,
      cacheGroups: {
        default: {
          minChunks: 2,
          priority: -20,
          reuseExistingChunk: true,
        },
        // ---- Lazy-loaded heavy libs (async only) ----
        ethers: {
          test: /[\\/]node_modules[\\/]ethers[\\/]/,
          name: 'ethers',
          chunks: 'async',
          priority: 30,
          enforce: true,
        },
        solana: {
          test: /[\\/]node_modules[\\/]@solana[\\/]/,
          name: 'solana',
          chunks: 'async',
          priority: 25,
          enforce: true,
        },
        walletconnect: {
          test: /[\\/]node_modules[\\/]@walletconnect[\\/]/,
          name: 'walletconnect',
          chunks: 'async',
          priority: 25,
          enforce: true,
        },
        crypto: {
          test: /[\\/]node_modules[\\/](bn\.js|elliptic|secp256k1|crypto-js)[\\/]/,
          name: 'crypto-libs',
          chunks: 'async',
          priority: 25,
          enforce: true,
        },
      },
    };

    config.optimization.runtimeChunk = 'single';
    config.optimization.minimize = true;

    return config;
  }
);
