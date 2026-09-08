# Cubism Core 固定依赖

`vtubeleaf-cubism-core-5.0.0-r.4.tgz` 是项目内的 npm 依赖包，`package.json` 通过 `file:` 引用，`package-lock.json` 记录包的完整性。`npm ci` 从仓库安装，无需联网下载 Live2D SDK；依赖包不发布到 npm registry。`5.0.0-r.4` 表示所取 SDK 的版本，不是 Core 内部 API 版本。

- 来源：[Live2D 官方 CubismSdkForWeb-5-r.4.zip](https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip)。
- 原始 ZIP SHA-256：`d78904d908bd232b800219e01732e4ea2f0562b5e9f35a2670742a1c16d22942`。
- Core SHA-256：`25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f`。
- 包内只有 `Core/live2dcubismcore.min.js`、`LICENSE.md`、`Core/LICENSE.md`、`Core/RedistributableFiles.txt` 和 `package.json`。前四个文件与官方 SDK 字节一致，未包含示例模型或其他 SDK 文件。
- Core 保留 Live2D 专有许可，不采用项目 MIT 许可；应用发行条件见 [第三方许可记录](../docs/THIRD_PARTY.md)。

检查包内容：

```sh
tar -tzf vendor/vtubeleaf-cubism-core-5.0.0-r.4.tgz
```

升级时从官方 SDK 取上述四个原始文件，保留目录结构，并为依赖包更新版本和来源后运行 `npm pack`。用 `npm install --save-exact ./vendor/新包名.tgz` 更新依赖及锁文件，同步 `scripts/setup-assets.mjs` 的版本和文件哈希，执行资源脚本自检、资源准备、`npm run licenses:generate` 和构建。当前渲染库不兼容 R5，升级前需实际验证模型渲染。
