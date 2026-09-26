VTubeLeaf OpenSeeFace 独立启动包

无需安装 Python。此包与 VTubeLeaf 主应用分别启动、分别关闭。

1. Windows：先完整解压 ZIP，再双击 Start OpenSeeFace.cmd。
   macOS：打开 DMG，将整个 OpenSeeFace 文件夹复制到本机，
   再双击其中的 Start OpenSeeFace.command。Apple Silicon 选 aarch64，Intel 选 x86_64。
2. 在终端选择摄像头编号和 UDP 端口，直接回车使用默认值 0、11573。
   首次运行请允许摄像头访问；macOS 可能显示为终端请求摄像头权限。
3. 打开 VTubeLeaf，在「面捕」选择 OpenSeeFace，点击「开始跟踪」。
   高级设置保持「独立启动包 / 外部程序」，UDP 端口与本启动包一致。
4. 结束时在本启动包的终端按 Ctrl+C。只停止 VTubeLeaf 接收不会关闭此进程。
   切回 MediaPipe 前先停止此进程，释放摄像头。

没有数据：检查摄像头权限、设备编号、端口是否一致，以及其他软件是否占用摄像头。
不要只移动 facetracker 文件；请保留 _internal、模型和许可等所有内容。
技术用户可直接运行 facetracker --help（Windows 为 facetracker.exe）查看命令行参数。
仅向本机 127.0.0.1 发送单人跟踪数据。依赖版本见 BUILD.json，第三方许可见 licenses/。
