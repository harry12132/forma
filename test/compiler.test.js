import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, parse } from '../src/compiler.js';
import { readFile } from 'node:fs/promises';

test('parses nested indentation into a tree', () => {
  const tree = parse('site "X"\n  page "/"\n    hero\n      title "Hi"');
  assert.equal(tree.children[0].children[0].children[0].name, 'hero');
});

test('compiles showcase with glass and motion styles', async () => {
  const source = await readFile(new URL('../examples/showcase.forma', import.meta.url), 'utf8');
  const result = compile(source);
  assert.match(result.html, /Interfaces, with feeling\./);
  assert.match(result.html, /data-reveal="fade-up"/);
  assert.match(result.css, /backdrop-filter:blur\(24px\)/);
  assert.match(result.css, /prefers-reduced-motion/);
});

test('rejects unknown syntax with a line number', () => {
  assert.throws(() => compile('site "X"\n  page "/"\n    heroo'), /Line 3: unknown 'heroo' inside 'page'/);
});

test('rejects unsafe links', () => {
  const src = 'site "X"\n  page "/"\n    nav\n      button "Bad" -> "javascript:alert(1)"';
  assert.throws(() => compile(src), /Unsafe URL/);
});


test('compiles reusable components with defaults and overridden properties', () => {
  const src = `site "X"
  component FeatureCard
    prop heading "Default heading"
    prop description "Default description"
    card
      title "{heading}"
      text "{description}"
  page "/"
    cards
      FeatureCard
        heading "Custom heading"
        description "Custom description"`;
  const result = compile(src);
  assert.match(result.html, /Custom heading/);
  assert.match(result.html, /Custom description/);
  assert.doesNotMatch(result.html, /Default heading/);
});

test('uses component property defaults when omitted', () => {
  const src = `site "X"
  component Greeting
    prop message "Hello from Forma"
    panel
      title "{message}"
  page "/"
    Greeting`;
  assert.match(compile(src).html, /Hello from Forma/);
});

test('rejects unknown component properties', () => {
  const src = `site "X"
  component Greeting
    prop message "Hello"
    text "{message}"
  page "/"
    Greeting
      mesage "Typo"`;
  assert.throws(() => compile(src), /unknown property 'mesage' for component 'Greeting'/);
});

test('rejects recursive components', () => {
  const src = `site "X"
  component Loop
    Loop
  page "/"
    Loop`;
  assert.throws(() => compile(src), /recursive component 'Loop' is not allowed/);
});


