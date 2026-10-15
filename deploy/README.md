# dsh-covenant bundle（可安装资产）

自包含的 DSH host 插件包：把根插件 `app/src/index.ts` 及其组装的 9 个子系统
（`@dsh-covenant/*`）打包成单文件 `index.js`，仅依赖 Node 内建模块。

## 结构

- `index.js` — esbuild 打包产物（**构建生成，不入库**，见根 `.gitignore`）
- `package.json` — bundle manifest（`dsh.bundle.patch` → `cordis.patch.yml`）
- `cordis.patch.yml` — Loader patch：插入 `dsh-covenant` host 插件行
- `locale/en.json` / `locale/zh.json` — 元信息标题与描述
- `icon.svg` — 原创图标（测试/验证意象）

## 重建 index.js

esbuild 来自 vitest 的传递依赖（pnpm `.pnpm` 存储），借用其 JS API：

```bash
cd /root/dsh-cs
node node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild \
  app/src/index.ts --bundle --platform=node --format=esm \
  --outfile=deploy/dsh-covenant/index.js --log-level=warning
```

## 安装进 profile

通过 `plugin_manager`（`install_bundle`，target 为本目录绝对路径）安装；
安装后 `list_plugins` 应出现 `include:dsh-covenant` 行且 `fiberPhase: active`。

当前安装方式为 link（`<- ../../../dsh-cs/deploy/dsh-covenant`），
删除本目录会导致已安装副本加载失败。

## 能力边界

这是 host-only 服务插件：`apply(ctx)` 将 9 个子系统以字符串键服务挂到
`ctx`（`covenant.assertion` / `covenant.evidence-model` / …），供下游工具/UI
经 `ctx.get('covenant.<name>')` 取用。无可见 UI、无工具注册，服务不入
inspect 的 `Service` 目录（任意字符串服务不在类型化服务目录内，属预期）。