from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
BUNDLE = ROOT / 'app.bundle.js'
README = ROOT / 'README.md'
PACKAGE = ROOT / 'package.json'
MANIFEST = ROOT / 'data' / 'WEBAPP_PHASE1_FIXTURE_MANIFEST.json'
FIXTURE_DIR = ROOT / 'data' / 'fixtures'
MAIN_SRC = ROOT / 'src' / 'main.js'
FRAME_SRC = ROOT / 'src' / 'editor' / 'frame-editor.js'
RENDERERS_SRC = ROOT / 'src' / 'ui' / 'renderers.js'
CONFIG_SRC = ROOT / 'src' / 'config.js'
SLOT_DETECTOR_SRC = ROOT / 'src' / 'core' / 'slot-detector.js'
REPORT = ROOT / 'reports' / 'WEBAPP_PHASE6_VALIDATION_RESULTS.json'


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def count_selector(html_path: Path, selector: str) -> int:
    soup = BeautifulSoup(html_path.read_text(encoding='utf-8'), 'lxml')
    return len(soup.select(selector))


def add_check(checks: list[dict[str, Any]], name: str, ok: bool, detail: str = '') -> None:
    checks.append({'name': name, 'ok': bool(ok), 'detail': detail})


def try_browser_smoke() -> dict[str, Any]:
    script = f"""
from pathlib import Path
import json
try:
    from playwright.sync_api import sync_playwright
except Exception as error:
    print(json.dumps({{'status': 'unavailable', 'error': str(error)}}, ensure_ascii=False))
    raise SystemExit(0)
URL = Path(r'{INDEX}').resolve().as_uri()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={{'width': 1700, 'height': 1200}})
        page.goto(URL, wait_until='load', timeout=10000)
        page.wait_for_timeout(1200)
        payload = {{
            'status': 'ok',
            'title': page.title(),
            'status_text': page.locator('#statusText').inner_text(),
            'layer_count': page.locator('[data-layer-uid]').count(),
            'slot_count': page.locator('[data-slot-uid]').count(),
            'preset_value': page.locator('#exportPresetSelect').input_value(),
        }}
        browser.close()
        print(json.dumps(payload, ensure_ascii=False))
except Exception as error:
    print(json.dumps({{'status': 'blocked', 'error': str(error)}}, ensure_ascii=False))
"""
    completed = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, timeout=40)
    raw = (completed.stdout or '').strip().splitlines()
    if raw:
        try:
            return json.loads(raw[-1])
        except Exception:
            pass
    return {
        'status': 'error',
        'returncode': completed.returncode,
        'stdout': completed.stdout.strip()[-500:],
        'stderr': completed.stderr.strip()[-500:],
    }


