import { isTauri } from '@tauri-apps/api/core';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

const keyNames = [
  'Space',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'Comma',
  'Period',
  'Slash',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
];

const aliases: Record<string, string> = {
  cmd: 'Super',
  command: 'Super',
  meta: 'Super',
  super: 'Super',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  esc: 'Escape',
  return: 'Enter',
  spacebar: 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

function normalize(shortcut: string): string {
  if (shortcut.length > 100) throw new Error('快捷键过长');
  const modifiers = new Set<string>();
  let key = '';
  for (const raw of shortcut.split('+')) {
    const part = raw.trim().toLowerCase();
    const platformModifier = /^(commandorcontrol|cmdorctrl|cmdorcontrol|commandorctrl)$/.test(part)
      ? /Mac|iPhone|iPad/.test(navigator.platform)
        ? 'Super'
        : 'Control'
      : undefined;
    const name =
      platformModifier ??
      (Object.hasOwn(aliases, part) ? aliases[part] : undefined) ??
      keyNames.find((name) => name.toLowerCase() === part) ??
      (/^(key)?[a-z]$/.test(part) ? `Key${part.at(-1)!.toUpperCase()}` : undefined) ??
      (/^(digit)?[0-9]$/.test(part) ? `Digit${part.at(-1)!}` : undefined) ??
      (/^f([1-9]|1[0-9]|2[0-4])$/.test(part) ? part.toUpperCase() : undefined) ??
      (/^numpad[0-9]$/.test(part) ? `Numpad${part.at(-1)!}` : undefined);
    if (!name) throw new Error(`无法识别按键“${raw.trim()}”`);
    if (['Control', 'Alt', 'Shift', 'Super'].includes(name)) modifiers.add(name);
    else if (key) throw new Error('每个快捷键只能包含一个普通按键');
    else key = name;
  }
  if (!key) throw new Error('请添加字母、数字或功能键');
  return [
    ...['Control', 'Alt', 'Shift', 'Super'].filter((modifier) => modifiers.has(modifier)),
    key,
  ].join('+');
}

function editing(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.matches('input, textarea, select') || (target as HTMLElement).isContentEditable)
  );
}

/** Native shortcuts are global; preview shortcuts only work in the active page. */
export class Hotkeys {
  private native = isTauri();
  private bindings = new Map<string, string>();
  private owned = new Set<string>();
  private pressed = new Set<string>();
  private operation: Promise<void> = Promise.resolve();
  private destroyed = false;
  private revision = 0;
  private run: (action: string) => void;
  private onError: (message: string) => void;

  constructor(run: (action: string) => void, onError: (message: string) => void) {
    this.run = run;
    this.onError = onError;
    if (!this.native) window.addEventListener('keydown', this.keydown);
  }

  private keydown = (event: KeyboardEvent) => {
    if (
      this.destroyed ||
      event.repeat ||
      event.isComposing ||
      event.defaultPrevented ||
      document.hidden ||
      !document.hasFocus() ||
      editing(event.target)
    )
      return;
    const shortcut = [
      event.ctrlKey && 'Control',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Super',
      event.code,
    ]
      .filter(Boolean)
      .join('+');
    const action = this.bindings.get(shortcut);
    if (action) {
      event.preventDefault();
      this.run(action);
    }
  };

  private queue(task: () => Promise<void>): Promise<void> {
    this.operation = this.operation.catch(() => {}).then(task);
    return this.operation;
  }

  private async release() {
    this.revision++;
    this.bindings.clear();
    this.pressed.clear();
    for (const shortcut of this.owned) {
      try {
        await unregister(shortcut);
        this.owned.delete(shortcut);
      } catch (error) {
        this.onError(`无法注销快捷键 ${shortcut}：${String(error)}`);
      }
    }
  }

  set(bindings: Record<string, string>): Promise<void> {
    const entries = Object.entries(bindings);
    return this.queue(async () => {
      if (this.destroyed) return;
      await this.release();
      const conflicts = new Map<string, string>();
      for (const [action, raw] of entries) {
        if (this.destroyed) break;
        if (typeof raw !== 'string' || !raw.trim()) continue;
        let shortcut: string;
        try {
          shortcut = normalize(raw);
        } catch (error) {
          this.onError(`${action}：${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const previous = conflicts.get(shortcut);
        if (previous) {
          this.onError(`${action} 与 ${previous} 的快捷键重复：${raw}`);
          continue;
        }
        conflicts.set(shortcut, action);
        if (this.owned.has(shortcut)) {
          this.onError(`${action} 的旧快捷键尚未注销，请重试：${raw}`);
          continue;
        }
        if (this.native) {
          try {
            const revision = this.revision;
            await register(shortcut, (event) => {
              if (revision !== this.revision) return;
              if (event.state !== 'Pressed') {
                this.pressed.delete(shortcut);
                return;
              }
              if (this.pressed.has(shortcut)) return;
              this.pressed.add(shortcut);
              const current = this.bindings.get(shortcut);
              if (
                !this.destroyed &&
                current &&
                !(document.hasFocus() && editing(document.activeElement))
              )
                this.run(current);
            });
            this.owned.add(shortcut);
          } catch (error) {
            this.onError(`${action} 的快捷键注册失败（可能已被占用）：${raw}；${String(error)}`);
            continue;
          }
        }
        if (!this.destroyed) this.bindings.set(shortcut, action);
      }
    });
  }

  destroy(): Promise<void> {
    this.destroyed = true;
    window.removeEventListener('keydown', this.keydown);
    return this.queue(() => this.release());
  }
}
