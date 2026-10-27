/** Exercises route breadcrumbs independently from compilation and preserves literal root routes. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';
import { createPreviewInspectorRouteExplorerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRouteExplorerUiRuntimeSource';
import { readPreviewInspectorRouteSelectionRequest } from '../../../../src/presentation/previewInspectorRouteSelectionProtocol';

const runtime = createPreviewInspectorPageCandidateRuntimeSource();
const routeRuntime = runtime.slice(
  runtime.indexOf('/** Returns lightweight route metadata'),
  runtime.indexOf('/** Resolves the persisted candidate id'),
);
const rootId = 'route-00000000000000000001';
const childId = 'route-00000000000000000002';

/** Runs real generated controls with inspectable hook state; real React lifecycle is browser-tested. */
function evaluate(expression: string, bindings: Record<string, unknown> = {}): unknown {
  return vm.runInNewContext(
    `
    const states = [undefined, ['reports', 'archive'], ''];
    let cursor = 0;
    const posted = [];
    const branches = [
      { id: rootId, componentName: 'HomePage', pattern: '/', pathname: '/', selectable: true,
        selectionPath: [{ componentName: 'HomePage', pattern: '/' }] },
      { id: childId, componentName: 'ReportPage', pattern: '/reports/archive', pathname: '/reports/archive',
        selectionPath: [{ componentName: 'ReportPage', pattern: '/reports/archive' }] },
    ];
    const descriptor = { inspector: { routeBranches: branches, selectedRouteBranchId: childId } };
    const previewEntryRevision = 7, previewRuntimeRevision = 7;
    const previewInspectorSession = { interactionSequence: 0 };
    const findSelectedPreviewInspectorDescriptor = () => descriptor;
    const notifyPreviewInspector = () => undefined;
    const previewInspectorPostHostMessage = message => posted.push(message);
    const React = {
      Fragment: 'fragment',
      createElement: (type, props, ...children) => typeof type === 'function'
        ? type(props ?? {}) : { type, props: props ?? {}, children },
      useMemo: callback => callback(),
      useState: () => { const index = cursor++; return [states[index], value => { states[index] = value; }]; },
      useEffect: () => undefined,
    };
    ${routeRuntime}
    ${createPreviewInspectorRouteExplorerUiRuntimeSource()}
    function elements(value) {
      if (Array.isArray(value)) return value.flatMap(elements);
      return value && typeof value === 'object' ? [value, ...value.children.flatMap(elements)] : [];
    }
    function render() { cursor = 0; return elements(PreviewInspectorRouteExplorer({ descriptor })); }
    function rootButton() { return render().find(item => item.props.className === 'rpi-route-crumb'); }
    ${expression}
    `,
    { rootId, childId, setTimeout: () => 1, clearTimeout: () => undefined, ...bindings },
  );
}

describe('Inspector root route navigation', () => {
  it('resets a deep path folder even when the current route owner is already the root', () => {
    expect(
      evaluate(`rootButton().props.onClick(); ({ owner: states[0], folder: states[1], posted });`),
    ).toEqual({ owner: undefined, folder: [], posted: [] });
  });

  it('returns to the top-level common prefix instead of retaining a nested owner folder', () => {
    expect(
      evaluate(`
        branches[0].pattern = '/company/home';
        branches[1].pattern = '/company/reports';
        branches.push({ id: 'nested', parentId: childId, pattern: '/company/reports/archive' });
        states[0] = childId;
        states[1] = ['company', 'reports', 'archive'];
        rootButton().props.onClick();
        ({ owner: states[0], folder: states[1], posted });
      `),
    ).toEqual({ owner: undefined, folder: ['company'], posted: [] });
  });

  it('resets a root-owner folder even when every route shares a nonempty prefix', () => {
    expect(
      evaluate(`
        branches[0].pattern = '/company/home';
        branches[1].pattern = '/company/reports';
        states[1] = ['company', 'reports'];
        rootButton().props.onClick(); states[1];
      `),
    ).toEqual(['company']);
  });

  it('makes a real slash route reachable again without selecting it through the breadcrumb', () => {
    expect(
      evaluate(`
        const before = render().filter(item => item.props.className?.startsWith('rpi-route-item'));
        rootButton().props.onClick();
        const after = render().filter(item => item.props.className?.startsWith('rpi-route-item'));
        ({ before: before.map(item => item.props.title), after: after.map(item => item.props.title), posted });
      `),
    ).toEqual({ before: ['/reports/archive'], after: ['/'], posted: [] });
  });

  it('names browsing separately from selecting the root page and remains safe on repeated clicks', () => {
    expect(
      evaluate(`
        const button = rootButton();
        button.props.onClick(); rootButton().props.onClick();
        ({ label: button.children.join(''), title: button.props.title, folder: states[1], posted });
      `),
    ).toEqual({
      label: '/ All routes',
      title: 'Browse all application routes without changing the selected page',
      folder: [],
      posted: [],
    });
  });

  it('sends literal slash through the real route request and strict host parser', () => {
    const message = evaluate(`
      states[1] = [];
      const button = render().find(item => item.props.className === 'rpi-route-item' && item.props.title === '/');
      button.props.onClick(); posted[0];
    `);
    expect(readPreviewInspectorRouteSelectionRequest(message)).toEqual({
      branchId: rootId,
      interactionId: 'route:7:1',
      runtimeRevision: 7,
      selectionPath: [{ componentName: 'HomePage', pattern: '/' }],
      type: 'react-preview-inspector-route-selected',
    });
  });

  it.each([
    [{ componentName: 'CompanyApp', pattern: String.raw`/company/:companyId(\d+)` }],
    [
      { componentName: 'CompanyApp', pattern: String.raw`/company/:companyId(\d+)` },
      {
        componentName: 'DocumentPage',
        pattern: String.raw`/company/:companyId(\d+)/document/:documentId(\d+)`,
      },
    ],
  ])('preserves authored numeric constraints through the route request: %j', (...selectionPath) => {
    const message = evaluate(
      `
        const branch = { ...branches[0], selectionPath: authoredSelectionPath };
        const button = PreviewInspectorRouteBranchButton({ branch, commonPrefix: [], selected: false });
        button.props.onClick(); posted[0];
      `,
      { authoredSelectionPath: selectionPath },
    );
    expect(readPreviewInspectorRouteSelectionRequest(message)).toEqual({
      branchId: rootId,
      interactionId: 'route:7:1',
      runtimeRevision: 7,
      selectionPath,
      type: 'react-preview-inspector-route-selected',
    });
  });

  it('does not change a pending route or its error when only browsing back to the root', () => {
    expect(
      evaluate(`
        Object.assign(previewInspectorSession, { pendingRouteBranchId: childId, pendingRouteBranchRevision: 7,
          pendingRouteError: { branchId: childId, revision: 7, message: 'Retry route' } });
        rootButton().props.onClick();
        ({ pending: previewInspectorSession.pendingRouteBranchId,
          error: previewInspectorSession.pendingRouteError.message, posted });
      `),
    ).toEqual({ pending: childId, error: 'Retry route', posted: [] });
  });
});
