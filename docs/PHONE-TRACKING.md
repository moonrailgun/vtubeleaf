# 手机面捕伴侣

状态：阶段 0/1 实现稿 · 2026-10-12。对应 [手机面捕伴侣 PRD](MOBILE-PRD.md) 的 P0 范围。桌面接收端、协议和两个原生应用的代码已经写出并通过本机编译与自动化测试；Android 应用已在一台真机上走通安装、配对、开始跟踪和断线恢复（见「真机联调」）。**动作方向、人脸跟踪质量、延迟、发热和长时间运行仍未在真机验证，iOS 应用尚未在真机运行**，因此本文不声明任何手机型号为「已支持」。

## 组成

| 部分         | 位置                                                                                       | 技术                                                               | 当前验证                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 桌面接收端   | `src-tauri/src/phone.rs`、`src/phone.ts`、`src/tracker.ts`、`src/studio.ts`、`src/App.tsx` | Rust：自签名 TLS + WebSocket；前端：现有引擎切换、校准、映射       | 5 项 Rust 测试（配对、校验、重连、断开、地址排序）、1 项浏览器回归、现有 Node 测试              |
| Android 应用 | `mobile/android/`                                                                          | Kotlin、Compose、CameraX、MediaPipe Face Landmarker、OkHttp        | `./gradlew assembleDebug testDebugUnitTest`（映射与协议单元测试）；真机安装、配对、断线恢复联调 |
| iOS 应用     | `mobile/ios/`                                                                              | Swift、SwiftUI、ARKit（`ARFaceTrackingConfiguration`）、URLSession | `xcodebuild build/test`（模拟器编译与映射、协议单元测试）                                       |

两个应用共用同一套协议、参数语义、页面结构和五种语言文案；手机只做引擎适配，平滑、灵敏度和中立校准仍在桌面完成。

## 已采用的决策

PRD 第 7 节的待决策项按其建议值定下，真机数据出来后可以推翻：

| 事项         | 决定                                                                                                                       | 依据                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首发平台     | Android 先行，iOS 为第二平台                                                                                               | 手头可持续使用的真机是 Android，已完成联调；Android 与桌面共用同一 MediaPipe 模型和映射公式，A-02 风险最低。Xcode 里登记的 iPhone 11 / iPhone 15 需开发者团队签名后才能装机 |
| 最低系统版本 | Android 8.0（API 26）、iOS 16                                                                                              | CameraX 1.6、MediaPipe 0.10、ML Kit 都支持更低版本，取保守值；iOS 16 是所用 SwiftUI 接口的下限，ARKit 人脸跟踪另在运行时检查                                                |
| 应用名称     | 「VTubeLeaf 手机伴侣」/ "VTubeLeaf Phone"，日、西、法各有译名                                                              | 两端一致，iOS 主屏图标名同样本地化                                                                                                                                          |
| 分发方式     | Android：APK 附在 GitHub Release，与桌面下载同一渠道；iOS：TestFlight                                                      | 需要先准备 Android 发布签名密钥（放入仓库 secrets）和 Apple Developer Program；在此之前 CI 每次推送产出可安装的 Android 调试包 artifact，iOS 用 Xcode 直装                  |
| 性能目标     | 采用 PRD 6.2 建议值作为阶段 1 验收：有效面捕 30 FPS（每分钟均值 ≥ 25）、动作到画面 p95 ≤ 150 ms、连续 60 分钟、恢复 ≤ 5 秒 | 尚无基线数据；测得后记入 [VALIDATION](VALIDATION.md) 再决定是否调整或缩小支持范围                                                                                           |
| 异常时间参数 | 采用 PRD 3.3 的初始建议值                                                                                                  | 已实现：无人脸时每 200 ms 发一帧未跟踪、桌面按 lostDelay 回中立；30 秒重连窗口；15 秒空闲断开                                                                               |

## 桌面端使用

