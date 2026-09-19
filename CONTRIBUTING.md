# 贡献指南

欢迎通过修复问题、改进功能、完善文档或协助测试参与 VTubeLeaf。下载和日常使用请看 [README](README.md)。本文介绍开发环境、检查方式和维护者的发布流程。

## 项目结构

桌面应用使用 Tauri 2、React、TypeScript 和 Rust，默认通过 MediaPipe 在本地跟踪面部和身体动作。

- `src/`：桌面应用界面、角色渲染和交互逻辑。
- `src-tauri/`：Rust 后端、桌面能力和打包配置。
- `native/`：Windows 与 macOS 内置虚拟摄像头。
- `scripts/`：运行资源准备、许可证生成和发布脚本。
- `tests/`：单元测试和浏览器测试。
- `website/`：独立官网，开发方式见 [官网说明](website/README.md)。

## 开发启动

准备 Node.js 24 LTS（或 22.21+ LTS）、Rust 和目标平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。Cubism Core 固定为仓库内的 R4 npm 依赖，随 `npm ci` 安装；来源及原始许可见 [vendor](vendor/README.md)。

```sh
npm ci
npm run setup:assets
npm run tauri dev
```

内置 Haru、Hiyori、Mao 模型随应用打包，来源与条款见 [模型说明](vendor/models/README.md)。资源脚本从已安装依赖复制 Cubism Core 和原始许可，并按固定版本及 SHA-256 准备 MediaPipe 资源。

## 检查与构建

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

实际摄像头、系统权限、后台运行及会议软件接入需要桌面实测。测试与构建结果不能代替这些检查；步骤和已有记录见 [验收文档](docs/VALIDATION.md)。Linux 暂未完成验证。

## 提交改动

- 修复问题时说明触发条件、修改后的行为和验证结果；涉及界面时可附截图。
- 按改动范围运行相关检查；新增或更新依赖时，按 [第三方许可文档](docs/THIRD_PARTY.md)重新生成并审阅许可清单。
- 桌面 UI 图标优先使用已有的 `lucide-react`，项目约定见 [AGENTS.md](AGENTS.md)。
- PR 标题使用 `<type>(<scope>): <summary>`，例如 `fix(tracking): correct mouth calibration`。类型和范围使用小写，概括本次改动，末尾不加句号。

## 正式版调试

正式安装包保留 DevTools，默认不自动打开。主窗口和独立输出窗口均禁用右键菜单；遇到问题时，按 macOS 的 `Command + Option + I`、Windows / Linux 的 `Ctrl + Shift + I` 打开 DevTools，查看 Console 报错和 Network 请求。

