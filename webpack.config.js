"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const HtmlInlineScriptPlugin = require("html-inline-script-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = (_env, argv) => {
    const production = argv.mode === "production";
    let build = "uncommitted";
    try { build = execFileSync("git", ["show", "-s", "--format=%h (%cs)", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
    return {
        mode: production ? "production" : "development",
        devtool: production ? false : "inline-source-map",
        entry: "./src/index.tsx",
        output: { path: path.resolve(__dirname, "dist-web"), filename: "bundle.js", publicPath: "", clean: true },
        resolve: { extensions: [".ts", ".tsx", ".js"] },
        optimization: { minimizer: [new TerserPlugin({ extractComments: false })] },
        performance: { hints: false },
        module: { rules: [
            { resourceQuery: /source/, type: "asset/source" },
            { test: /\.tsx?$/, exclude: [/node_modules/, /(?:conversion|pdf_preview)_worker\.ts$/], use: "ts-loader" },
            { test: /(?:conversion|pdf_preview)_worker\.ts$/, use: [
                { loader: "worker-loader", options: { inline: "no-fallback", filename: "[name].js" } },
                "ts-loader"
            ] },
            { test: /\.css$/, use: ["style-loader", "css-loader"] },
            { test: /\.(wasm|svg|png|woff2?)$/, type: "asset/inline" }
        ] },
        plugins: [
            new webpack.DefinePlugin({
                __KUROKO_VERSION__: JSON.stringify(require("./package.json").version),
                __KUROKO_BUILD__: JSON.stringify(build),
                __KUROKO_LICENSES__: JSON.stringify(["LICENSE.md", "THIRD_PARTY_LICENSES.md"].map(p => fs.readFileSync(p, "utf8")).join("\n\n"))
            }),
            new HtmlWebpackPlugin({ template: "./src/index.html", inject: "body", scriptLoading: "defer", minify: production }),
            ...(production ? [new HtmlInlineScriptPlugin()] : [])
        ],
        devServer: { host: "127.0.0.1", port: 8080, hot: false, liveReload: true }
    };
};
