# DirectShow BaseClasses provenance

`baseclasses/` is the trimmed Microsoft DirectShow BaseClasses tree distributed by [tshino/softcam](https://github.com/tshino/softcam/tree/e89a699ed9932c74f57afe4f396be89665967e00/src/baseclasses), pinned to commit `e89a699ed9932c74f57afe4f396be89665967e00`. It supplies COM, media-type, source-pin, allocator and worker-thread machinery. VTubeLeaf does not use Softcam's frame transport or camera filter.

The Microsoft implementation is also available in [Windows-classic-samples](https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/Win7Samples/multimedia/directshow/baseclasses). Preserve `LICENSE.microsoft` and `LICENSE.softcam`, and the copyright notices in the sources. The Windows app bundles both licenses with its camera DLLs.

Local change: `baseclasses/wxdebug.cpp`, the `CDisp(IUnknown*)` formatting branch, names the temporary `CDisp` object before copying its string. This replaces a legacy constructor-expression form rejected by Clang and keeps the temporary alive during the copy. All other copied BaseClasses files retain the pinned Softcam contents.
