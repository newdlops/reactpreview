/**
 * Builds deterministic runtime-hook fallback objects from statically observed property paths.
 *
 * Keeping tree construction separate from hook discovery makes the inference boundary reusable and
 * keeps the source transformer readable. Collection callback metadata is retained recursively, so
 * a navigation model such as categories → groups → pages is represented by one authentic nested
 * value instead of stopping at the first array method.
 */
import { inferPreviewRuntimeSemanticFallback } from './previewRuntimeHookSemantics';
import type { PreviewRuntimeHookAliasUsagePath } from './previewRuntimeHookAliasUsage';
import { createPreviewRuntimeCallableFallbackExpression } from './previewRuntimeCallableFallback';

/** Mutable property tree used only while serializing one hook result. */
interface PreviewRuntimeHookUsageNode {
  /** Nested required properties for an object container. */
  readonly children: Map<string, PreviewRuntimeHookUsageNode>;
  /** Static leaf expression, omitted while the node remains an object container. */
  expression?: string;
}

/** Fully serialized shape and the normalized requirement paths that produced it. */
export interface PreviewRuntimeHookUsageTreeFallback {
  /** Side-effect-free JavaScript expression used by the preview runtime. */
  readonly expression: string;
  /** Minimal de-duplicated paths displayed by the Inspector and used for partial-value repair. */
  readonly requiredPaths: readonly string[];
}

/**
 * Creates one fallback tree from local property, call, string, and collection evidence.
 *
 * @param paths Raw usage paths collected in source order.
 * @returns A frozen-expression string plus minimal normalized requirements.
 */
export function createPreviewRuntimeHookUsageTreeFallback(
  paths: readonly PreviewRuntimeHookAliasUsagePath[],
): PreviewRuntimeHookUsageTreeFallback {
  const completedPaths = deduplicatePreviewRuntimeHookUsagePaths(paths);
  const root: PreviewRuntimeHookUsageNode = { children: new Map() };
  for (const path_ of completedPaths) addUsagePath(root, path_);
  return Object.freeze({
    expression: serializeUsageNode(root),
    requiredPaths: Object.freeze(completedPaths.flatMap(formatPreviewRuntimeHookUsagePaths)),
  });
}

/** Keeps one deterministic occurrence of every demanded path and merges callback-item evidence. */
function deduplicatePreviewRuntimeHookUsagePaths(
  paths: readonly PreviewRuntimeHookAliasUsagePath[],
): readonly PreviewRuntimeHookAliasUsagePath[] {
  const retained = new Map<string, PreviewRuntimeHookAliasUsagePath>();
  for (const path_ of paths) {
    const terminalKind =
      path_.valueExpression === undefined
        ? (path_.collectionProperty ?? path_.stringProperty ?? (path_.called ? 'call' : 'value'))
        : 'expression';
    const key = `${path_.names.join('.')}\u0000${terminalKind}`;
    const existing = retained.get(key);
    if (existing === undefined) {
      retained.set(key, path_);
      continue;
    }
    const itemRequiredPaths = [
      ...new Set([
        ...(existing.collectionItemRequiredPaths ?? []),
        ...(path_.collectionItemRequiredPaths ?? []),
      ]),
    ];
    retained.set(key, {
      ...existing,
      ...(existing.callResultExpression === undefined && path_.callResultExpression !== undefined
        ? { callResultExpression: path_.callResultExpression }
        : {}),
      ...(existing.collectionItemExpression === undefined &&
      path_.collectionItemExpression !== undefined
        ? { collectionItemExpression: path_.collectionItemExpression }
        : {}),
      ...(itemRequiredPaths.length === 0
        ? {}
        : { collectionItemRequiredPaths: Object.freeze(itemRequiredPaths) }),
    });
  }
  const retainedPaths = [...retained.values()];
  return retainedPaths.filter((path_) => {
    if (
      path_.called ||
      path_.collectionProperty !== undefined ||
      path_.stringProperty !== undefined ||
      path_.valueExpression !== undefined
    ) {
      return true;
    }
    /*
     * A specialized use on the same receiver is stronger than a plain existence read. Keeping
     * both can make a generic object requirement race with the array/string shape that satisfies
     * authored code.
     */
    return !retainedPaths.some(
      (candidate) =>
        candidate !== path_ &&
        candidate.names.length === path_.names.length &&
        candidate.names.every((name, index) => name === path_.names[index]) &&
        (candidate.called ||
          candidate.collectionProperty !== undefined ||
          candidate.stringProperty !== undefined ||
          candidate.valueExpression !== undefined),
    );
  });
}

