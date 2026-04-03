import { EXPLICIT_SLOT_SELECTOR } from '../config.js';
import { buildSvgPlaceholderDataUrl, nextId, stripQueryHash, truncate } from '../utils.js';
import { createAssetResolver } from './asset-resolver.js';
import { collectSlotCandidates } from './slot-detector.js';

const CSS_URL_RE = /url\((['"]?)([^"'()]+)\1\)/gi;

function ensureHead(doc) {
  if (!doc.head) {
    const head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.body || null);
  }
  return doc.head;
}

function createIssue(level, code, message) {
  return { id: nextId('issue'), level, code, message };
}

function mapCssUrls(text, mapper) {
  return String(text || '').replace(CSS_URL_RE, (full, quote, url) => {
    const mapped = mapper(url);
    return `url(${quote || '"'}${mapped}${quote || '"'})`;
  });
}

function parseSrcsetCandidates(value) {
  return String(value || '')
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((item) => {
      const tokens = item.split(/\s+/);
      if (tokens.length <= 1) return { url: item, descriptor: '' };
      const descriptor = tokens.at(-1);
      const url = tokens.slice(0, -1).join(' ');
      return { url, descriptor };
    });
}

function serializeSrcsetCandidates(items) {
  return items
    .filter(Boolean)
    .map((item) => [item.url, item.descriptor].filter(Boolean).join(' '))
    .join(', ');
}

function registerAsset(registry, payload) {
  const record = { id: nextId('asset'), ...payload };
  registry.push(record);
  return record;
}

function buildNodeLabel(element) {
  return (
    element.getAttribute('data-slot-label') ||
    element.getAttribute('data-image-slot') ||
    element.getAttribute('alt') ||
    element.getAttribute('aria-label') ||
    element.id ||
    (typeof element.className === 'string' ? element.className : '') ||
    element.tagName.toLowerCase()
  );
}

function removeScripts(doc, issues) {
  const scripts = Array.from(doc.querySelectorAll('script'));
  for (const script of scripts) script.remove();
  if (scripts.length) {
    issues.push(createIssue('warning', 'SCRIPT_REMOVED', `미리보기 안전성을 위해 script ${scripts.length}개를 제거했습니다.`));
  }
  return scripts.length;
}

