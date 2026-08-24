/**
 * Describes project component imports that cross the next React boundary below a shallow shell.
 *
 * A fast Page Inspector corridor mounts direct page chrome such as Header and Sidebar
 * authentically, but following every component that those modules render recreates the full
 * application graph. This analyzer starts from the exact exported shallow component, follows only
 * bounded same-module value flow, and identifies imported React component boundaries that can be
 * replaced by structural placeholders. Project code is parsed as inert syntax and never executed.
 */
import { analyzePreviewRenderSource } from '../renderGraph/previewRenderSourceAnalysis';
import type {
  PreviewRenderImportFact,
  PreviewRenderLocalEdgeFact,
  PreviewRenderModuleFacts,
} from '../renderGraph/previewRenderModuleFacts';
import { collectPreviewRuntimeHookProjectionEvidence } from '../staticResources/previewRuntimeHookInstrumentation';
import { isPreviewInspectorSafeShallowVisualBinding } from './previewInspectorVisualBinding';

const MAXIMUM_LOCAL_VALUE_VISITS = 128;

/** Exact ESM surface required from one projected child component module. */
export interface PreviewInspectorShallowProjection {
  /** Runtime export spellings requested by the shallow shell's import or React.lazy adapter. */
  readonly exportNames: readonly string[];
  /** Authored module request used as the esbuild projection identity. */
  readonly moduleSpecifier: string;
  /**
   * Neutral descendant identity required when the component stands in for a route submodule.
   *
   * This metadata is syntax-proven by the static route analyzer. Keeping it on the shared
   * projection shape prevents a frozen bundle frontier from degrading an app module into a plain
   * React component that no longer satisfies its caller's `basePath`/page-list contract.
   */
  readonly neutralRouteBasePath?: string;
  /**
   * Export spellings represented by undefined-returning hook stubs instead of host placeholders.
   *
   * The importer is independently rewritten with a demand-shaped runtime fallback at each of these
   * calls. Keeping the semantic distinction here prevents a hook from becoming a React element.
   */
  readonly runtimeHookExportNames: readonly string[];
}

/** Bounded projection facts keyed by the importer-authored module request. */
export interface PreviewInspectorShallowProjectionInventory {
  /** Empty when root export flow is ambiguous or the local traversal exceeded its safety budget. */
  readonly projectionsBySpecifier: ReadonlyMap<string, PreviewInspectorShallowProjection>;
  /** True when failing open is required because local value flow exceeded the fixed visit budget. */
  readonly truncated: boolean;
}

/**
 * Finds direct imported component boundaries below selected shallow exports.
 *
 * A module request is projected only when every binding imported from that request participates in
 * supported React component flow. Mixed component/helper imports fail open so replacing a child can
 * never remove a constant, hook, or factory that the authentic shallow component still needs.
 */
