const path = require('path');
module.exports = {
  mode: 'production',
  entry: {
    'circomlibjs.bundle': path.resolve(__dirname, 'node_modules/circomlibjs/build/main.cjs'),
  },
  output: {
    path: path.resolve(__dirname, 'public/zk-pool'),
    filename: '[name].js',
    library: 'circomlibjs',
    libraryTarget: 'umd',
    globalObject: 'this',
  },
  resolve: {
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      os: false,
      buffer: false,
      stream: false,
    },
  },
  experiments: {
    asyncWebAssembly: true,
  },
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
};
