/**
 * Generates an inert ESM bridge for one statically selected parent-render slice.
 *
 * The reverse component graph is intentionally kept outside this module. Its only input is an
 * already selected target plus an inner-to-outer list of wrapper frames. Keeping discovery and
 * code generation separate makes the security boundary easy to audit: this file accepts import
 * references and primitive data, never source expressions, callbacks, or arbitrary JavaScript.
 */
import path from 'node:path';

const MAX_FRAME_COUNT = 32;
const MAX_PROPS_PER_FRAME = 64;
const MAX_IMPORT_SPECIFIER_LENGTH = 4_096;
const MAX_PROP_NAME_LENGTH = 512;
const MAX_STRING_PROP_LENGTH = 65_536;
const BLOCKED_PROP_NAMES = new Set(['__proto__', 'constructor', 'key', 'prototype', 'ref']);
const RELATIVE_SPECIFIER_PATTERN = /^\.\.?(?:[/\\]|$)/u;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/u;
const IMPORT_NAME_PATTERN = /^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u;
const INTRINSIC_NAME_PATTERN = /^[a-z][A-Za-z\d]*(?:-[A-Za-z\d]+)*$/u;

/** JSON-safe value admitted from a statically inspected JSX attribute. */
export type PreviewParentSliceStaticValue = boolean | number | string | null;

/**
 * Determines how a wrapper receives the selected descendant.
 *
 * `children` models ordinary JSX nesting. `render-function` models a render-prop boundary such as
 * a form whose `children` value must be called before it yields the selected descendant.
 */
export type PreviewParentSliceChildMode = 'children' | 'render-function';

/** Static props copied from one selected JSX wrapper occurrence. */
export type PreviewParentSliceStaticProps = Readonly<Record<string, PreviewParentSliceStaticValue>>;

/**
 * Identifies an import exactly as it appeared from one consumer source file.
 *
 * Relative specifiers are resolved from `consumerSourcePath`, producing an absolute normalized
 * import in the generated bridge. Package and workspace-alias specifiers remain unchanged so the
 * compiler can apply the project's ordinary resolution policy.
 */
export interface PreviewParentSliceImportReference {
  /** Absolute source path containing the original import declaration. */
  readonly consumerSourcePath: string;
  /** `default` or a validated ECMAScript export identifier. */
  readonly exportName: string;
  /** Relative, absolute, package, or workspace-alias module specifier. */
  readonly moduleSpecifier: string;
}

/** Wrapper frame rendered as a browser-owned intrinsic element such as `div` or `section`. */
export interface PreviewParentSliceIntrinsicFrame {
  /** Discriminant preventing caller-controlled expressions from becoming element types. */
  readonly kind: 'intrinsic';
  /** Conservative React intrinsic or custom-element tag name. */
  readonly tagName: string;
  /** Primitive attributes copied without evaluating their original expressions. */
  readonly props?: PreviewParentSliceStaticProps;
  /** Whether the selected descendant is passed directly or through a zero-argument callback. */
  readonly childMode: PreviewParentSliceChildMode;
}

/** Wrapper frame rendered through one validated named or default import. */
export interface PreviewParentSliceImportedFrame {
  /** Discriminant selecting a statically imported component binding. */
  readonly kind: 'imported';
  /** Exact import reference selected by reverse JSX analysis. */
  readonly importReference: PreviewParentSliceImportReference;
  /** Primitive attributes copied without evaluating their original expressions. */
  readonly props?: PreviewParentSliceStaticProps;
  /** Whether the selected descendant is passed directly or through a zero-argument callback. */
  readonly childMode: PreviewParentSliceChildMode;
}

/** One safe wrapper on the unique JSX ancestor path around the preview target. */
export type PreviewParentSliceFrame =
  PreviewParentSliceImportedFrame | PreviewParentSliceIntrinsicFrame;

/** Complete, bounded input used to generate one parent-slice ESM module. */
export interface PreviewParentSliceSourceOptions {
  /** Target component import rendered at the innermost node. */
  readonly target: PreviewParentSliceImportReference;
  /** Selected wrapper frames ordered from the target's immediate parent to the outermost parent. */
  readonly wrappers: readonly PreviewParentSliceFrame[];
}

/** Normalized import identity and the private local binding allocated by the generator. */
interface RegisteredImport {
  readonly bindingName: string;
  readonly exportName: string;
  readonly moduleSpecifier: string;
}

/** Mutable registry used only while one deterministic source module is being generated. */
interface ImportRegistry {
  readonly imports: RegisteredImport[];
  readonly referenceBindings: Map<string, string>;
}

