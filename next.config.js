/** @type {import('next').NextConfig} */
const path = require("path");
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, options) => {
    config.plugins.push(
      new WasmPackPlugin({
        crateDirectory: path.resolve(__dirname, "wasm"),
      })
    );
    config.experiments.asyncWebAssembly = true;
    return config
  },
}

module.exports = nextConfig
