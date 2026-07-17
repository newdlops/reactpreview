/** Verifies isolated Inspector browser source without executing project React code in the host. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPreviewEntry } from '../../../../src/adapters/esbuild/createPreviewEntry';
import {
  createPreviewInspectorFacadeRuntimeSource,
  createPreviewPageInspectorRuntimeSource,
} from '../../../../src/adapters/esbuild/pageInspector';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('Page Inspector runtime source', () => {
  /** Keeps marker/highlight/editor code out of the ordinary component-gallery entry. */
  it('includes the inspector runtime only for the explicit page-inspector mode', () => {
    const componentEntry = createPreviewEntry({
      documentName: 'Target.tsx',
      globalNamespaces: [],
      renderMode: 'component',
      setupKind: 'none',
    });
    const inspectorEntry = createPreviewEntry({
      documentName: 'Target.tsx',
      globalNamespaces: [],
      renderMode: 'page-inspector',
      setupKind: 'none',
    });

    expect(componentEntry).not.toContain('const PREVIEW_INSPECTOR_API_KEY');
    expect(componentEntry).not.toContain("import * as ReactDOMNamespace from 'react-dom'");
    expect(inspectorEntry).toContain('const PREVIEW_INSPECTOR_API_KEY');
    expect(inspectorEntry).toContain("import * as ReactDOMNamespace from 'react-dom'");
    expect(inspectorEntry).toContain('PreviewPageInspectorRootRenderer');
  });

  /** Uses a read-only tree adapter, isolated toolbar, persistent overrides, and proven ancestry. */
  it('generates selector-safe highlighting and editable root/target controls', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).not.toContain("React.createElement('template'");
    expect(source).toContain("readPreviewInspectorOwnData(boundary, '_reactInternals')");
    expect(source).toContain("readPreviewInspectorOwnData(boundary, '_reactInternalFiber')");
    expect(source).toContain("document.createElement('react-preview-inspector-host')");
    expect(source).toContain("attachShadow({ mode: 'open' })");
    expect(source).toContain("setProperty('inset', '0', 'important')");
    expect(source).toContain("setProperty('pointer-events', 'none', 'important')");
    expect(source).toContain('setPropsOverride');
    expect(source).toContain('React.cloneElement(Component, props)');
    expect(source).toContain('createPreviewInspectorRootName');
    expect(source).toContain('descriptor?.inspector === undefined');
    expect(source).toContain('DirectPreviewTarget');
    expect(source).toContain('describePreviewInspectorAncestry');
    expect(source).toContain('Object.keys(descriptor?.inspector?.renderChainsByExport ?? {})');
    expect(source).toContain('renderChainsByExport?.[selectedExportName]');
    expect(source).toContain('class PreviewInspectorTargetBoundary extends React.Component');
    expect(source).toContain('static getDerivedStateFromError(error)');
    expect(source).toContain('rememberCapturedReactError(error)');
    expect(source).toContain("'react-preview-target-error'");
    expect(source).toContain('remountPreviewInspectorExport(this.props.exportName)');
    expect(source).toContain('fallbackValuesEnabled ? metadata?.inferredPropShape : undefined');
    expect(source).toContain('Auto-generated preview values:');
    expect(source).toContain('resolveRenderCondition: resolvePreviewInspectorRenderCondition');
    expect(source).toContain('resolveDataPayload: resolvePreviewInspectorDataPayload');
    expect(source).toContain('resolveRuntimeHook: resolvePreviewInspectorRuntimeHook');
    expect(source).toContain('previewAxiosRequest: previewInspectorAxiosRequest');
    expect(source).toContain('previewFetch: previewInspectorFetch');
    expect(source).toContain('recordConsoleEntry: recordPreviewInspectorConsoleEntry');
    expect(source).toContain('installPreviewInspectorConsoleCapture()');
    expect(source).toContain('reportPreviewInspectorTargetFailure(error');
    expect(source).toContain("['console', 'Console ('");
    expect(source).toContain('Auto payloads');
    expect(source).toContain("['fallbacks', 'Fallbacks ('");
    expect(source).toContain('GENERATED RENDER VALUE');
    expect(source).toContain("registerPreviewRuntimeCapability('Render isolation'");
    expect(source).toContain('Generated values are local preview fixtures.');
    expect(source).toContain("registerPreviewRuntimeCapability('Data'");
    expect(source).toContain('no-network API/GraphQL payload registry');
    expect(source).toContain('setPreviewInspectorFallbackValuesEnabled');
    expect(source).toContain('Internal hook state uses the page UI or a source edit');
    expect(source).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
  });

  /** Delegates facade wrappers through the same global API installed before target evaluation. */
  it('creates the exact target facade contract with a safe inactive fallback', () => {
    const source = createPreviewInspectorFacadeRuntimeSource();

    expect(source).toContain('export function wrapPreviewInspectorTarget');
    expect(source).toContain('inspectorApi?.TargetRenderer');
    expect(source).toContain('React.forwardRef');
    expect(source).toContain('React.cloneElement(Component, fallbackProps)');
  });

  /** Prevents copied memo/forwardRef/lazy protocol fields from bypassing the inspector delegate. */
  it('retains the inspector wrapper around React exotic component types', async () => {
    const facade = await importPreviewInspectorFacade();
    const wrapTarget = facade.wrapTarget;
    const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');
    const globalRecord = globalThis as unknown as Record<PropertyKey, unknown>;
    const delegatedLabels: string[] = [];
    globalRecord[apiKey] = {
      TargetRenderer({ Component, targetProps }: FacadeTargetRendererProps) {
        delegatedLabels.push(String(targetProps.label));
        return React.createElement(Component, targetProps);
      },
    };
    try {
      const PlainTarget = ({ label }: { readonly label: string }): React.ReactElement =>
        React.createElement('strong', undefined, label);
      const targets = [React.memo(PlainTarget), React.forwardRef(PlainTarget)];
      const lazyTarget = React.lazy(() => Promise.resolve({ default: PlainTarget }));
      const wrappedLazyTarget = wrapTarget(lazyTarget, { exportName: 'LazyTarget' });
      const html = targets.map((target, index) =>
        renderToStaticMarkup(
          React.createElement(wrapTarget(target, { exportName: `Target${index.toString()}` }), {
            label: `inspected-${index.toString()}`,
          }),
        ),
      );

      expect(delegatedLabels).toEqual(['inspected-0', 'inspected-1']);
      expect(html).toEqual(['<strong>inspected-0</strong>', '<strong>inspected-1</strong>']);
      expect(readReactTypeSymbol(wrappedLazyTarget)).toBe(Symbol.for('react.forward_ref'));
      expect(Reflect.ownKeys(wrappedLazyTarget as object)).not.toEqual(
        expect.arrayContaining(['_payload', '_init', '_debugInfo']),
      );
    } finally {
      Reflect.deleteProperty(globalRecord, apiKey);
      await rm(facade.fixtureDirectory, { force: true, recursive: true });
    }
  });

  /** Keeps descriptor/boundary names authoritative and resets errors for root prop revisions. */
  it('emits hot-safe inventory pruning and a root-aware error-boundary key', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).toContain('previewInspectorSession.boundariesByExport.keys()');
    expect(source).not.toContain('...previewInspectorSession.basePropsByExport.keys()');
    expect(source).toContain(
      'const rootRevision = previewInspectorSession.propsRevisionByExport.get(rootName)',
    );
    expect(source).toContain("String(rootRevision) + ':candidate:'");
    expect(source).toContain("':data:' + String(dataRevision)");
    expect(source).toContain(
      'createPageCandidateElement: createPreviewInspectorPageCandidateElement',
    );
    expect(source).toContain(
      'selectedPageCandidateId: previewInspectorSession.selectedPageCandidateId',
    );
  });

  /** Connects the independent tree adapter to selection, source navigation, and commit refresh. */
  it('exposes the live component-tree API and maps picker hosts back to Fiber nodes', () => {
    const source = createPreviewPageInspectorRuntimeSource();
    const publicApiStart = source.indexOf('const previewInspectorApi = {');
    const publicApiEnd = source.indexOf('globalThis[PREVIEW_INSPECTOR_API_KEY]', publicApiStart);
    const publicApiSource = source.slice(publicApiStart, publicApiEnd);

    expect(source).toContain('collectTree: collectPreviewInspectorTreeSnapshot');
    expect(source).toContain('selectNode: selectPreviewInspectorTreeNode');
    expect(source).toContain('subscribeTree: subscribePreviewInspectorTree');
    expect(source).toContain('openSource: openPreviewInspectorTreeSource');
    expect(publicApiSource).not.toContain('openSource:');
    expect(source).toContain('nativeEvent.isTrusted !== true');
    expect(source).toContain('previewInspectorConsumedSourceEvents.has(nativeEvent)');
    expect(source).toContain("{ hash: 'SHA-256', name: 'HMAC' }");
    expect(source).toContain('gestureNonce, gestureToken');
    expect(source).toContain('findPreviewInspectorFiberTreeNodeByHost(snapshot, candidate)');
    expect(source).toContain('selectPreviewInspectorFiberTreeNode(snapshot, nodeId)');
    expect(source).toContain('const selectedIsStaticSibling =');
    expect(source).toContain('const boundaries = selectedIsStaticSibling');
    expect(source).toContain('notifyPreviewInspectorTreeSubscribers()');
    expect(source).toContain('new MutationObserver(handlePreviewInspectorMutations)');
    expect(source).toContain('schedulePreviewInspectorCommitRefresh()');
    expect(source).toContain('previewInspectorSession.treeDirty !== true');
    expect(source).toContain(
      'previewInspectorSession.lastTreeSnapshot ?? collectPreviewInspectorTreeSnapshot()',
    );
    expect(source).toContain('{ childList: true, subtree: true }');
    expect(source).not.toContain('setInterval(schedulePreviewInspectorHighlight, 1000)');
    expect(source).not.toContain('attributes: true');
    expect(source).not.toContain('characterData: true');
    expect(source).toContain("createPreviewInspectorTreeNodeId('fiber', path, kind, name)");
    expect(source).toContain("status: roots.length === 0\n      ? 'unavailable'");
    expect(source).toContain('selected component host node(s)');
    expect(source).toContain("[selection.hostNodes, snapshot.status === 'static']");
    expect(source).toContain('treeSelection[0].length > 0 || !treeSelection[1]');
    expect(source).toContain("type: 'react-preview-inspector-open-source'");
  });
});

