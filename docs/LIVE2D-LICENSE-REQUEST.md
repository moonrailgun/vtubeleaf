# Live2D 许可咨询草稿

尚未发送，也不表示已取得发行授权。适用依据：[官方 Expandable Applications 页面](https://www.live2d.com/en/sdk/license/expandable/)（2026-09-08 核对）。

主题：VTubeLeaf 免费开源桌面应用的 Cubism SDK 发行许可确认

您好，我们正在开发 VTubeLeaf，一款免费的桌面 Live2D 摄像头工具，计划开放项目自有源代码。用户从本机导入自己有权使用的模型，通过本地面部、身体和手部追踪驱动角色，并可输出至会议软件。计划支持 macOS、Windows 和 Linux；目前没有收费、广告或内购。

渲染使用 pixi-live2d-display 0.4.0（包含 Cubism Web Framework）和开发者从官方 Cubism SDK for Web 获取的 Core。当前本地验证版本为 Cubism SDK for Web 5 R4。当前本地实现将未修改的 Core 与原始许可封装为固定依赖，拟随仓库及安装包提供；不包含 SDK 示例角色或用户模型。此变更尚未推送，公开分发方式希望一并确认。我们不会把 Core 或 Framework 重新许可为项目自有代码的许可证。

希望确认：

1. 这种允许导入任意用户模型的应用应适用哪类 Expandable Application 协议？免费且无收益的情况能否申请特殊条件或例外，所需审查材料是什么？
2. 计划随 macOS、Windows 和 Linux 安装包分发 Core Web 运行文件，需要签署哪些协议，许可主体、费用及后续更新要求是什么？
3. Core、内嵌 Framework 应保留哪些声明、许可文件、标识及终端用户条款？源码公开和二进制分发是否有额外限制？

请告知正式审查流程。我们将在得到适用条款与发行许可确认后再公开发行带 Core 的安装包。

提交前由项目所有者补充：法律主体/联系人、项目公开链接、收益情况是否有变化，以及预计发行时间。无需在咨询中附加任何用户模型或摄像头数据。
