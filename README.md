# VTubeLeaf

<img src="public/brand/lockup-light.svg" width="360" alt="VTubeLeaf" />

面向 **Windows 和 macOS** 的免费、本地 Live2D 桌面面捕工具，使用 Tauri 2、React、TypeScript 和 Rust。默认采用 MediaPipe Face Landmarker 与 Pose Landmarker Lite，并提供可选的 OpenSeeFace 本地跟踪入口。已实现 Windows 内置 DirectShow 虚拟摄像头和 macOS Camera Extension；Windows 尚待系统运行验证，macOS 尚待签名安装验证，也可选择 OBS 输出。

当前是开发中的桌面版本：支持拖入模型到本地角色库、预览卡片切换、自定义参数映射、按模型保存校准与构图、眼神/眉毛/位移与可选手指输入、多帧校准和双眼联动、本地麦克风口型、模型物理调节、表情叠加与应用快捷键、动作播放与待机、手动录制导出，以及全窗口舞台、直播模式和可选独立输出窗口。还支持 PNG/JPEG/GIF 与 Live2D 道具、图层变换、场景保存/切换及 `.vtube.json` 配置导入。官方 Haru 模型已通过浏览器渲染、动作/表情和输出同步检查；实际摄像头、桌面窗口快捷键、后台运行及会议接入仍需按[验收记录](docs/VALIDATION.md)验证。Windows 与 macOS 是主要支持目标，已配置两端 CI 测试和打包检查；Windows runner 尚未执行，桌面实测也未完成。Linux 保留为后续验证目标。

## 开发启动

准备 Node.js 24 LTS（或 22.21+ LTS）、Rust 和目标平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。Cubism Core 固定为仓库内的 R4 npm 依赖，随 `npm ci` 安装；来源及原始许可见 [vendor](vendor/README.md)。

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

Windows 的 MSVC、WebView2、PowerShell 命令与 `.exe` 安装包构建见 [Windows 开发与打包](docs/SETUP.md#windows-开发与打包)。`Desktop checks` 检查两端编译与打包，包含固定版本的 Cubism Core。推送版本 tag 后，[Release 工作流](.github/workflows/release.yml) 自动构建 Windows 安装包与 macOS 通用 DMG / ZIP，全部成功后上传到对应 GitHub Release；macOS 包包含内置摄像头、签名和公证，需要先配置 [Apple 发行凭据](docs/RELEASE-MACOS.md)。

使用 `npm run format` 格式化 TypeScript、JavaScript、CSS、HTML、JSON 和 Markdown，`npm run format:check` 检查格式。Prettier 不处理 Rust 和 Python；Rust 使用 `cargo fmt --manifest-path src-tauri/Cargo.toml`。

## 正式版调试

正式安装包保留 DevTools，默认不自动打开。主窗口和独立输出窗口均禁用右键菜单；遇到问题时，按 macOS 的 `Command + Option + I`、Windows / Linux 的 `Ctrl + Shift + I` 打开 DevTools，查看 Console 报错和 Network 请求。

此能力由 `src-tauri/Cargo.toml` 中的 Tauri `devtools` feature 启用，普通 release 构建即可使用，见 [Tauri 调试文档](https://v2.tauri.app/develop/debug/#enable-devtools-feature)。

## 升级版本

使用 [release-it](https://github.com/release-it/release-it)，配置集中在根目录 `package.json` 的 `release-it` 字段。以根目录 `package.json` 为版本来源；Tauri 直接读取它，`after:bump` 钩子同步 `src-tauri/Cargo.toml`、`Cargo.lock` 并重新生成许可证清单。首次使用需按[第三方许可文档](docs/THIRD_PARTY.md)安装 `cargo-about 0.9.2`，并运行 `npm ci`。

```sh
npm run release:patch      # 0.1.1 → 0.1.2
npm run release:minor      # 0.1.1 → 0.2.0
npm run release -- major   # 0.1.1 → 1.0.0
npm run release -- 1.2.3   # 指定版本；以上命令任选其一
npm run release -- patch --dry-run  # 仅预览，不改文件、提交或推送
```

运行前先提交现有改动，并确保当前分支已设置 upstream、能够推送。release-it 会检查工作区是否干净，更新 `package-lock.json`，将 Rust 版本和许可证文件纳入同一次 Git 提交（如 `chore(release): 0.1.2`），创建对应 tag（如 `v0.1.2`），并推送提交和 tag。命令使用 `--ci` 无交互执行，不发布 npm 包；推送 `v*` tag 后自动触发 [Release 工作流](.github/workflows/release.yml)，校验 tag 与应用版本一致，待两端检查和 macOS 签名、公证全部成功后创建 GitHub Release，上传 Windows `.exe`、macOS `.dmg` / `.zip` 与 `SHA256SUMS.txt`，并自动生成发行说明。预发布版本（如 `v0.2.0-beta.1`）会标记为 prerelease。命令结束表示 tag 已推送，实际打包和发布进度需在 Actions 查看。

如果同步或许可证生成失败，版本文件可能已经更新。修复报错后运行 `node scripts/sync-version.mjs` 和 `npm run licenses:generate`，检查 `git diff`，再手动完成该版本的提交、tag 和推送，无需再次递增版本。`website/package.json` 属于独立官网，不随桌面应用升级。

应用更新默认在启动 5 秒后及运行期间每 24 小时检查一次。点击主界面底部版本号可手动检查、下载、忽略版本或关闭自动检查；下载完成后手动安装并重启。安装前会保存设置、停止跟踪和虚拟摄像头，有未保存的动作录制时需先保存。更新下载由主窗口持有，关闭关于窗口不影响下载，退出应用后需重新下载。

发布需配置 GitHub Actions Secrets：`TAURI_SIGNING_PRIVATE_KEY` 填更新私钥文件的完整内容，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 填生成时的密码；对应公钥保存在 `src-tauri/tauri.conf.json`。请长期备份这对密钥，后续版本继续使用。更新签名独立于 Apple/Windows 代码签名。CI 会签名 Windows 安装器及最终签名、公证后的 macOS `.app.tar.gz`，用配置公钥验证签名，生成 `.sig` 与 `latest.json` 并在资产全部上传后公开 Release。稳定版更新地址为 GitHub Releases 的 `latest/download/latest.json`，不推送预发布版本；此前未内置更新器的应用需要先手动安装一次新版。

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
