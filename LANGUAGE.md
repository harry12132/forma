# Forma Language Reference

Status: experimental, matching the current compiler.

Forma is an indentation-based language that compiles a `.forma` source file into `index.html` and `style.css`. The compiler and browser runtime are intentionally dependency-free.

## 1. File structure

A file contains exactly one top-level `site` block and one required `page` block. A `theme` and reusable `component` definitions are optional.

```forma
site "My Website"
  theme
    background "#09090b"
    foreground "#fafafa"
    accent "#c6f36b"
    muted "#a1a1aa"
    font "Inter"
    token color primary "#c6f36b"
    token color surface "#111318"
    token radius card "22px"
    token shadow soft "0 18px 60px #00000018"
    token font display "Inter"

  page "/"
    nav
      logo "my.site"
      link "Docs" -> "/docs"
      button "Get started" -> "#start"

    hero
      badge "A small language"
      title "Build the experience."
      text "Describe a page using readable blocks."
      button "Explore" -> "#start"
      animation "fade-up"
```

Theme tokens are declared with \`token type name value\`. Supported token types are \`color\`, \`radius\`, \`shadow\`, \`font\`, and \`size\`. Names are lowercase identifiers and must be unique within the theme. Tokens compile to CSS custom properties such as \`--forma-color-primary\` and \`--forma-radius-card\`. Semantic theme colours (\`background\`, \`foreground\`, \`accent\`, and \`muted\`) can reference a colour token using \`"$primary"\`. Values are validated by token type.

\`\`\`forma
theme
  token color primary "#c6f36b"
  token color surface "#111318"
  token radius card "22px"
  token shadow soft "0 18px 60px #00000018"
  token font display "Inter"
  accent "$primary"
\`\`\`

## 2. Indentation and comments

- Use **two spaces per nesting level**. Tabs are not allowed.
- Top-level `site` must begin at the first column.
- Child blocks must be indented exactly two spaces beyond their parent.
- Blank lines are ignored.
- A line whose first non-space character is `#` is a comment.
- Block names are written in lowercase, except user-defined component names, which use PascalCase.

## 3. Values and strings

Text values can be enclosed in single or double quotes. Bare words are supported for simple values such as `glass`, `fade-up`, and `click`. Use quotes for text containing spaces or punctuation that could be interpreted as syntax.

Links support either `link "Label" -> "/path"` or a label and destination as separate arguments. URL schemes such as `javascript:`, `data:`, and `vbscript:` are rejected. Prefer relative paths or HTTPS URLs.

Theme properties are `background`, `foreground`, `accent`, `muted`, and `font`. Colours accept common CSS colour names, hex values, and supported `rgb()`/`hsl()` forms. Size validation is used for supported size values in the compiler.

## 4. Built-in blocks

The current compiler recognises these page elements:

- `nav`: optional `logo`, plus `link` and link-style `button` children.
- `hero`: `badge`, `title`, `text`, `button`, `panel`, and `animation`.
- `cards`: groups `card` elements.
- `card`: `title`, `text`, optional `material "glass"` or `material "liquid-glass"`, and `animation`.
- `panel`: general content, with optional `material "glass"` and `animation`.
- `footer`: general content.
- `stack`: vertical flex layout with `gap` and `align`.
- `row`: horizontal flex layout with `gap`, `align`, `justify`, and `wrap`.
- `grid`: responsive grid with `columns` (1 to 6) and `gap`.
- `container`: centered content width with `max` and horizontal `padding`.
- `spacer`: fixed vertical space, for example `spacer "32px"`.
- `divider`: a horizontal separator.
- `accordion`: collapsible `item "Title"` blocks, with the first item open by default.
- `tabs`: keyboard-navigable `tab "Label"` panels with arrow-key, Home, and End support.
- `tooltip "Label"`: an accessible hover/focus hint containing one nested `text` block.
- `dropdown "Label"`: a compact disclosure menu containing `option "Label" -> "/path"` links.
- `modal "Trigger label"`: a native dialog with nested content and a close control.
- `title`, `text`, `badge`, `link`, and `button`: text and action elements.

Layout settings are nested as simple child lines, for example `gap "24px"`, `align center`, `justify between`, `wrap true`, `columns 3`, `max "1200px"`, and `padding "24px"`. Sizes accept a limited, validated set of CSS lengths. Grid layouts collapse to one column on small screens.

