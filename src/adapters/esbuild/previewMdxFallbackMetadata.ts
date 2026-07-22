/**
 * Builds deterministic metadata and browser-safe module fallbacks for project-owned MDX documents.
 * This module deliberately operates on source text and the extension-owned MDX syntax tree only;
 * it never imports or evaluates a workspace's MDX, framework, remark, or rehype configuration.
 */
import ts from 'typescript';
import { parseDocument } from 'yaml';

const FRONTMATTER_PATTERN =
  /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u;
const MAX_FRONTMATTER_BYTES = 128 * 1024;
const MAX_FRONTMATTER_DEPTH = 8;
const MAX_FRONTMATTER_ENTRIES = 2_048;
const MAX_FRONTMATTER_KEYS = 256;
const MAX_FRONTMATTER_ARRAY_ITEMS = 256;
const MAX_FRONTMATTER_STRING_LENGTH = 8_192;
const MAX_TOC_ITEMS = 256;
const MAX_STRUCTURED_CONTENT_ITEMS = 512;
const MAX_STRUCTURED_CONTENT_BYTES = 256 * 1024;
const MAX_METADATA_TEXT_LENGTH = 4_096;
const MAX_AST_VISIT_NODES = 32_768;
const MAX_AST_DEPTH = 128;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** JSON-compatible scalar, array, or object retained from untrusted frontmatter. */
export type PreviewMdxJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly PreviewMdxJsonValue[]
  | { readonly [key: string]: PreviewMdxJsonValue };

/** Sanitized frontmatter object exposed to generated preview modules. */
export type PreviewMdxFrontmatter = Readonly<Record<string, PreviewMdxJsonValue>>;

/** One heading link compatible with common MDX documentation table-of-contents contracts. */
export interface PreviewMdxTocItem {
  /** Heading nesting depth from one through six. */
  readonly depth: number;
  /** Plain-text heading label safe to render in a navigation list. */
  readonly title: string;
  /** Fragment URL matching the generated heading identifier. */
  readonly url: string;
}

/** Search-oriented heading retained without framework-specific AST values. */
export interface PreviewMdxStructuredHeading {
  /** Stable identifier shared with the rendered heading and TOC URL. */
  readonly id: string;
  /** Plain-text heading content. */
  readonly content: string;
}

/** Search-oriented body text associated with the nearest preceding heading. */
export interface PreviewMdxStructuredContent {
  /** Nearest heading identifier; omitted for leading document content. */
  readonly heading?: string;
  /** Bounded plain text extracted from one semantic content block. */
  readonly content: string;
}

/** Generic structured-data shape used by documentation loaders such as Fumadocs. */
export interface PreviewMdxStructuredData {
  /** Bounded heading search records in document order. */
  readonly headings: readonly PreviewMdxStructuredHeading[];
  /** Bounded paragraph and code search records in document order. */
  readonly contents: readonly PreviewMdxStructuredContent[];
}

/** Metadata collected by the extension-owned remark pass. */
export interface PreviewMdxMetadata {
  /** Navigation entries derived from rendered headings. */
  readonly toc: readonly PreviewMdxTocItem[];
  /** Framework-neutral search records derived from semantic text nodes. */
  readonly structuredData: PreviewMdxStructuredData;
}

/** MDX body and safe data separated from an optional YAML frontmatter block. */
export interface PreviewMdxDocument {
  /** Source passed to the MDX compiler with frontmatter replaced by equivalent blank lines. */
  readonly bodyText: string;
  /** Sanitized JSON-compatible frontmatter. */
  readonly frontmatter: PreviewMdxFrontmatter;
  /** Non-fatal YAML or policy diagnostics surfaced as esbuild warnings. */
  readonly warnings: readonly string[];
}

/** Remark plugin plus a reader for metadata populated during one MDX compilation. */
export interface PreviewMdxMetadataCollector {
  /** Returns an immutable snapshot after the compiler has traversed the document. */
  readonly readMetadata: () => PreviewMdxMetadata;
  /** Extension-owned remark plugin supplied directly to `@mdx-js/mdx`. */
  readonly remarkPlugin: () => (tree: unknown) => void;
}

