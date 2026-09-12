# 开发与接入说明

日期：2026-09-08。本文描述当前源码的安装与操作方法；实测边界见 [VALIDATION.md](VALIDATION.md)。

## 环境

- Node.js 24 LTS（或 22.21+ LTS）；本次脚本检查使用 Node.js 24.20.0。release-it 21 要求 Node.js 22.21+ 或 24+，项目测试也使用 Node 的 TypeScript 支持。
- Rust 稳定工具链和各平台的 [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools；Windows 和 Linux 的 WebView、编译工具与系统库按该页面安装。
- 当前打包配置要求 macOS 14.0+，作为禁用后台节流的候选基线；本次仅在 macOS 15.7.4 arm64 编译，最低版本运行表现尚未验证。
- 一台可用摄像头；Windows 与 macOS 都是主要支持目标，必须分别验收系统 WebView、设备权限、应用快捷键、后台运行及会议输出。Linux 暂未验证。
- 你有权使用的 Live2D 模型。Core R4 已固定为项目依赖，模型需自行准备。
- Windows 普通构建包含内置摄像头。macOS 内置摄像头需要完整 Xcode、Camera Extension 签名和系统批准。两个平台也可使用另装的 OBS Studio 输出，见下方说明。

```sh
npm ci
```

## Windows 开发与打包

当前以 Windows 10/11 x64 为开发和验收目标。先按 [Tauri Windows 环境要求](https://v2.tauri.app/start/prerequisites/#windows)安装 Microsoft C++ Build Tools 的「使用 C++ 的桌面开发」（含 MSVC x64/x86、Windows SDK 和 C++ CMake tools）、Microsoft Edge WebView2 Runtime、Node.js 24 和 Rust MSVC 工具链。确保 `cmake --version` 可执行，安装完成后重新打开终端。在项目根目录的 PowerShell 中运行：

```powershell
rustup default stable-msvc
npm ci
npm run setup:assets
npm run setup:assets -- --check
npm run tauri dev
```

普通 Windows 开发和打包无需 Apple 开发者账号。安装包使用 Tauri 的 [NSIS 构建](https://v2.tauri.app/distribute/windows-installer/)：

```powershell
npm test
npm run tauri -- build --bundles nsis
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

安装程序位于 `src-tauri/target/release/bundle/nsis/`，文件名以 `-setup.exe` 结尾。当前没有配置 Windows 代码签名。摄像头或麦克风不可用时，在 Windows 设置的摄像头/麦克风隐私页允许桌面应用访问，再检查 WebView2 权限及设备占用。

Windows 的浏览器测试环境变量使用 PowerShell 语法，例如 `$env:VTUBELEAF_MODEL_FIXTURE = "C:\Models\Haru\Haru.model3.json"`，再运行 `npm run test:browser`。构建时自动编译并携带 64 位、32 位内置摄像头 DLL，供相应位数的桌面会议客户端加载。

[Desktop checks](../.github/workflows/check.yml) 在 Windows 与 macOS runner 上执行 Node 测试、资源脚本自检、固定 Cubism Core 和 MediaPipe 资源校验、Tauri 安装包构建和 Rust 测试；Windows 另运行 x64/x86 摄像头 CTest。CI 从项目依赖取得 Core，不下载整份 Cubism SDK、不发布安装包；构建结果不代表真实摄像头、应用快捷键或会议接入验收通过。新增工作流尚未在远端执行。

## 准备本地运行资源

Windows 另有可选的 **NVIDIA RTX · 实验中** 面捕入口。SDK、模型和原生扩展独立安装，不参与默认构建；步骤及未验证范围见 [NVIDIA-TRACKING.md](NVIDIA-TRACKING.md)。

Cubism Core 使用仓库内固定的 `@vtubeleaf/cubism-core@5.0.0-r.4` npm 依赖，来源为官方 **Cubism SDK for Web 5 R4**。运行 `npm ci` 即可安装，无需下载 SDK 或配置 URL。依赖包仅包含未修改的 Core、三份原始许可/可再分发清单和包元数据，来源与更新方式见 [vendor](../vendor/README.md)。

```sh
npm run setup:assets
npm run setup:assets -- --check
```

2026-09-07 已在本工作区下载并验证 R4，自带 Haru 模型可用于本地测试：`.local/cubism-sdk-5-r.4/CubismSdkForWeb-5-r.4/Samples/Resources/Haru/Haru.model3.json`。最新 R5 的 Core 移除了当前渲染库读取的 `drawables.renderOrders`，实际绘制失败；当前固定使用 R4，不支持 R5 的新渲染接口。新版变化见 [官方兼容说明](https://docs.live2d.com/en/cubism-sdk-manual/compatibility-with-cubism-5-3/)。

此前本机已将这份官方免费 Haru 复制到旧目录 `~/Library/Application Support/com.vtubeleaf.desktop/models/Haru/`，保留来源与许可文件，并在旧版设置中选为启动角色。Bundle ID 改为 `com.moonrailgun.vtubeleaf` 后，应用使用新的数据目录；旧角色和设置仍保留在旧目录，不会自动迁移，可从旧目录重新导入角色。摄像头仍由「开始跟踪」启动。

资源脚本从已安装的依赖复制 Core 和三份原始许可文件，以固定大小和 SHA-256 校验；`--check` 直接校验运行资源。脚本不下载示例角色，旧的 `--sdk` / `--sdk-version` 参数已移除。

默认跟踪资源固定为 `@mediapipe/tasks-vision@0.10.32` 、Face Landmarker 与 Pose Landmarker Lite `float16/1`。脚本从已安装的 npm 包复制 SIMD / 非 SIMD 的 WASM 与 JS，从 Google 的固定模型地址下载 `.task`，对六个文件分别检查大小和 SHA-256。校验失败会报错，不使用未校验的下载内容。

若暂时不准备 Live2D 渲染，只运行资源检查或开发前端：

```sh
npm run setup:assets -- --mediapipe-only
npm run setup:assets -- --check --mediapipe-only
```

资源保存于：

```text
public/runtime/
  manifest.json
  live2dcubismcore.min.js
  mediapipe/face_landmarker.task
  mediapipe/pose_landmarker_lite.task
  mediapipe/wasm/vision_wasm_internal.js
  mediapipe/wasm/vision_wasm_internal.wasm
  mediapipe/wasm/vision_wasm_nosimd_internal.js
  mediapipe/wasm/vision_wasm_nosimd_internal.wasm
```

`public/runtime/` 已被 Git 忽略，但 Vite 构建会将其中资源复制进 `dist/`，所以安装包发行前必须复核实际包含的第三方文件和条款。正常跟踪从这些本地路径加载资源；完成准备后能否在实际安装包中断网运行，仍须按验收表测试。

固定下载地址和哈希保存在 [setup-assets.mjs](../scripts/setup-assets.mjs)，来源记录在本地 `manifest.json`。MediaPipe 的 API 和本地 WASM 配置可参见 [Face Landmarker Web Guide](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)。

## 启动、构建与检查

```sh
npm run tauri dev
```

应用由你主动开始跟踪，不应在启动时自动占用摄像头。允许系统摄像头权限后再检查设备列表；开始后列表下方显示实际使用的摄像头名称，包括选择「系统默认」时。切换设备前停止当前跟踪。macOS 的开发程序和最终签名程序可能对应不同的系统授权记录，需要分别测试。

开启「显示面捕预览」后，默认只显示关键点。「显示真人画面」开关可随时显示或隐藏摄像头画面，默认关闭，选择会保存。隐藏真人画面时，摄像头仍持续采集用于跟踪；该预览不会进入角色输出窗口。

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

打包产物位于 `src-tauri/target/release/bundle/`。本地成功构建不等于应用已签名、公证，或能在另一台电脑直接安装。

浏览器检查使用合成摄像头和软件 WebGL，不访问真实摄像头；运行前先准备 MediaPipe 本地资源。它覆盖摄像头启动/暂停/停止、权限拒绝、异步取消、OpenSeeFace 事件与界面基础行为，不能代替系统 WebView 验收。

可用有权使用的本地人脸图片补充实际识别检查（默认跳过，不下载图片）：

```sh
VTUBELEAF_FACE_FIXTURE=/absolute/path/to/face.png npm run test:browser
```

可同时设置 `VTUBELEAF_MODEL_FIXTURE=/absolute/path/to/Haru.model3.json`，检查真实 Core、模型和纹理在生产 CSP 下渲染，验证参数驱动、表情叠加、动作播放和最终画面参数同步，并导出截图到 `test-results/`。另有界面流程检查覆盖按模型恢复映射、应用快捷键触发和录制导出请求。没有提供模型时这些项目跳过；相关 IPC 使用测试替身，不代表原生导入或保存对话框通过。

额外设置 `VTUBELEAF_ALT_MODEL_FIXTURE=/absolute/path/to/Wanko.model3.json` 可检查没有标准参数和表情的 Wanko：自定义参数映射、动作播放和渲染均可继续工作。

使用 `VTUBELEAF_MODEL_FIXTURE` 运行 `cargo test --manifest-path src-tauri/Cargo.toml imports_supplied_model_and_reads_all_resources -- --ignored`，可检查 Rust 正式导入器的文件、目录、ZIP 三种入口及全部声明资源的读取。Haru、Wanko 已分别通过，ZIP 导入资源与原文件逐字节一致；原生选择对话框仍待实测。

## 导入与调节模型

1. 在「角色库」点击「添加角色」，选择模型文件夹，或在同一个文件选择框中选 `.model3.json` / ZIP；也可把一个或多个模型拖到桌面窗口。旁边的文件夹图标可直接打开应用管理的角色库目录。目录中有多个入口时直接选所需 `.model3.json`。不要只选纹理图片。
2. 保留 `.moc3`、纹理及入口引用资源的相对目录结构。导入会检查引用资源是否存在，以及资源是否越出模型目录；ZIP 还会检查路径、数量和大小边界。
3. 模型入口采用 Cubism `model3.json` 格式。实际 Cubism 版本兼容性由固定的 Core、渲染库和具体模型共同决定；本项目还没有完成版本覆盖测试，不能据入口可读就保证所有 Cubism 3/4/5 模型渲染正确。
4. 开始跟踪后，面向摄像头保持自然姿态，执行中立姿态校准，再调节头部、眼睛、嘴部灵敏度与平滑。
5. 分别核对预览镜像和动作镜像。用转头、单眼闭合测试左右关系，避免在 OBS 中再次镜像后方向混乱。
6. 调整缩放、水平/垂直位置和纯色背景，点击顶部「直播模式」供 OBS 捕获主窗口。

导入会把入口及其声明的运行资源复制到应用数据目录的 `models/`；ZIP 包解压到独立角色目录。原始文件保持不变，移动原文件不会影响库内副本。相同来源再次导入会新增一份副本；库内角色切换不会重复复制。

「角色库」显示方形头像，点击即可切换并恢复该角色的构图、映射及快捷键。优先读取模型入口同目录下的 `icon`、`ico_模型名`、`模型名_icon`、`avatar`、`portrait`、`thumbnail`、`preview` 或模型同名图片，支持 PNG/JPG/WebP（不超过 4 MB），导入时一起保留。没有图片的角色会自动在后台生成头像，无需逐个点击；生成结果缓存到 `avatars/`，下次启动直接读取。当前最多一次拖入 32 个项目，失败项会提示，其余项目继续导入。

「角色文件夹」显示实际保存路径；macOS 默认为 `~/Library/Application Support/com.moonrailgun.vtubeleaf/models/`。应用启动时扫描角色库，损坏角色不会阻止其他角色显示。模型缺少某个常见参数时，该动作可能无法显示；资源已修改时可重新导入更新后的模型。

## 角色参数、表情与动作

在「角色」页选择模型参数和跟踪输入，设置输入范围、输出范围及平滑时间后点击「应用映射」。实时输入值可帮助确定范围；交换输出上下限可反向，「恢复自动」恢复该参数的默认映射。只有模型实际提供的参数才能驱动；尚无数据的可选输入不会伪造跟踪值。

MediaPipe 提供眼神、眉毛、嘴部左右和头部位移输入。OpenSeeFace 提供眉毛、嘴部左右和位移，当前不提供眼神输入。两个引擎的位移尺度不同，切换后重新校准并查看实时数值调整范围。映射、校准、灵敏度、平滑、动作镜像、构图、待机与快捷键按模型路径保存；摄像头、引擎和背景等为全局设置。

在「眼睛、嘴部与丢脸恢复」可采样闭眼端点；尚未采样时可调整「闭眼阈值」，默认 0.25：归一化后的眼睛开度低于阈值时按完全闭眼处理，闭眼仍不完整时可逐渐调高。眼睛与嘴巴默认映射使用 Cubism 的常规 0–1 开度，模型用于夸张表情的额外范围不会被默认占满；自定义映射仍使用你设定的范围。先自然睁眼校准，再检查单眼和双眼闭合；阈值按角色保存。

模型入口声明的表情可通过按钮叠加，再次点击关闭。动作支持单次、循环和保持末帧；「停止动作」释放动作占用的参数，使其恢复面捕驱动。待机动作可选择或关闭，有面捕输入时以跟踪为先；主动播放的动作优先控制其声明的参数，表情随后叠加，模型物理继续参与最终绘制。自动眨眼可单独开关。

「应用快捷键」中选择表情、动作或停止操作，再填写 `Space`、`A` 或 `Control+Shift+1` 等按键并应用。快捷键默认不绑定，冲突或无效组合会提示；切换模型会更换绑定。桌面版和浏览器开发页都只在应用窗口或页面获得焦点时响应，编辑输入框时不触发；不会注册系统全局快捷键，也不会占用其他应用的按键。

「动作录制」只在手动开始后记录角色最终参数，最长 60 秒、每秒最多 30 帧；停止后保存为 Cubism `.motion3.json`。不记录摄像头画面或声音，开始新录制会替换未保存的上一段。导出的文件可用于支持该格式的工具；重新用于模型时需要在模型入口中声明动作并重新导入。输出窗口同步最终参数及部件透明度，包含表情、动作和物理结果。

## 上半身识别

「面捕 → 识别上半身」默认开启，停止跟踪后可以关闭以减少计算量。与面捕共用同一路视频，不再打开第二个摄像头；资源加载或姿态推理失败时继续面捕，并在开关下显示原因。模型使用本地 Pose Landmarker Lite，默认每秒最多 10 次，可在采集质量中调整。面部、身体与手部分别限速；这不是实际设备帧率保证。

保持双肩入镜，预览中的金色线段表示通过可见性检查的肩膀、躯干和手臂。双肩可见时，身体左右转动与侧倾自动驱动 `ParamBodyAngleX/Z`；双侧髋部也入镜时，前后倾斜驱动 `ParamBodyAngleY`。未识别到对应部位时，该轴平滑回退为原来的轻微随头动作，没有头部信号则回默认值。人脸暂时丢失时，可见的身体仍继续驱动，面部参数平滑回中立。置信度较低或出框的关节不输出动作信号。

常见参数 `ParamArmLA/RA` 自动绑定左右抬臂，`ParamArmLB/RB` 自动绑定左右屈肘；其他参数可在自定义映射中选择「左/右上臂抬起」「左/右肘弯曲」。校准前，抬臂输入约为 0（垂下）、0.5（平举）、1（举过头）；屈肘约为 0（伸直）到 1（完全折起）。按自然姿态校准后，这些输入表示相对校准时的变化；可依据实时值调整输入上下限和模型输出范围。镜像会交换两侧手臂输入。遮挡时身体/手臂参数平滑回默认值。

身体角度沿用头部灵敏度和平滑设置，校准时也保存身体姿态。没有对应参数的角色不会凭空增加可动部位；可额外开启下述手指识别；当前没有手势快捷键和腿部驱动。OpenSeeFace 当前仍只提供面部输入。

可选真实推理检查使用 Google 托管的 [pose.jpg 示例](https://storage.googleapis.com/mediapipe-assets/pose.jpg)与[人脸示例](https://developers.google.com/static/mediapipe/images/solutions/examples/face_landmark.png)，保存在本机后执行：

```sh
VTUBELEAF_POSE_FIXTURE=/absolute/path/to/pose.jpg \
VTUBELEAF_FACE_FIXTURE=/absolute/path/to/face_landmark.png \
npx playwright test -g 'upper body uses real'
```

此检查的裁切坐标针对这些示例，先验证完整身体和仅肩膀的姿态输出，再换为仅脸部图片，验证身体信号清空且面捕继续。姿态示例的侧脸未通过人脸检测，因此不将其作为同时识别脸部和身体的证据；不会访问真实摄像头。实现依据见 [Pose Landmarker Web Guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)。

## 校准、采集质量与双手

中立校准会先留出一秒准备，再采样约 1.6 秒；至少需要跨越一秒的 12 个有效帧。保持自然睁眼、放松嘴巴并正视镜头，头部明显移动或样本不足会提示失败并保留旧校准。随后可在眼睛设置里单独采样双眼闭合。停止、暂停、切换引擎或角色会取消采样。

双眼联动支持关闭、始终平均和仅侧脸联动。默认保留正面单眼动作；转头超过可调角度后逐渐跟随靠近镜头的一侧。丢失输入时可选择回到中立或保持最后动作。

「采集质量与帧率」提供 360p / 720p / 1080p 与 15 / 24 / 30 / 60 FPS 请求，身体、手部可独立设为 5 / 10 / 15 / 30 Hz。修改采集设置需要先停止；实际分辨率与帧率由设备协商，面板显示实际采集配置、输入计数和推理耗时。画面可独立设为 30 / 60 FPS。推理仍在主线程串行运行，高分辨率及同时启用身体、双手可能达不到请求帧率。

「识别双手与手指」默认关闭。开启后提供每只手的检测状态、位置、平面旋转、整体张开度与五指伸展度，可在「角色 → 参数映射」绑定模型已有参数。位置和旋转范围为 -1 至 1，检测状态、张开度与手指范围为 0 至 1；Z 根据画面中的手掌大小估计相对远近，不是实际距离。手指不随中立校准扣除开度。动作镜像会交换左右手并反转横向位置和旋转。模型没有手部参数时无法显示手指动作；手势触发快捷键尚未实现。

## 麦克风口型与物理效果

麦克风默认关闭，在「面捕 → 麦克风口型」选择设备后手动开启；只在本机分析音量和频谱，不录音、不播放回声。音量模式无需元音校准；可调整增益、噪声门限及与摄像头口型的混合比例，无摄像头时也能驱动嘴巴。

元音模式需要依次采样 A / I / U / E / O，每次持续发声约一秒。五项齐全后按个人频谱计算元音权重，否则沿用音量口型；独立元音输入可绑定角色已有口型参数。此实现是 MFCC 模板匹配，真实语音、噪声和不同麦克风的识别质量仍需实测。切换角色、停止跟踪、关闭麦克风或退出应用会释放音频资源，采样期间暂停会取消该次校准。

「角色 → 物理效果」提供整体强度、横向风力、计算帧率与各物理组强度；无物理资源的模型不显示调节项。校准、眼睛联动、口型模式/元音模板和物理调节按角色保存；采集设备、音频增益/门限与画面帧率为全局设置。独立输出窗口接收已经计算的最终模型参数。

## 可选 OpenSeeFace

默认 MediaPipe 不需要 Python。OpenSeeFace 是额外的本地进程方案；上游代码、ONNX 模型与本项目适配的来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。

准备 Git 和 Python **3.10**。安装脚本固定上游提交 `85aa70fc67582d046e771ea73625182a0d8f7475`；该提交的 `pyproject.toml` 声明 Python `<3.11`，此安装路径统一要求 3.10，以免误用系统更新版本。

```sh
npm run setup:openseeface -- --python /absolute/path/to/python3.10
npm run setup:openseeface -- --check
```

脚本在 `.local/openseeface/` 下载固定源码，在 `.local/openseeface-venv/` 创建独立环境，按上游版本约束安装 NumPy、OpenCV、Pillow 和 ONNX Runtime，并写入 `.local/openseeface-resolved.txt` 记录实际解析版本。OpenCV 额外限制为 `<4.12`：4.12 的 Python 3.10 包要求 NumPy 2，与固定上游的 NumPy `<2` 冲突，见 [PyPI 包元数据](https://pypi.org/pypi/opencv-python/4.12.0.88/json)。Python 包并非跨平台完整锁定；在每种目标系统上重新安装和检查，不能从此记录推断二进制兼容性。`--check` 只验证源码版本和 Python 导入，不打开摄像头。

安装后，可用有权使用的本地人脸视频或图片验证真实推理和 UDP 输出；脚本拒绝摄像头编号，收到三个有效包后回收测试进程，超时为 45 秒：

```sh
.local/openseeface-venv/bin/python scripts/check-openseeface.py /absolute/path/to/face.png
```

**由 VTubeLeaf 启停进程：** 选择 OpenSeeFace，引擎设置中同时填写脚本打印的 Python 和 `scripts/run-openseeface.py` 绝对路径，设置摄像头索引（默认 0）和端口（默认 11573）。macOS/Linux 的 Python 一般位于 `.local/openseeface-venv/bin/python`，Windows 为 `.local/openseeface-venv/Scripts/python.exe`。仅填写其中一个路径会被拒绝。

**自行启动进程：** 在 VTubeLeaf 中将这两个路径都留空，开始接收，再从项目目录运行：

```sh
.local/openseeface-venv/bin/python scripts/run-openseeface.py --ip 127.0.0.1 --port 11573 --capture 0 --faces 1 --visualize 0 --silent 1
```

Windows 将命令中的 Python 路径替换为 `.local/openseeface-venv/Scripts/python.exe`。端口必须与应用设置一致。参数来自固定上游的 [facetracker.py](https://github.com/emilianavt/OpenSeeFace/blob/85aa70fc67582d046e771ea73625182a0d8f7475/facetracker.py)。

接收端仅绑定本机 `127.0.0.1`。应用只管理它自己启动的子进程；外部启动的 OpenSeeFace 需要你自行停止，即使应用已停止接收，它仍可能占用摄像头。切换回 MediaPipe 前结束外部进程，再开始采集。

本机已安装并用人脸图片验证真实 OpenSeeFace 推理与 UDP 输出。随附启动脚本明确选择 CPU：本机默认 CoreML 路径两次未能在 45 秒内输出有效包，CPU 路径成功；上游源码保持未修改。此选择也适用于应用托管和手动启动。尚未通过真实摄像头比较两种引擎，不能据此宣称动态效果、会议延迟或跨平台支持已达标。

## OBS 与飞书会议

1. 在 VTubeLeaf 中确认模型、跟踪和构图正常，点击顶部「直播模式」。角色舞台始终铺满窗口，工具栏、设置、状态和摄像头预览全部隐藏，跟踪继续运行。回到该窗口按 `Esc` 恢复面板，构图不变。
2. 在 OBS 新建场景：Windows 使用「窗口捕获」，macOS 使用「macOS 屏幕捕获」并允许屏幕录制权限，选中 **VTubeLeaf** 主窗口。只保留角色和纯色背景，裁掉标题栏与边缘；检查没有设置界面或摄像头原画。
3. 根据使用场景设置 OBS 画布和输出尺寸，检查角色在 16:9 会议画面中的完整性。
4. 在 OBS 点击“启动虚拟摄像头”。具体平台安装和启动方法参见 [OBS Virtual Camera Guide](https://obsproject.com/kb/virtual-camera-guide)。
5. 在飞书会议的视频设备里选择 **OBS Virtual Camera**。麦克风继续选原来的设备；基于面部的嘴型跟踪不需要 VTubeLeaf 采集麦克风。
6. 用第二个会议端确认最终画面和延迟。将飞书置前、遮挡或最小化 VTubeLeaf，分别记录表现，不仅查看自己的会议预览。
7. 会议结束后停止 OBS 虚拟摄像头与 VTubeLeaf 跟踪；若 OpenSeeFace 是手动启动的，也结束该进程。

若需要边调整边直播，可改用顶部「独立输出窗口」，在 OBS 中选择 **VTubeLeaf Output**；这个窗口只包含角色与背景。主窗口直播模式中按 `Esc` 会让面板重新进入主窗口捕获画面，调整前可先在 OBS 切换场景。

macOS 捕获权限、OBS 虚拟摄像头安装或会议端无法识别时，按 [OBS 官方故障说明](https://obsproject.com/kb/virtual-camera-troubleshooting)逐项排查。本仓库没有记录这条真实会议链路的通过证据。

## 常见问题

| 表现                     | 检查项                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| 提示 Cubism Core 缺失    | 执行 `npm ci`、`npm run setup:assets`，再执行 `--check`                         |
| 模型不能加载             | 看具体错误：入口、Moc、纹理、引用目录和 Core 版本；先确保资源齐全               |
| 摄像头不能启动           | 系统权限、设备连接、其他程序占用；停止另一个跟踪引擎后重试                      |
| OpenSeeFace 没有数据     | Python/脚本路径必须同时填写或都为空；确认进程、摄像头索引、本机端口一致         |
| 角色嘴巴不闭合或眼睛半闭 | 重新校准，再逐项调整眼睛/嘴部灵敏度和平滑；核对模型参数                         |
| OBS 有画面，飞书没有     | 确认虚拟摄像头已启动、飞书选中对应设备，并从第二端观察                          |
| 切到飞书后停止跟踪       | 属于待验证的 WebView 后台行为；记录系统、窗口状态和引擎，不以浏览器运行结果替代 |

## 道具、场景与 VTS 配置

「画面」页可添加 PNG/JPEG/GIF 道具、图片背景及角色库中的 Live2D 道具；GIF 自动播放，Live2D 道具循环其第一个动作。可编辑位置、缩放、旋转、不透明度、显隐、前后层级、锁定，以及跟随角色整体构图。每个场景最多 32 个道具，其中最多 4 个 Live2D 道具。图片导入后复制到本机应用素材目录，删除道具不会删除可能被其他场景使用的素材。

选择道具后可在舞台拖动或滚轮缩放；取消选择后操作主角色。锁定道具后不能拖动或缩放。「保存为新场景」保存主角色、构图、背景和全部道具；可更新、重命名、删除和切换。载入素材失败保留原场景。独立输出窗口同步道具和动画的最终状态。

「角色 → 应用快捷键」可绑定跟踪启停、暂停/恢复、校准、麦克风口型、虚拟摄像头启停、角色显隐、复位、打开输出、切换场景和显隐道具，也保留表情及动作控制。通用操作的绑定跨角色保留，表情和动作绑定按角色保存。所有绑定仅在应用窗口或页面获得焦点时生效，切换到其他应用后停止响应；冲突会提示。

加载角色后点击「导入 VTube Studio 配置」，选择该角色的 `.vtube.json`。只合并可对应的映射、快捷键和待机设置；导入结果和兼容性提示按模型保存。旧配置及 VTS 中标记为全局的绑定也按应用快捷键处理，保留表情松开恢复、定时恢复及动作播放行为。完整边界见 [VTS-COMPATIBILITY.md](VTS-COMPATIBILITY.md)。

## Windows 内置虚拟摄像头

Windows 10/11 x64 版通过 DirectShow 提供 `VTubeLeaf Camera`。在「接入」页点击「安装虚拟摄像头」，注册到当前 Windows 用户，再点击「启动虚拟摄像头」。重新打开会议软件的摄像头列表，选择 `VTubeLeaf Camera`；麦克风仍选择原有设备。开发使用无需 OBS、开发者账号或管理员提权。

输出固定为 1280×720、30 FPS，只包含舞台和道具，不包含设置面板或真人预览。未启动、停止或超过 500 ms 没有新帧时输出黑画面。应用和摄像头各保留一个最新帧，避免积压。已同时提供 64 位、32 位摄像头 DLL；当前应用本身只构建 x64，ARM64 原生应用和仅接受 Media Foundation 设备的客户端不在此实现范围内。

关闭使用该设备的会议软件后，可在「接入」页卸载摄像头。NSIS 卸载程序也会清理属于本安装路径的注册；升级或移动开发目录后，如设备消失或路径变化，请从新版本重新安装摄像头。实现已通过两种位数的交叉编译，真实 Windows 安装、设备枚举、跨进程传帧与会议兼容性仍待验证。构建、CTest 与验收步骤见 [Windows Camera 说明](../native/windows-camera/README.md)。

## macOS 内置虚拟摄像头

「接入」页提供安装、启动、停止和移除操作。输出为 1280×720、30 FPS，只提交舞台角色和道具，按选定背景色填充留白。普通 `tauri build` 不内嵌扩展，必须按 [Camera Extension 打包说明](../native/macos-camera/README.md)提供明确的团队签名与两个 provisioning profile，并将扩展嵌入应用后签名、公证。将签名应用放入 `/Applications`，再从应用发起安装并在系统设置批准。

启动后在会议软件选择 `VTubeLeaf Camera`。当前已完成未签名编译及帧处理检查，尚未完成签名安装、系统枚举或会议软件接入实测。Linux 继续使用 OBS。

NDI 是通过局域网传输实时音视频的技术，可把画面送到另一台电脑或支持 NDI 的软件；虚拟摄像头则让本机会议软件把画面当作摄像头。此版本没有集成 NDI。参见 [NDI 官方介绍](https://ndi.video/tech/)。
