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

开发启动和构建时会读取 GitHub 最新公开稳定 Release，并核对 Windows x64 EXE、macOS 通用 DMG / ZIP 资产。版本与下载地址使用同一份构建快照，不需要访客请求 GitHub API。构建需要联网；Release 获取失败或缺少安装包时会明确报错。发布新版本后，重新部署官网即可更新下载链接。

生产地址为 <https://vtubeleaf.vercel.app/>。更换域名时，同步修改 `index.html` 的 canonical / 分享地址、`src/App.tsx` 的结构化数据及 `public/robots.txt`、`public/sitemap.xml`。

## 验证

```sh
npm run check
npx playwright install chromium
npm test
```

浏览器测试构建后启动独立的 `5198` 预览端口，覆盖原始 HTML 与爬取元信息、无 JavaScript 阅读和下载、hydration、角色选择、开关、滑块、系统标签的键盘操作和记忆、FAQ、手机布局、锚点、图片及禁用存储。用 `WEBSITE_URL=https://vtubeleaf.vercel.app npm test` 可复用这些检查验证线上部署。

## 修改页面

- `src/App.tsx`：页面内容和 React 交互。
- `src/style.css`：原稿视觉样式、响应式布局、键盘焦点及减少动态效果设置。
- `public/assets/brand/`：当前叶芽精灵 Logo；在仓库根目录运行 `node scripts/brand.mjs` 同步 SVG，分享图 `logo.png` 取自 `public/brand/png/512x512.png`。
- `index.html`：页面标题、简介、分享元信息和图标。
- `vite.config.ts`：Release 获取、安装包校验与构建时预渲染。
- `src/release.ts`：供页面使用的构建期 Release 数据类型。
- `public/robots.txt`、`public/sitemap.xml`：爬虫规则与站点地图。

首屏应用界面是交互示意，不会请求摄像头或加载 Live2D。下载区直接指向 GitHub Release 安装包，并按两端内置虚拟摄像头的安装和激活流程提供说明。