export function collectPreviewInspectorShallowProjectionInventory(
  sourcePath: string,
  sourceText: string,
  rootExportNames: ReadonlySet<string>,
  rootRuntimeHookExportNames: ReadonlySet<string> = new Set(),
): PreviewInspectorShallowProjectionInventory {
  const facts = analyzePreviewRenderSource(sourcePath, sourceText).moduleFacts;
  const rootReexportProjections = collectRootReexportProjections(
    facts,
    rootExportNames,
    rootRuntimeHookExportNames,
  );
  const rootLocalNames = collectRootLocalNames(facts, rootExportNames);
  if (rootLocalNames.length === 0) {
    return freezeInventory(rootReexportProjections, false);
  }

  const runtimeHookCalls = groupRuntimeHookCallsByLocalName(
    collectPreviewRuntimeHookProjectionEvidence(sourcePath, sourceText),
  );
  const importsByLocalName = new Map(facts.imports.map((item) => [item.localName, item]));
  const importsBySpecifier = groupImportsBySpecifier(facts.imports);
  const valuesByLocalName = new Map(facts.values.map((item) => [item.localName, item]));
  const edgesByOwnerId = groupEdgesByOwnerId(facts.localEdges);
  const lazyImportsByOwnerId = new Map(
    facts.values.map((value) => [
      value.id,
      facts.lazyImports.filter((item) => item.ownerId === value.id),
    ]),
  );
  const componentLocalNamesBySpecifier = new Map<string, Set<string>>();
  const runtimeHookLocalNamesBySpecifier = new Map<string, Set<string>>();
  const exportNamesByLazySpecifier = new Map<string, Set<string>>();
  const unsafeSpecifiers = new Set<string>();
  const pending = [...rootLocalNames];
  const visitedLocalNames = new Set<string>();
  let truncated = false;

  while (pending.length > 0) {
    if (visitedLocalNames.size >= MAXIMUM_LOCAL_VALUE_VISITS) {
      truncated = true;
      break;
    }
    const localName = pending.shift();
    if (localName === undefined || visitedLocalNames.has(localName)) continue;
    visitedLocalNames.add(localName);
    const value = valuesByLocalName.get(localName);
    if (value === undefined) continue;

    for (const lazyImport of lazyImportsByOwnerId.get(value.id) ?? []) {
      appendSetValue(
        exportNamesByLazySpecifier,
        lazyImport.moduleSpecifier,
        lazyImport.importedName,
      );
    }
    for (const edge of edgesByOwnerId.get(value.id) ?? []) {
      const imported = importsByLocalName.get(edge.childLocalName);
      if (imported !== undefined) {
        if (isSupportedComponentBoundary(edge, imported)) {
          appendSetValue(
            componentLocalNamesBySpecifier,
            imported.moduleSpecifier,
            imported.localName,
          );
        } else if (isSupportedRuntimeHookBoundary(edge, imported, runtimeHookCalls)) {
          appendSetValue(
            runtimeHookLocalNamesBySpecifier,
            imported.moduleSpecifier,
            imported.localName,
          );
        } else {
          unsafeSpecifiers.add(imported.moduleSpecifier);
        }
        continue;
      }
      if (valuesByLocalName.has(edge.childLocalName)) {
        pending.push(edge.childLocalName);
      }
    }
  }

  if (truncated) return freezeInventory(new Map(), true);
  const projections = new Map(rootReexportProjections);
  const projectionSpecifiers = new Set([
    ...componentLocalNamesBySpecifier.keys(),
    ...runtimeHookLocalNamesBySpecifier.keys(),
  ]);
  for (const moduleSpecifier of projectionSpecifiers) {
    const componentLocalNames = componentLocalNamesBySpecifier.get(moduleSpecifier) ?? new Set();
    const runtimeHookLocalNames =
      runtimeHookLocalNamesBySpecifier.get(moduleSpecifier) ?? new Set();
    const importedBindings = importsBySpecifier.get(moduleSpecifier) ?? [];
    if (
      unsafeSpecifiers.has(moduleSpecifier) ||
      importedBindings.length === 0 ||
      importedBindings.some(
        (item) =>
          item.importedName === '*' ||
          (!componentLocalNames.has(item.localName) && !runtimeHookLocalNames.has(item.localName)),
      )
    ) {
      continue;
    }
    const exportNames = [...new Set(importedBindings.map((item) => item.importedName))].sort();
    const runtimeHookExportNames = [
      ...new Set(
        importedBindings.flatMap((item) =>
          runtimeHookLocalNames.has(item.localName) ? [item.importedName] : [],
        ),
      ),
    ].sort();
    if (
      importedBindings.some(
        (item) =>
          componentLocalNames.has(item.localName) &&
          runtimeHookExportNames.includes(item.importedName),
      )
    ) {
      continue;
    }
    projections.set(
      moduleSpecifier,
      Object.freeze({
        exportNames: Object.freeze(exportNames),
        moduleSpecifier,
        runtimeHookExportNames: Object.freeze(runtimeHookExportNames),
      }),
    );
  }
  for (const [moduleSpecifier, exportNames] of exportNamesByLazySpecifier) {
    if (unsafeSpecifiers.has(moduleSpecifier)) continue;
    const existing = projections.get(moduleSpecifier);
    const mergedNames = [...new Set([...(existing?.exportNames ?? []), ...exportNames])].sort();
    if (
      [...exportNames].some((exportName) => existing?.runtimeHookExportNames.includes(exportName))
    ) {
      projections.delete(moduleSpecifier);
      continue;
    }
    projections.set(
      moduleSpecifier,
      Object.freeze({
        exportNames: Object.freeze(mergedNames),
        moduleSpecifier,
        runtimeHookExportNames: existing?.runtimeHookExportNames ?? Object.freeze([]),
      }),
    );
  }
  return freezeInventory(projections, false);
}

/**
 * Collects only projections that remain safe across every runtime export in one authentic module.
 *
 * This is used when two authentic importers share a frontier-owned optional target. Considering
 * every exported local keeps helper, constant, and hook uses in the safety decision instead of
 * guessing which export caused the second importer to enter the authored closure.
 */