/** Minimal structural view of an mdast node used without importing project AST packages. */
interface PreviewMdxAstNode {
  /** Child nodes visited in authored document order. */
  readonly children?: readonly unknown[];
  /** Heading depth when the node is an mdast heading. */
  readonly depth?: unknown;
  /** Mutable compiler metadata used to assign generated heading IDs. */
  data?: unknown;
  /** Node discriminator such as `heading`, `paragraph`, or `text`. */
  readonly type?: unknown;
  /** Text, code, or image-alt payload depending on the node type. */
  readonly value?: unknown;
  /** Image alternative text when present. */
  readonly alt?: unknown;
  /** MDX JSX element name used only as bounded search evidence. */
  readonly name?: unknown;
}

/** Mutable accounting that bounds recursive frontmatter conversion. */
interface PreviewMdxSanitizationState {
  /** Total values admitted across the entire frontmatter object. */
  entries: number;
  /** Human-readable policy diagnostics emitted once conversion completes. */
  readonly warnings: string[];
}

/** Mutable metadata accumulated while remark walks one syntax tree. */
interface PreviewMdxMetadataState {
  /** Current heading identifier associated with subsequent content. */
  currentHeading?: string;
  /** Number of bytes admitted across structured content strings. */
  structuredContentBytes: number;
  /** Heading slug collision counters keyed by the unsuffixed base slug. */
  readonly slugCounts: Map<string, number>;
  /** Search content accumulated in document order. */
  readonly structuredContents: PreviewMdxStructuredContent[];
  /** Search headings accumulated in document order. */
  readonly structuredHeadings: PreviewMdxStructuredHeading[];
  /** Table-of-contents entries accumulated in document order. */
  readonly toc: PreviewMdxTocItem[];
  /** Total syntax-tree nodes visited under the hard traversal cap. */
  visitedNodes: number;
}

/**
 * Separates a leading YAML frontmatter block and converts it to bounded JSON-compatible data.
 * Invalid YAML is non-fatal because navigation shells can still render the compiled MDX body.
 *
 * @param sourceText UTF-8 MDX source read from the trusted workspace.
 * @returns Padded body, safe frontmatter, and warnings suitable for one esbuild load result.
 */
export function extractPreviewMdxDocument(sourceText: string): PreviewMdxDocument {
  const match = FRONTMATTER_PATTERN.exec(sourceText);
  if (match === null) {
    return Object.freeze({ bodyText: sourceText, frontmatter: Object.freeze({}), warnings: [] });
  }

  const rawFrontmatter = match[1] ?? '';
  const warnings: string[] = [];
  const frontmatter = parsePreviewMdxFrontmatter(rawFrontmatter, warnings);
  const consumedSource = match[0];
  const blankLineCount = countLineBreaks(consumedSource);
  const bodyText = `${'\n'.repeat(blankLineCount)}${sourceText.slice(consumedSource.length)}`;
  return Object.freeze({ bodyText, frontmatter, warnings: Object.freeze(warnings) });
}

/**
 * Creates a compilation-local remark pass that derives heading IDs, TOC entries, and search data.
 * The visitor accepts only structural mdast fields and imposes explicit node, depth, item, and byte
 * limits so a large or adversarial workspace document cannot create unbounded metadata output.
 *
 * @returns Plugin/reader pair used exactly once by the dedicated MDX fallback plugin.
 */
export function createPreviewMdxMetadataCollector(): PreviewMdxMetadataCollector {
  const state = createPreviewMdxMetadataState();

  /** Traverses the compiler-owned syntax tree without loading any workspace remark plugins. */
  function remarkPlugin(): (tree: unknown) => void {
    return (tree: unknown): void => {
      visitPreviewMdxNode(tree, state, 0);
    };
  }

  /** Freezes a detached metadata snapshot so later compiler mutation cannot leak into the bundle. */
  function readMetadata(): PreviewMdxMetadata {
    return freezePreviewMdxMetadata(state);
  }

  return Object.freeze({ readMetadata, remarkPlugin });
}

