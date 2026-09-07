# VTubeLeaf

<img src="public/brand/lockup-light.svg" width="360" alt="VTubeLeaf" />

免费、本地运行的 Live2D 桌面面捕工具，使用 Tauri 2、React、TypeScript 和 Rust。默认采用 MediaPipe Face Landmarker 与 Pose Landmarker Lite，并提供可选的 OpenSeeFace 本地跟踪入口；角色画面通过 OBS 虚拟摄像头接入飞书等会议软件。

当前是开发中的桌面版本：支持拖入模型到本地角色库、预览卡片切换、自定义参数映射、按模型保存校准与构图、眼神/眉毛/位移输入、表情叠加与全局快捷键、动作播放与待机、手动录制导出，以及全窗口舞台、直播模式和可选独立输出窗口。官方 Haru 模型已通过浏览器渲染、动作/表情和输出同步检查；实际摄像头、原生快捷键、后台运行及会议接入仍需按[验收记录](docs/VALIDATION.md)验证。macOS、Windows、Linux 是目标平台，不代表均已实测可用。

## 开发启动

准备 Node.js 22.18+（或兼容的更新 LTS）、Rust 和目标平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)，从 [Live2D 官方](https://www.live2d.com/en/sdk/download/web/)获取 **Cubism 5 SDK for Web R4**、阅读使用条款。当前渲染库不兼容 R5 的 Core 接口，具体下载地址见[接入说明](docs/SETUP.md)。

```sh
npm ci
npm run setup:assets -- --sdk /path/to/CubismSdkForWeb
npm run tauri dev
```

准备一个你有权使用的 Live2D 模型，在应用中导入模型目录、`.model3.json` 或 ZIP 包，再选择摄像头并开始跟踪。仓库不附带 Cubism Core 或示例角色；设置脚本只从你指定的 SDK 复制 Core，MediaPipe 资源则按固定版本及 SHA-256 准备到本地。

可把模型文件夹、`.model3.json` 或 ZIP 拖到桌面窗口，应用会复制模型资源到自己管理的角色库，原文件移动后仍可使用。在「角色库」点击带预览的角色卡片即可切换；预览保存在本机，重启后自动恢复。角色库的实际路径可在「角色文件夹」中查看。

导入后可在角色舞台按住鼠标左键拖动位置，滚轮以鼠标位置为中心缩放；也可使用「画面 → 角色构图」的滑块或恢复默认。构图按模型保存，并同步到输出窗口。在「面捕」中开启「显示面捕预览」可查看摄像头画面与实时面部网格及上半身关键点，叠加图层和镜像可分别切换；该预览仅支持 MediaPipe，不会进入输出窗口。

角色舞台铺满整个窗口，工具栏、设置与状态面板叠在舞台上，收起面板不会改变构图。点击顶部「直播模式」隐藏所有面板和摄像头预览，即可让 OBS 捕获 VTubeLeaf 主窗口；回到该窗口按 `Esc` 恢复界面，跟踪保持运行。需要一边调整一边输出时仍可使用「独立输出窗口」。

只检查前端和默认跟踪资源时可运行：

```sh
npm run setup:assets -- --mediapipe-only
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

前端由 React 管理界面与交互，使用 Tailwind CSS 和 shadcn/ui 统一按钮、输入框、选择器、开关、滑块及折叠区。组件源码位于 `src/components/ui`，主题变量位于 `src/style.css`。

`npm run dev` 是浏览器开发页面；本地文件、设置、输出窗口和 OpenSeeFace 进程功能需要通过 `npm run tauri dev` 使用。

使用 `npm run format` 格式化 TypeScript、JavaScript、CSS、HTML、JSON 和 Markdown，`npm run format:check` 检查格式。Prettier 不处理 Rust 和 Python；Rust 使用 `cargo fmt --manifest-path src-tauri/Cargo.toml`。

## 可选 OpenSeeFace

使用 Python 3.10 和 Git，按固定上游提交安装到项目的 `.local/`：

```sh
npm run setup:openseeface -- --python /path/to/python3.10
npm run setup:openseeface -- --check
```

脚本打印应填入应用的 Python 与 `scripts/run-openseeface.py` 绝对路径。也可将两个路径都留空，仅接收你自行启动的本机 OpenSeeFace。安装依赖和设备验证不随默认构建自动执行；[详细步骤](docs/SETUP.md#可选-openseeface)列出了两种方式。

## 文档

- [产品需求](docs/PRD.md)与[实施计划](docs/superpowers/plans/2026-09-07-desktop-mvp.md)
- [安装、资源、模型与 OBS 接入](docs/SETUP.md)
- [验收步骤与当前证据](docs/VALIDATION.md)
- [第三方来源与发行前许可核实](docs/THIRD_PARTY.md)
- [Logo 提案与品牌资源](docs/BRAND.md)

本项目自有代码的开源许可证尚待确定。Live2D SDK、跟踪模型、角色模型和第三方依赖各有独立条款；公开发行条件尚未核实完成。

「面捕 → 识别上半身」默认开启：双肩入镜时驱动身体转动与侧倾，髋部也可见时增加前后倾斜；出框或遮挡时平滑回退。抬臂与屈肘可在自定义映射中绑定角色参数。模型需要具备相应可动部位，OpenSeeFace 当前仅提供面捕。
