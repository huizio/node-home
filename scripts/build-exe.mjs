/**
 * 打包脚本：先用 esbuild 把 TypeScript 源码（含 @ 别名、JSX）打成单个 CJS 包，
 * 再用 pkg 把该包连同 Node 运行时一起打包成 Windows 可执行文件（exe）。
 *
 * 用法：node scripts/build-exe.mjs
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/** esbuild 输出（单个 CJS 文件，已内联全部 npm 依赖，仅保留 node 内置模块为外部）。 */
const bundleOut = path.join(root, "dist", "bundle.cjs");
/** 最终 exe 输出路径。 */
const exeOut = path.join(root, "dist", "node-home.exe");

/** pkg 目标：Windows x64 + pkg 5.8.1 支持的最高 Node 版本（含全局 fetch）。 */
const PKG_TARGET = "node18-win-x64";

/** 随仓库提交的预编译 pkg 运行时二进制（发布资产名，与下载源一致）。 */
const PKG_BINARY_ASSET = "node-v18.5.0-win-x64";
/**
 * pkg-fetch 本地缓存对同一个二进制命名为 `fetched-<版本>-<平台>-<架构>`，
 * 与发布资产名仅前缀不同（node- -> fetched-），据此推导缓存文件名。
 */
const PKG_FETCHED_NAME = `fetched-${PKG_BINARY_ASSET.slice("node-".length)}`;
/** pkg-fetch 的发布 tag，决定缓存子目录名（pkg@5.8.1 对应 v3.4）。 */
const PKG_FETCH_TAG = "v3.4";
/** 仓库内预置二进制的存放位置（随仓库提交，避免构建时联网）。 */
const PKG_BASE_BINARY = path.join(root, "vendor", "pkg-bin", PKG_BINARY_ASSET);
/** 构建期使用的本地 pkg 缓存目录（替代默认 ~/.pkg-cache，不提交）。 */
const PKG_CACHE_DIR = path.join(root, "vendor", ".pkg-cache");

await build({
  entryPoints: [path.join(root, "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  jsx: "automatic",
  jsxImportSource: "react",
  outfile: bundleOut,
  // 将 TS 配置中的 @/* 路径别名映射到项目根目录，便于 esbuild 解析裸导入。
  alias: { "@": root },
  // 保留 sourcemap（不影响运行，便于排查），并在控制台输出体积信息。
  sourcemap: true,
  logLevel: "info",
});

console.log(`[build] esbuild 打包完成：${bundleOut}`);

// 将仓库内预置的 pkg 运行时二进制放入本地缓存（使用 pkg-fetch 期望的命名与路径），
// 并让 pkg 指向该缓存目录，从而完全离线构建、不再依赖外部网络下载。
const fetchedDir = path.join(PKG_CACHE_DIR, PKG_FETCH_TAG);
fs.mkdirSync(fetchedDir, { recursive: true });
const fetchedPath = path.join(fetchedDir, PKG_FETCHED_NAME);
if (!fs.existsSync(fetchedPath)) {
  fs.copyFileSync(PKG_BASE_BINARY, fetchedPath);
}
process.env.PKG_CACHE_PATH = PKG_CACHE_DIR;

// 直接调用本地 pkg 的 JS 入口（避免 Windows 下 .bin 脚本无法被 spawnSync 直接执行）。
const pkgBin = path.join(root, "node_modules", "pkg", "lib-es5", "bin.js");
execFileSync(
  process.execPath,
  [pkgBin, bundleOut, "--targets", PKG_TARGET, "--output", exeOut],
  { stdio: "inherit", cwd: root },
);

console.log(`[build] exe 打包完成：${exeOut}`);
