# VTubeLeaf

<img src="public/brand/lockup-light.svg" width="360" alt="VTubeLeaf" />

面向 **Windows 和 macOS** 的免费、本地 Live2D 桌面面捕工具，使用 Tauri 2、React、TypeScript 和 Rust。默认采用 MediaPipe Face Landmarker 与 Pose Landmarker Lite，并提供可选的 OpenSeeFace 本地跟踪入口。已实现 Windows 内置 DirectShow 虚拟摄像头和 macOS Camera Extension；Windows 尚待系统运行验证，macOS 尚待签名安装验证，也可选择 OBS 输出。

当前是开发中的桌面版本：支持拖入模型到本地角色库、预览卡片切换、自定义参数映射、按模型保存校准与构图、眼神/眉毛/位移与可选手指输入、多帧校准和双眼联动、本地麦克风口型、模型物理调节、表情叠加与全局快捷键、动作播放与待机、手动录制导出，以及全窗口舞台、直播模式和可选独立输出窗口。还支持 PNG/JPEG/GIF 与 Live2D 道具、图层变换、场景保存/切换及 `.vtube.json` 配置导入。官方 Haru 模型已通过浏览器渲染、动作/表情和输出同步检查；实际摄像头、原生快捷键、后台运行及会议接入仍需按[验收记录](docs/VALIDATION.md)验证。Windows 与 macOS 是主要支持目标，已配置两端 CI 测试和打包检查；Windows runner 尚未执行，桌面实测也未完成。Linux 保留为后续验证目标。

## 开发启动

准备 Node.js 22.18+（或兼容的更新 LTS）、Rust 和目标平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。Cubism Core 固定为仓库内的 R4 npm 依赖，随 `npm ci` 安装；来源及原始许可见 [vendor](vendor/README.md)。

```sh
npm ci
npm run setup:assets
npm run tauri dev
```

应用内置 Live2D 官方免费示例模型 **Haru、Hiyori、Mao**，首次打开会自动加入「角色库」，打包后离线可用。选择角色，再选择摄像头并开始跟踪；也可导入你有权使用的模型目录、`.model3.json` 或 ZIP 包。内置模型的来源与条款见 [模型说明](vendor/models/README.md)。设置脚本从已安装依赖复制 Core 和原始许可，MediaPipe 资源按固定版本及 SHA-256 准备到本地。

可把模型文件夹、`.model3.json` 或 ZIP 拖到桌面窗口，应用会复制模型资源到自己管理的角色库，原文件移动后仍可使用。在「角色库」点击带预览的角色卡片即可切换；预览保存在本机，重启后自动恢复。角色库的实际路径可在「角色文件夹」中查看。

导入后可在角色舞台按住鼠标左键拖动位置，滚轮以鼠标位置为中心缩放；也可使用「画面 → 角色构图」的滑块或恢复默认。构图按模型保存，并同步到输出窗口。在「面捕」中开启「显示面捕预览」，默认只显示关键点；可通过「显示真人画面」开关显示或隐藏摄像头画面，选择会保存，镜像可单独切换。该预览仅支持 MediaPipe，不会进入输出窗口。

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

Windows 的 MSVC、WebView2、PowerShell 命令与 `.exe` 安装包构建见 [Windows 开发与打包](docs/SETUP.md#windows-开发与打包)。`Desktop checks` 只检查编译与打包，不发布安装包，包含固定版本的 Cubism Core。macOS 正式包使用独立的 [GitHub Actions 发行工作流](docs/RELEASE-MACOS.md)，配置 Apple 发行凭据后生成带内置摄像头、签名和公证的通用 DMG / ZIP。

使用 `npm run format` 格式化 TypeScript、JavaScript、CSS、HTML、JSON 和 Markdown，`npm run format:check` 检查格式。Prettier 不处理 Rust 和 Python；Rust 使用 `cargo fmt --manifest-path src-tauri/Cargo.toml`。

## 升级版本

以根目录 `package.json` 为版本来源；Tauri 直接读取它，npm 的 `version` 钩子同步 `src-tauri/Cargo.toml`、`Cargo.lock` 并重新生成许可证清单。首次使用需按[第三方许可文档](docs/THIRD_PARTY.md)安装 `cargo-about 0.9.2`，并运行 `npm ci`。

```sh
npm run release:patch      # 0.1.0 → 0.1.1
npm run release:minor      # 0.1.0 → 0.2.0
npm run release -- major   # 0.1.0 → 1.0.0
npm run release -- 1.2.3   # 指定版本；以上命令任选其一
```

运行前先提交现有改动，npm 会检查工作区是否干净。命令会同时更新 `package-lock.json`，将 Rust 版本和许可证文件纳入同一次 Git 提交（如 `chore(release): 0.1.1`），并创建对应 tag（如 `v0.1.1`）。提交和 tag 只保存在本地；推送后再运行发行工作流，命令本身不推送、打包或发布。

如果许可证生成失败，修复报错后运行 `npm run version` 重试同步、生成并暂存相关文件，然后手动完成该版本的提交和 tag，无需再次递增版本。`website/package.json` 属于独立官网，不随桌面应用升级。

## 可选 OpenSeeFace

使用 Python 3.10 和 Git，按固定上游提交安装到项目的 `.local/`：

```sh
npm run setup:openseeface -- --python /path/to/python3.10
npm run setup:openseeface -- --check
```

脚本打印应填入应用的 Python 与 `scripts/run-openseeface.py` 绝对路径。也可将两个路径都留空，仅接收你自行启动的本机 OpenSeeFace。安装依赖和设备验证不随默认构建自动执行；[详细步骤](docs/SETUP.md#可选-openseeface)列出了两种方式。

## 文档

Windows 可选 **NVIDIA RTX · 实验中** 面捕，需要独立安装 SDK、模型并编译扩展；Windows 编译与 RTX 实机效果尚未验证，见 [NVIDIA 接入说明](docs/NVIDIA-TRACKING.md)。

- [产品需求](docs/PRD.md)与[实施计划](docs/superpowers/plans/2026-09-07-desktop-mvp.md)
- [安装、资源、道具场景与会议接入](docs/SETUP.md)
- [VTube Studio 配置兼容范围](docs/VTS-COMPATIBILITY.md)
- [Windows 内置摄像头构建、安装与测试](native/windows-camera/README.md)
- [macOS 内置摄像头编译、签名与安装](native/macos-camera/README.md)
- [验收步骤与当前证据](docs/VALIDATION.md)
- [第三方来源与发行前许可核实](docs/THIRD_PARTY.md)
- [Logo 提案与品牌资源](docs/BRAND.md)

本项目自有代码采用 [MIT 许可证](LICENSE)。Live2D SDK、跟踪模型、角色模型和第三方依赖各有独立条款；Live2D 公开发行条件尚未核实完成。

「面捕 → 识别上半身」默认开启：双肩入镜时驱动身体转动与侧倾，髋部也可见时增加前后倾斜；出框或遮挡时平滑回退。常见的手臂、肘部参数自动绑定，也可自定义映射。身体和手部跟踪不依赖同时识别到人脸。手指跟踪与麦克风均需单独开启；元音需要按自己的声音校准。模型需要具备相应可动部位，OpenSeeFace 当前仅提供面捕。
