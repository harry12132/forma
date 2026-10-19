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

test('compiles click actions that assign string state values', () => {
  const source = [
    'site "String action"',
    '  page "/"',
    '    state status = "Idle"',
    '    button "Mark ready"',
    '      on click',
    '        set status = "Ready"',
    '    text "Status: {status}"'
  ].join('\\n');
  const result = compile(source);
  assert.match(result.html, /data-forma-action="assign:status:/);
  assert.match(result.html, /Ready/);
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


test('compiles advanced reveal settings and hover interactions', () => {
  const src = 'site "Motion"\n  page "/"\n    hero\n      title "Arrive with intent"\n      animation "fade-left"\n        duration "800ms"\n        delay "120ms"\n        easing spring\n    card\n      hover "glow"\n      animation "blur"\n        duration "700ms"\n      title "Depth"';
  const result = compile(src);
  assert.match(result.html, /data-reveal="fade-left"/);
  assert.match(result.html, /data-motion-duration="800ms"/);
  assert.match(result.html, /data-motion-delay="120ms"/);
  assert.match(result.html, /data-motion-easing="spring"/);
  assert.match(result.html, /data-hover="glow"/);
  assert.match(result.html, /data-reveal="blur"/);
  assert.match(result.css, /data-hover="tilt"/);
  assert.match(result.css, /prefers-reduced-motion/);
});

test('rejects unsupported reveal animations and hover interactions', () => {
  assert.throws(() => compile('site "Motion"\n  page "/"\n    hero\n      animation "spin"'), /unsupported animation \'spin\'/);
  assert.throws(() => compile('site "Motion"\n  page "/"\n    card\n      hover "wiggle"'), /hover must be lift, glow, scale, tilt, or none/);
});

test('rejects unsafe or excessively long motion settings', () => {
  assert.throws(() => compile('site "Motion"\n  page "/"\n    hero\n      animation "fade-up"\n        duration "9999ms"'), /duration is too long/);
  assert.throws(() => compile('site "Motion"\n  page "/"\n    hero\n      animation "fade-up"\n        easing "chaotic"'), /easing must be smooth, spring, snappy, or linear/);
});


test('compiles liquid glass surfaces and visual effects', () => {
  const src = 'site "Materials"\n  page "/"\n    panel\n      surface "liquid-glass"\n      effect "reflection"\n      title "Liquid glass"\n    card\n      surface "glass"\n      effect "aurora"\n      title "Ambient glow"\n    button "Explore" -> "/next"\n      surface "liquid-glass"\n      effect "border-glow"';
  const result = compile(src);
  assert.match(result.html, /forma-surface-liquid-glass forma-effect-reflection/);
  assert.match(result.html, /forma-effect-aurora/);
  assert.match(result.html, /forma-effect-border-glow/);
  assert.match(result.css, /backdrop-filter:blur\(32px\) saturate\(1\.8\)/);
  assert.match(result.css, /@keyframes forma-aurora-drift/);
  assert.match(result.css, /prefers-reduced-motion/);
});

test('rejects unsupported surfaces and visual effects', () => {
  assert.throws(() => compile('site "Materials"\n  page "/"\n    card\n      surface "hologram"'), /surface must be solid, soft, glass, or liquid-glass/);
  assert.throws(() => compile('site "Materials"\n  page "/"\n    panel\n      effect "rainbow"'), /effect must be reflection, aurora, border-glow, or none/);
});


test('compiles accessible accordion, tabs, tooltip, dropdown, and modal primitives', () => {
  const src = [
    'site "Interactions"',
    '  page "/"',
    '    accordion',
    '      item "What is Forma?"',
    '        text "A small frontend language."',
    '      item "Does it compile?"',
    '        text "Yes, into HTML and CSS."',
    '    tabs',
    '      tab "Overview"',
    '        title "Overview panel"',
    '        text "First tab content."',
    '      tab "Details"',
    '        text "Second tab content."',
    '    tooltip "What is this?"',
    '      text "Helpful extra context."',
    '    dropdown "Resources"',
    '      option "Documentation" -> "/docs"',
    '      option "Home" -> "/"',
    '    modal "Open details"',
    '      title "A native dialog"',
    '      text "This content appears in a modal."'
  ].join('\n');
  const result = compile(src);
  assert.match(result.html, /class="forma-accordion"/);
  assert.match(result.html, /<details class="forma-accordion-item" open>/);
  assert.match(result.html, /role="tablist"/);
  assert.match(result.html, /aria-selected="true"/);
  assert.match(result.html, /data-forma-tab-panel="1"/);
  assert.match(result.html, /role="tooltip"/);
  assert.match(result.html, /class="forma-dropdown-menu"/);
  assert.match(result.html, /data-forma-open-dialog="forma-dialog-19"/);
  assert.match(result.html, /<dialog class="forma-dialog"/);
  assert.match(result.html, /data-forma-close-dialog/);
  assert.match(result.html, /ArrowRight/);
  assert.match(result.css, /\.forma-accordion-item/);
  assert.match(result.css, /\.forma-tab-button/);
  assert.match(result.css, /\.forma-dialog::backdrop/);
});

test('rejects empty or malformed interaction primitives', () => {
  assert.throws(() => compile('site "X"\n  page "/"\n    accordion'), /accordion needs at least one 'item'/);
  assert.throws(() => compile('site "X"\n  page "/"\n    tabs\n      tab "Empty"'), /each tab needs a label and content/);
  assert.throws(() => compile('site "X"\n  page "/"\n    tooltip "Hint"\n      title "Not text"'), /tooltip expects a label and one nested text block/);
  assert.throws(() => compile('site "X"\n  page "/"\n    dropdown "Menu"'), /dropdown needs at least one 'option'/);
});


test('compiles accessible form controls, state bindings, and conditional blocks', () => {
  const source = 'site "Forms"\n  page "/"\n    state email = ""\n    state subscribed = false\n    state country = "nz"\n    form "Contact form"\n      input email email "Email address"\n        required true\n      checkbox subscribed "Send me product updates"\n      select country "Country"\n        option "New Zealand" nz\n        option "Australia" au\n      textarea message "Message"\n        rows 5\n      when subscribed = true\n        text "You are subscribed."\n      submit "Send message"\n      success "Thanks, your message is ready."';
  const result = compile(source);
  assert.match(result.html, /type="email"[^>]* required/);
  assert.match(result.html, /data-forma-input="email"/);
  assert.match(result.html, /type="checkbox"[^>]*data-forma-input="subscribed"/);
  assert.match(result.html, /<option value="nz">New Zealand<\/option>/);
  assert.match(result.html, /<textarea[^>]*rows="5"/);
  assert.match(result.html, /data-forma-when="subscribed"/);
  assert.match(result.html, /data-forma-when-value="true"/);
  assert.match(result.html, /data-forma-success hidden/);
  assert.match(result.html, /type="submit"/);
  assert.match(result.html, /forma:submit/);
  assert.match(result.css, /\.forma-field input/);
});

test('rejects invalid form controls and undeclared conditional state', () => {
  assert.throws(() => compile('site "X"\n  page "/"\n    input email color "Email"'), /unsupported input type/);
  assert.throws(() => compile('site "X"\n  page "/"\n    select country "Country"'), /select needs at least one option/);
  assert.throws(() => compile('site "X"\n  page "/"\n    when missing = true\n      text "Hidden"'), /state 'missing' has not been declared/);
  assert.throws(() => compile('site "X"\n  page "/"\n    state ready = false\n    when ready\n      text "Malformed"'), /use when state = value/);
});


test('supports string equality in conditional blocks', () => {
  const source = [
    'site "String conditions"',
    '  page "/"',
    '    state status = "Ready"',
    '    when status = "Ready"',
    '      text "The string condition matched."'
  ].join('\n');
  const result = compile(source);
  assert.match(result.html, /data-forma-when="status"/);
  assert.match(result.html, /data-forma-when-value="&quot;Ready&quot;|data-forma-when-value="Ready"/);
  assert.match(result.html, /The string condition matched\./);
});
