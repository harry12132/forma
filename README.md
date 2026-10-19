# Forma v1.0.0 (early release)

Forma is an early-release frontend language. Write `.forma` files; the compiler emits HTML and CSS that run in a browser. This release adds liquid-glass surfaces and ambient visual effects, alongside configurable scroll reveals, hover interactions, design tokens, and a small reactive runtime.

Forma is released under the [MIT License](./LICENSE). See the [changelog](./CHANGELOG.md) for release notes.\n\n## Requirements

- Node.js 20 or newer
- No third-party packages required

## Run the showcase

`examples/showcase.forma` is the live feature atlas for the currently implemented language. It demonstrates the built-in elements, layout primitives, reusable typed components, design tokens, variants, materials and effects, every reveal and hover preset, interactive controls, reactive state, conditional rendering, and forms.

```bash
npm test
npm run build
open dist/index.html
```

## Reactive state and click events

Declare state inside a `page`, bind it into text with `{name}`, and update it with a button click. The first runtime supports numeric state, `+` and `-` numeric updates, and simple value assignments.

```forma
site "Counter"
  page "/"
    state count = 0
    title "Counter"
    text "Count: {count}"
    button "Add one"
      on click
        set count = count + 1
```

Build and open the interactive counter separately: `npm run build:counter`, then open `dist-counter/index.html`. The generated runtime is plain browser JavaScript with no framework or third-party dependencies.

## Reusable components

Define components at the `site` level. Declare properties using `prop name "default value"`, then use those properties inside the component body with `{name}`.

```forma
site "My App"
  component FeatureCard
    prop heading "A thoughtful detail"
    prop description "A reusable component."
    card
      material "glass"
      animation "fade-up"
      title "{heading}"
      text "{description}"

  page "/"
    cards
      FeatureCard
        heading "Built with Forma"
        description "Define once, reuse wherever you need it."
      FeatureCard
        heading "Defaults included"
```

A component's property defaults are used when an instance does not provide that property. Properties support `string`, `number`, and `boolean` types, with required properties available by omitting the default. Invalid values, unknown properties, duplicate declarations, missing required values, missing interpolated values, and recursive component calls produce build errors. Existing untyped string properties remain compatible. Component names use PascalCase.

## Language reference

The initial syntax rules and supported block conventions are documented in [LANGUAGE.md](./LANGUAGE.md). The compiler reports source line numbers for syntax and validation errors where available.

## Compiler architecture

The parser lives in `src/parser.js` and produces a source-located syntax tree. The compiler in `src/compiler.js` validates and renders that tree into HTML and CSS. Syntax errors report line and column numbers; semantic validation errors report line numbers where available. The project uses GitHub Actions to run tests and build both shipped examples on Node.js 20 and 22.

## Existing features

- `site`, `theme`, `page`
- `nav`, `hero`, `badge`, `title`, `text`, `link`, `button`
- `cards`, `card`, `panel`, `footer`, `stack`, `row`, `grid`, `container`, `spacer`, `divider`
- Interactive primitives: accordions, keyboard-navigable tabs, tooltips, dropdown menus, and native modal dialogs
- Forms with native validation, state binding, conditional blocks, and client-side submit events
- `material "glass"`
- Scroll reveals: `fade-up`, `fade-down`, `fade-left`, `fade-right`, `fade`, `scale`, `zoom`, and `blur`, with configurable duration, delay, and easing
- CSS hover interactions: `lift`, `glow`, `scale`, and `tilt`, with reduced-motion support
- Layout primitives with validated spacing, alignment, wrapping, and responsive grids
- Named design tokens for colours, radii, shadows, font families, and sizes, exposed as CSS custom properties; semantic theme colours can reference colour tokens
- Validated component styling for button variants, card and panel surfaces, text tones, and token-driven radius, shadow, font, and type size
- Responsive styling, hover/press feedback, scroll reveals, and reduced-motion handling

## Forms and conditional rendering

Forms support native browser validation and client-side submit events, but do not send data to a backend by themselves. See [LANGUAGE.md](./LANGUAGE.md) for syntax and limitations.

## Scope and roadmap

Forma compiles to HTML and CSS plus a small browser runtime for scroll reveals and basic reactive state. Multi-page routing, general expressions, loops, server-side rendering, and a package ecosystem are not implemented. The language is early-release software; expect the specification to evolve. This is an experimental learning project, not a hardened compiler for untrusted input.
