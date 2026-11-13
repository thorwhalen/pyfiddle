/** jsdom has no layout: give Range the measuring methods CodeMirror calls, so its measure pass is a no-op instead of an error. */
if (typeof Range !== 'undefined') {
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= empty;
}
