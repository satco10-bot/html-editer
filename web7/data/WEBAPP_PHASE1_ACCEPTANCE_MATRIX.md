# 웹앱 1단계 Acceptance Matrix

## Fixture 목록

- F01: blank_builder_860
- F02: sample_shop_builder_860
- F03: sample_template_existing_html
- F04: sample_dring_walk_allinone
- F05: user_melting_cheese_compact

## 기능별 합격 기준

| ID | 기능 | 우선순위 | 적용 Fixture | 합격 기준 |
|---|---|---:|---|---|
| A01 | HTML 파일 열기 | P0 | F01~F05 | HTML이 깨지지 않고 로드된다 |
| A02 | 코드 붙여넣기 import | P0 | F03~F05 | body 내용과 style이 유지된다 |
| A03 | explicit slot 인식 | P0 | F01~F03 | manifest의 required_exact_count와 required_selectors를 100% 만족한다 |
| A04 | heuristic slot 인식 | P0 | F04~F05 | manifest의 required_min_count 또는 required_exact_count를 만족한다 |
| A05 | 기존 이미지 포함 슬롯 인식 | P0 | F05 | 기존 img 2개가 슬롯으로 남아 있어야 한다 |
| A06 | 다중 이미지 드롭 | P1 | F02, F04, F05 | 선택 슬롯부터 빈 슬롯 순으로 이미지가 채워진다 |
| A07 | 수동 슬롯 지정/해제 | P0 | F03~F05 | 오탐 요소를 수동으로 승격/해제할 수 있다 |
| A08 | 이미지 배치 프리셋 | P1 | F01~F05 | cover / contain / top / center / bottom이 즉시 반영된다 |
| A09 | linked HTML 저장 | P0 | F01~F05 | 저장 후 이미지를 다시 열었을 때 유지된다 |
| A10 | embedded HTML 저장 | P0 | F01~F05 | 외부 파일 없이 단일 HTML로 다시 열린다 |
| A11 | 전체 PNG export | P0 | F01~F05 | 전체 세로 길이가 잘리지 않는다 |
| A12 | 분할 PNG export | P0 | F01, F02, F04, F05 | 섹션 순서대로 파일이 저장된다 |
| A13 | 커스텀 스킴 해석 | P0 | F05 | `uploaded:` 이미지가 저장/export 후에도 사라지지 않는다 |
| A14 | 검수 경고 | P1 | F04, F05 | 빈 슬롯 / 깨진 asset 경고가 표시된다 |

## 수동 테스트 체크리스트

### F05 필수 수동 시나리오
1. fixture를 연다
2. 13개 슬롯이 감지되는지 본다
3. 기존 이미지 2개가 이미 들어 있는 슬롯이 유지되는지 본다
4. 빈 슬롯 3개 이상에 이미지를 드래그해서 넣는다
5. cover / contain / top / center / bottom 프리셋을 바꾼다
6. linked HTML 저장 후 다시 연다
7. embedded HTML 저장 후 다시 연다
8. 전체 PNG export
9. 분할 PNG export
10. 결과물에 기존 이미지가 빠지지 않았는지 확인한다

### F04 필수 수동 시나리오
1. fixture를 연다
2. 16개 이상의 heuristic slot이 감지되는지 본다
3. 경고 카드 / 스텝 카드 / CTA 캐릭터 슬롯이 각각 인식되는지 본다
4. 다중 이미지 드롭 시 순서가 꼬이지 않는지 본다
5. 분할 PNG 순서가 시각적 섹션 순서와 맞는지 확인한다

## 자동화 추천 포인트

- manifest selector 기반 슬롯 수 검증
- existing img 보존 여부 검증
- linked/embedded 저장 후 재오픈 비교
- PNG export 파일 수 / 순서 검증