/**
 * Builds an ESM default component that composes only the selected wrapper path around a target.
 *
 * The returned component forwards runtime target props to the target itself. Wrapper props remain
 * frozen primitive literals. Every render-prop callback closes over an immutable preceding node,
 * avoiding the self-reference bug caused by closing over a reassigned `child` variable.
 *
 * @param options Validated target import and inner-to-outer wrapper frames.
 * @returns Self-contained ESM source importing React, the target, and selected wrappers only.
 * @throws {TypeError} When an identifier, path, tag, prop name, or value violates the safe subset.
 */
export function createPreviewParentSliceSource(options: PreviewParentSliceSourceOptions): string {
  if (options.wrappers.length > MAX_FRAME_COUNT) {
    throw new TypeError(`React preview parent slice exceeds ${MAX_FRAME_COUNT.toString()} frames.`);
  }

  const registry: ImportRegistry = { imports: [], referenceBindings: new Map() };
  const targetBinding = registerImport(registry, options.target);
  const frameBindings = options.wrappers.map((frame) =>
    frame.kind === 'imported'
      ? registerImport(registry, frame.importReference)
      : validateIntrinsicName(frame.tagName),
  );
  const importLines = createImportLines(registry.imports);
  const propLines = options.wrappers.map((frame, index) => {
    const serializedProps = serializeStaticProps(frame.props ?? {}, index);
    return `const __reactPreviewFrameProps${index.toString()} = Object.freeze(${serializedProps});`;
  });
  const nodeLines = [
    `  const __reactPreviewNode0 = __reactPreviewCreateElement(${targetBinding}, __reactPreviewTargetProps);`,
  ];

  for (const [index, frame] of options.wrappers.entries()) {
    const childNode = `__reactPreviewNode${index.toString()}`;
    const wrapperNode = `__reactPreviewNode${(index + 1).toString()}`;
    const frameBinding = frameBindings[index];
    if (frameBinding === undefined) {
      throw new TypeError(
        `Missing React preview parent-slice frame binding at index ${index.toString()}.`,
      );
    }
    const elementType = frame.kind === 'intrinsic' ? JSON.stringify(frameBinding) : frameBinding;
    const childExpression =
      frame.childMode === 'render-function' ? `() => ${childNode}` : childNode;
    nodeLines.push(
      `  const ${wrapperNode} = __reactPreviewCreateElement(${elementType}, __reactPreviewFrameProps${index.toString()}, ${childExpression});`,
    );
  }

  const outermostNode = `__reactPreviewNode${options.wrappers.length.toString()}`;
  return [
    'import { createElement as __reactPreviewCreateElement } from "react";',
    ...importLines,
    ...propLines,
    '/** Renders the statically selected parent slice around the original target component. */',
    'export default function ReactPreviewParentSlice(__reactPreviewTargetProps) {',
    ...nodeLines,
    `  return ${outermostNode};`,
    '}',
  ].join('\n');
}

/**
 * Registers one normalized import and reuses its binding for duplicate frames.
 *
 * @param registry Per-module import registry.
 * @param reference Import declaration metadata from static analysis.
 * @returns Private generated binding that refers to the imported value.
 */
function registerImport(
  registry: ImportRegistry,
  reference: PreviewParentSliceImportReference,
): string {
  validateExportName(reference.exportName);
  const moduleSpecifier = resolveImportSpecifier(reference);
  const referenceKey = `${moduleSpecifier}\u0000${reference.exportName}`;
  const existingBinding = registry.referenceBindings.get(referenceKey);
  if (existingBinding !== undefined) {
    return existingBinding;
  }

  const bindingName = `__reactPreviewImport${registry.imports.length.toString()}`;
  registry.imports.push({ bindingName, exportName: reference.exportName, moduleSpecifier });
  registry.referenceBindings.set(referenceKey, bindingName);
  return bindingName;
}

/**
 * Emits at most one import declaration per module while retaining distinct exported bindings.
 *
 * @param imports Unique normalized import references in first-use order.
 * @returns Deterministic ESM import declarations.
 */
function createImportLines(imports: readonly RegisteredImport[]): string[] {
  const importsByModule = new Map<string, RegisteredImport[]>();
  for (const registeredImport of imports) {
    const moduleImports = importsByModule.get(registeredImport.moduleSpecifier);
    if (moduleImports === undefined) {
      importsByModule.set(registeredImport.moduleSpecifier, [registeredImport]);
    } else {
      moduleImports.push(registeredImport);
    }
  }

  return [...importsByModule].map(([moduleSpecifier, moduleImports]) => {
    const bindings = moduleImports
      .map(
        (registeredImport) => `${registeredImport.exportName} as ${registeredImport.bindingName}`,
      )
      .join(', ');
    return `import { ${bindings} } from ${JSON.stringify(moduleSpecifier)};`;
  });
}