/**
 * Adds missing generic metadata exports to successfully compiled MDX JavaScript.
 * Authored exports always win; generated bindings use collision-free private identifiers so an
 * ordinary local declaration named `frontmatter`, `toc`, or `structuredData` remains untouched.
 *
 * @param compiledSource Program-format JSX emitted by the extension-owned MDX compiler.
 * @param frontmatter Safe frontmatter parsed before compilation.
 * @param metadata TOC and structured records collected by the extension-owned remark pass.
 * @returns Executable ESM source with every required fallback export present exactly once.
 */
export function completePreviewMdxModuleSource(
  compiledSource: string,
  frontmatter: PreviewMdxFrontmatter,
  metadata: PreviewMdxMetadata,
): string {
  const exportedNames = collectPreviewMdxExportNames(compiledSource);
  const generatedExports: string[] = [];
  appendPreviewMdxExport(
    generatedExports,
    compiledSource,
    exportedNames,
    'frontmatter',
    frontmatter,
  );
  appendPreviewMdxExport(generatedExports, compiledSource, exportedNames, 'toc', metadata.toc);
  appendPreviewMdxExport(
    generatedExports,
    compiledSource,
    exportedNames,
    'structuredData',
    metadata.structuredData,
  );
  return generatedExports.length === 0
    ? compiledSource
    : `${compiledSource}\n${generatedExports.join('\n')}\n`;
}

/**
 * Converts MDX 3's preserved automatic-runtime JSX preamble into a self-contained classic React
 * program. React 16.8 does not publish `react/jsx-runtime`, but it does provide `createElement` and
 * `Fragment`; forcing those stable APIs keeps the fallback aligned with the extension's documented
 * React floor. A collision-free namespace avoids changing authored MDX imports or exported names.
 *
 * The extension pins the MDX compiler and validates its generated preamble instead of silently
 * rewriting arbitrary workspace comments. A future compiler format change therefore becomes a
 * normal fail-soft MDX placeholder until this compatibility adapter is reviewed.
 *
 * @param compiledSource Program-format MDX output produced with `jsx: true`.
 * @returns JSX-bearing ESM whose local pragmas force esbuild's classic React transform.
 */
export function createPreviewMdxClassicReactModuleSource(compiledSource: string): string {
  const automaticPreamble = '/*@jsxRuntime automatic*/\n/*@jsxImportSource react*/\n';
  if (!compiledSource.startsWith(automaticPreamble)) {
    throw new Error('The extension MDX compiler emitted an unsupported JSX runtime preamble.');
  }
  const reactBinding = createUnusedPreviewMdxBinding(compiledSource, '__reactPreviewMdxReact');
  return [
    '/* @jsxRuntime classic */',
    `/* @jsx ${reactBinding}.createElement */`,
    `/* @jsxFrag ${reactBinding}.Fragment */`,
    `import * as ${reactBinding} from 'react';`,
    compiledSource.slice(automaticPreamble.length),
  ].join('\n');
}

/**
 * Creates a small renderable ESM module when MDX compilation or a resource budget is unavailable.
 * The placeholder exposes the same data contract as a successful module and renders bounded source
 * evidence instead of throwing, allowing unrelated page layouts and sibling components to survive.
 *
 * @param displayName Workspace-relative label shown when frontmatter has no usable title.
 * @param reason Bounded explanation attached to the placeholder for inspector visibility.
 * @param frontmatter Safe frontmatter retained even when body compilation fails.
 * @param metadata Metadata collected before a late compilation failure, or an empty snapshot.
 * @returns Browser-compatible JavaScript using React's classic `createElement` API.
 */
