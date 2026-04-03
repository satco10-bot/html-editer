import { BOX_CLASS_RE, EXPLICIT_SLOT_SELECTOR, FRAME_STYLE_ID, PLACEHOLDER_TEXT_RE, TEXTISH_TAGS, TEXT_CLASS_RE } from '../config.js';
import {
  canvasToBlob,
  createDoctypeHtml,
  guessExtensionFromMime,
  nextId,
  parseSrcsetCandidates,
  readBlobAsDataUrl,
  readFileAsDataUrl,
  removeEditorCssClasses,
  sanitizeFilename,
  serializeSrcsetCandidates,
  slugify,
  truncate,
} from '../utils.js';
import { collectSlotCandidates } from '../core/slot-detector.js';

const FRAME_CSS_URL_RE = /url\((['"]?)([^"'()]+)\1\)/gi;

function isElement(node) {
  return !!node && node.nodeType === Node.ELEMENT_NODE;
}

function closestElement(node) {
  if (isElement(node)) return node;
  return node?.parentElement || null;
}

function buildLabel(element) {
  return (
    element?.getAttribute?.('data-slot-label') ||
    element?.getAttribute?.('data-image-slot') ||
    element?.getAttribute?.('aria-label') ||
    element?.getAttribute?.('alt') ||
    element?.id ||
    (typeof element?.className === 'string' ? element.className : '') ||
    truncate(element?.textContent?.replace(/\s+/g, ' ').trim() || '', 48) ||
    element?.tagName?.toLowerCase?.() ||
    'element'
  );
}

function isTextyElement(element) {
  if (!element || !isElement(element)) return false;
  if (TEXTISH_TAGS.has(element.tagName)) return true;
  const className = typeof element.className === 'string' ? element.className : '';
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  return TEXT_CLASS_RE.test(className) && text.length > 0 && text.length < 240;
}

function isBoxyElement(element) {
  if (!element || !isElement(element)) return false;
  if (element.matches(EXPLICIT_SLOT_SELECTOR) || element.hasAttribute('data-detected-slot')) return false;
  const className = typeof element.className === 'string' ? element.className : '';
  return BOX_CLASS_RE.test(className) || ['DIV', 'SECTION', 'ARTICLE', 'LI'].includes(element.tagName);
}

function shallowDescendantMedia(element) {
  const queue = [{ node: element, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (depth > 2) continue;
    for (const child of Array.from(node.children || [])) {
      if (child.tagName === 'IMG' || child.tagName === 'PICTURE') return { kind: 'img', element: child.tagName === 'IMG' ? child : child.querySelector('img') };
      const style = (child.getAttribute('style') || '').toLowerCase();
      if (style.includes('background-image')) return { kind: 'background', element: child };
      queue.push({ node: child, depth: depth + 1 });
    }
  }
  return null;
}

function hasBackgroundImage(element) {
  const style = (element.getAttribute('style') || '').toLowerCase();
  return style.includes('background-image') || style.includes('background:url(') || style.includes('background: url(');
}

function isSimpleSlotContainer(element) {
  const children = Array.from(element.children || []);
  if (!children.length) return true;
  return children.every((child) => ['BR', 'IMG'].includes(child.tagName));
}

function setInlineStyle(element, patch) {
  const styleMap = new Map();
  const current = element.getAttribute('style') || '';
  for (const raw of current.split(';')) {
    const [key, ...rest] = raw.split(':');
    if (!key || !rest.length) continue;
    styleMap.set(key.trim().toLowerCase(), rest.join(':').trim());
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') styleMap.delete(String(key).toLowerCase());
    else styleMap.set(String(key).toLowerCase(), String(value));
  }
  const next = Array.from(styleMap.entries()).map(([key, value]) => `${key}: ${value}`).join('; ');
  if (next) element.setAttribute('style', next);
  else element.removeAttribute('style');
  if (element?.dataset) {
    if (next) element.dataset.exportStyle = next;
    else element.removeAttribute('data-export-style');
  }
  return next;
}

function encodeData(value) {
  return encodeURIComponent(String(value ?? ''));
}

function decodeData(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function stripTransientRuntime(doc) {
  doc.getElementById(FRAME_STYLE_ID)?.remove();
  for (const runtimeNode of Array.from(doc.querySelectorAll('[data-editor-runtime="1"]'))) runtimeNode.remove();
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const nextClass = removeEditorCssClasses(element.getAttribute('class') || '');
    if (nextClass) element.setAttribute('class', nextClass);
    else element.removeAttribute('class');
    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');
    element.removeAttribute('data-detected-slot');
    element.removeAttribute('data-detected-slot-label');
    element.removeAttribute('data-detected-slot-score');
    element.removeAttribute('data-detected-slot-reasons');
    element.removeAttribute('data-slot-near-miss');
  }
}

function stripFinalEditorRuntime(doc) {
  stripTransientRuntime(doc);
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name;
      if (name.startsWith('data-export-')) element.removeAttribute(name);
      if (name.startsWith('data-editor-')) element.removeAttribute(name);
      if (name.startsWith('data-normalized-')) element.removeAttribute(name);
      if (name.startsWith('data-original-')) element.removeAttribute(name);
      if (name === 'data-last-applied-file-name') element.removeAttribute(name);
    }
  }
}

