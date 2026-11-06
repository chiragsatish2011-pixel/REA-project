/**
 * Nomin Code: Terminal ANSI Styling & Color Tokens
 * Zero external dependencies.
 */

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  strikethrough: '\x1b[9m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright Foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Cozy 256-Color Claude Code & OpenCode Palette
  amber: '\x1b[38;5;215m',        // Warm Claude Code peach/amber
  coral: '\x1b[38;5;203m',        // Accent coral
  mint: '\x1b[38;5;114m',         // Fresh code green
  sky: '\x1b[38;5;111m',          // Soft informative blue
  lavender: '\x1b[38;5;176m',     // Muted purple / verifier
  gold: '\x1b[38;5;221m',         // Warning / tester yellow
  slate: '\x1b[38;5;244m',        // Neutral secondary text
  darkSlate: '\x1b[38;5;240m',    // Subtle hairline borders
  borderMuted: '\x1b[38;5;238m',  // Very soft line border
  codeHighlight: '\x1b[38;5;153m',// Inline code variable

  // Aurora Theme Palette (Luminescent Polar Colors)
  auroraCyan: '\x1b[38;5;45m',      // Electric polar cyan (#06b6d4)
  auroraEmerald: '\x1b[38;5;49m',   // Aurora mint emerald (#2dd4bf)
  auroraAmber: '\x1b[38;5;222m',    // Solar flare amber (#fcd34d)
  auroraRose: '\x1b[38;5;204m',     // Aurora crimson rose (#fb7185)
  auroraSky: '\x1b[38;5;117m',      // Arctic ice sky (#38bdf8)
  auroraViolet: '\x1b[38;5;177m',   // Polar ionosphere violet (#c084fc)
  auroraMagenta: '\x1b[38;5;213m',  // Northern flare magenta (#e879f9)
  auroraMist: '\x1b[38;5;246m',     // Arctic mist slate (#94a3b8)
  auroraBorder: '\x1b[38;5;239m',   // Polar night hairline (#1e293b)

  // Backgrounds
  bgBlack: '\x1b[40m',
  bgDark: '\x1b[48;5;235m',
  bgCard: '\x1b[48;5;236m',
  bgChip: '\x1b[48;5;237m',
  bgCyan: '\x1b[46m',
  bgBlue: '\x1b[44m',
  bgGreenMuted: '\x1b[48;5;22m',
  bgRedMuted: '\x1b[48;5;52m',
  bgGoldMuted: '\x1b[48;5;58m',
  bgSlate: '\x1b[48;5;238m',

  // Cursor & clear
  clearLine: '\x1b[2K\r',
  clearScreen: '\x1b[2J\x1b[3J\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
};
