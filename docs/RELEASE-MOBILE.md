# 发布 Android 手机端

手机端独立于桌面端发布：版本来自 `mobile/package.json`，标签为 `mobile-vX.Y.Z`，不会改动桌面版本、更新日志或自动更新清单。目前只发布 Android APK，iOS 仍使用原有 Xcode 构建流程。

## 发布版本标签

在仓库根目录安装依赖（`npm ci`），提交改动并同步远程分支后，选择一个发布命令：

```sh
npm run release:mobile:patch        # 0.1.0 → 0.1.1；首次正式发布可用此命令
npm run release:mobile:minor        # 0.1.1 → 0.2.0
npm run release:mobile -- major
npm run release:mobile -- 1.2.3     # 指定更高版本
npm run release:mobile -- patch --dry-run  # 只预览，不改文件、提交或推送
```

release-it 检查工作区、拉取并检查远程提交，递增手机端版本，创建版本提交和 `mobile-v*` 标签，再推送。Android `versionName` 使用 `mobile/package.json` 中的 `version`，仅支持正式三段版本；`versionCode` 是同一文件中独立保存的整数，从 1 开始。每次发版无论选择补丁、小版本、大版本还是指定版本，`versionCode` 都只加 1，并与版本号一同提交；编号必须在 1–2100000000 内。普通构建、`--dry-run` 和重跑同一标签的 CI 都不会增加编号。
