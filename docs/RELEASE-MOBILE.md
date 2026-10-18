# 发布 Android 手机端

手机端独立于桌面端发布：版本来自 `mobile/package.json`，标签为 `mobile-vX.Y.Z`，不会改动桌面版本、更新日志或自动更新清单。目前只发布 Android APK，iOS 仍使用原有 Xcode 构建流程。

## 签名配置（首次设置）

正式 APK 必须一直使用同一个签名密钥。私钥和密码保存在仓库之外，并另外离线备份；不要提交到 Git。仓库只保存公开的证书 SHA-256 指纹 `mobile/android/signing-certificate.sha256`，CI 会核对 APK 的签名，避免误换密钥导致无法覆盖安装。

在仓库的 GitHub Actions Secrets 中配置：

| Secret                      | 内容                     |
| --------------------------- | ------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | JKS 密钥库的 Base64 内容 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码               |
| `ANDROID_KEY_ALIAS`         | 签名密钥别名             |
| `ANDROID_KEY_PASSWORD`      | 签名密钥密码             |

本地打包时使用上述后三个环境变量，另设 `ANDROID_KEYSTORE_PATH` 为密钥库的绝对路径，然后运行：

```sh
cd mobile/android
./gradlew --no-daemon assembleRelease testReleaseUnitTest
```

产物为 `app/build/outputs/apk/release/app-release.apk`。缺少签名配置会终止 Release 构建，调试构建不受影响。调试版和正式版签名不同，已安装调试版的用户需要先卸载（会清除手机端本地数据），之后的正式版本可覆盖升级。

## 发布

1. 在 `mobile/RELEASE_NOTES.md` 写好本次手机端的英中双语说明，然后提交改动并同步远程分支。
2. 在仓库根目录安装依赖（`npm ci`），选择一个发布命令：

```sh
npm run release:mobile:patch        # 0.1.0 → 0.1.1；首次正式发布可用此命令
npm run release:mobile:minor        # 0.1.1 → 0.2.0
npm run release:mobile -- major
npm run release:mobile -- 1.2.3     # 指定更高版本
npm run release:mobile -- patch --dry-run  # 只预览，不改文件、提交或推送
```

release-it 检查工作区、拉取并检查远程提交，递增手机端版本，创建版本提交和 `mobile-v*` 标签，再推送。Android `versionName` 使用 `mobile/package.json` 中的 `version`，仅支持正式三段版本；`versionCode` 是同一文件中独立保存的整数，从 1 开始。每次发版无论选择补丁、小版本、大版本还是指定版本，`versionCode` 都只加 1，并与版本号一同提交；编号必须在 1–2100000000 内。普通构建、`--dry-run` 和重跑同一标签的 CI 都不会增加编号。

终端的 Changelog 按改动路径筛选，只列出 Android 代码、手机端版本与发布说明、Android 版本检查脚本及手机端 CI 的相关提交；范围从上一个 `mobile-v*` 标签开始，首次发布则筛选全部历史。纯桌面、iOS 或官网改动不会列入。GitHub Release 正文仍使用 `mobile/RELEASE_NOTES.md`。

3. 查看 [Release mobile 工作流](../.github/workflows/release-mobile.yml)。它校验标签、构建和测试正式 APK，核对签名、包名和版本，生成 `SHA256SUMS.txt`，上传后公开 GitHub Release。命令完成只代表标签已推送，不代表打包成功。

手机端 Release 明确设置为 `latest=false`，因此桌面更新器的 `releases/latest/download/latest.json` 仍指向桌面版本。若构建失败，修复问题后重新运行工作流；手动运行时必须选择与版本匹配的 `mobile-v*` 标签。若上传后留下草稿，应先检查并清理该草稿再重新发布，避免同标签冲突。

## 官网下载

发布成功后自动更新 `website/public/mobile-release.json`。官网首屏内置最近一次构建的清单，并在访问时刷新；清单只有在匹配的正式 APK 已上传且非空时才能更新。首次发布前显示「Android APK 即将发布」，不会生成不存在的下载链接。

桌面与手机端使用独立清单；手机端从所有已发布的正式移动版本中选择最高版本，重跑旧版本不会回退下载链接。只有官网更新任务失败时，可单独重跑失败的 job，或在已同步的工作区执行：

```sh
node scripts/update-website-release.mjs --mobile --dry-run
node scripts/update-website-release.mjs --mobile
```

第二条会通过 GitHub API 提交官网清单至 `main`，需要仓库写权限。