test('compiles a reactive counter with initial state, bindings, and click actions', async () => {
  const source = await readFile(new URL('../examples/counter.forma', import.meta.url), 'utf8');
  const result = compile(source);
  assert.match(result.html, /data-forma-bind="count">0<\/span>/);
  assert.match(result.html, /data-forma-action="add:count:1"/);
  assert.match(result.html, /data-forma-action="subtract:count:1"/);
  assert.match(result.html, /const state=\{\"count\":0\}/);
  assert.match(result.html, /document\.addEventListener\('click'/);
});

test('rejects actions that refer to undeclared state', () => {
  const src = `site "X"
  page "/"
    button "Add"
      on click
        set missing = missing + 1`;
  assert.throws(() => compile(src), /state 'missing' has not been declared/);
});

test('rejects duplicate state declarations', () => {
  const src = `site "X"
  page "/"
    state count = 0
    state count = 1
    text "{count}"`;
  assert.throws(() => compile(src), /state 'count' is declared more than once/);
});

test('escapes dynamic text bindings instead of injecting HTML', () => {
  const src = `site "X"
  page "/"
    state count = 0
    text "Count: {count}"`;
  const result = compile(src);
  assert.match(result.html, /data-forma-bind="count">0<\/span>/);
});


test('requires top-level blocks to begin at column one', () => {
  assert.throws(
    () => parse('  site "X"\n  page "/"'),
    /Line 1, column 1: top-level blocks must start at column 1/
  );
});

test('rejects tabs used for indentation with a useful line number', () => {
  assert.throws(
    () => parse('site "X"\n\tpage "/"'),
    /Line 2, column 1: use spaces for indentation, not tabs/
  );
});

test('rejects indentation that skips a nesting level', () => {
  assert.throws(
    () => parse('site "X"\n    page "/"'),
    /Line 2, column 5: indentation jumped too far/
  );
});

test('rejects odd indentation widths', () => {
  assert.throws(
    () => parse('site "X"\n page "/"'),
    /Line 2, column 2: indentation must use multiples of two spaces/
  );
});

test('rejects a child block indented by more than two spaces', () => {
  assert.throws(
    () => parse('site "X"\n  page "/"\n      title "Hello"'),
    /Line 3, column 7: indentation jumped too far/
  );
});

test('accepts blank lines and comments without changing the syntax tree', () => {
  const tree = parse('# top comment\nsite "X"\n\n  # page comment\n  page "/"');
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].children[0].name, 'page');
});


test('reports line and column for unterminated quoted values', () => {
  assert.throws(
    () => parse('site "X"\n  page "/"\n    title "Broken'),
    /Line 3, column 11: unterminated quoted value/
  );
});

test('reports line and column for characters after a quoted value', () => {
  assert.throws(
    () => parse('site "X"\n  page "/"\n    title "Hello"world'),
    /Line 3, column 18: expected a space after a quoted value/
  );
});

test('supports escaped quotes and backslashes in string arguments', () => {
  const tree = parse('site "X"\n  page "/"\n    title "Say \\"hello\\""');
  assert.equal(tree.children[0].children[0].children[0].args[0], 'Say "hello"');
});

test('normalises Windows and classic Mac line endings', () => {
  const tree = parse('site "X"\r  page "/"\r    title "Hi"');
  assert.equal(tree.children[0].children[0].children[0].name, 'title');
});

test('rejects non-string parser input with a clear type error', () => {
  assert.throws(() => parse(null), /Forma source must be a string/);
});

test('supports typed component properties with defaults and coercion', () => {
  const src = [
    'site "Typed props"',
    '  component Metric',
    '    prop label string "Visits"',
    '    prop count number 12',
    '    prop featured boolean false',
    '    panel',
    '      title "{label}: {count}"',
    '      text "Featured: {featured}"',
    '  page "/"',
    '    Metric',
    '      label "Monthly visits"',
    '      count 42',
    '      featured true'
  ].join('\n');
  const result = compile(src);
  assert.match(result.html, /Monthly visits: 42/);
  assert.match(result.html, /Featured: true/);
});

test('requires typed properties when no default is declared', () => {
  const src = [
    'site "Required props"',
    '  component Profile',
    '    prop name string',
    '    text "Hello {name}"',
    '  page "/"',
    '    Profile'
  ].join('\n');
  assert.throws(() => compile(src), /component 'Profile' requires property 'name' \(string\)/);
});

test('rejects a component property with the wrong declared type', () => {
  const src = [
    'site "Type checks"',
    '  component Metric',
    '    prop count number 1',
    '    text "Count: {count}"',
    '  page "/"',
    '    Metric',
    '      count "many"'
  ].join('\n');
  assert.throws(() => compile(src), /property 'count' on 'Metric' must be a number/);
});

test('rejects invalid boolean property values', () => {
  const src = [
    'site "Boolean props"',
    '  component Flag',
    '    prop enabled boolean false',
    '    text "Enabled: {enabled}"',
    '  page "/"',
    '    Flag',
    '      enabled yes'
  ].join('\n');
  assert.throws(() => compile(src), /property 'enabled' on 'Flag' must be 'true' or 'false'/);
});

test('rejects malformed numeric property defaults', () => {
  const src = [
    'site "Malformed props"',
    '  component Metric',
    '    prop count number many',
    '    text "Count: {count}"',
    '  page "/"',
    '    Metric'
  ].join('\n');
  assert.throws(() => compile(src), /property 'count' on 'Metric' must be a number/);
});

test('compiles layout primitives with spacing, alignment, and grid columns', () => {
  const src = [
    'site "Layout"',
    '  page "/"',
    '    container',
    '      max "960px"',
    '      padding "20px"',
    '      stack',
    '        gap "24px"',
    '        align center',
    '        title "Layout system"',
    '        row',
    '          gap "12px"',
    '          justify between',
    '          text "Left"',
    '          text "Right"',
    '        grid',
    '          columns 2',
    '          gap "18px"',
    '          card',
    '            title "One"',
    '          card',
    '            title "Two"',
    '        spacer "32px"',
    '        divider'
  ].join('\n');
  const result = compile(src);
  assert.match(result.html, /class="forma-container" style="max-width:960px;padding-inline:20px"/);
  assert.match(result.html, /class="forma-stack" style="gap:24px;align-items:center"/);
  assert.match(result.html, /class="forma-row" style="gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"/);
  assert.match(result.html, /class="forma-grid" style="gap:18px;--forma-columns:2"/);
  assert.match(result.html, /class="forma-spacer"[^>]*height:32px/);
  assert.match(result.html, /class="forma-divider"/);
  assert.match(result.css, /grid-template-columns:repeat\(var\(--forma-columns,3\),minmax\(0,1fr\)\)/);
  assert.match(result.css, /@media\(max-width:700px\)\{\.forma-grid\{grid-template-columns:1fr\}/);
});

test('rejects unsafe layout sizes', () => {
  const src = ['site "Bad layout"', '  page "/"', '    stack', '      gap "calc(100% + 1px)"', '      text "Nope"'].join('\n');
  assert.throws(() => compile(src), /Invalid size/);
});

test('rejects unsupported grid column counts', () => {
  const src = ['site "Bad grid"', '  page "/"', '    grid', '      columns 12', '      text "Nope"'].join('\n');
  assert.throws(() => compile(src), /'columns' must be an integer from 1 to 6/);
});

test('rejects invalid layout alignment values', () => {
  const src = ['site "Bad alignment"', '  page "/"', '    row', '      align diagonal', '      text "Nope"'].join('\n');
  assert.throws(() => compile(src), /invalid align 'diagonal'/);
});


test('compiles reusable design tokens and resolves semantic theme colours', () => {
  const src = [
    'site "Token system"',
    '  theme',
    '    token color lime "#c6f36b"',
    '    token radius card "24px"',
    '    token shadow soft "0 18px 60px #00000018"',
    '    token font display "Inter"',
    '    accent "$lime"',
    '  page "/"',
    '    title "Token-powered"'
  ].join('\n');
  const result = compile(src);
  assert.match(result.css, /--forma-color-lime:#c6f36b/);
  assert.match(result.css, /--forma-radius-card:24px/);
  assert.match(result.css, /--forma-shadow-soft:0 18px 60px #00000018/);
  assert.match(result.css, /--forma-font-display:'Inter'/);
  assert.match(result.css, /--accent:#c6f36b/);
});

test('rejects duplicate and invalid design tokens', () => {
  const duplicate = ['site "X"', '  theme', '    token color primary "#fff"', '    token radius primary "8px"', '  page "/"'].join('\n');
  assert.throws(() => compile(duplicate), /token 'primary' is declared more than once/);
  const badType = ['site "X"', '  theme', '    token gradient rainbow "red"', '  page "/"'].join('\n');
  assert.throws(() => compile(badType), /token type must be color, radius, shadow, font, or size/);
});

test('requires semantic theme references to point to colour tokens', () => {
  const src = ['site "X"', '  theme', '    token radius card "8px"', '    accent "$card"', '  page "/"'].join('\n');
  assert.throws(() => compile(src), /must reference a declared color token/);
});

test('supports component variants, surfaces, and typed design token references', () => {
  const src = ['site "Styles"','  theme','    token radius card "24px"','    token shadow soft "0 12px 30px #00000022"','    token font display "Inter"','    token size large "32px"','  page "/"','    state count = 0','    button "Continue"','      on click','        set count = count + 1','      variant "secondary"','      radius "$card"','      shadow "$soft"','      font "$display"','      text-size "$large"','    card','      surface "glass"','      title "Styled card"','      text "Example"'].join('\n');
  const result = compile(src);
  assert.match(result.html, /forma-variant-secondary/);
  assert.match(result.html, /border-radius:var\(--forma-radius-card\)/);
  assert.match(result.html, /box-shadow:var\(--forma-shadow-soft\)/);
  assert.match(result.html, /font-family:var\(--forma-font-display\)/);
  assert.match(result.html, /font-size:var\(--forma-size-large\)/);
  assert.match(result.html, /forma-surface-glass/);
});

test('rejects invalid component variants and token types', () => {
  const invalidVariant = ['site "X"','  page "/"','    button "Go"','      variant "neon"'].join('\n');
  assert.throws(() => compile(invalidVariant), /invalid variant/);
  const wrongToken = ['site "X"','  theme','    token color blue "#00f"','  page "/"','    card','      radius "$blue"'].join('\n');
  assert.throws(() => compile(wrongToken), /must be declared as a radius token/);
});