def main() -> None:
    index_html = INDEX.read_text(encoding='utf-8')
    bundle_js = BUNDLE.read_text(encoding='utf-8')
    main_js = MAIN_SRC.read_text(encoding='utf-8')
    frame_js = FRAME_SRC.read_text(encoding='utf-8')
    renderers_js = RENDERERS_SRC.read_text(encoding='utf-8')
    config_js = CONFIG_SRC.read_text(encoding='utf-8')
    slot_detector_js = SLOT_DETECTOR_SRC.read_text(encoding='utf-8')
    readme = README.read_text(encoding='utf-8')
    package = json.loads(PACKAGE.read_text(encoding='utf-8'))
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))

    checks: list[dict[str, Any]] = []

    node_check = subprocess.run(['node', '--check', str(BUNDLE)], capture_output=True, text=True)
    add_check(checks, 'bundle_node_syntax_check', node_check.returncode == 0, (node_check.stderr or '').strip())

    add_check(checks, 'index_has_bundle_script', 'app.bundle.js' in index_html, 'index.html should load app.bundle.js')
    add_check(checks, 'index_no_module_script', 'type="module"' not in index_html and "type='module'" not in index_html, 'local mode avoids ESM requirement')
    add_check(checks, 'bundle_has_no_es_import', re.search(r'^\s*import\s', bundle_js, re.M) is None, 'bundle should be plain script')
    add_check(checks, 'bundle_has_no_export_keyword', re.search(r'^\s*export\s', bundle_js, re.M) is None, 'bundle should not expose ESM export statements')
    add_check(checks, 'bundle_uses_srcdoc_preview', 'srcdoc' in bundle_js or 'srcdoc' in index_html, 'preview should be iframe srcdoc based')
    add_check(checks, 'main_boot_has_no_fetch', 'fetch(' not in main_js, 'startup flow should not require network fetch')
    add_check(checks, 'bundle_has_no_file_system_access_api', all(token not in bundle_js for token in ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']), 'local file:// mode should not depend on secure-context file picker APIs')
    add_check(checks, 'bundle_has_autosave_key_v6', 'detail-local-webapp-autosave-v6' in bundle_js or 'detail-local-webapp-autosave-v6' in config_js, 'autosave key should be updated to v6')
    add_check(checks, 'package_is_phase6', package.get('version') == '0.6.0', json.dumps(package, ensure_ascii=False))
    add_check(checks, 'readme_mentions_phase6', all(word in readme for word in ['6단계', '숨김', '잠금', '스냅', 'Preset']), 'README should document phase6 capabilities')

    required_ids = [
        'openHtmlButton', 'openFolderButton', 'loadFixtureButton', 'applyPasteButton',
        'replaceImageButton', 'manualSlotButton', 'demoteSlotButton', 'toggleHideButton', 'toggleLockButton', 'redetectButton', 'textEditButton',
        'undoButton', 'redoButton', 'restoreAutosaveButton',
        'downloadEditedButton', 'downloadNormalizedButton', 'downloadLinkedZipButton',
        'exportPresetSelect', 'exportScaleSelect', 'exportPngButton', 'exportSectionsZipButton', 'exportPresetPackageButton', 'downloadReportButton',
        'replaceImageInput', 'previewFrame', 'slotList', 'selectionInspector', 'assetFilterInput',
        'preflightContainer', 'preflightRefreshButton', 'layerTree', 'layerFilterInput',
        'textFontSizeInput', 'textLineHeightInput', 'textLetterSpacingInput', 'textWeightSelect', 'textColorInput',
        'applyTextStyleButton', 'clearTextStyleButton', 'batchSelectionSummary'
    ]
    for element_id in required_ids:
        add_check(checks, f'index_has_{element_id}', f'id="{element_id}"' in index_html, element_id)

    js_ids = sorted(set(re.findall(r"document\.getElementById\('([^']+)'\)", main_js)))
    missing_ids = [element_id for element_id in js_ids if f'id="{element_id}"' not in index_html]
    add_check(checks, 'all_main_js_ids_exist_in_index', not missing_ids, ', '.join(missing_ids) or 'ok')

    required_editor_methods = [
        'toggleTextEdit', 'captureSnapshot', 'exportFullPngBlob', 'exportSectionPngEntries',
        'getLinkedPackageEntries', 'applyFiles', 'removeImageFromSelected',
        'markSelectedAsSlot', 'demoteSelectedSlot', 'getCurrentPortableHtml',
        'applyTextStyle', 'applyBatchLayout', 'getPreflightReport', 'selectNodeByUid', 'refreshDerivedMeta',
        'toggleSelectedHidden', 'toggleSelectedLocked', 'toggleLayerHiddenByUid', 'toggleLayerLockedByUid'
    ]
    for method in required_editor_methods:
        add_check(checks, f'frame_editor_has_{method}', method in frame_js, method)

    required_renderer_functions = ['renderLayerTree', 'renderPreflight', 'renderSelectionInspector']
    for name in required_renderer_functions:
        add_check(checks, f'renderer_has_{name}', f'function {name}' in renderers_js, name)

    add_check(checks, 'index_has_stage_hint', 'Shift+드래그' in index_html and '스냅 가이드' in index_html, 'canvas interaction hint should exist')
    add_check(checks, 'index_has_export_preset_label', 'Export preset' in index_html, 'export preset selector should be visible')
    add_check(checks, 'frame_has_marquee_runtime', '__phase6_marquee_box' in frame_js and 'handlePointerDown' in frame_js and 'updateMarqueeSelection' in frame_js, 'marquee drag selection runtime should exist')
    add_check(checks, 'frame_has_snap_runtime', '__phase6_snap_line_x' in frame_js and 'computeSnapAdjustment' in frame_js, 'snap guide runtime should exist')
    add_check(checks, 'frame_has_lock_hide_runtime', 'data-editor-hidden' in frame_js and 'data-editor-locked' in frame_js, 'hide/lock data attributes should exist')
    add_check(checks, 'slot_detector_skips_runtime_nodes', 'editorRuntime' in slot_detector_js or 'data-editor-runtime' in slot_detector_js, 'slot detector should skip overlay runtime nodes')
    add_check(checks, 'renderers_have_layer_actions', 'data-layer-action="hide"' in renderers_js and 'data-layer-action="lock"' in renderers_js, 'layer action buttons should exist')

    add_check(checks, 'index_has_batch_buttons', index_html.count('data-batch-action=') >= 8, 'expect batch layout actions in UI')
    add_check(checks, 'index_has_text_align_buttons', index_html.count('data-text-align=') == 3, 'left / center / right buttons')
    add_check(checks, 'frame_has_pointer_listeners', all(token in frame_js for token in ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']), 'drag interactions should use pointer events')

    add_check(checks, 'fixture_count_is_5', len(manifest.get('fixtures', [])) == 5, f"fixtures={len(manifest.get('fixtures', []))}")
    for fixture in manifest.get('fixtures', []):
        html_path = FIXTURE_DIR / Path(fixture['file']).name
        add_check(checks, f'fixture_exists_{fixture["id"]}', html_path.exists(), str(html_path))
        slot_contract = fixture.get('slot_contract', {})
        if slot_contract.get('required_selectors'):
            total = 0
            for selector in slot_contract['required_selectors']:
                count = count_selector(html_path, selector)
                total += count
                add_check(checks, f'{fixture["id"]}_selector_{selector}', count >= 1, f'count={count}')
            expected = slot_contract.get('required_exact_count')
            if expected is not None:
                add_check(checks, f'{fixture["id"]}_required_exact_count', total == expected, f'expected={expected}, actual={total}')
        if slot_contract.get('required_pattern_groups'):
            total = 0
            for selector, expected_count in slot_contract['required_pattern_groups'].items():
                actual = count_selector(html_path, selector)
                total += actual
                add_check(checks, f'{fixture["id"]}_pattern_{selector}', actual == expected_count, f'expected={expected_count}, actual={actual}')
            if slot_contract.get('required_exact_count') is not None:
                add_check(checks, f'{fixture["id"]}_required_exact_from_groups', total == slot_contract['required_exact_count'], f'expected={slot_contract["required_exact_count"]}, actual={total}')
            if slot_contract.get('required_min_count') is not None:
                add_check(checks, f'{fixture["id"]}_required_min_from_groups', total >= slot_contract['required_min_count'], f'min={slot_contract["required_min_count"]}, actual={total}')

    f05_path = FIXTURE_DIR / 'fixture_05_user_melting_cheese_compact.html'
    f05_html = f05_path.read_text(encoding='utf-8')
    add_check(checks, 'F05_has_two_uploaded_img_refs', f05_html.count('uploaded:') >= 2, f"uploaded_count={f05_html.count('uploaded:')}")
    add_check(checks, 'F05_has_media_shells', all(token in f05_html for token in ['media-shell', 'hero-shot', 'opt-thumb', 'visual']), 'expected real-world slot patterns')

    browser_smoke = try_browser_smoke()

    summary = {
        'ok': all(item['ok'] for item in checks),
        'check_count': len(checks),
        'passed': sum(1 for item in checks if item['ok']),
        'failed': sum(1 for item in checks if not item['ok']),
        'bundle_bytes': BUNDLE.stat().st_size,
        'bundle_sha256': sha256(BUNDLE),
        'browser_smoke_status': browser_smoke.get('status', 'unknown'),
    }
    payload = {
        'summary': summary,
        'checks': checks,
        'browser_smoke': browser_smoke,
    }
    REPORT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(payload, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
