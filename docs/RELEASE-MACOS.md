# GitHub Actions macOS 正式打包

[Package macOS release](../.github/workflows/release-macos.yml) 构建 **macOS 14+、Intel / Apple Silicon 通用的 Release 应用**，包含 Cubism Core R4、MediaPipe 本地资源、许可声明和内置 Camera Extension。推送 `v*` tag 后由 [Release 工作流](../.github/workflows/release.yml) 自动调用，也可手动运行。

流程为：检查必需配置 → 测试 → 校验并准备资源 → Tauri release 构建 → 嵌入摄像头扩展 → Developer ID 签名 → Apple 公证应用并附加票据 → 生成 ZIP / dmgbuild 布局 DMG → 签名、公证 DMG 并附加票据 → 校验签名与 Gatekeeper → 上传产物。任何签名、公证或资源检查失败都会终止，不上传未完成的包。

## 1. 准备 Apple 发行资料

需要有效的 Apple Developer Program 团队账号，使用 Developer ID 在 Mac App Store 之外分发：

1. 创建 **Developer ID Application** 证书，在「钥匙串访问 → 我的证书」中将证书连同私钥导出为有密码的 `.p12`。只有 `.cer` 文件不够。
2. 为主应用 `com.moonrailgun.vtubeleaf` 创建 App ID，启用 **System Extension** 与 App Groups。
3. 为扩展 `com.moonrailgun.vtubeleaf.camera` 创建 App ID，启用 App Groups。
4. 启用 App Groups 后，新生成的描述文件会使用 `TEAMID1234.*` 授权该团队的 macOS App Group。打包脚本会为两者写入具体的 `TEAMID1234.com.vtubeleaf.camera`，将 `TEAMID1234` 换成实际 10 位 Team ID；无需在开发者后台注册这个 macOS 格式的组名。参见 [Apple 的 macOS App Group 说明](https://developer.apple.com/forums/thread/721701)。
5. 分别创建并下载这两个 App ID 的 **Developer ID provisioning profile**；不要使用 Development / Mac App Store 描述文件。主应用描述文件必须包含 `com.apple.developer.system-extension.install`。修改能力后重新生成描述文件。
6. 在 App Store Connect 的「Users and Access → Integrations → App Store Connect API → Team Keys」创建有公证权限的团队 API Key，记录 Key ID、Issuer ID 并下载 `.p8` 私钥。本工作流使用团队密钥，必须有 Issuer ID；不使用 Individual Key。

运行以下命令查看可用签名身份，把完整的 `Developer ID Application: … (TEAMID1234)` 名称填入变量：

```sh
security find-identity -v -p codesigning
```

完整的能力、嵌入路径与安装流程见 [Camera Extension 文档](../native/macos-camera/README.md)。证书、描述文件和公证 API Key 应来自同一发行团队。

## 2. 配置 GitHub Secrets 和 Variables

进入仓库 **Settings → Secrets and variables → Actions**。以下名称区分大小写，全部必填。

在 **Secrets → New repository secret** 添加：

| 名称                           | 值                                                     |
| ------------------------------ | ------------------------------------------------------ |
| `MACOS_CERTIFICATE_P12_BASE64` | 带私钥的 Developer ID Application `.p12` 文件的 Base64 |
| `MACOS_CERTIFICATE_PASSWORD`   | 导出 `.p12` 时设置的密码                               |
| `MACOS_HOST_PROFILE_BASE64`    | 主应用 `.provisionprofile` 文件的 Base64               |
| `MACOS_CAMERA_PROFILE_BASE64`  | 摄像头扩展 `.provisionprofile` 文件的 Base64           |
| `APPLE_API_KEY_P8_BASE64`      | App Store Connect 团队 API Key `.p8` 文件的 Base64     |
| `APPLE_API_KEY_ID`             | API Key ID                                             |
| `APPLE_API_ISSUER`             | 团队 API Key 页上的 Issuer ID，UUID 格式               |

在 **Variables → New repository variable** 添加：

| 名称                     | 示例 / 含义                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `APPLE_TEAM_ID`          | `TEAMID1234`，实际 Apple Developer Team ID                       |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID1234)`，完整签名身份 |

在 macOS 终端逐条运行，将每次复制的结果粘贴到对应 Secret：

```sh
base64 -i /path/DeveloperID.p12 | pbcopy
base64 -i /path/host.provisionprofile | pbcopy
base64 -i /path/camera.provisionprofile | pbcopy
base64 -i /path/AuthKey_ABC1234567.p8 | pbcopy
```

`.p12` 密码、Key ID 与 Issuer ID 直接填原文。临时钥匙串密码由 runner 随机生成，无需配置；上传 Actions 产物和发布 GitHub Release 使用 GitHub 提供的令牌，无需个人 PAT，只有发布 job 申请 `contents: write` 权限。

Cubism Core R4 已固定为仓库内的 npm 依赖，由 `npm ci` 安装；工作流从依赖复制 Core 和原始许可文件，不下载整份 SDK，也不需要 `LIVE2D_SDK_URL` 或 `LIVE2D_SDK_SHA256`。版本、来源和完整性记录见 [vendor](../vendor/README.md)，公开分发条件见 [第三方许可](THIRD_PARTY.md)。

## 3. 运行和下载

1. 将工作流、脚本及应用源码提交到仓库，确保版本 tag 包含发行工作流；手动运行入口要求工作流文件已存在于默认分支。
2. 提交现有改动后，运行 `npm run release:patch` 或 `npm run release:minor`。release-it 统一更新 npm / Rust 版本和许可证清单，自动提交、创建版本 tag 并推送；Tauri 直接读取根目录 `package.json`。首次使用的依赖要求和预览命令见 [发布版本](../CONTRIBUTING.md#发布版本维护者)。
3. 推送 `v*` tag 自动启动 **Actions → Release**，先校验 tag 与应用版本一致，再执行两端检查和 macOS 正式打包。全部成功后创建对应 GitHub Release，自动生成发行说明，并上传 Windows `.exe`、macOS 通用 `.dmg` / `.zip` 和覆盖三种安装包的 `SHA256SUMS.txt`。预发布版本会标记为 prerelease。
4. 从仓库 **Releases** 下载文件。Actions 同时保留 **VTubeLeaf-windows-运行序号** 和 **VTubeLeaf-macos-universal-运行序号** Artifact 30 天。
5. 将 Release 的三个安装包和 `SHA256SUMS.txt` 下载到同一目录，可执行 `shasum -a 256 -c SHA256SUMS.txt`。DMG 内提供拖到 Applications 的入口；ZIP 内为已公证并附加票据的 `.app`。

构建失败可在 Actions 重跑；也可用 `gh workflow run release.yml --ref v0.1.2` 对已有 tag 重新启动完整发行（替换为实际版本）。已存在同名 Release 时，发布步骤会报错，不覆盖已发布文件。

如只需手动构建 macOS 包，打开 **Actions → Package macOS release → Run workflow**，或运行 `gh workflow run release-macos.yml --ref v0.1.2`，完成后从该次运行的 Artifact 下载；这个入口不创建 GitHub Release。普通分支 push / PR 不使用发行凭据，版本 tag 和手动发行会使用。仅为可信代码创建发行 tag。安装后从 `/Applications/VTubeLeaf.app` 启动并按系统提示批准摄像头扩展。

## DMG 布局与本地预览

正式打包使用 [dmgbuild](https://dmgbuild.readthedocs.io/en/latest/usage.html) 1.6.7，布局配置在 [`scripts/dmg-settings.py`](../scripts/dmg-settings.py)：720 × 440 窗口、玫瑰粉浅色背景、左侧应用和右侧 Applications 入口，隐藏工具栏与侧栏，并提供中英文拖拽提示。背景源文件为 [`background.svg`](../src-tauri/dmg/background.svg)；配套 PNG 分别为 720 × 440 和 1440 × 880，dmgbuild 自动合并 `@2x` 版本以支持 Retina。修改 SVG 后需同步导出两个 PNG。

在 macOS 的仓库根目录运行以下命令，可给已有 `.app` 生成同款 DMG（首次构建应用可先执行 `npm run tauri -- build --bundles app`）：

```sh
python3 -m venv .local/dmgbuild-venv
.local/dmgbuild-venv/bin/python -m pip install dmgbuild==1.6.7
.local/dmgbuild-venv/bin/python tests/dmg.test.py
.local/dmgbuild-venv/bin/python -m dmgbuild -s scripts/dmg-settings.py \
  -D app=src-tauri/target/release/bundle/macos/VTubeLeaf.app \
  VTubeLeaf .local/VTubeLeaf-preview.dmg
