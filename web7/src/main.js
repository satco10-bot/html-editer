import { FIXTURE_MANIFEST, FIXTURE_SOURCE_MAP, getFixtureMeta } from './fixture-bundle.js';
import { AUTOSAVE_KEY, EXPORT_PRESETS, HISTORY_LIMIT, getExportPresetById } from './config.js';
import { createImportFileIndex, choosePrimaryHtmlEntry } from './core/asset-resolver.js';
import { normalizeProject } from './core/normalize-project.js';
import { createProjectStore } from './core/project-store.js';
import { createFrameEditor } from './editor/frame-editor.js';
import {
  renderAssetTable,
  renderIssueList,
  renderLayerTree,
  renderLocalModeNotice,
  renderNormalizeStats,
  renderPreflight,
  renderProjectMeta,
  renderSelectionInspector,
  renderSlotList,
  renderSummaryCards,
} from './ui/renderers.js';
import { buildZipBlob, downloadBlob, downloadTextFile, sanitizeFilename } from './utils.js';

const store = createProjectStore();
let activeEditor = null;
let mountedProjectId = '';
let pendingMountOptions = null;
let currentExportPresetId = 'market';
let currentCodeSource = 'edited';
let codeEditorDirty = false;
const zoomState = { mode: 'fit', value: 1 };

const historyState = {
  undoStack: [],
  redoStack: [],
};

const elements = {
  fixtureSelect: document.getElementById('fixtureSelect'),
  openHtmlButton: document.getElementById('openHtmlButton'),
  openFolderButton: document.getElementById('openFolderButton'),
  loadFixtureButton: document.getElementById('loadFixtureButton'),
  applyPasteButton: document.getElementById('applyPasteButton'),
  replaceImageButton: document.getElementById('replaceImageButton'),
  manualSlotButton: document.getElementById('manualSlotButton'),
  demoteSlotButton: document.getElementById('demoteSlotButton'),
  toggleHideButton: document.getElementById('toggleHideButton'),
  toggleLockButton: document.getElementById('toggleLockButton'),
  redetectButton: document.getElementById('redetectButton'),
  textEditButton: document.getElementById('textEditButton'),
  undoButton: document.getElementById('undoButton'),
  redoButton: document.getElementById('redoButton'),
  restoreAutosaveButton: document.getElementById('restoreAutosaveButton'),
  downloadEditedButton: document.getElementById('downloadEditedButton'),
  downloadNormalizedButton: document.getElementById('downloadNormalizedButton'),
  downloadLinkedZipButton: document.getElementById('downloadLinkedZipButton'),
  exportPngButton: document.getElementById('exportPngButton'),
  exportSectionsZipButton: document.getElementById('exportSectionsZipButton'),
  exportPresetSelect: document.getElementById('exportPresetSelect'),
  exportScaleSelect: document.getElementById('exportScaleSelect'),
  exportPresetPackageButton: document.getElementById('exportPresetPackageButton'),
  downloadReportButton: document.getElementById('downloadReportButton'),
  htmlFileInput: document.getElementById('htmlFileInput'),
  folderInput: document.getElementById('folderInput'),
  replaceImageInput: document.getElementById('replaceImageInput'),
  htmlPasteInput: document.getElementById('htmlPasteInput'),
  summaryCards: document.getElementById('summaryCards'),
  issueList: document.getElementById('issueList'),
  normalizeStats: document.getElementById('normalizeStats'),
  selectionInspector: document.getElementById('selectionInspector'),
  slotList: document.getElementById('slotList'),
  layerTree: document.getElementById('layerTree'),
  layerFilterInput: document.getElementById('layerFilterInput'),
  preflightContainer: document.getElementById('preflightContainer'),
  preflightRefreshButton: document.getElementById('preflightRefreshButton'),
  assetTableWrap: document.getElementById('assetTableWrap'),
  assetFilterInput: document.getElementById('assetFilterInput'),
  previewFrame: document.getElementById('previewFrame'),
  editedCodeView: document.getElementById('editedCodeView'),
  normalizedCodeView: document.getElementById('normalizedCodeView'),
  originalCodeView: document.getElementById('originalCodeView'),
  jsonReportView: document.getElementById('jsonReportView'),
  projectMeta: document.getElementById('projectMeta'),
  statusText: document.getElementById('statusText'),
  localModeNotice: document.getElementById('localModeNotice'),
  textStyleSummary: document.getElementById('textStyleSummary'),
  textFontSizeInput: document.getElementById('textFontSizeInput'),
  textLineHeightInput: document.getElementById('textLineHeightInput'),
  textLetterSpacingInput: document.getElementById('textLetterSpacingInput'),
  textWeightSelect: document.getElementById('textWeightSelect'),
  textColorInput: document.getElementById('textColorInput'),
  applyTextStyleButton: document.getElementById('applyTextStyleButton'),
  clearTextStyleButton: document.getElementById('clearTextStyleButton'),
  batchSelectionSummary: document.getElementById('batchSelectionSummary'),
  toggleLeftSidebarButton: document.getElementById('toggleLeftSidebarButton'),
  toggleRightSidebarButton: document.getElementById('toggleRightSidebarButton'),
  focusModeButton: document.getElementById('focusModeButton'),
  zoomOutButton: document.getElementById('zoomOutButton'),
  zoomInButton: document.getElementById('zoomInButton'),
  zoomResetButton: document.getElementById('zoomResetButton'),
  zoomFitButton: document.getElementById('zoomFitButton'),
  zoomLabel: document.getElementById('zoomLabel'),
  previewViewport: document.getElementById('previewViewport'),
  previewScaler: document.getElementById('previewScaler'),
  codeEditorTextarea: document.getElementById('codeEditorTextarea'),
  codeSearchInput: document.getElementById('codeSearchInput'),
  codeSearchNextButton: document.getElementById('codeSearchNextButton'),
  reloadCodeFromEditorButton: document.getElementById('reloadCodeFromEditorButton'),
  applyCodeToEditorButton: document.getElementById('applyCodeToEditorButton'),
  codeSourceButtons: Array.from(document.querySelectorAll('[data-code-source]')),
  sidebarTabButtons: Array.from(document.querySelectorAll('[data-sidebar-tab]')),
  sidebarPanels: Array.from(document.querySelectorAll('[data-sidebar-panel]')),
  viewButtons: Array.from(document.querySelectorAll('[data-view]')),
  viewPanels: Array.from(document.querySelectorAll('[data-stage-view]')),
  selectionModeButtons: Array.from(document.querySelectorAll('[data-selection-mode]')),
  presetButtons: Array.from(document.querySelectorAll('[data-preset]')),
  actionButtons: Array.from(document.querySelectorAll('[data-action]')),
  batchActionButtons: Array.from(document.querySelectorAll('[data-batch-action]')),
  textAlignButtons: Array.from(document.querySelectorAll('[data-text-align]')),
};

