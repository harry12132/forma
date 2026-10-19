import { parse } from './parser.js';
export { parse };

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
  const result = { background: '#09090b', foreground: '#fafafa', accent: '#c6f36b', muted: '#a1a1aa', font: 'Inter', tokens: {} };
  if (!theme) return result;
  assertAllowed(theme, new Set(['background', 'foreground', 'accent', 'muted', 'font', 'token']));
  for (const child of children(theme, 'token')) {
    const [type, name, ...rawValue] = child.args;
    const value = rawValue.join(' ');
    if (!['color', 'radius', 'shadow', 'font', 'size'].includes(type)) throw new Error(`Line ${child.line}: token type must be color, radius, shadow, font, or size.`);
    if (!/^[a-z][a-z0-9-]*$/.test(name || '')) throw new Error(`Line ${child.line}: token names must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.`);
    if (!value || !child.args[2] || child.children.length) throw new Error(`Line ${child.line}: use 'token color primary "#c6f36b"' with a type, name, and value.`);
    if (Object.hasOwn(result.tokens, name)) throw new Error(`Line ${child.line}: token '${name}' is declared more than once.`);
    let checked = value;
    if (type === 'color') checked = checkedColor(value, '');
    else if (type === 'radius' || type === 'size') {
      checked = checkedLength(value, '');
      if (!checked || ['none', 'auto'].includes(checked)) throw new Error(`Line ${child.line}: ${type} tokens need a concrete CSS length.`);
      if (/^\d+(?:\.\d+)?$/.test(checked)) checked += 'px';
    } else if (type === 'font') {
      if (!/^[\w ,'-]{1,80}$/.test(value)) throw new Error(`Line ${child.line}: invalid font token.`);
      checked = `'${value.replace(/['\\]/g, '')}'`;
    } else if (!/^[#(),.%\w\s-]{1,120}$/.test(value) || /[;{}]/.test(value)) {
      throw new Error(`Line ${child.line}: invalid shadow token value.`);
    }
    result.tokens[name] = { type, value: checked, line: child.line };
  }
  for (const child of theme.children.filter(c => c.name !== 'token')) {
    const v = arg(child);
    if (child.name === 'font') {
      if (!/^[\w ,'-]{1,80}$/.test(v)) throw new Error(`Line ${child.line}: invalid font name.`);
      result.font = v;
    } else {
      const match = /^\$([a-z][a-z0-9-]*)$/.exec(v);
      if (match) {
        const token = result.tokens[match[1]];
        if (!token || token.type !== 'color') throw new Error(`Line ${child.line}: '${v}' must reference a declared color token.`);
        result[child.name] = token.value;
      } else result[child.name] = checkedColor(v, result[child.name]);
    }
  }
  result.tokenCss = Object.entries(result.tokens).map(([name, token]) => `--forma-${token.type}-${name}:${token.value}`).join(';');
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
function parseComponentProp(node, componentName) {
  const name = arg(node);
  if (!/^[A-Za-z_][\w]*$/.test(name)) throw new Error(`Line ${node.line}: invalid property name '${name}' in component '${componentName}'.`);
  // Legacy: prop heading "Default". Typed: prop count number 3, prop enabled boolean false, or prop heading string.
  const typed = ['string', 'number', 'boolean'].includes(node.args[1]);
  const type = typed ? node.args[1] : 'string';
  const hasDefault = typed ? node.args.length >= 3 : node.args.length >= 2;
  if ((!typed && node.args.length > 2) || (typed && node.args.length > 3)) throw new Error(`Line ${node.line}: malformed declaration for property '${name}'. Use 'prop name string "value"', 'prop name number 3', or 'prop name boolean false'.`);
  const defaultValue = hasDefault ? node.args[typed ? 2 : 1] : undefined;
  if (hasDefault) coerceComponentProp(defaultValue, { name, type }, node.line, componentName);
  return { name, type, hasDefault, defaultValue };
}

function coerceComponentProp(raw, schema, line, componentName) {
  const { name, type } = schema;
  if (type === 'string') return String(raw);
  if (type === 'number') {
    if (typeof raw === 'number') return raw;
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(String(raw))) throw new Error(`Line ${line}: property '${name}' on '${componentName}' must be a number, received '${raw}'.`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Line ${line}: property '${name}' must be a finite number.`);
    return value;
  }
  if (type === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw new Error(`Line ${line}: property '${name}' on '${componentName}' must be 'true' or 'false', received '${raw}'.`);
  }
  throw new Error(`Line ${line}: unsupported type '${type}' for property '${name}'.`);
}

function parseState(node) {
  if (node.args.length !== 3 || !/^[A-Za-z_][\w]*$/.test(node.args[0]) || node.args[1] !== '=') {
    throw new Error(`Line ${node.line}: use 'state name = value' with a number, boolean, or string.`);
  }
  const raw = node.args[2];
  let value = raw;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) value = Number(raw);
  else if (raw === 'true') value = true;
  else if (raw === 'false') value = false;
  return [node.args[0], value];
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

function layoutOptions(node, defaults = {}, supported = ['gap', 'align', 'justify', 'wrap', 'columns', 'max', 'padding']) {
  const settingNames = ['gap', 'align', 'justify', 'wrap', 'columns', 'max', 'padding'];
  for (const child of node.children) {
    if (!settingNames.includes(child.name)) continue;
    if (!supported.includes(child.name)) throw new Error(`Line ${child.line}: '${child.name}' is not supported inside '${node.name}'.`);
    if (child.children.length) throw new Error(`Line ${child.line}: layout settings cannot contain nested blocks.`);
  }
  const result = { ...defaults };
  for (const key of settingNames) {
    const setting = one(node, key);
    if (!setting) continue;
    if (setting.children.length || setting.args.length !== 1) throw new Error(`Line ${setting.line}: '${key}' expects exactly one value.`);
    const value = arg(setting);
    if (['gap', 'padding', 'max'].includes(key)) {
      const size = checkedLength(value, '');
      if (!size || ['none', 'auto'].includes(size)) throw new Error(`Line ${setting.line}: '${key}' needs a concrete CSS size.`);
      result[key] = /^\d+(?:\.\d+)?$/.test(size) ? `${size}px` : size;
    } else if (key === 'align' || key === 'justify') {
      const choices = key === 'align' ? ['start', 'center', 'end', 'stretch', 'baseline'] : ['start', 'center', 'end', 'between', 'around', 'evenly'];
      if (!choices.includes(value)) throw new Error(`Line ${setting.line}: invalid ${key} '${value}'. Use ${choices.join(', ')}.`);
      result[key] = value;
    } else if (key === 'wrap') {
      if (!['true', 'false'].includes(value)) throw new Error(`Line ${setting.line}: 'wrap' must be true or false.`);
      result.wrap = value === 'true';
    } else if (key === 'columns') {
      if (!/^[1-6]$/.test(value)) throw new Error(`Line ${setting.line}: 'columns' must be an integer from 1 to 6.`);
      result.columns = Number(value);
    }
  }
  return result;
}
function layoutStyle(options, keys) {
  const declarations = [];
  if (keys.includes('gap') && options.gap) declarations.push(`gap:${options.gap}`);
  if (keys.includes('align') && options.align) declarations.push(`align-items:${({ start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' })[options.align]}`);
  if (keys.includes('justify') && options.justify) declarations.push(`justify-content:${({ start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' })[options.justify]}`);
  if (keys.includes('wrap') && options.wrap !== undefined) declarations.push(`flex-wrap:${options.wrap ? 'wrap' : 'nowrap'}`);
  if (keys.includes('columns') && options.columns) declarations.push(`--forma-columns:${options.columns}`);
  if (keys.includes('max') && options.max) declarations.push(`max-width:${options.max}`);
  if (keys.includes('padding') && options.padding) declarations.push(`padding-inline:${options.padding}`);
  return declarations.length ? ` style="${escapeHtml(declarations.join(';'))}"` : '';
}
function layoutContent(node, context, settingNames) {
  return node.children.filter(child => !settingNames.has(child.name)).map(child => renderNode(child, context)).join('\n');
}

function componentStyle(node, context, allowed) {
  const theme = context.theme || { tokens: {} };
  const result = { classes: [], styles: [] };
  const supported = ['variant','surface','tone','radius','shadow','font','text-size','effect'];
  for (const child of node.children) {
    if (!supported.includes(child.name)) continue;
    if (!allowed.includes(child.name)) throw new Error(`Line ${child.line}: '${child.name}' is not supported inside '${node.name}'.`);
    if (child.children.length || child.args.length !== 1) throw new Error(`Line ${child.line}: '${child.name}' expects exactly one value.`);
    const value = arg(child);
    if (child.name === 'variant') {
      const choices = node.name === 'button' ? ['primary','secondary','quiet','danger'] : ['default','featured'];
      if (!choices.includes(value)) throw new Error(`Line ${child.line}: invalid variant '${value}'. Use ${choices.join(', ')}.`);
      if (value !== 'primary' && value !== 'default') result.classes.push('forma-variant-' + value);
    } else if (child.name === 'surface') {
      if (!['solid','soft','glass','liquid-glass'].includes(value)) throw new Error(`Line ${child.line}: surface must be solid, soft, glass, or liquid-glass.`);
      result.classes.push('forma-surface-' + value);
    } else if (child.name === 'effect') {
      if (!['reflection','aurora','border-glow','none'].includes(value)) throw new Error(`Line ${child.line}: effect must be reflection, aurora, border-glow, or none.`);
      if (value !== 'none') result.classes.push('forma-effect-' + value);
    } else if (child.name === 'tone') {
      if (!['default','accent','muted','danger'].includes(value)) throw new Error(`Line ${child.line}: invalid tone '${value}'.`);
      if (value !== 'default') result.classes.push('forma-tone-' + value);
    } else {
      const type = ({radius:'radius',shadow:'shadow',font:'font','text-size':'size'})[child.name];
      const match = /^\$([a-z][a-z0-9-]*)$/.exec(value);
      if (!match) throw new Error(`Line ${child.line}: '${child.name}' must reference a named token, e.g. "$card".`);
      const token = theme.tokens && theme.tokens[match[1]];
      if (!token || token.type !== type) throw new Error(`Line ${child.line}: token '${match[1]}' must be declared as a ${type} token.`);
      const property = ({radius:'border-radius',shadow:'box-shadow',font:'font-family','text-size':'font-size'})[child.name];
      result.styles.push(property + ':var(--forma-' + type + '-' + match[1] + ')');
    }
  }
  return { className: result.classes.join(' '), style: result.styles.length ? ' style="' + escapeHtml(result.styles.join(';')) + '"' : '' };
}
function renderTextTag(node, tag, baseClass, props = {}, states = {}, context = {}) {
  const styled = componentStyle(node, context, ['tone','font','text-size']);
  return `<${tag} class="${escapeHtml(className(baseClass, styled.className))}"${styled.style}>${renderBoundText(arg(node), props, states)}</${tag}>`;
}
function motionAttributes(node) {
  if (!node) return '';
  if (node.args.length !== 1 || node.children.some(child => !['duration','delay','easing'].includes(child.name))) {
    throw new Error(`Line ${node.line}: animation expects a name and optional duration, delay, and easing settings.`);
  }
  const name = arg(node);
  const names = ['fade-up','fade-down','fade-left','fade-right','fade','scale','zoom','blur'];
  if (!names.includes(name)) throw new Error(`Line ${node.line}: unsupported animation '${name}'. Use ${names.join(', ')}.`);
  const values = { duration: '650ms', delay: '0ms', easing: 'smooth' };
  for (const child of node.children) {
    if (child.children.length || child.args.length !== 1) throw new Error(`Line ${child.line}: '${child.name}' expects one value.`);
    const value = arg(child);
    if (child.name === 'duration' || child.name === 'delay') {
      if (!/^(?:0|\d{1,4})(?:ms|s)$/.test(value)) throw new Error(`Line ${child.line}: ${child.name} must be a whole-number time such as "650ms" or "1s".`);
      const amount = Number.parseFloat(value) * (value.endsWith('s') && !value.endsWith('ms') ? 1000 : 1);
      if (amount > (child.name === 'duration' ? 3000 : 5000)) throw new Error(`Line ${child.line}: ${child.name} is too long.`);
    } else if (!['smooth','spring','snappy','linear'].includes(value)) {
      throw new Error(`Line ${child.line}: easing must be smooth, spring, snappy, or linear.`);
    }
    values[child.name] = value;
  }
  const easing = ({smooth:'cubic-bezier(.2,.8,.2,1)',spring:'cubic-bezier(.16,1,.3,1)',snappy:'cubic-bezier(.2,.9,.25,1)',linear:'linear'})[values.easing];
  return ` data-reveal="${escapeHtml(name)}" data-motion-duration="${escapeHtml(values.duration)}" data-motion-delay="${escapeHtml(values.delay)}" data-motion-easing="${escapeHtml(values.easing)}"`;
}
function hoverAttribute(node) {
  const hover = one(node, 'hover');
  if (!hover) return '';
  if (hover.children.length || hover.args.length !== 1) throw new Error(`Line ${hover.line}: hover expects one value: lift, glow, scale, tilt, or none.`);
  const value = arg(hover);
  if (!['lift','glow','scale','tilt','none'].includes(value)) throw new Error(`Line ${hover.line}: hover must be lift, glow, scale, tilt, or none.`);
  return value === 'none' ? '' : ` data-hover="${value}"`;
}

function renderNode(node, context = {}) {
  const { components = {}, props = {}, states = {}, componentStack = [], theme } = context;
  const nested = { components, props, states, componentStack, theme };
  switch (node.name) {
    case 'title': return renderTextTag(node, 'h2', 'section-title', props, states, nested);
    case 'text': return renderTextTag(node, 'p', 'copy', props, states, nested);
    case 'badge': {
      const styled = componentStyle(node, nested, ['tone','font','text-size','radius','shadow']);
      return `<span class="${escapeHtml(className('badge', styled.className))}"${styled.style}>${renderBoundText(arg(node), props, states)}</span>`;
    }
    case 'link': {
      const { label, href } = parseLink(node, props);
      return `<a class="nav-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    }
    case 'button': {
      const click = one(node, 'on');
      const styled = componentStyle(node, nested, ['variant','radius','shadow','font','text-size','effect','surface']);
      const legacySecondary = node.args.includes('secondary') || node.children.some(c => c.name === 'style' && arg(c) === 'secondary');
      if (legacySecondary && !styled.className.split(' ').includes('forma-variant-secondary')) styled.className = className(styled.className, 'forma-variant-secondary');
      const buttonClass = escapeHtml(className('button', styled.className));
      if (click) {
        if (arg(click) !== 'click') throw new Error(`Line ${click.line}: only 'on click' is supported in this release.`);
        assertAllowed(node, new Set(['on','style','variant','radius','shadow','font','text-size','hover','effect','surface']));
        if (!click.children.length) throw new Error(`Line ${click.line}: add an action inside 'on click'.`);
        const actions = click.children.map(action => {
          if (action.name !== 'set') throw new Error(`Line ${action.line}: only 'set' actions are supported inside 'on click'.`);
          return parseSetAction(action, states);
        });
        const label = renderBoundText(arg(node), props, states);
        return `<button type="button" class="${buttonClass}"${styled.style}${hoverAttribute(node)} data-forma-action="${escapeHtml(actions.join('|'))}">${label}</button>`;
      }
      const { label, href } = parseLink(node, props);
      return `<a class="${buttonClass}"${styled.style}${hoverAttribute(node)} href="${escapeHtml(href)}">${escapeHtml(label)}<span aria-hidden="true">↗</span></a>`;
    }
    case 'card': {
      assertAllowed(node, new Set(['title','text','material','animation','surface','variant','radius','shadow','hover','effect']));
      const legacyMaterial = children(node, 'material').map(c => arg(c)).find(v => ['glass','liquid-glass'].includes(v));
      const styled = componentStyle(node, nested, ['surface','variant','radius','shadow','effect']);
      if (legacyMaterial && !styled.className.split(' ').some(v => v === 'forma-surface-glass' || v === 'forma-surface-liquid-glass')) styled.className = className(styled.className, 'forma-surface-' + legacyMaterial);
      const anim = children(node, 'animation')[0];
      return `<article class="${escapeHtml(className('card', styled.className))}"${styled.style}${hoverAttribute(node)}${motionAttributes(anim)}>${node.children.filter(c => ['title','text'].includes(c.name)).map(c => renderNode(c, nested)).join('')}</article>`;
    }
    case 'panel': {
      const legacyMaterial = children(node, 'material').map(c => arg(c)).find(v => ['glass','liquid-glass'].includes(v));
      const styled = componentStyle(node, nested, ['surface','variant','radius','shadow','effect']);
      if (legacyMaterial && !styled.className.split(' ').some(v => v === 'forma-surface-glass' || v === 'forma-surface-liquid-glass')) styled.className = className(styled.className, 'forma-surface-' + legacyMaterial);
      const anim = children(node, 'animation')[0];
      const content = node.children.filter(c => !['material','animation','surface','variant','radius','shadow','hover','effect'].includes(c.name)).map(c => renderNode(c, nested)).join('\\n');
      return `<section class="${escapeHtml(className('panel', styled.className))}"${styled.style}${hoverAttribute(node)}${motionAttributes(anim)}>${content}</section>`;
    }
    case 'stack': {
      const options = layoutOptions(node, { gap: '16px', align: 'stretch' }, ['gap', 'align']);
      return `<div class="forma-stack"${layoutStyle(options, ['gap','align'])}>${layoutContent(node, nested, new Set(['gap','align']))}</div>`;
    }
    case 'row': {
      const options = layoutOptions(node, { gap: '16px', align: 'center', wrap: true }, ['gap', 'align', 'justify', 'wrap']);
      return `<div class="forma-row"${layoutStyle(options, ['gap','align','justify','wrap'])}>${layoutContent(node, nested, new Set(['gap','align','justify','wrap']))}</div>`;
    }
    case 'grid': {
      const options = layoutOptions(node, { gap: '16px', columns: 3 }, ['gap', 'columns']);
      return `<div class="forma-grid"${layoutStyle(options, ['gap','columns'])}>${layoutContent(node, nested, new Set(['gap','columns']))}</div>`;
    }
    case 'container': {
      const options = layoutOptions(node, { max: '1120px', padding: '24px' }, ['max', 'padding']);
      return `<div class="forma-container"${layoutStyle(options, ['max','padding'])}>${layoutContent(node, nested, new Set(['max','padding']))}</div>`;
    }
    case 'spacer': {
      if (node.children.length || node.args.length !== 1) throw new Error(`Line ${node.line}: spacer expects one size, e.g. spacer "32px".`);
      const size = checkedLength(arg(node), '');
      if (!size || ['none', 'auto'].includes(size)) throw new Error(`Line ${node.line}: spacer needs a concrete CSS size.`);
      return `<div class="forma-spacer" aria-hidden="true" style="height:${escapeHtml(/^\d+(?:\.\d+)?$/.test(size) ? size + 'px' : size)}"></div>`;
    }
    case 'divider': {
      if (node.children.length) throw new Error(`Line ${node.line}: divider cannot contain children.`);
      return '<hr class="forma-divider">';
    }
    case 'form': {
      assertAllowed(node, new Set(['input','textarea','checkbox','select','submit','success','text','title','divider','when']));
      const label = arg(node, 0, 'Form');
      const content = node.children.filter(child => child.name !== 'success').map(child => renderNode(child, nested)).join('\n');
      const success = one(node, 'success');
      const successHtml = success ? `<p class="forma-form-success" data-forma-success hidden role="status" tabindex="-1">${renderBoundText(arg(success), props, states)}</p>` : '<p class="forma-form-success" data-forma-success hidden role="status" tabindex="-1">Your form was submitted.</p>';
      return `<form class="forma-form" data-forma-form aria-label="${escapeHtml(label)}">${content}${successHtml}</form>`;
    }
    case 'input': {
      if (node.args.length !== 3) throw new Error(`Line ${node.line}: use input name type "Label", e.g. input email email "Email address".`);
      assertAllowed(node, new Set(['required','placeholder']));
      const [name, type, label] = node.args;
      if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new Error(`Line ${node.line}: input names must be valid identifiers.`);
      if (!['text','email','password','number','tel','url'].includes(type)) throw new Error(`Line ${node.line}: unsupported input type '${type}'.`);
      const required = children(node, 'required').length ? arg(children(node,'required')[0]) : 'false';
      if (!['true','false'].includes(required)) throw new Error(`Line ${node.line}: required must be true or false.`);
      const placeholderNode = one(node, 'placeholder');
      const placeholder = placeholderNode ? arg(placeholderNode) : label;
      return `<label class="forma-field" for="forma-field-${escapeHtml(name)}"><span>${escapeHtml(label)}${required === 'true' ? ' <span aria-hidden="true">*</span>' : ''}</span><input id="forma-field-${escapeHtml(name)}" name="${escapeHtml(name)}" type="${type}" placeholder="${escapeHtml(placeholder)}"${required === 'true' ? ' required' : ''}${type === 'number' ? ' inputmode="decimal"' : ''} data-forma-input="${escapeHtml(name)}"></label>`;
    }
    case 'textarea': {
      if (node.args.length !== 2) throw new Error(`Line ${node.line}: use textarea name "Label".`);
      assertAllowed(node, new Set(['required','placeholder','rows']));
      const [name, label] = node.args;
      if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new Error(`Line ${node.line}: textarea names must be valid identifiers.`);
      const required = children(node, 'required').length ? arg(children(node,'required')[0]) : 'false';
      if (!['true','false'].includes(required)) throw new Error(`Line ${node.line}: required must be true or false.`);
      const placeholderNode = one(node, 'placeholder');
      const rowsNode = one(node, 'rows');
      const rows = rowsNode ? Number(arg(rowsNode)) : 4;
      if (!Number.isInteger(rows) || rows < 2 || rows > 12) throw new Error(`Line ${node.line}: textarea rows must be an integer from 2 to 12.`);
      return `<label class="forma-field" for="forma-field-${escapeHtml(name)}"><span>${escapeHtml(label)}${required === 'true' ? ' <span aria-hidden="true">*</span>' : ''}</span><textarea id="forma-field-${escapeHtml(name)}" name="${escapeHtml(name)}" rows="${rows}" placeholder="${escapeHtml(placeholderNode ? arg(placeholderNode) : label)}"${required === 'true' ? ' required' : ''} data-forma-input="${escapeHtml(name)}"></textarea></label>`;
    }
    case 'checkbox': {
      if (node.args.length !== 2) throw new Error(`Line ${node.line}: use checkbox name "Label".`);
      assertAllowed(node, new Set(['checked']));
      const [name, label] = node.args;
      if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new Error(`Line ${node.line}: checkbox names must be valid identifiers.`);
      const checked = children(node, 'checked').length ? arg(children(node,'checked')[0]) : 'false';
      if (!['true','false'].includes(checked)) throw new Error(`Line ${node.line}: checked must be true or false.`);
      return `<label class="forma-checkbox"><input type="checkbox" name="${escapeHtml(name)}" data-forma-input="${escapeHtml(name)}"${checked === 'true' ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`;
    }
    case 'select': {
      if (node.args.length !== 2) throw new Error(`Line ${node.line}: use select name "Label".`);
      assertAllowed(node, new Set(['option','required']));
      const [name, label] = node.args;
      if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new Error(`Line ${node.line}: select names must be valid identifiers.`);
      const options = children(node, 'option');
      if (!options.length) throw new Error(`Line ${node.line}: select needs at least one option.`);
      const required = children(node, 'required').length ? arg(children(node,'required')[0]) : 'false';
      if (!['true','false'].includes(required)) throw new Error(`Line ${node.line}: required must be true or false.`);
      const rendered = options.map(option => {
        if (option.args.length !== 2 || option.children.length) throw new Error(`Line ${option.line}: use option "Label" value inside select.`);
        return `<option value="${escapeHtml(option.args[1])}">${escapeHtml(option.args[0])}</option>`;
      }).join('');
      return `<label class="forma-field" for="forma-field-${escapeHtml(name)}"><span>${escapeHtml(label)}${required === 'true' ? ' <span aria-hidden="true">*</span>' : ''}</span><select id="forma-field-${escapeHtml(name)}" name="${escapeHtml(name)}" data-forma-input="${escapeHtml(name)}"${required === 'true' ? ' required' : ''}>${rendered}</select></label>`;
    }
    case 'submit': {
      if (node.args.length !== 1 || node.children.length) throw new Error(`Line ${node.line}: submit expects one button label and no children.`);
      return `<button type="submit" class="button forma-submit">${escapeHtml(arg(node))}</button>`;
    }
    case 'success': {
      if (node.args.length !== 1 || node.children.length) throw new Error(`Line ${node.line}: success expects one message.`);
      return '';
    }
    case 'when': {
      const match = node.args.join(' ').match(/^([A-Za-z_][\w]*)\s*=\s*(true|false|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/);
      if (!match) throw new Error(`Line ${node.line}: use when state = value, e.g. when subscribed = true.`);
      const [, key, raw] = match;
      if (!Object.hasOwn(states, key)) throw new Error(`Line ${node.line}: state '${key}' has not been declared.`);
      const value = raw === 'true' ? true : raw === 'false' ? false : /^-?\d/.test(raw) ? Number(raw) : raw.slice(1,-1);
      if (!node.children.length) throw new Error(`Line ${node.line}: when needs at least one nested block.`);
      return `<div data-forma-when="${escapeHtml(key)}" data-forma-when-value="${escapeHtml(JSON.stringify(value))}">${node.children.map(child => renderNode(child, nested)).join('\n')}</div>`;
    }
    case 'accordion': {
      assertAllowed(node, new Set(['item']));
      const items = children(node, 'item');
      if (!items.length) throw new Error(`Line ${node.line}: accordion needs at least one 'item'.`);
      return `<div class="forma-accordion">${items.map((item, index) => {
        if (!item.args.length || item.children.length === 0) throw new Error(`Line ${item.line}: accordion items need a title and content.`);
        const open = index === 0 ? ' open' : '';
        return `<details class="forma-accordion-item"${open}><summary>${escapeHtml(arg(item))}<span aria-hidden="true" class="forma-accordion-chevron">⌄</span></summary><div class="forma-accordion-content">${item.children.map(child => renderNode(child, nested)).join('\\n')}</div></details>`;
      }).join('')}</div>`;
    }
    case 'tabs': {
      assertAllowed(node, new Set(['tab']));
      const tabs = children(node, 'tab');
      if (!tabs.length) throw new Error(`Line ${node.line}: tabs needs at least one 'tab'.`);
      const base = `forma-tabs-${node.line}`;
      return `<div class="forma-tabs" data-forma-tabs><div class="forma-tab-list" role="tablist" aria-label="Section tabs">${tabs.map((tab, index) => {
        if (!arg(tab) || !tab.children.length) throw new Error(`Line ${tab.line}: each tab needs a label and content.`);
        return `<button type="button" class="forma-tab-button${index === 0 ? ' is-active' : ''}" role="tab" id="${base}-tab-${index}" aria-controls="${base}-panel-${index}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}" data-forma-tab="${index}">${escapeHtml(arg(tab))}</button>`;
      }).join('')}</div>${tabs.map((tab, index) => `<section class="forma-tab-panel"${index ? ' hidden' : ''} role="tabpanel" id="${base}-panel-${index}" aria-labelledby="${base}-tab-${index}" tabindex="0" data-forma-tab-panel="${index}">${tab.children.map(child => renderNode(child, nested)).join('\\n')}</section>`).join('')}</div>`;
    }
    case 'tooltip': {
      if (node.args.length !== 1 || node.children.length !== 1 || node.children[0].name !== 'text') throw new Error(`Line ${node.line}: tooltip expects a label and one nested text block.`);
      const id = `forma-tooltip-${node.line}`;
      return `<span class="forma-tooltip-wrap"><button type="button" class="forma-tooltip-trigger" aria-describedby="${id}">${escapeHtml(arg(node))}</button><span class="forma-tooltip" role="tooltip" id="${id}">${renderBoundText(arg(node.children[0]), props, states)}</span></span>`;
    }
    case 'dropdown': {
      assertAllowed(node, new Set(['option']));
      const options = children(node, 'option');
      if (!options.length) throw new Error(`Line ${node.line}: dropdown needs at least one 'option'.`);
      const label = arg(node, 0, 'Options');
      return `<details class="forma-dropdown"><summary>${escapeHtml(label)}<span aria-hidden="true">⌄</span></summary><div class="forma-dropdown-menu">${options.map(option => {
        const { label: optionLabel, href } = parseLink(option, props);
        return `<a href="${escapeHtml(href)}">${escapeHtml(optionLabel)}</a>`;
      }).join('')}</div></details>`;
    }
    case 'modal': {
      if (node.args.length !== 1) throw new Error(`Line ${node.line}: modal needs a trigger label.`);
      assertAllowed(node, new Set(['title','text','button','link','badge','divider']));
      const id = `forma-dialog-${node.line}`;
      const content = node.children.map(child => renderNode(child, nested)).join('\\n');
      return `<button type="button" class="button forma-modal-trigger" data-forma-open-dialog="${id}">${escapeHtml(arg(node))}</button><dialog class="forma-dialog" id="${id}" aria-label="${escapeHtml(arg(node))}"><div class="forma-dialog-inner"><button type="button" class="forma-dialog-close" aria-label="Close dialog" data-forma-close-dialog>×</button>${content}</div></dialog>`;
    }
    case 'cards': return `<div class="cards">${node.children.map(c => renderNode(c, nested)).join('\n')}</div>`;
    case 'hero': {
      assertAllowed(node, new Set(['badge', 'title', 'text', 'button', 'panel', 'animation']));
      const anim = children(node, 'animation')[0];
      const content = node.children.filter(c => c.name !== 'animation').map(c => renderNode(c, nested)).join('\n');
      return `<section class="hero"${motionAttributes(anim)}>${content}</section>`;
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
      const declared = new Map(children(definition, 'prop').map(prop => {
        const schema = parseComponentProp(prop, node.name);
        return [schema.name, schema];
      }));
      const passed = new Map();
      for (const child of node.children) {
        if (!declared.has(child.name)) throw new Error(`Line ${child.line}: unknown property '${child.name}' for component '${node.name}'.`);
        if (passed.has(child.name)) throw new Error(`Line ${child.line}: property '${child.name}' was provided more than once.`);
        if (child.children.length || child.args.length !== 1) throw new Error(`Line ${child.line}: property '${child.name}' expects exactly one value.`);
        passed.set(child.name, child.args[0]);
      }
      const componentProps = {};
      for (const [key, schema] of declared) {
        if (!passed.has(key) && !schema.hasDefault) throw new Error(`Line ${node.line}: component '${node.name}' requires property '${key}' (${schema.type}).`);
        const raw = passed.has(key) ? passed.get(key) : schema.defaultValue;
        componentProps[key] = coerceComponentProp(raw, schema, node.line, node.name);
      }
      const body = definition.children.filter(c => c.name !== 'prop');
      if (!body.length) throw new Error(`Line ${definition.line}: component '${node.name}' has no content.`);
      const nextContext = { components, props: componentProps, states, theme, componentStack: [...componentStack, node.name] };
      return body.map(child => renderNode(child, nextContext)).join('\n');
    }
  }
}

const CSS = `
:root{color-scheme:dark;--bg:__BG__;--fg:__FG__;--accent:__ACCENT__;--muted:__MUTED__;--font:__FONT__;__TOKENS__}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(ellipse at 50% -20%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 55%),var(--bg);color:var(--fg);font-family:var(--font),system-ui,-apple-system,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}.shell{max-width:1120px;margin:0 auto;padding:0 28px}.nav{height:84px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff12}.logo{font-weight:750;letter-spacing:-.06em;font-size:22px}.nav nav{display:flex;align-items:center;gap:25px}.nav-link{font-size:13px;color:var(--muted);transition:color .2s}.nav-link:hover{color:var(--fg)}.button{display:inline-flex;align-items:center;gap:16px;padding:12px 17px;border-radius:999px;background:var(--accent);color:#11130c;font-size:13px;font-weight:700;transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .22s}.button:hover{transform:translateY(-2px) scale(1.015);box-shadow:0 10px 32px color-mix(in srgb,var(--accent) 22%,transparent)}.button:active{transform:scale(.97)}.button span{font-size:16px}.button-secondary,.forma-variant-secondary{background:#ffffff0b;color:var(--fg);border:1px solid #ffffff20}.forma-variant-quiet{background:transparent;color:var(--fg);border:1px solid transparent}.forma-variant-danger{background:#ef4444;color:#fff}.forma-variant-featured{border-color:color-mix(in srgb,var(--accent) 65%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}.forma-surface-solid{background:var(--bg);border-color:#ffffff24}.forma-surface-soft{background:color-mix(in srgb,var(--fg) 5%,var(--bg));border-color:#ffffff12}.forma-surface-glass{background:linear-gradient(135deg,#ffffff26,#ffffff09 42%,#ffffff12);backdrop-filter:blur(24px) saturate(1.45);-webkit-backdrop-filter:blur(24px) saturate(1.45);border-color:#ffffff35;box-shadow:inset 0 1px 0 #ffffff45,0 18px 60px #00000018;position:relative;overflow:hidden}.forma-surface-liquid-glass{position:relative;isolation:isolate;overflow:hidden;background:linear-gradient(145deg,color-mix(in srgb,var(--fg) 19%,transparent),color-mix(in srgb,var(--fg) 5%,transparent) 38%,color-mix(in srgb,var(--accent) 6%,transparent) 72%,color-mix(in srgb,var(--fg) 9%,transparent));backdrop-filter:blur(32px) saturate(1.8) contrast(1.04);-webkit-backdrop-filter:blur(32px) saturate(1.8) contrast(1.04);border-color:color-mix(in srgb,var(--fg) 28%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,var(--fg) 52%,transparent),inset 0 -1px 0 #ffffff0a,0 22px 70px #00000035}.forma-surface-liquid-glass:before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(125deg,#ffffff2b,transparent 26%,transparent 68%,#ffffff0c);opacity:.8}.forma-effect-reflection,.forma-effect-aurora,.forma-effect-border-glow{position:relative;isolation:isolate;overflow:hidden}.forma-effect-reflection:after{content:"";position:absolute;inset:-80% auto -80% -45%;width:35%;pointer-events:none;transform:rotate(18deg);background:linear-gradient(90deg,transparent,#ffffff30,transparent);opacity:0;transition:transform .8s cubic-bezier(.2,.8,.2,1),opacity .35s}.forma-effect-reflection:hover:after{transform:translateX(420%) rotate(18deg);opacity:1}.forma-effect-aurora{background-image:radial-gradient(ellipse at 10% 0%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 54%),radial-gradient(ellipse at 90% 100%,color-mix(in srgb,#7c8cff 14%,transparent),transparent 58%),linear-gradient(145deg,#ffffff0c,transparent 65%)}.forma-effect-aurora:before{content:"";position:absolute;inset:-40%;z-index:0;pointer-events:none;background:conic-gradient(from 120deg at 50% 50%,transparent,color-mix(in srgb,var(--accent) 13%,transparent),transparent,color-mix(in srgb,#8b5cf6 12%,transparent),transparent);filter:blur(35px);animation:forma-aurora-drift 14s ease-in-out infinite alternate}.forma-effect-aurora>*{position:relative;z-index:1}.forma-effect-border-glow{border-color:color-mix(in srgb,var(--accent) 45%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 14%,transparent),0 16px 55px color-mix(in srgb,var(--accent) 10%,transparent);transition:box-shadow .35s,border-color .35s}.forma-effect-border-glow:hover{border-color:color-mix(in srgb,var(--accent) 75%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 28%,transparent),0 20px 65px color-mix(in srgb,var(--accent) 20%,transparent)}@keyframes forma-aurora-drift{from{transform:translate3d(-2%,1%,0) rotate(-8deg)}to{transform:translate3d(2%,-1%,0) rotate(8deg)}}.forma-tone-accent{color:var(--accent)}.forma-tone-muted{color:var(--muted)}.forma-tone-danger{color:#ef4444}.forma-tone-accent.button{background:var(--accent);color:#11130c}.forma-tone-danger.button{background:#ef4444;color:#fff}.hero{padding:116px 0 86px;max-width:850px}.badge{display:inline-flex;padding:7px 11px;border:1px solid #ffffff20;background:#ffffff08;border-radius:999px;color:var(--accent);font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase}.hero h2,.section-title{font-size:clamp(42px,7vw,82px);line-height:.99;letter-spacing:-.075em;font-weight:600;margin:24px 0}.hero .copy{font-size:clamp(16px,2vw,20px);max-width:590px;line-height:1.7;color:var(--muted);margin:0 0 28px}.hero .button{margin-right:9px}.forma-stack{display:flex;flex-direction:column;gap:16px}.forma-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.forma-grid{display:grid;grid-template-columns:repeat(var(--forma-columns,3),minmax(0,1fr));gap:16px}.forma-container{width:100%;margin-inline:auto}.forma-spacer{width:100%;pointer-events:none}.forma-divider{border:0;border-top:1px solid #ffffff20;width:100%;margin:0}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:16px 0 90px}.card,.panel{border:1px solid #ffffff15;background:linear-gradient(145deg,#ffffff09,#ffffff03);border-radius:22px;padding:26px;min-height:190px;transition:border-color .3s,transform .35s cubic-bezier(.2,.8,.2,1)}.card:hover{transform:translateY(-4px);border-color:#ffffff35}.card h2,.panel h2,.section-title{font-size:23px;letter-spacing:-.045em;margin:0 0 12px}.copy{color:var(--muted);font-size:14px;line-height:1.8;margin:0}.glass{background:linear-gradient(135deg,#ffffff26,#ffffff09 42%,#ffffff12);backdrop-filter:blur(24px) saturate(1.45);-webkit-backdrop-filter:blur(24px) saturate(1.45);border-color:#ffffff35;box-shadow:inset 0 1px 0 #ffffff45,0 18px 60px #00000018;position:relative;overflow:hidden}.glass:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,#ffffff80,transparent);pointer-events:none}.footer{border-top:1px solid #ffffff12;padding:28px 0 38px;color:var(--muted);font-size:12px}.footer .copy{font-size:12px}.reveal{opacity:0;transform:translateY(18px);transition:opacity .65s ease,transform .65s cubic-bezier(.2,.8,.2,1)}.reveal.is-visible{opacity:1;transform:translateY(0)}[data-reveal="fade"]{transform:none}[data-reveal="fade-up"]{transform:translateY(18px)}[data-reveal="scale"]{transform:scale(.97)}[data-hover="lift"]{transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,border-color .35s}[data-hover="lift"]:hover{transform:translateY(-6px)}[data-hover="glow"]{transition:box-shadow .35s,border-color .35s}[data-hover="glow"]:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent),0 18px 55px color-mix(in srgb,var(--accent) 18%,transparent);border-color:color-mix(in srgb,var(--accent) 55%,transparent)}[data-hover="scale"]{transition:transform .28s cubic-bezier(.2,.8,.2,1)}[data-hover="scale"]:hover{transform:scale(1.025)}[data-hover="tilt"]{transition:transform .35s cubic-bezier(.2,.8,.2,1);transform-style:preserve-3d}[data-hover="tilt"]:hover{transform:perspective(900px) rotateX(2deg) rotateY(-2deg) translateY(-3px)}.reveal{transition-duration:var(--forma-motion-duration,.65s);transition-delay:var(--forma-motion-delay,0ms);transition-timing-function:var(--forma-motion-ease,cubic-bezier(.2,.8,.2,1))}[data-reveal="fade-down"]{transform:translateY(-18px)}[data-reveal="fade-left"]{transform:translateX(22px)}[data-reveal="fade-right"]{transform:translateX(-22px)}[data-reveal="zoom"]{transform:scale(.88)}[data-reveal="blur"]{filter:blur(10px);transform:translateY(8px)}.reveal.is-visible[data-reveal="fade-down"]{transform:translateY(0)}.reveal.is-visible[data-reveal="fade-left"],.reveal.is-visible[data-reveal="fade-right"]{transform:translateX(0)}.reveal.is-visible[data-reveal="scale"],.reveal.is-visible[data-reveal="zoom"]{transform:scale(1)}.reveal.is-visible[data-reveal="blur"]{filter:blur(0);transform:translateY(0)}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}.reveal{opacity:1;transform:none}[data-hover]:hover{transform:none!important}}@media(max-width:700px){.forma-grid{grid-template-columns:1fr}.shell{padding:0 19px}.nav{height:70px}.nav nav{gap:12px}.nav nav .nav-link:nth-of-type(n+3){display:none}.nav .button{padding:10px 12px}.hero{padding:86px 0 58px}.cards{grid-template-columns:1fr;padding-bottom:55px}.card{min-height:unset}.hero h2{font-size:clamp(43px,12vw,66px)}}
.forma-form{display:grid;gap:18px;max-width:620px}.forma-field{display:grid;gap:8px;color:var(--fg);font-size:13px;font-weight:600}.forma-field>span{color:var(--muted)}.forma-field input,.forma-field textarea,.forma-field select{display:block;width:100%;min-width:0;border:1px solid #ffffff20;border-radius:13px;background:#ffffff08;color:var(--fg);font:inherit;font-size:14px;font-weight:400;padding:13px 14px;outline:none;transition:border-color .2s,box-shadow .2s,background .2s}.forma-field textarea{resize:vertical;min-height:100px}.forma-field select option{background:#15161a;color:var(--fg)}.forma-field input::placeholder,.forma-field textarea::placeholder{color:#777985}.forma-field input:focus,.forma-field textarea:focus,.forma-field select:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}.forma-field input:invalid:not(:placeholder-shown),.forma-field textarea:invalid:not(:placeholder-shown){border-color:#f87171}.forma-checkbox{display:flex;align-items:center;gap:11px;color:var(--muted);font-size:13px;cursor:pointer}.forma-checkbox input{appearance:none;width:19px;height:19px;flex:0 0 19px;margin:0;border:1px solid #ffffff30;border-radius:6px;background:#ffffff08;display:grid;place-content:center}.forma-checkbox input:checked{background:var(--accent);border-color:var(--accent)}.forma-checkbox input:checked:before{content:"";width:8px;height:4px;border-left:2px solid #11130c;border-bottom:2px solid #11130c;transform:rotate(-45deg) translateY(-1px)}.forma-checkbox input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.forma-submit{justify-self:start;border:0;cursor:pointer;font:inherit}.forma-form-success{margin:0;padding:12px 14px;border:1px solid color-mix(in srgb,#86efac 28%,transparent);border-radius:12px;background:color-mix(in srgb,#22c55e 9%,transparent);color:#bbf7d0;font-size:13px}.forma-form-success[hidden]{display:none}[data-forma-when][hidden]{display:none!important}.forma-form :focus-visible{outline-color:var(--accent)}
.forma-accordion{border-top:1px solid #ffffff20}.forma-accordion-item{border-bottom:1px solid #ffffff20}.forma-accordion-item summary{display:flex;align-items:center;justify-content:space-between;gap:18px;cursor:pointer;list-style:none;padding:18px 2px;font-weight:600}.forma-accordion-item summary::-webkit-details-marker{display:none}.forma-accordion-chevron,.forma-dropdown summary span{transition:transform .22s;color:var(--muted)}.forma-accordion-item[open] .forma-accordion-chevron{transform:rotate(180deg)}.forma-accordion-content{padding:0 2px 20px;animation:forma-content-in .22s ease both}.forma-tabs{width:100%}.forma-tab-list{display:flex;gap:5px;align-items:center;padding:5px;background:#ffffff08;border:1px solid #ffffff12;border-radius:14px;width:max-content;max-width:100%;overflow:auto}.forma-tab-button{border:0;background:transparent;color:var(--muted);padding:9px 15px;border-radius:10px;white-space:nowrap;cursor:pointer;font:inherit;font-size:13px;transition:background .2s,color .2s}.forma-tab-button:hover{color:var(--fg)}.forma-tab-button.is-active{background:#ffffff12;color:var(--fg);box-shadow:0 1px 2px #00000020}.forma-tab-panel{padding:22px 2px;animation:forma-content-in .2s ease both}.forma-tab-panel[hidden]{display:none}.forma-tab-button:focus-visible,.forma-accordion-item summary:focus-visible,.forma-dropdown summary:focus-visible,.forma-tooltip-trigger:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.forma-tooltip-wrap{display:inline-flex;position:relative;align-items:center}.forma-tooltip-trigger{border:0;padding:0;background:transparent;color:var(--accent);text-decoration:underline;text-decoration-style:dotted;text-underline-offset:4px;cursor:help;font:inherit}.forma-tooltip{position:absolute;z-index:20;bottom:calc(100% + 10px);left:50%;transform:translate(-50%,4px);width:max-content;max-width:min(260px,80vw);padding:9px 12px;border:1px solid #ffffff20;border-radius:10px;background:#18191d;color:var(--fg);font-size:12px;line-height:1.5;box-shadow:0 10px 35px #00000045;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s,transform .18s,visibility .18s}.forma-tooltip-wrap:hover .forma-tooltip,.forma-tooltip-wrap:focus-within .forma-tooltip{opacity:1;visibility:visible;transform:translate(-50%,0)}.forma-dropdown{position:relative;display:inline-block}.forma-dropdown summary{display:flex;align-items:center;gap:18px;cursor:pointer;list-style:none;padding:10px 14px;border:1px solid #ffffff20;border-radius:12px;background:#ffffff08;font-size:13px}.forma-dropdown summary::-webkit-details-marker{display:none}.forma-dropdown[open] summary span{transform:rotate(180deg)}.forma-dropdown-menu{position:absolute;z-index:30;top:calc(100% + 7px);left:0;min-width:190px;padding:5px;border:1px solid #ffffff18;border-radius:13px;background:#15161a;box-shadow:0 16px 45px #00000055;animation:forma-content-in .16s ease both}.forma-dropdown-menu a{display:block;padding:10px 11px;border-radius:8px;color:var(--muted);font-size:13px}.forma-dropdown-menu a:hover,.forma-dropdown-menu a:focus-visible{background:#ffffff0c;color:var(--fg)}.forma-dialog{width:min(520px,calc(100% - 32px));max-width:none;padding:0;border:1px solid #ffffff25;border-radius:24px;background:#15161a;color:var(--fg);box-shadow:0 30px 100px #00000085}.forma-dialog::backdrop{background:#030405a8;backdrop-filter:blur(8px)}.forma-dialog[open]{animation:forma-dialog-in .22s cubic-bezier(.2,.8,.2,1) both}.forma-dialog-inner{position:relative;padding:32px}.forma-dialog-close{position:absolute;top:13px;right:15px;width:34px;height:34px;border:1px solid #ffffff18;border-radius:50%;background:#ffffff08;color:var(--fg);font-size:22px;cursor:pointer}.forma-modal-trigger{margin:4px 0}.forma-dialog-inner .section-title{padding-right:24px}@keyframes forma-content-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@keyframes forma-dialog-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){.forma-accordion-content,.forma-tab-panel,.forma-dropdown-menu,.forma-dialog[open]{animation:none}.forma-tooltip{transition:none}}
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
      parseComponentProp(prop, name);
      if (children(definition, 'prop').filter(p => arg(p) === propName).length > 1) throw new Error(`Line ${prop.line}: property '${propName}' is declared more than once in '${name}'.`);
    }
    components[name] = definition;
  }
  const theme = getTheme(one(site, 'theme'));
  const page = one(site, 'page', true);
  const builtinBlocks = new Set(['nav','hero','cards','panel','footer','state','title','text','badge','link','button','card','stack','row','grid','container','spacer','divider','accordion','tabs','tooltip','dropdown','modal','form','input','textarea','checkbox','select','submit','success','when']);
  for (const child of page.children) if (!builtinBlocks.has(child.name) && !components[child.name]) throw new Error(`Line ${child.line}: unknown '${child.name}' inside 'page'.`);
  const states = {};
  for (const declaration of children(page, 'state')) {
    const [name, value] = parseState(declaration);
    if (Object.hasOwn(states, name)) throw new Error(`Line ${declaration.line}: state '${name}' is declared more than once.`);
    states[name] = value;
  }
  const content = page.children.filter(c => c.name !== 'state').map(c => renderNode(c, { components, props: {}, states, theme, componentStack: [] })).join('\n');
  const css = CSS.replace('__BG__', theme.background).replace('__FG__', theme.foreground).replace('__ACCENT__', theme.accent).replace('__MUTED__', theme.muted).replace('__FONT__', `'${theme.font.replace(/['\\]/g, '')}'`).replace('__TOKENS__', theme.tokenCss);
  const title = escapeHtml(arg(site, 0, 'Forma app'));
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="theme-color" content="${escapeHtml(theme.background)}">\n<title>${title}</title>\n<link rel="stylesheet" href="./style.css">\n</head>\n<body>\n<main class="shell">\n${content}\n</main>\n<script>document.documentElement.classList.add('js');const items=document.querySelectorAll('[data-reveal]');items.forEach(el=>{el.classList.add('reveal');el.style.setProperty('--forma-motion-duration',el.dataset.motionDuration||'650ms');el.style.setProperty('--forma-motion-delay',el.dataset.motionDelay||'0ms');const easing={smooth:'cubic-bezier(.2,.8,.2,1)',spring:'cubic-bezier(.16,1,.3,1)',snappy:'cubic-bezier(.2,.9,.25,1)',linear:'linear'};el.style.setProperty('--forma-motion-ease',easing[el.dataset.motionEasing]||easing.smooth)});if('IntersectionObserver'in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}}),{threshold:.12});items.forEach(el=>io.observe(el))}else{items.forEach(el=>el.classList.add('is-visible'))}const state=__FORMA_STATE__;function renderState(){document.querySelectorAll('[data-forma-bind]').forEach(el=>{const key=el.getAttribute('data-forma-bind');el.textContent=String(state[key])});document.querySelectorAll('[data-forma-input]').forEach(el=>{const key=el.dataset.formaInput;if(!(key in state)||document.activeElement===el)return;if(el.type==='checkbox')el.checked=Boolean(state[key]);else el.value=String(state[key])});document.querySelectorAll('[data-forma-when]').forEach(el=>{const key=el.dataset.formaWhen;let expected;try{expected=JSON.parse(el.dataset.formaWhenValue)}catch{return}el.hidden=!(key in state&&state[key]===expected)})}document.addEventListener('input',event=>{const el=event.target.closest('[data-forma-input]');if(!el)return;const key=el.dataset.formaInput;if(!(key in state))return;state[key]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?'':Number(el.value)):el.value;renderState()});document.addEventListener('change',event=>{const el=event.target.closest('[data-forma-input]');if(!el)return;const key=el.dataset.formaInput;if(!(key in state))return;state[key]=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?'':Number(el.value)):el.value;renderState()});document.addEventListener('submit',event=>{const form=event.target.closest('[data-forma-form]');if(!form)return;event.preventDefault();if(!form.reportValidity())return;const success=form.querySelector('[data-forma-success]');if(success){success.hidden=false;success.focus()}form.dispatchEvent(new CustomEvent('forma:submit',{bubbles:true,detail:{values:Object.fromEntries(new FormData(form))}}))});document.addEventListener('click',event=>{const button=event.target.closest('[data-forma-action]');if(!button)return;for(const action of button.dataset.formaAction.split('|')){const [kind,key,raw]=action.split(':');if(!(key in state))continue;if(kind==='add')state[key]=Number(state[key])+Number(raw);else if(kind==='subtract')state[key]=Number(state[key])-Number(raw);else if(kind==='assign'){try{state[key]=JSON.parse(decodeURIComponent(raw))}catch{}}}renderState()});document.addEventListener('click',event=>{const open=event.target.closest('[data-forma-open-dialog]');if(open){const dialog=document.getElementById(open.dataset.formaOpenDialog);if(dialog&&typeof dialog.showModal==='function')dialog.showModal()}const close=event.target.closest('[data-forma-close-dialog]');if(close){const dialog=close.closest('dialog');if(dialog)dialog.close()}if(event.target.matches('dialog.forma-dialog')){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)event.target.close()}});document.querySelectorAll('[data-forma-tabs]').forEach(group=>{const buttons=[...group.querySelectorAll('[data-forma-tab]')];const panels=[...group.querySelectorAll('[data-forma-tab-panel]')];function activate(index,focus=false){buttons.forEach((button,i)=>{const active=i===index;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;panels[i].hidden=!active});if(focus)buttons[index].focus()}buttons.forEach((button,index)=>{button.addEventListener('click',()=>activate(index));button.addEventListener('keydown',event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index-1+buttons.length)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();activate(next,true)})})});document.addEventListener('click',event=>{document.querySelectorAll('.forma-dropdown[open]').forEach(dropdown=>{if(!dropdown.contains(event.target))dropdown.open=false})});renderState()</script>\n</body>\n</html>\n`.replace('__FORMA_STATE__', JSON.stringify(states).replace(/</g, '\\u003c'));
  return { html, css };
}
