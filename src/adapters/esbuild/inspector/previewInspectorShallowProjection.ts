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

const MAXIMUM_LOCAL_VALUE_VISITS = 128;

/** Exact ESM surface required from one projected child component module. */
export interface PreviewInspectorShallowProjection {
  /** Runtime export spellings requested by the shallow shell's import or React.lazy adapter. */
  readonly exportNames: readonly string[];
  /** Authored module request used as the esbuild projection identity. */
  readonly moduleSpecifier: string;
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
): PreviewInspectorShallowProjectionInventory {
  const facts = analyzePreviewRenderSource(sourcePath, sourceText).moduleFacts;
  const rootLocalNames = collectRootLocalNames(facts, rootExportNames);
  if (rootLocalNames.length === 0) {
    return freezeInventory(new Map(), false);
  }

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
        if (isSupportedComponentBoundary(edge)) {
          appendSetValue(
            componentLocalNamesBySpecifier,
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
  const projections = new Map<string, PreviewInspectorShallowProjection>();
  for (const [moduleSpecifier, componentLocalNames] of componentLocalNamesBySpecifier) {
    const importedBindings = importsBySpecifier.get(moduleSpecifier) ?? [];
    if (
      unsafeSpecifiers.has(moduleSpecifier) ||
      importedBindings.length === 0 ||
      importedBindings.some(
        (item) => item.importedName === '*' || !componentLocalNames.has(item.localName),
      )
    ) {
      continue;
    }
    const exportNames = [...new Set(importedBindings.map((item) => item.importedName))].sort();
    projections.set(
      moduleSpecifier,
      Object.freeze({ exportNames: Object.freeze(exportNames), moduleSpecifier }),
    );
  }
  for (const [moduleSpecifier, exportNames] of exportNamesByLazySpecifier) {
    if (unsafeSpecifiers.has(moduleSpecifier)) continue;
    const existing = projections.get(moduleSpecifier);
    const mergedNames = [...new Set([...(existing?.exportNames ?? []), ...exportNames])].sort();
    projections.set(
      moduleSpecifier,
      Object.freeze({ exportNames: Object.freeze(mergedNames), moduleSpecifier }),
    );
  }
  return freezeInventory(projections, false);
}

/**
 * Emits a browser-safe ESM component surface for one intentionally bounded child graph.
 *
 * The placeholder keeps authored children flowing through component slots and emits only a tiny
 * neutral host when the projected child is otherwise empty. This preserves the shallow parent's
 * own box, spacing, classes, and styles without pretending that deeper project UI was evaluated.
 */
export function createPreviewInspectorShallowProjectionSource(
  projection: PreviewInspectorShallowProjection,
): string {
  const lines = [
    "import * as React from 'react';",
    'const createShallowComponent = (label) => {',
    '  const ShallowComponent = (props) => {',
    '    const children = props == null ? undefined : props.children;',
    '    const hostProps = {};',
    '    if (props != null && typeof props === "object") {',
    '      for (const [key, value] of Object.entries(props)) {',
    "        const hostAttribute = key === 'className' || key === 'id' || key === 'title' || key === 'role' || key === 'dir' || key === 'lang' || key === 'tabIndex' || key === 'slot' || key === 'hidden' || key.startsWith('data-') || key.startsWith('aria-');",
    "        const hostEvent = /^on[A-Z]/u.test(key) && typeof value === 'function';",
    '        if (hostAttribute || hostEvent) hostProps[key] = value;',
    '      }',
    '    }',
    "    const authoredStyle = props != null && props.style != null && typeof props.style === 'object' && !Array.isArray(props.style) ? props.style : {};",
    "    const fallbackStyle = children == null && hostProps.className == null ? { display: 'inline-block', minHeight: '1em', minWidth: '1em' } : {};",
    '    const hostStyle = { ...fallbackStyle, ...authoredStyle };',
    '    if (Object.keys(hostStyle).length > 0) hostProps.style = hostStyle;',
    "    hostProps['data-react-preview-shallow-component'] = label;",
    "    return React.createElement('span', hostProps, children);",
    '  };',
    "  Object.defineProperty(ShallowComponent, 'displayName', { value: 'PreviewShallow(' + label + ')' });",
    '  return ShallowComponent;',
    '};',
  ];
  const namedExports = projection.exportNames.filter((name) => name !== 'default');
  if (projection.exportNames.includes('default')) {
    lines.push(
      `const ReactPreviewShallowDefault = createShallowComponent(${JSON.stringify(
        createProjectionLabel(projection.moduleSpecifier, 'default'),
      )});`,
      'export default ReactPreviewShallowDefault;',
    );
  }
  namedExports.forEach((exportName, index) => {
    const localName = `ReactPreviewShallowNamed${index.toString()}`;
    lines.push(
      `const ${localName} = createShallowComponent(${JSON.stringify(
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

/** Recognizes component identities that cross a real React render boundary. */
function isSupportedComponentBoundary(edge: PreviewRenderLocalEdgeFact): boolean {
  if (
    edge.kind === 'component-render' ||
    edge.kind === 'create-element' ||
    edge.kind === 'route-branch'
  ) {
    return true;
  }
  return (
    edge.invocation?.mode === 'component-prop' ||
    edge.invocation?.mode === 'forward-ref' ||
    edge.invocation?.mode === 'hoc' ||
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
