import { COMMON_ASSET_DIRS, CUSTOM_LOCAL_SCHEMES, IMAGE_EXTENSIONS } from '../config.js';
import { basename, classifyReference, joinRelativePath, normalizeRelativePath, stripQueryHash, tryDecodeURIComponent } from '../utils.js';

export function createImportFileIndex(files = [], mode = 'folder-import') {
  const byRelativePath = new Map();
  const byBasename = new Map();
  const htmlEntries = [];

  for (const file of Array.from(files || [])) {
    const relativePath = normalizeRelativePath(file.webkitRelativePath || file.relativePath || file.name || '');
    if (!relativePath) continue;
    const entry = { file, relativePath, name: file.name };
    byRelativePath.set(relativePath.toLowerCase(), entry);
    const base = basename(relativePath).toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(entry);
    if (/\.html?$/i.test(relativePath)) htmlEntries.push(entry);
  }

  return {
    mode,
    byRelativePath,
    byBasename,
    htmlEntries,
    totalFiles: Array.from(files || []).length,
  };
}

export function choosePrimaryHtmlEntry(fileIndex) {
  if (!fileIndex?.htmlEntries?.length) return null;
  const candidates = [...fileIndex.htmlEntries].sort((a, b) => {
    const aScore = scoreHtmlEntry(a.relativePath);
    const bScore = scoreHtmlEntry(b.relativePath);
    return bScore - aScore || a.relativePath.localeCompare(b.relativePath, 'ko');
  });
  return candidates[0] || null;
}

function scoreHtmlEntry(relativePath) {
  const lower = String(relativePath || '').toLowerCase();
  let score = 0;
  if (/(^|\/)index\.html?$/.test(lower)) score += 60;
  if (/detail|builder|template|shop|sample/.test(lower)) score += 24;
  if (/test|backup|copy|old/.test(lower)) score -= 18;
  score -= lower.split('/').length;
  return score;
}

function buildCandidatePaths(ref, htmlDirPath) {
  const info = classifyReference(ref);
  if (info.kind !== 'relative' && info.kind !== 'custom') return [];

  let relative = stripQueryHash(tryDecodeURIComponent(String(ref || '').trim()));
  if (info.kind === 'custom' && CUSTOM_LOCAL_SCHEMES.has(info.scheme)) {
    relative = relative.slice(info.scheme.length + 1);
  }

  relative = relative.replace(/^\/+/, '');
  relative = normalizeRelativePath(relative);
  const name = basename(relative);
  const candidates = new Set();
  if (htmlDirPath) candidates.add(joinRelativePath(htmlDirPath, relative));
  if (relative) candidates.add(relative);
  if (name && name !== relative) candidates.add(name);
  if (name) {
    for (const dir of COMMON_ASSET_DIRS) {
      candidates.add(joinRelativePath(dir, name));
      if (htmlDirPath) candidates.add(joinRelativePath(htmlDirPath, joinRelativePath(dir, name)));
    }
  }
  return Array.from(candidates).filter(Boolean);
}

export function createAssetResolver(fileIndex, htmlEntryRelativePath = '') {
  const blobUrlCache = new Map();
  const htmlDirPath = normalizeRelativePath(htmlEntryRelativePath.split('/').slice(0, -1).join('/'));

  function getBlobUrl(file) {
    const cacheKey = `${file.name}__${file.size}__${file.lastModified}`;
    if (!blobUrlCache.has(cacheKey)) blobUrlCache.set(cacheKey, URL.createObjectURL(file));
    return blobUrlCache.get(cacheKey);
  }

  function resolve(ref) {
    const originalRef = String(ref || '').trim();
    const refInfo = classifyReference(originalRef);

    if (refInfo.kind === 'data' || refInfo.kind === 'blob' || refInfo.kind === 'remote' || refInfo.kind === 'fragment') {
      return {
        status: 'passthrough',
        previewUrl: originalRef,
        scheme: refInfo.scheme,
        matchedPath: '',
        method: refInfo.kind,
      };
    }

    const candidates = buildCandidatePaths(originalRef, htmlDirPath);
    for (const candidate of candidates) {
      const hit = fileIndex?.byRelativePath?.get(candidate.toLowerCase());
      if (hit) {
        return {
          status: 'resolved',
          previewUrl: getBlobUrl(hit.file),
          scheme: refInfo.scheme,
          matchedPath: candidate,
          method: 'relative-path',
          fileName: hit.file.name,
        };
      }
    }

    const name = basename(stripQueryHash(originalRef)).toLowerCase();
    if (name && fileIndex?.byBasename?.has(name)) {
      const [first] = fileIndex.byBasename.get(name);
      if (first?.file) {
        return {
          status: 'resolved',
          previewUrl: getBlobUrl(first.file),
          scheme: refInfo.scheme,
          matchedPath: first.relativePath,
          method: 'basename-fallback',
          fileName: first.file.name,
        };
      }
    }

    const cleaned = stripQueryHash(originalRef);
    const idx = cleaned.lastIndexOf('.');
    const extension = idx >= 0 ? cleaned.slice(idx).toLowerCase() : '';
    return {
      status: 'unresolved',
      previewUrl: '',
      scheme: refInfo.scheme,
      matchedPath: '',
      method: 'unresolved',
      likelyImage: IMAGE_EXTENSIONS.has(extension) || refInfo.scheme === 'relative' || CUSTOM_LOCAL_SCHEMES.has(refInfo.scheme),
    };
  }

  function release() {
    for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
    blobUrlCache.clear();
  }

  return {
    htmlDirPath,
    resolve,
    release,
    getBlobUrlCount: () => blobUrlCache.size,
  };
}
