# NVIDIA RTX 面捕（实验中）

这是可选的 Windows 面捕引擎。界面、表情转换和进程通信已接入；**尚未在 Windows 编译原生扩展，也未用 RTX 显卡、真实摄像头验证**。默认引擎仍为 MediaPipe，普通开发和打包无需安装 NVIDIA SDK。

## 和现有方案的区别

|              | MediaPipe（默认）                     | NVIDIA RTX（实验中）                      |
| ------------ | ------------------------------------- | ----------------------------------------- |
| 平台与硬件   | 当前使用 CPU 推理，面向 Windows/macOS | Windows x64、SDK 支持的 NVIDIA RTX GPU    |
| 当前接入能力 | 面部、头部旋转/位移、可选身体和手指   | 面部、头部旋转、眼神、眉毛、嘴部左右      |
| 预览         | 摄像头和关键点预览                    | 当前不提供摄像头预览                      |
| 安装         | 默认跟踪资源随应用准备                | SDK、模型、原生扩展单独安装               |
| 效果         | 仍需按设备校准                        | 未做同设备对比，不能认定比 MediaPipe 更好 |

VTube Studio 也提供 NVIDIA 摄像头追踪，但它的集成和调参不等于本项目的效果。[VTube Studio 官方说明](https://github.com/DenchiSoft/VTubeStudio/wiki/NVIDIA-Webcam-Tracker)将其作为可选面捕方案；本项目直接使用 NVIDIA AR SDK，不调用 VTube Studio。

当前扩展只打开一路摄像头，不同时运行 MediaPipe 身体/手指推理。它使用 FaceExpressions 的 3DOF 旋转模式，不输出头部 XYZ 位移。切换引擎后重新校准中立姿态，并检查左右方向、闭眼和嘴型；模型本身也需要对应参数。

## 准备 SDK 和构建工具

1. 在 Windows x64 安装 Visual Studio 2022 C++ 桌面开发工具、CMake 3.24+ 和 OpenCV 4 的 Windows x64 开发包。下面假设 OpenCV 解压到 `C:\SDK\opencv`，其中 `build` 包含 `OpenCVConfig.cmake`。
2. 按 [NVIDIA 系统要求](https://docs.nvidia.com/maxine/ar/latest/WindowsARSDK/Windows.html)核对 GPU 与驱动。本接入以 **AR SDK Core 1.1.1.0 Windows** 和对应版本特性为目标，不兼容 VTube Studio 旧版安装指引中的 0.8.x SDK。
3. 从 [NGC AR SDK Core](https://catalog.ngc.nvidia.com/orgs/nvidia/maxine/resources/ar_sdk_core)获取 SDK，自行完成 NVIDIA 账户、访问资格和许可确认。解压到例如 `C:\SDK\ARSDK`，按[官方安装说明](https://docs.nvidia.com/maxine/ar/latest/WindowsARSDK/InstalltheARSDK.html)执行其中的特性安装脚本，安装 `nvarfaceexpressions`、`nvarlandmarkdetection`、`nvarfaceboxdetection`，以及与你的 GPU 匹配的模型。
4. 保留完整 SDK 目录结构：`nvar/include`、`nvar/src`、`bin`、`bin/models`、`features`、`external`。模型目录应包含安装脚本为上述特性准备的文件，不能只填写 SDK 压缩包或任意空目录。先按 NVIDIA 指引运行其 ExpressionApp 验证 SDK 安装。

SDK Core 与特性现在分开分发，具体访问条件以 NGC 页面为准。VTubeLeaf 不代为登录、接受条款或下载专有 SDK，也不附带这些 DLL 和模型。

## 编译原生扩展

在 VTubeLeaf 项目根目录的 PowerShell 中运行。路径按本机安装位置修改：

```powershell
$sdk = 'C:\SDK\ARSDK'
$opencv = 'C:\SDK\opencv\build'
git clone https://github.com/NVIDIA-Maxine/AR-SDK-Samples.git .local/AR-SDK-Samples
cmake -S native/nvidia-tracker -B .local/nvidia-build -G 'Visual Studio 17 2022' -A x64 `
  "-DARSDK_ROOT=$sdk" `
  "-DARSDK_SAMPLES_DIR=$((Resolve-Path .local/AR-SDK-Samples).Path)" `
  "-DOpenCV_DIR=$opencv"
cmake --build .local/nvidia-build --config Release
```

项目复用 NVIDIA 示例仓库的 `FindARSDK.cmake` 和 OpenCV 图像包装头文件。配置时检查 SDK、OpenCV 及三个特性是否存在；运行时检查 FaceExpressions 必须输出 53 个系数，防止不同布局错误驱动角色。SDK 调用方式参考[官方 ExpressionApp](https://github.com/NVIDIA-Maxine/AR-SDK-Samples/tree/main/apps/ExpressionApp)，系数和旋转定义见[官方属性表](https://docs.nvidia.com/maxine/ar/latest/API/Architecture/properties.html)与[结构定义](https://docs.nvidia.com/maxine/ar/latest/API/Reference/structures.html)。

在独立目录集中放置扩展与运行库，模型可以继续保存在 SDK 原目录。下面 OpenCV 的 `vc16` 目录以所下载包的实际路径为准；如果使用模块化 OpenCV 构建，应复制对应的 core/videoio 运行库及其依赖。

```powershell
$runtime = 'C:\VTubeLeaf-NVIDIA'
New-Item -ItemType Directory -Force $runtime
Copy-Item .local/nvidia-build/Release/VTubeLeafNvidia.exe $runtime
Copy-Item "$sdk\bin\*.dll" $runtime
foreach ($feature in @('nvarfaceexpressions', 'nvarlandmarkdetection', 'nvarfaceboxdetection')) {
  Copy-Item "$sdk\features\$feature\bin\*.dll" $runtime
}
Get-ChildItem "$opencv\x64\vc16\bin\*.dll" |
  Where-Object { $_.Name -notmatch 'd\.dll$' } |
  Copy-Item -Destination $runtime
& "$runtime\VTubeLeafNvidia.exe" "$sdk\bin\models" 0 30 640 360
```

保留 SDK 和 OpenCV 的许可及声明；不要混用不同版本的 DLL。最后一条命令会打开摄像头，成功加载后输出 `VTUBELEAF_NVIDIA {"ready":true}`，随后输出带相同前缀的检测帧。用 Ctrl+C 停止后再从应用启动，避免同时占用摄像头。Windows 报缺失 DLL 时，先核对运行目录和 MSVC 运行库。

## 在应用中使用

1. 打开「面捕」，选择 **NVIDIA RTX · 实验中**。此选项只在 Windows 提供；其他平台恢复到该设置时会提示切换回 MediaPipe。
2. 扩展程序填写 `C:\VTubeLeaf-NVIDIA\VTubeLeafNvidia.exe`，模型目录填写例如 `C:\SDK\ARSDK\bin\models`。
3. 选择摄像头编号（通常从 0 开始）、帧率和分辨率。编号由原生摄像头枚举决定，不是浏览器设备 ID；分辨率和帧率为请求值，设备可能采用其他配置。
4. 开始跟踪。首次模型加载最多等待 120 秒；开始收到检测帧后，中断超过 10 秒会停止并提示错误。没有检测到人脸时仍发送存活帧，并使用应用现有的丢脸恢复逻辑。
5. 执行校准，检查单眼闭合、抬头低头、左右转头、视线与嘴型。暂停保留摄像头并忽略跟踪数据；停止、切换引擎或退出会结束应用自己启动的扩展进程。

## 验证边界

本地自动化覆盖设置读写、53 系数和四元数映射、无效数据过滤、子进程退出/超时/停止，以及模拟 Windows 的界面和 Tauri 事件流程。浏览器测试不访问真实摄像头；进程测试在 macOS 使用测试子进程，不运行 NVIDIA SDK。Windows 扩展不参与默认 CI 或主应用打包。

解除实验标记前，需要完成：Windows 实际编译与缺失 SDK/DLL 提示、至少一款支持的 RTX GPU 加载与连续运行、真实摄像头启停/拔插/占用恢复、左右与俯仰方向/闭眼校准、丢脸与遮挡恢复，以及与 MediaPipe 同摄像头的延迟、CPU/GPU 占用和视觉对比。