function projectBaseName(project) {
  return sanitizeFilename((project?.sourceName || 'detail-page').replace(/\.html?$/i, '') || 'detail-page');
}

function exportScale() {
  const value = Number.parseFloat(elements.exportScaleSelect?.value || '1.5');
  return Number.isFinite(value) && value > 0 ? value : 1.5;
}

function setStatus(text) {
  store.setStatus(text);
}

function setView(nextView) {
  store.setView(nextView);
}

function populateFixtureSelect() {
  elements.fixtureSelect.innerHTML = FIXTURE_MANIFEST.fixtures
    .map((fixture) => `<option value="${fixture.id}">${fixture.id} · ${fixture.name}</option>`)
    .join('');
  elements.fixtureSelect.value = 'F05';
}

function populateExportPresetSelect() {
  elements.exportPresetSelect.innerHTML = EXPORT_PRESETS
    .map((preset) => `<option value="${preset.id}">${preset.label}</option>`)
    .join('');
  elements.exportPresetSelect.value = currentExportPresetId;
}

function currentExportPreset() {
  return getExportPresetById(currentExportPresetId);
}

function setSidebarTab(panelId) {
  for (const button of elements.sidebarTabButtons) {
    button.classList.toggle('is-active', button.dataset.sidebarTab === panelId);
  }
  for (const panel of elements.sidebarPanels) {
    panel.classList.toggle('is-active', panel.dataset.sidebarPanel === panelId);
  }
}

function setCodeSource(nextSource, { preserveDraft = true } = {}) {
  currentCodeSource = nextSource || 'edited';
  for (const button of elements.codeSourceButtons) {
    button.classList.toggle('is-active', button.dataset.codeSource === currentCodeSource);
  }
  if (!preserveDraft) codeEditorDirty = false;
  refreshCodeEditorFromState({ force: !preserveDraft });
}

function currentProjectHtmlText(state) {
  const project = state?.project || null;
  if (!project) return '';
  if (currentCodeSource === 'normalized') return project.normalizedHtml || '';
  if (currentCodeSource === 'original') return project.originalHtml || '';
  if (currentCodeSource === 'report') return JSON.stringify(buildReportPayload(project, getEditorReport(project)), null, 2);
  return elements.editedCodeView?.textContent || '';
}

function refreshCodeEditorFromState({ force = false } = {}) {
  if (!elements.codeEditorTextarea) return;
  const textarea = elements.codeEditorTextarea;
  if (codeEditorDirty && !force && document.activeElement === textarea) return;
  const nextValue = currentProjectHtmlText(store.getState());
  textarea.value = nextValue;
  textarea.readOnly = currentCodeSource === 'report';
  codeEditorDirty = false;
}

function getCanvasIntrinsicWidth() {
  const doc = elements.previewFrame?.contentDocument;
  return Math.max(860, doc?.documentElement?.scrollWidth || 0, doc?.body?.scrollWidth || 0);
}

function applyPreviewZoom() {
  const viewport = elements.previewViewport;
  const scaler = elements.previewScaler;
  if (!viewport || !scaler) return;
  const intrinsic = getCanvasIntrinsicWidth();
  scaler.style.width = `${intrinsic}px`;
  const fitScale = Math.max(0.35, Math.min(2.25, (viewport.clientWidth - 32) / intrinsic));
  const scale = zoomState.mode === 'fit' ? fitScale : zoomState.value;
  scaler.style.setProperty('--preview-scale', String(scale));
  if (elements.zoomLabel) elements.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  if (elements.zoomFitButton) elements.zoomFitButton.classList.toggle('is-active', zoomState.mode === 'fit');
}

function setZoom(mode, value = null) {
  if (mode === 'fit') {
    zoomState.mode = 'fit';
  } else {
    zoomState.mode = 'manual';
    const next = Number.isFinite(value) ? value : zoomState.value;
    zoomState.value = Math.max(0.35, Math.min(2.25, next));
  }
  applyPreviewZoom();
}

function nudgeZoom(delta) {
  const current = zoomState.mode === 'fit' ? Number.parseFloat((elements.zoomLabel?.textContent || '100').replace('%', '')) / 100 : zoomState.value;
  setZoom('manual', current + delta);
}

function syncWorkspaceButtons() {
  document.body.classList.toggle('layout--left-collapsed', document.body.classList.contains('layout--left-collapsed'));
  document.body.classList.toggle('layout--right-collapsed', document.body.classList.contains('layout--right-collapsed'));
  if (elements.toggleLeftSidebarButton) elements.toggleLeftSidebarButton.classList.toggle('is-active', !document.body.classList.contains('layout--left-collapsed'));
  if (elements.toggleRightSidebarButton) elements.toggleRightSidebarButton.classList.toggle('is-active', !document.body.classList.contains('layout--right-collapsed'));
  if (elements.focusModeButton) elements.focusModeButton.classList.toggle('is-active', document.body.classList.contains('layout--focus-stage'));
}

