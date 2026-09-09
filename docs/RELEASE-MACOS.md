# GitHub Actions macOS 正式打包

[Package macOS release](../.github/workflows/release-macos.yml) 手动构建 **macOS 14+、Intel / Apple Silicon 通用的 Release 应用**，包含 Cubism Core R4、MediaPipe 本地资源、许可声明和内置 Camera Extension。

流程为：检查必需配置 → 测试 → 校验并准备资源 → Tauri release 构建 → 嵌入摄像头扩展 → Developer ID 签名 → Apple 公证应用并附加票据 → 生成 ZIP / DMG → 签名、公证 DMG 并附加票据 → 校验签名与 Gatekeeper → 上传产物。任何签名、公证或资源检查失败都会终止，不上传未完成的包。

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

`.p12` 密码、Key ID 与 Issuer ID 直接填原文。临时钥匙串密码由 runner 随机生成，无需配置；上传 Actions 产物使用 GitHub 提供的令牌，无需个人 PAT。

Cubism Core R4 已固定为仓库内的 npm 依赖，由 `npm ci` 安装；工作流从依赖复制 Core 和原始许可文件，不下载整份 SDK，也不需要 `LIVE2D_SDK_URL` 或 `LIVE2D_SDK_SHA256`。版本、来源和完整性记录见 [vendor](../vendor/README.md)，公开分发条件见 [第三方许可](THIRD_PARTY.md)。

## 3. 运行和下载

1. 将工作流、脚本及应用源码提交到仓库；手动运行入口要求工作流文件已存在于默认分支。
2. 正式版本号来自源码。发新版本前同步 `package.json`、`package-lock.json` 根包版本、`src-tauri/Cargo.toml` / `Cargo.lock` 和 `src-tauri/tauri.conf.json`，再执行 `npm run licenses:generate` 更新许可清单。
3. 打开 **Actions → Package macOS release → Run workflow**，选择准备发行的可信分支或标签。不要在未审核的代码上运行带签名凭据的工作流。
4. 成功后下载该次运行的 **VTubeLeaf-macos-universal-运行序号** Artifact。内含 `VTubeLeaf-版本-macos-universal.dmg`、同名 `.zip` 和 `SHA256SUMS.txt`，保留 30 天。
5. 解压外层 Artifact 后可执行 `shasum -a 256 -c SHA256SUMS.txt`。DMG 内提供拖到 Applications 的入口；ZIP 内为已公证并附加票据的 `.app`。

工作流只生成正式发行文件，不自动创建或发布 GitHub Release。不会通过 push / PR 自动使用发行凭据。安装后从 `/Applications/VTubeLeaf.app` 启动并按系统提示批准摄像头扩展。

## 验证与排错

本地可运行不需要 Apple 凭据的检查：

```sh
node scripts/check-macos-release.mjs --self-test
actionlint .github/workflows/release-macos.yml .github/workflows/check.yml
```

- `Missing …`：检查放在 Secrets / Variables 的位置及名称是否一致。
- 描述文件校验失败：检查 Team ID、App ID、App Group、System Extension 权限和有效期，重新生成正确的 Developer ID 描述文件。
- `codesign` 找不到身份：检查 `.p12` 是否包含私钥、密码是否正确、签名身份是否完整匹配。
- Core 校验失败：重新执行 `npm ci` 和 `npm run setup:assets`；如主动升级依赖，需同步更新固定哈希。
- 公证返回 `Invalid`：查看该步骤的 Apple 结果与诊断日志；超时则去 Apple 查询该次 submission，再按需重新运行。不会降级为未公证包。

本地静态检查不代表真实签名、公证、系统安装或会议应用接入已通过。正式发布前仍需用产物在 Intel / Apple Silicon 上按[验收记录](VALIDATION.md)检查。

参考：[GitHub 证书与描述文件安装](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)、[Apple 分发包签名与公证顺序](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)、[Apple 公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)、[Tauri macOS 应用包](https://v2.tauri.app/distribute/macos-application-bundle/)。