/**
 * Converts a relative consumer import into a normalized absolute module specifier.
 *
 * @param reference Original import reference and its containing source file.
 * @returns Absolute normalized path for relative imports, otherwise the unchanged safe specifier.
 */
function resolveImportSpecifier(reference: PreviewParentSliceImportReference): string {
  const moduleSpecifier = reference.moduleSpecifier;
  if (
    moduleSpecifier.length === 0 ||
    moduleSpecifier.length > MAX_IMPORT_SPECIFIER_LENGTH ||
    moduleSpecifier.includes('\0') ||
    moduleSpecifier.includes('\n') ||
    moduleSpecifier.includes('\r')
  ) {
    throw new TypeError('Invalid React preview parent-slice module specifier.');
  }
  const absoluteSpecifier = path.isAbsolute(moduleSpecifier);
  if (!absoluteSpecifier && URL_SCHEME_PATTERN.test(moduleSpecifier)) {
    throw new TypeError(
      `URL imports are not allowed in a React preview parent slice: ${moduleSpecifier}`,
    );
  }

  if (!RELATIVE_SPECIFIER_PATTERN.test(moduleSpecifier)) {
    return absoluteSpecifier
      ? path.normalize(moduleSpecifier).replaceAll('\\', '/')
      : moduleSpecifier;
  }
  if (!path.isAbsolute(reference.consumerSourcePath)) {
    throw new TypeError(
      `Relative parent-slice import requires an absolute consumer source path: ${reference.consumerSourcePath}`,
    );
  }

  return path
    .normalize(path.resolve(path.dirname(reference.consumerSourcePath), moduleSpecifier))
    .replaceAll('\\', '/');
}

/**
 * Serializes primitive frame props into inert JavaScript object syntax.
 *
 * @param props Caller-supplied static attributes.
 * @param frameIndex Index used to make validation failures actionable.
 * @returns JSON object source with line-separator characters escaped explicitly.
 */
function serializeStaticProps(props: PreviewParentSliceStaticProps, frameIndex: number): string {
  const prototype = Object.getPrototypeOf(props) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      `React preview parent-slice frame ${frameIndex.toString()} props must be a plain object.`,
    );
  }

  const propNames = Object.getOwnPropertyNames(props);
  if (propNames.length > MAX_PROPS_PER_FRAME) {
    throw new TypeError(
      `React preview parent-slice frame ${frameIndex.toString()} exceeds ${MAX_PROPS_PER_FRAME.toString()} props.`,
    );
  }

  const entries: [string, PreviewParentSliceStaticValue][] = [];
  for (const propName of propNames) {
    validatePropName(propName, frameIndex);
    const descriptor = Object.getOwnPropertyDescriptor(props, propName);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(
        `Accessor React preview parent-slice prop "${propName}" on frame ${frameIndex.toString()} is not allowed.`,
      );
    }
    const value: unknown = descriptor.value;
    validateStaticValue(value, propName, frameIndex);
    entries.push([propName, value]);
  }
  return JSON.stringify(Object.fromEntries(entries))
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/** Rejects reserved React fields and prototype-pollution keys before source generation. */
function validatePropName(propName: string, frameIndex: number): void {
  if (
    propName.length === 0 ||
    propName.length > MAX_PROP_NAME_LENGTH ||
    propName.includes('\0') ||
    BLOCKED_PROP_NAMES.has(propName)
  ) {
    throw new TypeError(
      `Unsafe React preview parent-slice prop "${propName}" on frame ${frameIndex.toString()}.`,
    );
  }
}

/** Rejects non-primitive, non-finite, and unbounded values at the code-generation boundary. */
function validateStaticValue(
  value: unknown,
  propName: string,
  frameIndex: number,
): asserts value is PreviewParentSliceStaticValue {
  const isAllowedPrimitive =
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string';
  if (
    !isAllowedPrimitive ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    (typeof value === 'string' && value.length > MAX_STRING_PROP_LENGTH)
  ) {
    throw new TypeError(
      `Non-static React preview parent-slice prop "${propName}" on frame ${frameIndex.toString()}.`,
    );
  }
}

/** Validates names interpolated into an ESM import specifier. */
function validateExportName(exportName: string): void {
  if (exportName !== 'default' && !IMPORT_NAME_PATTERN.test(exportName)) {
    throw new TypeError(`Invalid React preview parent-slice export name: ${exportName}`);
  }
}

/** Validates intrinsic tag strings before they become React element types. */
function validateIntrinsicName(tagName: string): string {
  if (!INTRINSIC_NAME_PATTERN.test(tagName)) {
    throw new TypeError(`Invalid React preview parent-slice intrinsic name: ${tagName}`);
  }
  return tagName;
}
