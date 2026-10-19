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
    /Line 1: top-level blocks must start at column 1/
  );
});

test('rejects tabs used for indentation with a useful line number', () => {
  assert.throws(
    () => parse('site "X"\n\tpage "/"'),
    /Line 2: use spaces for indentation, not tabs/
  );
});

test('rejects indentation that skips a nesting level', () => {
  assert.throws(
    () => parse('site "X"\n    page "/"'),
    /Line 2: indentation jumped too far/
  );
});

test('rejects odd indentation widths', () => {
  assert.throws(
    () => parse('site "X"\n page "/"'),
    /Line 2: indentation must use multiples of two spaces/
  );
});

test('rejects a child block indented by more than two spaces', () => {
  assert.throws(
    () => parse('site "X"\n  page "/"\n      title "Hello"'),
    /Line 3: indentation jumped too far/
  );
});

test('accepts blank lines and comments without changing the syntax tree', () => {
  const tree = parse('# top comment\nsite "X"\n\n  # page comment\n  page "/"');
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].children[0].name, 'page');
});