/** Formats receiver evidence as the authored collection access instead of a fake own method. */
function formatPreviewRuntimeHookUsagePath(path_: PreviewRuntimeHookAliasUsagePath): string {
  const base = path_.names.join('.');
  if (path_.stringProperty !== undefined) return `${base}.${path_.stringProperty}()`;
  if (path_.collectionProperty === undefined) return base + (path_.called ? '()' : '');
  if (path_.collectionProperty === 'spread' || path_.collectionProperty === '[]') {
    return `${base}[]`;
  }
  const suffix = path_.collectionProperty + (path_.collectionProperty === 'length' ? '' : '()');
  return base.length === 0 ? suffix : `${base}.${suffix}`;
}

/** Propagates collection callback fields so generated list items satisfy nested render use. */
function formatPreviewRuntimeHookUsagePaths(
  path_: PreviewRuntimeHookAliasUsagePath,
): readonly string[] {
  const base = formatPreviewRuntimeHookUsagePath(path_);
  if (
    path_.collectionProperty === undefined ||
    path_.collectionProperty === 'length' ||
    path_.collectionProperty === 'spread' ||
    (path_.collectionItemRequiredPaths?.length ?? 0) === 0
  ) {
    return [base];
  }
  const receiver = path_.names.join('.');
  const itemPrefix = receiver.length === 0 ? '[]' : `${receiver}[]`;
  return [
    base,
    ...(path_.collectionItemRequiredPaths ?? []).map((itemPath) =>
      itemPath === '<root>' ? itemPrefix : `${itemPrefix}.${itemPath}`,
    ),
  ];
}

/** Adds one property path while preserving any stronger expression already inferred at its leaf. */
function addUsagePath(
  root: PreviewRuntimeHookUsageNode,
  path_: PreviewRuntimeHookAliasUsagePath,
): void {
  if (path_.names.length === 0) {
    /*
     * A value-choice alias can preserve the hook root itself:
     * `const data = hookResult || {}; data.map(...)`.
     * There is no property segment to enter in that case, but the collection/call evidence still
     * constrains the root value. Dropping it serializes `{}` and merely moves failure to `.map()`.
     */
    root.expression = createUsagePathExpression(path_, 'value', root.expression);
    return;
  }
  let current = root;
  for (const [index, propertyName] of path_.names.entries()) {
    let child = current.children.get(propertyName);
    if (child === undefined) {
      child = { children: new Map() };
      current.children.set(propertyName, child);
    }
    current = child;
    if (index !== path_.names.length - 1) continue;
    current.expression = createUsagePathExpression(path_, propertyName, current.expression);
  }
}

/** Chooses the strongest terminal expression for one normalized usage path. */
function createUsagePathExpression(
  path_: PreviewRuntimeHookAliasUsagePath,
  semanticName: string,
  existingExpression?: string,
): string {
  return (
    path_.valueExpression ??
    (path_.collectionProperty !== undefined
      ? path_.collectionItemExpression === undefined
        ? 'Object.freeze([])'
        : `Object.freeze([${path_.collectionItemExpression}])`
      : path_.stringProperty !== undefined
        ? JSON.stringify(createPreviewRuntimeSemanticString(semanticName))
        : path_.called
          ? createPreviewRuntimeCallableFallbackExpression(path_.callResultExpression)
          : (existingExpression ??
            inferPreviewRuntimeSemanticFallback(semanticName)?.expression ??
            'Object.freeze({})'))
  );
}

/** Creates a short stable string leaf without exposing arbitrary application text. */
function createPreviewRuntimeSemanticString(propertyName: string): string {
  const fallback = inferPreviewRuntimeSemanticFallback(propertyName);
  if (fallback?.label === 'generated string') {
    try {
      const parsed = JSON.parse(fallback.expression) as unknown;
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Fall through to the readable key name when a future expression is not JSON text.
    }
  }
  return propertyName;
}

/** Serializes one usage tree into deeply frozen plain containers and inferred leaves. */
function serializeUsageNode(node: PreviewRuntimeHookUsageNode): string {
  if (node.children.size === 0) return node.expression ?? 'Object.freeze({})';
  const properties = [...node.children]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([propertyName, child]) => `${JSON.stringify(propertyName)}: ${serializeUsageNode(child)}`,
    );
  return `Object.freeze({ ${properties.join(', ')} })`;
}
