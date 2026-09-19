# VTubeLeaf 官网

独立的 React + TypeScript + Vite 首页，沿用 OpenDesign 项目 `66677b5b-340e-4b16-83d3-7135ebfd46ff` 的 `vtubeleaf-landing-v2.html`、`brand-spec.md` 和玫红色品牌素材。

需要 Node.js 22.18+。网站独立安装依赖，不需要启动 Tauri 或准备 Live2D SDK。

## 开发

在仓库根目录运行：

```sh
cd website
npm ci
npm run dev
```

打开终端打印的地址，默认是 <http://127.0.0.1:5173>。端口被占用时也可指定：

```sh
npm run dev -- --port 5197
```

## 构建与预览

在 `website` 目录运行：

```sh
npm run build
npm run preview -- --port 4173
```

构建包含 TypeScript 检查和 React 静态预渲染，完整正文、下载链接及应用结构化数据会写入 `website/dist/index.html`，关闭 JavaScript 也能阅读和下载；加载 JavaScript 后通过 hydration 恢复交互。预览地址为 <http://127.0.0.1:4173>，适合部署在站点根路径。

版本来源是 `public/release.json`，包含最新稳定版版本号、Release 页面、Windows x64 EXE 和 macOS 通用 DMG 地址。Release 工作流在发布成功后运行 `scripts/update-website-release.mjs`：读取 GitHub 当前最新稳定版，按版本号推断文件地址并核对已上传的安装包，再仅更新 `main` 分支的这份文件。预发布和失败的发布不会更新官网版本；重跑旧版本时仍以 GitHub 当前 latest 为准。可在仓库根目录运行 `node scripts/update-website-release.mjs --dry-run` 预览生成结果，不写入 GitHub。

构建从本地版本文件生成完整 HTML，无需联网查询 Release。浏览器加载后从 GitHub 原始文件地址读取最新清单，同步版本文字、下载地址和结构化数据，因此后续更新不依赖网站重新部署。读取失败或文件无效时保留构建快照；关闭 JavaScript 的访客和不执行 JavaScript 的爬虫仍使用构建时版本。下载按钮首次按访客系统排序和高亮，手动切换系统后跟随选择并记忆。

生产地址为 <https://vtubeleaf.vercel.app/>。更换域名时，同步修改 `index.html` 的 canonical / 分享地址、`src/App.tsx` 的结构化数据及 `public/robots.txt`、`public/sitemap.xml`。

## 验证

```sh
npm run check
npx playwright install chromium
npm test
```

浏览器测试构建后启动独立的 `5198` 预览端口，覆盖原始 HTML 与爬取元信息、无 JavaScript 阅读和下载、hydration、系统标签的键盘操作和记忆、FAQ、手机布局、锚点、图片及禁用存储。用 `WEBSITE_URL=https://vtubeleaf.vercel.app npm test` 可复用这些检查验证线上部署。

## 修改页面

- `src/App.tsx`：页面内容和 React 交互。
- `src/style.css`：原稿视觉样式、响应式布局、键盘焦点及减少动态效果设置。
- `public/assets/brand/`：当前叶芽精灵 Logo；在仓库根目录运行 `node scripts/brand.mjs` 同步 SVG，分享图 `logo.png` 取自 `public/brand/png/512x512.png`。
- `index.html`：页面标题、简介、分享元信息和图标。
- `vite.config.ts`：Release 构建快照与首页预渲染。
- `src/release.ts`：版本文件校验和浏览器更新。
- `public/release.json`：由 Release 工作流自动维护的版本和下载地址。
- `public/robots.txt`、`public/sitemap.xml`：爬虫规则与站点地图。

首屏展示真实软件截图（胡桃模型与内置办公室背景），点击可在新标签页查看原图。图片位于 `public/assets/screenshots/`，页面不会请求摄像头或加载 Live2D。下载区直接指向 GitHub Release 安装包，并按两端内置虚拟摄像头的安装和激活流程提供说明。
