# 内置 Live2D 模型

Haru、Hiyori、Mao 来自 [Live2D 官方 Cubism SDK for Web 5 R4](https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip) 的 `Samples/Resources/`，与项目固定的 Cubism Core R4 配套。

- 原始 ZIP SHA-256：`d78904d908bd232b800219e01732e4ea2f0562b5e9f35a2670742a1c16d22942`。
- 只保留模型入口及其引用的 moc3、纹理、物理、姿势、参数、表情和动作文件。
- Haru 的语音文件及 `model3.json` 中对应的 `Sound` 引用已移除；其余保留文件与官方包字节一致。
- [LICENSE.md](LICENSE.md) 是 SDK 原始许可说明。角色素材适用 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 及[各模型的使用条款](https://www.live2d.com/en/learn/sample/model-terms/)，不采用本项目 MIT 许可；Hiyori 的角色设计不得修改。

This content uses sample data owned and copyrighted by Live2D Inc.

Tauri 将本目录作为 `models/` 资源随应用打包，无需运行时下载。读取角色库时，缺少的内置模型通过现有资源校验和复制流程写入应用数据目录的 `models/builtin-角色名/`；已有目录不覆盖，预览、构图和用户导入模型继续使用现有角色库机制。