function syncExportPresetUi({ forceScale = false } = {}) {
  const preset = currentExportPreset();
  if (elements.exportPresetSelect.value !== preset.id) elements.exportPresetSelect.value = preset.id;
  const scaleValue = String(preset.scale);
  const shouldSyncScale = forceScale || elements.exportScaleSelect.dataset.boundPreset !== preset.id;
  if (shouldSyncScale && Array.from(elements.exportScaleSelect.options).some((option) => option.value === scaleValue)) {
    elements.exportScaleSelect.value = scaleValue;
    elements.exportScaleSelect.dataset.boundPreset = preset.id;
  }
  if (elements.exportPresetPackageButton) elements.exportPresetPackageButton.title = preset.description || '';
}

function setSelectionMode(nextMode) {
  store.setSelectionMode(nextMode);
  activeEditor?.setSelectionMode(nextMode);
}

function renderViewButtons(currentView) {
  for (const button of elements.viewButtons) {
    button.classList.toggle('is-active', button.dataset.view === currentView);
  }
  for (const panel of elements.viewPanels) {
    panel.hidden = panel.dataset.stageView !== currentView;
  }
}

function renderSelectionModeButtons(currentMode) {
  for (const button of elements.selectionModeButtons) {
    button.classList.toggle('is-active', button.dataset.selectionMode === currentMode);
  }
}

function renderTextAlignButtons(currentAlign, enabled) {
  for (const button of elements.textAlignButtons) {
    button.classList.toggle('is-active', enabled && button.dataset.textAlign === currentAlign);
    button.disabled = !enabled;
  }
}

function readAutosavePayload() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistAutosave(snapshot) {
  const project = store.getState().project;
  if (!project || !snapshot) return;
  const payload = {
    savedAt: new Date().toISOString(),
    sourceName: project.sourceName,
    sourceType: project.sourceType,
    fixtureId: project.fixtureId || '',
    snapshot,
  };
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
  } catch {}
}

function refreshHistoryButtons() {
  const hasProject = !!store.getState().project;
  if (elements.undoButton) elements.undoButton.disabled = !hasProject || historyState.undoStack.length <= 1;
  if (elements.redoButton) elements.redoButton.disabled = !hasProject || historyState.redoStack.length === 0;
  if (elements.restoreAutosaveButton) elements.restoreAutosaveButton.disabled = !readAutosavePayload();
}

function resetHistory() {
  historyState.undoStack = [];
  historyState.redoStack = [];
  refreshHistoryButtons();
}

function recordHistorySnapshot(snapshot, { clearRedo = true } = {}) {
  if (!snapshot?.html) return;
  const last = historyState.undoStack.at(-1);
  if (last && last.html === snapshot.html && last.selectedUid === snapshot.selectedUid && last.selectionMode === snapshot.selectionMode) {
    persistAutosave(snapshot);
    refreshHistoryButtons();
    return;
  }
  historyState.undoStack.push(snapshot);
  if (historyState.undoStack.length > HISTORY_LIMIT) historyState.undoStack.shift();
  if (clearRedo) historyState.redoStack = [];
  persistAutosave(snapshot);
  refreshHistoryButtons();
}

function restoreHistorySnapshot(snapshot, label) {
  const project = store.getState().project;
  if (!project || !snapshot) return;
  mountProject(project, { snapshot, preserveHistory: true, force: true });
  setStatus(label);
}

function undoHistory() {
  if (historyState.undoStack.length <= 1) {
    setStatus('되돌릴 작업이 없습니다.');
    return;
  }
  const current = historyState.undoStack.pop();
  historyState.redoStack.push(current);
  const previous = historyState.undoStack.at(-1);
  refreshHistoryButtons();
  restoreHistorySnapshot(previous, '이전 작업으로 되돌렸습니다.');
}

function redoHistory() {
  if (!historyState.redoStack.length) {
    setStatus('다시 적용할 작업이 없습니다.');
    return;
  }
  const next = historyState.redoStack.pop();
  historyState.undoStack.push(next);
  refreshHistoryButtons();
  restoreHistorySnapshot(next, '되돌린 작업을 다시 적용했습니다.');
}

function buildReportPayload(project, report) {
  return {
    project: {
      id: project.id,
      fixtureId: project.fixtureId,
      sourceName: project.sourceName,
      sourceType: project.sourceType,
    },
    report,
    history: {
      undoDepth: historyState.undoStack.length,
      redoDepth: historyState.redoStack.length,
      autosaveSavedAt: readAutosavePayload()?.savedAt || '',
    },
    summary: project.summary,
    issues: project.issues,
    assets: project.assets,
    preflight: report.preflight || null,
  };
}

function getEditorReport(project) {
  if (activeEditor) return activeEditor.getReport();
  return {
    sourceName: project.sourceName,
    sourceType: project.sourceType,
    slotSummary: project.slotDetection?.summary || project.summary,
    slots: project.slotDetection?.candidates || [],
    nearMisses: project.slotDetection?.nearMisses || [],
    modifiedSlotCount: 0,
    layerTree: [],
    selectedItems: [],
    selectionCount: 0,
    generatedAt: new Date().toISOString(),
  };
}

function refreshComputedViews(state) {
  const project = state.project;
  if (elements.normalizedCodeView) elements.normalizedCodeView.textContent = project?.normalizedHtml || '';
  if (elements.originalCodeView) elements.originalCodeView.textContent = project?.originalHtml || '';

  if (!project) {
    if (elements.editedCodeView) elements.editedCodeView.textContent = '';
    if (elements.jsonReportView) elements.jsonReportView.textContent = '';
    refreshCodeEditorFromState({ force: true });
    return;
  }

  const editedHtml = activeEditor ? activeEditor.getEditedHtml({ persistDetectedSlots: true }) : project.normalizedHtml;
  if (elements.editedCodeView) elements.editedCodeView.textContent = editedHtml;
  const report = getEditorReport(project);
  if (elements.jsonReportView) elements.jsonReportView.textContent = JSON.stringify(buildReportPayload(project, report), null, 2);
  refreshCodeEditorFromState();
}

