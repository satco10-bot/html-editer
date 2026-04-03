import { escapeHtml, formatDateTime, formatNumber, truncate } from '../utils.js';

export function renderSummaryCards(container, project, editorMeta = null) {
  if (!container) return;
  if (!project) {
    container.innerHTML = '<div class="asset-empty">아직 불러온 프로젝트가 없습니다.</div>';
    return;
  }
  const slotSummary = editorMeta?.slotSummary || project.slotDetection?.summary || { totalCount: 0, explicitCount: 0, heuristicCount: 0, nearMissCount: 0 };
  const cards = [
    ['자산 수', project.summary.assetsTotal, `resolved ${project.summary.assetsResolved} · unresolved ${project.summary.assetsUnresolved}`],
    ['섹션 수', project.summary.sectionCount, `elements ${project.summary.elementCount}`],
    ['슬롯 후보', slotSummary.totalCount, `explicit ${slotSummary.explicitCount} · heuristic ${slotSummary.heuristicCount}`],
    ['기존 IMG', project.summary.existingImageCount, `blob URL ${project.fileContext.blobUrlCount}`],
    ['근접 후보', slotSummary.nearMissCount ?? project.summary.nearMissCount ?? 0, '수동 보정 후보'],
    ['편집 수정', editorMeta?.modifiedSlotCount ?? 0, editorMeta?.selectionCount ? `선택 ${editorMeta.selectionCount}개` : '아직 없음'],
  ];
  container.innerHTML = cards.map(([label, value, sub]) => `
    <article class="metric-card">
      <div class="metric-card__label">${escapeHtml(label)}</div>
      <div class="metric-card__value">${formatNumber(value)}</div>
      <div class="metric-card__sub">${escapeHtml(sub)}</div>
    </article>
  `).join('');
}

export function renderIssueList(container, project) {
  if (!container) return;
  if (!project?.issues?.length) {
    container.innerHTML = '<li class="asset-empty">현재 감지된 이슈가 없습니다.</li>';
    return;
  }
  container.innerHTML = project.issues.map((issue) => `
    <li class="issue" data-level="${escapeHtml(issue.level)}">
      <div class="issue__meta">
        <span class="issue__badge">${escapeHtml(issue.level)}</span>
        <span class="issue__code">${escapeHtml(issue.code)}</span>
      </div>
      <div class="issue__message">${escapeHtml(issue.message)}</div>
    </li>
  `).join('');
}

export function renderNormalizeStats(container, project) {
  if (!container) return;
  if (!project) {
    container.innerHTML = '<div class="asset-empty">프로젝트를 먼저 불러와 주세요.</div>';
    return;
  }
  const rows = [
    ['소스 이름', project.sourceName],
    ['소스 타입', project.sourceType],
    ['정규화 시각', formatDateTime(project.summary.normalizedAt)],
    ['원격 stylesheet', `${formatNumber(project.summary.remoteStylesheetCount)}개`],
    ['미해결 자산', `${formatNumber(project.summary.assetsUnresolved)}개`],
    ['blob URL', `${formatNumber(project.fileContext.blobUrlCount)}개`],
  ];
  container.innerHTML = rows.map(([label, value]) => `
    <div class="stat-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>
  `).join('');
}

export function renderSelectionInspector(container, editorMeta) {
  if (!container) return;
  if (!editorMeta) {
    container.innerHTML = '<div class="asset-empty">미리보기를 로드하면 선택/슬롯 진단이 표시됩니다.</div>';
    return;
  }
  const selected = editorMeta.selected;
  const summary = editorMeta.slotSummary || { totalCount: 0, nearMissCount: 0 };
  const selectedItemsHtml = editorMeta.selectedItems?.length
    ? `<div class="selected-pill-list">${editorMeta.selectedItems.slice(0, 8).map((item) => `<span class="selected-pill">${escapeHtml(truncate(item.label || item.uid || '-', 24))}</span>`).join('')}</div>`
    : '';
  const selectionHtml = !selected
    ? '<div class="asset-empty">현재 선택된 요소가 없습니다.</div>'
    : `
      <div class="inspector-card">
        <div class="inspector-kv"><strong>선택 타입</strong><span>${escapeHtml(selected.type || '-')}</span></div>
        <div class="inspector-kv"><strong>라벨</strong><span>${escapeHtml(selected.label || '-')}</span></div>
        <div class="inspector-kv"><strong>UID</strong><span>${escapeHtml(selected.uid || '-')}</span></div>
        <div class="inspector-kv"><strong>감지</strong><span>${escapeHtml(selected.detectedType || '-')}</span></div>
        <div class="inspector-kv"><strong>점수</strong><span>${escapeHtml(String(selected.score ?? '-'))}</span></div>
        <div class="inspector-kv"><strong>선택 개수</strong><span>${formatNumber(editorMeta.selectionCount || 0)}개</span></div>
        <div class="inspector-kv"><strong>숨김</strong><span>${selected.hidden ? '예' : '아니오'}</span></div>
        <div class="inspector-kv"><strong>잠금</strong><span>${selected.locked ? '예' : '아니오'}</span></div>
        <div class="inspector-kv"><strong>텍스트 편집</strong><span>${selected.textEditing ? '진행 중' : '아님'}</span></div>
        ${selectedItemsHtml}
        <div class="inspector-reasons">${(selected.reasons || []).length ? selected.reasons.map((item) => `<div>${escapeHtml(item)}</div>`).join('') : '감지 이유가 없습니다.'}</div>
      </div>`;
  container.innerHTML = `
    <article class="slot-card">
      <h3>현재 선택</h3>
      ${selectionHtml}
    </article>
    <article class="slot-card">
      <h3>전체 진단</h3>
      <ul>
        <li>slots ${formatNumber(summary.totalCount)}개</li>
        <li>near miss ${formatNumber(summary.nearMissCount || 0)}개</li>
        <li>modified ${formatNumber(editorMeta.modifiedSlotCount || 0)}개</li>
        <li>hidden ${formatNumber(editorMeta.hiddenCount || 0)}개 · locked ${formatNumber(editorMeta.lockedCount || 0)}개</li>
        <li>selection mode ${escapeHtml(editorMeta.selectionMode || 'smart')}</li>
      </ul>
    </article>
  `;
}

