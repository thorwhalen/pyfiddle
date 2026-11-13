/** A tiny element builder for the DOM renderer: `h('button', { class: 'pf-btn', onclick }, 'Run')`. */
type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Set or remove an attribute in one call. */
export const attr = (el: Element, name: string, value: string | boolean | undefined) => {
  if (value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : value);
};

/**
 * The feedback principle on a button: pressed in the next frame from pointerdown (CSS `:active`
 * alone does not fire on iOS), and the action on click.
 */
export function button(label: string, onClick: () => void, { kind = 'secondary' }: { kind?: 'primary' | 'secondary' | 'quiet' } = {}) {
  const b = h('button', { type: 'button', class: `pf-btn pf-btn-${kind}` }, label);
  const release = () => b.removeAttribute('data-pressed');
  b.addEventListener('pointerdown', () => b.setAttribute('data-pressed', ''));
  for (const e of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(e, release);
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    onClick();
  });
  return b;
}