function syncTextStyleControls(editorMeta) {
  const style = editorMeta?.textStyle || null;
  const enabled = !!style?.enabled;
  const inputs = [
    elements.textFontSizeInput,
    elements.textLineHeightInput,
    elements.textLetterSpacingInput,
    elements.textWeightSelect,
    elements.textColorInput,
    elements.applyTextStyleButton,
    elements.clearTextStyleButton,
  ];
  for (const input of inputs) {
    if (!input) continue;
    input.disabled = !enabled;
  }
  renderTextAlignButtons(style?.textAlign || '', enabled);
  elements.textStyleSummary.textContent = enabled
    ? `텍스트 ${style.targetCount || 1}개 선택`
    : '텍스트 미선택';

  elements.textFontSizeInput.value = enabled && style.fontSize ? String(style.fontSize) : '';
  elements.textLineHeightInput.value = enabled && style.lineHeight ? String(style.lineHeight) : '';
  elements.textLetterSpacingInput.value = enabled && style.letterSpacing ? String(style.letterSpacing) : '';
  elements.textWeightSelect.value = enabled && style.fontWeight ? String(style.fontWeight) : '';
  elements.textColorInput.value = enabled && style.color ? style.color : '#333333';
}

function syncBatchSummary(editorMeta) {
  const count = Number(editorMeta?.selectionCount || 0);
  elements.batchSelectionSummary.textContent = count > 1 ? `${count}개 동시 선택` : '1개 이하 선택';
}

function renderShell(state) {
  renderViewButtons(state.currentView);
  renderSelectionModeButtons(state.selectionMode);
  renderSummaryCards(elements.summaryCards, state.project, state.editorMeta);
  renderIssueList(elements.issueList, state.project);
  renderNormalizeStats(elements.normalizeStats, state.project);
  renderPreflight(elements.preflightContainer, state.editorMeta);
  renderSelectionInspector(elements.selectionInspector, state.editorMeta);
  renderSlotList(elements.slotList, state.editorMeta);
  renderLayerTree(elements.layerTree, state.editorMeta, elements.layerFilterInput.value);
  renderProjectMeta(elements.projectMeta, state.project, {
    selectionMode: state.selectionMode,
    undoDepth: historyState.undoStack.length,
    redoDepth: historyState.redoStack.length,
    autosaveSavedAt: readAutosavePayload()?.savedAt || '',
    textEditing: !!state.editorMeta?.textEditing,
    selectionCount: state.editorMeta?.selectionCount || 0,
    hiddenCount: state.editorMeta?.hiddenCount || 0,
    lockedCount: state.editorMeta?.lockedCount || 0,
    exportPresetLabel: currentExportPreset().label,
    preflightBlockingErrors: state.editorMeta?.preflight?.blockingErrors || 0,
  });
  renderAssetTable(elements.assetTableWrap, state.project, elements.assetFilterInput.value);
  syncTextStyleControls(state.editorMeta);
  syncBatchSummary(state.editorMeta);
  elements.statusText.textContent = state.statusText;
  refreshComputedViews(state);

  const hasProject = !!state.project;
  const hasEditor = !!activeEditor;
  elements.replaceImageButton.disabled = !hasEditor;
  elements.manualSlotButton.disabled = !hasEditor;
  elements.demoteSlotButton.disabled = !hasEditor;
  elements.redetectButton.disabled = !hasEditor;
  elements.toggleHideButton.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < 1;
  elements.toggleLockButton.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < 1;
  elements.textEditButton.disabled = !hasEditor;
  elements.preflightRefreshButton.disabled = !hasEditor;
  for (const button of elements.batchActionButtons) {
    const requiresMany = button.dataset.batchAction !== 'reset-transform';
    const needed = requiresMany ? 2 : 1;
    button.disabled = !hasEditor || (state.editorMeta?.selectionCount || 0) < needed;
  }
  elements.downloadEditedButton.disabled = !hasProject;
  elements.downloadNormalizedButton.disabled = !hasProject;
  elements.downloadLinkedZipButton.disabled = !hasEditor;
  elements.exportPngButton.disabled = !hasEditor;
  elements.exportSectionsZipButton.disabled = !hasEditor;
  elements.exportPresetPackageButton.disabled = !hasEditor;
  elements.downloadReportButton.disabled = !hasProject;
  if (elements.applyCodeToEditorButton) elements.applyCodeToEditorButton.disabled = !hasProject || currentCodeSource === 'report';
  if (elements.reloadCodeFromEditorButton) elements.reloadCodeFromEditorButton.disabled = !hasProject;
  syncExportPresetUi();
  syncWorkspaceButtons();
  applyPreviewZoom();
  refreshHistoryButtons();
}

function renderEmptyPreview() {
  elements.previewFrame.srcdoc = `
    <div class="empty-stage">
      <div>
        <strong>아직 프로젝트가 없습니다.</strong><br />
        HTML 파일, 프로젝트 폴더, 붙여넣기, fixture 중 하나를 불러와 주세요.
      </div>
    </div>`;
}

function handleEditorShortcut(action) {
  if (action === 'undo') return undoHistory();
  if (action === 'redo') return redoHistory();
  if (action === 'save-edited') return downloadEditedHtml();
}