export function createPreviewMdxPlaceholderModuleSource(
  displayName: string,
  reason: string,
  frontmatter: PreviewMdxFrontmatter,
  metadata: PreviewMdxMetadata,
): string {
  const serializedFrontmatter = serializePreviewMdxValue(frontmatter);
  const serializedToc = serializePreviewMdxValue(metadata.toc);
  const serializedStructuredData = serializePreviewMdxValue(metadata.structuredData);
  const fallbackTitle = readPreviewMdxTitle(frontmatter) ?? displayName;
  const summaryItems = metadata.structuredData.contents.slice(0, 12).map((item) => item.content);
  return [
    "import * as __reactPreviewMdxReact from 'react';",
    `export const frontmatter = ${serializedFrontmatter};`,
    `export const toc = ${serializedToc};`,
    `export const structuredData = ${serializedStructuredData};`,
    `const __reactPreviewMdxFallbackTitle = ${JSON.stringify(fallbackTitle)};`,
    `const __reactPreviewMdxFallbackReason = ${JSON.stringify(boundMetadataText(reason))};`,
    `const __reactPreviewMdxFallbackSummary = ${JSON.stringify(summaryItems)};`,
    '/** Renders bounded static MDX evidence when the complete document cannot be compiled safely. */',
    'export default function ReactPreviewMdxFallback() {',
    "  return __reactPreviewMdxReact.createElement('article', {",
    "    'data-react-preview-mdx-fallback': 'true',",
    "    style: { border: '1px dashed currentColor', borderRadius: '0.5rem', padding: '1rem' },",
    '  },',
    "  __reactPreviewMdxReact.createElement('h1', null, __reactPreviewMdxFallbackTitle),",
    "  __reactPreviewMdxReact.createElement('p', { role: 'status' }, __reactPreviewMdxFallbackReason),",
    "  ...__reactPreviewMdxFallbackSummary.map((content, index) => __reactPreviewMdxReact.createElement('p', { key: index }, content)));",
    '}',
  ].join('\n');
}

/**
 * Creates the complete lightweight contract for an explicit `only=frontmatter` MDX request.
 * The default export is a valid null-rendering React component, while empty TOC and structured data
 * keep generic consumers safe without parsing or compiling the document body.
 *
 * @param frontmatter Safe mapping parsed from the leading YAML block.
 * @returns Browser-compatible ESM that contains no React or project imports.
 */
export function createPreviewMdxFrontmatterOnlyModuleSource(
  frontmatter: PreviewMdxFrontmatter,
): string {
  return [
    `export const frontmatter = ${serializePreviewMdxValue(frontmatter)};`,
    'export const toc = [];',
    'export const structuredData = { headings: [], contents: [] };',
    '/** Provides a valid component contract while an explicit metadata-only request skips the body. */',
    'export default function ReactPreviewMdxFrontmatterOnly() { return null; }',
  ].join('\n');
}

/**
 * Creates a renderable metadata-only module for eager documentation collection imports.
 * Catalog generators can import hundreds of `?collection=name` namespaces at once; compiling every
 * body would also traverse their component and style imports even though the catalog needs only a
 * small record. The placeholder retains bounded title/description context while exposing the same
 * four generic exports expected by Fumadocs-like server collectors.
 *
 * @param frontmatter Safe mapping parsed from the leading YAML block.
 * @param displayName Workspace-relative fallback label for entries without a title.
 * @returns Small React-16-compatible ESM with no authored body imports.
 */
export function createPreviewMdxCollectionMetadataModuleSource(
  frontmatter: PreviewMdxFrontmatter,
  displayName: string,
): string {
  const title = readPreviewMdxTitle(frontmatter) ?? boundMetadataText(displayName);
  const rawDescription = frontmatter.description;
  const description =
    typeof rawDescription === 'string' ? boundMetadataText(rawDescription.trim()) : '';
  return [
    "import * as __reactPreviewMdxReact from 'react';",
    `export const frontmatter = ${serializePreviewMdxValue(frontmatter)};`,
    'export const toc = [];',
    'export const structuredData = { headings: [], contents: [] };',
    `const __reactPreviewMdxCollectionTitle = ${JSON.stringify(title)};`,
    `const __reactPreviewMdxCollectionDescription = ${JSON.stringify(description)};`,
    '/** Renders bounded catalog identity while the eager collection skips its authored body. */',
    'export default function ReactPreviewMdxCollectionMetadata() {',
    "  return __reactPreviewMdxReact.createElement('article', {",
    "    'data-react-preview-mdx-collection': 'metadata-first',",
    "    style: { border: '1px dashed currentColor', borderRadius: '0.5rem', padding: '1rem' },",
    '  },',
    "  __reactPreviewMdxReact.createElement('h1', null, __reactPreviewMdxCollectionTitle),",
    '  __reactPreviewMdxCollectionDescription.length > 0',
    "    ? __reactPreviewMdxReact.createElement('p', null, __reactPreviewMdxCollectionDescription)",
    '    : null);',
    '}',
  ].join('\n');
}