export function collectPreviewInspectorWholeModuleShallowProjectionInventory(
  sourcePath: string,
  sourceText: string,
): PreviewInspectorShallowProjectionInventory {
  const facts = analyzePreviewRenderSource(sourcePath, sourceText).moduleFacts;
  const rootExportNames = new Set(
    facts.exports
      .filter((item) => item.localName !== undefined || item.moduleSpecifier !== undefined)
      .map((item) => item.exportName),
  );
  return collectPreviewInspectorShallowProjectionInventory(sourcePath, sourceText, rootExportNames);
}

/**
 * Finds project hook modules that may be cut throughout an exact selected corridor module.
 *
 * Unlike visual projection, hook projection does not remove authored DOM. Every reference to a
 * binding must be an exact call already admitted by demand-shaped fallback instrumentation, and
 * every runtime import from the module must satisfy the same rule. Mixed helper/hook surfaces and
 * uninstrumented calls therefore retain their authentic graph.
 */
export function collectPreviewInspectorRuntimeHookProjectionInventory(
  sourcePath: string,
  sourceText: string,
): PreviewInspectorShallowProjectionInventory {
  const facts = analyzePreviewRenderSource(sourcePath, sourceText).moduleFacts;
  const runtimeHookCalls = groupRuntimeHookCallsByLocalName(
    collectPreviewRuntimeHookProjectionEvidence(sourcePath, sourceText),
  );
  if (runtimeHookCalls.size === 0) return freezeInventory(new Map(), false);
  const importsBySpecifier = groupImportsBySpecifier(facts.imports);
  const edgesByLocalName = groupEdgesByChildLocalName(facts.localEdges);
  const projections = new Map<string, PreviewInspectorShallowProjection>();

  for (const [moduleSpecifier, importedBindings] of importsBySpecifier) {
    if (
      importedBindings.length === 0 ||
      importedBindings.some((imported) => {
        if (imported.importedName === '*') return true;
        const edges = edgesByLocalName.get(imported.localName) ?? [];
        const admittedOffsets = runtimeHookCalls.get(imported.localName);
        return (
          edges.length === 0 ||
          admittedOffsets === undefined ||
          edges.some((edge) => !admittedOffsets.has(edge.occurrenceStart))
        );
      })
    ) {
      continue;
    }
    const exportNames = [...new Set(importedBindings.map((item) => item.importedName))].sort();
    projections.set(
      moduleSpecifier,
      Object.freeze({
        exportNames: Object.freeze(exportNames),
        moduleSpecifier,
        runtimeHookExportNames: Object.freeze([...exportNames]),
      }),
    );
  }
  return freezeInventory(projections, false);
}

/**
 * Emits a browser-safe ESM component surface for one intentionally bounded child graph.
 *
 * Component exports keep authored children flowing through a tiny neutral host. Runtime-hook
 * exports return `undefined` so the importer-side fallback instrumentation can synthesize its
 * exact demanded shape without bundling the hook's otherwise unbounded application graph.
 */