```

这个本地命令只生成 DMG，不执行签名或公证。正式流程在应用公证并附加票据后调用相同配置，再对 DMG 签名、公证并校验。不要启用 `hide_extensions`：它会修改应用的 Finder 元数据，导致严格签名校验失败；上述冒烟测试会检查打包后的应用签名。

## 验证与排错

本地可运行不需要 Apple 凭据的检查：

```sh
node scripts/check-macos-release.mjs --self-test
actionlint .github/workflows/*.yml
```

- `Missing …`：检查放在 Secrets / Variables 的位置及名称是否一致。
- 描述文件校验失败：检查 Team ID、App ID、App Group、System Extension 权限和有效期，重新生成正确的 Developer ID 描述文件。
- `codesign` 找不到身份：检查 `.p12` 是否包含私钥、密码是否正确、签名身份是否完整匹配。
- Core 校验失败：重新执行 `npm ci` 和 `npm run setup:assets`；如主动升级依赖，需同步更新固定哈希。
- 公证返回 `Invalid`：查看该步骤的 Apple 结果与诊断日志；超时则去 Apple 查询该次 submission，再按需重新运行。不会降级为未公证包。

本地静态检查不代表真实签名、公证、系统安装或会议应用接入已通过。正式发布前仍需用产物在 Intel / Apple Silicon 上按[验收记录](VALIDATION.md)检查。

参考：[GitHub 证书与描述文件安装](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)、[Apple 分发包签名与公证顺序](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)、[Apple 公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)、[Tauri macOS 应用包](https://v2.tauri.app/distribute/macos-application-bundle/)。