1. 「面捕 → 跟踪引擎与采集 → 跟踪引擎」选「手机伴侣 · 同一 Wi-Fi」，点「开始跟踪」。
2. 面板显示二维码、这台电脑的名字和局域网地址；用手机应用扫码。
3. 手机连接后面板显示手机名、引擎、接收帧率和网络往返；在手机上点「开始」，再在桌面点「校准中立姿态」。
4. 「断开手机」会撤销当前手机的会话并换一张新二维码；停止跟踪会关闭监听端口。

桌面在手机来源下不运行本机面部推理；上半身、双手需要 MediaPipe 引擎，切换引擎前必须先停止跟踪，因此两套面部推理不会同时运行。换一台手机或另一种引擎接入时桌面会清掉中立校准并提示重新校准。

## 协议（版本 1）

传输：手机发起一条 `wss://` 连接到二维码里的地址和端口。桌面每次开启手机来源时生成新的自签名证书（rcgen，ECDSA P-256）并把证书 DER 的 SHA-256 放进二维码；手机只信任指纹一致的证书（Android 自定义 `X509TrustManager`，iOS `URLSessionDelegate` 服务器信任回调），不关闭证书校验，也不信任系统 CA。桌面只接受私有地址、链路本地地址和 100.64/10 的来源，不做公网端口映射。

### 二维码

JSON 文本：

```json
{
  "v": 1,
  "a": ["192.168.1.20"],
  "p": 51234,
  "t": "<48 位十六进制一次性配对码>",
  "f": "<证书 SHA-256，64 位十六进制>",
  "n": "电脑名"
}
```

`a` 最多 4 个 IPv4 地址：默认路由所在的 Wi-Fi/有线地址排第一，其后是其他私有网段；只持有网络地址（x.y.z.0）的虚拟网桥和点对点 VPN 地址不列入。手机按顺序逐个尝试（每个 4 秒）。`p` 是系统分配的端口，每次开启都会变化。`t` 配对成功即作废；桌面断开或手机掉线后都会换新码。

### 消息

全部为 UTF-8 JSON 文本帧，单条不超过 4096 字节；桌面每秒最多接受 120 条，超过即断开。

| 方向      | 消息      | 字段                                                                                                                                                                                                                                                 |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 手机→桌面 | `hello`   | `version`(=1)、`token`（首次配对）或 `session`（重连）、`device`（显示名，≤64 字）、`engine`（`arkit`/`mediapipe`）、`capabilities`（可选参数名数组）                                                                                                |
| 桌面→手机 | `welcome` | `version`、`session`（48 位十六进制会话密钥，只在本次会话内有效）、`name`（电脑名）                                                                                                                                                                  |
| 桌面→手机 | `reject`  | `reason`：`version`（协议不兼容）、`token`（配对码失效）、`busy`（已有手机连接）、`session`（会话已撤销）、`format`；随后关闭                                                                                                                        |
| 手机→桌面 | `frame`   | `stream`（每次连接的新随机 ID，≤64 字）、`seq`（流内严格递增）、`t`（手机单调时钟毫秒，仅诊断）、`tracked`（布尔）；`tracked` 为真时含 `yaw`、`pitch`、`roll`（角度）、`eyeLeft`、`eyeRight`、`mouthOpen`、`mouthSmile`（0–1），以及已声明的可选参数 |
| 手机→桌面 | `state`   | `tracking`：`running`/`paused`                                                                                                                                                                                                                       |
| 双向      | `bye`     | 手机发：结束会话；桌面发：`reason` 为 `disconnected`（桌面断开/停止）、`format`（畸形数据）、`rate`（超速）                                                                                                                                          |

可选参数：`gazeX`、`gazeY`、`browLeft`、`browRight`、`mouthX` 取值 −1–1；`cheekPuff`、`tongueOut` 取值 0–1。未在 `capabilities` 声明的参数即使发送也被忽略；缺失和 0 不同，桌面不会伪造。

校验规则：非有限数值、角度超出 ±180°、字段缺失或类型错误都算畸形，桌面回复 `bye format` 并关闭；0–1 参数越界会被夹到范围内。同一流内 `seq` 不大于已收序号的帧直接丢弃；新流 ID 重新计数。桌面只用本地单调时钟判断超时（15 秒无任何消息断开，每 5 秒 WebSocket ping 测往返）。

### 语义

