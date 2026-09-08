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

构建包含 TypeScript 检查，静态产物位于 `website/dist/`。预览地址为 <http://127.0.0.1:4173>，适合部署在站点根路径。

## 验证

```sh
npm run check
npx playwright install chromium
npm test
```

浏览器测试自动启动独立的 `5198` 端口，覆盖角色选择、开关、滑块、系统标签的键盘操作和记忆、FAQ 折叠、手机布局、页面锚点、本地图片，以及存储被禁用时的行为。

## 修改页面

- `src/App.tsx`：页面内容和 React 交互。
- `src/style.css`：原稿视觉样式、响应式布局、键盘焦点及减少动态效果设置。
- `public/assets/brand/`：当前叶芽精灵 Logo；在仓库根目录运行 `node scripts/brand.mjs` 同步更新。
- `index.html`：页面标题、简介、分享元信息和图标。

首屏应用界面是交互示意，不会请求摄像头或加载 Live2D。下载按钮统一显示“待发布”并禁用，发布安装包后再接入公开下载地址。

产品文案保留设计稿内容，其中虚拟摄像头安装说明与当前仓库进度存在差异；正式发布前需依据根目录 README 和 `docs/VALIDATION.md` 更新，并确认下载产物与对比信息。