此能力由 `src-tauri/Cargo.toml` 中的 Tauri `devtools` feature 启用，普通 release 构建即可使用，见 [Tauri 调试文档](https://v2.tauri.app/develop/debug/#enable-devtools-feature)。

## 发布版本（维护者）

使用 [release-it](https://github.com/release-it/release-it)，配置集中在根目录 `package.json` 的 `release-it` 字段。以根目录 `package.json` 为版本来源；Tauri 直接读取它，`after:bump` 钩子同步 `src-tauri/Cargo.toml`、`Cargo.lock` 并重新生成许可证清单。首次使用需按[第三方许可文档](docs/THIRD_PARTY.md)安装 `cargo-about 0.9.2`，并运行 `npm ci`。

```sh
npm run release:patch      # 0.1.1 → 0.1.2
npm run release:minor      # 0.1.1 → 0.2.0
npm run release -- major   # 0.1.1 → 1.0.0
npm run release -- 1.2.3   # 指定版本；以上命令任选其一
npm run release -- patch --dry-run  # 仅预览，不改文件、提交或推送
```

### 发布前检查

运行前先提交现有改动，并确保当前分支已设置 upstream、能够推送。release-it 会检查工作区是否干净并执行 `git fetch`；`after:git:init` 前置检查若发现远程分支存在本地未同步的提交（本地落后或双方分叉），会在修改版本号前终止并提示先同步，与远端一致或仅本地领先可以继续。拉取远程失败也会终止；`--dry-run` 会跳过 fetch 和 hook。

### 版本提交与打包

检查通过后更新 `package-lock.json`，将 Rust 版本和许可证文件纳入同一次 Git 提交（如 `chore(release): bump version to 0.1.2`），创建对应 tag（如 `v0.1.2`），并推送提交和 tag。命令使用 `--ci` 无交互执行，不发布 npm 包；推送 `v*` tag 后自动触发 [Release 工作流](.github/workflows/release.yml)，校验 tag 与应用版本一致，待两端检查和 macOS 签名、公证全部成功后创建 GitHub Release，上传 Windows `.exe`、macOS `.dmg` / `.zip` 与 `SHA256SUMS.txt`，并自动生成发行说明。预发布版本（如 `v0.2.0-beta.1`）会标记为 prerelease。命令结束表示 tag 已推送，实际打包和发布进度需在 Actions 查看。

### 中途失败的处理

如果 Rust 版本同步或许可证生成失败，版本文件可能已经更新。修复报错后运行 `node scripts/sync-version.mjs` 和 `npm run licenses:generate`，检查 `git diff`，再手动完成该版本的提交、tag 和推送，无需再次递增版本。`website/package.json` 属于独立官网，不随桌面应用升级。

### 应用更新签名

发布需配置 GitHub Actions Secrets：`TAURI_SIGNING_PRIVATE_KEY` 填更新私钥文件的完整内容，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 填生成时的密码；对应公钥保存在 `src-tauri/tauri.conf.json`。请长期备份这对密钥，后续版本继续使用。更新签名独立于 Apple/Windows 代码签名。CI 会签名 Windows 安装器及最终签名、公证后的 macOS `.app.tar.gz`，用配置公钥验证签名，生成 `.sig` 与 `latest.json` 并在资产全部上传后公开 Release。稳定版更新地址为 GitHub Releases 的 `latest/download/latest.json`，不推送预发布版本；此前未内置更新器的应用需要先手动安装一次新版。

### 应用内更新行为

应用更新默认在启动 5 秒后及运行期间每 24 小时检查一次。点击主界面底部版本号可手动检查、下载、忽略版本或关闭自动检查；下载完成后手动安装并重启。安装前会保存设置、停止跟踪和虚拟摄像头，有未保存的动作录制时需先保存。更新下载由主窗口持有，关闭关于窗口不影响下载，退出应用后需重新下载。

## 可选跟踪方式

### OpenSeeFace

使用 Python 3.10 和 Git，按固定上游提交安装到项目的 `.local/`：

```sh
npm run setup:openseeface -- --python /path/to/python3.10
npm run setup:openseeface -- --check
```

脚本打印应填入应用的 Python 与 `scripts/run-openseeface.py` 绝对路径。也可将两个路径都留空，仅接收你自行启动的本机 OpenSeeFace。安装依赖和设备验证不随默认构建自动执行；[详细步骤](docs/SETUP.md#可选-openseeface)列出了两种方式。

### NVIDIA RTX（实验中）

Windows 可选 NVIDIA RTX 面捕，需要独立安装 SDK、模型并编译扩展。安装步骤与尚待验证的范围见 [NVIDIA 接入说明](docs/NVIDIA-TRACKING.md)。

## 进一步阅读

- [开发环境、资源、道具场景与会议接入](docs/SETUP.md)
- [VTube Studio 配置兼容范围](docs/VTS-COMPATIBILITY.md)
- [Windows 内置摄像头构建、安装与测试](native/windows-camera/README.md)
- [macOS 内置摄像头编译、签名与安装](native/macos-camera/README.md)
- [macOS 正式打包与发行凭据](docs/RELEASE-MACOS.md)
- [验收步骤与已有证据](docs/VALIDATION.md)
- [第三方来源与发行前许可核实](docs/THIRD_PARTY.md)
- [产品需求](docs/PRD.md)与[实施计划](docs/superpowers/plans/2026-09-07-desktop-mvp.md)
- [Logo 与品牌资源](docs/BRAND.md)

本项目自有代码采用 [MIT 许可证](LICENSE)。Live2D SDK、跟踪模型、角色模型和第三方依赖各有独立条款；发行前的许可核实事项见 [第三方许可文档](docs/THIRD_PARTY.md)。