function mountProject(project, { snapshot = null, preserveHistory = false, force = false } = {}) {
  if (activeEditor) {
    try { activeEditor.destroy(); } catch {}
    activeEditor = null;
  }

  if (force) mountedProjectId = '';
  mountedProjectId = project?.id || '';
  if (!project) {
    renderEmptyPreview();
    store.setEditorMeta(null);
    return;
  }

  elements.previewFrame.onload = () => {
    const liveProject = store.getState().project;
    if (!liveProject || liveProject.id !== project.id) return;
    activeEditor = createFrameEditor({
      iframe: elements.previewFrame,
      project,
      selectionMode: snapshot?.selectionMode || store.getState().selectionMode,
      initialSnapshot: snapshot,
      onStateChange: (meta) => store.setEditorMeta(meta),
      onStatus: setStatus,
      onMutation: (nextSnapshot) => {
        recordHistorySnapshot(nextSnapshot);
        if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
      },
      onShortcut: handleEditorShortcut,
    });
    if (snapshot?.selectionMode) store.setSelectionMode(snapshot.selectionMode);
    store.setEditorMeta(activeEditor.getMeta());
    applyPreviewZoom();
    if (!preserveHistory) {
      resetHistory();
      recordHistorySnapshot(activeEditor.captureSnapshot('initial'));
    } else {
      persistAutosave(historyState.undoStack.at(-1) || activeEditor.captureSnapshot('restore'));
      refreshHistoryButtons();
    }
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  };
  elements.previewFrame.srcdoc = snapshot?.html || project.normalizedHtml;
}

function loadFixture(fixtureId) {
  const fixtureMeta = getFixtureMeta(fixtureId);
  const html = FIXTURE_SOURCE_MAP[fixtureId] || '';
  if (!fixtureMeta || !html) {
    setStatus(`Fixture ${fixtureId}를 찾지 못했습니다.`);
    return;
  }
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const project = normalizeProject({ html, sourceName: fixtureMeta.name, sourceType: 'fixture', fixtureMeta });
  store.setProject(project);
  setStatus(`Fixture ${fixtureId}를 불러왔습니다. 슬롯 후보 ${project.summary.totalSlotCandidates}개, 자산 ${project.summary.assetsTotal}개입니다.`);
}

async function handleHtmlFileImport(file) {
  if (!file) return;
  const html = await file.text();
  const fileIndex = createImportFileIndex([file], 'html-file');
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const project = normalizeProject({ html, sourceName: file.name, sourceType: 'html-file', fileIndex, htmlEntryPath: file.name });
  store.setProject(project);
  setStatus(`HTML 파일 ${file.name}을 불러왔습니다. 미해결 자산 ${project.summary.assetsUnresolved}개입니다.`);
}

async function handleFolderImport(files) {
  const fileIndex = createImportFileIndex(files, 'folder-import');
  const htmlEntry = choosePrimaryHtmlEntry(fileIndex);
  if (!htmlEntry) {
    setStatus('선택한 폴더에 HTML 파일이 없습니다.');
    return;
  }
  const html = await htmlEntry.file.text();
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const project = normalizeProject({
    html,
    sourceName: htmlEntry.relativePath,
    sourceType: 'folder-import',
    fileIndex,
    htmlEntryPath: htmlEntry.relativePath,
  });
  if (fileIndex.htmlEntries.length > 1) {
    project.issues.unshift({
      id: `issue_multi_html_${Date.now()}`,
      level: 'info',
      code: 'MULTI_HTML',
      message: `HTML 파일이 ${fileIndex.htmlEntries.length}개라서 ${htmlEntry.relativePath}를 우선 사용했습니다.`,
    });
  }
  store.setProject(project);
  setStatus(`프로젝트 폴더 import 완료: ${htmlEntry.relativePath}. resolved ${project.summary.assetsResolved}개, unresolved ${project.summary.assetsUnresolved}개입니다.`);
}

function handlePasteImport() {
  const html = elements.htmlPasteInput.value.trim();
  if (!html) {
    setStatus('붙여넣기 HTML이 비어 있습니다.');
    return;
  }
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const project = normalizeProject({ html, sourceName: 'pasted-html', sourceType: 'paste' });
  store.setProject(project);
  setStatus(`붙여넣기 HTML을 정규화했습니다. 슬롯 후보 ${project.summary.totalSlotCandidates}개를 찾았습니다.`);
}

function downloadNormalizedHtml() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const fileName = `${projectBaseName(project)}__normalized.html`;
  downloadTextFile(fileName, project.normalizedHtml, 'text/html;charset=utf-8');
  setStatus(`정규화 HTML을 저장했습니다: ${fileName}`);
}

function downloadEditedHtml() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const editedHtml = activeEditor ? activeEditor.getEditedHtml({ persistDetectedSlots: true }) : project.normalizedHtml;
  const fileName = `${projectBaseName(project)}__edited_working.html`;
  downloadTextFile(fileName, editedHtml, 'text/html;charset=utf-8');
  setStatus(`편집 HTML을 저장했습니다: ${fileName}`);
}

function ensurePreflightBeforeExport(kind) {
  if (!activeEditor) return false;
  const preflight = activeEditor.getPreflightReport();
  if (!preflight?.blockingErrors) return true;
  const proceed = window.confirm(`출력 전 검수에서 오류 ${preflight.blockingErrors}개가 감지되었습니다.\n빈 슬롯 또는 미해결 자산이 포함될 수 있습니다.\n그래도 ${kind}을(를) 계속하시겠습니까?`);
  if (!proceed) {
    setStatus(`출력 전 검수 오류 때문에 ${kind}을(를) 중단했습니다.`);
    return false;
  }
  return true;
}

async function downloadLinkedZip() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  if (!ensurePreflightBeforeExport('링크형 ZIP 저장')) return;
  const entries = await activeEditor.getLinkedPackageEntries();
  const zipBlob = await buildZipBlob(entries);
  const fileName = `${projectBaseName(project)}__linked_package.zip`;
  downloadBlob(fileName, zipBlob);
  setStatus(`링크형 HTML + assets ZIP을 저장했습니다: ${fileName}`);
}

