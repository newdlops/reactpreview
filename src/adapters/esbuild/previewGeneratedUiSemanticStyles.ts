/**
 * Supplies conservative visual defaults for render-only generated UI placeholders.
 *
 * Missing generated design-system modules cannot reproduce their authored CSS exactly, but a bare
 * sequence of unstyled `div` elements also hides useful layout evidence. This module keeps that
 * visual recovery separate from alias proof and component behavior: it serializes a small,
 * project-agnostic role palette plus runtime helpers that infer a role from public component names.
 */

/** Browser-safe inline style values serialized into the generated placeholder module. */
type PreviewGeneratedUiSemanticStyle = Readonly<Record<string, string | number>>;

/**
 * Stable document identity shared by every generated UI fallback module.
 *
 * Multiple missing generated modules can render on one page. A document-level id lets each module
 * request the same animation sheet without appending duplicate keyframes on every render.
 */
const GENERATED_UI_ANIMATION_STYLE_ID = 'react-preview-generated-ui-semantic-animations';

/** Namespaced recurring animations used only when the project supplies no equivalent CSS token. */
const GENERATED_UI_SPIN_ANIMATION =
  'var(--animate-spin, react-preview-generated-ui-spin 1s linear infinite)';
const GENERATED_UI_PULSE_ANIMATION =
  'var(--animate-pulse, react-preview-generated-ui-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite)';

/** Small standalone keyframe sheet for generated Spinner and Skeleton placeholders. */
const GENERATED_UI_ANIMATION_CSS =
  '@keyframes react-preview-generated-ui-spin{to{transform:rotate(360deg)}}' +
  '@keyframes react-preview-generated-ui-pulse{50%{opacity:.5}}';

/** Named style palette shared by related component roles without embedding project class names. */
const SEMANTIC_STYLE_PALETTE = {
  accordionContent: {
    color: 'GrayText',
    padding: '0.25rem 0 0.75rem',
  },
  accordionItem: {
    borderBottom: '1px solid GrayText',
  },
  accordionRoot: {
    boxSizing: 'border-box',
    width: '100%',
  },
  accordionTrigger: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    border: 0,
    color: 'inherit',
    cursor: 'pointer',
    display: 'flex',
    font: 'inherit',
    fontWeight: 500,
    justifyContent: 'space-between',
    minHeight: '2.5rem',
    padding: '0.75rem 0',
    textAlign: 'left',
    width: '100%',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'ButtonFace',
    border: '1px solid GrayText',
    borderRadius: '9999px',
    boxSizing: 'border-box',
    color: 'ButtonText',
    display: 'inline-flex',
    fontSize: '0.75rem',
    fontWeight: 500,
    lineHeight: 1.25,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    padding: '0.125rem 0.5rem',
    width: 'max-content',
  },
  button: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'ButtonFace',
    border: '1px solid GrayText',
    borderRadius: '0.375rem',
    boxSizing: 'border-box',
    color: 'ButtonText',
    cursor: 'pointer',
    display: 'inline-flex',
    font: 'inherit',
    gap: '0.5rem',
    justifyContent: 'center',
    lineHeight: 1.25,
    minHeight: '2.25rem',
    padding: '0.5rem 0.875rem',
  },
  card: {
    backgroundColor: 'Canvas',
    border: '1px solid GrayText',
    borderRadius: '0.5rem',
    boxSizing: 'border-box',
    color: 'CanvasText',
    overflow: 'hidden',
  },
  cardContent: {
    padding: '0 1rem 1rem',
  },
  cardDescription: {
    color: 'GrayText',
    fontSize: '0.875rem',
    lineHeight: 1.5,
    margin: 0,
  },
  cardFooter: {
    alignItems: 'center',
    display: 'flex',
    gap: '0.5rem',
    padding: '0 1rem 1rem',
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    padding: '1rem',
  },
  cardTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.5,
    margin: 0,
  },
  field: {
    backgroundColor: 'Field',
    border: '1px solid GrayText',
    borderRadius: '0.375rem',
    boxSizing: 'border-box',
    color: 'FieldText',
    display: 'block',
    font: 'inherit',
    minHeight: '2.25rem',
    padding: '0.5rem 0.75rem',
    width: '100%',
  },
  label: {
    display: 'inline-block',
    fontSize: '0.875rem',
    fontWeight: 500,
    marginBottom: '0.375rem',
  },
  overlayBackdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    inset: 0,
    position: 'fixed',
    zIndex: 40,
  },
  overlayDescription: {
    color: 'GrayText',
    fontSize: '0.875rem',
    lineHeight: 1.5,
    margin: 0,
  },
  overlayFooter: {
    alignItems: 'center',
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
    marginTop: '1rem',
  },
  overlayHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    marginBottom: '0.75rem',
  },
  overlaySurface: {
    backgroundColor: 'Canvas',
    border: '1px solid GrayText',
    borderRadius: '0.5rem',
    boxShadow: '0 1rem 2.5rem rgba(0, 0, 0, 0.2)',
    boxSizing: 'border-box',
    color: 'CanvasText',
    margin: '1rem auto',
    maxHeight: 'calc(100vh - 2rem)',
    maxWidth: '100%',
    overflow: 'auto',
    padding: '1rem',
    position: 'relative',
    width: 'min(32rem, calc(100% - 2rem))',
    zIndex: 50,
  },
  overlayTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    lineHeight: 1.4,
    margin: 0,
  },
  popoverSurface: {
    width: 'min(20rem, calc(100% - 2rem))',
  },
  separator: {
    border: 0,
    borderTop: '1px solid GrayText',
    boxSizing: 'border-box',
    margin: '0.5rem 0',
    width: '100%',
  },
  skeleton: {
    animation: GENERATED_UI_PULSE_ANIMATION,
    backgroundColor: 'ButtonFace',
    borderRadius: '0.375rem',
    display: 'block',
    minHeight: '1rem',
  },
  spinner: {
    animation: GENERATED_UI_SPIN_ANIMATION,
    border: '2px solid currentColor',
    borderRadius: '9999px',
    borderRightColor: 'transparent',
    boxSizing: 'border-box',
    display: 'inline-block',
    height: '1rem',
    width: '1rem',
  },
  table: {
    borderCollapse: 'collapse',
    boxSizing: 'border-box',
    width: '100%',
  },
  tableCell: {
    borderBottom: '1px solid GrayText',
    padding: '0.5rem',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  textarea: {
    minHeight: '5rem',
    resize: 'vertical',
  },
} as const satisfies Readonly<Record<string, PreviewGeneratedUiSemanticStyle>>;