/** Minimal public props consumed by the generated facade's entry-owned target renderer. */
interface FacadeTargetRendererProps {
  readonly Component: React.ElementType;
  readonly targetProps: Record<string, unknown>;
}

/** Imported generated facade plus its caller-owned temporary module directory. */
interface ImportedPreviewInspectorFacade {
  readonly fixtureDirectory: string;
  readonly wrapTarget: (
    component: React.ElementType,
    metadata: { readonly exportName: string },
  ) => React.ElementType;
}

/** Imports the generated facade as real ESM so the behavior test never relies on eval. */
async function importPreviewInspectorFacade(): Promise<ImportedPreviewInspectorFacade> {
  const fixtureDirectory = await mkdtemp(
    path.join(REPOSITORY_ROOT, 'test/fixtures/page-inspector-facade-'),
  );
  const modulePath = path.join(fixtureDirectory, 'facade.mjs');
  try {
    await writeFile(modulePath, createPreviewInspectorFacadeRuntimeSource(), 'utf8');
    const facadeModule = (await import(pathToFileURL(modulePath).href)) as {
      readonly wrapPreviewInspectorTarget: ImportedPreviewInspectorFacade['wrapTarget'];
    };
    return { fixtureDirectory, wrapTarget: facadeModule.wrapPreviewInspectorTarget };
  } catch (error) {
    await rm(fixtureDirectory, { force: true, recursive: true });
    throw error;
  }
}

/** Reads the public React type tag without coupling test types to one installed React version. */
function readReactTypeSymbol(component: React.ElementType): symbol | undefined {
  return (component as unknown as { readonly $$typeof?: symbol }).$$typeof;
}