Supported reveal animations are `fade-up`, `fade-down`, `fade-left`, `fade-right`, `fade`, `scale`, `zoom`, and `blur`. An animation can set `duration` (100ms to 3000ms), `delay` (up to 5000ms), and `easing` (`smooth`, `spring`, `snappy`, or `linear`). For example:

```forma
hero
  title "Arrive with intent."
  animation "fade-up"
    duration "800ms"
    delay "120ms"
    easing spring
```

Cards, panels, and buttons/links can also use `hover` with `lift`, `glow`, `scale`, or `tilt`:

```forma
card
  hover "glow"
  animation "blur"
    duration "700ms"
  title "A little depth"
```

Reveal animations use the browser's Intersection Observer and respect the reduced-motion preference. Hover effects are CSS-only and remain lightweight.

## 5. Interaction primitives

```forma
accordion
  item "Can I collapse this?"
    text "Yes. The first item starts open."
  item "Is it native?"
    text "Accordions use the browser's details and summary elements."

tabs
  tab "Overview"
    text "The first panel starts selected."
  tab "Details"
    text "Use the arrow keys to move between tabs."

tooltip "What does this do?"
  text "A short hint shown on hover or keyboard focus."

dropdown "Resources"
  option "Documentation" -> "/docs"
  option "Home" -> "/"

modal "Open details"
  title "A native dialog"
  text "The browser handles dialog focus and Escape to close."
```

Tabs include ARIA roles and keyboard navigation. Accordions and dropdowns use native disclosure elements. Modals use the browser's native `dialog` element, including backdrop dismissal and Escape support. Tooltips appear on hover and keyboard focus. All primitives have visible focus styling and reduced-motion accommodations.

## 6. Component styling

Buttons, cards, panels, headings, text, and badges support styling blocks. Values are validated and token references must match their declared type.

```forma
button "Continue"
  variant "secondary"
  radius "$card"
  shadow "$soft"
  font "$display"
  text-size "$large"

card
  surface "glass"
  variant "featured"
  title "A polished surface"

text "Supporting detail"
  tone "muted"
```

Buttons support `primary`, `secondary`, `quiet`, and `danger` variants. Cards and panels support `solid`, `soft`, `glass`, and `liquid-glass` surfaces plus the `featured` variant. Add `effect "reflection"`, `effect "aurora"`, or `effect "border-glow"` to create a moving light sweep, a softly animated ambient glow, or an accent-lit border. Use `effect "none"` to explicitly disable an effect. Text tones are `default`, `accent`, `muted`, and `danger`. `radius`, `shadow`, `font`, and `text-size` must reference tokens of the matching type. Existing `material "glass"` and button `style "secondary"` syntax remains supported.

## 7. Reusable components

Define components directly inside `site`. Properties can use the legacy form `prop name "default value"`, or typed declarations such as `prop count number 3`, `prop enabled boolean false`, and required properties such as `prop heading string`. Supported types are `string`, `number`, and `boolean`. Properties are referenced in text using braces.

```forma
site "Example"
  component FeatureCard
    prop heading "A thoughtful detail"
    prop description "A reusable component."
    card
      title "{heading}"
      text "{description}"

  page "/"
    cards
      FeatureCard
        heading "Made with Forma"
```

Component names use PascalCase. Property names start with a letter or underscore and may then contain letters, numbers, or underscores. An instance may override a default by providing an indented property line. Omit the default to make a property required. Numeric values must be finite numbers, and boolean values must be `true` or `false`. Unknown, repeated, missing required, and incorrectly typed properties are errors. Legacy untyped string properties remain supported. Recursive component calls are rejected.

## 8. Reactive state

Declare state inside `page`. Use `{name}` in text to bind it. A button can contain an `on click` block with `set` actions.

```forma
site "Counter"
  page "/"
    state count = 0
    text "Count: {count}"
    button "Add one"
      on click
        set count = count + 1
```

Initial state supports numbers, booleans, and quoted strings. The current runtime supports numeric addition/subtraction and simple assignments. It is not a general-purpose expression evaluator; conditional rendering, input binding, loops, and multi-page routing are not implemented.

## 9. Compile and test

Requires Node.js 20 or newer. No third-party packages are required.

```sh
npm test
npm run build
```

The compiler is still evolving. Error messages include source line numbers for many parsing and validation failures, but not every semantic error has a precise source location yet. Do not compile untrusted `.forma` files as if the compiler were a security sandbox.
