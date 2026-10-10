# 项目约定

## 图标

- 桌面端使用 **Lucide React**（`lucide-react`），新增或替换 UI 图标时优先复用该库。
- 主界面左侧 5 个导航图标均来自 `lucide-react`，定义在 `src/App.tsx` 的 `tabs` 中。
- `website` 官网目前使用内联 SVG，未引入图标库。

## 多语言

- 界面支持英语、中文、日语、西班牙语、法语。语言在启动时由 Rust 端确定（`src-tauri/src/locale.rs`）：优先用设置里的 `language`，为 `system` 时按系统语言选择，未匹配时用英语；前端启动时读取同一结果，所以切换语言需要重启应用。
- 前端用户可见文案不要硬编码，使用 `src/i18n.ts` 的 `t('命名空间.key', { 变量 })`；新增文案需在 `src/locales/` 五个语言文件里同时添加同名 key，缺任何一种 `tsc` 都会报错。不要在模块顶层调用 `t()`，标签表里存 key，渲染时再翻译。
- Rust 端用户可见文案使用 `locale::text([英, 中, 日, 西, 法])`；macOS 摄像头宿主桥接（`native/macos-camera/Host.swift`）使用其中的 `tr(...)`。
- 测试断言中文文案：Playwright 已固定 `zh-CN`；Node 测试在导入后调用 `setLang('zh')`。

## 虚拟摄像头扩展版本

- 修改 macOS 虚拟摄像头扩展内部逻辑（如 `native/macos-camera/Extension.swift`、`Frame.swift`、`main.swift`）时，必须同步递增 `native/macos-camera/Info.plist` 中的 `CFBundleShortVersionString` 和 `CFBundleVersion`，并保持两者一致，以便 macOS 识别并更新已安装的扩展。
- 扩展版本独立于主应用版本；仅修改主应用或宿主桥接逻辑时，无需递增扩展版本。

## 更新日志

- 桌面应用中用户能感知到的改动（新功能、行为变化、问题修复），必须在同一次提交里同时更新根目录两份更新日志：英文 `CHANGELOG.md`（默认）的 `## Unreleased` 和中文 `CHANGELOG.zh-CN.md` 的 `## 未发布`，两边条目一一对应。纯重构、测试、CI、依赖升级、`website` 官网改动等用户感受不到的，不写。
- 写给主播看的人话：从“用起来有什么不同”的角度写，一条一句话。界面上的名称原样引用该语言的界面文案，中文用「」，英文用双引号（取 `src/locales/en.ts` 里的文案）；不出现代码、参数 ID、文件名或 commit 类型。
- 中文按 `### 新增`、`### 改进`、`### 修复` 分组，英文对应 `### Added`、`### Improved`、`### Fixed`，空分组不写。同一个功能在发版前又改了，就修改原来那条，不要追加新条目。
- 不要自行填写版本号和日期。`npm run release` 会把两份文件的「未发布」一节都改为 `## vX.Y.Z · YYYY-MM-DD` 并各自新开一个空节；任一份为空都会拒绝发版。GitHub Release 和应用内更新提示使用英文在前、中文在后、以 `---` 分隔的双语说明，应用按界面语言只显示其中一半；「关于」里的「更新记录」中文界面读中文版，其他语言读英文版。