/**
 * Returns an immutable empty metadata object for policy fallbacks that intentionally skip parsing.
 *
 * @returns Shared-shape empty TOC and structured data with no mutable arrays exposed.
 */
export function createEmptyPreviewMdxMetadata(): PreviewMdxMetadata {
  return Object.freeze({
    structuredData: Object.freeze({ contents: Object.freeze([]), headings: Object.freeze([]) }),
    toc: Object.freeze([]),
  });
}

/** Parses one bounded YAML document and converts it to a safe plain-object graph. */
function parsePreviewMdxFrontmatter(source: string, warnings: string[]): PreviewMdxFrontmatter {
  if (Buffer.byteLength(source, 'utf8') > MAX_FRONTMATTER_BYTES) {
    warnings.push('MDX frontmatter exceeded the 128 KiB preview limit and was replaced with {}.');
    return Object.freeze({});
  }
  try {
    const document = parseDocument(source, {
      prettyErrors: false,
      schema: 'core',
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      warnings.push(
        `MDX frontmatter was invalid and was replaced with {}: ${document.errors[0]?.message ?? 'YAML parse error'}`,
      );
      return Object.freeze({});
    }
    if (document.warnings.length > 0) {
      warnings.push(`MDX frontmatter warning: ${document.warnings[0]?.message ?? 'YAML warning'}`);
    }
    const state: PreviewMdxSanitizationState = { entries: 0, warnings };
    const sanitized = sanitizePreviewMdxValue(document.toJS({ maxAliasCount: 0 }), state, 0);
    if (!isPreviewMdxRecord(sanitized)) {
      warnings.push('MDX frontmatter must be a mapping and was replaced with {}.');
      return Object.freeze({});
    }
    return Object.freeze(sanitized);
  } catch (error) {
    warnings.push(
      `MDX frontmatter was invalid and was replaced with {}: ${boundMetadataText(describePreviewMdxError(error))}`,
    );
    return Object.freeze({});
  }
}

/** Recursively converts YAML output to a bounded JSON-compatible graph. */
function sanitizePreviewMdxValue(
  value: unknown,
  state: PreviewMdxSanitizationState,
  depth: number,
): PreviewMdxJsonValue {
  state.entries += 1;
  if (state.entries > MAX_FRONTMATTER_ENTRIES) {
    if (!state.warnings.includes('MDX frontmatter entries were truncated by the preview limit.')) {
      state.warnings.push('MDX frontmatter entries were truncated by the preview limit.');
    }
    return null;
  }
  if (depth > MAX_FRONTMATTER_DEPTH) {
    state.warnings.push('MDX frontmatter nesting exceeded the preview depth limit.');
    return null;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value === 'string' ? value.slice(0, MAX_FRONTMATTER_STRING_LENGTH) : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return Object.freeze(
      value
        .slice(0, MAX_FRONTMATTER_ARRAY_ITEMS)
        .map((item) => sanitizePreviewMdxValue(item, state, depth + 1)),
    );
  }
  if (typeof value !== 'object') return null;
  const output: Record<string, PreviewMdxJsonValue> = {};
  for (const [key, child] of Object.entries(value).slice(0, MAX_FRONTMATTER_KEYS)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) continue;
    output[key.slice(0, MAX_FRONTMATTER_STRING_LENGTH)] = sanitizePreviewMdxValue(
      child,
      state,
      depth + 1,
    );
  }
  return Object.freeze(output);
}

/** Creates fresh mutable accounting for one compilation-local metadata traversal. */
function createPreviewMdxMetadataState(): PreviewMdxMetadataState {
  return {
    slugCounts: new Map<string, number>(),
    structuredContentBytes: 0,
    structuredContents: [],
    structuredHeadings: [],
    toc: [],
    visitedNodes: 0,
  };
}