export function createPreviewInspectorShallowProjectionSource(
  projection: PreviewInspectorShallowProjection,
): string {
  const runtimeHookExportNames = new Set(projection.runtimeHookExportNames);
  const componentExportNames = projection.exportNames.filter(
    (name) => !runtimeHookExportNames.has(name),
  );
  const lines: string[] = [];
  if (componentExportNames.length > 0) {
    lines.push(
      "import * as React from 'react';",
      'const createShallowComponent = (label) => {',
      "  const selectorId = 'react-preview-shallow-' + String(label).replace(/[^a-z0-9_-]+/giu, '-');",
      '  const semanticIdentity = String(label)',
      "    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')",
      '    .toLowerCase();',
      '  const navigationLike = /(?:^|[-_/:])(nav|navigation|sidebar)(?:$|[-_/:])/u.test(semanticIdentity);',
      "  const semanticLabel = String(label).split(':').at(-1)?.replace(/([a-z0-9])([A-Z])/gu, '$1 $2') ?? 'Navigation';",
      '  const ShallowComponent = (props) => {',
      '    const children = props == null ? undefined : props.children;',
      "    const semanticContentKeys = ['content', 'label', 'text', 'message', 'description'];",
      "    const isRenderableSemanticContent = (value) => typeof value === 'string' || typeof value === 'number' || Array.isArray(value) || React.isValidElement(value);",
      '    const semanticContent = children != null',
      '      ? children',
      '      : semanticContentKeys.map((key) => props == null ? undefined : props[key])',
      '          .find(isRenderableSemanticContent);',
      '    const hostProps = {};',
      '    if (props != null && typeof props === "object") {',
      '      for (const [key, value] of Object.entries(props)) {',
      "        const hostAttribute = key === 'className' || key === 'id' || key === 'title' || key === 'role' || key === 'dir' || key === 'lang' || key === 'tabIndex' || key === 'slot' || key === 'hidden' || key.startsWith('data-') || key.startsWith('aria-');",
      "        const hostEvent = /^on[A-Z]/u.test(key) && typeof value === 'function';",
      '        if (hostAttribute || hostEvent) hostProps[key] = value;',
      '      }',
      '    }',
      "    const authoredStyle = props != null && props.style != null && typeof props.style === 'object' && !Array.isArray(props.style) ? props.style : {};",
      '    const fallbackStyle = semanticContent == null && navigationLike',
      '      ? {',
      "          alignSelf: 'stretch', background: 'rgba(127,127,127,0.055)',",
      "          borderRight: '1px solid rgba(127,127,127,0.18)', boxSizing: 'border-box',",
      "          display: 'flex', flex: '0 0 min(14rem, 24vw)', flexDirection: 'column',",
      "          gap: '0.65rem', minHeight: '100%', minWidth: '9rem', padding: '1rem 0.8rem',",
      '        }',
      "      : semanticContent == null && hostProps.className == null ? { display: 'inline-block', minHeight: '1em', minWidth: '1em' } : {};",
      '    const hostStyle = { ...fallbackStyle, ...authoredStyle };',
      '    if (Object.keys(hostStyle).length > 0) hostProps.style = hostStyle;',
      "    hostProps.className = [hostProps.className, selectorId].filter(Boolean).join(' ');",
      "    hostProps['data-react-preview-shallow-component'] = label;",
      "    if (navigationLike && semanticContent == null && hostProps['aria-label'] == null) {",
      "      hostProps['aria-label'] = semanticLabel;",
      '    }',
      '    const content = navigationLike && semanticContent == null',
      '      ? React.createElement(React.Fragment, null,',
      "          React.createElement('strong', { style: { fontSize: '0.78rem', opacity: 0.72 } }, semanticLabel),",
      "          ...[0, 1, 2, 3].map((index) => React.createElement('span', {",
      "            key: index, style: { background: 'rgba(127,127,127,0.15)', borderRadius: '3px',",
      "              display: 'block', height: '0.7rem', width: index % 2 === 0 ? '78%' : '58%' },",
      '          })),',
      '        )',
      '      : semanticContent;',
      '    const requestedHost = props == null ? undefined : (props.componentType ?? props.as);',
      "    const hostType = typeof requestedHost === 'string' && /^(?:article|aside|div|h[1-6]|label|p|section|small|span|strong)$/u.test(requestedHost)",
      "      ? requestedHost : 'span';",
      '    return React.createElement(hostType, hostProps, content);',
      '  };',
      '  Object.defineProperties(ShallowComponent, {',
      "    displayName: { value: 'PreviewShallow(' + label + ')' },",
      '    styledComponentId: { value: selectorId },',
      "    toString: { value: () => '.' + selectorId },",
      '  });',
      ...(projection.neutralRouteBasePath === undefined
        ? []
        : [
            '  Object.defineProperties(ShallowComponent, {',
            `    basePath: { enumerable: false, value: ${JSON.stringify(projection.neutralRouteBasePath)} },`,
            '    allPages: { enumerable: false, value: Object.freeze([]) },',
            '    pageNames: { enumerable: false, value: Object.freeze([]) },',
            '  });',
          ]),
      '  return ShallowComponent;',
      '};',
    );
  }
  if (runtimeHookExportNames.size > 0) {
    lines.push(
      'const createShallowRuntimeHook = (label) => {',
      '  const ShallowRuntimeHook = (..._arguments) => undefined;',
      "  Object.defineProperty(ShallowRuntimeHook, 'displayName', { value: 'PreviewRuntimeHook(' + label + ')' });",
      '  return ShallowRuntimeHook;',
      '};',
    );
  }
  const namedExports = projection.exportNames.filter((name) => name !== 'default');
  if (projection.exportNames.includes('default')) {
    const factory = runtimeHookExportNames.has('default')
      ? 'createShallowRuntimeHook'
      : 'createShallowComponent';
    lines.push(
      `const ReactPreviewShallowDefault = ${factory}(${JSON.stringify(
        createProjectionLabel(projection.moduleSpecifier, 'default'),
      )});`,
      'export default ReactPreviewShallowDefault;',
    );
  }
  namedExports.forEach((exportName, index) => {
    const localName = `ReactPreviewShallowNamed${index.toString()}`;
    const factory = runtimeHookExportNames.has(exportName)
      ? 'createShallowRuntimeHook'
      : 'createShallowComponent';
    lines.push(
      `const ${localName} = ${factory}(${JSON.stringify(
        createProjectionLabel(projection.moduleSpecifier, exportName),
      )});`,
      `export { ${localName} as ${exportName} };`,
    );
  });
  return lines.join('\n');
}