export function renderSlotList(container, editorMeta) {
  if (!container) return;
  if (!editorMeta?.slots?.length) {
    container.innerHTML = '<div class="asset-empty">감지된 슬롯이 없습니다.</div>';
    return;
  }
  const selectedUids = new Set((editorMeta.selectedItems || []).map((item) => item.uid));
  container.innerHTML = editorMeta.slots.map((slot, index) => `
    <button class="slot-list-item ${(selectedUids.has(slot.uid) || editorMeta.selected?.uid === slot.uid) ? 'is-active' : ''}" data-slot-uid="${escapeHtml(slot.uid)}">
      <div class="slot-list-item__top">
        <strong>#${index + 1} ${escapeHtml(truncate(slot.label, 42))}</strong>
        <span class="slot-badge" data-kind="${escapeHtml(slot.type)}">${escapeHtml(slot.type)}</span>
      </div>
      <div class="slot-list-item__meta">score ${escapeHtml(String(slot.score ?? '-'))} · ${escapeHtml(truncate(slot.groupKey || '', 48))}</div>
    </div>
  `).join('');
}

export function renderLayerTree(container, editorMeta, filterText = '') {
  if (!container) return;
  if (!editorMeta?.layerTree?.length) {
    container.innerHTML = '<div class="asset-empty">레이어 정보가 아직 없습니다.</div>';
    return;
  }
  const needle = String(filterText || '').trim().toLowerCase();
  const selectedUids = new Set((editorMeta.selectedItems || []).map((item) => item.uid));
  const rows = editorMeta.layerTree.filter((node) => {
    if (!needle) return true;
    const haystack = [node.label, node.type, node.tagName, node.uid].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  });
  if (!rows.length) {
    container.innerHTML = '<div class="asset-empty">필터에 맞는 레이어가 없습니다.</div>';
    return;
  }
  container.innerHTML = rows.map((node) => `
    <div class="layer-item ${selectedUids.has(node.uid) ? 'is-active' : ''} ${node.hidden ? 'is-hidden' : ''} ${node.locked ? 'is-locked' : ''}" data-layer-uid="${escapeHtml(node.uid)}" style="--depth:${Math.max(0, Number(node.depth || 0))}" role="button" tabindex="0">
      <span class="layer-item__indent" aria-hidden="true"></span>
      <span class="layer-item__body">
        <strong>${escapeHtml(truncate(node.label || node.uid, 40))}</strong>
        <span class="layer-item__meta">${escapeHtml(node.type)} · ${escapeHtml(node.tagName || '')}${node.childCount ? ` · child ${escapeHtml(String(node.childCount))}` : ''}</span>
        <span class="layer-item__status">
          ${node.hidden ? '<span class="status-chip" data-status="hidden">숨김</span>' : ''}
          ${node.locked ? '<span class="status-chip" data-status="locked">잠금</span>' : ''}
        </span>
      </span>
      <span class="layer-item__actions">
        <button class="layer-item__action ${node.hidden ? 'is-on' : ''}" data-layer-action="hide" data-layer-uid="${escapeHtml(node.uid)}">숨김</button>
        <button class="layer-item__action ${node.locked ? 'is-on' : ''}" data-layer-action="lock" data-layer-uid="${escapeHtml(node.uid)}">잠금</button>
        <span class="slot-badge" data-kind="${escapeHtml(node.type)}">${escapeHtml(node.type)}</span>
      </span>
    </div>
  `).join('');
}

