/**
 * Minimal DOM for parser tests.
 *
 * The extension ships with no dependencies, so the test suite does not get to
 * pull in jsdom. This implements just enough HTML parsing and CSS selector
 * matching to run src/core/parser.js against real markup fragments saved in
 * test/fixtures/ — meaning fixtures can be pasted straight from HLTV rather
 * than hand-built as JavaScript objects.
 *
 * Supported selectors: tag, .class, [attr], tag[attr], and descendant
 * combinators built from those. That is the full set parser.js uses; anything
 * more exotic should be a signal to simplify the adapter, not to grow this.
 */
'use strict';

/** Decode the character references a browser would resolve before textContent. */
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'"
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : whole;
  });
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

class StubElement {
  constructor(tag, attrs = {}) {
    this.tag = tag.toLowerCase();
    this.attrs = attrs;
    this.children = [];
    this.parent = null;
    this.classList = {
      contains: (name) => String(attrs.class || '').split(/\s+/).includes(name)
    };
  }

  appendChild(node) {
    // Text nodes are plain strings and carry no parent pointer.
    if (typeof node !== 'string') node.parent = this;
    this.children.push(node);
    return node;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  get textContent() {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('');
  }

  /** Depth-first list of every descendant element. */
  descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (typeof child === 'string') continue;
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((el) => matchesSelector(el, selector, this));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

/** Parse one compound selector like `a[href]` or `.matchTeamName`. */
function parseCompound(compound) {
  const spec = { tag: null, classes: [], attrs: [] };
  const tokens = compound.match(/^[a-zA-Z][\w-]*|\.[\w-]+|\[[^\]]+\]/g) || [];
  for (const token of tokens) {
    if (token.startsWith('.')) spec.classes.push(token.slice(1));
    else if (token.startsWith('[')) spec.attrs.push(token.slice(1, -1));
    else spec.tag = token.toLowerCase();
  }
  return spec;
}

function matchesCompound(el, spec) {
  if (spec.tag && el.tag !== spec.tag) return false;
  for (const cls of spec.classes) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const attr of spec.attrs) {
    if (el.getAttribute(attr) === null) return false;
  }
  return true;
}

function matchesSelector(el, selector, scopeRoot) {
  const compounds = selector.trim().split(/\s+/).map(parseCompound);
  const last = compounds[compounds.length - 1];
  if (!matchesCompound(el, last)) return false;

  // Walk ancestors right-to-left for the descendant combinators.
  let index = compounds.length - 2;
  let node = el.parent;
  while (index >= 0) {
    let found = false;
    while (node && node !== scopeRoot.parent) {
      if (matchesCompound(node, compounds[index])) {
        found = true;
        node = node.parent;
        break;
      }
      node = node.parent;
    }
    if (!found) return false;
    index -= 1;
  }
  return true;
}

/** Parse an HTML fragment into a root StubElement. */
function parseHTML(html) {
  const root = new StubElement('#document');
  const stack = [root];
  const tokenizer = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

  let cursor = 0;
  let token;
  while ((token = tokenizer.exec(html)) !== null) {
    const text = html.slice(cursor, token.index);
    if (text.trim()) stack[stack.length - 1].appendChild(decodeEntities(text));
    cursor = tokenizer.lastIndex;

    if (token[0].startsWith('<!--')) continue;

    if (token[1]) {
      // Closing tag: unwind to the matching open element.
      const tag = token[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const tag = token[2].toLowerCase();
    const attrs = {};
    const attrPattern = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let attr;
    while ((attr = attrPattern.exec(token[3] || '')) !== null) {
      attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }

    const el = new StubElement(tag, attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID_ELEMENTS.has(tag) && token[4] !== '/') stack.push(el);
  }

  const tail = html.slice(cursor);
  if (tail.trim()) stack[stack.length - 1].appendChild(decodeEntities(tail));
  return root;
}

module.exports = { parseHTML, StubElement };