function ensureFrameStyle(doc) {
  if (doc.getElementById(FRAME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = FRAME_STYLE_ID;
  style.textContent = `
    [data-detected-slot] { position: relative; }
    [data-detected-slot="explicit"], [data-detected-slot="manual"] {
      outline: 2px solid rgba(47, 109, 246, 0.92);
      outline-offset: -2px;
    }
    [data-detected-slot="heuristic"] {
      outline: 2px dashed rgba(15, 159, 110, 0.92);
      outline-offset: -2px;
    }
    [data-slot-near-miss] {
      box-shadow: inset 0 0 0 2px rgba(217, 119, 6, 0.32);
    }
    [data-detected-slot]::after {
      content: attr(data-detected-slot) ' · ' attr(data-detected-slot-label);
      position: absolute;
      left: 8px;
      top: 8px;
      z-index: 999999;
      max-width: calc(100% - 16px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-radius: 999px;
      background: rgba(255,255,255,0.95);
      color: #10213a;
      border: 1px solid rgba(16,33,58,0.18);
      box-shadow: 0 8px 20px rgba(16,33,58,0.12);
      padding: 4px 8px;
      font: 700 11px/1.35 Pretendard, Noto Sans KR, sans-serif;
      pointer-events: none;
    }
    .__phase5_selected_slot {
      outline: 3px solid rgba(220, 38, 38, 0.96) !important;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14) inset;
    }
    .__phase5_selected_text {
      outline: 3px solid rgba(16, 185, 129, 0.96) !important;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14) inset;
    }
    .__phase5_selected_box {
      outline: 3px solid rgba(37, 99, 235, 0.96) !important;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14) inset;
    }
    .__phase5_selected_multi {
      outline: 2px dashed rgba(139, 92, 246, 0.96) !important;
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12) inset;
    }
    .__phase5_drop_hover {
      outline: 3px dashed rgba(37, 99, 235, 0.98) !important;
      box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12) inset;
    }
    .__phase5_runtime_image {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 50%;
      user-select: none;
      -webkit-user-drag: none;
    }
    .__phase5_text_editing {
      outline: 3px solid rgba(245, 158, 11, 0.96) !important;
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.16) inset;
      caret-color: #111827;
      background: rgba(255,255,255,0.02);
    }
    .__phase6_locked_outline {
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.24) inset;
    }
    .__phase6_marquee_box {
      position: fixed;
      left: 0;
      top: 0;
      width: 0;
      height: 0;
      pointer-events: none;
      z-index: 999997;
      border: 1px dashed rgba(37, 99, 235, 0.94);
      background: rgba(59, 130, 246, 0.12);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.4) inset;
      display: none;
    }
    .__phase6_snap_line_x, .__phase6_snap_line_y {
      position: fixed;
      pointer-events: none;
      z-index: 999996;
      display: none;
      background: rgba(14, 165, 233, 0.92);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.35);
    }
    .__phase6_snap_line_x { width: 1px; top: 0; bottom: 0; }
    .__phase6_snap_line_y { height: 1px; left: 0; right: 0; }
    .__phase6_dragging_cursor, .__phase6_dragging_cursor * {
      cursor: grabbing !important;
      user-select: none !important;
    }
  `;
  doc.head.appendChild(style);
}


export function createFrameEditor({
  iframe,
  project,
  selectionMode = 'smart',
  initialSnapshot = null,
  onStateChange = () => {},
  onStatus = () => {},
  onMutation = () => {},
  onShortcut = () => {},
}) {
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  ensureFrameStyle(doc);

  let destroyed = false;
  let currentSelectionMode = initialSnapshot?.selectionMode || selectionMode;
  let detection = { candidates: [], nearMisses: [], summary: { totalCount: 0, nearMissCount: 0 } };
  let slotMap = new Map();
  let selectedElements = [];
  let selectedElement = null;
  let selectedInfo = null;
  let hoverSlot = null;
  let editingTextElement = null;
  let editingTextOriginalHtml = '';
  let dragState = null;
  let suppressClickUntil = 0;
  let overlayNodes = null;
  const slotBackupMap = new Map();
  const modifiedSlots = new Set();

  function uniqueConnectedElements(items) {
    const seen = new Set();
    const result = [];
    for (const element of items || []) {
      if (!element || !element.isConnected) continue;
      const uid = element.dataset?.nodeUid || nextId('node');
      element.dataset.nodeUid = uid;
      if (seen.has(uid)) continue;
      seen.add(uid);
      result.push(element);
    }
    return result;
  }

  function placeholderTextValue(element) {
    return [
      element?.getAttribute?.('data-slot-label') || '',
      element?.getAttribute?.('aria-label') || '',
      element?.getAttribute?.('title') || '',
      element?.getAttribute?.('alt') || '',
      element?.textContent || '',
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function isSectionLike(element) {
    if (!element || !isElement(element)) return false;
    const className = typeof element.className === 'string' ? element.className : '';
    return element.tagName === 'SECTION' || /(^|\s)(hero|section|hb-info-wrap|page)(\s|$)/i.test(className);
  }

  function isHiddenElement(element) {
    return !!element && isElement(element) && (element.dataset.editorHidden === '1' || !!element.closest?.('[data-editor-hidden="1"]'));
  }

  function isLockedElement(element) {
    return !!element && isElement(element) && (element.dataset.editorLocked === '1' || !!element.closest?.('[data-editor-locked="1"]'));
  }

  function ensureOverlayNodes() {
    if (overlayNodes) return overlayNodes;
    const marquee = doc.createElement('div');
    marquee.className = '__phase6_marquee_box';
    marquee.dataset.editorRuntime = '1';
    const lineX = doc.createElement('div');
    lineX.className = '__phase6_snap_line_x';
    lineX.dataset.editorRuntime = '1';
    const lineY = doc.createElement('div');
    lineY.className = '__phase6_snap_line_y';
    lineY.dataset.editorRuntime = '1';
    doc.body.append(marquee, lineX, lineY);
    overlayNodes = { marquee, lineX, lineY };
    return overlayNodes;
  }

  function hideInteractionOverlay() {
    const nodes = ensureOverlayNodes();
    nodes.marquee.style.display = 'none';
    nodes.lineX.style.display = 'none';
    nodes.lineY.style.display = 'none';
    doc.documentElement.classList.remove('__phase6_dragging_cursor');
    doc.body.classList.remove('__phase6_dragging_cursor');
  }

  function showMarqueeRect(rect) {
    const nodes = ensureOverlayNodes();
    nodes.marquee.style.display = 'block';
    nodes.marquee.style.left = `${rect.left}px`;
    nodes.marquee.style.top = `${rect.top}px`;
    nodes.marquee.style.width = `${Math.max(0, rect.width)}px`;
    nodes.marquee.style.height = `${Math.max(0, rect.height)}px`;
  }

  function showSnapLines({ x = null, y = null } = {}) {
    const nodes = ensureOverlayNodes();
    nodes.lineX.style.display = Number.isFinite(x) ? 'block' : 'none';
    nodes.lineY.style.display = Number.isFinite(y) ? 'block' : 'none';
    if (Number.isFinite(x)) nodes.lineX.style.left = `${x}px`;
    if (Number.isFinite(y)) nodes.lineY.style.top = `${y}px`;
  }

  function normalizeClientRect(startX, startY, endX, endY) {
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const right = Math.max(startX, endX);
    const bottom = Math.max(startY, endY);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function rectIntersects(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function unionRect(records) {
    if (!records?.length) return null;
    const left = Math.min(...records.map((item) => item.left));
    const top = Math.min(...records.map((item) => item.top));
    const right = Math.max(...records.map((item) => item.right));
    const bottom = Math.max(...records.map((item) => item.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function collectInteractiveLayers() {
    const root = doc.querySelector('.page') || doc.body;
    const items = [];
    function walk(parent, depth) {
      for (const child of Array.from(parent.children || [])) {
        if (!child.dataset.nodeUid) child.dataset.nodeUid = nextId('node');
        const expose = shouldExposeLayer(child, depth);
        if (expose && !isHiddenElement(child)) items.push(child);
        if (depth < 4) walk(child, expose ? depth + 1 : depth);
      }
    }
    walk(root, 0);
    return items;
  }

  function buildSnapCandidates(excludedUids = new Set()) {
    return collectInteractiveLayers()
      .filter((element) => !excludedUids.has(element.dataset.nodeUid) && !isLockedElement(element) && !isHiddenElement(element))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0);
  }

  function computeSnapAdjustment(box, dx, dy, candidates) {
    const tolerance = 8;
    const movingX = [box.left + dx, box.left + box.width / 2 + dx, box.right + dx];
    const movingY = [box.top + dy, box.top + box.height / 2 + dy, box.bottom + dy];
    let bestX = { diff: tolerance + 1, guide: null, adjust: 0 };
    let bestY = { diff: tolerance + 1, guide: null, adjust: 0 };

    for (const candidate of candidates) {
      const rect = candidate.rect;
      const targetX = [rect.left, rect.left + rect.width / 2, rect.right];
      const targetY = [rect.top, rect.top + rect.height / 2, rect.bottom];
      for (const line of targetX) {
        for (const current of movingX) {
          const diff = line - current;
          if (Math.abs(diff) < Math.abs(bestX.diff) && Math.abs(diff) <= tolerance) bestX = { diff, guide: line, adjust: diff };
        }
      }
      for (const line of targetY) {
        for (const current of movingY) {
          const diff = line - current;
          if (Math.abs(diff) < Math.abs(bestY.diff) && Math.abs(diff) <= tolerance) bestY = { diff, guide: line, adjust: diff };
        }
      }
    }

    return {
      dx: dx + (Number.isFinite(bestX.adjust) ? bestX.adjust : 0),
      dy: dy + (Number.isFinite(bestY.adjust) ? bestY.adjust : 0),
      guideX: Number.isFinite(bestX.guide) ? bestX.guide : null,
      guideY: Number.isFinite(bestY.guide) ? bestY.guide : null,
      snappedX: Number.isFinite(bestX.guide),
      snappedY: Number.isFinite(bestY.guide),
    };
  }

  function layerTypeOf(element) {
    if (!element || !isElement(element)) return 'box';
    if (element.hasAttribute('data-detected-slot') || element.matches(EXPLICIT_SLOT_SELECTOR) || element.dataset.manualSlot === '1') return 'slot';
    if (isTextyElement(element)) return 'text';
    if (isSectionLike(element)) return 'section';
    return 'box';
  }

  function shouldExposeLayer(element, depth = 0) {
    if (!element || !isElement(element)) return false;
    if (['IMG', 'SOURCE', 'SCRIPT', 'STYLE', 'META', 'LINK'].includes(element.tagName)) return false;
    const type = layerTypeOf(element);
    if (type === 'slot' || type === 'text' || type === 'section') return true;
    const className = typeof element.className === 'string' ? element.className : '';
    if (depth <= 1 && isBoxyElement(element)) return true;
    return depth <= 2 && /(card|wrap|holder|group|item|content|body|box|visual|thumb|media|title|desc|question|answer)/i.test(className);
  }

  function buildLayerTree() {
    const root = doc.querySelector('.page') || doc.body;
    const items = [];
    const selectedUids = new Set(selectedElements.map((element) => element.dataset.nodeUid));

    function walk(parent, depth) {
      for (const child of Array.from(parent.children || [])) {
        if (!child.dataset.nodeUid) child.dataset.nodeUid = nextId('node');
        const expose = shouldExposeLayer(child, depth);
        if (expose) {
          items.push({
            uid: child.dataset.nodeUid,
            label: buildLabel(child),
            type: layerTypeOf(child),
            tagName: child.tagName.toLowerCase(),
            depth,
            childCount: child.children?.length || 0,
            selected: selectedUids.has(child.dataset.nodeUid),
            hidden: child.dataset.editorHidden === '1',
            locked: child.dataset.editorLocked === '1',
          });
        }
        if (depth < 4) walk(child, expose ? depth + 1 : depth);
      }
    }

    walk(root, 0);
    return items.slice(0, 400);
  }

  function rgbToHex(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('#')) {
      if (raw.length === 4) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
      return raw.toLowerCase();
    }
    const match = raw.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!match) return '';
    const toHex = (num) => Number(num).toString(16).padStart(2, '0');
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
  }

  function formatNumberString(value, precision = 2) {
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num)) return '';
    const rounded = Number(num.toFixed(precision));
    return String(rounded);
  }

  function getTextTargets() {
    const targets = selectedElements.filter((element) => selectionTypeOf(element) === 'text');
    if (targets.length) return targets;
    if (selectedElement && selectionTypeOf(selectedElement) === 'text') return [selectedElement];
    return [];
  }

  function getTextStyleState() {
    const targets = getTextTargets();
    if (!targets.length) return { enabled: false, targetCount: 0 };
    const styles = targets.map((element) => win.getComputedStyle(element));
    const pick = (getter) => {
      const first = getter(styles[0]);
      return styles.every((style) => getter(style) === first) ? first : '';
    };
    const fontSize = pick((style) => formatNumberString(style.fontSize, 2).replace(/\.0+$/, ''));
    const lineHeight = pick((style) => {
      const fs = Number.parseFloat(style.fontSize || '0');
      const lh = Number.parseFloat(style.lineHeight || '0');
      if (!Number.isFinite(fs) || !Number.isFinite(lh) || !fs) return '';
      return formatNumberString(lh / fs, 2);
    });
    const letterSpacing = pick((style) => {
      const fs = Number.parseFloat(style.fontSize || '0');
      const ls = Number.parseFloat(style.letterSpacing || '0');
      if (!Number.isFinite(fs) || !fs || !Number.isFinite(ls)) return '';
      return formatNumberString(ls / fs, 3);
    });
    return {
      enabled: true,
      targetCount: targets.length,
      fontSize,
      lineHeight,
      letterSpacing,
      fontWeight: pick((style) => String(style.fontWeight || '')),
      color: pick((style) => rgbToHex(style.color || '')),
      textAlign: pick((style) => String(style.textAlign || '')),
    };
  }

  function getDerivedMeta() {
    const selectedItems = selectedElements.map((element) => buildSelectionInfo(element)).filter(Boolean);
    const layerTree = buildLayerTree();
    return {
      selected: selectedInfo,
      selectedItems,
      selectionCount: selectedItems.length,
      slots: detection.candidates,
      nearMisses: detection.nearMisses,
      slotSummary: detection.summary,
      modifiedSlotCount: modifiedSlots.size,
      selectionMode: currentSelectionMode,
      textEditing: !!editingTextElement,
      hiddenCount: layerTree.filter((item) => item.hidden).length,
      lockedCount: layerTree.filter((item) => item.locked).length,
      interaction: dragState ? { mode: dragState.mode, moved: !!dragState.moved } : null,
      layerTree,
      textStyle: getTextStyleState(),
      preflight: buildPreflightReport(),
    };
  }

  function emitState() {
    onStateChange(getDerivedMeta());
  }

  function refreshDerivedMeta() {
    emitState();
  }

  function emitMutation(label) {
    onMutation(captureSnapshot(label));
  }

  function getElementByUid(uid) {
    if (!uid) return null;
    return doc.querySelector(`[data-node-uid="${uid}"]`);
  }

  function getSelectedSlotElement() {
    const current = selectedElement;
    if (current && (current.hasAttribute('data-detected-slot') || current.matches(EXPLICIT_SLOT_SELECTOR))) return current;
    if (current) {
      const match = current.closest?.('[data-detected-slot], [data-image-slot], .image-slot, .drop-slot');
      if (match) return match;
    }
    return selectedElements.find((element) => element.hasAttribute('data-detected-slot') || element.matches(EXPLICIT_SLOT_SELECTOR)) || null;
  }

  function selectionTypeOf(element) {
    if (!element) return '';
    if (element.hasAttribute('data-detected-slot') || element.matches(EXPLICIT_SLOT_SELECTOR) || element.dataset.manualSlot === '1') return 'slot';
    if (isTextyElement(element)) return 'text';
    return 'box';
  }

  function buildSelectionInfo(element) {
    if (!element) return null;
    const detectedType = element.getAttribute('data-detected-slot') || (element.matches(EXPLICIT_SLOT_SELECTOR) ? 'explicit' : '');
    const score = Number(element.getAttribute('data-detected-slot-score') || 0) || (detectedType ? 999 : 0);
    const reasons = (element.getAttribute('data-detected-slot-reasons') || '').split('|').map((item) => item.trim()).filter(Boolean);
    return {
      uid: element.dataset.nodeUid || '',
      type: selectionTypeOf(element),
      label: buildLabel(element),
      detectedType,
      score,
      reasons,
      tagName: element.tagName.toLowerCase(),
      hidden: element.dataset.editorHidden === '1',
      locked: isLockedElement(element),
      textEditing: editingTextElement === element,
    };
  }

  function clearSelectionClasses() {
    for (const element of Array.from(doc.querySelectorAll('.__phase5_selected_slot, .__phase5_selected_text, .__phase5_selected_box, .__phase5_selected_multi'))) {
      element.classList.remove('__phase5_selected_slot', '__phase5_selected_text', '__phase5_selected_box', '__phase5_selected_multi');
    }
  }

  function syncSelectionInfo() {
    selectedElements = uniqueConnectedElements(selectedElements);
    selectedElement = selectedElements[0] || null;
    selectedInfo = buildSelectionInfo(selectedElement);
  }

  function applySelectionClasses() {
    selectedElements.forEach((element, index) => {
      if (!element) return;
      if (index === 0) {
        const type = selectionTypeOf(element);
        element.classList.add(type === 'slot' ? '__phase5_selected_slot' : type === 'text' ? '__phase5_selected_text' : '__phase5_selected_box');
      } else {
        element.classList.add('__phase5_selected_multi');
      }
    });
  }

  function selectElements(nextElements, { silent = false } = {}) {
    clearSelectionClasses();
    selectedElements = uniqueConnectedElements(nextElements);
    syncSelectionInfo();
    applySelectionClasses();
    if (!silent) emitState();
  }

  function selectElement(element, { silent = false, additive = false, toggle = false } = {}) {
    if (!element) {
      if (!additive) selectElements([], { silent });
      return;
    }
    if (!additive) return selectElements([element], { silent });
    const current = uniqueConnectedElements(selectedElements);
    const uid = element.dataset.nodeUid || nextId('node');
    element.dataset.nodeUid = uid;
    const exists = current.some((item) => item.dataset.nodeUid === uid);
    if (exists && toggle) {
      const next = current.filter((item) => item.dataset.nodeUid !== uid);
      return selectElements(next, { silent });
    }
    const next = [element, ...current.filter((item) => item.dataset.nodeUid !== uid)];
    return selectElements(next, { silent });
  }

  function clearHover() {
    if (hoverSlot) hoverSlot.classList.remove('__phase5_drop_hover');
    hoverSlot = null;
  }

  function resolveSelectionTarget(rawTarget) {
    const target = closestElement(rawTarget);
    if (!target || ['HTML', 'BODY'].includes(target.tagName)) return null;
    if (isLockedElement(target)) return null;
    const slotTarget = target.closest?.('[data-detected-slot], [data-image-slot], .image-slot, .drop-slot') || null;
    if (currentSelectionMode === 'image') return slotTarget || target;
    if (currentSelectionMode === 'text') {
      const textTarget = target.closest?.('h1, h2, h3, h4, h5, h6, p, span, small, strong, em, b, i, u, li, td, th, label, a, button, blockquote') || (isTextyElement(target) ? target : null);
      return textTarget || slotTarget || target;
    }
    if (currentSelectionMode === 'box') {
      if (slotTarget) return slotTarget;
      let cursor = target;
      while (cursor && !['BODY', 'HTML'].includes(cursor.tagName)) {
        if (isBoxyElement(cursor)) return cursor;
        cursor = cursor.parentElement;
      }
      return target;
    }
    return slotTarget || (isTextyElement(target) ? target : null) || target;
  }

  function rememberSlotBackup(slot) {
    const uid = slot.dataset.nodeUid || nextId('node');
    slot.dataset.nodeUid = uid;
    if (slotBackupMap.has(uid)) return uid;
    const backup = { innerHTML: slot.innerHTML, style: slot.getAttribute('style') || '' };
    slotBackupMap.set(uid, backup);
    slot.dataset.editorBackupHtml = encodeData(backup.innerHTML);
    slot.dataset.editorBackupStyle = encodeData(backup.style);
    return uid;
  }

  function getPersistedBackup(slot) {
    const uid = slot?.dataset?.nodeUid || '';
    if (!uid) return null;
    if (slotBackupMap.has(uid)) return slotBackupMap.get(uid);
    if (!slot.hasAttribute('data-editor-backup-html') && !slot.hasAttribute('data-editor-backup-style')) return null;
    const backup = {
      innerHTML: decodeData(slot.dataset.editorBackupHtml || ''),
      style: decodeData(slot.dataset.editorBackupStyle || ''),
    };
    slotBackupMap.set(uid, backup);
    return backup;
  }

  function rehydratePersistentState() {
    slotBackupMap.clear();
    modifiedSlots.clear();
    for (const element of Array.from(doc.querySelectorAll('[data-editor-backup-html], [data-editor-backup-style]'))) {
      if (!element.dataset.nodeUid) continue;
      slotBackupMap.set(element.dataset.nodeUid, {
        innerHTML: decodeData(element.dataset.editorBackupHtml || ''),
        style: decodeData(element.dataset.editorBackupStyle || ''),
      });
    }
    for (const element of Array.from(doc.querySelectorAll('[data-editor-modified="1"]'))) {
      if (element.dataset.nodeUid) modifiedSlots.add(element.dataset.nodeUid);
    }
  }

  function redetect({ preserveSelectionUid = '', preserveSelectionUids = null } = {}) {
    const keepUids = preserveSelectionUids || selectedElements.map((element) => element.dataset.nodeUid).filter(Boolean) || [];
    detection = collectSlotCandidates(doc, { markDom: true });
    slotMap = new Map(detection.candidates.map((item) => [item.uid, item]));
    const keepElements = uniqueConnectedElements(keepUids.map((uid) => getElementByUid(uid)));
    if (keepElements.length) selectElements(keepElements, { silent: true });
    else if (preserveSelectionUid || initialSnapshot?.selectedUid) {
      const keepElement = getElementByUid(preserveSelectionUid || initialSnapshot?.selectedUid || '');
      if (keepElement) selectElements([keepElement], { silent: true });
      else selectElements([], { silent: true });
    } else {
      syncSelectionInfo();
      applySelectionClasses();
    }
    emitState();
  }

  function setSelectionMode(mode) {
    currentSelectionMode = mode || 'smart';
    emitState();
    onStatus(`선택 우선 모드: ${currentSelectionMode}`);
  }

  function setElementHidden(element, hidden) {
    if (!element) return false;
    const uid = element.dataset.nodeUid || nextId('node');
    element.dataset.nodeUid = uid;
    if (!element.hasAttribute('data-editor-base-display')) element.dataset.editorBaseDisplay = encodeData(element.style.display || '');
    if (hidden) element.dataset.editorHidden = '1';
    else element.removeAttribute('data-editor-hidden');
    const baseDisplay = decodeData(element.dataset.editorBaseDisplay || '');
    setInlineStyle(element, { display: hidden ? 'none' : (baseDisplay && baseDisplay !== 'none' ? baseDisplay : null) });
    element.dataset.editorModified = '1';
    modifiedSlots.add(uid);
    return true;
  }

  function setElementLocked(element, locked) {
    if (!element) return false;
    const uid = element.dataset.nodeUid || nextId('node');
    element.dataset.nodeUid = uid;
    if (locked) element.dataset.editorLocked = '1';
    else element.removeAttribute('data-editor-locked');
    element.dataset.editorModified = '1';
    modifiedSlots.add(uid);
    return true;
  }

  function toggleSelectedHidden() {
    const targets = uniqueConnectedElements(selectedElements);
    if (!targets.length) return { ok: false, message: '먼저 레이어를 선택해 주세요.' };
    const nextHidden = targets.some((element) => element.dataset.editorHidden !== '1');
    targets.forEach((element) => setElementHidden(element, nextHidden));
    emitState();
    emitMutation(nextHidden ? 'hide-layer' : 'show-layer');
    return { ok: true, message: nextHidden ? `선택 레이어 ${targets.length}개를 숨겼습니다.` : `선택 레이어 ${targets.length}개를 다시 표시했습니다.` };
  }

  function toggleSelectedLocked() {
    const targets = uniqueConnectedElements(selectedElements);
    if (!targets.length) return { ok: false, message: '먼저 레이어를 선택해 주세요.' };
    const nextLocked = targets.some((element) => element.dataset.editorLocked !== '1');
    targets.forEach((element) => setElementLocked(element, nextLocked));
    emitState();
    emitMutation(nextLocked ? 'lock-layer' : 'unlock-layer');
    return { ok: true, message: nextLocked ? `선택 레이어 ${targets.length}개를 잠갔습니다.` : `선택 레이어 ${targets.length}개 잠금을 해제했습니다.` };
  }

  function toggleLayerHiddenByUid(uid) {
    const element = getElementByUid(uid);
    if (!element) return { ok: false, message: '레이어를 찾지 못했습니다.' };
    selectElements([element], { silent: true });
    return toggleSelectedHidden();
  }

  function toggleLayerLockedByUid(uid) {
    const element = getElementByUid(uid);
    if (!element) return { ok: false, message: '레이어를 찾지 못했습니다.' };
    selectElements([element], { silent: true });
    return toggleSelectedLocked();
  }

  function findSlotMediaTarget(slot) {
    const shallow = shallowDescendantMedia(slot);
    if (shallow?.kind === 'img' && shallow.element) return shallow;
    if (slot.dataset.slotMode === 'background') return { kind: 'background', element: slot };
    if (hasBackgroundImage(slot) && !isSimpleSlotContainer(slot)) return { kind: 'background', element: slot };
    if (shallow?.kind === 'background' && shallow.element && !isSimpleSlotContainer(slot)) return shallow;
    return { kind: 'img', element: slot.querySelector('img.__phase5_runtime_image, img') || null };
  }

  function clearSimplePlaceholder(slot) {
    if (!isSimpleSlotContainer(slot)) return;
    slot.innerHTML = '';
  }

  async function applyFileToSlot(slot, file, { emit = true } = {}) {
    if (!slot || !file || isLockedElement(slot)) return false;
    rememberSlotBackup(slot);
    const uid = slot.dataset.nodeUid;
    const dataUrl = await readFileAsDataUrl(file);
    const target = findSlotMediaTarget(slot);

    if (target.kind === 'background') {
      const styleTarget = target.element || slot;
      const nextStyle = setInlineStyle(styleTarget, {
        'background-image': `url("${dataUrl}")`,
        'background-size': 'cover',
        'background-position': 'center center',
        'background-repeat': 'no-repeat',
      });
      styleTarget.dataset.editorStyleModified = '1';
      styleTarget.dataset.exportStyle = nextStyle;
      slot.dataset.editorModified = '1';
    } else {
      let img = target.element;
      if (!img || !img.isConnected || img === slot) {
        clearSimplePlaceholder(slot);
        img = doc.createElement('img');
        img.className = '__phase5_runtime_image';
        slot.appendChild(img);
      }
      img.classList.add('__phase5_runtime_image');
      img.setAttribute('src', dataUrl);
      img.dataset.exportSrc = dataUrl;
      img.dataset.editorImageModified = '1';
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      setInlineStyle(img, {
        width: '100%',
        height: '100%',
        display: 'block',
        'object-fit': 'cover',
        'object-position': '50% 50%',
      });
      setInlineStyle(slot, { overflow: 'hidden' });
      slot.dataset.editorModified = '1';
    }

    modifiedSlots.add(uid);
    slot.dataset.lastAppliedFileName = file.name;
    if (emit) {
      selectElements([slot], { silent: true });
      emitState();
      onStatus(`이미지를 적용했습니다: ${file.name}`);
      emitMutation('apply-image');
    }
    return true;
  }

  async function applyFilesStartingAtSlot(slot, files) {
    const imageFiles = Array.from(files || []).filter((file) => /^image\//i.test(file.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name || ''));
    if (!slot || !imageFiles.length) return 0;
    const slots = detection.candidates.map((item) => getElementByUid(item.uid)).filter(Boolean);
    const start = Math.max(0, slots.indexOf(slot));
    let applied = 0;
    for (let index = 0; index < imageFiles.length && start + index < slots.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await applyFileToSlot(slots[start + index], imageFiles[index], { emit: false });
      applied += 1;
    }
    selectElements([slot], { silent: true });
    emitState();
    onStatus(applied > 1 ? `${applied}개 이미지를 순차 배치했습니다.` : `이미지를 적용했습니다: ${imageFiles[0].name}`);
    emitMutation(applied > 1 ? 'apply-multiple-images' : 'apply-image');
    return applied;
  }

  function applyImagePreset(preset) {
    const slot = getSelectedSlotElement();
    if (!slot) return { ok: false, message: '먼저 이미지 슬롯을 선택해 주세요.' };
    const target = findSlotMediaTarget(slot);
    if (target.kind === 'background') {
      const position = preset === 'top' ? 'center top' : preset === 'bottom' ? 'center bottom' : 'center center';
      const size = preset === 'contain' ? 'contain' : 'cover';
      const nextStyle = setInlineStyle(target.element || slot, {
        'background-size': size,
        'background-position': position,
        'background-repeat': 'no-repeat',
      });
      (target.element || slot).dataset.editorStyleModified = '1';
      (target.element || slot).dataset.exportStyle = nextStyle;
      slot.dataset.editorModified = '1';
      modifiedSlots.add(slot.dataset.nodeUid);
      emitState();
      emitMutation(`preset-${preset}`);
      return { ok: true, message: `배경 이미지 프리셋 적용: ${preset}` };
    }

    const img = target.element || slot.querySelector('img');
    if (!img) return { ok: false, message: '슬롯 안에 이미지가 없습니다.' };
    const objectPosition = preset === 'top' ? '50% 0%' : preset === 'bottom' ? '50% 100%' : '50% 50%';
    const objectFit = preset === 'contain' ? 'contain' : 'cover';
    setInlineStyle(img, {
      width: '100%',
      height: '100%',
      display: 'block',
      'object-fit': objectFit,
      'object-position': objectPosition,
    });
    img.dataset.editorImageModified = '1';
    img.dataset.exportSrc = img.getAttribute('src') || img.dataset.exportSrc || '';
    slot.dataset.editorModified = '1';
    modifiedSlots.add(slot.dataset.nodeUid);
    emitState();
    emitMutation(`preset-${preset}`);
    return { ok: true, message: `이미지 프리셋 적용: ${preset}` };
  }

  function removeImageFromSelected() {
    const slot = getSelectedSlotElement();
    if (!slot) return { ok: false, message: '먼저 이미지 슬롯을 선택해 주세요.' };
    if (isLockedElement(slot)) return { ok: false, message: '잠긴 레이어는 이미지를 복구/제거할 수 없습니다.' };
    const uid = slot.dataset.nodeUid;
    const backup = getPersistedBackup(slot);
    if (!backup) return { ok: false, message: '복구할 원본 상태가 없습니다.' };
    slot.innerHTML = backup.innerHTML;
    if (backup.style) slot.setAttribute('style', backup.style);
    else slot.removeAttribute('style');
    slot.removeAttribute('data-export-style');
    slot.removeAttribute('data-editor-modified');
    slot.removeAttribute('data-last-applied-file-name');
    modifiedSlots.delete(uid);
    selectElements([slot], { silent: true });
    redetect({ preserveSelectionUids: [uid] });
    emitMutation('remove-image');
    return { ok: true, message: '슬롯 이미지를 원래 상태로 복구했습니다.' };
  }

  function markSelectedAsSlot() {
    if (!selectedElement) return { ok: false, message: '먼저 요소를 선택해 주세요.' };
    if (isLockedElement(selectedElement)) return { ok: false, message: '잠긴 레이어는 슬롯 지정할 수 없습니다.' };
    selectedElement.dataset.manualSlot = '1';
    selectedElement.removeAttribute('data-slot-ignore');
    if (!selectedElement.getAttribute('data-image-slot')) selectedElement.setAttribute('data-image-slot', slugify(buildLabel(selectedElement) || selectedElement.dataset.nodeUid || 'slot'));
    if (!selectedElement.getAttribute('data-slot-label')) selectedElement.setAttribute('data-slot-label', buildLabel(selectedElement));
    redetect({ preserveSelectionUids: [selectedElement.dataset.nodeUid] });
    emitMutation('mark-manual-slot');
    return { ok: true, message: '선택 요소를 수동 이미지 슬롯으로 지정했습니다.' };
  }

  function demoteSelectedSlot() {
    if (!selectedElement) return { ok: false, message: '먼저 요소를 선택해 주세요.' };
    if (isLockedElement(selectedElement)) return { ok: false, message: '잠긴 레이어는 슬롯 해제할 수 없습니다.' };
    selectedElement.dataset.slotIgnore = '1';
    selectedElement.removeAttribute('data-manual-slot');
    redetect({ preserveSelectionUids: [selectedElement.dataset.nodeUid] });
    emitMutation('ignore-slot');
    return { ok: true, message: '선택 요소를 슬롯 감지 대상에서 제외했습니다.' };
  }

  function placeCaretAtEnd(element) {
    const range = doc.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isTextEditableTarget(element) {
    return !!element && selectionTypeOf(element) === 'text';
  }

  function startTextEdit(element = selectedElement) {
    if (!isTextEditableTarget(element)) return { ok: false, message: '텍스트 요소를 먼저 선택해 주세요.' };
    if (isLockedElement(element)) return { ok: false, message: '잠긴 레이어는 텍스트 편집할 수 없습니다.' };
    if (editingTextElement && editingTextElement !== element) finishTextEdit({ commit: true, emit: false });
    if (editingTextElement === element) return { ok: true, message: '이미 텍스트 편집 중입니다.' };
    editingTextElement = element;
    editingTextOriginalHtml = element.innerHTML;
    element.contentEditable = 'true';
    element.spellcheck = false;
    element.classList.add('__phase5_text_editing');
    selectElements([element], { silent: true });
    element.focus({ preventScroll: true });
    placeCaretAtEnd(element);
    emitState();
    return { ok: true, message: '텍스트 편집을 시작했습니다. Ctrl/Cmd+Enter로 저장, Esc로 취소합니다.' };
  }

  function finishTextEdit({ commit = true, emit = true } = {}) {
    if (!editingTextElement) return { ok: false, message: '현재 텍스트 편집 중이 아닙니다.' };
    const element = editingTextElement;
    const changed = element.innerHTML !== editingTextOriginalHtml;
    if (!commit) element.innerHTML = editingTextOriginalHtml;
    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');
    element.classList.remove('__phase5_text_editing');
    editingTextElement = null;
    editingTextOriginalHtml = '';
    if (element.dataset.nodeUid) modifiedSlots.add(element.dataset.nodeUid);
    selectElements([element], { silent: true });
    emitState();
    if (emit && commit && changed) emitMutation('text-edit');
    return { ok: true, message: !commit ? '텍스트 편집을 취소했습니다.' : changed ? '텍스트 수정을 저장했습니다.' : '텍스트 변경사항이 없습니다.' };
  }

  function toggleTextEdit() {
    if (editingTextElement) return finishTextEdit({ commit: true });
    return startTextEdit(selectedElement);
  }

  function readTransformState(element) {
    if (!element.dataset.editorBaseTransform) {
      element.dataset.editorBaseTransform = encodeData(element.style.transform || '');
    }
    return {
      base: decodeData(element.dataset.editorBaseTransform || ''),
      tx: Number.parseFloat(element.dataset.editorTx || '0') || 0,
      ty: Number.parseFloat(element.dataset.editorTy || '0') || 0,
    };
  }

  function writeTransformState(element, tx, ty) {
    const state = readTransformState(element);
    element.dataset.editorTx = String(Number(tx.toFixed(3)));
    element.dataset.editorTy = String(Number(ty.toFixed(3)));
    const translate = (tx || ty) ? `translate(${Number(tx.toFixed(3))}px, ${Number(ty.toFixed(3))}px)` : '';
    const base = state.base && state.base !== 'none' ? state.base : '';
    const nextTransform = [base, translate].filter(Boolean).join(' ').trim();
    setInlineStyle(element, { transform: nextTransform || null });
    element.dataset.editorModified = '1';
  }

  function shiftElementBy(element, dx, dy) {
    const state = readTransformState(element);
    writeTransformState(element, state.tx + dx, state.ty + dy);
    if (element.dataset.nodeUid) modifiedSlots.add(element.dataset.nodeUid);
  }

  function applyBatchLayout(action) {
    const targets = uniqueConnectedElements(selectedElements).filter((element) => !isLockedElement(element));
    if (!targets.length) return { ok: false, message: '먼저 잠기지 않은 요소를 선택해 주세요.' };
    if (action !== 'reset-transform' && targets.length < 2) return { ok: false, message: '정렬/간격 작업은 2개 이상 선택해야 합니다.' };
    const records = targets.map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const anchor = records[0];

    if (action === 'same-width' || action === 'same-height' || action === 'same-size') {
      for (const record of records.slice(1)) {
        const patch = {};
        if (action === 'same-width' || action === 'same-size') patch.width = `${Math.round(anchor.rect.width)}px`;
        if (action === 'same-height' || action === 'same-size') patch.height = `${Math.round(anchor.rect.height)}px`;
        setInlineStyle(record.element, patch);
        record.element.dataset.editorModified = '1';
        if (record.element.dataset.nodeUid) modifiedSlots.add(record.element.dataset.nodeUid);
      }
      emitState();
      emitMutation(action);
      return { ok: true, message: `선택 요소 ${records.length}개에 ${action} 작업을 적용했습니다.` };
    }

    if (action === 'reset-transform') {
      for (const record of records) {
        writeTransformState(record.element, 0, 0);
      }
      emitState();
      emitMutation(action);
      return { ok: true, message: '선택 요소의 배치 이동을 초기화했습니다.' };
    }

    if (action.startsWith('align-')) {
      const anchorRect = anchor.rect;
      for (const record of records.slice(1)) {
        let dx = 0;
        let dy = 0;
        if (action === 'align-left') dx = anchorRect.left - record.rect.left;
        if (action === 'align-center') dx = (anchorRect.left + anchorRect.width / 2) - (record.rect.left + record.rect.width / 2);
        if (action === 'align-right') dx = (anchorRect.left + anchorRect.width) - (record.rect.left + record.rect.width);
        if (action === 'align-top') dy = anchorRect.top - record.rect.top;
        if (action === 'align-middle') dy = (anchorRect.top + anchorRect.height / 2) - (record.rect.top + record.rect.height / 2);
        if (action === 'align-bottom') dy = (anchorRect.top + anchorRect.height) - (record.rect.top + record.rect.height);
        shiftElementBy(record.element, dx, dy);
      }
      emitState();
      emitMutation(action);
      return { ok: true, message: `선택 요소 ${records.length}개를 정렬했습니다.` };
    }

    if (action === 'distribute-horizontal' || action === 'distribute-vertical') {
      if (records.length < 3) return { ok: false, message: '분배는 3개 이상 선택해야 합니다.' };
      const sorted = [...records].sort((a, b) => action === 'distribute-horizontal' ? a.rect.left - b.rect.left : a.rect.top - b.rect.top);
      if (action === 'distribute-horizontal') {
        const span = (sorted.at(-1).rect.left + sorted.at(-1).rect.width) - sorted[0].rect.left;
        const totalWidth = sorted.reduce((sum, record) => sum + record.rect.width, 0);
        const gap = (span - totalWidth) / (sorted.length - 1);
        let cursor = sorted[0].rect.left;
        for (const record of sorted) {
          const dx = cursor - record.rect.left;
          shiftElementBy(record.element, dx, 0);
          cursor += record.rect.width + gap;
        }
      } else {
        const span = (sorted.at(-1).rect.top + sorted.at(-1).rect.height) - sorted[0].rect.top;
        const totalHeight = sorted.reduce((sum, record) => sum + record.rect.height, 0);
        const gap = (span - totalHeight) / (sorted.length - 1);
        let cursor = sorted[0].rect.top;
        for (const record of sorted) {
          const dy = cursor - record.rect.top;
          shiftElementBy(record.element, 0, dy);
          cursor += record.rect.height + gap;
        }
      }
      emitState();
      emitMutation(action);
      return { ok: true, message: `선택 요소 ${records.length}개를 균등 분배했습니다.` };
    }

    return { ok: false, message: '지원하지 않는 정렬 액션입니다.' };
  }

  function applyTextStyle(patch = {}, { clear = false } = {}) {
    const targets = getTextTargets().filter((element) => !isLockedElement(element));
    if (!targets.length) return { ok: false, message: '텍스트 요소를 먼저 선택해 주세요.' };
    for (const element of targets) {
      const stylePatch = {};
      if (clear || Object.prototype.hasOwnProperty.call(patch, 'fontSize')) stylePatch['font-size'] = clear ? null : (patch.fontSize ? `${patch.fontSize}px` : null);
      if (clear || Object.prototype.hasOwnProperty.call(patch, 'lineHeight')) stylePatch['line-height'] = clear ? null : (patch.lineHeight ? String(patch.lineHeight) : null);
      if (clear || Object.prototype.hasOwnProperty.call(patch, 'letterSpacing')) stylePatch['letter-spacing'] = clear ? null : (patch.letterSpacing ? `${patch.letterSpacing}em` : null);
      if (clear || Object.prototype.hasOwnProperty.call(patch, 'fontWeight')) stylePatch['font-weight'] = clear ? null : (patch.fontWeight || null);
      if (clear || Object.prototype.hasOwnProperty.call(patch, 'color')) stylePatch.color = clear ? null : (patch.color || null);
      if (clear || Object.prototype.hasOwnProperty.call(patch, 'textAlign')) stylePatch['text-align'] = clear ? null : (patch.textAlign || null);
      setInlineStyle(element, stylePatch);
      element.dataset.editorModified = '1';
      if (element.dataset.nodeUid) modifiedSlots.add(element.dataset.nodeUid);
    }
    emitState();
    emitMutation(clear ? 'clear-text-style' : 'apply-text-style');
    return { ok: true, message: clear ? `텍스트 ${targets.length}개의 인라인 스타일을 비웠습니다.` : `텍스트 ${targets.length}개에 스타일을 적용했습니다.` };
  }

  function inspectSlot(slot, slotRecord) {
    const target = findSlotMediaTarget(slot);
    let hasMedia = false;
    let unresolved = false;
    if (target.kind === 'background') {
      const styleValue = (target.element || slot).getAttribute('style') || '';
      hasMedia = /url\(/i.test(styleValue);
      unresolved = !!(target.element || slot).dataset.normalizedUnresolvedImage || /%EB%AF%B8%ED%95%B4%EA%B2%B0|미해결/i.test(styleValue);
    } else {
      const img = target.element || slot.querySelector('img');
      const src = img?.getAttribute('src') || '';
      hasMedia = !!src;
      unresolved = !!img?.dataset?.normalizedUnresolvedImage || /%EB%AF%B8%ED%95%B4%EA%B2%B0|미해결/i.test(src);
    }
    const placeholder = PLACEHOLDER_TEXT_RE.test(placeholderTextValue(slot));
    const explicitEmpty = ['explicit', 'manual'].includes(slotRecord?.type || '') && !hasMedia;
    return { hasMedia, unresolved, placeholder, explicitEmpty };
  }

  function buildPreflightReport() {
    const checks = [];
    const addCheck = (level, code, title, message, count = 0) => checks.push({ level, code, title, message, count });
    const emptySlots = [];
    for (const slotRecord of detection.candidates) {
      const slot = getElementByUid(slotRecord.uid);
      if (!slot || slot.dataset.slotIgnore === '1' || isHiddenElement(slot)) continue;
      const result = inspectSlot(slot, slotRecord);
      if (result.unresolved) {
        // handled below via project assets, keep slot-level info implicit
      }
      if ((result.placeholder && !result.hasMedia) || result.explicitEmpty) {
        emptySlots.push(slotRecord);
      }
    }

    if (emptySlots.length) {
      addCheck('error', 'EMPTY_SLOT', '빈 슬롯', `플레이스홀더만 남아 있거나 실제 이미지가 없는 슬롯이 ${emptySlots.length}개 있습니다.`, emptySlots.length);
    }
    if (project?.summary?.assetsUnresolved) {
      addCheck('error', 'UNRESOLVED_ASSET', '미해결 자산', `정규화 단계에서 연결하지 못한 자산이 ${project.summary.assetsUnresolved}개 있습니다. 폴더 import로 다시 연결하는 편이 안전합니다.`, project.summary.assetsUnresolved);
    }
    if (project?.remoteStylesheets?.length) {
      addCheck('warning', 'REMOTE_STYLESHEET', '원격 폰트/스타일', `원격 stylesheet ${project.remoteStylesheets.length}개가 포함되어 있어 PNG export에서 폰트가 달라질 수 있습니다.`, project.remoteStylesheets.length);
    }
    if (editingTextElement) {
      addCheck('warning', 'TEXT_EDITING', '텍스트 편집 중', '아직 저장되지 않은 텍스트 편집이 열려 있습니다. Enter 또는 텍스트 편집 버튼으로 저장 후 export하는 편이 안전합니다.', 1);
    }
    if (detection.nearMisses?.length) {
      addCheck('info', 'NEAR_MISS', '근접 후보', `자동 슬롯 감지 근접 후보가 ${detection.nearMisses.length}개 있습니다. 수동 슬롯 지정으로 보정할 수 있습니다.`, detection.nearMisses.length);
    }
    const fixtureContract = project?.fixtureMeta?.slot_contract || null;
    if (fixtureContract?.required_exact_count != null && detection.summary.totalCount !== fixtureContract.required_exact_count) {
      addCheck('warning', 'FIXTURE_SLOT_COUNT', 'Fixture 슬롯 수 차이', `현재 슬롯 수 ${detection.summary.totalCount}개가 fixture 기준 ${fixtureContract.required_exact_count}개와 다릅니다.`, Math.abs(detection.summary.totalCount - fixtureContract.required_exact_count));
    } else if (fixtureContract?.required_min_count != null && detection.summary.totalCount < fixtureContract.required_min_count) {
      addCheck('warning', 'FIXTURE_SLOT_MIN', 'Fixture 최소 슬롯 미달', `현재 슬롯 수 ${detection.summary.totalCount}개가 fixture 최소 ${fixtureContract.required_min_count}개보다 적습니다.`, fixtureContract.required_min_count - detection.summary.totalCount);
    }

    return {
      generatedAt: new Date().toISOString(),
      emptySlots,
      checks,
      blockingErrors: checks.filter((item) => item.level === 'error').length,
      warningCount: checks.filter((item) => item.level === 'warning').length,
      infoCount: checks.filter((item) => item.level === 'info').length,
    };
  }

  function buildReport() {
    return {
      selected: selectedInfo,
      selectedItems: selectedElements.map((element) => buildSelectionInfo(element)).filter(Boolean),
      selectionCount: selectedElements.length,
      slotSummary: detection.summary,
      slots: detection.candidates,
      nearMisses: detection.nearMisses,
      modifiedSlotCount: modifiedSlots.size,
      sourceName: project?.sourceName || '',
      sourceType: project?.sourceType || '',
      selectionMode: currentSelectionMode,
      textEditing: !!editingTextElement,
      hiddenCount: buildLayerTree().filter((item) => item.hidden).length,
      lockedCount: buildLayerTree().filter((item) => item.locked).length,
      layerTree: buildLayerTree(),
      textStyle: getTextStyleState(),
      preflight: buildPreflightReport(),
      generatedAt: new Date().toISOString(),
    };
  }

  function persistSlotLabels(exportDoc) {
    for (const slot of detection.candidates) {
      const element = exportDoc.querySelector(`[data-node-uid="${slot.uid}"]`);
      if (!element || element.dataset.slotIgnore === '1') continue;
      if (!element.getAttribute('data-image-slot')) element.setAttribute('data-image-slot', slugify(slot.label || slot.uid));
      if (!element.getAttribute('data-slot-label')) element.setAttribute('data-slot-label', slot.label || slot.uid);
    }
  }

  function serializeEditedHtml({ persistDetectedSlots = true } = {}) {
    const parser = new DOMParser();
    const currentHtml = createDoctypeHtml(doc);
    const exportDoc = parser.parseFromString(currentHtml, 'text/html');

    for (const img of Array.from(exportDoc.querySelectorAll('img'))) {
      if (img.dataset.exportSrc) img.setAttribute('src', img.dataset.exportSrc);
      else if (img.dataset.originalSrc) img.setAttribute('src', img.dataset.originalSrc);
      if (img.dataset.originalSrcset && !img.dataset.exportSrcset) img.setAttribute('srcset', img.dataset.originalSrcset);
      else if (!img.dataset.originalSrcset) img.removeAttribute('srcset');
      img.removeAttribute('sizes');
    }

    for (const source of Array.from(exportDoc.querySelectorAll('source'))) {
      if (source.dataset.originalSrcset) source.setAttribute('srcset', source.dataset.originalSrcset);
    }

    for (const element of Array.from(exportDoc.querySelectorAll('[style]'))) {
      if (element.dataset.exportStyle) element.setAttribute('style', element.dataset.exportStyle);
      else if (element.dataset.originalStyle) element.setAttribute('style', element.dataset.originalStyle);
    }

    for (const styleBlock of Array.from(exportDoc.querySelectorAll('style'))) {
      if (styleBlock.dataset.originalCss) {
        try { styleBlock.textContent = decodeURIComponent(styleBlock.dataset.originalCss); } catch {}
      }
    }

    if (persistDetectedSlots) persistSlotLabels(exportDoc);
    stripFinalEditorRuntime(exportDoc);
    return createDoctypeHtml(exportDoc);
  }

  function buildCurrentExportDoc({ persistDetectedSlots = true } = {}) {
    const parser = new DOMParser();
    const currentHtml = createDoctypeHtml(doc);
    const exportDoc = parser.parseFromString(currentHtml, 'text/html');

    for (const img of Array.from(exportDoc.querySelectorAll('img'))) {
      if (img.dataset.exportSrc) img.setAttribute('src', img.dataset.exportSrc);
      if (img.dataset.exportSrcset) img.setAttribute('srcset', img.dataset.exportSrcset);
      img.removeAttribute('sizes');
    }

    for (const source of Array.from(exportDoc.querySelectorAll('source'))) {
      if (source.dataset.exportSrcset) source.setAttribute('srcset', source.dataset.exportSrcset);
    }

    for (const element of Array.from(exportDoc.querySelectorAll('[style]'))) {
      if (element.dataset.exportStyle) element.setAttribute('style', element.dataset.exportStyle);
    }

    if (persistDetectedSlots) persistSlotLabels(exportDoc);
    stripFinalEditorRuntime(exportDoc);
    return exportDoc;
  }

  async function resolvePortableUrl(url, cache) {
    const value = String(url || '').trim();
    if (!value || value.startsWith('data:') || /^https?:\/\//i.test(value) || value.startsWith('//') || value.startsWith('#')) return value;
    if (!value.startsWith('blob:')) return value;
    if (!cache.has(value)) {
      cache.set(value, (async () => {
        try {
          const response = await fetch(value);
          const blob = await response.blob();
          return await readBlobAsDataUrl(blob);
        } catch {
          return value;
        }
      })());
    }
    return await cache.get(value);
  }

  async function rewriteBlobRefsToPortableUrls(exportDoc) {
    const cache = new Map();

    for (const img of Array.from(exportDoc.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || '';
      if (src) img.setAttribute('src', await resolvePortableUrl(src, cache));
      const srcset = img.getAttribute('srcset') || '';
      if (srcset) {
        const rewritten = [];
        for (const item of parseSrcsetCandidates(srcset)) {
          rewritten.push({ ...item, url: await resolvePortableUrl(item.url, cache) });
        }
        img.setAttribute('srcset', serializeSrcsetCandidates(rewritten));
      }
    }

    for (const source of Array.from(exportDoc.querySelectorAll('source[srcset]'))) {
      const items = [];
      for (const item of parseSrcsetCandidates(source.getAttribute('srcset') || '')) {
        items.push({ ...item, url: await resolvePortableUrl(item.url, cache) });
      }
      source.setAttribute('srcset', serializeSrcsetCandidates(items));
    }

    for (const element of Array.from(exportDoc.querySelectorAll('[style]'))) {
      const styleValue = element.getAttribute('style') || '';
      if (!styleValue.includes('url(')) continue;
      const matches = Array.from(styleValue.matchAll(FRAME_CSS_URL_RE));
      let nextStyle = styleValue;
      for (const match of matches) {
        const replacement = await resolvePortableUrl(match[2], cache);
        nextStyle = nextStyle.replace(match[2], replacement);
      }
      element.setAttribute('style', nextStyle);
    }

    for (const styleBlock of Array.from(exportDoc.querySelectorAll('style'))) {
      const css = styleBlock.textContent || '';
      if (!css.includes('url(')) continue;
      const matches = Array.from(css.matchAll(FRAME_CSS_URL_RE));
      let nextCss = css;
      for (const match of matches) {
        const replacement = await resolvePortableUrl(match[2], cache);
        nextCss = nextCss.replace(match[2], replacement);
      }
      styleBlock.textContent = nextCss;
    }
  }

  function measureExportRoot() {
    const root = doc.querySelector('.page') || doc.body.firstElementChild || doc.body;
    const docRect = doc.documentElement.getBoundingClientRect();
    const rect = root.getBoundingClientRect();
    return {
      root,
      x: Math.max(0, Math.round(rect.left - docRect.left)),
      y: Math.max(0, Math.round(rect.top - docRect.top)),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
      fullWidth: Math.max(Math.ceil(doc.documentElement.scrollWidth || rect.width), Math.ceil(rect.left - docRect.left + rect.width)),
      fullHeight: Math.max(Math.ceil(doc.documentElement.scrollHeight || rect.height), Math.ceil(rect.top - docRect.top + rect.height)),
    };
  }

  async function renderHtmlToCanvas(html, { fullWidth, fullHeight, crop, scale = 1 }) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.documentElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const serialized = new XMLSerializer().serializeToString(parsed.documentElement);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}" viewBox="0 0 ${crop.width} ${crop.height}">
        <foreignObject x="${-crop.x}" y="${-crop.y}" width="${fullWidth}" height="${fullHeight}">${serialized}</foreignObject>
      </svg>`;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('SVG 렌더 이미지 생성 실패'));
      img.src = svgUrl;
    });
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(svgUrl);
    return canvas;
  }

  async function exportFullPngBlob(scale = 1.5) {
    const exportDoc = buildCurrentExportDoc({ persistDetectedSlots: false });
    await rewriteBlobRefsToPortableUrls(exportDoc);
    const metrics = measureExportRoot();
    const canvas = await renderHtmlToCanvas(createDoctypeHtml(exportDoc), {
      fullWidth: metrics.fullWidth,
      fullHeight: metrics.fullHeight,
      crop: { x: metrics.x, y: metrics.y, width: metrics.width, height: metrics.height },
      scale,
    });
    return await canvasToBlob(canvas, 'image/png');
  }

  function collectSectionRects() {
    const metrics = measureExportRoot();
    const docRect = doc.documentElement.getBoundingClientRect();
    let candidates = Array.from(metrics.root.children || []).filter((element) => {
      if (!isElement(element)) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return false;
      return element.tagName === 'SECTION' || element.classList.contains('section') || element.classList.contains('hero') || element.classList.contains('hb-info-wrap') || element.hasAttribute('data-export-section');
    });
    if (!candidates.length) {
      candidates = Array.from(metrics.root.querySelectorAll('section, .hb-info-wrap')).filter((element) => isElement(element));
    }
    return candidates.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const crop = {
        x: Math.max(0, Math.round(rect.left - docRect.left)),
        y: Math.max(0, Math.round(rect.top - docRect.top)),
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
      };
      const rawName = buildLabel(element) || element.id || element.className || element.tagName.toLowerCase();
      return {
        crop,
        name: `${String(index + 1).padStart(3, '0')}_${sanitizeFilename(slugify(rawName) || 'section')}.png`,
      };
    });
  }

  async function exportSectionPngEntries(scale = 1.5) {
    const exportDoc = buildCurrentExportDoc({ persistDetectedSlots: false });
    await rewriteBlobRefsToPortableUrls(exportDoc);
    const metrics = measureExportRoot();
    const html = createDoctypeHtml(exportDoc);
    const sections = collectSectionRects();
    const entries = [];
    for (const section of sections) {
      // eslint-disable-next-line no-await-in-loop
      const canvas = await renderHtmlToCanvas(html, {
        fullWidth: metrics.fullWidth,
        fullHeight: metrics.fullHeight,
        crop: section.crop,
        scale,
      });
      // eslint-disable-next-line no-await-in-loop
      const blob = await canvasToBlob(canvas, 'image/png');
      // eslint-disable-next-line no-await-in-loop
      entries.push({ name: section.name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    return entries;
  }

  async function buildLinkedPackageEntries() {
    const exportDoc = buildCurrentExportDoc({ persistDetectedSlots: true });
    await rewriteBlobRefsToPortableUrls(exportDoc);
    const assetEntries = [];
    const assetPathMap = new Map();

    async function materializeUrl(url, hint = 'asset') {
      const value = String(url || '').trim();
      if (!value || !value.startsWith('data:')) return value;
      if (assetPathMap.has(value)) return assetPathMap.get(value);
      const response = await fetch(value);
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const ext = guessExtensionFromMime(blob.type, '.bin');
      const name = `assets/${String(assetEntries.length + 1).padStart(3, '0')}_${sanitizeFilename(slugify(hint) || 'asset')}${ext}`;
      assetEntries.push({ name, data: bytes });
      assetPathMap.set(value, name);
      return name;
    }

    for (const img of Array.from(exportDoc.querySelectorAll('img'))) {
      const hint = buildLabel(img.parentElement || img);
      const src = img.getAttribute('src') || '';
      if (src.startsWith('data:')) img.setAttribute('src', await materializeUrl(src, hint));
      const srcset = img.getAttribute('srcset') || '';
      if (srcset) {
        const rewritten = [];
        for (const item of parseSrcsetCandidates(srcset)) {
          rewritten.push({ ...item, url: await materializeUrl(item.url, hint) });
        }
        img.setAttribute('srcset', serializeSrcsetCandidates(rewritten));
      }
    }

    for (const source of Array.from(exportDoc.querySelectorAll('source[srcset]'))) {
      const hint = buildLabel(source.parentElement || source);
      const rewritten = [];
      for (const item of parseSrcsetCandidates(source.getAttribute('srcset') || '')) {
        rewritten.push({ ...item, url: await materializeUrl(item.url, hint) });
      }
      source.setAttribute('srcset', serializeSrcsetCandidates(rewritten));
    }

    for (const element of Array.from(exportDoc.querySelectorAll('[style]'))) {
      const styleValue = element.getAttribute('style') || '';
      if (!styleValue.includes('url(')) continue;
      const matches = Array.from(styleValue.matchAll(FRAME_CSS_URL_RE));
      let nextStyle = styleValue;
      for (const match of matches) {
        const replacement = await materializeUrl(match[2], buildLabel(element));
        nextStyle = nextStyle.replace(match[2], replacement);
      }
      element.setAttribute('style', nextStyle);
    }

    for (const styleBlock of Array.from(exportDoc.querySelectorAll('style'))) {
      const css = styleBlock.textContent || '';
      if (!css.includes('url(')) continue;
      const matches = Array.from(css.matchAll(FRAME_CSS_URL_RE));
      let nextCss = css;
      for (const match of matches) {
        const replacement = await materializeUrl(match[2], 'style');
        nextCss = nextCss.replace(match[2], replacement);
      }
      styleBlock.textContent = nextCss;
    }

    const baseName = sanitizeFilename(project?.sourceName?.replace(/\.html?$/i, '') || 'detail-page');
    const html = createDoctypeHtml(exportDoc);
    return [
      { name: `${baseName}__linked.html`, data: new TextEncoder().encode(html) },
      ...assetEntries,
    ];
  }

  function captureSnapshot(label = 'snapshot') {
    const parser = new DOMParser();
    const currentHtml = createDoctypeHtml(doc);
    const snapshotDoc = parser.parseFromString(currentHtml, 'text/html');
    stripTransientRuntime(snapshotDoc);
    return {
      label,
      html: createDoctypeHtml(snapshotDoc),
      selectedUid: selectedInfo?.uid || '',
      selectedUids: selectedElements.map((element) => element.dataset.nodeUid).filter(Boolean),
      selectionMode: currentSelectionMode,
      savedAt: new Date().toISOString(),
    };
  }

  function beginMoveDrag(target, event) {
    if (!target || isLockedElement(target)) return false;
    if (!selectedElements.some((element) => element.dataset.nodeUid === target.dataset.nodeUid)) {
      selectElements([target], { silent: true });
    }
    const elements = uniqueConnectedElements(selectedElements).filter((element) => !isLockedElement(element));
    if (!elements.length) return false;
    const snapshots = elements.map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      transform: readTransformState(element),
    }));
    const union = unionRect(snapshots.map((item) => item.rect));
    const excluded = new Set(elements.map((element) => element.dataset.nodeUid));
    dragState = {
      mode: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      snapshots,
      union,
      snapCandidates: buildSnapCandidates(excluded),
    };
    return true;
  }

  function beginMarqueeDrag(event) {
    dragState = {
      mode: 'marquee',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      additive: !!(event.ctrlKey || event.metaKey || event.shiftKey),
      seedSelection: uniqueConnectedElements(selectedElements),
    };
    return true;
  }

  function updateMarqueeSelection(endX, endY) {
    if (!dragState || dragState.mode !== 'marquee') return;
    const rect = normalizeClientRect(dragState.startX, dragState.startY, endX, endY);
    showMarqueeRect(rect);
    const hits = collectInteractiveLayers()
      .filter((element) => !isLockedElement(element) && !isHiddenElement(element))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && rectIntersects(box, rect);
      });
    const next = dragState.additive ? uniqueConnectedElements([...dragState.seedSelection, ...hits]) : uniqueConnectedElements(hits);
    selectElements(next, { silent: true });
  }

  function updateMoveDrag(clientX, clientY) {
    if (!dragState || dragState.mode !== 'move') return;
    const rawDx = clientX - dragState.startX;
    const rawDy = clientY - dragState.startY;
    const snapped = computeSnapAdjustment(dragState.union, rawDx, rawDy, dragState.snapCandidates);
    for (const item of dragState.snapshots) {
      writeTransformState(item.element, item.transform.tx + snapped.dx, item.transform.ty + snapped.dy);
    }
    showSnapLines({ x: snapped.guideX, y: snapped.guideY });
    doc.documentElement.classList.add('__phase6_dragging_cursor');
    doc.body.classList.add('__phase6_dragging_cursor');
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || editingTextElement) return;
    const target = resolveSelectionTarget(event.target);
    if (event.shiftKey && !target) {
      beginMarqueeDrag(event);
      return;
    }
    if (event.shiftKey && target) {
      beginMarqueeDrag(event);
      return;
    }
    if (!target) return;
    if (isLockedElement(target)) {
      onStatus('잠긴 레이어는 캔버스에서 직접 편집할 수 없습니다. 레이어 패널에서 잠금을 해제해 주세요.');
      return;
    }
    beginMoveDrag(target, event);
  }

  function handlePointerMove(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < 3) return;
    dragState.moved = true;
    event.preventDefault();
    if (dragState.mode === 'marquee') updateMarqueeSelection(event.clientX, event.clientY);
    else if (dragState.mode === 'move') updateMoveDrag(event.clientX, event.clientY);
  }

  function finishPointerDrag(event) {
    if (!dragState || (event && dragState.pointerId !== event.pointerId)) return;
    const finished = dragState;
    dragState = null;
    hideInteractionOverlay();
    if (!finished.moved) return;
    suppressClickUntil = Date.now() + 220;
    if (finished.mode === 'move') {
      emitState();
      emitMutation('drag-move');
      onStatus(`선택 요소 ${finished.snapshots.length}개를 드래그 이동했습니다.`);
    } else if (finished.mode === 'marquee') {
      emitState();
      onStatus(`드래그로 ${selectedElements.length}개 레이어를 선택했습니다.`);
    }
  }

  function handleDocClick(event) {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (editingTextElement && !editingTextElement.contains(event.target)) {
      finishTextEdit({ commit: true, emit: true });
    }
    const target = resolveSelectionTarget(event.target);
    if (!target) return;
    const anchor = closestElement(event.target)?.closest?.('a[href]');
    if (anchor) event.preventDefault();
    selectElement(target, {
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      toggle: event.ctrlKey || event.metaKey,
    });
  }

  function handleDocDoubleClick(event) {
    const target = resolveSelectionTarget(event.target);
    if (!target) return;
    const result = startTextEdit(target);
    if (result.ok) {
      event.preventDefault();
      onStatus(result.message);
    }
  }

  function handleKeydown(event) {
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && !event.altKey) {
      const key = String(event.key || '').toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        onShortcut(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        onShortcut('redo');
        return;
      }
      if (key === 's') {
        event.preventDefault();
        onShortcut('save-edited');
        return;
      }
    }
    if (!editingTextElement) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onStatus(finishTextEdit({ commit: false }).message);
      return;
    }
    if (withModifier && event.key === 'Enter') {
      event.preventDefault();
      onStatus(finishTextEdit({ commit: true }).message);
    }
  }

  function handleDragOver(event) {
    if (!event.dataTransfer?.types) return;
    const hasFiles = Array.from(event.dataTransfer.types).includes('Files');
    if (!hasFiles) return;
    const slot = (closestElement(event.target)?.closest?.('[data-detected-slot], [data-image-slot], .image-slot, .drop-slot')) || getSelectedSlotElement();
    if (!slot || isLockedElement(slot)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (hoverSlot !== slot) {
      clearHover();
      hoverSlot = slot;
      hoverSlot.classList.add('__phase5_drop_hover');
    }
  }

  async function handleDrop(event) {
    if (!event.dataTransfer?.files?.length) return;
    const slot = (closestElement(event.target)?.closest?.('[data-detected-slot], [data-image-slot], .image-slot, .drop-slot')) || getSelectedSlotElement();
    if (!slot || isLockedElement(slot)) return;
    event.preventDefault();
    clearHover();
    await applyFilesStartingAtSlot(slot, Array.from(event.dataTransfer.files));
  }

  function handleDragLeave() {
    clearHover();
  }

  doc.addEventListener('click', handleDocClick, true);
  doc.addEventListener('dblclick', handleDocDoubleClick, true);
  doc.addEventListener('keydown', handleKeydown, true);
  doc.addEventListener('pointerdown', handlePointerDown, true);
  doc.addEventListener('pointermove', handlePointerMove, true);
  doc.addEventListener('pointerup', finishPointerDrag, true);
  doc.addEventListener('pointercancel', finishPointerDrag, true);
  doc.addEventListener('dragover', handleDragOver, true);
  doc.addEventListener('drop', handleDrop, true);
  doc.addEventListener('dragleave', handleDragLeave, true);

  rehydratePersistentState();
  hideInteractionOverlay();
  redetect({ preserveSelectionUids: initialSnapshot?.selectedUids || [] });

  return {
    setSelectionMode,
    redetect,
    refreshDerivedMeta,
    selectNodeByUid(uid, { additive = false, toggle = false, scroll = false } = {}) {
      const element = getElementByUid(uid);
      if (!element) return false;
      selectElement(element, { additive, toggle });
      if (scroll) element.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      return true;
    },
    selectSlotByUid(uid) {
      return this.selectNodeByUid(uid, { additive: false, toggle: false, scroll: true });
    },
    async applyFiles(files) {
      const slot = getSelectedSlotElement();
      if (!slot) {
        onStatus('먼저 이미지 슬롯을 선택해 주세요.');
        return 0;
      }
      return await applyFilesStartingAtSlot(slot, files);
    },
    applyImagePreset,
    removeImageFromSelected,
    markSelectedAsSlot,
    demoteSelectedSlot,
    toggleSelectedHidden,
    toggleSelectedLocked,
    toggleLayerHiddenByUid,
    toggleLayerLockedByUid,
    toggleTextEdit,
    applyTextStyle,
    applyBatchLayout,
    getEditedHtml: serializeEditedHtml,
    getCurrentPortableHtml: async () => {
      const exportDoc = buildCurrentExportDoc({ persistDetectedSlots: true });
      await rewriteBlobRefsToPortableUrls(exportDoc);
      return createDoctypeHtml(exportDoc);
    },
    async getLinkedPackageEntries() {
      return await buildLinkedPackageEntries();
    },
    async exportFullPngBlob(scale = 1.5) {
      return await exportFullPngBlob(scale);
    },
    async exportSectionPngEntries(scale = 1.5) {
      return await exportSectionPngEntries(scale);
    },
    captureSnapshot,
    getReport: buildReport,
    getPreflightReport: buildPreflightReport,
    getMeta() {
      return getDerivedMeta();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (editingTextElement) finishTextEdit({ commit: false, emit: false });
      doc.removeEventListener('click', handleDocClick, true);
      doc.removeEventListener('dblclick', handleDocDoubleClick, true);
      doc.removeEventListener('keydown', handleKeydown, true);
      doc.removeEventListener('pointerdown', handlePointerDown, true);
      doc.removeEventListener('pointermove', handlePointerMove, true);
      doc.removeEventListener('pointerup', finishPointerDrag, true);
      doc.removeEventListener('pointercancel', finishPointerDrag, true);
      doc.removeEventListener('dragover', handleDragOver, true);
      doc.removeEventListener('drop', handleDrop, true);
      doc.removeEventListener('dragleave', handleDragLeave, true);
      clearHover();
      hideInteractionOverlay();
      clearSelectionClasses();
    },
  };
}
