# 상세페이지 웹앱 로컬 에디터 · 6단계 구현 보고서

## 이번 단계 목표

5단계 로컬 웹앱 위에 아래 4가지를 붙였습니다.

- 레이어 숨김 / 다시 표시
- 레이어 잠금 / 해제
- 캔버스에서 Shift+드래그 다중선택 + 직접 드래그 이동
- 스냅 가이드 + export preset 패키지

이번 단계도 **서버 없이, 도메인 없이, `file://` 로 직접 여는 개인용 로컬 웹앱** 기준을 유지했습니다.

## 실제 구현한 기능

### 1) 레이어 숨김 / 잠금

- 상단 툴바에 `선택 레이어 숨김/표시`, `선택 레이어 잠금/해제` 버튼 추가
- 레이어 패널 각 행에 `숨김`, `잠금` 토글 버튼 추가
- 선택 진단 / 프로젝트 메타에 hidden / locked 상태 반영
- 잠긴 레이어는 캔버스 클릭, 이미지 적용, 텍스트 편집, 슬롯 지정, 배치 편집에서 보호
- 숨김 레이어는 export 시 `display:none` 상태로 반영
- 잠금 상태는 편집 보호용이므로 최종 저장 HTML에서는 runtime data를 제거

### 2) 캔버스 다중선택 / 드래그 이동 / 스냅

- `pointerdown / pointermove / pointerup / pointercancel` 기반 상호작용 추가
- `Shift+드래그`로 선택 박스 생성
- 선택된 요소 드래그 이동 지원
- 다른 레이어의 좌/중/우, 상/중/하 라인 근처에서 스냅 가이드 표시
- 드래그 후 history snapshot 저장 (`drag-move`)

### 3) Export preset

- export preset 셀렉터 추가
- preset 패키지 ZIP 저장 버튼 추가
- preset 종류:
  - 기본 패키지: 편집 HTML + 전체 PNG + 리포트
  - 마켓 업로드: 링크형 HTML + 섹션 PNG + 리포트
  - 고해상도: 전체 PNG 2x + 섹션 PNG 2x + 편집 HTML
  - 검수용: 정규화 HTML + 전체 PNG 1x + 리포트

### 4) 로컬 전용 기준 보강

- 여전히 `type="module"` 없이 단일 `app.bundle.js` 사용
- `fetch()` 기반 부팅 없음
- File System Access API 미사용
- 브라우저 다운로드 + `localStorage` autosave 흐름 유지

## 같이 잡은 중요한 안정화 포인트

### overlay runtime이 슬롯 감지를 오염시키는 문제 방지

스냅 가이드 / 마키 박스 overlay는 live DOM에 들어가기 때문에, 그대로 두면 슬롯 감지나 export에 끼어들 수 있습니다.
이번 단계에서는:

- overlay 노드에 `data-editor-runtime="1"` 부여
- 슬롯 감지에서 runtime 노드 제외
- snapshot / export 직전 runtime 노드 제거

이렇게 처리했습니다.

### 레이어 패널 구조 안정화

레이어 행 안에 액션 버튼이 들어가므로, outer row를 `button` 대신 `div role="button"` 구조로 바꿔 nested button 문제를 피했습니다.

## 수정한 주요 파일

- `index.html`
- `styles.css`
- `src/main.js`
- `src/config.js`
- `src/utils.js`
- `src/editor/frame-editor.js`
- `src/ui/renderers.js`
- `src/core/slot-detector.js`
- `README.md`
- `package.json`
- `scripts/validate_phase6.py`

## 검증 결과

- 정적/계약 검증: **120 / 120 통과**
- 실패: **0건**
- 번들 SHA256: `2aff4e5f7ca783ae59c9f1f874239f35cc320c08ddb1ac09fe82e09989cde856`
- 브라우저 smoke: `blocked`

### 검증에서 확인한 항목

- bundle 문법 검사
- 로컬 전용 부팅 구조 (`module` 미사용, secure-context 전용 API 미사용)
- phase6 UI ID 연결 완전성
- hide/lock / marquee / snap / export preset 코드 존재성
- fixture 5종 계약 유지
- F05 실사용 fixture의 13개 슬롯 구조 유지
- F05의 `uploaded:` 이미지 2개 유지

## 현재 남겨둔 범위

- 레이어 접기/펼치기
- 레이어 드래그 재정렬
- 더 정교한 프레임/오토레이아웃 개념
- 템플릿 / 컴포넌트 / 반복 생산 시스템 고도화
- export preset의 마켓별 세부 규칙 분리

## 실행

압축을 푼 뒤 `index.html`을 직접 열면 됩니다.
