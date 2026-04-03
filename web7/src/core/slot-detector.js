import { BLOCKED_TAGS, EXPLICIT_SLOT_SELECTOR, LAYOUT_CLASS_RE, PLACEHOLDER_TEXT_RE, SLOT_NEAR_MISS_MIN, SLOT_SCORE_THRESHOLD, STRONG_SLOT_CLASS_RE } from '../config.js';
import { nextId, truncate } from '../utils.js';

function directTextContent(element) {
  return Array.from(element.childNodes || [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeholderText(element) {
  return [
    directTextContent(element),
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || '',
    element.getAttribute('alt') || '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasInlineBackground(element) {
  const style = (element.getAttribute('style') || '').toLowerCase();
  return style.includes('background-image') || style.includes('background:url(') || style.includes('background: url(');
}

function hasVisualInlineStyle(element) {
  const style = (element.getAttribute('style') || '').toLowerCase();
  return style.includes('height:') || style.includes('min-height:') || style.includes('aspect-ratio') || style.includes('border-style:') || style.includes('border-radius:') || style.includes('box-shadow');
}

function hasSlotLikeBorder(element) {
  const style = (element.getAttribute('style') || '').toLowerCase();
  return style.includes('dashed') || style.includes('border-style: solid') || style.includes('border: 2px') || style.includes('border:3px') || style.includes('border: 3px');
}

function shallowDescendantMedia(element) {
  const queue = [{ node: element, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (depth > 2) continue;
    for (const child of Array.from(node.children || [])) {
      if (child.tagName === 'IMG' || child.tagName === 'PICTURE') return child;
      const style = (child.getAttribute('style') || '').toLowerCase();
      if (style.includes('background-image')) return child;
      queue.push({ node: child, depth: depth + 1 });
    }
  }
  return null;
}

function countMeaningfulChildren(element) {
  return Array.from(element.children || []).filter((child) => !['BR', 'SPAN', 'SMALL', 'B', 'STRONG', 'EM', 'I'].includes(child.tagName)).length;
}

function buildLabel(element) {
  return (
    element.getAttribute('data-slot-label') ||
    element.getAttribute('data-image-slot') ||
    element.getAttribute('aria-label') ||
    element.id ||
    (typeof element.className === 'string' ? element.className : '') ||
    truncate(placeholderText(element), 48) ||
    element.tagName.toLowerCase()
  );
}

function groupKeyFor(element) {
  const className = typeof element.className === 'string' ? element.className : '';
  return className
    ? className.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => `.${part}`).join('')
    : element.tagName.toLowerCase();
}

function evaluateCandidate(element) {
  const className = typeof element.className === 'string' ? element.className : '';
  const text = placeholderText(element);
  const hasPlaceholder = PLACEHOLDER_TEXT_RE.test(text);
  const strongClass = STRONG_SLOT_CLASS_RE.test(className);
  const inlineBackground = hasInlineBackground(element);
  const descendantMedia = shallowDescendantMedia(element);
  const visualStyle = hasVisualInlineStyle(element);
  const slotBorder = hasSlotLikeBorder(element);
  const childCount = countMeaningfulChildren(element);
  const layoutWrapper = LAYOUT_CLASS_RE.test(className);
  const textHeavy = text.length > 140 && !hasPlaceholder;
  const tagPenalty = ['SECTION', 'ARTICLE', 'MAIN'].includes(element.tagName) ? -14 : 0;
  const fixedHeight = (() => {
    const style = (element.getAttribute('style') || '').toLowerCase();
    return /(?:^|;)\s*(?:height|min-height)\s*:\s*\d/.test(style);
  })();

  let score = 0;
  const reasons = [];
  const add = (value, reason) => {
    score += value;
    reasons.push(`${reason} ${value > 0 ? `+${value}` : value}`);
  };

  if (strongClass) add(52, '강한 클래스 힌트');
  if (hasPlaceholder) add(82, '플레이스홀더 문구');
  if (inlineBackground) add(56, 'inline 배경 이미지');
  if (descendantMedia?.tagName === 'IMG' || descendantMedia?.tagName === 'PICTURE') add(48, '얕은 자식 IMG/Picture');
  if (descendantMedia && descendantMedia !== element && descendantMedia.tagName !== 'IMG' && descendantMedia.tagName !== 'PICTURE') add(42, '얕은 자식 배경 이미지');
  if (visualStyle) add(18, '비주얼 스타일');
  if (slotBorder) add(12, '슬롯형 보더');
  if (fixedHeight) add(8, '고정 높이');
  if (layoutWrapper && !strongClass && !hasPlaceholder && !inlineBackground && !descendantMedia) add(-44, '레이아웃 래퍼');
  if (childCount >= 6 && !strongClass && !hasPlaceholder && !inlineBackground && !descendantMedia) add(-28, '자식 수 과다');
  if (textHeavy) add(-36, '텍스트 과다');
  if (tagPenalty) add(tagPenalty, '큰 구조 태그');

  const qualified = score >= SLOT_SCORE_THRESHOLD || (strongClass && (hasPlaceholder || inlineBackground || descendantMedia || visualStyle || slotBorder));
  const nearMiss = !qualified && score >= SLOT_NEAR_MISS_MIN;

  return {
    qualified,
    nearMiss,
    score,
    reasons,
    strongClass,
    hasPlaceholder,
    inlineBackground,
    descendantMedia: !!descendantMedia,
    groupKey: groupKeyFor(element),
  };
}

function clearExistingMarkers(doc) {
  for (const element of Array.from(doc.querySelectorAll('[data-detected-slot], [data-detected-slot-score], [data-detected-slot-label], [data-detected-slot-reasons], [data-slot-near-miss]'))) {
    element.removeAttribute('data-detected-slot');
    element.removeAttribute('data-detected-slot-score');
    element.removeAttribute('data-detected-slot-label');
    element.removeAttribute('data-detected-slot-reasons');
    element.removeAttribute('data-slot-near-miss');
  }
}

function applyMarker(element, record, type) {
  element.dataset.detectedSlot = type;
  element.dataset.detectedSlotScore = String(record.score ?? 0);
  element.dataset.detectedSlotLabel = record.label || '';
  element.dataset.detectedSlotReasons = (record.reasons || []).join(' | ');
}

export function collectSlotCandidates(doc, { markDom = true } = {}) {
  clearExistingMarkers(doc);
  const candidates = [];
  const nearMisses = [];
  const groups = new Map();
  const seen = new WeakSet();

  Array.from(doc.querySelectorAll('*')).forEach((element) => {
    if (!element.dataset.nodeUid) element.dataset.nodeUid = nextId('node');
  });

  doc.querySelectorAll(EXPLICIT_SLOT_SELECTOR).forEach((element) => {
    if (seen.has(element) || element.dataset.slotIgnore === '1') return;
    seen.add(element);
    const record = {
      id: nextId('slot'),
      uid: element.dataset.nodeUid,
      type: element.dataset.manualSlot === '1' ? 'manual' : 'explicit',
      label: buildLabel(element),
      score: 999,
      reasons: [element.dataset.manualSlot === '1' ? '수동 지정 슬롯' : '명시적 슬롯 선택자'],
      className: typeof element.className === 'string' ? element.className : '',
      groupKey: groupKeyFor(element),
    };
    candidates.push(record);
    groups.set(record.groupKey || '[explicit]', (groups.get(record.groupKey || '[explicit]') || 0) + 1);
    if (markDom) applyMarker(element, record, record.type);
  });

  const elements = Array.from(doc.body?.querySelectorAll('*') || []);
  for (const element of elements) {
    if (seen.has(element)) continue;
    if (element.dataset.slotIgnore === '1' || element.dataset.editorRuntime === '1') continue;
    if (BLOCKED_TAGS.has(element.tagName) || ['IMG', 'SOURCE', 'LINK'].includes(element.tagName)) continue;
    const result = evaluateCandidate(element);
    const label = buildLabel(element);
    const record = {
      id: nextId('slot'),
      uid: element.dataset.nodeUid,
      type: result.qualified ? 'heuristic' : 'near-miss',
      label,
      score: result.score,
      reasons: result.reasons,
      className: typeof element.className === 'string' ? element.className : '',
      groupKey: result.groupKey,
    };
    if (result.qualified) {
      candidates.push(record);
      groups.set(record.groupKey, (groups.get(record.groupKey) || 0) + 1);
      seen.add(element);
      if (markDom) applyMarker(element, record, 'heuristic');
    } else if (result.nearMiss) {
      nearMisses.push(record);
      if (markDom) {
        element.dataset.slotNearMiss = String(result.score);
        element.dataset.detectedSlotLabel = label;
        element.dataset.detectedSlotReasons = result.reasons.join(' | ');
      }
    }
  }

  const groupedPatterns = Array.from(groups.entries())
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group, 'ko'));

  const summary = {
    explicitCount: candidates.filter((item) => item.type === 'explicit' || item.type === 'manual').length,
    heuristicCount: candidates.filter((item) => item.type === 'heuristic').length,
    nearMissCount: nearMisses.length,
    totalCount: candidates.length,
    sectionCount: doc.body?.querySelectorAll('section').length || 0,
  };

  return { candidates, nearMisses, groupedPatterns, summary };
}