- 左右眼按用户自身左右定义，与桌面 MediaPipe 一致；手机预览镜像只影响显示。
- `yaw` 正值为头转向用户自己的左侧（摄像头视角的右侧），`pitch` 正值为抬头，`roll` 正值为头顶向用户自己的左侧倾斜（屏幕右侧），与桌面 `fromMediaPipe` 完全相同的公式。Android 直接用 MediaPipe 的变换矩阵；iOS 用 `ARCamera.viewMatrix(for: .portrait)` 把人脸锚点转到竖屏相机坐标后套用同一公式。两端均有固定输入的单元测试覆盖恒等、纯偏航、纯俯仰、纯侧倾和眨眼；**真机上仍需按 PRD 的 A-02 动作脚本核对方向**，若发现反向，只需改 `Mapping.kt`/`Mapping.swift` 中对应一行的符号。
- 首版不发送平移参数；桌面在没有 `positionZ` 时走无深度路径。

### 会话与恢复

- 一台电脑同时只保留一个会话。连接中的手机占用期间，其他手机用任何码连接都收到 `busy`。
- 手机掉线：桌面把状态置为「等待重连」并重新显示二维码（新配对码）；原手机 30 秒内带 `session` 重连即恢复，桌面按新流 ID 丢弃旧帧；另一台手机扫新码会取代原会话。
- 桌面「断开手机」或停止跟踪：向手机发 `bye disconnected`，撤销会话。
- 手机「断开」：发 `bye` 后关闭，桌面撤销会话并换新码。
- 手机端重连期间继续采集但不发送；30 秒未恢复则暂停采集并提示重新扫码。

## 手机应用行为

三个页面：连接（权限说明、扫码、连接中、失败原因与重试）、跟踪（本地预览、是否发现人脸、连接状态、有效面捕帧率、开始/暂停、隐藏预览、断开）、设置（语言、隐私说明、发送内容、版本、帮助）。

- 摄像头只在用户点击后打开：连接页点「扫描配对二维码」才启动后置扫码摄像头，读到码、切换页面或进入后台即释放；跟踪页点「开始」才启动前置面捕摄像头。
- 暂停释放摄像头、停止推理和发送，保留连接；断开同时结束会话。切到后台、锁屏、来电（iOS 通过 ARKit 中断回调）都按暂停处理，返回后由用户点「继续」。
- 隐藏预览只隐藏画面，摄像头和推理继续；页面保留文字状态。跟踪时保持屏幕常亮。
- 没有人脸时每 200 ms 发一帧 `tracked:false`，桌面按现有「跟踪丢失」逻辑在 lostDelay 后平滑回中立，不冻结旧表情。
- 热状态：Android `PowerManager` 热状态 SEVERE 起提示、CRITICAL 起暂停；iOS `ProcessInfo.thermalState` serious 提示、critical 暂停。
- 背压：CameraX `STRATEGY_KEEP_ONLY_LATEST` / ARKit 逐帧回调；发送端 Android 在 OkHttp 待发队列超过 1 KiB 时丢新帧，iOS 只保留一帧在飞、一帧待发。
- 语言：Android 应用内列表（`AppCompatDelegate.setApplicationLocales`，Android 12 及更早由 appcompat 存储）；iOS 跳转系统「设置 → VTubeLeaf → 语言」。文案五种语言各一份，Android 在 `res/values*/strings.xml`，iOS 的 `Localizable.xcstrings` 由同一张表生成。
- 错误区分：相机权限拒绝（不重复弹窗，给系统设置入口）、协议版本不符（二维码版本与应用版本都显示）、配对码失效、电脑已被占用、会话被撤销、电脑主动断开、无法连通（同一 Wi-Fi、访客隔离、防火墙；iOS 另提示本地网络权限）、证书指纹不符、30 秒重连超时、设备不支持（iOS 无 ARKit 人脸跟踪）、推理失败。

## 构建

### Android

需要 Android SDK（compileSdk 36）和 JDK 17。首次构建会下载固定 SHA-256 的 `face_landmarker.task` 到 `app/src/main/assets/`（与桌面 `npm run setup:assets` 相同的模型）。