export function normalizeProject({
  html,
  sourceName = 'untitled.html',
  sourceType = 'paste',
  fileIndex = null,
  htmlEntryPath = '',
  fixtureMeta = null,
}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html || ''), 'text/html');
  const resolver = createAssetResolver(fileIndex, htmlEntryPath);
  const assets = [];
  const issues = [];
  const remoteStylesheets = [];
  const unresolvedRefs = new Set();
  let existingImageCount = 0;

  const scriptsRemoved = removeScripts(doc, issues);
  ensureHead(doc);

  Array.from(doc.querySelectorAll('*')).forEach((element) => {
    if (!element.dataset.nodeUid) element.dataset.nodeUid = nextId('node');
  });

  const imgElements = Array.from(doc.querySelectorAll('img'));
  for (const img of imgElements) {
    const ownerLabel = buildNodeLabel(img.parentElement || img);
    const originalSrc = img.getAttribute('src') || '';
    if (originalSrc) {
      existingImageCount += 1;
      const resolution = resolver.resolve(originalSrc);
      const asset = registerAsset(assets, {
        ownerUid: img.dataset.nodeUid,
        ownerTag: img.tagName.toLowerCase(),
        ownerLabel,
        attribute: 'src',
        kind: 'img-src',
        originalRef: originalSrc,
        previewRef: resolution.previewUrl || originalSrc,
        status: resolution.status,
        scheme: resolution.scheme,
        matchedPath: resolution.matchedPath || '',
        resolutionMethod: resolution.method,
      });
      img.dataset.normalizedAssetId = asset.id;
      img.dataset.originalSrc = originalSrc;
      if (resolution.status === 'unresolved') {
        unresolvedRefs.add(originalSrc);
        img.dataset.normalizedUnresolvedImage = '1';
        img.dataset.normalizedAssetLabel = truncate(originalSrc, 80);
        img.setAttribute('src', buildSvgPlaceholderDataUrl('미해결 이미지', truncate(originalSrc, 56)));
      } else {
        img.setAttribute('src', resolution.previewUrl || originalSrc);
      }
    }

    const srcsetValue = img.getAttribute('srcset') || '';
    if (srcsetValue) {
      const serialized = serializeSrcsetCandidates(parseSrcsetCandidates(srcsetValue).map((item) => {
        const resolution = resolver.resolve(item.url);
        registerAsset(assets, {
          ownerUid: img.dataset.nodeUid,
          ownerTag: img.tagName.toLowerCase(),
          ownerLabel,
          attribute: 'srcset',
          descriptor: item.descriptor,
          kind: 'img-srcset',
          originalRef: item.url,
          previewRef: resolution.previewUrl || item.url,
          status: resolution.status,
          scheme: resolution.scheme,
          matchedPath: resolution.matchedPath || '',
          resolutionMethod: resolution.method,
        });
        if (resolution.status === 'unresolved') {
          unresolvedRefs.add(item.url);
          return { url: buildSvgPlaceholderDataUrl('미해결 srcset', truncate(item.url, 56)), descriptor: item.descriptor };
        }
        return { url: resolution.previewUrl || item.url, descriptor: item.descriptor };
      }));
      img.dataset.originalSrcset = srcsetValue;
      img.setAttribute('srcset', serialized);
    }
  }

  for (const source of Array.from(doc.querySelectorAll('source[srcset]'))) {
    const srcsetValue = source.getAttribute('srcset') || '';
    const ownerLabel = buildNodeLabel(source.parentElement || source);
    const serialized = serializeSrcsetCandidates(parseSrcsetCandidates(srcsetValue).map((item) => {
      const resolution = resolver.resolve(item.url);
      registerAsset(assets, {
        ownerUid: source.dataset.nodeUid,
        ownerTag: source.tagName.toLowerCase(),
        ownerLabel,
        attribute: 'srcset',
        descriptor: item.descriptor,
        kind: 'source-srcset',
        originalRef: item.url,
        previewRef: resolution.previewUrl || item.url,
        status: resolution.status,
        scheme: resolution.scheme,
        matchedPath: resolution.matchedPath || '',
        resolutionMethod: resolution.method,
      });
      if (resolution.status === 'unresolved') unresolvedRefs.add(item.url);
      return { url: resolution.status === 'unresolved' ? buildSvgPlaceholderDataUrl('미해결 source', truncate(item.url, 56)) : (resolution.previewUrl || item.url), descriptor: item.descriptor };
    }));
    source.dataset.originalSrcset = srcsetValue;
    source.setAttribute('srcset', serialized);
  }

  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    const originalStyle = element.getAttribute('style') || '';
    if (!/background/i.test(originalStyle)) continue;
    const ownerLabel = buildNodeLabel(element);
    const rewritten = mapCssUrls(originalStyle, (url) => {
      const resolution = resolver.resolve(url);
      registerAsset(assets, {
        ownerUid: element.dataset.nodeUid,
        ownerTag: element.tagName.toLowerCase(),
        ownerLabel,
        attribute: 'style',
        kind: 'inline-style-url',
        originalRef: url,
        previewRef: resolution.previewUrl || url,
        status: resolution.status,
        scheme: resolution.scheme,
        matchedPath: resolution.matchedPath || '',
        resolutionMethod: resolution.method,
      });
      if (resolution.status === 'unresolved') {
        unresolvedRefs.add(url);
        element.dataset.normalizedUnresolvedImage = '1';
        element.dataset.normalizedAssetLabel = truncate(url, 80);
        return buildSvgPlaceholderDataUrl('미해결 배경 이미지', truncate(url, 56));
      }
      return resolution.previewUrl || url;
    });
    element.dataset.originalStyle = originalStyle;
    element.setAttribute('style', rewritten);
  }

  for (const styleBlock of Array.from(doc.querySelectorAll('style'))) {
    const originalCss = styleBlock.textContent || '';
    if (!/url\(/i.test(originalCss)) continue;
    const ownerLabel = 'style-block';
    const rewrittenCss = mapCssUrls(originalCss, (url) => {
      const resolution = resolver.resolve(url);
      registerAsset(assets, {
        ownerUid: styleBlock.dataset.nodeUid,
        ownerTag: 'style',
        ownerLabel,
        attribute: 'textContent',
        kind: 'style-block-url',
        originalRef: url,
        previewRef: resolution.previewUrl || url,
        status: resolution.status,
        scheme: resolution.scheme,
        matchedPath: resolution.matchedPath || '',
        resolutionMethod: resolution.method,
      });
      if (resolution.status === 'unresolved') unresolvedRefs.add(url);
      return resolution.status === 'unresolved' ? buildSvgPlaceholderDataUrl('미해결 CSS 자산', truncate(url, 56)) : (resolution.previewUrl || url);
    });
    styleBlock.dataset.originalCss = encodeURIComponent(originalCss);
    styleBlock.textContent = rewrittenCss;
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) || href.startsWith('//')) remoteStylesheets.push(href);
  }
  if (remoteStylesheets.length) {
    issues.push(createIssue('info', 'REMOTE_STYLESHEET', `원격 stylesheet ${remoteStylesheets.length}개가 포함되어 있습니다.`));
  }

  if (unresolvedRefs.size) {
    const sourceHint = sourceType === 'folder-import'
      ? '선택한 폴더 안에서 못 찾은 자산이 있습니다.'
      : 'HTML 파일만 열면 상대경로나 uploaded: 자산은 연결되지 않을 수 있습니다. 프로젝트 폴더 import를 권장합니다.';
    issues.push(createIssue('warning', 'UNRESOLVED_ASSET', `미해결 자산 ${unresolvedRefs.size}개가 있습니다. ${sourceHint}`));
  }

  const slotDetection = collectSlotCandidates(doc, { markDom: true });
  const expectedSlotText = fixtureMeta?.slot_contract?.required_exact_count
    ? `기준 ${fixtureMeta.slot_contract.required_exact_count}개`
    : fixtureMeta?.slot_contract?.required_min_count
      ? `기준 최소 ${fixtureMeta.slot_contract.required_min_count}개`
      : '';
  if (fixtureMeta && expectedSlotText) {
    issues.push(createIssue('info', 'FIXTURE_EXPECTATION', `${fixtureMeta.id} ${fixtureMeta.name}: ${expectedSlotText}`));
  }

  const summary = {
    sourceName,
    sourceType,
    normalizedAt: new Date().toISOString(),
    elementCount: doc.querySelectorAll('*').length,
    sectionCount: doc.body?.querySelectorAll('section').length || 0,
    styleBlockCount: doc.querySelectorAll('style').length,
    scriptCountRemoved: scriptsRemoved,
    assetsTotal: assets.length,
    assetsResolved: assets.filter((item) => item.status === 'resolved').length,
    assetsPassthrough: assets.filter((item) => item.status === 'passthrough').length,
    assetsUnresolved: assets.filter((item) => item.status === 'unresolved').length,
    existingImageCount,
    explicitSlotCount: slotDetection.summary.explicitCount,
    heuristicSlotCount: slotDetection.summary.heuristicCount,
    nearMissCount: slotDetection.summary.nearMissCount,
    totalSlotCandidates: slotDetection.summary.totalCount,
    remoteStylesheetCount: remoteStylesheets.length,
    unresolvedReferenceCount: unresolvedRefs.size,
    linkedSlotCount: doc.querySelectorAll(EXPLICIT_SLOT_SELECTOR).length,
  };

  const normalizedHtml = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  const project = {
    id: nextId('project'),
    fixtureId: fixtureMeta?.id || '',
    fixtureMeta,
    sourceName,
    sourceType,
    originalHtml: String(html || ''),
    normalizedHtml,
    summary,
    issues,
    assets,
    slotDetection,
    remoteStylesheets,
    releaseResources: () => resolver.release(),
    fileContext: {
      mode: fileIndex?.mode || sourceType,
      htmlEntryPath,
      totalFiles: fileIndex?.totalFiles || 0,
      blobUrlCount: resolver.getBlobUrlCount(),
    },
  };

  return project;
}
