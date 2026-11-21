// Independently downloadable blocks avoid CDN compressed Range ambiguity.
// Progress counts uncompressed model bytes committed to IndexedDB, never wire bytes.
export const MODEL_BYTES = 69246033;
export const BLOCK_BYTES = 1024 * 1024;
export const MODEL_KEY = 'zipformer-a0w-ep1-a05-int8';
export const PART_PREFIX = MODEL_KEY + ':part-v1:';
export async function downloadModel({ url, get, put, fetcher = fetch, progress = () => {}, status = () => {} }) {
  status('checking');
  const legacy = await get(MODEL_KEY);
  if (legacy instanceof ArrayBuffer && legacy.byteLength === MODEL_BYTES) {
    status('cached');
    return legacy;
  }
  const output = new Uint8Array(MODEL_BYTES), missing = [];
  let saved = 0;
  for (let index = 0, offset = 0; offset < MODEL_BYTES; index++, offset += BLOCK_BYTES) {
    const expected = Math.min(BLOCK_BYTES, MODEL_BYTES - offset);
    const part = await get(PART_PREFIX + index);
    if (part instanceof ArrayBuffer && part.byteLength === expected) {
      output.set(new Uint8Array(part), offset); saved += part.byteLength;
    } else missing.push({ index, offset, expected });
  }
  if (!missing.length) { status('cached'); return output.buffer; }
  status(saved ? 'resuming' : 'downloading');
  progress({ saved, total: MODEL_BYTES });
  for (const { index, offset, expected } of missing) {
    const response = await fetcher(`${url}.parts/${index}.bin`);
    if (!response.ok) throw Error('تعذر تنزيل النموذج. الأجزاء المحفوظة لن تُحذف؛ حاول مرة أخرى. HTTP ' + response.status);
    const part = await response.arrayBuffer();
    if (part.byteLength !== expected) throw Error('وصل جزء غير مكتمل. الأجزاء التي اكتملت محفوظة؛ اضغط استكمال التحميل.');
    // Commit before counting progress. Quota/permission failures must be visible.
    try { await put(PART_PREFIX + index, part); }
    catch { throw Error('تعذر حفظ التنزيل على الجهاز. تأكد من المساحة وافتح نفس المتصفح دون الوضع الخاص، ثم حاول مرة أخرى.'); }
    output.set(new Uint8Array(part), offset); saved += part.byteLength;
    progress({ saved, total: MODEL_BYTES });
  }
  return output.buffer;
}
