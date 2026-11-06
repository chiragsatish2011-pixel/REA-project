/**
 * Reusable Live Fuzzy-Filterable Scrollable List Component
 * Virtualized viewport (10-15 rows), live type-to-filter without modal dialogs,
 * category/tag cycling with Tab, favorite toggle with 'f', and full arrow navigation.
 */

import { ThemeManager } from '../theme.js';
import { RawInputReader, type KeyStroke } from '../raw-input.js';
import { FooterHints } from './footer-hints.js';

export interface FilterableItem<T = any> {
  id: string;
  label: string;
  secondary?: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
  value: T;
}

export interface FilterableListConfig<T = any> {
  title?: string;
  placeholder?: string;
  items: FilterableItem<T>[];
  pageSize?: number;
  initialQuery?: string;
  categories?: string[];
  activeCategory?: string;
  onFavoriteToggle?: (item: FilterableItem<T>) => void;
}

export class FilterableList<T = any> {
  private allItems: FilterableItem<T>[];
  private filteredItems: FilterableItem<T>[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private pageSize: number;
  private query: string;
  private title?: string;
  private categories: string[];
  private currentCategoryIndex = 0;
  private onFavoriteToggle?: (item: FilterableItem<T>) => void;

  constructor(config: FilterableListConfig<T>) {
    this.allItems = [...config.items];
    this.pageSize = config.pageSize || 12;
    this.title = config.title;
    this.query = config.initialQuery || '';
    this.categories = config.categories || ['all'];
    this.onFavoriteToggle = config.onFavoriteToggle;

    if (config.activeCategory) {
      const idx = this.categories.indexOf(config.activeCategory);
      if (idx >= 0) this.currentCategoryIndex = idx;
    }

    this.applyFilter();
  }

  public getSelected(): FilterableItem<T> | null {
    if (this.filteredItems.length === 0) return null;
    return this.filteredItems[this.selectedIndex] || null;
  }

  public getQuery(): string {
    return this.query;
  }

  public getActiveCategory(): string {
    return this.categories[this.currentCategoryIndex] || 'all';
  }

  public setItems(items: FilterableItem<T>[]): void {
    this.allItems = [...items];
    this.applyFilter();
  }

  private applyFilter(): void {
    const q = this.query.trim().toLowerCase();
    const activeCat = this.getActiveCategory().toLowerCase();

    this.filteredItems = this.allItems.filter(item => {
      // Category filter check
      if (activeCat !== 'all') {
        if (activeCat === 'favorites' && !item.isFavorite) return false;
        if (activeCat === 'reasoning' && !item.tags?.includes('reasoning')) return false;
        if (activeCat === 'tools' && !item.tags?.includes('tools')) return false;
        if (activeCat === 'chat' && item.tags?.includes('embedding')) return false;
        if (item.category && item.category.toLowerCase() !== activeCat && activeCat !== 'favorites' && activeCat !== 'reasoning' && activeCat !== 'tools' && activeCat !== 'chat') {
          return false;
        }
      }

      // Query fuzzy match check
      if (!q) return true;
      const targetStr = `${item.id} ${item.label} ${item.secondary || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
      
      // Multi-word fuzzy match
      const words = q.split(/\s+/).filter(Boolean);
      return words.every(word => targetStr.includes(word));
    });

    if (this.selectedIndex >= this.filteredItems.length) {
      this.selectedIndex = Math.max(0, this.filteredItems.length - 1);
    }
    this.adjustScroll();
  }

  private adjustScroll(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.pageSize) {
      this.scrollOffset = this.selectedIndex - this.pageSize + 1;
    }
  }

  public handleKey(key: KeyStroke): 'continue' | 'select' | 'cancel' {
    const total = this.filteredItems.length;

    // Up / k (only when Ctrl or when no text edit collision, or standard up arrow)
    if (key.name === 'up') {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.adjustScroll();
      }
      return 'continue';
    }

    // Down
    if (key.name === 'down') {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex++;
        this.adjustScroll();
      }
      return 'continue';
    }

    // PageUp & PageDown
    if (key.name === 'pageup') {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'pagedown') {
      this.selectedIndex = Math.min(Math.max(0, total - 1), this.selectedIndex + this.pageSize);
      this.adjustScroll();
      return 'continue';
    }

    // Home & End
    if (key.name === 'home') {
      this.selectedIndex = 0;
      this.adjustScroll();
      return 'continue';
    }

    if (key.name === 'end') {
      this.selectedIndex = Math.max(0, total - 1);
      this.adjustScroll();
      return 'continue';
    }

    // Tab: cycle category filters
    if (key.name === 'tab') {
      if (this.categories.length > 1) {
        this.currentCategoryIndex = (this.currentCategoryIndex + 1) % this.categories.length;
        this.applyFilter();
      }
      return 'continue';
    }

    // Favorite toggle hotkey 'f' when query is empty, or Ctrl+F
    if ((key.name === 'char' && key.char === 'f' && !this.query) || (key.name === 'ctrl-f')) {
      const selected = this.getSelected();
      if (selected) {
        selected.isFavorite = !selected.isFavorite;
        if (this.onFavoriteToggle) {
          this.onFavoriteToggle(selected);
        }
        this.applyFilter();
      }
      return 'continue';
    }

    // Backspace: deletes filter character
    if (key.name === 'backspace') {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
      }
      return 'continue';
    }

    // Space character in query
    if (key.name === 'space') {
      this.query += ' ';
      this.applyFilter();
      return 'continue';
    }

    // Standard character typing: appends to filter
    if (key.name === 'char' && key.char) {
      this.query += key.char;
      this.applyFilter();
      return 'continue';
    }

    // Mouse scroll
    if (key.name === 'mouse-scroll-up') {
      if (this.selectedIndex > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 3);
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'mouse-scroll-down') {
      if (this.selectedIndex < total - 1) {
        this.selectedIndex = Math.min(total - 1, this.selectedIndex + 3);
        this.adjustScroll();
      }
      return 'continue';
    }

    if (key.name === 'enter') {
      return this.filteredItems.length > 0 ? 'select' : 'continue';
    }

    if (key.name === 'escape') {
      return 'cancel';
    }

    return 'continue';
  }

  public render(): string[] {
    const c = ThemeManager.getColors();
    const lines: string[] = [];
    const total = this.filteredItems.length;

    // Title & count
    const pos = total > 0 ? ` (${this.selectedIndex + 1} / ${total})` : ` (0 matches)`;
    if (this.title) {
      lines.push(`  ${c.bold}${this.title}${c.reset}${c.secondary}${pos}${c.reset}`);
    }

    // Category filter bar if categories exist
    if (this.categories.length > 1) {
      const catPills = this.categories.map((cat, idx) => {
        if (idx === this.currentCategoryIndex) {
          return `${c.accent}${c.bold}[${cat.toUpperCase()}]${c.reset}`;
        }
        return `${c.secondary}${cat}${c.reset}`;
      });
      lines.push(`  ${c.secondary}Filter category:${c.reset} ${catPills.join('  ')}`);
    }

    // Live search input box
    const cursorMarker = `${c.accent}▋${c.reset}`;
    lines.push(`  ${c.secondary}Filter:${c.reset} ${c.text}${this.query}${cursorMarker}`);

    if (total === 0) {
      lines.push(`  ${c.secondary}  No matching items found. (Backspace to modify filter)${c.reset}`);
      lines.push('');
      lines.push(FooterHints.render([
        { key: 'backspace', label: 'edit filter' },
        { key: 'tab', label: 'cycle categories' },
        { key: 'esc', label: 'cancel' },
      ]));
      return lines;
    }

    const visibleItems = this.filteredItems.slice(this.scrollOffset, this.scrollOffset + this.pageSize);

    // Scroll up indicator
    const hasMoreAbove = this.scrollOffset > 0;
    lines.push(`  ${c.secondary}${hasMoreAbove ? '▲ more above' : ' '}${c.reset}`);

    // Window items
    visibleItems.forEach((item, localIdx) => {
      const globalIdx = this.scrollOffset + localIdx;
      const isSelected = globalIdx === this.selectedIndex;
      const pointer = isSelected ? `${c.accent}❯${c.reset}` : ' ';
      const fav = item.isFavorite ? `${c.warning}★${c.reset} ` : '';

      const labelStr = isSelected
        ? `${c.accent}${c.bold}${item.label}${c.reset}`
        : `${c.text}${item.label}${c.reset}`;

      const secStr = item.secondary ? `  ${c.secondary}${item.secondary}${c.reset}` : '';
      const tagsStr = item.tags && item.tags.length > 0
        ? `  ${item.tags.map(t => `${c.info}[${t}]${c.reset}`).join(' ')}`
        : '';

      lines.push(`  ${pointer} ${fav}${labelStr}${secStr}${tagsStr}`);
    });

    // Scroll down indicator
    const hasMoreBelow = this.scrollOffset + this.pageSize < total;
    lines.push(`  ${c.secondary}${hasMoreBelow ? '▼ more below' : ' '}${c.reset}`);

    // Context hints
    const hints = [
      { key: '↑/↓', label: 'move' },
      { key: 'enter', label: 'select' },
      { key: 'type', label: 'filter' },
    ];
    if (this.categories.length > 1) {
      hints.push({ key: 'tab', label: 'categories' });
    }
    if (this.onFavoriteToggle) {
      hints.push({ key: 'f', label: 'fav' });
    }
    hints.push({ key: 'esc', label: 'cancel' });

    lines.push(FooterHints.render(hints));

    return lines;
  }

  public async prompt(
    stdin: NodeJS.ReadStream = process.stdin,
    stdout: NodeJS.WriteStream = process.stdout
  ): Promise<FilterableItem<T> | null> {
    RawInputReader.enableRawMode(stdin);
    RawInputReader.enableMouse(stdout);
    let lineCount = 0;

    const redraw = () => {
      if (lineCount > 0) {
        stdout.write(`\x1b[${lineCount}A\x1b[0J`);
      }
      const rendered = this.render();
      stdout.write(rendered.join('\n') + '\n');
      lineCount = rendered.length;
    };

    redraw();

    return new Promise<FilterableItem<T> | null>((resolve) => {
      const onData = (chunk: Buffer) => {
        const strokes = RawInputReader.parse(chunk);
        for (const stroke of strokes) {
          const action = this.handleKey(stroke);
          if (action === 'select') {
            cleanup();
            resolve(this.getSelected());
            return;
          }
          if (action === 'cancel') {
            cleanup();
            resolve(null);
            return;
          }
        }
        redraw();
      };

      const cleanup = () => {
        stdin.removeListener('data', onData);
        RawInputReader.disableRawMode(stdin);
        RawInputReader.disableMouse(stdout);
      };

      stdin.on('data', onData);
    });
  }
}