async function exportFullPng() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  if (!ensurePreflightBeforeExport('전체 PNG 저장')) return;
  const blob = await activeEditor.exportFullPngBlob(exportScale());
  const fileName = `${projectBaseName(project)}__full.png`;
  downloadBlob(fileName, blob);
  setStatus(`전체 PNG를 저장했습니다: ${fileName}`);
}

async function exportSectionsZip() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  if (!ensurePreflightBeforeExport('섹션 PNG ZIP 저장')) return;
  const entries = await activeEditor.exportSectionPngEntries(exportScale());
  const zipBlob = await buildZipBlob(entries);
  const fileName = `${projectBaseName(project)}__sections_png.zip`;
  downloadBlob(fileName, zipBlob);
  setStatus(`섹션 PNG ZIP을 저장했습니다: ${fileName}`);
}

function downloadReportJson() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const report = getEditorReport(project);
  const fileName = `${projectBaseName(project)}__editor-report.json`;
  downloadTextFile(fileName, JSON.stringify(buildReportPayload(project, report), null, 2), 'application/json;charset=utf-8');
  setStatus(`리포트 JSON을 저장했습니다: ${fileName}`);
}

async function downloadExportPresetPackage() {
  const project = store.getState().project;
  if (!project || !activeEditor) return setStatus('먼저 프로젝트를 불러와 주세요.');
  const preset = currentExportPreset();
  const baseName = projectBaseName(project);
  const report = getEditorReport(project);
  const entries = [];

  const addBlobEntry = async (name, blob) => {
    if (!blob) return;
    entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
  };

  if (preset.bundleMode === 'basic') {
    entries.push({ name: `${baseName}__edited.html`, data: new TextEncoder().encode(activeEditor.getEditedHtml({ persistDetectedSlots: true })) });
    await addBlobEntry(`${baseName}__full.png`, await activeEditor.exportFullPngBlob(preset.scale));
    entries.push({ name: `${baseName}__report.json`, data: new TextEncoder().encode(JSON.stringify(buildReportPayload(project, report), null, 2)) });
  } else if (preset.bundleMode === 'market') {
    const linked = await activeEditor.getLinkedPackageEntries();
    for (const entry of linked) entries.push({ name: `linked/${entry.name}`, data: entry.data });
    const sections = await activeEditor.exportSectionPngEntries(preset.scale);
    for (const entry of sections) entries.push({ name: `sections/${entry.name}`, data: entry.data });
    entries.push({ name: `${baseName}__report.json`, data: new TextEncoder().encode(JSON.stringify(buildReportPayload(project, report), null, 2)) });
  } else if (preset.bundleMode === 'hires') {
    entries.push({ name: `${baseName}__edited.html`, data: new TextEncoder().encode(activeEditor.getEditedHtml({ persistDetectedSlots: true })) });
    await addBlobEntry(`${baseName}__full@2x.png`, await activeEditor.exportFullPngBlob(preset.scale));
    const sections = await activeEditor.exportSectionPngEntries(preset.scale);
    for (const entry of sections) entries.push({ name: `sections@2x/${entry.name}`, data: entry.data });
  } else if (preset.bundleMode === 'review') {
    entries.push({ name: `${baseName}__normalized.html`, data: new TextEncoder().encode(project.normalizedHtml) });
    await addBlobEntry(`${baseName}__review.png`, await activeEditor.exportFullPngBlob(preset.scale));
    entries.push({ name: `${baseName}__report.json`, data: new TextEncoder().encode(JSON.stringify(buildReportPayload(project, report), null, 2)) });
  }

  const zip = await buildZipBlob(entries);
  downloadBlob(`${baseName}__${preset.id}-preset.zip`, zip);
  setStatus(`Export preset 패키지를 저장했습니다: ${preset.label}`);
}

function restoreAutosave() {
  const payload = readAutosavePayload();
  if (!payload?.snapshot?.html) return setStatus('복구할 자동저장본이 없습니다.');
  pendingMountOptions = { snapshot: payload.snapshot, preserveHistory: false };
  const project = normalizeProject({
    html: payload.snapshot.html,
    sourceName: payload.sourceName || 'autosave.html',
    sourceType: 'autosave',
  });
  store.setProject(project);
  setStatus(`자동저장본을 복구했습니다. 저장 시각: ${payload.savedAt || '-'}`);
}

function applyTextStyleFromControls({ clear = false } = {}) {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const patch = clear ? {
    fontSize: '',
    lineHeight: '',
    letterSpacing: '',
    fontWeight: '',
    color: '',
    textAlign: '',
  } : (() => {
    const next = {};
    const fontSize = elements.textFontSizeInput.value.trim();
    const lineHeight = elements.textLineHeightInput.value.trim();
    const letterSpacing = elements.textLetterSpacingInput.value.trim();
    const fontWeight = elements.textWeightSelect.value;
    if (fontSize) next.fontSize = fontSize;
    if (lineHeight) next.lineHeight = lineHeight;
    if (letterSpacing) next.letterSpacing = letterSpacing;
    if (fontWeight) next.fontWeight = fontWeight;
    if (elements.textColorInput.value) next.color = elements.textColorInput.value;
    return next;
  })();
  const result = activeEditor.applyTextStyle(patch, { clear });
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
}

function applyBatchAction(action) {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.applyBatchLayout(action);
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
}

async function reloadCodeFromEditor() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 열어 주세요.');
  if (!activeEditor) return refreshCodeEditorFromState({ force: true });
  if (currentCodeSource === 'edited') {
    const html = await activeEditor.getCurrentPortableHtml();
    elements.editedCodeView.textContent = html;
  }
  refreshCodeEditorFromState({ force: true });
  setStatus('현재 편집 상태를 코드 워크벤치로 다시 불러왔습니다.');
}