/** Walks one mdast subtree and records only bounded semantic text evidence. */
function visitPreviewMdxNode(value: unknown, state: PreviewMdxMetadataState, depth: number): void {
  if (
    depth > MAX_AST_DEPTH ||
    state.visitedNodes >= MAX_AST_VISIT_NODES ||
    !isPreviewMdxAstNode(value)
  ) {
    return;
  }
  state.visitedNodes += 1;
  recordPreviewMdxNode(value, state);
  for (const child of value.children ?? []) {
    visitPreviewMdxNode(child, state, depth + 1);
  }
}

/** Records heading, paragraph, code, and leaf JSX evidence from one syntax node. */
function recordPreviewMdxNode(node: PreviewMdxAstNode, state: PreviewMdxMetadataState): void {
  if (node.type === 'heading' && typeof node.depth === 'number') {
    recordPreviewMdxHeading(node, state, Math.min(6, Math.max(1, node.depth)));
    return;
  }
  if (node.type === 'paragraph' || node.type === 'code' || node.type === 'tableCell') {
    recordPreviewMdxStructuredContent(readPreviewMdxNodeText(node), state);
    return;
  }
  if (
    (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
    (node.children?.length ?? 0) === 0 &&
    typeof node.name === 'string'
  ) {
    recordPreviewMdxStructuredContent(`<${node.name}>`, state);
  }
}

/** Assigns a collision-free heading ID and mirrors it into TOC and structured search records. */
function recordPreviewMdxHeading(
  node: PreviewMdxAstNode,
  state: PreviewMdxMetadataState,
  depth: number,
): void {
  const title = boundMetadataText(readPreviewMdxNodeText(node).trim());
  if (title.length === 0) return;
  const id = createPreviewMdxHeadingId(title, state.slugCounts);
  assignPreviewMdxHeadingId(node, id);
  state.currentHeading = id;
  if (state.structuredHeadings.length < MAX_TOC_ITEMS) {
    state.structuredHeadings.push(Object.freeze({ content: title, id }));
  }
  if (state.toc.length < MAX_TOC_ITEMS) {
    state.toc.push(Object.freeze({ depth, title, url: `#${id}` }));
  }
}

/** Adds one body-text record while enforcing item and aggregate UTF-8 byte limits. */
function recordPreviewMdxStructuredContent(
  rawContent: string,
  state: PreviewMdxMetadataState,
): void {
  if (state.structuredContents.length >= MAX_STRUCTURED_CONTENT_ITEMS) return;
  const content = boundMetadataText(rawContent.trim());
  if (content.length === 0) return;
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (state.structuredContentBytes + contentBytes > MAX_STRUCTURED_CONTENT_BYTES) return;
  state.structuredContentBytes += contentBytes;
  state.structuredContents.push(
    Object.freeze({
      ...(state.currentHeading === undefined ? {} : { heading: state.currentHeading }),
      content,
    }),
  );
}

/** Extracts bounded plain text recursively from common mdast and MDX leaf fields. */
function readPreviewMdxNodeText(value: unknown, depth = 0): string {
  if (depth > MAX_AST_DEPTH || !isPreviewMdxAstNode(value)) return '';
  if (typeof value.value === 'string') return value.value;
  if (value.type === 'image' && typeof value.alt === 'string') return value.alt;
  return (value.children ?? [])
    .map((child) => readPreviewMdxNodeText(child, depth + 1))
    .filter((part) => part.length > 0)
    .join(' ');
}

/** Creates a stable Unicode-aware slug and adds a numeric suffix for duplicate headings. */
function createPreviewMdxHeadingId(title: string, counts: Map<string, number>): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .trim()
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-');
  const base = normalized.length === 0 ? 'section' : normalized;
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);
  return count === 1 ? base : `${base}-${count.toString()}`;
}