/** Selects local component values that supply the exact shallow runtime exports. */
function collectRootLocalNames(
  facts: PreviewRenderModuleFacts,
  rootExportNames: ReadonlySet<string>,
): readonly string[] {
  const localNames = facts.exports.flatMap((item) =>
    rootExportNames.has(item.exportName) && item.localName !== undefined ? [item.localName] : [],
  );
  return Object.freeze([...new Set(localNames)]);
}

/**
 * Converts an authentic barrel into the next exact component/hook edge of the recursive DFS.
 *
 * Named re-exports preserve aliases. One wildcard source is unambiguous and can forward demanded
 * names directly; multiple wildcard sources fail open because selecting one would guess ownership.
 */
function collectRootReexportProjections(
  facts: PreviewRenderModuleFacts,
  rootExportNames: ReadonlySet<string>,
  rootRuntimeHookExportNames: ReadonlySet<string>,
): ReadonlyMap<string, PreviewInspectorShallowProjection> {
  const exportNamesBySpecifier = new Map<string, Set<string>>();
  const hookNamesBySpecifier = new Map<string, Set<string>>();
  const wildcardFacts = facts.exports.filter(
    (item) => item.wildcard && item.moduleSpecifier !== undefined,
  );
  for (const item of facts.exports) {
    if (
      item.moduleSpecifier === undefined ||
      item.wildcard ||
      !rootExportNames.has(item.exportName)
    ) {
      continue;
    }
    const forwardedName = item.reexportedName ?? item.exportName;
    appendSetValue(exportNamesBySpecifier, item.moduleSpecifier, forwardedName);
    if (rootRuntimeHookExportNames.has(item.exportName)) {
      appendSetValue(hookNamesBySpecifier, item.moduleSpecifier, forwardedName);
    }
  }
  if (wildcardFacts.length === 1) {
    const moduleSpecifier = wildcardFacts[0]?.moduleSpecifier;
    if (moduleSpecifier !== undefined) {
      for (const exportName of rootExportNames) {
        if (exportName === 'default') continue;
        appendSetValue(exportNamesBySpecifier, moduleSpecifier, exportName);
        if (rootRuntimeHookExportNames.has(exportName)) {
          appendSetValue(hookNamesBySpecifier, moduleSpecifier, exportName);
        }
      }
    }
  }
  return new Map(
    [...exportNamesBySpecifier].map(([moduleSpecifier, exportNames]) => [
      moduleSpecifier,
      Object.freeze({
        exportNames: Object.freeze([...exportNames].sort()),
        moduleSpecifier,
        runtimeHookExportNames: Object.freeze(
          [...(hookNamesBySpecifier.get(moduleSpecifier) ?? [])].sort(),
        ),
      }),
    ]),
  );
}

/** Groups import facts without retaining parser nodes or source text. */
function groupImportsBySpecifier(
  imports: readonly PreviewRenderImportFact[],
): ReadonlyMap<string, readonly PreviewRenderImportFact[]> {
  const grouped = new Map<string, PreviewRenderImportFact[]>();
  for (const imported of imports) {
    const items = grouped.get(imported.moduleSpecifier) ?? [];
    items.push(imported);
    grouped.set(imported.moduleSpecifier, items);
  }
  return grouped;
}