export function renderPreflight(container, editorMeta) {
  if (!container) return;
  const report = editorMeta?.preflight;
  if (!report) {
    container.innerHTML = '<div class="asset-empty">프로젝트를 열면 출력 전 검수 결과가 표시됩니다.</div>';
    return;
  }
  const checks = report.checks || [];
  const summaryHtml = `
    <div class="preflight-summary">
      <div class="preflight-pill ${report.blockingErrors ? 'is-error' : report.warningCount ? 'is-warn' : 'is-ok'}">
        ${report.blockingErrors ? `오류 ${formatNumber(report.blockingErrors)}개` : report.warningCount ? `경고 ${formatNumber(report.warningCount)}개` : '저장 가능'}
      </div>
      <div class="preflight-summary__meta">경고 ${formatNumber(report.warningCount || 0)} · 정보 ${formatNumber(report.infoCount || 0)} · 마지막 검사 ${escapeHtml(formatDateTime(report.generatedAt))}</div>
    </div>`;
  const listHtml = checks.length
    ? `<div class="preflight-list">${checks.map((item) => `
        <article class="preflight-item" data-level="${escapeHtml(item.level || 'info')}">
          <div class="preflight-item__head">
            <span class="issue__badge">${escapeHtml(item.level || 'info')}</span>
            <strong>${escapeHtml(item.title || item.code || '검수')}</strong>
            ${item.count ? `<span class="preflight-item__count">${escapeHtml(String(item.count))}</span>` : ''}
          </div>
          <div class="preflight-item__message">${escapeHtml(item.message || '')}</div>
        </article>`).join('')}</div>`
    : '<div class="asset-empty">현재 검수 이슈가 없습니다.</div>';
  container.innerHTML = `${summaryHtml}${listHtml}`;
}

export function renderAssetTable(container, project, filterText = '') {
  if (!container) return;
  if (!project?.assets?.length) {
    container.innerHTML = '<div class="asset-empty">감지된 자산이 없습니다.</div>';
    return;
  }
  const needle = String(filterText || '').trim().toLowerCase();
  const visible = !needle
    ? project.assets
    : project.assets.filter((asset) => {
        const haystack = [asset.kind, asset.attribute, asset.originalRef, asset.previewRef, asset.scheme, asset.status, asset.matchedPath, asset.ownerLabel]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });

  if (!visible.length) {
    container.innerHTML = '<div class="asset-empty">필터에 맞는 자산이 없습니다.</div>';
    return;
  }

  container.innerHTML = `
    <table class="asset-table">
      <thead>
        <tr>
          <th>상태</th>
          <th>종류</th>
          <th>원본 ref</th>
          <th>해결 경로</th>
        </tr>
      </thead>
      <tbody>
        ${visible.map((asset) => `
          <tr>
            <td>
              <span class="asset-status" data-status="${escapeHtml(asset.status)}">${escapeHtml(asset.status)}</span>
              <div class="asset-ref">${escapeHtml(asset.scheme || '')}</div>
            </td>
            <td>
              <strong>${escapeHtml(asset.kind)}</strong>
              <div class="asset-ref">${escapeHtml(asset.ownerLabel || asset.ownerTag || '')}</div>
              <div class="asset-ref">${escapeHtml(asset.attribute || '')}</div>
            </td>
            <td><div class="asset-ref">${escapeHtml(truncate(asset.originalRef, 220))}</div></td>
            <td>
              <div class="asset-ref">${escapeHtml(truncate(asset.matchedPath || asset.previewRef || '', 220))}</div>
              <div class="asset-ref">${escapeHtml(asset.resolutionMethod || '')}</div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function renderProjectMeta(container, project, meta = {}) {
  if (!container) return;
  if (!project) {
    container.innerHTML = '';
    return;
  }
  const chips = [
    ['source', project.sourceType],
    ['fixture', project.fixtureId || 'none'],
    ['file', project.sourceName],
    ['slots', `${project.summary.totalSlotCandidates} candidates`],
    ['select', meta.selectionMode || 'smart'],
    ['history', `undo ${meta.undoDepth || 0} · redo ${meta.redoDepth || 0}`],
  ];
  if (meta.selectionCount) chips.push(['picked', `${meta.selectionCount}개`]);
  if (meta.hiddenCount) chips.push(['hidden', `${meta.hiddenCount}개`]);
  if (meta.lockedCount) chips.push(['locked', `${meta.lockedCount}개`]);
  if (meta.exportPresetLabel) chips.push(['export', meta.exportPresetLabel]);
  if (meta.autosaveSavedAt) chips.push(['autosave', formatDateTime(meta.autosaveSavedAt)]);
  if (meta.textEditing) chips.push(['text', 'editing']);
  if (meta.preflightBlockingErrors) chips.push(['preflight', `error ${meta.preflightBlockingErrors}`]);
  container.innerHTML = chips.map(([label, value]) => `
    <span class="meta-chip"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>
  `).join('');
}

export function renderLocalModeNotice(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="local-notice">
      <strong>로컬 전용 모드</strong>
      <div>이 버전은 서버 없이 <code>index.html</code>을 바로 열어도 동작하도록 구성했습니다.</div>
      <div>HTML/폴더 가져오기, Blob URL 미리보기, drag &amp; drop, autosave 복구, PNG/ZIP 저장을 모두 브라우저 안에서 처리합니다.</div>
      <div>직접 덮어쓰기 대신 브라우저 다운로드와 localStorage autosave를 기본 저장 흐름으로 사용합니다.</div>
    </div>
  `;
}
