export const APP_TITLE = '상세페이지 웹앱 로컬 에디터 · 6단계';
export const APP_VERSION = 'phase6-local-2026-04-02';
export const EXPLICIT_SLOT_SELECTOR = '[data-image-slot], .image-slot, .drop-slot';
export const PLACEHOLDER_TEXT_RE = /(\[[^\]]*(이미지|영상)[^\]]*\]|이미지\s*삽입부|삽입부|드래그\s*이미지|image\s*slot|image\s*area|누끼|클로즈업|착용컷|연출컷|상세컷|대표\s*이미지|메인\s*이미지|썸네일|thumbnail|visual|hero|shot)/i;
export const STRONG_SLOT_CLASS_RE = /(^|\s)(media-shell|hero-shot|hero-visual|visual|opt-thumb|thumb|thumb-box|thumb-item|image-slot|drop-slot|image-wrap|photo-wrap|poster|cover|ph|c-box|cta-char|frame|hero-image|hero-media)(\s|$)/i;
export const LAYOUT_CLASS_RE = /(^|\s)(page|section|row|col|wrap|grid|container|inner|list|group|content|body|card|table|table-row|table-cell|layout|shell)(\s|$)/i;
export const BLOCKED_TAGS = new Set(['HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'META', 'LINK']);
export const CUSTOM_LOCAL_SCHEMES = new Set(['uploaded', 'asset', 'assets', 'local', 'image', 'img', 'media']);
export const COMMON_ASSET_DIRS = ['assets', 'uploaded', 'images', 'image', 'img', 'media', 'static'];
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']);
export const TEXTISH_TAGS = new Set(['P', 'SPAN', 'SMALL', 'STRONG', 'EM', 'B', 'I', 'U', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'A', 'BUTTON', 'BLOCKQUOTE']);
export const TEXT_CLASS_RE = /(title|desc|copy|text|note|label|kicker|caption|eyebrow|micro|body|tag|badge|question|answer|guide|summary|lead|message|headline|name|price)/i;
export const BOX_CLASS_RE = /(box|card|panel|wrap|layout|grid|collage|bubble|holder|banner|section|row|group|list|content|body|item|area|container|shell)/i;
export const SLOT_SCORE_THRESHOLD = 72;
export const SLOT_NEAR_MISS_MIN = 48;
export const FRAME_STYLE_ID = '__phase5_local_editor_style';
export const FRAME_OVERLAY_ID = '__phase5_local_editor_overlay';
export const AUTOSAVE_KEY = 'detail-local-webapp-autosave-v6';
export const HISTORY_LIMIT = 80;

export const EXPORT_PRESETS = [
  { id: 'default', label: '기본 패키지', scale: 1.5, bundleMode: 'basic', description: '편집 HTML + 전체 PNG + 리포트' },
  { id: 'market', label: '마켓 업로드', scale: 1.5, bundleMode: 'market', description: '링크형 HTML + 섹션 PNG + 리포트' },
  { id: 'hires', label: '고해상도', scale: 2, bundleMode: 'hires', description: '전체 PNG 2x + 섹션 PNG 2x + 편집 HTML' },
  { id: 'review', label: '검수용', scale: 1, bundleMode: 'review', description: '정규화 HTML + 전체 PNG 1x + 리포트' },
];

export function getExportPresetById(id) {
  return EXPORT_PRESETS.find((item) => item.id === id) || EXPORT_PRESETS[0];
}
