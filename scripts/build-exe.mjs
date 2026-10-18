/**
 * 打包脚本：先用 esbuild 把 TypeScript 源码（含 @ 别名、JSX）打成单个 CJS 包，
 * 再用 pkg 把该包连同 Node 运行时一起打包成 Windows 可执行文件（exe）。
 *
 * 用法：node scripts/build-exe.mjs
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
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

// 直接调用本地 pkg 的 JS 入口（避免 Windows 下 .bin 脚本无法被 spawnSync 直接执行）。
const pkgBin = path.join(root, "node_modules", "pkg", "lib-es5", "bin.js");
execFileSync(
  process.execPath,
  [pkgBin, bundleOut, "--targets", PKG_TARGET, "--output", exeOut],
  { stdio: "inherit", cwd: root },
);

console.log(`[build] exe 打包完成：${exeOut}`);
