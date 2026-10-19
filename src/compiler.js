const VOID_TAGS = new Set(['img', 'input', 'br', 'hr']);
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/;
const SAFE_LENGTH = /^(\d+(\.\d+)?(px|rem|em|%|vw|vh)?|auto|none|0)$/;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function safeUrl(value) {
  const v = String(value || '').trim();
  if (/^(javascript|data|vbscript):/i.test(v)) throw new Error(`Unsafe URL: ${v}`);
  return v;
}
function parseArgs(raw) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let m;
  while ((m = re.exec(raw))) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\(["'\\])/g, '$1'));
  return out;
}

export function parse(source) {
  const root = { name: '$root', args: [], children: [], line: 0 };
  const stack = [{ indent: -1, node: root }];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (/\t/.test(raw.match(/^\s*/)?.[0] || '')) throw new Error(`Line ${i + 1}: use spaces for indentation, not tabs.`);
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) throw new Error(\`Line \${i + 1}: indentation must use multiples of two spaces.\`);
    if (stack.length === 1 && indent !== 0) {
      throw new Error(\`Line \${i + 1}: top-level blocks must start at column 1 with no indentation.\`);
    }
    const content = raw.trim();
    const match = content.match(/^([\w-]+)(?:\s+(.*))?$/);
    if (!match) throw new Error(\`Line \${i + 1}: could not parse '\${content}'.\`);
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    if (stack.length > 1 && indent > stack.at(-1).indent + 2) {
      throw new Error(\`Line \${i + 1}: indentation jumped too far. Indent each nested block by exactly two spaces.\`);
    }
    if (stack.length > 1 && indent > stack.at(-1).indent && indent !== stack.at(-1).indent + 2) {
      throw new Error(\`Line \${i + 1}: expected indentation of \${stack.at(-1).indent + 2} spaces for a child of '\${stack.at(-1).node.name}'.\`);
    }
    const node = { name: match[1], args: parseArgs(match[2] || ''), children: [], line: i + 1 };
    stack.push({ indent, node });
  }
  return root;
}

function one(node, name, required = false) {
  const found = node.children.filter(c => c.name === name);
  if (found.length > 1) throw new Error(`Line ${found[1].line}: '${name}' can only appear once here.`);
  if (required && !found.length) throw new Error(`Missing required '${name}' block inside '${node.name}'.`);
  return found[0];
}
function arg(node, index = 0, fallback = '') { return node.args[index] ?? fallback; }
function children(node, name) { return node.children.filter(c => c.name === name); }
function assertAllowed(node, allowed) {
  for (const child of node.children) if (!allowed.has(child.name)) {
    throw new Error(`Line ${child.line}: unknown '${child.name}' inside '${node.name}'.`);
  }
}
function checkedColor(value, fallback) {
  if (!value) return fallback;
  if (!SAFE_COLOR.test(value)) throw new Error(`Invalid colour '${value}'. Use a CSS colour such as #c6f36b.`);
  return value;
}
function checkedLength(value, fallback) {
  if (!value) return fallback;
  if (!SAFE_LENGTH.test(value)) throw new Error(`Invalid size '${value}'. Try 24px, 1rem, or 100%.`);
  return value;
}
function className(...parts) { return parts.filter(Boolean).join(' '); }
function getTheme(theme) {
  const result = { background: '#09090b', foreground: '#fafafa', accent: '#c6f36b', muted: '#a1a1aa', font: 'Inter' };
  if (!theme) return result;
  assertAllowed(theme, new Set(['background', 'foreground', 'accent', 'muted', 'font']));
  for (const child of theme.children) {
    const v = arg(child);
    if (child.name === 'font') {
      if (!/^[\w ,'-]{1,80}$/.test(v)) throw new Error(`Line ${child.line}: invalid font name.`);
      result.font = v;
    } else result[child.name] = checkedColor(v, result[child.name]);
  }
  return result;
}
function interpolate(value, props = {}) {
  return String(value).replace(/\{([A-Za-z_][\w]*)\}/g, (whole, key) => {
    if (!(key in props)) throw new Error(`Missing value for component property '{${key}}'.`);
    return String(props[key]);
  });
}
function renderBoundText(value, props = {}, states = {}) {
  const parts = String(value).split(/\{([A-Za-z_][\w]*)\}/g);
  return parts.map((part, index) => {
    if (index % 2 === 0) return escapeHtml(part);
    if (Object.hasOwn(props, part)) return escapeHtml(props[part]);
    if (Object.hasOwn(states, part)) return `<span data-forma-bind=\"${escapeHtml(part)}\">${escapeHtml(states[part])}</span>`;
    throw new Error(`Missing value for '{${part}}'. Declare it with 'state ${part} = ...' or a component 'prop'.`);
  }).join('');
}
function parseState(node) {
  const match = node.args.join(' ').match(/^([A-Za-z_][\w]*)\s*=\s*(-?\d+(?:\.\d+)?|true|false|\"[^\"]*\"|'[^']*')$/);
  if (!match) throw new Error(`Line ${node.line}: use 'state name = 0' with a number, boolean, or quoted string.`);
  let value = match[2];
  if (/^-?\d/.test(value)) value = Number(value);
  else if (value === 'true') value = true;
  else if (value === 'false') value = false;
  else value = value.slice(1, -1);
  return [match[1], value];
}
function parseSetAction(node, states) {
  const match = node.args.join(' ').match(/^([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*|true|false|-?\d+(?:\.\d+)?|\"[^\"]*\"|'[^']*')\s*([+\-])?\s*(-?\d+(?:\.\d+)?)?$/);
  if (!match) throw new Error(`Line ${node.line}: unsupported action. Try 'set count = count + 1'.`);
  const [, target, source, operator, amount] = match;
  if (!Object.hasOwn(states, target)) throw new Error(`Line ${node.line}: state '${target}' has not been declared.`);
  if (operator && source !== target) throw new Error(`Line ${node.line}: arithmetic actions must use the same state, e.g. 'set ${target} = ${target} + 1'.`);
  if (operator && amount === undefined) throw new Error(`Line ${node.line}: arithmetic action needs a number after '${operator}'.`);
  if (operator) return `${operator === '+' ? 'add' : 'subtract'}:${target}:${Number(amount)}`;
  let value;
  if (Object.hasOwn(states, source)) value = states[source];
  else if (source === 'true' || source === 'false') value = source === 'true';
  else if (/^-?\d/.test(source)) value = Number(source);
  else value = source.slice(1, -1);
  return `assign:${target}:${encodeURIComponent(JSON.stringify(value))}`;
}
function parseLink(node, props = {}) {
  const match = interpolate(node.args.join(' '), props).match(/^(.+?)\s*->\s*(.+)$/);
  if (match) return { label: match[1].replace(/^['"]|['"]$/g, ''), href: safeUrl(match[2].replace(/^['"]|['"]$/g, '')) };
  if (node.args.length >= 2) return { label: node.args[0], href: safeUrl(node.args[1]) };
  throw new Error(`Line ${node.line}: '${node.name}' needs a label and a destination, e.g. link "Docs" -> "/docs".`);
}
function renderTextTag(node, tag, extra = '', props = {}, states = {}) { return `<${tag}${extra}>${renderBoundText(arg(node), props, states)}</${tag}>`; }
function renderNode(node, context = {}) {
  const { components = {}, props = {}, states = {}, componentStack = [] } = context;
  const nested = { components, props, states, componentStack };
  switch (node.name) {
    case 'title': return renderTextTag(node, 'h2', ' class="section-title"', props, states);
    case 'text': return renderTextTag(node, 'p', ' class="copy"', props, states);
    case 'badge': return `<span class="badge">${renderBoundText(arg(node), props, states)}</span>`;
    case 'link': {
      const { label, href } = parseLink(node, props);
      return `<a class="nav-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    }
    case 'button': {
      const click = one(node, 'on');
      const secondary = node.args.includes('secondary') || node.children.some(c => c.name === 'style' && arg(c) === 'secondary');
      if (click) {
        if (arg(click) !== 'click') throw new Error(`Line ${click.line}: only 'on click' is supported in this release.`);
        assertAllowed(node, new Set(['on','style']));
        if (!click.children.length) throw new Error(`Line ${click.line}: add an action inside 'on click'.`);
        const actions = click.children.map(action => {
          if (action.name !== 'set') throw new Error(`Line ${action.line}: only 'set' actions are supported inside 'on click'.`);
          return parseSetAction(action, states);
        });
        const label = renderBoundText(arg(node), props, states);
        return `<button type="button" class="button${secondary ? ' button-secondary' : ''}" data-forma-action="${escapeHtml(actions.join('|'))}">${label}</button>`;
      }
      const { label, href } = parseLink(node, props);
      return `<a class="button${secondary ? ' button-secondary' : ''}" href="${escapeHtml(href)}">${escapeHtml(label)}<span aria-hidden="true">↗</span></a>`;
    }
    case 'card': {
      assertAllowed(node, new Set(['title', 'text', 'material', 'animation']));
      const material = children(node, 'material').some(c => arg(c) === 'glass') ? ' glass' : '';
      const anim = children(node, 'animation')[0];
      return `<article class="card${material ? material : ''}"${anim ? ` data-reveal="${escapeHtml(arg(anim))}"` : ''}>${node.children.filter(c => ['title','text'].includes(c.name)).map(c => renderNode(c, nested)).join('')}</article>`;
    }
    case 'panel': {
      const glass = children(node, 'material').some(c => arg(c) === 'glass');
      const anim = children(node, 'animation')[0];
      const content = node.children.filter(c => !['material','animation'].includes(c.name)).map(c => renderNode(c, nested)).join('\n');
      return `<section class="panel${glass ? ' glass' : ''}"${anim ? ` data-reveal="${escapeHtml(arg(anim))}"` : ''}>${content}</section>`;
    }
    case 'cards': return `<div class="cards">${node.children.map(c => renderNode(c, nested)).join('\n')}</div>`;
    case 'hero': {
      assertAllowed(node, new Set(['badge', 'title', 'text', 'button', 'panel', 'animation']));
      const anim = children(node, 'animation')[0];
      const content = node.children.filter(c => c.name !== 'animation').map(c => renderNode(c, nested)).join('\n');
      return `<section class="hero"${anim ? ` data-reveal="${escapeHtml(arg(anim))}"` : ''}>${content}</section>`;
    }
    case 'nav': {
      assertAllowed(node, new Set(['logo','link','button']));
      const logo = one(node, 'logo');
      const links = node.children.filter(c => ['link','button'].includes(c.name)).map(c => renderNode(c, nested)).join('');
      return `<header class="nav"><a class="logo" href="/">${escapeHtml(arg(logo || {args:['Forma']}))}</a><nav aria-label="Main navigation">${links}</nav></header>`;
    }
    case 'footer': return `<footer class="footer">${node.children.map(c => renderNode(c, nested)).join('')}</footer>`;
    default: {
      const definition = components[node.name];
      if (!definition) throw new Error(`Line ${node.line}: '${node.name}' is not supported yet.`);
      if (componentStack.includes(node.name)) throw new Error(`Line ${node.line}: recursive component '${node.name}' is not allowed.`);
      const declared = new Map(children(definition, 'prop').map(p => [arg(p), p.args.slice(1).join(' ')]));
      const passed = new Map();
      for (const child of node.children) {
        if (!declared.has(child.name)) throw new Error(`Line ${child.line}: unknown property '${child.name}' for component '${node.name}'.`);
        if (passed.has(child.name)) throw new Error(`Line ${child.line}: property '${child.name}' was provided more than once.`);
        passed.set(child.name, arg(child));
      }
      const componentProps = {};
      for (const [key, fallback] of declared) componentProps[key] = passed.has(key) ? passed.get(key) : fallback;
      const body = definition.children.filter(c => c.name !== 'prop');
      if (!body.length) throw new Error(`Line ${definition.line}: component '${node.name}' has no content.`);
      const nextContext = { components, props: componentProps, states, componentStack: [...componentStack, node.name] };
      return body.map(child => renderNode(child, nextContext)).join('\n');
    }
  }
}

const CSS = `
:root{color-scheme:dark;--bg:__BG__;--fg:__FG__;--accent:__ACCENT__;--muted:__MUTED__;--font:__FONT__}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(ellipse at 50% -20%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 55%),var(--bg);color:var(--fg);font-family:var(--font),system-ui,-apple-system,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}.shell{max-width:1120px;margin:0 auto;padding:0 28px}.nav{height:84px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff12}.logo{font-weight:750;letter-spacing:-.06em;font-size:22px}.nav nav{display:flex;align-items:center;gap:25px}.nav-link{font-size:13px;color:var(--muted);transition:color .2s}.nav-link:hover{color:var(--fg)}.button{display:inline-flex;align-items:center;gap:16px;padding:12px 17px;border-radius:999px;background:var(--accent);color:#11130c;font-size:13px;font-weight:700;transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .22s}.button:hover{transform:translateY(-2px) scale(1.015);box-shadow:0 10px 32px color-mix(in srgb,var(--accent) 22%,transparent)}.button:active{transform:scale(.97)}.button span{font-size:16px}.button-secondary{background:#ffffff0b;color:var(--fg);border:1px solid #ffffff20}.hero{padding:116px 0 86px;max-width:850px}.badge{display:inline-flex;padding:7px 11px;border:1px solid #ffffff20;background:#ffffff08;border-radius:999px;color:var(--accent);font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase}.hero h2,.section-title{font-size:clamp(42px,7vw,82px);line-height:.99;letter-spacing:-.075em;font-weight:600;margin:24px 0}.hero .copy{font-size:clamp(16px,2vw,20px);max-width:590px;line-height:1.7;color:var(--muted);margin:0 0 28px}.hero .button{margin-right:9px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:16px 0 90px}.card,.panel{border:1px solid #ffffff15;background:linear-gradient(145deg,#ffffff09,#ffffff03);border-radius:22px;padding:26px;min-height:190px;transition:border-color .3s,transform .35s cubic-bezier(.2,.8,.2,1)}.card:hover{transform:translateY(-4px);border-color:#ffffff35}.card h2,.panel h2,.section-title{font-size:23px;letter-spacing:-.045em;margin:0 0 12px}.copy{color:var(--muted);font-size:14px;line-height:1.8;margin:0}.glass{background:linear-gradient(135deg,#ffffff26,#ffffff09 42%,#ffffff12);backdrop-filter:blur(24px) saturate(1.45);-webkit-backdrop-filter:blur(24px) saturate(1.45);border-color:#ffffff35;box-shadow:inset 0 1px 0 #ffffff45,0 18px 60px #00000018;position:relative;overflow:hidden}.glass:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,#ffffff80,transparent);pointer-events:none}.footer{border-top:1px solid #ffffff12;padding:28px 0 38px;color:var(--muted);font-size:12px}.footer .copy{font-size:12px}.reveal{opacity:0;transform:translateY(18px);transition:opacity .65s ease,transform .65s cubic-bezier(.2,.8,.2,1)}.reveal.is-visible{opacity:1;transform:translateY(0)}[data-reveal="fade"]{transform:none}[data-reveal="fade-up"]{transform:translateY(18px)}[data-reveal="scale"]{transform:scale(.97)}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}.reveal{opacity:1;transform:none}}@media(max-width:700px){.shell{padding:0 19px}.nav{height:70px}.nav nav{gap:12px}.nav nav .nav-link:nth-of-type(n+3){display:none}.nav .button{padding:10px 12px}.hero{padding:86px 0 58px}.cards{grid-template-columns:1fr;padding-bottom:55px}.card{min-height:unset}.hero h2{font-size:clamp(43px,12vw,66px)}}
`;

export function compile(source) {
  const ast = parse(source);
  if (ast.children.length !== 1 || ast.children[0].name !== 'site') throw new Error('A Forma file must contain exactly one top-level site block.');
  const site = ast.children[0];
  assertAllowed(site, new Set(['theme','page','component']));
  const components = {};
  for (const definition of children(site, 'component')) {
    const name = arg(definition);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`Line ${definition.line}: component names must use PascalCase, e.g. FeatureCard.`);
    if (components[name]) throw new Error(`Line ${definition.line}: component '${name}' is defined more than once.`);
    for (const prop of children(definition, 'prop')) {
      const propName = arg(prop);
      if (!/^[A-Za-z_][\w]*$/.test(propName)) throw new Error(`Line ${prop.line}: invalid property name '${propName}'.`);
      if (children(definition, 'prop').filter(p => arg(p) === propName).length > 1) throw new Error(`Line ${prop.line}: property '${propName}' is declared more than once in '${name}'.`);
    }
    components[name] = definition;
  }
  const theme = getTheme(one(site, 'theme'));
  const page = one(site, 'page', true);
  const builtinBlocks = new Set(['nav','hero','cards','panel','footer','state','title','text','badge','link','button','card']);
  for (const child of page.children) if (!builtinBlocks.has(child.name) && !components[child.name]) throw new Error(`Line ${child.line}: unknown '${child.name}' inside 'page'.`);
  const states = {};
  for (const declaration of children(page, 'state')) {
    const [name, value] = parseState(declaration);
    if (Object.hasOwn(states, name)) throw new Error(`Line ${declaration.line}: state '${name}' is declared more than once.`);
    states[name] = value;
  }
  const content = page.children.filter(c => c.name !== 'state').map(c => renderNode(c, { components, props: {}, states, componentStack: [] })).join('\n');
  const css = CSS.replace('__BG__', theme.background).replace('__FG__', theme.foreground).replace('__ACCENT__', theme.accent).replace('__MUTED__', theme.muted).replace('__FONT__', `'${theme.font.replace(/['\\]/g, '')}'`);
  const title = escapeHtml(arg(site, 0, 'Forma app'));
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="theme-color" content="${escapeHtml(theme.background)}">\n<title>${title}</title>\n<link rel="stylesheet" href="./style.css">\n</head>\n<body>\n<main class="shell">\n${content}\n</main>\n<script>document.documentElement.classList.add('js');const items=document.querySelectorAll('[data-reveal]');items.forEach(el=>el.classList.add('reveal'));if('IntersectionObserver'in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}}),{threshold:.12});items.forEach(el=>io.observe(el))}else{items.forEach(el=>el.classList.add('is-visible'))}const state=__FORMA_STATE__;function renderState(){document.querySelectorAll('[data-forma-bind]').forEach(el=>{const key=el.getAttribute('data-forma-bind');el.textContent=String(state[key])})}document.addEventListener('click',event=>{const button=event.target.closest('[data-forma-action]');if(!button)return;for(const action of button.dataset.formaAction.split('|')){const [kind,key,raw]=action.split(':');if(!(key in state))continue;if(kind==='add')state[key]=Number(state[key])+Number(raw);else if(kind==='subtract')state[key]=Number(state[key])-Number(raw);else if(kind==='assign'){try{state[key]=JSON.parse(decodeURIComponent(raw))}catch{}}}renderState()});renderState()</script>\n</body>\n</html>\n`.replace('__FORMA_STATE__', JSON.stringify(states).replace(/</g, '\\u003c'));
  return { html, css };
}