function applyCodeToEditor() {
  const project = store.getState().project;
  if (!project) return setStatus('먼저 프로젝트를 열어 주세요.');
  if (currentCodeSource === 'report') return setStatus('리포트 JSON은 편집기에 적용할 수 없습니다.');
  const html = elements.codeEditorTextarea?.value || '';
  if (!html.trim()) return setStatus('적용할 코드가 비어 있습니다.');
  pendingMountOptions = { snapshot: null, preserveHistory: false };
  const nextProject = normalizeProject({ html, sourceName: project.sourceName || 'edited.html', sourceType: 'code-apply' });
  store.setProject(nextProject);
  codeEditorDirty = false;
  setStatus('코드 워크벤치 내용을 다시 편집기에 적용했습니다.');
}

function searchCodeNext() {
  const textarea = elements.codeEditorTextarea;
  const keyword = elements.codeSearchInput?.value || '';
  if (!textarea || !keyword) return setStatus('검색어를 입력해 주세요.');
  const source = textarea.value || '';
  const start = textarea.selectionEnd || 0;
  let index = source.indexOf(keyword, start);
  if (index < 0 && start > 0) index = source.indexOf(keyword, 0);
  if (index < 0) return setStatus('일치하는 코드가 없습니다.');
  textarea.focus();
  textarea.setSelectionRange(index, index + keyword.length);
  const line = source.slice(0, index).split('\n').length;
  setStatus(`코드 검색 결과 ${line}번째 줄로 이동했습니다.`);
}

store.subscribe((state) => {
  const shouldMount = pendingMountOptions || (state.project?.id || '') !== mountedProjectId;
  if (shouldMount) {
    const options = pendingMountOptions || {};
    pendingMountOptions = null;
    mountProject(state.project, options);
  }
  renderShell(store.getState());
});

populateFixtureSelect();
populateExportPresetSelect();
syncExportPresetUi({ forceScale: true });
renderLocalModeNotice(elements.localModeNotice);
renderEmptyPreview();

for (const button of elements.viewButtons) button.addEventListener('click', () => setView(button.dataset.view));
for (const button of elements.selectionModeButtons) button.addEventListener('click', () => setSelectionMode(button.dataset.selectionMode));
for (const button of elements.presetButtons) {
  button.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    const result = activeEditor.applyImagePreset(button.dataset.preset);
    setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  });
}
for (const button of elements.actionButtons) {
  button.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    if (button.dataset.action === 'remove-image') {
      const result = activeEditor.removeImageFromSelected();
      setStatus(result.message);
      if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
    }
  });
}
for (const button of elements.batchActionButtons) button.addEventListener('click', () => applyBatchAction(button.dataset.batchAction));
for (const button of elements.textAlignButtons) {
  button.addEventListener('click', () => {
    if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
    const result = activeEditor.applyTextStyle({ textAlign: button.dataset.textAlign });
    setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  });
}

elements.openHtmlButton.addEventListener('click', () => elements.htmlFileInput.click());
elements.openFolderButton.addEventListener('click', () => elements.folderInput.click());
elements.loadFixtureButton.addEventListener('click', () => loadFixture(elements.fixtureSelect.value));
elements.applyPasteButton.addEventListener('click', handlePasteImport);
elements.replaceImageButton.addEventListener('click', () => elements.replaceImageInput.click());
elements.manualSlotButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.markSelectedAsSlot();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.toggleHideButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.toggleSelectedHidden();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.toggleLockButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.toggleSelectedLocked();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.demoteSlotButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.demoteSelectedSlot();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.redetectButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  activeEditor.redetect();
  setStatus('슬롯 자동 감지를 다시 실행했습니다.');
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.textEditButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const result = activeEditor.toggleTextEdit();
  setStatus(result.message);
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
});
elements.preflightRefreshButton.addEventListener('click', () => {
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  activeEditor.refreshDerivedMeta();
  setStatus('출력 전 검수를 다시 계산했습니다.');
});
elements.applyTextStyleButton.addEventListener('click', () => applyTextStyleFromControls({ clear: false }));
elements.clearTextStyleButton.addEventListener('click', () => applyTextStyleFromControls({ clear: true }));
elements.undoButton.addEventListener('click', undoHistory);
elements.redoButton.addEventListener('click', redoHistory);
elements.restoreAutosaveButton.addEventListener('click', restoreAutosave);
elements.downloadEditedButton.addEventListener('click', downloadEditedHtml);
elements.downloadNormalizedButton.addEventListener('click', downloadNormalizedHtml);
elements.downloadLinkedZipButton.addEventListener('click', () => { downloadLinkedZip().catch((error) => setStatus(`ZIP 저장 중 오류: ${error?.message || error}`)); });
elements.exportPngButton.addEventListener('click', () => { exportFullPng().catch((error) => setStatus(`PNG 저장 중 오류: ${error?.message || error}`)); });
elements.exportSectionsZipButton.addEventListener('click', () => { exportSectionsZip().catch((error) => setStatus(`섹션 PNG ZIP 저장 중 오류: ${error?.message || error}`)); });
elements.exportPresetPackageButton.addEventListener('click', () => { downloadExportPresetPackage().catch((error) => setStatus(`Preset 패키지 저장 중 오류: ${error?.message || error}`)); });
elements.downloadReportButton.addEventListener('click', downloadReportJson);
elements.exportPresetSelect.addEventListener('change', () => {
  currentExportPresetId = elements.exportPresetSelect.value || 'default';
  syncExportPresetUi({ forceScale: true });
  setStatus(`Export preset: ${currentExportPreset().label}`);
});
elements.exportScaleSelect.addEventListener('change', () => {
  elements.exportScaleSelect.dataset.boundPreset = '';
});

