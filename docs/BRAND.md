# VTubeLeaf 品牌资源

2026-09-08 选定第 02 号「叶芽精灵」白色五官版：粉色叶芽、浅粉额头高光、白色双眼和微笑。

![当前 Logo](../public/brand/lockup-light.svg)

图形依据选定的 GPT Image 2 稿重新绘制为可编辑 SVG 路径，使用平面色，适合透明背景和小尺寸导出。横向组合继续使用项目原有的几何字标路径，不依赖用户安装字体。

## 颜色与使用

| 用途               | 色值      |
| ------------------ | --------- |
| 叶芽粉             | `#E15F7D` |
| 额头高光           | `#F6B5BE` |
| 双眼和微笑         | `#FFFFFF` |
| 浅底字标、单色图形 | `#493C45` |
| 深底字标           | `#F6EAF0` |

- 浅色环境使用 `mark-light.svg` / `lockup-light.svg`，深色环境使用 `mark-dark.svg` / `lockup-dark.svg`。两种环境保留相同的粉色图形和白色五官。
- 五官是实色白色，不是透明镂空；图形外部与叶片间隙透明。
- `mono` 版用于单色场景。图形最小建议 16px，横向组合最小建议宽 180px；较窄空间只用图形。
- 保留文件自带留白，不拉伸、不旋转；预览镜像与动作镜像不应翻转品牌图形。

## 文件与重建

| 文件                                                 | 用途                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `public/brand/mark.svg`                              | 默认图形，与 light 版一致；应用界面与 favicon 使用 |
| `public/brand/mark-{light,dark,mono}.svg`            | 独立图形                                           |
| `public/brand/wordmark-{light,dark,mono}.svg`        | 独立字标                                           |
| `public/brand/lockup-{light,dark,mono}.svg`          | 横向组合，README 使用 light 版                     |
| `public/brand/png/{16,32,64,128,256,512,1024}x*.png` | 透明背景 PNG                                       |
| `src-tauri/icons/`                                   | 桌面应用 PNG、Windows ICO、macOS ICNS              |
| `website/public/assets/brand/`                       | 官网图形与深浅色组合，由同一脚本同步               |

```sh
node scripts/brand.mjs
```

[brand.mjs](../scripts/brand.mjs) 是图形与字标的可重建源，使用已安装的 Tauri CLI 导出 PNG、ICO 与 ICNS，并检查 PNG 尺寸、RGBA 通道及容器文件头。修改时先改脚本，再导出。

`public/brand/proposals/` 与 `proposals.svg` / `.png` 保留为早期方案存档，不参与当前品牌导出。
