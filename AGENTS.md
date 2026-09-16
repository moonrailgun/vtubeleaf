# 项目约定

## 图标

- 桌面端使用 **Lucide React**（`lucide-react`），新增或替换 UI 图标时优先复用该库。
- 主界面左侧 5 个导航图标均来自 `lucide-react`，定义在 `src/App.tsx` 的 `tabs` 中。
- `website` 官网目前使用内联 SVG，未引入图标库。

## 虚拟摄像头扩展版本

- 修改 macOS 虚拟摄像头扩展内部逻辑（如 `native/macos-camera/Extension.swift`、`Frame.swift`、`main.swift`）时，必须同步递增 `native/macos-camera/Info.plist` 中的 `CFBundleShortVersionString` 和 `CFBundleVersion`，并保持两者一致，以便 macOS 识别并更新已安装的扩展。
- 扩展版本独立于主应用版本；仅修改主应用或宿主桥接逻辑时，无需递增扩展版本。
