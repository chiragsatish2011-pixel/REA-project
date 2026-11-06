/**
 * Nomin Code Theme Engine
 * Supports Dark (default cozy palette), Light, High-Contrast, Colorblind-Safe, and NO_COLOR.
 */

export type ThemeName = 'aurora' | 'dark' | 'light' | 'high-contrast' | 'colorblind' | 'none';

export interface ThemeColors {
  reset: string;
  bold: string;
  dim: string;
  italic: string;
  underline: string;
  inverse: string;
  strikethrough: string;

  // Semantic roles
  accent: string;      // Main brand / active item (e.g. electric polar cyan)
  success: string;     // Passed, verified, added (e.g. mint emerald)
  warning: string;     // Caution, rate-limit, review (e.g. solar amber)
  error: string;       // Failure, retired, rejected (e.g. crimson rose)
  info: string;        // Tags, metadata, parameters (e.g. arctic sky)
  secondary: string;   // Dim text, hints, line numbers (e.g. arctic slate)
  border: string;      // Hairlines, separators
  bgHighlight: string; // Selection row background
  text: string;        // Standard text
  bar: string;         // Left vertical card bar (OpenCode electric blue)
  peachBg: string;     // Active selection row background (OpenCode peach solid highlight)
  peachText: string;   // Peach text color
  amber: string;       // Effort badge color (OpenCode amber)
  diffAddBg: string;   // Diff line added background (dark teal)
  diffAddText: string; // Diff line added text (mint/green)
  diffRemoveBg: string;// Diff line removed background (dark crimson)
  diffRemoveText: string;// Diff line removed text (coral/red)
}

const AURORA_COLORS: ThemeColors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',

  accent: '\x1b[38;5;45m',      // Electric polar cyan (#06b6d4)
  success: '\x1b[38;5;49m',     // Aurora mint emerald (#2dd4bf)
  warning: '\x1b[38;5;222m',    // Aurora solar amber (#fcd34d)
  error: '\x1b[38;5;204m',      // Aurora crimson rose (#fb7185)
  info: '\x1b[38;5;117m',       // Arctic ice sky (#38bdf8)
  secondary: '\x1b[38;2;139;148;158m',  // Slate (#8B949E)
  border: '\x1b[38;5;239m',     // Polar night hairline border (#1e293b)
  bgHighlight: '\x1b[48;5;235m',// Polar night selection row (#121826)
  text: '\x1b[38;2;240;246;252m',       // Crisp starlight white (#F0F6FC)
  bar: '\x1b[38;2;88;166;255m',         // OpenCode bright blue (#58A6FF)
  peachBg: '\x1b[48;2;255;184;108m\x1b[38;2;20;20;20m\x1b[1m', // Solid warm peach highlight with bold dark text
  peachText: '\x1b[38;2;255;184;108m',
  amber: '\x1b[38;2;240;136;62m',        // OpenCode amber/orange (#F0883E)
  diffAddBg: '\x1b[48;2;16;44;38m',
  diffAddText: '\x1b[38;2;126;231;135m',
  diffRemoveBg: '\x1b[48;2;60;22;28m',
  diffRemoveText: '\x1b[38;2;255;160;160m',
};

const DARK_COLORS: ThemeColors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',

  accent: '\x1b[38;5;215m',     // Warm amber
  success: '\x1b[38;5;114m',    // Mint green
  warning: '\x1b[38;5;221m',    // Soft gold
  error: '\x1b[38;5;203m',      // Coral red
  info: '\x1b[38;5;111m',       // Sky blue
  secondary: '\x1b[38;2;139;148;158m',  // Slate
  border: '\x1b[38;5;238m',     // Hairline dark slate
  bgHighlight: '\x1b[48;5;236m',// Subtle card highlight
  text: '\x1b[38;2;240;246;252m',
  bar: '\x1b[38;2;88;166;255m',
  peachBg: '\x1b[48;2;255;184;108m\x1b[38;2;20;20;20m\x1b[1m',
  peachText: '\x1b[38;2;255;184;108m',
  amber: '\x1b[38;2;240;136;62m',
  diffAddBg: '\x1b[48;2;16;44;38m',
  diffAddText: '\x1b[38;2;126;231;135m',
  diffRemoveBg: '\x1b[48;2;60;22;28m',
  diffRemoveText: '\x1b[38;2;255;160;160m',
};

