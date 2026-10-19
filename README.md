# Forma v.0.4

Forma is an experimental frontend language prototype. Write `.forma` files; the compiler emits HTML and CSS that run in a browser. This release adds a first reactive runtime with state, text bindings, and click actions, alongside reusable components with declared properties and default values.

## Requirements

- Node.js 20 or newer
- No third-party packages required

## Run the showcase

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

A component's property defaults are used when an instance does not provide that property. Unknown properties, duplicate property declarations, missing interpolated values, and recursive component calls produce build errors. Component names use PascalCase.

## Language reference

The initial syntax rules and supported block conventions are documented in [LANGUAGE.md](./LANGUAGE.md). The compiler reports source line numbers for syntax and validation errors where available.

## Compiler architecture

The parser lives in `src/parser.js` and produces a source-located syntax tree. The compiler in `src/compiler.js` validates and renders that tree into HTML and CSS. Syntax errors report line and column numbers; semantic validation errors report line numbers where available. The project uses GitHub Actions to run tests and build both shipped examples on Node.js 20 and 22.

## Existing features

- `site`, `theme`, `page`
- `nav`, `hero`, `badge`, `title`, `text`, `link`, `button`
- `cards`, `card`, `panel`, `footer`
- `material "glass"`
- `animation "fade-up"`, `animation "fade"`, and `animation "scale"`
- Responsive styling, hover/press feedback, scroll reveals, and reduced-motion handling

## Scope and roadmap

Forma compiles to HTML and CSS plus a small browser runtime for scroll reveals and basic reactive state. Conditional rendering, inputs and forms, multi-page routing, richer expressions, and a stable public language specification are not implemented yet. This is an experimental learning project, not a hardened compiler for untrusted input.
