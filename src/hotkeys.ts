import type { HotkeyOptions } from './state.ts';
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

/** Native global bindings use the OS; local/preview bindings stay in the active window. */
export class Hotkeys {
  private native = isTauri();
  private bindings = new Map<string, string>();
  private owned = new Set<string>();
  private pressed = new Map<string, string>();
  private local = new Set<string>();
  private operation: Promise<void> = Promise.resolve();
  private destroyed = false;
  private revision = 0;
  private run: (action: string, pressed: boolean) => void;
  private onError: (message: string) => void;

  constructor(run: (action: string, pressed: boolean) => void, onError: (message: string) => void) {
    this.run = run;
    this.onError = onError;
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.blur);
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
    if (action && this.local.has(shortcut) && !this.pressed.has(shortcut)) {
      event.preventDefault();
      this.pressed.set(shortcut, action);
      this.run(action, true);
    }
  };

  private releasePressed(shortcut: string) {
    const action = this.pressed.get(shortcut);
    this.pressed.delete(shortcut);
    if (action) this.run(action, false);
  }

  private keyup = (event: KeyboardEvent) => {
    for (const shortcut of this.local) {
      const parts = shortcut.split('+');
      if (
        parts.at(-1) === event.code ||
        (parts.includes('Control') && !event.ctrlKey) ||
        (parts.includes('Alt') && !event.altKey) ||
        (parts.includes('Shift') && !event.shiftKey) ||
        (parts.includes('Super') && !event.metaKey)
      )
        this.releasePressed(shortcut);
    }
  };

  private blur = () => {
    for (const shortcut of this.local) this.releasePressed(shortcut);
  };

  private queue(task: () => Promise<void>): Promise<void> {
    this.operation = this.operation.catch(() => {}).then(task);
    return this.operation;
  }

  private async release() {
    this.revision++;
    for (const shortcut of this.pressed.keys()) this.releasePressed(shortcut);
    this.bindings.clear();
    this.local.clear();
    for (const shortcut of this.owned) {
      try {
        await unregister(shortcut);
        this.owned.delete(shortcut);
      } catch (error) {
        this.onError(`无法注销快捷键 ${shortcut}：${String(error)}`);
      }
    }
  }

  set(
    bindings: Record<string, string>,
    options: Record<string, HotkeyOptions> = {},
  ): Promise<void> {
    const entries = Object.entries(bindings).map(
      ([action, raw]) => [action, raw, options[action]?.scope] as const,
    );
    return this.queue(async () => {
      if (this.destroyed) return;
      await this.release();
      const conflicts = new Map<string, string>();
      for (const [action, raw, scope] of entries) {
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
        if (this.native && scope !== 'local') {
          try {
            const revision = this.revision;
            await register(shortcut, (event) => {
              if (revision !== this.revision) return;
              if (event.state !== 'Pressed') {
                this.releasePressed(shortcut);
                return;
              }
              if (this.pressed.has(shortcut)) return;
              const current = this.bindings.get(shortcut);
              if (
                !this.destroyed &&
                current &&
                !(document.hasFocus() && editing(document.activeElement))
              ) {
                this.pressed.set(shortcut, current);
                this.run(current, true);
              }
            });
            this.owned.add(shortcut);
          } catch (error) {
            this.onError(`${action} 的快捷键注册失败（可能已被占用）：${raw}；${String(error)}`);
            continue;
          }
        }
        if (!this.destroyed) {
          this.bindings.set(shortcut, action);
          if (!this.native || scope === 'local') this.local.add(shortcut);
        }
      }
    });
  }

  destroy(): Promise<void> {
    this.destroyed = true;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    return this.queue(() => this.release());
  }
}
