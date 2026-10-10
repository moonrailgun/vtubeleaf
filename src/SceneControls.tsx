import { useState, type ReactNode } from 'react';
import { Check, Image as ImageIcon, Save, UserRound } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import type { Studio, StudioView } from './studio';
import { builtinBackgrounds } from './scenes';
import { Fold } from './Fold';
import { t } from './i18n.ts';

export function SceneControls({
  view,
  actions: a,
  children,
}: {
  view: StudioView;
  actions: Studio['actions'];
  children: ReactNode;
}) {
  const [name, setName] = useState(() => t('scene.newScene'));
  const [sceneId, setSceneId] = useState('');
  const [modelPath, setModelPath] = useState('');
  const s = view.settings,
    item = s.composition.items.find((i) => i.id === view.selectedItem);
  const scene = s.scenes.find((scene) => scene.id === sceneId);
  const run = a.run;
  const disabled = !view.ready || view.sceneBusy || view.modelLoading;
  return (
    <>
      <fieldset disabled={disabled} className="scene-controls min-w-0">
        <div className="section-title">
          <h2 id="builtin-backgrounds">{t('scene.background')}</h2>
        </div>
        <div
          role="group"
          aria-labelledby="builtin-backgrounds"
          className="mt-3 grid grid-cols-4 gap-2"
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
                src={background.thumb}
                alt=""
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
              <span className="py-1 text-[11px]">{t(background.name)}</span>
            </Button>
          ))}
        </div>
        <div className="color-row mt-3">
          <Input
            id="background"
            type="color"
            aria-label={t('scene.backgroundColor')}
            value={s.background}
            onChange={(e) => a.setSetting('background', e.target.value)}
          />
          {[
            ['#e5ebdd', t('scene.swatchLeafGreen')],
            ['#1c2926', t('scene.swatchPineGreen')],
            ['#00ff00', t('scene.swatchChromaGreen')],
            ['#f3ede5', t('scene.swatchWarmWhite')],
          ].map(([color, label]) => (
            <Button
              key={color}
              variant="outline"
              className="swatch"
              data-color={color}
              style={{ background: color }}
              aria-label={label}
              aria-pressed={s.background === color}
              onClick={() => a.setSetting('background', color)}
            />
          ))}
        </div>
        <div className="two-fields">
          <Button variant="outline" onClick={() => run(() => a.importAsset(true))}>
            {t('scene.chooseBackgroundImage')}
          </Button>
          {s.composition.backgroundImage && (
            <Button variant="outline" onClick={() => run(() => a.setBackground())}>
              {t('scene.removeBackgroundImage')}
            </Button>
          )}
        </div>
        <div className="divider" />
        <div className="section-title">
          <h2>{t('scene.scenes')}</h2>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Select
            value={sceneId || 'no-scene'}
            onValueChange={(value) => {
              setSceneId(value === 'no-scene' ? '' : value);
              const next = s.scenes.find((s) => s.id === (value === 'no-scene' ? '' : value));
              if (next) setName(next.name);
            }}
          >
            <SelectTrigger
              id="saved-scene"
              aria-label={t('scene.savedScenes')}
              className="min-w-0 flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no-scene">{t('scene.chooseScene')}</SelectItem>
              {s.scenes.map((scene) => (
                <SelectItem key={scene.id} value={scene.id}>
                  {scene.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!scene}
            onClick={() => run(() => a.recallScene(sceneId))}
          >
            {t('scene.switchScene')}
          </Button>
        </div>
        <div className="divider" />
      </fieldset>
      {children}
      <Fold title={t('scene.props')}>
        <fieldset disabled={disabled} className="scene-controls min-w-0">
          <Button variant="outline" className="wide" onClick={() => run(() => a.importAsset())}>
            {t('scene.addImage')}
          </Button>
          <label htmlFor="item-model">{t('scene.live2dProp')}</label>
          <div className="two-fields">
            <Select
              value={modelPath || 'no-model'}
              onValueChange={(value) => setModelPath(value === 'no-model' ? '' : value)}
            >
              <SelectTrigger id="item-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-model">{t('scene.fromLibrary')}</SelectItem>
                {view.library.map((model) => (
                  <SelectItem key={model.path} value={model.path}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!modelPath}
              onClick={() => run(() => a.addLive2DItem(modelPath))}
            >
              {t('scene.addLive2d')}
            </Button>
          </div>
          <h3 id="layer-label" className="mt-4 mb-2 text-xs font-semibold">
            {t('scene.editLayers')}
          </h3>
          <div
            role="group"
            aria-labelledby="layer-label"
            className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-lg border p-1"
          >
            <Button
              variant="ghost"
              className="w-full justify-start text-xs aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
              aria-pressed={!view.selectedItem}
              onClick={() => a.selectItem('')}
            >
              <UserRound aria-hidden="true" />
              <span className="flex-1 text-left">{t('scene.mainAvatar')}</span>
              {!view.selectedItem && <Check aria-hidden="true" />}
            </Button>
            {s.composition.items.map((item, index) => (
              <Button
                key={item.id}
                variant="ghost"
                className="w-full justify-start text-xs aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
                aria-pressed={view.selectedItem === item.id}
                onClick={() => a.selectItem(item.id)}
                title={item.name}
              >
                {item.kind === 'live2d' ? (
                  <UserRound aria-hidden="true" />
                ) : (
                  <ImageIcon aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">
                  {index + 1} · {item.name}
                  {!item.visible ? t('scene.hiddenSuffix') : ''}
                </span>
                {view.selectedItem === item.id && <Check aria-hidden="true" />}
              </Button>
            ))}
          </div>
          {item && (
            <>
              <label htmlFor="item-name">{t('scene.propName')}</label>
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
                    {
                      {
                        visible: t('scene.visible'),
                        locked: t('scene.lockDrag'),
                        behind: t('scene.behindAvatar'),
                      }[key]
                    }
                  </label>
                ))}
              </div>
              <label htmlFor="item-attach">{t('scene.attach')}</label>
              <Select
                value={item.attach}
                onValueChange={(value) =>
                  a.updateItem(item.id, { attach: value as 'stage' | 'model' })
                }
              >
                <SelectTrigger id="item-attach">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stage">{t('scene.attachStage')}</SelectItem>
                  <SelectItem value="model">{t('scene.attachModel')}</SelectItem>
                </SelectContent>
              </Select>
              {(
                [
                  ['x', t('scene.propX'), -2, 2, 0.01],
                  ['y', t('scene.propY'), -2, 2, 0.01],
                  ['scale', t('scene.propScale'), 0.05, 4, 0.05],
                  ['rotation', t('scene.propRotation'), -180, 180, 1],
                  ['opacity', t('scene.propOpacity'), 0, 1, 0.01],
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
                  {t('scene.moveDown')}
                </Button>
                <Button variant="outline" onClick={() => a.reorderItem(item.id, 1)}>
                  {t('scene.moveUp')}
                </Button>
              </div>
              <Button variant="ghost" onClick={() => run(() => a.removeItem(item.id))}>
                {t('scene.removeProp')}
              </Button>
            </>
          )}
          <p className="hint">{t('scene.propsHint')}</p>
        </fieldset>
      </Fold>
      <Fold title={t('scene.manageScenes')}>
        <fieldset disabled={disabled} className="scene-controls min-w-0">
          <div className="mt-4 flex items-center gap-2">
            <label htmlFor="scene-name" className="m-0 shrink-0">
              {t('scene.sceneName')}
            </label>
            <Input
              id="scene-name"
              className="flex-1"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              className="size-[40px]"
              aria-label={t('scene.saveAsNew')}
              title={t('scene.saveAsNew')}
              disabled={!name.trim()}
              onClick={() => run(() => a.saveScene(name))}
            >
              <Save aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              disabled={!scene || !name.trim()}
              onClick={() => run(() => a.saveScene(name, sceneId))}
            >
              {t('scene.updateScene')}
            </Button>
            <Button
              variant="ghost"
              disabled={!scene || !name.trim()}
              onClick={() => a.renameScene(sceneId, name)}
            >
              {t('scene.rename')}
            </Button>
            <Button
              variant="ghost"
              disabled={!scene}
              onClick={() => run(() => a.deleteScene(sceneId))}
            >
              {t('scene.deleteScene')}
            </Button>
          </div>
          <p className="hint">{t('scene.scenesHint')}</p>
        </fieldset>
      </Fold>
    </>
  );
}
