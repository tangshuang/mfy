const path = require('path')

module.exports = {
  mode: 'production',
  entry:  path.resolve(__dirname, './src/index.js'),
  output: {
    path: __dirname,
    filename: 'index.js',
    library: 'MFY',
    libraryTarget: 'umd',
    globalObject: `typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : this`,
  },
  optimization: {
    usedExports: true,
    sideEffects: true,
  },
}
