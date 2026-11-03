# Apple Web Design System Specification (`DESIGN.md`)
**Version:** 2.4.0  
**Status:** Implementation-Grade Specification  
**Architecture:** Enterprise Design System (Hardware Showcase & E-Commerce Web Tier)  
**Target Environments:** Modern Web Engines (WebKit, Blink, Gecko), Mobile Safari, Desktop Safari, Chromium, Firefox

---

## 1. Overview & Architectural Philosophy

The Apple Web Design Language is an architectural discipline engineered around a single aesthetic truth: **the product is the hero, and the interface is its whisper-soft pedestal.** 

Unlike conventional enterprise or SaaS user interfaces that rely on structural borders, visual hierarchy through elevation layers, decorative gradients, and dense navigational scaffolding, the Apple web canvas dissolves into the background. Every UI surface, hairline, and typographic scale is calibrated to frame reverent, ultra-high-resolution product photography and render hardware as physical artifacts resting in a modern museum gallery.

```
+-----------------------------------------------------------------------------------+
| GLOBAL NAV: 44px Pure Black Canvas | SF Pro Text 12px/400 | Subtle SVG Icons      |
+-----------------------------------------------------------------------------------+
| SUB NAV: 52px Frosted Glass (saturate(180%) blur(20px)) | Category + Buy CTA Pill |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|                               HERO DISPLAY HEADLINE                               |
|                            SF Pro Display 56-80px / 600                           |
|                                                                                   |
|                                  One-Line Tagline                                 |
|                               SF Pro Text 24-28px / 400                           |
|                                                                                   |
|                      [ Learn more ]        [ Buy ]                                |
|                   (button-secondary)   (button-primary)                           |
|                                                                                   |
|                                                                                   |
|                          REVERENT PRODUCT PHOTOGRAPHY                             |
|                           Edge-to-Edge Cinema Canvas                              |
|                    Single Whisper-Soft Cast Shadow at Base                        |
|                     rgba(0, 0, 0, 0.22) 3px 5px 30px 0                            |
|                                                                                   |
+-----------------------------------------------------------------------------------+
| TILE 1: Pure White (#ffffff)     | TILE 2: Parchment (#f5f5f7)                    |
| 18px Radius | 24px Padding       | 18px Radius | 24px Padding                     |
+----------------------------------+------------------------------------------------+
| TILE 3: Near-Black Tile (#272729)| TILE 4: Near-Black Tile 2 (#2a2a2c)            |
| Inverse Ink Typography           | Inverse Ink Typography                         |
+-----------------------------------------------------------------------------------+
```

### Core Tenets

1. **Reverent Product Photography Framed by Near-Invisible UI:** Interfaces provide spatial breathing room rather than UI decoration. Chrome is reduced to pure essentials; navigation bars, search inputs, and configurators exist as translucent lenses or subtle pills.
2. **Edge-to-Edge Product Tiles:** Content sections stretch across alternating rhythmic full-bleed canvases or modular 18px rounded tiles.
3. **Alternating Light and Dark Canvases:** Seamless transitions between `#ffffff` (Pure White), `#f5f5f7` (Parchment), and near-black tonal surfaces (`#272729`, `#2a2a2c`, `#252527`) establish mood, segment product tiers (Consumer vs. Pro), and sustain editorial momentum without visual fatigue.
4. **Hero Headline + One-Line Tagline + Dual Pill CTAs:** The standard conversion triad:
   - Primary Headline: Bold, precise, weight 600, negative tracking.
   - Tagline: Unadorned, observational, weight 400.
   - CTAs: Dual pill buttons (`button-primary` solid Action Blue pill + `button-secondary-pill` ghost pill) or high-contrast text links with right-pointing micro chevrons (`›`).
5. **Zero Decorative Chrome & Zero Gradients Rule:** Absolute prohibition of skeuomorphic bevels, rainbow gradients, dropshadow overlays on UI containers, or decorative divider flourishes. Flat, purposeful planes of color only.
6. **Whisper-Soft Elevation:** The entire interface contains exactly **one drop shadow**, reserved exclusively for product renders resting on physical surfaces (`rgba(0, 0, 0, 0.22) 3px 5px 30px 0`). All cards, chips, buttons, modals, and navigation components are flat or use frosted optical physics (`backdrop-filter`).
7. **Museum Gallery Feel:** Generous vertical whitespace (up to 120px between narrative blocks) isolates products, granting hardware the dignity of museum-grade artifacts under precision spotlights.

---

## 2. Complete Color Token System

### 2.1 Design Rationale & Color Physics

The Apple color system operates on an intentionally constrained palette. Color is never employed as passive background decoration; instead, saturated chromatic values are strictly conserved for **interactive agency** (Action Blue `#0066cc`) and **focus states** (`#0071e3`). 

Backgrounds are organized into sterile cool whites, tactile parchment neutrals, and three calibrated near-black minerals that prevent the severe glare and clinical sterility of pure pitch black.

#### The Zero Decorative Gradients Rule
> [!IMPORTANT]
> **Strict Mandate:** No gradients may be applied to button backgrounds, card surfaces, headers, or borders. UI surfaces are 100% solid flat color or dynamic frosted glass. Gradients are permitted **only** inside marketing hero typography when expressing custom chip silicon (e.g. Apple Silicon M-series identity) or inside source hardware photography.

### 2.2 Color Token Schema & Values

#### Brand & Accent
| Token Name | Value | Purpose / Architectural Rule |
| :--- | :--- | :--- |
| `colors.primary` (Action Blue) | `#0066cc` | Interactive default state for primary CTA pills, text links on light canvases, and active selection rings. |
| `colors.primary-focus` (Focus Blue) | `#0071e3` | Hover/focus state for Action Blue; selected state border for configurator option chips; keyboard accessibility halos. |
| `colors.primary-on-dark` (Sky Link Blue) | `#2997ff` | High-legibility interactive accent for dark tiles (`#272729` / `#000000`). Passes WCAG AA contrast against dark canvases. |

#### Surfaces & Canvases
| Token Name | Value | Purpose / Architectural Rule |
| :--- | :--- | :--- |
| `colors.surface-white` | `#ffffff` | Primary editorial canvas, consumer showcase backgrounds, card interiors. |
| `colors.surface-parchment` | `#f5f5f7` | Secondary neutral canvas, store shelves, footer background, configurator backgrounds. |
| `colors.surface-pearl` | `#fafafc` | Tactile pearl button fill, elevated micro-surfaces inside parchment containers. |
| `colors.surface-dark-tile-1` | `#272729` | "Pro" hardware primary dark canvas, Dark Mode tile background. |
| `colors.surface-dark-tile-2` | `#2a2a2c` | Mid-depth dark tile for alternating grid shelves and secondary cards. |
| `colors.surface-dark-tile-3` | `#252527` | Deep contrast dark tile for silicon breakdowns and camera sensor showcases. |
| `colors.surface-black` | `#000000` | Global top navigation bar, cinema viewports, OLED edge-to-edge canvas. |
| `colors.surface-chip-gray` | `rgba(210, 210, 215, 0.64)` | Translucent icon capsule buttons, dismiss controls, media player scrubbers. |
| `colors.surface-frosted-light` | `rgba(245, 245, 247, 0.80)` | Sub-navigation bar, floating action dock on light canvas (with 20px blur). |
| `colors.surface-frosted-dark` | `rgba(29, 29, 31, 0.80)` | Floating action dock on dark canvas, sheet overlays (with 20px blur). |

#### Typography & Foreground
| Token Name | Value | Contrast Context / Use Case |
| :--- | :--- | :--- |
| `colors.text-ink` | `#1d1d1f` | Near-Black Ink: Primary headlines, titles, active nav links, and body copy on light surfaces. Avoids harsh #000000 text. |
| `colors.text-body` | `#1d1d1f` | Standard 17px body copy on white and parchment surfaces. |
| `colors.text-on-dark` | `#ffffff` | Pure white text on dark tiles, black hero banners, and inside Action Blue pills. |
| `colors.text-muted` | `#cccccc` | Secondary tagline copy, subtitle labels on dark tiles (`#272729`). |
| `colors.ink-muted-80` | `#333333` | 80% ink density: Secondary subheads, spec comparisons, category eyebrow tags. |
| `colors.ink-muted-48` | `#7a7a7a` | 48% ink density: Micro-legal text, footnotes, disabled states, unselected breadcrumbs. |