/**
 * Generates runtime helpers consumed only by the private generated-UI fallback namespace.
 *
 * Authored inline styles are applied after defaults. A non-object authored value is preserved
 * verbatim rather than being replaced, even though React normally expects a style object. For
 * `asChild`, both the child's style and the wrapper's style participate, with wrapper props last.
 */
export function createPreviewGeneratedUiSemanticStyleRuntimeSource(): readonly string[] {
  return Object.freeze([
    `const generatedUiSemanticStyles = Object.freeze(${JSON.stringify(SEMANTIC_STYLE_PALETTE)});`,
    '/** Reads a compound or direct role suffix without depending on one design-system API. */',
    'const readGeneratedUiFamilyPart = (name, family) => {',
    '  const leafName = readLeafName(name);',
    '  if (leafName === family) return "";',
    '  if (leafName.startsWith(family)) return leafName.slice(family.length);',
    '  return name.includes(family + ".") ? leafName : undefined;',
    '};',
    '/** Chooses a restrained role style; unknown names deliberately remain unstyled. */',
    'const readGeneratedUiSemanticStyle = (name, hostTag) => {',
    '  const leafName = readLeafName(name);',
    '  const overlayFamily = overlayFamilies.find((family) =>',
    '    readGeneratedUiFamilyPart(name, family) !== undefined',
    '  );',
    '  if (overlayFamily !== undefined) {',
    '    const part = readGeneratedUiFamilyPart(name, overlayFamily);',
    '    if (part === "Overlay") return generatedUiSemanticStyles.overlayBackdrop;',
    '    if (part === "Content") {',
    '      return overlayFamily === "Popover" || overlayFamily === "HoverCard" || overlayFamily === "Tooltip"',
    '        ? { ...generatedUiSemanticStyles.overlaySurface, ...generatedUiSemanticStyles.popoverSurface }',
    '        : generatedUiSemanticStyles.overlaySurface;',
    '    }',
    '    if (part === "Header") return generatedUiSemanticStyles.overlayHeader;',
    '    if (part === "Footer") return generatedUiSemanticStyles.overlayFooter;',
    '    if (part === "Title") return generatedUiSemanticStyles.overlayTitle;',
    '    if (part === "Description") return generatedUiSemanticStyles.overlayDescription;',
    '    if (part === "Trigger" || part === "Close") return generatedUiSemanticStyles.button;',
    '  }',
    '  const cardPart = readGeneratedUiFamilyPart(name, "Card");',
    '  if (cardPart === "" || (cardPart === undefined && /Card$/u.test(leafName)))',
    '    return generatedUiSemanticStyles.card;',
    '  if (cardPart === "Header") return generatedUiSemanticStyles.cardHeader;',
    '  if (cardPart === "Content") return generatedUiSemanticStyles.cardContent;',
    '  if (cardPart === "Footer") return generatedUiSemanticStyles.cardFooter;',
    '  if (cardPart === "Title") return generatedUiSemanticStyles.cardTitle;',
    '  if (cardPart === "Description") return generatedUiSemanticStyles.cardDescription;',
    '  const accordionPart = readGeneratedUiFamilyPart(name, "Accordion");',
    '  if (accordionPart === "") return generatedUiSemanticStyles.accordionRoot;',
    '  if (accordionPart === "Item") return generatedUiSemanticStyles.accordionItem;',
    '  if (accordionPart === "Trigger") return generatedUiSemanticStyles.accordionTrigger;',
    '  if (accordionPart === "Content") return generatedUiSemanticStyles.accordionContent;',
    '  if (/Badge$/u.test(leafName)) return generatedUiSemanticStyles.badge;',
    '  if (/(?:Button|Trigger|Close)$/u.test(leafName)) return generatedUiSemanticStyles.button;',
    '  if (hostTag === "input" || hostTag === "textarea") {',
    '    return hostTag === "textarea"',
    '      ? { ...generatedUiSemanticStyles.field, ...generatedUiSemanticStyles.textarea }',
    '      : generatedUiSemanticStyles.field;',
    '  }',
    '  if (/Label$/u.test(leafName)) return generatedUiSemanticStyles.label;',
    '  if (/(?:Separator|Divider)$/u.test(leafName)) return generatedUiSemanticStyles.separator;',
    '  if (/Spinner$/u.test(leafName)) return generatedUiSemanticStyles.spinner;',
    '  if (/Skeleton$/u.test(leafName)) return generatedUiSemanticStyles.skeleton;',
    '  if (hostTag === "table") return generatedUiSemanticStyles.table;',
    '  if (hostTag === "th" || hostTag === "td") return generatedUiSemanticStyles.tableCell;',
    '  return undefined;',
    '};',
    '/** Installs recurring fallback keyframes once, and only when the final style references them. */',
    `const generatedUiAnimationStyleId = ${JSON.stringify(GENERATED_UI_ANIMATION_STYLE_ID)};`,
    `const generatedUiAnimationCss = ${JSON.stringify(GENERATED_UI_ANIMATION_CSS)};`,
    'const ensureGeneratedUiSemanticAnimationStyles = (style) => {',
    '  const animation = style?.animation;',
    '  if (typeof animation !== "string" || !animation.includes("react-preview-generated-ui-")) return;',
    '  if (typeof document !== "object" || document === null) return;',
    '  try {',
    '    const existing = typeof document.getElementById === "function"',
    '      ? document.getElementById(generatedUiAnimationStyleId)',
    '      : undefined;',
    '    if (existing !== undefined && existing !== null) return;',
    '    if (typeof document.createElement !== "function") return;',
    '    const styleElement = document.createElement("style");',
    '    styleElement.id = generatedUiAnimationStyleId;',
    '    styleElement.textContent = generatedUiAnimationCss;',
    '    const styleHost = document.head ?? document.documentElement;',
    '    if (typeof styleHost?.append === "function") styleHost.append(styleElement);',
    '    else if (typeof styleHost?.appendChild === "function") styleHost.appendChild(styleElement);',
    '  } catch {',
    '    // A partial or read-only preview document must not turn visual recovery into a render error.',
    '  }',
    '};',
    '/** Merges defaults first so every authored inline declaration remains authoritative. */',
    'const mergeGeneratedUiSemanticStyle = (fallbackStyle, authoredStyles) => {',
    '  if (fallbackStyle === undefined) return undefined;',
    '  const mergedStyle = { ...fallbackStyle };',
    '  for (const authoredStyle of authoredStyles) {',
    '    if (authoredStyle === undefined || authoredStyle === null) continue;',
    '    if (typeof authoredStyle !== "object" || Array.isArray(authoredStyle)) return authoredStyle;',
    '    Object.assign(mergedStyle, authoredStyle);',
    '  }',
    '  ensureGeneratedUiSemanticAnimationStyles(mergedStyle);',
    '  return mergedStyle;',
    '};',
  ]);
}
