# 第三方来源与许可状态

核对日期：2026-09-08。本文用于记录资源来源和尚待完成的发行核实，不替代上游完整许可文件。项目自有代码采用 [MIT 许可证](../LICENSE)；不得将第三方资源重新标成项目许可证。

## Live2D

当前渲染适配使用 `pixi-live2d-display@0.4.0` 的 Cubism 路径，需要单独的 Cubism Core。Core R4 与原始许可已封装为仓库内固定 npm 依赖；不附带完整 SDK 或示例模型。

固定依赖采用 [Cubism SDK for Web 5 R4 官方压缩包](https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip)，压缩包 SHA-256 为 `d78904d908bd232b800219e01732e4ea2f0562b5e9f35a2670742a1c16d22942`，Core SHA-256 为 `25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f`。Core 与原始 `LICENSE.md`、`Core/LICENSE.md`、`Core/RedistributableFiles.txt` 封装在 [仓库内 npm 依赖](../vendor/README.md)，版本及完整性由 `package-lock.json` 固定；不包含 SDK 示例模型。SDK 自带 Haru 用于本地开发测试，并已复制到本机应用数据目录、设为启动角色；其条款见压缩包许可文件及 [官方示例模型条款](https://www.live2d.com/en/learn/sample/model-terms/)。模型未打进应用包。

- 官方获取：[Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/)。
- 扩展性应用条款：[Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)。本项目允许用户导入自己的 Live2D 模型，需向 Live2D 核实其适用的 SDK 发行条件；不能因应用免费、源码开放就推断免许可或允许公开发行。
- 该官方页面对免费、无收益的扩展性应用列有特别条件及例外可能性。当前项目**尚未取得适用类别、费用、例外或发行授权的确认**，也没有完成正式许可审查。

发行前必须确认：适用协议与主体、收费或例外条件、可再分发的 Core 文件、必须附带的声明、样例模型是否可随包提供。`manifest.json` 的版本标签和 SHA-256 只记录本地文件，不是授权证明。准备资源后，Vite 会将 `public/runtime/` 内容纳入构建产物，因此 Git 忽略并不免除安装包的许可检查。

## MediaPipe

| 资源                                 | 固定版本/来源                                                                                                                                                 | 当前许可记录                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@mediapipe/tasks-vision` 与 WASM/JS | npm `0.10.32`；[MediaPipe 官方仓库](https://github.com/google-ai-edge/mediapipe)                                                                              | 已安装 npm 包声明 Apache-2.0；发行保留适用的许可与声明                          |
| Face Landmarker `.task`              | [Google 托管模型 `float16/1`](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)；3,758,596 字节 | 官方概览列出的三个组成模型，其模型卡均声明 Apache-2.0；发行时保留适用许可与声明 |

Pose Landmarker Lite 使用 [Google 固定 `float16/1` 模型](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)，5,777,746 字节，SHA-256：`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`。[官方概览](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models)链接的 [BlazePose GHUM 3D 模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)第 2 页声明 Apache License, Version 2.0（2026-09-08 核对）；发行时保留适用许可与声明。

Hand Landmarker 使用 [Google 固定 `float16/1` 模型](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)，7,819,105 字节，SHA-256：`fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`。集成接口见 [官方 Web 指南](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)；默认关闭手部识别。[官方模型卡](<https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf>)第 2 页明确声明 Apache License 2.0，完整许可已纳入随包声明。本地推理测试使用[官方示例笔记本](https://github.com/google-ai-edge/mediapipe-samples/blob/main/examples/hand_landmarker/python/hand_landmarker.ipynb)所引用的 `woman_hands.jpg`，图片不随应用发布。

Face Landmarker SHA-256：`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`。运行文件的大小与哈希在 [setup-assets.mjs](../scripts/setup-assets.mjs) 固定。官方集成说明见 [Face Landmarker Web Guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)。

模型许可依据为[官方概览的模型组成表](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models)及其直接链接的模型卡：[BlazeFace Short Range](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)、[Face Mesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf)、[Blendshape V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf)。三份模型卡的首页均列出 Apache License, Version 2.0；这项记录针对跟踪模型，不延伸至 Cubism Core 或用户角色。

## 可选 OpenSeeFace

来源为 [emilianavt/OpenSeeFace](https://github.com/emilianavt/OpenSeeFace)，安装脚本固定提交 `85aa70fc67582d046e771ea73625182a0d8f7475`，不从第三方镜像或浮动分支下载安装。上游说明其代码与模型采用 BSD-2-Clause；保留 [LICENSE](https://github.com/emilianavt/OpenSeeFace/blob/85aa70fc67582d046e771ea73625182a0d8f7475/LICENSE) 和相关 `Licenses/` 内容。

Python 环境按上游 [pyproject.toml](https://github.com/emilianavt/OpenSeeFace/blob/85aa70fc67582d046e771ea73625182a0d8f7475/pyproject.toml) 的范围安装 NumPy、OpenCV、Pillow、ONNX Runtime。各依赖及其二进制组成部分有各自条款；本项目目前下载到开发者本机的 `.local/`，没有打包 Python 解释器或可分发 sidecar。若以后随安装包提供，需按实际冻结版本补齐依赖清单和声明。

OpenSeeFace 的 BSD 条款不决定 Live2D 渲染端的发布条件，也不证明跟踪效果优于 MediaPipe。

## 可选 NVIDIA RTX（实验中）

原生扩展由开发者使用 NVIDIA AR SDK Core 与 FaceExpressions 等特性构建，依赖 OpenCV 4 及 [NVIDIA AR-SDK-Samples](https://github.com/NVIDIA-Maxine/AR-SDK-Samples) 中的构建模块和图像包装头文件。SDK、模型、OpenCV 和示例代码各自保留原始条款；示例仓库的 MIT 许可不代表专有 SDK 或模型同样采用 MIT。本仓库不下载、打包或分发这些运行库与模型，访问资格和发行条件应按 [NGC Core 页面](https://catalog.ngc.nvidia.com/orgs/nvidia/maxine/resources/ar_sdk_core)及实际下载包核实。安装与当前验证范围见 [NVIDIA-TRACKING.md](NVIDIA-TRACKING.md)。

## 随包声明与更新

完整声明位于 [public/licenses](../public/licenses/)，Vite 将它们复制进 `dist/licenses/`，Tauri 随前端资源一并嵌入。应用「会议」面板的「开源与第三方许可」可离线查看正文。

- [npm.txt](../public/licenses/npm.txt)：锁文件全部非 dev 条目（包含传递依赖、可选依赖）的版本、声明许可及许可证/NOTICE 原文。
- [rust.html](../public/licenses/rust.html)：`cargo-about 0.9.2` 从 Cargo.lock 汇总全部平台及构建依赖的完整许可和精确版本源码链接。清单保守包含未进入某一平台二进制的 crate，不等同于逐二进制 SBOM；MPL-2.0 crate 未经修改，源码可从其中的版本链接获取。
- [resources.txt](../public/licenses/resources.txt)：MediaPipe 模型/WASM、嵌入的 Cubism Framework、Core、Windows BaseClasses 的来源与许可边界，以及 npm 包缺少许可文件时使用的固定版本上游来源。
- `pixi-live2d-display@0.4.0` 的 MIT 许可不覆盖其内嵌 Cubism Web Framework；另行保留其固定子模块提交的 [Live2D 许可原件](../public/licenses/cubism-framework.md)。
- `setup:assets` 从固定 npm 依赖复制 SDK 原始 `LICENSE.md`、`Core/LICENSE.md`、`Core/RedistributableFiles.txt` 至 `runtime/licenses/`，并校验大小和 SHA-256。只更新 MediaPipe 时保留已验证的 Core 声明。

依赖或相关脚本变化后执行：

```sh
cargo install cargo-about --version 0.9.2 --locked --features cli --root .local/license-tools
npm run licenses:generate
npm run licenses:check
```

可用 `CARGO_ABOUT=/path/to/cargo-about` 指定同版本工具。生成会按当前锁文件搜集许可；普通构建执行离线检查，不安装工具、不重新下载。清单输入或输出哈希变化、已安装 npm 版本/声明不匹配、附带 Core 却缺少 SDK 许可都会使构建失败。变更依赖时需重新审阅生成差异；哈希检查不代表法律授权。

项目自有代码采用 [MIT 许可证](../LICENSE)，npm/Cargo 的 `license` 字段均为 `MIT`。生成脚本将根 `LICENSE` 复制到 [vtubeleaf.txt](../public/licenses/vtubeleaf.txt)，随应用分发，并可在应用内选择「VTubeLeaf（MIT）」查看。

## Windows 摄像头 BaseClasses

内置 DirectShow 摄像头复用 Microsoft BaseClasses 的 COM、过滤器和工作线程实现。源码取自 [Softcam 固定提交](https://github.com/tshino/softcam/tree/e89a699ed9932c74f57afe4f396be89665967e00/src/baseclasses)中裁剪后的 BaseClasses，保留 Microsoft 与 Softcam 的 MIT 许可；未复用 Softcam 的摄像头过滤器或帧传输。来源、一个 Clang 兼容修改与完整许可见 [vendor 记录](../native/windows-camera/vendor/README.md)。Windows 安装包随 DLL 携带两份许可文件。

## 模型、品牌和外部软件

- **角色模型：** 用户自行提供；使用权、修改权和再分发权分别核实。加载到应用并不表示可公开分发该角色，仓库目前不提供演示模型。
- **品牌：** 当前 SVG 图形和 VTubeLeaf 几何字标为本项目新绘制路径，没有嵌入第三方字体或图标文件。提案板文字使用系统 sans-serif 渲染；不随包分发字体。尚未做完整名称或商标检索，详见 [BRAND.md](BRAND.md)。
- **OBS Studio：** 可选的外部输出方式，单独安装和使用，不随应用分发。其源码许可为 GPL-2.0-or-later，见 [OBS 官方仓库](https://github.com/obsproject/obs-studio)。VTubeLeaf 内置摄像头不依赖 OBS。
- **飞书及操作系统组件：** 外部运行环境，本项目不再分发，也不据可接入就表示得到厂商背书。

公开发行前仍需确认 Live2D 适用许可；已准备 [Live2D 咨询草稿](LIVE2D-LICENSE-REQUEST.md)。如以后随包提供示例模型、OpenSeeFace 或 Python 环境，需按实际内容重新核实并扩展声明。
