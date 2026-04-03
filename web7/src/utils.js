const counters = new Map();

export function nextId(prefix = 'id') {
  const current = (counters.get(prefix) || 0) + 1;
  counters.set(prefix, current);
  return `${prefix}_${String(current).padStart(4, '0')}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeXml(value) {
  return escapeHtml(value);
}

export function truncate(value, length = 120) {
  const text = String(value ?? '');
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 1))}…`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

export function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value || '');
  }
}

export function basename(path) {
  const normalized = String(path || '').replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

export function stripQueryHash(value) {
  const text = String(value || '');
  const q = text.indexOf('?');
  const h = text.indexOf('#');
  let end = text.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return text.slice(0, end);
}

export function tryDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeRelativePath(value) {
  const raw = String(value || '').replaceAll('\\', '/');
  const parts = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

export function joinRelativePath(baseDir, relativePath) {
  return normalizeRelativePath([baseDir, relativePath].filter(Boolean).join('/'));
}

export function classifyReference(ref) {
  const value = String(ref || '').trim();
  if (!value) return { kind: 'empty', scheme: '' };
  if (value.startsWith('data:')) return { kind: 'data', scheme: 'data' };
  if (value.startsWith('blob:')) return { kind: 'blob', scheme: 'blob' };
  if (value.startsWith('#')) return { kind: 'fragment', scheme: 'fragment' };
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
    return { kind: 'remote', scheme: value.startsWith('//') ? 'scheme-relative' : value.split(':', 1)[0].toLowerCase() };
  }
  const match = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (match) return { kind: 'custom', scheme: match[1].toLowerCase() };
  return { kind: 'relative', scheme: 'relative' };
}

export function buildSvgPlaceholderDataUrl(label, detail = '') {
  const title = escapeXml(label || '미해결 이미지');
  const body = escapeXml(detail || '폴더 import로 다시 연결해 주세요.');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFF7ED" />
          <stop offset="100%" stop-color="#FDE7D1" />
        </linearGradient>
      </defs>
      <rect width="1200" height="720" fill="url(#g)" />
      <rect x="36" y="36" width="1128" height="648" rx="36" fill="none" stroke="#F59E0B" stroke-width="8" stroke-dasharray="18 16" />
      <text x="600" y="310" text-anchor="middle" font-family="Pretendard, Noto Sans KR, sans-serif" font-size="42" font-weight="800" fill="#9A3412">${title}</text>
      <text x="600" y="380" text-anchor="middle" font-family="Pretendard, Noto Sans KR, sans-serif" font-size="24" font-weight="600" fill="#B45309">${body}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function sanitizeFilename(value, fallback = 'file') {
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ');
  return cleaned || fallback;
}

export function downloadTextFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sanitizeFilename(filename || 'download.bin');
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

export async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

export async function readBlobAsDataUrl(blob) {
  return await readFileAsDataUrl(blob);
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'slot';
}

export function createDoctypeHtml(doc) {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

export function removeEditorCssClasses(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((name) => !name.startsWith('__phase3_') && !name.startsWith('__phase4_') && !name.startsWith('__phase5_') && !name.startsWith('__phase6_'))
    .join(' ');
}

export function parseSrcsetCandidates(value) {
  return String(value || '')
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((item) => {
      const tokens = item.split(/\s+/);
      if (tokens.length <= 1) return { url: item, descriptor: '' };
      return { url: tokens.slice(0, -1).join(' '), descriptor: tokens.at(-1) };
    });
}

export function serializeSrcsetCandidates(items) {
  return (items || [])
    .filter(Boolean)
    .map((item) => [item.url, item.descriptor].filter(Boolean).join(' '))
    .join(', ');
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas toBlob 실패'));
    }, type, quality);
  });
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let shift = 0; shift < 8; shift += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[index] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | Math.floor((date.getSeconds() & 63) / 2);
  const dosDate = (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { dosDate, dosTime };
}

function setZipUint16(view, offset, value) {
  view.setUint16(offset, value & 0xFFFF, true);
}

function setZipUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

export async function buildZipBlob(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(String(entry.name || 'file.bin'));
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(await entry.data.arrayBuffer());
    const checksum = crc32(data);
    const { dosDate, dosTime } = dosDateTime(entry.date || new Date());

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    setZipUint32(localView, 0, 0x04034b50);
    setZipUint16(localView, 4, 20);
    setZipUint16(localView, 6, 0);
    setZipUint16(localView, 8, 0);
    setZipUint16(localView, 10, dosTime);
    setZipUint16(localView, 12, dosDate);
    setZipUint32(localView, 14, checksum);
    setZipUint32(localView, 18, data.length);
    setZipUint32(localView, 22, data.length);
    setZipUint16(localView, 26, nameBytes.length);
    setZipUint16(localView, 28, 0);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    setZipUint32(centralView, 0, 0x02014b50);
    setZipUint16(centralView, 4, 20);
    setZipUint16(centralView, 6, 20);
    setZipUint16(centralView, 8, 0);
    setZipUint16(centralView, 10, 0);
    setZipUint16(centralView, 12, dosTime);
    setZipUint16(centralView, 14, dosDate);
    setZipUint32(centralView, 16, checksum);
    setZipUint32(centralView, 20, data.length);
    setZipUint32(centralView, 24, data.length);
    setZipUint16(centralView, 28, nameBytes.length);
    setZipUint16(centralView, 30, 0);
    setZipUint16(centralView, 32, 0);
    setZipUint16(centralView, 34, 0);
    setZipUint16(centralView, 36, 0);
    setZipUint32(centralView, 38, 0);
    setZipUint32(centralView, 42, offset);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  setZipUint32(endView, 0, 0x06054b50);
  setZipUint16(endView, 8, entries.length);
  setZipUint16(endView, 10, entries.length);
  setZipUint32(endView, 12, centralSize);
  setZipUint32(endView, 16, offset);
  setZipUint16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
}

export function guessExtensionFromMime(mime, fallback = '.bin') {
  const value = String(mime || '').toLowerCase();
  if (value.includes('png')) return '.png';
  if (value.includes('jpeg') || value.includes('jpg')) return '.jpg';
  if (value.includes('webp')) return '.webp';
  if (value.includes('gif')) return '.gif';
  if (value.includes('svg')) return '.svg';
  if (value.includes('avif')) return '.avif';
  if (value.includes('bmp')) return '.bmp';
  return fallback;
}
