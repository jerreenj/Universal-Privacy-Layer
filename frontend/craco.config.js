// craco.config.js
const path = require("path");

const isDevServer = process.env.NODE_ENV !== "production";

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    configure: (webpackConfig) => {
      webpackConfig.resolve = webpackConfig.resolve || {};
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        buffer: require.resolve("buffer/"),
        stream: false,
        crypto: false,
        path: false,
        fs: false,
      };

      // Bundle optimization: split heavy crypto/blockchain libraries into
      // separate chunks to reduce main bundle size and break up the 2.9MB
      // monster chunk (8326). Each library gets its own chunk for better
      // caching and loading performance.
      webpackConfig.optimization = webpackConfig.optimization || {};
      webpackConfig.optimization.splitChunks = {
        ...webpackConfig.optimization.splitChunks,
        chunks: "all",
        cacheGroups: {
          ...webpackConfig.optimization.splitChunks?.cacheGroups,
          // Split ethers into its own chunk (~500KB)
          ethers: {
            test: /[\\/]node_modules[\\/](ethers|@ethersproject)/,
            name: "ethers",
            priority: 20,
          },
          // Split WalletConnect into its own chunk (~400KB)
          walletconnect: {
            test: /[\\/]node_modules[\\/]@walletconnect/,
            name: "walletconnect",
            priority: 20,
          },
          // Split Solana web3.js into its own chunk (~600KB)
          solana: {
            test: /[\\/]node_modules[\\/]@solana/,
            name: "solana",
            priority: 20,
          },
          // Split Sui SDK into its own chunk (~800KB)
          sui: {
            test: /[\\/]node_modules[\\/]@mysten/,
            name: "sui",
            priority: 20,
          },
          // Split ZK libraries (snarkjs + circomlibjs) (~550KB combined)
          zk: {
            test: /[\\/]node_modules[\\/](snarkjs|circomlibjs)/,
            name: "zk",
            priority: 20,
          },
          // Keep default vendor chunk for other libraries
          defaultVendors: {
            test: /[\\/]node_modules[\\/]/,
            name: "vendors",
            priority: 10,
          },
        },
      };

      const webpack = require("webpack");
      webpackConfig.plugins = webpackConfig.plugins || [];
      webpackConfig.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: "process/browser.js",
        })
      );

      webpackConfig.watchOptions = {
        ...webpackConfig.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/build/**"],
      };

      return webpackConfig;
    },
  },
};

// Dev-only visual editing plugin — skipped silently in production/Vercel
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco"); // eslint-disable-line
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code !== "MODULE_NOT_FOUND") throw err;
  }
}

module.exports = webpackConfig;