/** Mutates only the documented mdast `data.hProperties.id` field used by MDX rendering. */
function assignPreviewMdxHeadingId(node: PreviewMdxAstNode, id: string): void {
  const existingData = isUnknownRecord(node.data) ? node.data : {};
  const existingProperties = isUnknownRecord(existingData.hProperties)
    ? existingData.hProperties
    : {};
  node.data = { ...existingData, hProperties: { ...existingProperties, id } };
}

/** Freezes detached metadata arrays after the synchronous remark traversal has completed. */
function freezePreviewMdxMetadata(state: PreviewMdxMetadataState): PreviewMdxMetadata {
  return Object.freeze({
    structuredData: Object.freeze({
      contents: Object.freeze([...state.structuredContents]),
      headings: Object.freeze([...state.structuredHeadings]),
    }),
    toc: Object.freeze([...state.toc]),
  });
}

/** Uses TypeScript's syntax parser to discover already-authored ESM export names. */
function collectPreviewMdxExportNames(source: string): ReadonlySet<string> {
  const sourceFile = ts.createSourceFile(
    'react-preview-mdx-fallback.js',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      } else if (
        statement.exportClause !== undefined &&
        ts.isNamespaceExport(statement.exportClause)
      ) {
        names.add(statement.exportClause.name.text);
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add('default');
    }
    collectPreviewMdxDeclarationNames(statement, names);
  }
  return names;
}

/** Collects exported function, class, enum, and variable binding names from one declaration. */
function collectPreviewMdxDeclarationNames(statement: ts.Statement, names: Set<string>): void {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    names.add(statement.name.text);
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectPreviewMdxBindingNames(declaration.name, names);
    }
  }
}

/** Recursively collects identifiers from object and array destructuring declarations. */
function collectPreviewMdxBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectPreviewMdxBindingNames(element.name, names);
  }
}

/** Appends one collision-free generated binding only when MDX did not author that export. */
function appendPreviewMdxExport(
  output: string[],
  compiledSource: string,
  exportedNames: ReadonlySet<string>,
  exportName: 'frontmatter' | 'structuredData' | 'toc',
  value: unknown,
): void {
  if (exportedNames.has(exportName)) return;
  const baseBinding = `__reactPreviewMdxFallback${exportName[0]?.toLocaleUpperCase() ?? ''}${exportName.slice(1)}`;
  const binding = createUnusedPreviewMdxBinding(compiledSource, baseBinding);
  output.push(
    `const ${binding} = ${serializePreviewMdxValue(value)};`,
    `export { ${binding} as ${exportName} };`,
  );
}

/** Produces a private identifier absent from compiled source text. */
function createUnusedPreviewMdxBinding(source: string, base: string): string {
  let candidate = base;
  let suffix = 1;
  while (source.includes(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix.toString()}`;
  }
  return candidate;
}

/** Serializes only values already reduced to data-compatible structures. */
function serializePreviewMdxValue(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/** Selects a short string frontmatter title for placeholder rendering. */
function readPreviewMdxTitle(frontmatter: PreviewMdxFrontmatter): string | undefined {
  const title = frontmatter.title;
  return typeof title === 'string' && title.trim().length > 0
    ? boundMetadataText(title.trim())
    : undefined;
}

/** Counts LF delimiters so stripping frontmatter preserves downstream compiler line numbers. */
function countLineBreaks(value: string): number {
  return value.match(/\n/gu)?.length ?? 0;
}

/** Truncates metadata strings without retaining unbounded compiler or source text. */
function boundMetadataText(value: string): string {
  return value.length <= MAX_METADATA_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_METADATA_TEXT_LENGTH - 1)}…`;
}

/** Narrows a sanitized value to the plain object required by frontmatter consumers. */
function isPreviewMdxRecord(value: PreviewMdxJsonValue): value is PreviewMdxFrontmatter {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows an unknown compiler value to the structural mdast fields used by this module. */
function isPreviewMdxAstNode(value: unknown): value is PreviewMdxAstNode {
  return typeof value === 'object' && value !== null;
}

/** Narrows unknown metadata objects before copying their own enumerable properties. */
function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts an unknown compiler or parser failure to bounded diagnostic text. */
function describePreviewMdxError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
