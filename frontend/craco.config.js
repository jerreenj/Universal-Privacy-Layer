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
