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

/** Shortcuts belong to the focused application window, never the OS. */
export class Hotkeys {
  private bindings = new Map<string, string>();
  private pressed = new Map<string, string>();
  private destroyed = false;
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
    // Keep Space/Enter activation working for focused controls.
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      ['Space', 'Enter'].includes(event.code) &&
      event.target instanceof Element &&
      event.target.closest('button, a[href], summary, [role="button"]')
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
    if (action && !this.pressed.has(shortcut)) {
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
    for (const shortcut of this.pressed.keys()) {
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
    for (const shortcut of this.pressed.keys()) this.releasePressed(shortcut);
  };

  private release() {
    this.blur();
    this.bindings.clear();
  }

  async set(bindings: Record<string, string>): Promise<void> {
    if (this.destroyed) return;
    this.release();
    for (const [action, raw] of Object.entries(bindings)) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      let shortcut: string;
      try {
        shortcut = normalize(raw);
      } catch (error) {
        this.onError(`${action}：${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const previous = this.bindings.get(shortcut);
      if (previous) {
        this.onError(`${action} 与 ${previous} 的快捷键重复：${raw}`);
        continue;
      }
      this.bindings.set(shortcut, action);
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.blur);
    this.release();
  }
}