/** Groups local flow edges by their top-level declaration owner. */
function groupEdgesByOwnerId(
  edges: readonly PreviewRenderLocalEdgeFact[],
): ReadonlyMap<string, readonly PreviewRenderLocalEdgeFact[]> {
  const grouped = new Map<string, PreviewRenderLocalEdgeFact[]>();
  for (const edge of edges) {
    const items = grouped.get(edge.ownerId) ?? [];
    items.push(edge);
    grouped.set(edge.ownerId, items);
  }
  return grouped;
}

/** Groups references by imported/local binding for all-corridor hook safety checks. */
function groupEdgesByChildLocalName(
  edges: readonly PreviewRenderLocalEdgeFact[],
): ReadonlyMap<string, readonly PreviewRenderLocalEdgeFact[]> {
  const grouped = new Map<string, PreviewRenderLocalEdgeFact[]>();
  for (const edge of edges) {
    const items = grouped.get(edge.childLocalName) ?? [];
    items.push(edge);
    grouped.set(edge.childLocalName, items);
  }
  return grouped;
}

/** Groups compiler-admitted direct hook call offsets by their consumer-local binding. */
function groupRuntimeHookCallsByLocalName(
  evidence: readonly { readonly localName: string; readonly occurrenceStart: number }[],
): ReadonlyMap<string, ReadonlySet<number>> {
  const grouped = new Map<string, Set<number>>();
  for (const item of evidence) {
    const offsets = grouped.get(item.localName) ?? new Set<number>();
    offsets.add(item.occurrenceStart);
    grouped.set(item.localName, offsets);
  }
  return grouped;
}

/**
 * Admits a project hook only when this exact call receives a demand-shaped runtime fallback.
 *
 * The generated hook surface returns `undefined`; the already-instrumented importer then supplies
 * the statically inferred object, tuple, scalar, or no-op function. Exact source offsets ensure a
 * same-named reference elsewhere in the shell cannot accidentally authorize graph pruning.
 */
function isSupportedRuntimeHookBoundary(
  edge: PreviewRenderLocalEdgeFact,
  imported: PreviewRenderImportFact,
  runtimeHookCalls: ReadonlyMap<string, ReadonlySet<number>>,
): boolean {
  return runtimeHookCalls.get(imported.localName)?.has(edge.occurrenceStart) === true;
}

/**
 * Recognizes visual component identities that may safely become shallow placeholders.
 *
 * Render-flow syntax is necessary but not sufficient. Providers, contexts, routers, and error
 * boundaries are React components too, yet replacing them changes descendant runtime semantics.
 * Component-style local names and direct React transport evidence provide a conservative,
 * framework-general guard against projecting hooks, constants, GraphQL documents, or containers.
 */
function isSupportedComponentBoundary(
  edge: PreviewRenderLocalEdgeFact,
  imported: PreviewRenderImportFact,
): boolean {
  if (!isPreviewInspectorSafeShallowVisualBinding(imported.localName)) return false;
  if (edge.kind === 'component-render' || edge.kind === 'create-element') {
    return true;
  }
  /*
   * Route/config declarations classify all reached values as conditional. Require separate React
   * invocation evidence here so a route pathname, query document, or enum is not mistaken for the
   * component that sits beside it in the same object literal.
   */
  return (
    edge.invocation?.mode === 'component-prop' ||
    edge.invocation?.mode === 'create-element' ||
    edge.invocation?.mode === 'forward-ref' ||
    edge.invocation?.mode === 'hoc' ||
    edge.invocation?.mode === 'jsx' ||
    edge.invocation?.mode === 'memo' ||
    edge.invocation?.mode === 'polymorphic-prop' ||
    edge.invocation?.mode === 'render-prop' ||
    edge.invocation?.mode === 'styled'
  );
}

/** Adds one unique value to a map-of-sets while keeping allocation local to the analyzer. */
function appendSetValue(destination: Map<string, Set<string>>, key: string, value: string): void {
  const values = destination.get(key) ?? new Set<string>();
  values.add(value);
  destination.set(key, values);
}

/** Freezes a projection inventory without leaking a mutable map through the plugin cache. */
function freezeInventory(
  projectionsBySpecifier: ReadonlyMap<string, PreviewInspectorShallowProjection>,
  truncated: boolean,
): PreviewInspectorShallowProjectionInventory {
  return Object.freeze({
    projectionsBySpecifier: new Map(projectionsBySpecifier),
    truncated,
  });
}

/** Creates a short stable marker label without exposing an absolute workspace path. */
function createProjectionLabel(moduleSpecifier: string, exportName: string): string {
  return `${moduleSpecifier}:${exportName}`;
}
