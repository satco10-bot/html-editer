# 상세페이지 웹앱 로컬 에디터 · 6단계

로컬에서 바로 열어 쓰는 상세페이지 편집기입니다.
서버 없이 `index.html`만 열어도 동작하도록 유지하면서, 상세페이지 HTML을 불러와 이미지 슬롯을 자동 감지하고 이미지 교체, 텍스트 직접 수정, 레이어 패널, 정렬/간격, 출력 전 검수, HTML/PNG/ZIP 저장까지 처리합니다.

이번 6단계는 **미리캔버스/Figma 쪽 조작감에 가까운 캔버스 UX**를 붙이는 데 집중했습니다.

## 이번 6단계에서 들어간 것

- 로컬 전용 실행 유지
  - 단일 `app.bundle.js`
  - `file://` 직접 열기 기준 설계
  - File System Access API 미사용
  - `<input type="file">` / 다운로드 / `localStorage` autosave 기반 저장 흐름
- 레이어 관리 강화
  - 선택 레이어 숨김 / 다시 표시
  - 선택 레이어 잠금 / 해제
  - 레이어 패널 행별 숨김 / 잠금 토글
  - 숨김/잠금 상태를 레이어 패널과 선택 진단에 반영
- 캔버스 직접 조작 강화
  - Shift + 드래그 다중선택 박스
  - 선택 요소 직접 드래그 이동
  - 다른 레이어의 엣지 / 중심선 근처에서 스냅 가이드 표시
- Export preset
  - 기본 패키지: 편집 HTML + 전체 PNG + 리포트
  - 마켓 업로드: 링크형 HTML + 섹션 PNG + 리포트
  - 고해상도: 전체 PNG 2x + 섹션 PNG 2x + 편집 HTML
  - 검수용: 정규화 HTML + 전체 PNG 1x + 리포트
- 기존 5단계 기능 유지
  - 슬롯 자동 감지 + 수동 슬롯 지정/해제
  - 여러 장 이미지 순차 배치
  - 이미지 프리셋: cover / contain / top / center / bottom
  - 텍스트 더블클릭 편집, `Ctrl/Cmd+Enter` 저장, `Esc` 취소
  - 텍스트 스타일 패널
  - 멀티선택 정렬/간격
  - undo / redo
  - autosave 저장 및 복구
  - 수정 슬롯 원복
  - 편집 HTML 저장
  - 정규화 HTML 저장
  - 링크형 HTML + assets ZIP 저장
  - 전체 PNG 저장
  - 섹션 PNG ZIP 저장
  - 리포트 JSON 저장

## 로컬 전용 기준에서 잡은 점

- 별도 도메인이나 서버를 전제로 하지 않습니다.
- `showOpenFilePicker()` / `showSaveFilePicker()` 같은 보안 컨텍스트 의존 API를 쓰지 않습니다.
- 브라우저 다운로드와 autosave를 기본 저장 흐름으로 둡니다.
- 새로 넣은 이미지는 data URL로 저장해, 저장한 편집 HTML을 다시 열었을 때 blob URL 때문에 이미지가 빠지지 않게 유지합니다.

## 폴더 구조

- `index.html` : 로컬에서 직접 여는 진입점
- `styles.css` : 앱 셸 스타일
- `app.bundle.js` : 로컬 실행용 단일 번들
- `src/` : 소스 코드
- `data/fixtures/` : 고정 fixture 샘플
- `scripts/build_local_bundle.py` : 번들 생성 스크립트
- `scripts/validate_phase6.py` : 6단계 정적/계약 검증 스크립트
- `reports/WEBAPP_PHASE6_IMPLEMENTATION_REPORT.md` : 구현 보고서
- `reports/WEBAPP_PHASE6_VALIDATION_RESULTS.json` : 검증 결과

## 실행

압축을 푼 뒤 `index.html`을 브라우저에서 직접 열면 됩니다.

## 권장 작업 흐름

1. HTML 파일 또는 프로젝트 폴더 열기
2. 슬롯 목록 / 레이어 패널에서 대상을 선택
3. 이미지 드래그 또는 `선택 슬롯 이미지 넣기`
4. 필요하면 텍스트 더블클릭 편집 또는 스타일 패널 사용
5. Shift+드래그로 다중 선택하거나, 레이어 행에서 숨김/잠금 조정
6. 선택 요소를 드래그해 이동하고 스냅 가이드로 맞춤
7. `출력 전 검수` 확인
8. `편집 HTML 저장`, `링크형 ZIP 저장`, `Preset 패키지 ZIP 저장` 중 원하는 방식으로 저장

## 개발용 명령

```bash
python3 scripts/build_local_bundle.py
node --check app.bundle.js
python3 scripts/validate_phase6.py
```

## 현재 남겨둔 범위

- 레이어 접기/펼치기와 진짜 트리 재정렬
- DOM 위 `translate()`를 넘어서는 스마트 레이아웃 엔진
- 템플릿/컴포넌트 단위 반복 편집
- 마켓별 상세 export preset 세분화
- fixture 기반 회귀 테스트 자동화 고도화