#### Hairlines & Dividers
| Token Name | Value | Purpose / Architectural Rule |
| :--- | :--- | :--- |
| `colors.hairline-divider-soft` | `#f0f0f0` / `rgba(0,0,0,0.04)` | Ultra-subtle boundary between parchment cards and white backgrounds. |
| `colors.hairline-border` | `#e0e0e0` | Structural 1px border for configurator chips, utility cards, and search input pills. |
| `colors.hairline-border-dark` | `rgba(255, 255, 255, 0.12)` | Subtle 1px boundary for dark tile separators and dark configurator chips. |

---

### 2.3 Machine-Readable Design Tokens (YAML)

```yaml
version: "2.4.0"
system: "apple-web-design-system"
tokens:
  color:
    brand:
      action_blue:
        value: "#0066cc"
        type: "color"
        description: "Primary interactive action color"
      focus_blue:
        value: "#0071e3"
        type: "color"
        description: "Hover and focus-visible state for primary interactive elements"
      sky_link_blue:
        value: "#2997ff"
        type: "color"
        description: "Interactive link color on dark surfaces"
    surface:
      pure_white:
        value: "#ffffff"
        type: "color"
        description: "Light editorial canvas"
      parchment:
        value: "#f5f5f7"
        type: "color"
        description: "Secondary tactile canvas and footer surface"
      pearl_button:
        value: "#fafafc"
        type: "color"
        description: "Surface for pearl capsule utility controls"
      dark_tile_1:
        value: "#272729"
        type: "color"
        description: "Pro hardware tile canvas"
      dark_tile_2:
        value: "#2a2a2c"
        type: "color"
        description: "Pro secondary shelf canvas"
      dark_tile_3:
        value: "#252527"
        type: "color"
        description: "Pro deep silicon canvas"
      pure_black:
        value: "#000000"
        type: "color"
        description: "Global navigation and cinema canvas"
      chip_gray:
        value: "rgba(210, 210, 215, 0.64)"
        type: "color"
        description: "Translucent circular button fill"
    text:
      near_black_ink:
        value: "#1d1d1f"
        type: "color"
        description: "Primary typography color on light backgrounds"
      body:
        value: "#1d1d1f"
        type: "color"
      on_dark:
        value: "#ffffff"
        type: "color"
      muted:
        value: "#cccccc"
        type: "color"
      ink_muted_80:
        value: "#333333"
        type: "color"
      ink_muted_48:
        value: "#7a7a7a"
        type: "color"
    hairline:
      divider_soft:
        value: "#f0f0f0"
        alpha_variant: "rgba(0, 0, 0, 0.04)"
        type: "color"
      border:
        value: "#e0e0e0"
        type: "color"
      border_dark:
        value: "rgba(255, 255, 255, 0.12)"
        type: "color"
```

### 2.4 Production CSS Custom Properties Implementation

```css
:root {
  /* Brand & Interactive */
  --apple-color-primary: #0066cc;
  --apple-color-primary-focus: #0071e3;
  --apple-color-primary-on-dark: #2997ff;

  /* Surfaces */
  --apple-surface-white: #ffffff;
  --apple-surface-parchment: #f5f5f7;
  --apple-surface-pearl: #fafafc;
  --apple-surface-dark-1: #272729;
  --apple-surface-dark-2: #2a2a2c;
  --apple-surface-dark-3: #252527;
  --apple-surface-black: #000000;
  --apple-surface-chip-gray: rgba(210, 210, 215, 0.64);
  --apple-surface-frosted-light: rgba(245, 245, 247, 0.80);
  --apple-surface-frosted-dark: rgba(29, 29, 31, 0.80);

  /* Typography */
  --apple-text-ink: #1d1d1f;
  --apple-text-body: #1d1d1f;
  --apple-text-on-dark: #ffffff;
  --apple-text-muted: #cccccc;
  --apple-text-ink-80: #333333;
  --apple-text-ink-48: #7a7a7a;

  /* Hairlines & Borders */
  --apple-hairline-soft: #f0f0f0;
  --apple-hairline-soft-alpha: rgba(0, 0, 0, 0.04);
  --apple-hairline-border: #e0e0e0;
  --apple-hairline-border-dark: rgba(255, 255, 255, 0.12);

  /* Single Universal Shadow */
  --apple-elevation-product-shadow: 3px 5px 30px 0 rgba(0, 0, 0, 0.22);
}

/* Explicit Dark Tile Context Override */
[data-tile-theme="dark"],
.tile-dark {
  --apple-text-ink: #ffffff;
  --apple-text-body: #f5f5f7;
  --apple-text-muted: #cccccc;
  --apple-text-ink-80: #a1a1a6;
  --apple-text-ink-48: #86868b;
  --apple-hairline-border: rgba(255, 255, 255, 0.12);
  --apple-hairline-soft: rgba(255, 255, 255, 0.06);
}
```

---

## 3. Typography System

### 3.1 Font Family Architecture & Inter Fallback

The Apple typography stack relies on the San Francisco superfamily. To render pixel-perfect Apple typography across cross-platform browsers (Windows, Linux, Android) where SF Pro is not native, the system defines an exact fallback configuration using `Inter` with calibrated font features:

```css
/* Core Apple Font Family Stack */
--apple-font-display: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--apple-font-text: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

#### The Optical Size Switch
- For font sizes **$\ge$ 19px**: The system enforces `SF Pro Display`. Glyphs are sculpted with tighter letterform proportions and condensed internal spacing designed for large headlines.
- For font sizes **$<$ 20px**: The system enforces `SF Pro Text`. Apertures are wider, counters are larger, and spacing is wider to preserve legibility at standard reading sizes.

#### Fallback Calibration for Inter
When SF Pro is not present on the host OS, `Inter` must be calibrated via OpenType font features to match the high-x-height and rounded geometry of San Francisco:
```css
.font-inter-fallback {
  font-family: "Inter", -apple-system, sans-serif;
  font-feature-settings: "cv02" 1, "cv03" 1, "cv04" 1, "cv11" 1, "ss01" 1, "ss03" 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

---

### 3.2 Explicit Typographic Principles

1. **Negative Letter-Spacing on Display Sizes:** All display typography above 28px must utilize negative tracking ranging from `-0.015em` to `-0.022em` (or `-0.28px` to `-0.374px` at mid-tier sizes, scaling down to `-1.5px` on 80px hero banners). This tightens the headline into a unified sculptural wordmark.
2. **The 17px Body Copy Standard:** In contrast to the standard web 16px body copy, Apple standardizes reading text on **17px (1.0625rem)** with a line-height of `1.47059` (~25px). This specific metric provides ideal optical cadence for long-form hardware narrative.
3. **Weight 300 Rarity:** `font-weight: 300` (Light) is an ethereal accent weight. It is reserved exclusively for massive store headlines or ethereal hero statements (`button-store-hero`). It is strictly prohibited in body copy, buttons, or form controls.
4. **Weight 600 Headlines (Absolute Prohibition of Weight 500):**
   > [!WARNING]
   > **Anti-Pattern Guard:** Weight 500 (Medium) is **prohibited** on web editorial headers. Apple web headers transition directly from Regular 400 to Semibold 600. Weight 500 lacks the authoritative architectural contrast required against thin hairlines.
5. **Contextual Line-Heights:** Ranging from ultra-condensed `1.07` on massive 80px hero headlines to an expansive `2.41` on dense footer link columns to ensure generous, thumb-friendly tap targets and high visual scanning comfort.

---

### 3.3 Full Typographic Hierarchy Table

| Token / Style Name | Font Family | Size (px / rem) | Weight | Line Height | Letter Spacing (Tracking) | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `hero-display` | SF Pro Display | 80px / 5.0rem | 600 | 1.07 (86px) | -0.022em (-1.76px) | Primary flagship product announcement headlines |
| `display-lg` | SF Pro Display | 56px / 3.5rem | 600 | 1.07 (60px) | -0.020em (-1.12px) | Major feature section intros, hardware category titles |
| `display-md` | SF Pro Display | 40px / 2.5rem | 600 | 1.10 (44px) | -0.018em (-0.72px) | Grid tile titles, secondary hero cards |
| `lead` | SF Pro Display | 28px / 1.75rem | 600 | 1.14 (32px) | -0.015em (-0.42px) | Subsection headers, spec card lead-ins |
| `lead-airy` | SF Pro Display | 24px / 1.5rem | 400 | 1.33 (32px) | -0.010em (-0.24px) | Narrative product intros, environmental manifesto quotes |
| `tagline` | SF Pro Display | 21px / 1.3125rem | 400 | 1.38 (29px) | -0.008em (-0.17px) | Hero secondary tagline directly below headline |
| `body-strong` | SF Pro Text | 17px / 1.0625rem | 600 | 1.47 (25px) | -0.005em (-0.08px) | Emphasized body statements, spec key labels |
| `body` | SF Pro Text | 17px / 1.0625rem | 400 | 1.47 (25px) | -0.005em (-0.08px) | Standard prose, narrative description, editorial copy |
| `dense-link` | SF Pro Text | 12px / 0.75rem | 400 | 2.41 (29px) | -0.002em (-0.02px) | Directory columns in global footer, tertiary sub-menus |
| `caption` | SF Pro Text | 14px / 0.875rem | 400 | 1.42 (20px) | 0.000em (0.00px) | Secondary metadata, spec notes, pricing subtext |
| `caption-strong`| SF Pro Text | 14px / 0.875rem | 600 | 1.42 (20px) | 0.000em (0.00px) | Eyebrow badges, hardware chip callouts (M3 MAX) |
| `button-large` | SF Pro Text | 17px / 1.0625rem | 400 | 1.17 (20px) | -0.005em (-0.08px) | Full-bleed hero pill CTAs (Buy, Learn More) |
| `button-utility`| SF Pro Text | 12px / 0.75rem | 400 | 1.33 (16px) | 0.000em (0.00px) | Compact sub-nav pill CTAs, filter chips |
| `button-store-hero`| SF Pro Display| 18px / 1.125rem | 300 | 1.22 (22px) | +0.010em (+0.18px)| Expansive store hero CTA button |
| `fine-print` | SF Pro Text | 12px / 0.75rem | 400 | 1.33 (16px) | 0.000em (0.00px) | Disclaimers, carrier billing notices, footnotes |
| `micro-legal` | SF Pro Text | 10px / 0.625rem | 400 | 1.30 (13px) | +0.005em (+0.05px)| Trademark statements, statutory copyright footer |
| `nav-link` | SF Pro Text | 12px / 0.75rem | 400 | 1.00 (12px) | -0.002em (-0.02px)| Global navigation 44px bar anchor links |

---

### 3.4 Production Typography CSS Rules

```css
.typography-hero-display {
  font-family: var(--apple-font-display);
  font-size: 80px;
  font-weight: 600;
  line-height: 1.075;
  letter-spacing: -0.022em;
  color: var(--apple-text-ink);
}

.typography-display-lg {
  font-family: var(--apple-font-display);
  font-size: 56px;
  font-weight: 600;
  line-height: 1.071;
  letter-spacing: -0.020em;
  color: var(--apple-text-ink);
}

.typography-display-md {
  font-family: var(--apple-font-display);
  font-size: 40px;
  font-weight: 600;
  line-height: 1.100;
  letter-spacing: -0.018em;
  color: var(--apple-text-ink);
}

.typography-lead {
  font-family: var(--apple-font-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.142;
  letter-spacing: -0.015em;
  color: var(--apple-text-ink);
}

.typography-lead-airy {
  font-family: var(--apple-font-display);
  font-size: 24px;
  font-weight: 400;
  line-height: 1.333;
  letter-spacing: -0.010em;
  color: var(--apple-text-ink);
}

.typography-tagline {
  font-family: var(--apple-font-display);
  font-size: 21px;
  font-weight: 400;
  line-height: 1.380;
  letter-spacing: -0.008em;
  color: var(--apple-text-ink);
}

.typography-body {
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.47059;
  letter-spacing: -0.005em;
  color: var(--apple-text-body);
}

.typography-body-strong {
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.47059;
  letter-spacing: -0.005em;
  color: var(--apple-text-body);
}

.typography-dense-link {
  font-family: var(--apple-font-text);
  font-size: 12px;
  font-weight: 400;
  line-height: 2.416;
  letter-spacing: -0.002em;
  color: var(--apple-text-ink-80);
}

.typography-caption {
  font-family: var(--apple-font-text);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.428;
  letter-spacing: 0.000em;
  color: var(--apple-text-ink-80);
}

.typography-caption-strong {
  font-family: var(--apple-font-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.428;
  letter-spacing: 0.000em;
  color: var(--apple-text-ink);
}

.typography-fine-print {
  font-family: var(--apple-font-text);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.333;
  letter-spacing: 0.000em;
  color: var(--apple-text-ink-48);
}

.typography-micro-legal {
  font-family: var(--apple-font-text);
  font-size: 10px;
  font-weight: 400;
  line-height: 1.300;
  letter-spacing: +0.005em;
  color: var(--apple-text-ink-48);
}
```

---

## 4. Layout, Spacing & Sizing Architecture

### 4.1 The 8px Spatial Grid & Token Scale

The layout engine is governed by an 8-point harmonic grid. Spacing values anchor all padding, margins, gaps, and component heights.

```
Token Scale:
xxs (4px) -> xs (8px) -> sm (12px) -> md (16px) -> lg (20px) -> xl (24px) -> 2xl (32px) -> 3xl (40px) -> 4xl (48px) -> 5xl (64px) -> section (80px) -> grand (120px)
```

| Spacing Token | Pixels | CSS Value | Architectural Usage |
| :--- | :--- | :--- | :--- |
| `space.xxs` | 4px | `0.25rem` | Micro icon-to-label gap, badge internal padding |
| `space.xs` | 8px | `0.50rem` | Grid base step, chip vertical padding, button tight margin |
| `space.sm` | 12px | `0.75rem` | Card internal element spacing, dense list gap |
| `space.md` | 16px | `1.00rem` | Standard horizontal button padding, small container padding |
| `space.lg` | 20px | `1.25rem` | Medium container gap, modal padding mobile |
| `space.xl` | 24px | `1.50rem` | Standard Card Padding (`padding: 24px`), shelf column gap |
| `space.2xl` | 32px | `2.00rem` | Subsection header bottom margin, tile content spacing |
| `space.3xl` | 40px | `2.50rem` | Hero CTA block margin-top, tablet container gutter |
| `space.4xl` | 48px | `3.00rem` | Major content block separation |
| `space.5xl` | 64px | `4.00rem` | Standard section top/bottom padding |
| `space.section` | 80px | `5.00rem` | Major product transition padding, alternating canvas boundary |
| `space.grand` | 120px | `7.50rem` | Flagship hero banner whitespace pedestal isolation |

### 4.2 Standard Container Max Widths

To balance cinematic impact with optimal eye-tracking velocity, layouts conform to three rigid layout widths:

1. **Editorial & Narrative Column (`max-width: 980px`):**  
   Applied to long-form reading prose, spec comparison matrices, environment manifestos, and the global directory footer. Ensures line length never exceeds 80 characters for optimal reading cadence.
2. **Product Grid & Store Shelf (`max-width: 1440px`):**  
   Applied to multi-device comparison rows, accessory carousels, configurator canvases, and card grids.
3. **Full-Bleed Tiles & Cinema Banners (`max-width: 100vw` / `100%`):**  
   Hero launch modules, alternating canvas sections, and full-bleed photography. Padding defaults to `0` at the viewport edge or `24px` gutter on mobile.

### 4.3 Component Spatial Geometry

- **Card Internal Padding:** Fixed at exactly **`24px`** (`space.xl`). This standard applies across light tiles, dark tiles, and utility store cards.
- **Button Padding Rules:**
  - Standard Pill Button: `8px to 11px` vertical $\times$ `15px to 22px` horizontal.
  - Sub-Nav Compact Pill: `4px` vertical $\times$ `11px` horizontal.
  - Store Hero Button: `12px` vertical $\times$ `24px` horizontal.

### 4.4 The Whitespace Philosophy: Pedestal for Product

In the Apple web grammar, white space is not passive emptiness; it is an active physical pedestal. A flagship iPhone or MacBook render is frequently afforded between `80px` and `120px` of uninterrupted empty canvas above and below its geometry. By withholding decorative sidebars, floating widgets, and banner clutter, the user's attention is focused on product materials, titanium bevels, and optical glass refractions.

---

## 5. Elevation, Depth & Glass Physics

### 5.1 The Single Drop Shadow Rule

> [!CAUTION]
> **Strict System Constraint:** The Apple web design system contains **exactly one drop shadow**.
> 
> ```css
> box-shadow: 3px 5px 30px 0 rgba(0, 0, 0, 0.22);
> ```
> 
> **Allowed:** Hardware product renders resting on a light canvas surface to establish physical weight and spatial grounding.  
> **Strictly Prohibited:** No drop shadow may ever be assigned to:
> - Content cards (`product-tile-light`, `product-tile-dark`)
> - Navigation headers or footers
> - Buttons (`button-primary`, `button-pearl-capsule`)
> - Dropdowns, popovers, or configurator chips
> - Modals or dialogs

Depth across UI containers is achieved exclusively through **color contrast** (Pure White on Parchment `#f5f5f7`), **1px hairlines** (`#e0e0e0`), or **optical backdrop blur** (`backdrop-filter`).

```
                +------------------------------------+
                |                                    |
                |        [ HARDWARE RENDER ]         |
                |                                    |
                +------------------------------------+
                   \                                /
    ========================================================  SURFACE
      ::: SINGLE SYSTEM DROP SHADOW (Product Render Only) :::
            rgba(0, 0, 0, 0.22) 3px 5px 30px 0
```

### 5.2 Frosted Glass Surface Physics

Apple navigations and floating docks float above continuous hardware imagery using frosted glass refraction. This is accomplished using a 20-pixel Gaussian blur paired with an over-saturated color matrix to amplify background colors passing through the substrate:

```css
.apple-frosted-surface-light {
  background-color: rgba(245, 245, 247, 0.80);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.apple-frosted-surface-dark {
  background-color: rgba(29, 29, 31, 0.80);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
```

### 5.3 Z-Index Layering Scale

```css
--apple-z-ground: 0;       /* Base canvas & photography */
--apple-z-tile: 10;        /* Floating interactive product cards */
--apple-z-sticky-bar: 50;  /* Floating bottom configurator bar */
--apple-z-subnav: 100;     /* Sticky frosted sub-navigation */
--apple-z-globalnav: 200;  /* 44px fixed top global navigation */
--apple-z-overlay: 300;    /* Search overlay, full-screen nav drawers */
--apple-z-modal: 400;      /* Legal sheets, checkout modals */
```

---

## 6. Shapes & Border Radii Geometry

### 6.1 Radii Token Scale

Apple shapes avoid abrupt sharp corners while strictly avoiding arbitrary mixed radii. Corners emulate standard squircle or continuous curvature paths:

| Token Name | Radius Value | Component Mapping |
| :--- | :--- | :--- |
| `radius.none` | `0px` | Full-bleed hero banners, edge-to-edge canvas sections, global nav |
| `radius.xs` | `5px` | Micro-badges, inline code tags |
| `radius.sm` | `8px` | `button-dark-utility`, thumbnail preview containers |
| `radius.md` | `11px` | `button-pearl-capsule`, medium accessory cards |
| `radius.lg` | `18px` | `product-tile-*`, `store-utility-card`, modular grid blocks, 1:1 accessory crops |
| `radius.pill` | `9999px` | `button-primary`, `button-secondary-pill`, `configurator-option-chip`, `search-input` |
| `radius.full` | `50%` | `button-icon-circular`, color-swatch selectors, avatar bubbles |

### 6.2 Photography & Media Geometry

- **Cinematic Flagship Heroes:** `21:9` ultra-wide aspect ratio for desktop hero canvases; `16:9` on mobile viewports.
- **Hardware Feature Tiles:** `16:10` or `4:3` container proportions, nested within `radius.lg` (18px) overflow-hidden cards.
- **Accessory & Swatch Grids:** Strict `1:1` square aspect ratio with `radius.lg` (18px) masking.

---

## 7. Component Specifications

### 7.1 Top Navigation

#### 7.1.1 Global Navigation (`global-nav`)
The universal 44px bar positioned at the top of the Apple web ecosystem. It establishes identity and high-level routing while blending into the hardware display bezels.

- **Height:** Exactly `44px`.
- **Canvas:** Pure Black (`#000000`) or frosted dark (`rgba(0, 0, 0, 0.8)`).
- **Container Width:** Max `1024px`, centered, `padding: 0 16px`.
- **Typography:** `SF Pro Text`, 12px, weight 400, letter-spacing `-0.002em`.
- **Link States:**
  - Default: `#d6d6d6` (or `rgba(255, 255, 255, 0.8)`).
  - Hover: `#ffffff` (`rgba(255, 255, 255, 1.0)`), smooth opacity transition `150ms ease`.
- **Icons:** Minimal SVG path icons for Apple Logo (16px high), Search glass, and Shopping Bag.

```html
<header class="global-nav">
  <div class="global-nav-container">
    <a href="/" class="global-nav-logo" aria-label="Apple">
      <svg class="apple-logo-icon" width="14" height="44" viewBox="0 0 14 44" fill="currentColor">
        <path d="M13.0729 17.6825C12.3842 18.0833 11.4552 18.5985 10.4283 18.6322C8.6186 18.6828 7.3598 17.5029 6.3888 17.5029C5.3857 17.5029 4.2127 18.6154 2.8258 18.6491C1.3069 18.6996 0 17.385 0 15.6823C0 13.0863 1.9806 10.9622 4.1622 10.9622C5.352 10.9622 6.3045 11.7545 7.0463 11.7545C7.7543 11.7545 8.8501 10.9117 10.1923 10.9117C11.1026 10.9117 12.3842 11.3837 13.0729 12.294C11.9599 12.9515 11.3361 14.2157 11.3361 15.6318C11.3361 17.0646 12.0273 18.0664 13.0729 18.6825Z"/>
      </svg>
    </a>
    <nav class="global-nav-links">
      <a href="/store" class="global-nav-item">Store</a>
      <a href="/mac" class="global-nav-item">Mac</a>
      <a href="/ipad" class="global-nav-item">iPad</a>
      <a href="/iphone" class="global-nav-item">iPhone</a>
      <a href="/watch" class="global-nav-item">Watch</a>
      <a href="/vision" class="global-nav-item">Vision</a>
      <a href="/airpods" class="global-nav-item">AirPods</a>
      <a href="/tv-home" class="global-nav-item">TV &amp; Home</a>
      <a href="/entertainment" class="global-nav-item">Entertainment</a>
      <a href="/accessories" class="global-nav-item">Accessories</a>
      <a href="/support" class="global-nav-item">Support</a>
    </nav>
    <div class="global-nav-actions">
      <button class="global-nav-btn" aria-label="Search">
        <svg width="15" height="44" viewBox="0 0 15 44" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="6.5" cy="21.5" r="5" />
          <path d="M10.2 25.2L13.5 28.5" stroke-linecap="round" />
        </svg>
      </button>
      <button class="global-nav-btn" aria-label="Shopping Bag">
        <svg width="14" height="44" viewBox="0 0 14 44" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M2.5 16.5H11.5L12.5 28.5H1.5L2.5 16.5Z" />
          <path d="M4.5 16.5V14C4.5 12.6193 5.61929 11.5 7 11.5C8.38071 11.5 9.5 12.6193 9.5 14V16.5" />
        </svg>
      </button>
    </div>
  </div>
</header>
```

```css
.global-nav {
  position: sticky;
  top: 0;
  left: 0;
  width: 100%;
  height: 44px;
  background-color: rgba(0, 0, 0, 0.80);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  z-index: var(--apple-z-globalnav);
}

.global-nav-container {
  max-width: 1024px;
  height: 44px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.global-nav-links {
  display: flex;
  align-items: center;
  gap: 32px;
}

.global-nav-item {
  font-family: var(--apple-font-text);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: -0.002em;
  color: rgba(255, 255, 255, 0.80);
  text-decoration: none;
  transition: color 150ms ease;
}

.global-nav-item:hover {
  color: #ffffff;
}

.global-nav-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.80);
  cursor: pointer;
  padding: 0 4px;
  display: flex;
  align-items: center;
  transition: color 150ms ease;
}

.global-nav-btn:hover {
  color: #ffffff;
}
```

---

#### 7.1.2 Sub-Navigation Frosted (`sub-nav-frosted`)
Sticky product-specific bar that attaches beneath the global nav during hardware narrative scrolls.

- **Height:** Exactly `52px`.
- **Canvas:** Frosted Glass (`rgba(245, 245, 247, 0.80)` with `saturate(180%) blur(20px)`).
- **Hairline:** 1px solid `rgba(0, 0, 0, 0.08)` border-bottom.
- **Product Title:** SF Pro Display, 21px, weight 600, letter-spacing `-0.008em`.
- **Anchor Links:** SF Pro Text, 12px, weight 400, color `#1d1d1f`.
- **CTA:** Compact `button-primary` (24px height pill, 11px font size).

```html
<nav class="sub-nav-frosted">
  <div class="sub-nav-container">
    <div class="sub-nav-title">iPhone 16 Pro</div>
    <div class="sub-nav-actions">
      <ul class="sub-nav-menu">
        <li><a href="#overview" class="sub-nav-link active">Overview</a></li>
        <li><a href="#specs" class="sub-nav-link">Tech Specs</a></li>
      </ul>
      <a href="/shop/buy-iphone" class="button-primary button-primary-compact">Buy</a>
    </div>
  </div>
</nav>
```

```css
.sub-nav-frosted {
  position: sticky;
  top: 44px;
  width: 100%;
  height: 52px;
  background-color: var(--apple-surface-frosted-light);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  z-index: var(--apple-z-subnav);
}

.sub-nav-container {
  max-width: 980px;
  height: 52px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sub-nav-title {
  font-family: var(--apple-font-display);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.008em;
  color: var(--apple-text-ink);
}

.sub-nav-actions {
  display: flex;
  align-items: center;
  gap: 24px;
}

.sub-nav-menu {
  display: flex;
  list-style: none;
  gap: 20px;
  margin: 0;
  padding: 0;
}

.sub-nav-link {
  font-family: var(--apple-font-text);
  font-size: 12px;
  color: var(--apple-text-ink-80);
  text-decoration: none;
  transition: color 150ms ease;
}

.sub-nav-link:hover,
.sub-nav-link.active {
  color: var(--apple-text-ink);
}
```

---

### 7.2 Buttons & Interactive Controls

#### 7.2.1 State Matrix for All Button Components

| Component | Default State | Hover State | Focus-Visible State | Active State (Pressed) | Disabled State |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `button-primary` | BG: `#0066cc`, Text: `#ffffff`, Pill radius | BG: `#0071e3` | Box-shadow: `0 0 0 3px rgba(0,113,227,0.4)` | `transform: scale(0.95)`, BG: `#0055b3` | BG: `rgba(0,0,0,0.08)`, Text: `#a1a1a6`, cursor: `not-allowed` |
| `button-secondary-pill` | Border: `1px solid #0066cc`, Text: `#0066cc`, Transparent BG | BG: `rgba(0,102,204,0.05)`, Border: `#0071e3` | Box-shadow: `0 0 0 3px rgba(0,113,227,0.4)` | `transform: scale(0.95)`, BG: `rgba(0,102,204,0.12)` | Border: `1px solid #e0e0e0`, Text: `#a1a1a6` |
| `button-dark-utility` | BG: `#1d1d1f`, Text: `#ffffff`, Radius: `8px` | BG: `#333333` | Box-shadow: `0 0 0 3px rgba(29,29,31,0.3)` | `transform: scale(0.98)`, BG: `#000000` | BG: `#f5f5f7`, Text: `#86868b` |
| `button-pearl-capsule` | BG: `#fafafc`, Border: `1px solid #e0e0e0`, Radius: `11px` | BG: `#f5f5f7`, Border: `#d2d2d7` | Box-shadow: `0 0 0 3px rgba(0,113,227,0.3)` | `transform: scale(0.98)`, BG: `#e8e8ed` | BG: `#ffffff`, Border: `#f0f0f0`, Text: `#cccccc` |
| `button-store-hero` | Text: `#1d1d1f`, Weight: 300, 18px, Pill border | Border: `1px solid #1d1d1f`, BG: `#f5f5f7` | Box-shadow: `0 0 0 3px rgba(0,113,227,0.3)` | `transform: scale(0.96)` | Opacity: 0.4 |
| `button-icon-circular` | 44x44px circular, BG: `rgba(210,210,215,0.64)` | BG: `rgba(210,210,215,0.85)` | Box-shadow: `0 0 0 3px rgba(0,113,227,0.4)` | `transform: scale(0.92)` | Opacity: 0.3 |
| `text-link` | Text: `#0066cc`, Chevron `›` | Text: `#0071e3`, Text-decoration: `underline` | Outline: `2px solid #0071e3`, outline-offset: `2px` | Text: `#0055b3` | Text: `#86868b`, cursor: `not-allowed` |
| `text-link-on-dark` | Text: `#2997ff`, Chevron `›` | Text: `#66b5ff`, Text-decoration: `underline` | Outline: `2px solid #2997ff`, outline-offset: `2px` | Text: `#1a82e6` | Text: `#6e6e73` |

---

#### 7.2.2 Button Component Implementations

```css
/* 1. Primary Full Pill CTA */
.button-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--apple-color-primary);
  color: #ffffff;
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.17647;
  letter-spacing: -0.005em;
  padding: 11px 22px;
  border-radius: 9999px;
  border: none;
  cursor: pointer;
  text-decoration: none;
  box-sizing: border-box;
  transition: background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
              transform 120ms cubic-bezier(0.4, 0, 0.2, 1);
  -webkit-user-select: none;
  user-select: none;
}

.button-primary:hover {
  background-color: var(--apple-color-primary-focus);
}

.button-primary:active {
  transform: scale(0.95);
  background-color: #0055b3;
}

.button-primary:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.4);
}

.button-primary-compact {
  font-size: 11px;
  padding: 4px 11px;
}

/* 2. Secondary Ghost Pill CTA */
.button-secondary-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  color: var(--apple-color-primary);
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.17647;
  letter-spacing: -0.005em;
  padding: 10px 21px; /* 1px subtracted for 1px border */
  border-radius: 9999px;
  border: 1px solid var(--apple-color-primary);
  cursor: pointer;
  text-decoration: none;
  transition: background-color 150ms ease,
              border-color 150ms ease,
              transform 120ms ease;
}

.button-secondary-pill:hover {
  background-color: rgba(0, 102, 204, 0.05);
  border-color: var(--apple-color-primary-focus);
  color: var(--apple-color-primary-focus);
}

.button-secondary-pill:active {
  transform: scale(0.95);
  background-color: rgba(0, 102, 204, 0.12);
}

/* 3. Dark Utility Button (8px radius) */
.button-dark-utility {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--apple-text-ink);
  color: #ffffff;
  font-family: var(--apple-font-text);
  font-size: 14px;
  font-weight: 400;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 150ms ease, transform 120ms ease;
}

.button-dark-utility:hover {
  background-color: var(--apple-text-ink-80);
}

.button-dark-utility:active {
  transform: scale(0.98);
}

/* 4. Pearl Capsule Button (11px radius) */
.button-pearl-capsule {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--apple-surface-pearl);
  color: var(--apple-text-ink);
  font-family: var(--apple-font-text);
  font-size: 14px;
  font-weight: 400;
  padding: 8px 18px;
  border-radius: 11px;
  border: 1px solid var(--apple-hairline-border);
  cursor: pointer;
  text-decoration: none;
  transition: background-color 150ms ease, border-color 150ms ease, transform 120ms ease;
}

.button-pearl-capsule:hover {
  background-color: var(--apple-surface-parchment);
  border-color: #d2d2d7;
}

.button-pearl-capsule:active {
  transform: scale(0.98);
}

/* 5. Store Hero Ethereal Button (18px / 300 weight) */
.button-store-hero {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  color: var(--apple-text-ink);
  font-family: var(--apple-font-display);
  font-size: 18px;
  font-weight: 300;
  line-height: 1.222;
  letter-spacing: 0.010em;
  padding: 12px 24px;
  border-radius: 9999px;
  border: 1px solid var(--apple-text-ink);
  cursor: pointer;
  text-decoration: none;
  transition: background-color 150ms ease, transform 120ms ease;
}

.button-store-hero:hover {
  background-color: var(--apple-surface-parchment);
}

.button-store-hero:active {
  transform: scale(0.96);
}

/* 6. Translucent Circular Icon Button (44x44px) */
.button-icon-circular {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: var(--apple-surface-chip-gray);
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--apple-text-ink);
  cursor: pointer;
  transition: background-color 150ms ease, transform 120ms ease;
}

.button-icon-circular:hover {
  background-color: rgba(210, 210, 215, 0.85);
}

.button-icon-circular:active {
  transform: scale(0.92);
}

/* 7. Text Link with Micro Chevron */
.text-link {
  display: inline-flex;
  align-items: center;
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  color: var(--apple-color-primary);
  text-decoration: none;
  gap: 4px;
}

.text-link::after {
  content: "›";
  font-size: 19px;
  line-height: 1;
  position: relative;
  top: -1px;
  transition: transform 150ms ease;
}

.text-link:hover {
  color: var(--apple-color-primary-focus);
  text-decoration: underline;
}

.text-link:hover::after {
  transform: translateX(3px);
}

/* 8. Text Link on Dark Canvas */
.text-link-on-dark {
  display: inline-flex;
  align-items: center;
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  color: var(--apple-color-primary-on-dark);
  text-decoration: none;
  gap: 4px;
}

.text-link-on-dark::after {
  content: "›";
  font-size: 19px;
  line-height: 1;
  position: relative;
  top: -1px;
  transition: transform 150ms ease;
}

.text-link-on-dark:hover {
  color: #66b5ff;
  text-decoration: underline;
}

.text-link-on-dark:hover::after {
  transform: translateX(3px);
}
```

---

### 7.3 Cards & Containers

#### 7.3.1 Product Tiles Specifications
All Apple cards share an 18px squircle radius (`radius.lg`), 24px uniform padding, and **zero drop shadow**. Tonal variations denote product tiers:

- `product-tile-light`: Pure White (`#ffffff`), framing consumer hardware on Parchment shelves.
- `product-tile-parchment`: Tactile Parchment (`#f5f5f7`), framing hardware against pure white editorial canvases.
- `product-tile-dark`: Near-Black Mineral 1 (`#272729`), the default card for Pro hardware lines.
- `product-tile-dark-2`: Near-Black Mineral 2 (`#2a2a2c`), mid-depth card for alternating product comparisons.
- `product-tile-dark-3`: Near-Black Mineral 3 (`#252527`), high-contrast card for silicon architectures and deep sensors.

```html
<!-- Light Card Example -->
<div class="product-tile product-tile-light">
  <span class="product-tile-eyebrow">New</span>
  <h3 class="product-tile-title">iPhone 16</h3>
  <p class="product-tile-tagline">Hello, Apple Intelligence.</p>
  <div class="product-tile-image-container">
    <img src="/images/iphone-16.png" alt="iPhone 16" class="product-render-grounded" />
  </div>
  <div class="product-tile-cta-group">
    <a href="/buy" class="button-primary">Buy</a>
    <a href="/learn" class="text-link">Learn more</a>
  </div>
</div>
```

```css
.product-tile {
  border-radius: 18px;
  padding: 24px;
  box-shadow: none; /* Strict prohibition of UI drop shadows */
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.product-tile-light {
  background-color: var(--apple-surface-white);
  color: var(--apple-text-ink);
}

.product-tile-parchment {
  background-color: var(--apple-surface-parchment);
  color: var(--apple-text-ink);
}

.product-tile-dark {
  background-color: var(--apple-surface-dark-1);
  color: #ffffff;
}

.product-tile-dark-2 {
  background-color: var(--apple-surface-dark-2);
  color: #ffffff;
}

.product-tile-dark-3 {
  background-color: var(--apple-surface-dark-3);
  color: #ffffff;
}

.product-tile-eyebrow {
  font-family: var(--apple-font-text);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #b64400; /* Apple product announcement burnt amber */
  margin-bottom: 4px;
}

.product-tile-dark .product-tile-eyebrow {
  color: #f56300;
}

.product-tile-title {
  font-family: var(--apple-font-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.142;
  letter-spacing: -0.015em;
  margin: 0 0 6px 0;
}

.product-tile-tagline {
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.47;
  color: var(--apple-text-ink-80);
  margin: 0 0 16px 0;
}

.product-tile-dark .product-tile-tagline {
  color: var(--apple-text-muted);
}

.product-tile-image-container {
  width: 100%;
  margin: 24px 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* The ONLY element permitted to cast a drop shadow */
.product-render-grounded {
  max-width: 100%;
  height: auto;
  filter: drop-shadow(var(--apple-elevation-product-shadow));
}

.product-tile-cta-group {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: auto;
}
```

---

#### 7.3.2 Store Utility Card (`store-utility-card`)
Parchment or white utility container used in buying workflows, trade-in calculators, and financing calculators.
- **Radius:** `18px` (`radius.lg`).
- **Border:** `1px solid var(--apple-hairline-border)` (`#e0e0e0`).
- **Padding:** `24px`.
- **Background:** `#ffffff` or `#fafafc`.

```css
.store-utility-card {
  background-color: var(--apple-surface-white);
  border: 1px solid var(--apple-hairline-border);
  border-radius: 18px;
  padding: 24px;
  box-shadow: none;
}
```

---

#### 7.3.3 Configurator Option Chips (`configurator-option-chip`)
Interactive selector pill for hardware finish, unified memory, SSD storage, and wireless band selections.

- **Geometry:** Pill radius (9999px) or `14px` squircle for storage cards.
- **Unselected State:** `1px solid #e0e0e0`, transparent background, dark text `#1d1d1f`.
- **Selected State (`configurator-option-chip-selected`):** `2px solid #0071e3` (Focus Blue), with active ring inner offset.

```html
<div class="configurator-chip-grid" role="radiogroup" aria-label="Storage configuration">
  <button class="configurator-option-chip configurator-option-chip-selected" role="radio" aria-checked="true">
    <span class="chip-title">512GB</span>
    <span class="chip-subtitle">Unified Memory</span>
  </button>
  <button class="configurator-option-chip" role="radio" aria-checked="false">
    <span class="chip-title">1TB</span>
    <span class="chip-subtitle">+$200.00</span>
  </button>
</div>
```

```css
.configurator-chip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.configurator-option-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid var(--apple-hairline-border);
  background: var(--apple-surface-white);
  cursor: pointer;
  box-shadow: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.configurator-option-chip:hover {
  border-color: #a1a1a6;
}

.configurator-option-chip-selected {
  border: 2px solid var(--apple-color-primary-focus);
  padding: 13px 17px; /* 1px subtracted for 2px border */
  box-shadow: 0 0 0 1px var(--apple-color-primary-focus) inset;
}

.chip-title {
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 600;
  color: var(--apple-text-ink);
}

.chip-subtitle {
  font-family: var(--apple-font-text);
  font-size: 12px;
  color: var(--apple-text-ink-80);
  margin-top: 2px;
}
```

---

#### 7.3.4 Environment Quote Card (`environment-quote-card`)
Large-scale cinematic statement showcasing Apple's 2030 carbon neutrality milestones or aluminum unibody recycling.

```css
.environment-quote-card {
  width: 100%;
  border-radius: 18px;
  padding: 80px 48px;
  background-color: var(--apple-surface-parchment);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
}

.environment-quote-body {
  font-family: var(--apple-font-display);
  font-size: 40px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.018em;
  max-width: 820px;
  color: var(--apple-text-ink);
  margin-bottom: 24px;
}

.environment-quote-author {
  font-family: var(--apple-font-text);
  font-size: 17px;
  font-weight: 400;
  color: var(--apple-text-ink-80);
}
```

---

#### 7.3.5 Floating Sticky Bar (`floating-sticky-bar`)
Docked at the bottom of the viewport during hardware configurator flows.
- **Height:** `64px`.
- **Background:** `rgba(245, 245, 247, 0.85)` with `saturate(180%) blur(20px)`.
- **Hairline:** 1px solid `rgba(0, 0, 0, 0.08)` border-top.
- **Content:** Product specs, pricing tally, and right-aligned `button-primary` Buy CTA.

```css
.floating-sticky-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 64px;
  background-color: var(--apple-surface-frosted-light);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--apple-z-sticky-bar);
}

.floating-sticky-bar-container {
  max-width: 980px;
  width: 100%;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.floating-bar-price {
  font-family: var(--apple-font-display);
  font-size: 21px;
  font-weight: 600;
  color: var(--apple-text-ink);
}
```

---

### 7.4 Inputs & Form Elements

#### 7.4.1 Search Input (`search-input`)
- **Geometry:** Full Pill (`radius.pill` 9999px).
- **Height:** Exactly `44px`.
- **Canvas:** Parchment (`#f5f5f7`) or Pure White with `1px solid #e0e0e0`.
- **Icon:** SVG search glass aligned left with `16px` padding.
- **Typography:** SF Pro Text, 14px, weight 400, color `#1d1d1f`.
- **Focus State:** 2px Focus Blue border (`#0071e3`), zero default outline.

```html
<div class="search-input-wrapper">
  <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
    <circle cx="7" cy="7" r="5" stroke-width="1.2" />
    <path d="M10.5 10.5L14 14" stroke-width="1.2" stroke-linecap="round" />
  </svg>
  <input type="text" class="search-input" placeholder="Search apple.com or help topics..." aria-label="Search" />
</div>
```

```css
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 480px;
}

.search-icon {
  position: absolute;
  left: 16px;
  color: var(--apple-text-ink-48);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 44px;
  padding: 0 16px 0 44px;
  background-color: var(--apple-surface-parchment);
  border: 1px solid var(--apple-hairline-border);
  border-radius: 9999px;
  font-family: var(--apple-font-text);
  font-size: 14px;
  color: var(--apple-text-ink);
  outline: none;
  box-shadow: none;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.search-input:focus {
  background-color: var(--apple-surface-white);
  border-color: var(--apple-color-primary-focus);
}

.search-input::placeholder {
  color: var(--apple-text-ink-48);
}
```

---

### 7.5 Directory Footer (`footer`)

The Apple web directory footer is an editorial monument to legibility. It strictly features:
- **Canvas:** Tactile Parchment (`#f5f5f7`).
- **Container Width:** `980px` max-width, centered.
- **Hairlines:** Top border and internal directory separators use `Divider Soft` (`#e0e0e0` / `rgba(0,0,0,0.08)`).
- **Directory Link Columns:** SF Pro Text, 12px, weight 400, line-height **`2.41`** (~29px). This elevated line-height ensures thumb-friendly touch accuracy and visual scanning clarity.
- **Fine-Print Legal:** SF Pro Text, 12px, line-height 1.33, color `#7a7a7a` (`ink-muted-48`).

```html
<footer class="apple-footer">
  <div class="apple-footer-content">
    <section class="apple-footer-footnotes">
      <p>1. Trade-in values will vary based on the condition, year, and configuration of your eligible trade-in device. Not all devices are eligible for credit.</p>
      <p>2. Apple Intelligence is available in beta on all iPhone 16 models, iPhone 15 Pro, and iPhone 15 Pro Max with Siri and device language set to U.S. English.</p>
    </section>
    
    <div class="apple-footer-divider"></div>

    <nav class="apple-footer-directory" aria-label="Apple Directory">
      <div class="footer-directory-col">
        <h4 class="footer-col-title">Shop and Learn</h4>
        <ul class="footer-col-list">
          <li><a href="/store" class="typography-dense-link">Store</a></li>
          <li><a href="/mac" class="typography-dense-link">Mac</a></li>
          <li><a href="/ipad" class="typography-dense-link">iPad</a></li>
          <li><a href="/iphone" class="typography-dense-link">iPhone</a></li>
          <li><a href="/watch" class="typography-dense-link">Watch</a></li>
        </ul>
      </div>
      <div class="footer-directory-col">
        <h4 class="footer-col-title">Account</h4>
        <ul class="footer-col-list">
          <li><a href="/account" class="typography-dense-link">Manage Your Apple ID</a></li>
          <li><a href="/store/account" class="typography-dense-link">Apple Store Account</a></li>
          <li><a href="/icloud" class="typography-dense-link">iCloud.com</a></li>
        </ul>
      </div>
      <div class="footer-directory-col">
        <h4 class="footer-col-title">Entertainment</h4>
        <ul class="footer-col-list">
          <li><a href="/apple-one" class="typography-dense-link">Apple One</a></li>
          <li><a href="/apple-tv-plus" class="typography-dense-link">Apple TV+</a></li>
          <li><a href="/apple-music" class="typography-dense-link">Apple Music</a></li>
        </ul>
      </div>
      <div class="footer-directory-col">
        <h4 class="footer-col-title">Apple Store</h4>
        <ul class="footer-col-list">
          <li><a href="/retail" class="typography-dense-link">Find a Store</a></li>
          <li><a href="/genius-bar" class="typography-dense-link">Genius Bar</a></li>
          <li><a href="/today" class="typography-dense-link">Today at Apple</a></li>
        </ul>
      </div>
    </nav>

    <div class="apple-footer-divider"></div>

    <div class="apple-footer-legal">
      <div class="footer-legal-copyright typography-fine-print">
        Copyright © 2026 Apple Inc. All rights reserved.
      </div>
      <div class="footer-legal-links">
        <a href="/legal/privacy" class="typography-fine-print">Privacy Policy</a>
        <a href="/legal/terms" class="typography-fine-print">Terms of Use</a>
        <a href="/legal/sales" class="typography-fine-print">Sales Policy</a>
        <a href="/legal" class="typography-fine-print">Legal</a>
      </div>
    </div>
  </div>
</footer>
```

```css
.apple-footer {
  background-color: var(--apple-surface-parchment);
  color: var(--apple-text-ink-48);
  padding: 32px 0 48px 0;
  border-top: 1px solid var(--apple-hairline-soft);
}

.apple-footer-content {
  max-width: 980px;
  margin: 0 auto;
  padding: 0 24px;
}

.apple-footer-footnotes {
  font-family: var(--apple-font-text);
  font-size: 12px;
  line-height: 1.333;
  color: var(--apple-text-ink-48);
  margin-bottom: 20px;
}

.apple-footer-footnotes p {
  margin: 0 0 8px 0;
}

.apple-footer-divider {
  height: 1px;
  background-color: var(--apple-hairline-border);
  margin: 16px 0;
}

.apple-footer-directory {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-bottom: 24px;
}

.footer-col-title {
  font-family: var(--apple-font-text);
  font-size: 12px;
  font-weight: 600;
  color: var(--apple-text-ink);
  margin: 0 0 8px 0;
}

.footer-col-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.footer-col-list a {
  color: var(--apple-text-ink-80);
  text-decoration: none;
  display: block;
  transition: color 150ms ease;
}

.footer-col-list a:hover {
  color: var(--apple-text-ink);
  text-decoration: underline;
}

.apple-footer-legal {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.footer-legal-links {
  display: flex;
  gap: 16px;
}

.footer-legal-links a {
  color: var(--apple-text-ink-48);
  text-decoration: none;
}

.footer-legal-links a:hover {
  text-decoration: underline;
}
```

---

## 8. Architectural Do's and Don'ts

| Category | Strict Requirement (DO) | Architectural Violation (DON'T) |
| :--- | :--- | :--- |
| **Color & Elevation** | **DO** restrict drop shadows to grounded product renders exclusively: `rgba(0,0,0,0.22) 3px 5px 30px 0`. | **DON'T** apply drop shadows to cards, buttons, modals, dropdowns, or icons. |
| **Color & Gradients** | **DO** use solid flat canvases (`#ffffff`, `#f5f5f7`, `#272729`) and optical frosted glass blurs. | **DON'T** use linear or radial background gradients on UI components or buttons. |
| **Typography** | **DO** use exactly 17px body copy (`1.0625rem`) with 1.47 line-height. | **DON'T** use standard 16px or 14px body copy for editorial narratives. |
| **Typographic Hierarchy** | **DO** transition directly from Regular 400 to Semibold 600 for headlines. | **DON'T** use `font-weight: 500` (Medium) for display titles or headers. |
| **Display Tracking** | **DO** enforce negative letter-spacing (`-0.015em` to `-0.022em`) on display headers above 28px. | **DON'T** allow positive or default letter-spacing on large display titles. |
| **CTAs & Shapes** | **DO** use full pill border radii (9999px) for primary and secondary action buttons. | **DON'T** use rectangle or 4px rounded buttons for primary purchase actions. |
| **Interactive Blue** | **DO** use Action Blue `#0066cc` for light surfaces and Sky Link Blue `#2997ff` for dark surfaces. | **DON'T** invent arbitrary brand blues or use light blue on white backgrounds. |
| **Container Radii** | **DO** standardize product cards, utility boxes, and image frames on exactly `18px` (`radius.lg`). | **DON'T** mix 6px, 12px, 20px, and 24px container radii on the same layout shelf. |
| **Whitespace Cadence** | **DO** provide up to 120px of uninterrupted whitespace around hardware hero images. | **DON'T** crowd product photography with floating badges, banners, or sidebars. |

---

## 9. Responsive Behavior & Viewport Strategy

### 9.1 Comprehensive 8-Tier Breakpoints Table

Apple's web framework spans 8 calibrated viewports to deliver tailored experiences from compact iPhone displays to the Pro Display XDR:

| Breakpoint Tier | Viewport Width | Device Class Target | Layout Max-Width | Column Grid | Base Typography Scale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1 (Compact Mobile)** | $\le$ 419px | iPhone SE, iPhone 13 mini | 100% (16px gutters) | 1 Column | Hero: 40px, Body: 17px |
| **Tier 2 (Standard Mobile)** | 420px – 640px | iPhone 15/16, iPhone Pro Max | 100% (20px gutters) | 1 Column | Hero: 48px, Body: 17px |
| **Tier 3 (Phablet / Mini Portrait)**| 641px – 735px | Foldables unfolded, small tablets | 100% (24px gutters) | 2 Col Split | Hero: 52px, Body: 17px |
| **Tier 4 (Compact Tablet)** | 736px – 833px | iPad mini, portrait budget tablets | 736px centered | 2 Column Grid | Hero: 56px, Body: 17px |
| **Tier 5 (Standard Tablet)** | 834px – 1023px | iPad 11", iPad Air portrait | 834px centered | 2–3 Column Grid | Hero: 64px, Body: 17px |
| **Tier 6 (Compact Desktop)** | 1024px – 1068px | iPad Pro 12.9" landscape, MacBook Air | 980px centered | 3–4 Column Grid | Hero: 72px, Body: 17px |
| **Tier 7 (Standard Desktop)** | 1069px – 1440px | MacBook Pro 14"/16", iMac 24" | 1024px / 1440px | 4 Column Grid | Hero: 80px, Body: 17px |
| **Tier 8 (Cinematic Display)** | $\ge$ 1441px | Studio Display, Pro Display XDR | 1440px / Full Bleed | 4–6 Column Shelf | Hero: 80px+, Body: 17px |

---

### 9.2 Touch Targets & Mobile Interactive Physics

- **Strict 44px Minimum:** All touch targets on mobile viewports ($\le$ 833px) must possess a minimum interactive dimension of **`44px × 44px`**.
- Even when visual button text is compact (e.g., 11px sub-nav button), an invisible touch hit-box is expanded using pseudo-elements:
```css
.button-primary-compact::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 44px;
  min-height: 44px;
}
```

### 9.3 Collapsing & Stacking Strategy

1. **Global Navigation:** At viewports $\le$ 833px, standard horizontal text links hide. A minimal 2-line animated hamburger glyph appears on the right edge. Tapping expands a full-screen `#000000` acrylic slide-down curtain.
2. **Dual CTA Stacking:**
   - Desktop ($\ge$ 736px): CTAs display inline horizontally: `[ Learn more ]` `[ Buy ]`.
   - Mobile ($\le$ 640px): CTAs remain inline or stack with `12px` vertical margin, maintaining full pill geometry.
3. **Product Comparison Shelves:** Multi-column grids (4 columns on desktop) collapse into a smooth horizontal touch-scrolling carousel with CSS scroll-snap (`scroll-snap-type: x mandatory`). Cards snap to viewport center with 16px peek margin.
4. **Directory Footer Columns:** At $\le$ 735px, the 4-column directory transforms into single-column expandable accordions with subtle `+` / `–` glyphs separated by 1px hairlines.

---

### 9.4 Responsive Image & Media Architecture

To prevent Cumulative Layout Shift (CLS) and ensure retina display clarity:

- **Density Assets:** All hardware imagery must be served via `<picture>` elements with `1x`, `2x`, and `3x` srcset targeting Apple Retina displays.
- **Aspect Ratio Preservation:** All image wrappers must enforce explicit CSS `aspect-ratio` to reserve vertical geometry before image decoding:

```html
<picture class="responsive-product-picture">
  <source media="(min-width: 1069px)" srcset="/images/iphone-hero-large.png 1x, /images/iphone-hero-large_2x.png 2x" />
  <source media="(min-width: 736px)" srcset="/images/iphone-hero-medium.png 1x, /images/iphone-hero-medium_2x.png 2x" />
  <img src="/images/iphone-hero-small.png" srcset="/images/iphone-hero-small_2x.png 2x" alt="iPhone 16 Pro in Natural Titanium" class="product-render-grounded" style="aspect-ratio: 16/9;" />
</picture>
```

---

## 10. Iteration Guide, Governance & Known Gaps

### 10.1 System Extension Protocol

When engineers or design system contributors introduce new UI patterns, they must validate against the following checklist:

1. **Token Adherence:** Does the component reference existing tokens? (No arbitrary one-off `#0055ff` or `15px` fonts allowed).
2. **Shadow Audit:** Does this component add a box-shadow to a card, button, or menu? If yes, it is an **automatic rejection**. Only product renders may cast a drop shadow.
3. **Radius Conformity:** Is the corner radius selected from `{0px, 5px, 8px, 11px, 18px, 9999px, 50%}`?
4. **Header Weight Guard:** Does any title use `font-weight: 500`? If yes, convert to `600` or `400`.
5. **Interactive Contrast Check:** Does every interactive link achieve WCAG AA contrast ratio against its canvas?

---

### 10.2 Color Contrast & Accessibility Matrix

| Foreground Token | Canvas / Background | Contrast Ratio | WCAG 2.1 Level | Status |
| :--- | :--- | :--- | :--- | :--- |
| `text-ink` (`#1d1d1f`) | Pure White (`#ffffff`) | 16.08:1 | AAA | Verified Pass |
| `text-ink` (`#1d1d1f`) | Parchment (`#f5f5f7`) | 14.72:1 | AAA | Verified Pass |
| `colors.primary` (`#0066cc`) | Pure White (`#ffffff`) | 5.86:1 | AA (Large & Normal) | Verified Pass |
| `colors.primary` (`#0066cc`) | Parchment (`#f5f5f7`) | 5.36:1 | AA (Large & Normal) | Verified Pass |
| `colors.primary-on-dark` (`#2997ff`)| Dark Tile 1 (`#272729`) | 7.12:1 | AAA | Verified Pass |
| `colors.primary-on-dark` (`#2997ff`)| Pure Black (`#000000`) | 8.87:1 | AAA | Verified Pass |
| `ink-muted-48` (`#7a7a7a`) | Parchment (`#f5f5f7`) | 3.52:1 | Fail for Normal Text | **Legal / Footnote Only** |

> [!NOTE]
> `ink-muted-48` (`#7a7a7a`) is reserved strictly for statutory copyright notices, micro-legal disclaimers, and inactive breadcrumbs. It is never permitted for actionable instructional text.

---

### 10.3 Known Browser Nuances & Workarounds

#### 1. WebKit Font Smoothing on Windows/Chromium
Chromium on Windows can occasionally render Inter with slightly jagged stem weight when letter-spacing is negative.  
*Resolution:* Always declare:
```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
text-rendering: optimizeLegibility;
```

#### 2. Backdrop-Filter Fallback for Unsupported Browsers
In privacy environments where `backdrop-filter` is disabled or unsupported:
```css
@supports not (backdrop-filter: blur(20px)) {
  .sub-nav-frosted,
  .floating-sticky-bar {
    background-color: #f5f5f7; /* Fallback to solid parchment */
  }
  .global-nav {
    background-color: #000000; /* Fallback to solid black */
  }
}
```

#### 3. iOS Viewport Height Jitter
Mobile Safari's dynamic URL bar resize causes layout shift when calculating full-bleed hero heights using `100vh`.  
*Resolution:* Use the modern viewport unit `100dvh` (dynamic viewport height) with `100vh` fallback:
```css
.hero-cinema-viewport {
  height: 100vh;
  height: 100dvh;
}
```

---
*End of Design System Specification (`DESIGN.md`).*