elements.htmlFileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  await handleHtmlFileImport(file);
  event.target.value = '';
});

elements.folderInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  if (files.length) await handleFolderImport(files);
  event.target.value = '';
});

elements.replaceImageInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  if (!activeEditor) return setStatus('먼저 미리보기를 로드해 주세요.');
  const applied = await activeEditor.applyFiles(files);
  setStatus(applied ? `${applied}개 이미지를 적용했습니다.` : '이미지를 적용하지 못했습니다.');
  if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
  event.target.value = '';
});

elements.assetFilterInput.addEventListener('input', () => renderAssetTable(elements.assetTableWrap, store.getState().project, elements.assetFilterInput.value));
elements.layerFilterInput.addEventListener('input', () => renderLayerTree(elements.layerTree, store.getState().editorMeta, elements.layerFilterInput.value));
elements.slotList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-slot-uid]');
  if (!button || !activeEditor) return;
  const ok = activeEditor.selectNodeByUid(button.dataset.slotUid, { additive: event.ctrlKey || event.metaKey || event.shiftKey, toggle: event.ctrlKey || event.metaKey, scroll: true });
  if (ok) setStatus('슬롯을 선택했습니다.');
});
elements.layerTree.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-layer-action][data-layer-uid]');
  if (actionButton && activeEditor) {
    event.preventDefault();
    event.stopPropagation();
    const uid = actionButton.dataset.layerUid;
    const result = actionButton.dataset.layerAction === 'hide'
      ? activeEditor.toggleLayerHiddenByUid(uid)
      : activeEditor.toggleLayerLockedByUid(uid);
    setStatus(result.message);
    if (store.getState().currentView === 'edited' || store.getState().currentView === 'report') refreshComputedViews(store.getState());
    return;
  }
  const button = event.target.closest('[data-layer-uid]');
  if (!button || !activeEditor) return;
  const ok = activeEditor.selectNodeByUid(button.dataset.layerUid, { additive: event.ctrlKey || event.metaKey || event.shiftKey, toggle: event.ctrlKey || event.metaKey, scroll: true });
  if (ok) setStatus('레이어를 선택했습니다.');
});
for (const button of elements.sidebarTabButtons) {
  button.addEventListener('click', () => setSidebarTab(button.dataset.sidebarTab));
}
for (const button of elements.codeSourceButtons) {
  button.addEventListener('click', () => setCodeSource(button.dataset.codeSource, { preserveDraft: false }));
}
if (elements.codeEditorTextarea) {
  elements.codeEditorTextarea.addEventListener('input', () => { codeEditorDirty = true; });
}
elements.codeSearchNextButton?.addEventListener('click', searchCodeNext);
elements.codeSearchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchCodeNext(); }
});
elements.reloadCodeFromEditorButton?.addEventListener('click', () => { reloadCodeFromEditor().catch((error) => setStatus(`코드 다시 불러오기 오류: ${error?.message || error}`)); });
elements.applyCodeToEditorButton?.addEventListener('click', applyCodeToEditor);
elements.toggleLeftSidebarButton?.addEventListener('click', () => {
  document.body.classList.toggle('layout--left-collapsed');
  document.body.classList.remove('layout--focus-stage');
  syncWorkspaceButtons();
  applyPreviewZoom();
});
elements.toggleRightSidebarButton?.addEventListener('click', () => {
  document.body.classList.toggle('layout--right-collapsed');
  document.body.classList.remove('layout--focus-stage');
  syncWorkspaceButtons();
  applyPreviewZoom();
});
elements.focusModeButton?.addEventListener('click', () => {
  document.body.classList.toggle('layout--focus-stage');
  if (document.body.classList.contains('layout--focus-stage')) {
    document.body.classList.add('layout--left-collapsed', 'layout--right-collapsed');
  }
  syncWorkspaceButtons();
  applyPreviewZoom();
});
elements.zoomOutButton?.addEventListener('click', () => nudgeZoom(-0.1));
elements.zoomInButton?.addEventListener('click', () => nudgeZoom(0.1));
elements.zoomResetButton?.addEventListener('click', () => setZoom('manual', 1));
elements.zoomFitButton?.addEventListener('click', () => setZoom('fit'));
window.addEventListener('resize', applyPreviewZoom);

window.addEventListener('keydown', (event) => {
  const withModifier = event.ctrlKey || event.metaKey;
  if (!withModifier || event.altKey) return;
  const tagName = document.activeElement?.tagName || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) return;
  const key = String(event.key || '').toLowerCase();
  if (key === 'z') {
    event.preventDefault();
    return event.shiftKey ? redoHistory() : undoHistory();
  }
  if (key === 'y') {
    event.preventDefault();
    return redoHistory();
  }
  if (key === 's') {
    event.preventDefault();
    return downloadEditedHtml();
  }
  if (key === '=') {
    event.preventDefault();
    return nudgeZoom(0.1);
  }
  if (key === '-') {
    event.preventDefault();
    return nudgeZoom(-0.1);
  }
  if (key === '0') {
    event.preventDefault();
    return setZoom('manual', 1);
  }
  if (key === 'b') {
    event.preventDefault();
    document.body.classList.toggle('layout--left-collapsed');
    syncWorkspaceButtons();
    return applyPreviewZoom();
  }
  if (key === 'i') {
    event.preventDefault();
    document.body.classList.toggle('layout--right-collapsed');
    syncWorkspaceButtons();
    return applyPreviewZoom();
  }
  if (key === 'f') {
    event.preventDefault();
    return setZoom('fit');
  }
  if (key === 'k') {
    event.preventDefault();
    setSidebarTab('left-code');
    elements.codeSearchInput?.focus();
    return;
  }
});

setSidebarTab('left-import');
setSidebarTab('right-inspect');
setCodeSource('edited', { preserveDraft: false });
syncWorkspaceButtons();
loadFixture('F05');
