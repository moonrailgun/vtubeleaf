import { useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect as Select } from './components/ui/native-select';
import type { Studio, StudioView } from './studio';
import { builtinBackgrounds } from './scenes';

export function SceneControls({
  view,
  actions: a,
}: {
  view: StudioView;
  actions: Studio['actions'];
}) {
  const [name, setName] = useState('新场景');
  const [sceneId, setSceneId] = useState('');
  const [modelPath, setModelPath] = useState('');
  const s = view.settings,
    item = s.composition.items.find((i) => i.id === view.selectedItem);
  const scene = s.scenes.find((scene) => scene.id === sceneId);
  const run = a.run;
  return (
    <fieldset
      disabled={!view.ready || view.sceneBusy || view.modelLoading}
      className="scene-controls min-w-0"
    >
      <div className="divider" />
      <h2 id="builtin-backgrounds">内置背景</h2>
      <div
        role="group"
        aria-labelledby="builtin-backgrounds"
        className="mt-3 grid grid-cols-2 gap-2"
      >
        {builtinBackgrounds.map((background) => (
          <Button
            key={background.id}
            variant="outline"
            className="h-auto min-w-0 flex-col gap-0 overflow-hidden p-0 aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary"
            aria-pressed={s.composition.backgroundImage === background.id}
            onClick={() => run(() => a.setBackground(background.id))}
          >
            <img
              src={background.src}
              alt=""
              loading="lazy"
              className="aspect-video w-full object-cover"
            />
            <span className="py-1.5 text-xs">{background.name}</span>
          </Button>
        ))}
      </div>
      <p className="hint">点击切换背景，支持离线使用，也可导入自己的背景图。</p>
      {s.composition.backgroundImage && (
        <Button variant="ghost" onClick={() => run(() => a.setBackground())}>
          移除背景图
        </Button>
      )}
      <div className="divider" />
      <h2>道具与场景</h2>
      <div className="two-fields">
        <Button variant="outline" onClick={() => run(() => a.importAsset())}>
          添加图片 / GIF
        </Button>
        <Button variant="outline" onClick={() => run(() => a.importAsset(true))}>
          选择背景图
        </Button>
      </div>
      <label htmlFor="item-model">Live2D 道具</label>
      <div className="two-fields">
        <Select id="item-model" value={modelPath} onChange={(e) => setModelPath(e.target.value)}>
          <option value="">从角色库选择</option>
          {view.library.map((model) => (
            <option key={model.path} value={model.path}>
              {model.name}
            </option>
          ))}
        </Select>
        <Button
          variant="outline"
          disabled={!modelPath}
          onClick={() => run(() => a.addLive2DItem(modelPath))}
        >
          添加 Live2D
        </Button>
      </div>
      <label htmlFor="selected-item">编辑图层</label>
      <Select
        id="selected-item"
        value={view.selectedItem}
        onChange={(e) => a.selectItem(e.target.value)}
      >
        <option value="">主角色</option>
        {s.composition.items.map((item, index) => (
          <option key={item.id} value={item.id}>
            {index + 1} · {item.name}
            {!item.visible ? '（隐藏）' : ''}
          </option>
        ))}
      </Select>
      {item && (
        <>
          <label htmlFor="item-name">道具名称</label>
          <Input
            id="item-name"
            value={item.name}
            maxLength={100}
            onChange={(e) => a.updateItem(item.id, { name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-x-2">
            {(['visible', 'locked', 'behind'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item[key]}
                  onChange={(e) => a.updateItem(item.id, { [key]: e.target.checked })}
                />
                {{ visible: '显示', locked: '锁定拖动', behind: '放在角色后面' }[key]}
              </label>
            ))}
          </div>
          <label htmlFor="item-attach">位置参照</label>
          <Select
            id="item-attach"
            value={item.attach}
            onChange={(e) => a.updateItem(item.id, { attach: e.target.value as 'stage' | 'model' })}
          >
            <option value="stage">固定在画面</option>
            <option value="model">跟随角色构图</option>
          </Select>
          {(
            [
              ['x', '道具水平位置', -2, 2, 0.01],
              ['y', '道具垂直位置', -2, 2, 0.01],
              ['scale', '道具缩放', 0.05, 4, 0.05],
              ['rotation', '道具旋转', -180, 180, 1],
              ['opacity', '道具透明度', 0, 1, 0.01],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <label key={key} htmlFor={`item-${key}`}>
              {label} · {item[key].toFixed(2)}
              <Input
                id={`item-${key}`}
                type="range"
                min={min}
                max={max}
                step={step}
                value={item[key]}
                disabled={item.locked}
                onChange={(e) => a.updateItem(item.id, { [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <div className="two-fields">
            <Button variant="outline" onClick={() => a.reorderItem(item.id, -1)}>
              下移一层
            </Button>
            <Button variant="outline" onClick={() => a.reorderItem(item.id, 1)}>
              上移一层
            </Button>
          </div>
          <Button variant="ghost" onClick={() => run(() => a.removeItem(item.id))}>
            移除道具
          </Button>
        </>
      )}
      <p className="hint">
        选中道具后可在画面拖动、滚轮缩放。Live2D 道具循环播放首个内置动作；最多 32 个道具，其中 4 个
        Live2D。跟随角色构图会随整体移动、缩放与旋转。
      </p>
      <div className="divider" />
      <label htmlFor="scene-name">场景名称</label>
      <Input
        id="scene-name"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        variant="outline"
        disabled={!name.trim()}
        onClick={() => run(() => a.saveScene(name))}
      >
        保存为新场景
      </Button>
      <label htmlFor="saved-scene">已保存场景</label>
      <Select
        id="saved-scene"
        value={sceneId}
        onChange={(e) => {
          setSceneId(e.target.value);
          const next = s.scenes.find((s) => s.id === e.target.value);
          if (next) setName(next.name);
        }}
      >
        <option value="">选择场景</option>
        {s.scenes.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.name}
          </option>
        ))}
      </Select>
      <div className="two-fields">
        <Button
          variant="outline"
          disabled={!scene}
          onClick={() => run(() => a.recallScene(sceneId))}
        >
          切换场景
        </Button>
        <Button
          variant="outline"
          disabled={!scene || !name.trim()}
          onClick={() => run(() => a.saveScene(name, sceneId))}
        >
          更新场景
        </Button>
        <Button
          variant="ghost"
          disabled={!scene || !name.trim()}
          onClick={() => a.renameScene(sceneId, name)}
        >
          重命名
        </Button>
        <Button variant="ghost" disabled={!scene} onClick={() => run(() => a.deleteScene(sceneId))}>
          删除场景
        </Button>
      </div>
      <p className="hint">
        场景保存角色、背景、构图和全部道具。切换场景不会开启摄像头或麦克风。快捷键可在「角色参数」中设置。
      </p>
    </fieldset>
  );
}
