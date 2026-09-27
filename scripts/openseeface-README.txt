VTubeLeaf OpenSeeFace 独立启动包

无需安装 Python。此包与 VTubeLeaf 主应用分别启动、分别关闭。

1. macOS：打开 DMG，将 OpenSeeFace.app 拖入「应用程序」，再双击打开。
   Apple Silicon 选 aarch64，Intel 选 x86_64；无需使用终端。
   Windows：先完整解压 ZIP，再双击 Start OpenSeeFace.cmd。
2. macOS：在下拉框中选择摄像头名称，填写 UDP 端口，点击「开始追踪」。
   接入新摄像头后点击「刷新」；VTubeLeaf Camera 仅用于输出，不在列表中显示。
   Windows：在终端选择摄像头编号和 UDP 端口，直接回车使用默认值。
   默认 UDP 端口为 11573，Windows 默认摄像头编号为 0。首次运行请允许摄像头访问。
3. 打开 VTubeLeaf，在「面捕」选择 OpenSeeFace，点击「开始跟踪」。
   高级设置保持「独立启动包 / 外部程序」，UDP 端口与本启动包一致。
4. macOS 点击「停止追踪」或关闭窗口；Windows 在终端按 Ctrl+C。
   只停止 VTubeLeaf 接收不会关闭此进程。
   切回 MediaPipe 前先停止此进程，释放摄像头。

没有数据：检查摄像头权限、所选设备、端口是否一致，以及其他软件是否占用摄像头。
macOS 请移动整个 .app；Windows 请保留整个解压文件夹，包括 _internal、模型和许可。
技术用户可运行 facetracker --help（Windows 为 facetracker.exe）查看命令行参数。
macOS 的 facetracker、BUILD.json、licenses/ 位于 .app/Contents/Resources/OpenSeeFace/。
仅向本机 127.0.0.1 发送单人跟踪数据。依赖版本见 BUILD.json，第三方许可见 licenses/。
