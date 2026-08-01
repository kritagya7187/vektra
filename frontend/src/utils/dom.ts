/**
 * A ~40-line element-construction helper — not a rendering framework,
 * no virtual DOM, no diffing. Panels re-render by clearing and rebuilding
 * their own small subtree on state change (utils/dom.ts's `clear` +
 * fresh `h()` calls), which is simple and fast enough at this app's real
 * data scale (one selected building's detail, one scenario's overrides,
 * a legend, a top bar) — deliberately not the technique used for the
 * building layer itself, which is Cesium's own optimized scene graph
 * (scene/buildingLayer.ts), never DOM.
 */

type Attrs = Record<string, string | boolean | ((event: Event) => void) | undefined>;
type Child = HTMLElement | string | null | undefined | false;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (typeof value === 'boolean') {
      if (value) {
        el.setAttribute(key, '');
      }
    } else {
      el.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export function mount(container: HTMLElement, ...children: Child[]): void {
  clear(container);
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    container.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}
