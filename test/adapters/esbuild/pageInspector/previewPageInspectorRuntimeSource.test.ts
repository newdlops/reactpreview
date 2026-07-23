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
    expect(inspectorEntry).toContain('activePreviewRouterBridge?.createNestedRouterPreviewElement');
    expect(inspectorEntry).toContain('function createPreviewCandidateRouterElement');
    expect(inspectorEntry).toContain('function createPreviewCandidateRouterConfiguration');
    expect(inspectorEntry).toContain("previewRouteSource: 'static-page-graph'");
    expect(inspectorEntry).toContain('setupRecord?.initialEntries !== undefined');
    expect(inspectorEntry).toContain('PreviewPageInspectorRootRenderer');
    expect(inspectorEntry).toContain('PreviewInspectorTargetReachabilityProbe');
    expect(inspectorEntry).toContain('Application path rendered, but did not reach');
    expect(inspectorEntry).toContain("type: 'react-preview-inspector-companion-snapshot'");
    expect(componentEntry).not.toContain('react-preview-inspector-companion-snapshot');
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
    expect(source).toContain(
      'const candidateChanged = reconcilePreviewInspectorPageCandidateSelection(candidateIds)',
    );
    expect(source).toContain('typeof persisted.userSelectedPageCandidateId');
    expect(source).toContain('descriptor?.inspector === undefined');
    expect(source).toContain('PreviewInspectorDirectTarget');
    expect(source).toContain('PreviewInspectorRoutedDirectTarget');
    expect(source).toContain('createPreviewCandidateRouterElement(');
    expect(source).toContain('{ ownsRouter: false }');
    expect(source).toContain('describePreviewInspectorAncestry');
    expect(source).toContain('Object.keys(descriptor?.inspector?.renderChainsByExport ?? {})');
    expect(source).toContain('renderChainsByExport?.[selectedExportName]');
    expect(source).toContain('rememberPreviewInspectorTargetRuntimeOwner(exportName, Component)');
    expect(source).toContain('class PreviewInspectorTargetBoundary extends React.Component');
    expect(source).toContain('static getDerivedStateFromError(error)');
    expect(source).toContain('rememberCapturedReactError(error)');
    expect(source).toContain("'react-preview-target-error'");
    expect(source).toContain('remountPreviewInspectorExport(this.props.exportName)');
    expect(source).toContain('fallbackValuesEnabled ? metadata?.inferredPropShape : undefined');
    expect(source).toContain(
      'fallbackValuesEnabled ? selectedCandidate?.rootInferredPropShape : undefined',
    );
    expect(source).toContain('selectedCandidate?.rootInferredProps');
    expect(source).toContain('Smart-generated preview paths:');
    expect(source).toContain('createPreviewInspectorSmartPropsDraft');
    expect(source).toContain("'Smart fill props'");
    expect(source).toContain('PREVIEW_INSPECTOR_NOOP_VALUE_SENTINEL');
    expect(source).toContain('materializePreviewInspectorRuntimeFallbackOverride');
    expect(source).toContain(
      "resetKey: String(targetRevision) + ':' + rootName + ':' + String(rootRevision)",
    );
    expect(source).toContain("key: inspectedExportName + ':candidate:'");
    expect(source).toContain('resolveRenderCondition: resolvePreviewInspectorRenderCondition');
    expect(source).toContain(
      'resolveRenderConditionLazy: resolvePreviewInspectorRenderConditionLazy',
    );
    expect(source).toContain('resolveRenderChoice: resolvePreviewInspectorRenderChoice');
    expect(source).toContain('resolveDataPayload: resolvePreviewInspectorDataPayload');
    expect(source).toContain(
      'resolveGraphqlInterpolation: resolvePreviewInspectorGraphqlInterpolation',
    );
    expect(source).toContain('resolveBackendRequest: resolvePreviewInspectorBackendRequest');
    expect(source).toContain('resolveRuntimeHook: resolvePreviewInspectorScopedRuntimeHook');
    expect(source).toContain('function activatePreviewInspectorRuntimeFallbackScope');
    expect(source).toContain('previewAxiosRequest: previewInspectorAxiosRequest');
    expect(source).toContain('previewFetch: previewInspectorFetch');
    expect(source).toContain('recordConsoleEntry: recordPreviewInspectorConsoleEntry');
    expect(source).toContain('installPreviewInspectorConsoleCapture()');
    expect(source).toContain("type: 'react-preview-blocker-trace'");
    expect(source).toContain('recordPreviewInspectorBlockerAutoDecision');
    expect(source).toContain('React preview blocker trace');
    expect(source).toContain('React preview runtime health');
    expect(source).toContain('reportPreviewInspectorTargetFailure(error');
    expect(source).toContain("['console', 'Console ('");
    expect(source).toContain('Auto payloads');
    expect(source).toContain("['payload', 'Payload']");
    expect(source).toContain('PreviewInspectorRuntimeBlockerDetail');
    expect(source).toContain('GENERATED RENDER VALUE');
    expect(source).toContain("registerPreviewRuntimeCapability('Render isolation'");
    expect(source).toContain("registerPreviewRuntimeCapability('GraphQL documents'");
    expect(source).toContain('Generated values never leave this preview.');
    expect(source).toContain("registerPreviewRuntimeCapability('Data'");
    expect(source).toContain('no-network API/GraphQL payload registry');
    expect(source).toContain('setPreviewInspectorFallbackValuesEnabled');
    expect(source).toContain('Internal hook state uses the page UI or a source edit');
    expect(source).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
  });

  /** Keeps cold first-paint Router and target identities stable across Inspector store updates. */
  it('declares direct-target component types outside the subscribed root renderer', () => {
    const source = createPreviewPageInspectorRuntimeSource();
    const rootStart = source.indexOf('function PreviewPageInspectorRootRenderer');
    const rootEnd = source.indexOf('function PreviewPageInspectorExportBoundary', rootStart);
    const rootSource = source.slice(rootStart, rootEnd);

    expect(source).toContain(
      'const PreviewInspectorDirectTargetContext = React.createContext(undefined)',
    );
    expect(source).toContain('function PreviewInspectorDirectTarget(targetProps)');
    expect(source).toContain('function PreviewInspectorRoutedDirectTarget(targetProps)');
    expect(rootSource).toContain('PreviewTarget: PreviewInspectorRoutedDirectTarget');
    expect(rootSource).toContain(
      'React.createElement(PreviewInspectorRoutedDirectTarget, targetProps)',
    );
    expect(rootSource).not.toContain('const DirectPreviewTarget');
    expect(rootSource).not.toContain('const RoutedDirectPreviewTarget');
  });

  /** Separates ordinary prop/error refreshes from the user's explicit target-only Remount action. */
  it('uses an instance epoch only for explicit component remounts', () => {
    const source = createPreviewPageInspectorRuntimeSource();
    const setPropsStart = source.indexOf('function setPreviewInspectorPropsOverride');
    const resetPropsStart = source.indexOf('function resetPreviewInspectorPropsOverride');
    const refreshStart = source.indexOf('function refreshPreviewInspectorExport');
    const remountStart = source.indexOf('function remountPreviewInspectorExport');
    const registerBoundaryStart = source.indexOf('function registerPreviewInspectorBoundary');
    const targetRendererStart = source.indexOf('function PreviewInspectorTargetRenderer');
    const directContextStart = source.indexOf('const PreviewInspectorDirectTargetContext');
    const setPropsSource = source.slice(setPropsStart, resetPropsStart);
    const resetPropsSource = source.slice(resetPropsStart, refreshStart);
    const refreshSource = source.slice(refreshStart, remountStart);
    const remountSource = source.slice(remountStart, registerBoundaryStart);
    const targetRendererSource = source.slice(targetRendererStart, directContextStart);

    expect(source).toContain('instanceEpochByExport: new Map()');
    expect(source).toContain('resolverPropsByExport: new Map()');
    expect(source).toContain(
      'previewInspectorSession.resolverPropsRevision !== previewEntryRevision',
    );
    expect(source).toContain('previewInspectorSession.instanceEpochByExport ??= new Map()');
    expect(setPropsSource).toContain('refreshPreviewInspectorExport(exportName, false)');
    expect(resetPropsSource).toContain('refreshPreviewInspectorExport(exportName, false)');
    expect(setPropsSource).not.toContain('remountPreviewInspectorExport');
    expect(resetPropsSource).not.toContain('remountPreviewInspectorExport');
    expect(refreshSource).toContain('propsRevisionByExport.set(exportName, currentRevision + 1)');
    expect(refreshSource).toContain(
      'if (activeReachabilityState?.targetExportName === exportName)',
    );
    expect(refreshSource).toContain('activeReachabilityState.probeRevision += 1');
    expect(refreshSource).not.toContain('instanceEpochByExport.set');
    expect(refreshSource).not.toContain('setTimeout');
    expect(remountSource).toContain(
      'previewInspectorSession.instanceEpochByExport.set(exportName, currentEpoch + 1)',
    );
    expect(remountSource).toContain('refreshPreviewInspectorExport(exportName, persist)');
    expect(targetRendererSource).toContain(
      'const instanceEpoch = previewInspectorSession.instanceEpochByExport.get(exportName)',
    );
    expect(targetRendererSource).toContain(
      'previewInspectorSession.resolverPropsByExport.get(exportName)',
    );
    expect(targetRendererSource.indexOf('resolverProps,')).toBeLessThan(
      targetRendererSource.indexOf('overrideProps,'),
    );
    expect(targetRendererSource).toContain(
      "key: exportName + ':instance:' + String(instanceEpoch)",
    );
    expect(targetRendererSource).toContain('key: exportName');
  });

  /** Delegates facade wrappers through the same global API installed before target evaluation. */
  it('creates the exact target facade contract with a safe inactive fallback', () => {
    const source = createPreviewInspectorFacadeRuntimeSource();

    expect(source).toContain('export function wrapPreviewInspectorTarget');
    expect(source).toContain('isPreviewInspectorRenderableTarget(Component)');
    expect(source).toContain('registerTargetRenderability?.(metadata?.exportName, renderable)');
    expect(source).toContain('activeInspectorApi?.TargetRenderer');
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

  /** Preserves application data exports instead of replacing their identity with forwardRef. */
  it('does not wrap GraphQL documents or other non-renderable exported objects', async () => {
    const facade = await importPreviewInspectorFacade();
    const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');
    const globalRecord = globalThis as unknown as Record<PropertyKey, unknown>;
    const reports: [string, boolean][] = [];
    globalRecord[apiKey] = {
      registerTargetRenderability(exportName: string, renderable: boolean) {
        reports.push([exportName, renderable]);
      },
    };
    const wrapUnknownTarget = facade.wrapTarget as unknown as (
      value: unknown,
      metadata: { readonly exportName: string },
    ) => unknown;
    const graphqlDocument = {
      definitions: [{ kind: 'OperationDefinition', operation: 'mutation' }],
      kind: 'Document',
    };
    const routeMetadata = { path: '/companies/:companyId' };
    try {
      expect(
        wrapUnknownTarget(graphqlDocument, {
          exportName: 'COMPANY_CREATE_EDIT_USER_PHONE_MUTATION',
        }),
      ).toBe(graphqlDocument);
      expect(wrapUnknownTarget(routeMetadata, { exportName: 'CompanyRoute' })).toBe(routeMetadata);
      expect(
        readReactTypeSymbol(
          wrapUnknownTarget(React.createElement('strong'), {
            exportName: 'PreparedElement',
          }) as React.ElementType,
        ),
      ).toBe(Symbol.for('react.forward_ref'));
      expect(reports).toEqual([
        ['COMPANY_CREATE_EDIT_USER_PHONE_MUTATION', false],
        ['CompanyRoute', false],
        ['PreparedElement', true],
      ]);
    } finally {
      Reflect.deleteProperty(globalRecord, apiKey);
      await rm(facade.fixtureDirectory, { force: true, recursive: true });
    }
  });

  /** Keeps descriptor names authoritative and resets errors without remounting a healthy page. */
  it('emits hot-safe inventory pruning and a root-aware error-boundary reset signal', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).toContain('function registerPreviewInspectorTargetRenderability');
    expect(source).toContain('previewInspectorSession.renderabilityByExport.get(name) !== false');
    expect(source).toContain(
      'registerTargetRenderability: registerPreviewInspectorTargetRenderability',
    );
    expect(source).toContain('previewInspectorSession.boundariesByExport.keys()');
    expect(source).not.toContain('...previewInspectorSession.basePropsByExport.keys()');
    expect(source).toContain(
      'const rootRevision = previewInspectorSession.propsRevisionByExport.get(rootName)',
    );
    expect(source).toContain("key: inspectedExportName + ':candidate:'");
    expect(source).toContain("resetKey: String(targetRevision) + ':' + rootName");
    expect(source).toContain("':data:' + String(dataRevision)");
    expect(source).toContain(
      'createPageCandidateElement: createPreviewInspectorPageCandidateElement',
    );
    expect(source).toContain(
      'selectedPageCandidateId: previewInspectorSession.selectedPageCandidateId',
    );
    expect(source).toContain(
      "persisted.renderScenario === 'file-components' ? 'file-components' : 'authored-page'",
    );
    expect(source).toContain('renderScenario: readPreviewInspectorRenderScenario()');
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
    expect(source).toContain(
      'rememberPreviewInspectorPickedElement(candidate, snapshot, selection)',
    );
    expect(source).toContain('PreviewInspectorHiddenElementControls');
    expect(source).toContain('reconcilePreviewInspectorHiddenElements()');
    expect(source).toContain('requestPreviewInspectorTreeReveal(selection.node.id)');
    expect(source).toContain('selectPreviewInspectorFiberTreeNode(snapshot, nodeId)');
    expect(source).toContain('function selectPreviewInspectorTreeNode(nodeId, expectedExportName)');
    expect(source).toContain('node?.exportName === expectedExportName');
    expect(source).toContain('previewInspectorSession.selectedTreeNodeId = selection.node.id');
    expect(source).toContain('previewInspectorSession.explicitTreeSelectionId = selection.node.id');
    expect(source).toContain(
      'if (selection.hostNodes.length > 0) previewInspectorSession.highlightEnabled = true',
    );
    expect(source).toContain('const currentFileExportNames = [');
    expect(source).toContain('const orderedExportNames = [');
    expect(source).toContain('targetExportNames: currentFileExportNames');
    expect(source).toContain('.map((boundary) => ({\n      boundary,\n      exportName,');
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
    expect(source).toContain("[selection.hostNodes, snapshot.status === 'static' && !explicit]");
    expect(source).toContain('if (selection === undefined) return explicit ? [[], false]');
    expect(source).toContain('treeSelection[0].length > 0 || !treeSelection[1]');
    expect(source).toContain('capturePreviewInspectorCompanionInteractionScroll(control, message)');
    expect(source).toContain(
      'schedulePreviewInspectorTreeScrollRestoration(scrollGuard.treeViewport)',
    );
    expect(source).toContain('pendingTreeReveal');
    expect(source).toContain("type: 'react-preview-inspector-open-source'");
    expect(source).toContain('function setPreviewInspectorCompanionShell(shell)');
    expect(source).toContain('function handlePreviewInspectorCompanionAction(event)');
    expect(source).toContain('previewInspectorCompanionState.elementById');
    expect(source).toContain('\'button,input,select,summary,textarea,[role="separator"],');
    expect(source).toContain("'[data-react-preview-tree-toggle-control]'");
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