const LIGHT_COLORS: ThemeColors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',

  accent: '\x1b[38;5;166m',     // Deep orange/amber
  success: '\x1b[38;5;28m',     // Deep forest green
  warning: '\x1b[38;5;178m',    // Amber brown
  error: '\x1b[38;5;160m',      // Crimson red
  info: '\x1b[38;5;25m',        // Navy blue
  secondary: '\x1b[38;5;241m',  // Medium slate
  border: '\x1b[38;5;250m',     // Light gray border
  bgHighlight: '\x1b[48;5;254m',// Light gray row highlight
  text: '\x1b[30m',
  bar: '\x1b[38;2;9;105;218m',
  peachBg: '\x1b[48;2;255;184;108m\x1b[38;2;20;20;20m\x1b[1m',
  peachText: '\x1b[38;2;188;82;0m',
  amber: '\x1b[38;2;188;82;0m',
  diffAddBg: '\x1b[48;5;194m',
  diffAddText: '\x1b[38;5;28m',
  diffRemoveBg: '\x1b[48;5;224m',
  diffRemoveText: '\x1b[38;5;160m',
};

const HIGH_CONTRAST_COLORS: ThemeColors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',

  accent: '\x1b[93m',           // Bright Yellow
  success: '\x1b[92m',          // Bright Green
  warning: '\x1b[93m',          // Bright Yellow
  error: '\x1b[91m',            // Bright Red
  info: '\x1b[96m',             // Bright Cyan
  secondary: '\x1b[37m',        // Standard White
  border: '\x1b[97m',           // Bright White
  bgHighlight: '\x1b[7m',       // Inverse video
  text: '\x1b[97m',
  bar: '\x1b[96m',
  peachBg: '\x1b[7m',
  peachText: '\x1b[93m',
  amber: '\x1b[93m',
  diffAddBg: '\x1b[42m\x1b[30m',
  diffAddText: '\x1b[1m',
  diffRemoveBg: '\x1b[41m\x1b[97m',
  diffRemoveText: '\x1b[1m',
};

const COLORBLIND_COLORS: ThemeColors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',

  accent: '\x1b[38;5;214m',     // Orange
  success: '\x1b[38;5;39m',     // Blue (replaces green for deuteranopia/protanopia)
  warning: '\x1b[38;5;220m',    // Yellow
  error: '\x1b[38;5;208m',      // Dark Orange/Vermillion
  info: '\x1b[38;5;75m',        // Cyan/Sky
  secondary: '\x1b[38;5;245m',  // Slate
  border: '\x1b[38;5;240m',     // Dark slate
  bgHighlight: '\x1b[48;5;236m',
  text: '\x1b[37m',
  bar: '\x1b[38;5;75m',
  peachBg: '\x1b[48;5;214m\x1b[38;5;232m\x1b[1m',
  peachText: '\x1b[38;5;214m',
  amber: '\x1b[38;5;214m',
  diffAddBg: '\x1b[48;5;24m',
  diffAddText: '\x1b[38;5;39m',
  diffRemoveBg: '\x1b[48;5;52m',
  diffRemoveText: '\x1b[38;5;208m',
};

const NO_COLOR_PALETTE: ThemeColors = {
  reset: '',
  bold: '',
  dim: '',
  italic: '',
  underline: '',
  inverse: '',
  strikethrough: '',

  accent: '',
  success: '',
  warning: '',
  error: '',
  info: '',
  secondary: '',
  border: '',
  bgHighlight: '',
  text: '',
  bar: '',
  peachBg: '',
  peachText: '',
  amber: '',
  diffAddBg: '',
  diffAddText: '',
  diffRemoveBg: '',
  diffRemoveText: '',
};

export class ThemeManager {
  private static currentTheme: ThemeName = 'aurora';
  private static colors: ThemeColors = AURORA_COLORS;

  static {
    if (process.env.NO_COLOR && process.env.NO_COLOR !== '0') {
      ThemeManager.setTheme('none');
    }
  }

  public static setTheme(name: ThemeName): void {
    ThemeManager.currentTheme = name;
    switch (name) {
      case 'dark':
        ThemeManager.colors = DARK_COLORS;
        break;
      case 'light':
        ThemeManager.colors = LIGHT_COLORS;
        break;
      case 'high-contrast':
        ThemeManager.colors = HIGH_CONTRAST_COLORS;
        break;
      case 'colorblind':
        ThemeManager.colors = COLORBLIND_COLORS;
        break;
      case 'none':
        ThemeManager.colors = NO_COLOR_PALETTE;
        break;
      case 'aurora':
      default:
        ThemeManager.colors = AURORA_COLORS;
        break;
    }
  }

  public static getThemeName(): ThemeName {
    return ThemeManager.currentTheme;
  }

  public static getColors(): ThemeColors {
    return ThemeManager.colors;
  }
}
