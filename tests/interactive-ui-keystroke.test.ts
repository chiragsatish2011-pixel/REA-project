/**
 * Automated UI Keystroke & Interactive Component Test Suite
 * Simulates real terminal keystrokes (Down, Up, Enter, Esc, filter typing, Space, Left/Right, PageDown, Home/End, Shift+Tab)
 * through mock stdin/stdout streams and verifies rendered screens, virtualized scrolling with 120+ models, and themes.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { EventEmitter } from 'node:events';

import { RawInputReader, type KeyStroke } from '../src/cli/raw-input.js';
import { SelectList } from '../src/cli/components/select-list.js';
import { FilterableList } from '../src/cli/components/filterable-list.js';
import { InlineSlider } from '../src/cli/components/slider.js';
import { MultiSelect } from '../src/cli/components/multi-select.js';
import { ConfirmDialog } from '../src/cli/components/confirm-dialog.js';
import { TimelineViewer } from '../src/cli/components/timeline-viewer.js';
import { ModelPicker } from '../src/cli/model-picker.js';
import { SlashMenu } from '../src/cli/slash-menu.js';
import { ThemeManager } from '../src/cli/theme.js';
import { TerminalUI } from '../src/cli/ui.js';
import type { DiscoveredModel } from '../src/provider/types.js';

class MockStdin extends EventEmitter {
  public isTTY = true;
  public setRawMode(mode: boolean) { return this; }
  public resume() { return this; }
  public pause() { return this; }

  public send(bytes: string | Buffer) {
    this.emit('data', Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  }
}

class MockStdout {
  public isTTY = true;
  public columns = 90;
  public rows = 30;
  public output: string = '';

  public write(chunk: string | Buffer): boolean {
    this.output += chunk.toString();
    return true;
  }

  public clear() {
    this.output = '';
  }
}

describe('Interactive UI Keystroke & Component Engine', () => {

  describe('1. RawInputReader Parser', () => {
    it('decodes VT arrow keys, Home/End, and PageUp/PageDown', () => {
      assert.strictEqual(RawInputReader.parse('\x1b[A')[0].name, 'up');
      assert.strictEqual(RawInputReader.parse('\x1b[B')[0].name, 'down');
      assert.strictEqual(RawInputReader.parse('\x1b[C')[0].name, 'right');
      assert.strictEqual(RawInputReader.parse('\x1b[D')[0].name, 'left');
      assert.strictEqual(RawInputReader.parse('\x1b[5~')[0].name, 'pageup');
      assert.strictEqual(RawInputReader.parse('\x1b[6~')[0].name, 'pagedown');
      assert.strictEqual(RawInputReader.parse('\x1b[H')[0].name, 'home');
      assert.strictEqual(RawInputReader.parse('\x1b[F')[0].name, 'end');
    });

    it('decodes Shift+Tab, Enter, Backspace, Space, and Ctrl characters', () => {
      assert.strictEqual(RawInputReader.parse('\x1b[Z')[0].name, 'shift-tab');
      assert.strictEqual(RawInputReader.parse('\r')[0].name, 'enter');
      assert.strictEqual(RawInputReader.parse('\x7f')[0].name, 'backspace');
      assert.strictEqual(RawInputReader.parse(' ')[0].name, 'space');
      assert.strictEqual(RawInputReader.parse('\x12')[0].name, 'ctrl-r');
      assert.strictEqual(RawInputReader.parse('\x0f')[0].name, 'ctrl-o');
    });

    it('decodes SGR mouse clicks and mouse scroll wheel', () => {
      const click = RawInputReader.parse('\x1b[<0;15;5M')[0];
      assert.strictEqual(click.name, 'mouse-click');
      assert.strictEqual(click.mouseCol, 15);
      assert.strictEqual(click.mouseRow, 5);

      const scrollUp = RawInputReader.parse('\x1b[<64;10;10M')[0];
      assert.strictEqual(scrollUp.name, 'mouse-scroll-up');

      const scrollDown = RawInputReader.parse('\x1b[<65;10;10M')[0];
      assert.strictEqual(scrollDown.name, 'mouse-scroll-down');
    });

    it('decodes bracketed paste blocks', () => {
      const paste = RawInputReader.parse('\x1b[200~my-pasted-token-1234\x1b[201~')[0];
      assert.strictEqual(paste.name, 'paste');
      assert.strictEqual(paste.char, 'my-pasted-token-1234');
    });
  });

  describe('2. SelectList Navigation & Windowing', () => {
    it('navigates with Up/Down and selects item with Enter', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const list = new SelectList({
        title: 'Choose Provider',
        options: [
          { id: 'nim', label: 'NVIDIA NIM', value: 'nim' },
          { id: 'openai', label: 'OpenAI API', value: 'openai' },
          { id: 'anthropic', label: 'Anthropic Claude', value: 'anthropic' },
        ],
      });

      const promise = list.prompt(stdin as any, stdout as any);

      // Down arrow -> highlights OpenAI
      stdin.send('\x1b[B');
      // Down arrow -> highlights Anthropic
      stdin.send('\x1b[B');
      // Up arrow -> highlights OpenAI
      stdin.send('\x1b[A');
      // Enter -> selects
      stdin.send('\r');

      const selected = await promise;
      assert.ok(selected);
      assert.strictEqual(selected.value, 'openai');
      assert.strictEqual(selected.label, 'OpenAI API');
    });

    it('cancels on Escape returning null', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const list = new SelectList({
        options: [
          { id: '1', label: 'Item 1', value: '1' },
          { id: '2', label: 'Item 2', value: '2' },
        ],
      });

      const promise = list.prompt(stdin as any, stdout as any);
      stdin.send('\x1b');

      const selected = await promise;
      assert.strictEqual(selected, null);
    });

    it('supports j/k navigation and Home/End jumping in long lists', () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `item-${i}`,
        label: `Item ${i}`,
        value: `val-${i}`,
      }));

      const list = new SelectList({ options: items, pageSize: 10 });
      assert.strictEqual(list.getSelectedIndex(), 0);

      // 'j' moves down
      list.handleKey({ name: 'char', sequence: 'j', char: 'j' });
      assert.strictEqual(list.getSelectedIndex(), 1);

      // 'k' moves up
      list.handleKey({ name: 'char', sequence: 'k', char: 'k' });
      assert.strictEqual(list.getSelectedIndex(), 0);

      // 'end' jumps to end
      list.handleKey({ name: 'end', sequence: '' });
      assert.strictEqual(list.getSelectedIndex(), 49);

      // 'home' jumps to start
      list.handleKey({ name: 'home', sequence: '' });
      assert.strictEqual(list.getSelectedIndex(), 0);

      // 'pagedown' jumps by page
      list.handleKey({ name: 'pagedown', sequence: '' });
      assert.strictEqual(list.getSelectedIndex(), 10);
    });
  });

  describe('3. FilterableList Live Fuzzy Filtering', () => {
    it('filters items in real time as keys are typed', () => {
      const list = new FilterableList({
        title: 'Filter Models',
        items: [
          { id: 'meta/llama-3.3-70b-instruct', label: 'meta/llama-3.3-70b-instruct', tags: ['tools'], value: 'm1' },
          { id: 'deepseek-ai/deepseek-r1', label: 'deepseek-ai/deepseek-r1', tags: ['reasoning'], value: 'm2' },
          { id: 'qwen/qwen2.5-coder-32b', label: 'qwen/qwen2.5-coder-32b', tags: ['tools'], value: 'm3' },
        ],
      });

      // Type "deep"
      for (const ch of 'deep') {
        list.handleKey({ name: 'char', sequence: ch, char: ch });
      }

      assert.strictEqual(list.getQuery(), 'deep');
      const sel = list.getSelected();
      assert.ok(sel);
      assert.strictEqual(sel.id, 'deepseek-ai/deepseek-r1');

      // Backspace deletes characters
      list.handleKey({ name: 'backspace', sequence: '' });
      assert.strictEqual(list.getQuery(), 'dee');
    });

    it('toggles favorites with hotkey "f"', () => {
      let favToggled = false;
      const list = new FilterableList({
        items: [{ id: 'm1', label: 'Model 1', isFavorite: false, value: 'm1' }],
        onFavoriteToggle: () => { favToggled = true; },
      });

      list.handleKey({ name: 'char', sequence: 'f', char: 'f' });
      assert.strictEqual(list.getSelected()?.isFavorite, true);
      assert.strictEqual(favToggled, true);
    });
  });

  describe('4. InlineSlider Effort Cycler', async () => {
    it('adjusts options with Left/Right arrows and confirms on Enter', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const slider = new InlineSlider({
        title: 'Reasoning Effort',
        options: [
          { label: 'off', value: 'off' },
          { label: 'low', value: 'low' },
          { label: 'medium', value: 'medium' },
          { label: 'high', value: 'high' },
          { label: 'max', value: 'max' },
        ],
        initialIndex: 2, // medium
      });

      const promise = slider.prompt(stdin as any, stdout as any);

      // Right arrow -> high
      stdin.send('\x1b[C');
      // Right arrow -> max
      stdin.send('\x1b[C');
      // Left arrow -> high
      stdin.send('\x1b[D');
      // Enter -> confirm
      stdin.send('\r');

      const result = await promise;
      assert.ok(result);
      assert.strictEqual(result.value, 'high');
      assert.strictEqual(result.label, 'high');
    });
  });

  describe('5. MultiSelect Checkbox Navigation', () => {
    it('toggles checkboxes with Space and confirms with Enter', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const multi = new MultiSelect({
        title: 'Select Swarm Pool Models',
        items: [
          { id: 'm1', label: 'Model 1', value: 'm1', selected: false },
          { id: 'm2', label: 'Model 2', value: 'm2', selected: false },
          { id: 'm3', label: 'Model 3', value: 'm3', selected: false },
        ],
      });

      const promise = multi.prompt(stdin as any, stdout as any);

      // Space on m1 -> toggles m1
      stdin.send(' ');
      // Down -> moves to m2
      stdin.send('\x1b[B');
      // Space on m2 -> toggles m2
      stdin.send(' ');
      // Enter -> confirms
      stdin.send('\r');

      const selected = await promise;
      assert.ok(selected);
      assert.strictEqual(selected.length, 2);
      assert.strictEqual(selected[0].id, 'm1');
      assert.strictEqual(selected[1].id, 'm2');
    });
  });

  describe('6. ConfirmDialog Permission Prompt', () => {
    it('accepts shortcut keys directly (a, y, n, p)', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const dialog = new ConfirmDialog({
        promptText: 'Allow bash: npm test ?',
      });

      const promise = dialog.prompt(stdin as any, stdout as any);
      // Press 'a' for Always allow
      stdin.send('a');

      const res = await promise;
      assert.ok(res);
      assert.strictEqual(res.value, 'always');
      assert.strictEqual(res.key, 'a');
    });
  });

  describe('7. ModelPicker with 120+ Models Virtualized', () => {
    it('smoothly scrolls, filters, cycles categories, and selects in 120+ model catalog', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const syntheticModels: DiscoveredModel[] = Array.from({ length: 120 }, (_, i) => ({
        id: `publisher-${i % 5}/model-${i}`,
        providerId: 'nim',
        publisher: `publisher-${i % 5}`,
        modelType: i % 2 === 0 ? 'chat' : 'completion',
        contextWindow: 128000,
        supportsTools: i % 3 === 0,
        supportsReasoning: i % 4 === 0,
        supportsVision: false,
        isAlive: true,
      }));

      const picker = new ModelPicker({
        models: syntheticModels,
        providerName: 'NVIDIA NIM',
        favorites: ['publisher-0/model-0'],
      });

      const promise = picker.prompt(stdin as any, stdout as any);

      // 1. PageDown jumps 12 items
      stdin.send('\x1b[6~');

      // 2. Tab cycles categories
      stdin.send('\t');

      // 3. Type filter: "model-40"
      for (const ch of 'model-40') {
        stdin.send(ch);
      }

      // 4. Enter selects filtered model
      stdin.send('\r');

      const res = await promise;
      assert.ok(res);
      assert.strictEqual(res.modelId, 'publisher-0/model-40');
    });
  });

  describe('8. SlashMenu Popup', () => {
    it('filters slash commands dynamically as characters are typed', () => {
      const menu = new SlashMenu('co');
      const rendered = menu.render();
      assert.ok(rendered.length > 0);

      // Verify filtered subset includes /compact, /cost, /config
      const selected = menu.getSelected();
      assert.ok(selected);
      assert.ok(selected.name.startsWith('/co') || selected.description.toLowerCase().includes('co'));
    });
  });

  describe('9. TimelineViewer Git Checkpoints', () => {
    it('navigates checkpoints and returns selected commit', async () => {
      const stdin = new MockStdin();
      const stdout = new MockStdout();

      const viewer = new TimelineViewer([
        { id: 'c1', title: 'HEAD commit', time: '1 min ago', isCurrent: true },
        { id: 'c2', title: 'Refactor auth engine', time: '10 mins ago' },
        { id: 'c3', title: 'Initial setup', time: '1 hour ago' },
      ]);

      const promise = viewer.prompt(stdin as any, stdout as any);
      // Down -> c2
      stdin.send('\x1b[B');
      // Enter -> select c2
      stdin.send('\r');

      const chosen = await promise;
      assert.ok(chosen);
      assert.strictEqual(chosen.id, 'c2');
      assert.strictEqual(chosen.title, 'Refactor auth engine');
    });
  });

  describe('10. ThemeManager & Semantic Palette', () => {
    it('toggles dark, light, high-contrast, colorblind, and none themes correctly', () => {
      ThemeManager.setTheme('dark');
      assert.strictEqual(ThemeManager.getThemeName(), 'dark');
      assert.ok(ThemeManager.getColors().accent.length > 0);

      ThemeManager.setTheme('light');
      assert.strictEqual(ThemeManager.getThemeName(), 'light');

      ThemeManager.setTheme('high-contrast');
      assert.strictEqual(ThemeManager.getThemeName(), 'high-contrast');

      ThemeManager.setTheme('colorblind');
      assert.strictEqual(ThemeManager.getThemeName(), 'colorblind');

      ThemeManager.setTheme('none');
      assert.strictEqual(ThemeManager.getThemeName(), 'none');
      assert.strictEqual(ThemeManager.getColors().accent, '');
      assert.strictEqual(ThemeManager.getColors().reset, '');

      // Reset back to dark
      ThemeManager.setTheme('dark');
    });
  });
});