```sh
cd mobile/android
./gradlew assembleDebug testDebugUnitTest
```

依赖固定在 AGP 8.13 / Compose BOM 2026.06.01 这一组；更新的 Compose、core、lifecycle 需要 AGP 9.1 和 compileSdk 37。

### iOS

需要 Xcode 16 和 [xcodegen](https://github.com/yonaskolb/XcodeGen)。工程文件由 `project.yml` 生成，不入库。

```sh
cd mobile/ios
xcodegen generate
xcodebuild -project VTubeLeafPhone.xcodeproj -scheme VTubeLeafPhone -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
simulator=$(xcrun simctl list devices available -j | jq -r '[.devices[][] | select(.deviceTypeIdentifier | test("iPhone"))][0].udid')
xcodebuild -project VTubeLeafPhone.xcodeproj -scheme VTubeLeafPhone -destination "id=$simulator" CODE_SIGNING_ALLOWED=NO test
```

真机运行需要在 Xcode 中选择开发团队。ARKit 人脸跟踪在模拟器不可用，应用会提示设备不支持。

`.github/workflows/check-mobile.yml` 在 `mobile/` 有改动时跑以上两套命令，并把 Android 调试包作为 artifact 上传（每个 runner 用自己的调试密钥签名，升级前要先卸载）。

## 真机联调

桌面侧不必启动整个应用：`phone.rs` 里有一个默认忽略的测试会启动接收端、打印二维码内容，并记录随后 `VTUBELEAF_PHONE_SECONDS`（默认 60）秒内的状态与有效帧：

```sh
VTUBELEAF_PHONE_SECONDS=120 cargo test --locked --manifest-path src-tauri/Cargo.toml link_a_real_phone -- --ignored --nocapture
```

输出里 `PAIRING` 后面就是二维码 JSON。Android 调试包额外接受它作为启动参数，免去扫码（发布包不接受）：

```sh
adb shell am start -S -n com.moonrailgun.vtubeleaf.phone/.MainActivity --es pairing '<二维码 JSON>'
```

Wi-Fi 有客户端隔离（手机 ping 不通电脑）时，把 JSON 里的 `a` 改成 `["127.0.0.1"]`，再 `adb reverse tcp:<p> tcp:<p>` 走 USB 回环；这只绕过无线链路，证书固定、协议、推理和发送都是真实路径。

2026-10-12 在 Open Doubao（Android 17，前置摄像头）上的记录：调试包安装与启动正常；配对后桌面状态为 `connected`，设备名与引擎正确；点「开始」后前置摄像头与 MediaPipe 启动，镜头朝向天花板时手机显示「没有人脸」、桌面无帧；把接收端进程冻结 12 秒后手机显示「连接中断 · 正在重连…」，恢复后桌面先回到 `reconnecting`，再以同一会话重新 `connected`，往返 4–6 ms（USB 回环）。办公 Wi-Fi 有客户端隔离，手机到电脑的 TCP 和 ping 均不通，手机端给出的正是「无法连上电脑」这条提示；真实无线路径要在家用网络再测。联调中发现并修正：Mac 上有多块虚拟网桥时，二维码曾把真正的 Wi-Fi 地址挤掉，现在默认路由地址排第一。

## 待真机验证（对应 PRD 第 6 节）

- A-01 首次使用、A-05 配对边界、A-06 隐私：协议层由本机自动化覆盖，Android 真机已走通安装、配对、开始、断线恢复（USB 回环），还需在家用 Wi-Fi 上扫码走一遍；iOS 未在真机运行。
- A-02 动作语义：镜头前还没有人脸，两端的角度符号与左右眼需按固定动作脚本在真机核对。
- A-03 来源切换、A-07 现有输出：待真机。
- A-04 异常恢复：断网重连已用冻结接收端模拟通过；遮脸、重启桌面、锁屏、拒绝权限、第二台手机待真机。
- 性能目标（30 FPS / p95 150 ms / 60 分钟 / 5 秒恢复 / 电脑负载收益）尚无数据；首发平台、最低系统版本和分发方式已按建议定下，见「已采用的决策」。
