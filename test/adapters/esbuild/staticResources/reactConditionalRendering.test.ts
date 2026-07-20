/** Verifies syntax-only JSX condition instrumentation without executing application expressions. */
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

describe('React conditional rendering instrumentation', () => {
  /** Exposes logical-and visibility and both authored ternary branches through stable runtime calls. */
  it('instruments direct JSX conditions and records readable branch metadata', () => {
    const sourcePath = '/workspace/src/Page.tsx';
    const source = [
      'export function Page({ ready, visible }) {',
      '  return (',
      '    <main>',
      '      {visible && <Panel />}',
      '      {ready ? <Content /> : <LoadingFallback />}',
      '    </main>',
      '  );',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(sourcePath, source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(2);
    expect(transformed).toContain(', (visible), {"column":8,"expression":"visible"');
    expect(transformed).toContain('"kind":"logical-and"');
    expect(transformed).toContain('"truthyLabel":"<Panel>"');
    expect(transformed).toContain(', (ready), {"column":8,"expression":"ready"');
    expect(transformed).toContain('"fallbackBranch":"falsy"');
    expect(transformed).toContain('"falsyLabel":"<LoadingFallback>"');
    expect(transformed).toContain('"kind":"ternary"');
    expect(transformed).toContain('"truthyLabel":"<Content>"');
  });

  /** Retains direct Fragment children so DFS can choose a gate leading to the selected component. */
  it('labels logical Fragment branches with their direct component children', () => {
    const source = [
      'export function Page({ result }) {',
      '  return result && <>',
      '    <DataAggregateInfoSection />',
      '    <CallBlockHistorySection />',
      '  </>;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain(
      '"truthyLabel":"<Fragment: DataAggregateInfoSection, CallBlockHistorySection>"',
    );
  });

  /** Leaves ordinary boolean computation, comments, strings, and non-JSX ternaries untouched. */
  it('does not instrument conditions that do not directly select JSX', () => {
    const source = [
      "const example = 'ready && <Panel />';",
      'const enabled = ready && permission;',
      'const label = ready ? "ready" : "waiting";',
      'export { enabled, example, label };',
    ].join('\n');

    expect(instrumentReactConditionalRendering('/workspace/src/state.ts', source)).toBe(source);
  });

  /** Reveals a route object whose page element was removed by an application-mode condition. */
  it('instruments conditional JSX route entries without touching ordinary object selection', () => {
    const source = [
      'export function createRoutes(user) {',
      '  const routes = [',
      '    user.isStaff && window.APP.service === "staff" && {',
      '      path: "*",',
      '      element: <StaffApplication />,',
      '    },',
      '  ];',
      '  const options = user.isStaff && { cache: true };',
      '  return { options, routes };',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/routes.tsx', source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain('resolveRenderCondition');
    expect(transformed).toContain('(user.isStaff && window.APP.service === "staff")');
    expect(transformed).toContain('"truthyLabel":"<StaffApplication> route"');
    expect(transformed).toContain('const options = user.isStaff && { cache: true };');
  });

  /** Exposes controlled overlay props and exact ReactDOM portal branches as visibility controls. */
  it('instruments dormant modal props and createPortal render branches', () => {
    const source = [
      "import { createPortal as mountPortal } from 'react-dom';",
      'export function Page({ hidden, open }) {',
      '  return <main>',
      '    <DeleteModal open={open}><p>Delete?</p></DeleteModal>',
      '    <SideDrawer hidden={hidden} />',
      '    {open && mountPortal(<ConfirmDialog />, document.body)}',
      '  </main>;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(3);
    expect(transformed).toContain('"kind":"overlay-visibility"');
    expect(transformed).toContain('"role":"overlay"');
    expect(transformed).toContain('"expression":"<DeleteModal>.open: open"');
    expect(transformed).toContain('"ownerName":"DeleteModal"');
    expect(transformed).toContain('"truthyLabel":"visible <DeleteModal> overlay"');
    expect(transformed).toContain('"truthyLabel":"<ConfirmDialog> portal overlay"');
    expect(transformed).toContain('"role":"overlay"');
    expect(transformed).toContain('hidden={!(');
  });

  /** Avoids assigning overlay behavior from a generic prop name on an ordinary component. */
  it('does not instrument visibility-like props on non-overlay components', () => {
    const source = 'export const Page = ({ open }) => <Panel open={open} />;';

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });

  /** Marks a conditionally mounted Modal as an overlay gate so target DFS can open it. */
  it('classifies logical-and modal mounting as target-relevant overlay visibility', () => {
    const source = [
      'export function Page({ open }) {',
      '  return <main>{open && <CompanyRegisterModal />}</main>;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain('"kind":"logical-and","role":"overlay"');
    expect(transformed).toContain('"truthyLabel":"<CompanyRegisterModal>"');
  });

  /** Makes an overlay component's early null return visible without changing its authored default. */
  it('instruments a modal-local hidden guard as visible-state control', () => {
    const source = [
      "import { createPortal } from 'react-dom';",
      'export function DeleteModal({ open }) {',
      '  if (!open) return null;',
      '  return createPortal(<div role="dialog" />, document.body);',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(
      '/workspace/src/DeleteModal.tsx',
      source,
    );

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain('"expression":"<DeleteModal> visibility: !open"');
    expect(transformed).toContain('"kind":"overlay-visibility"');
    expect(transformed).toContain('"ownerName":"DeleteModal"');
    expect(transformed).toContain('if (!(');
  });

  /** Records successful login/permission exits as gates whose opposite branch reaches descendants. */
  it('instruments a component early-return gate with target continuation metadata', () => {
    const source = [
      'export function Application({ session }) {',
      '  if (!session) return <LoginPage />;',
      '  return <AuthenticatedRoutes />;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(
      '/workspace/src/Application.tsx',
      source,
    );

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain('"expression":"<Application> gate: !session"');
    expect(transformed).toContain('"fallbackBranch":"truthy"');
    expect(transformed).toContain('"kind":"early-return"');
    expect(transformed).toContain('"ownerName":"Application"');
    expect(transformed).toContain('"targetBranch":"falsy"');
    expect(transformed).toContain('"falsyLabel":"continue <Application>"');
  });

  /** Recovers the authored owner through styling/HOC factories so descendant branches stay reachable. */
  it('instruments an early-return branch inside a styled component factory', () => {
    const source = [
      'const DashboardPage = styled(({ company }) => {',
      '  if (company.registerStatus === "name_only") {',
      '    return <BeforeRegistration />;',
      '  }',
      '  return <ActiveDashboard />;',
      '})`display: block;`;',
      'export default memo(DashboardPage);',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(
      '/workspace/src/DashboardPage.tsx',
      source,
    );

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain(
      '"expression":"<DashboardPage> gate: company.registerStatus === \\"name_only\\""',
    );
    expect(transformed).toContain('"ownerName":"DashboardPage"');
    expect(transformed).toContain('"truthyLabel":"<BeforeRegistration>"');
  });

  /** Lets target-path scoring choose between two authored component returns without guessing state. */
  it('instruments both sides of an if-else component branch', () => {
    const source = [
      'export function RoutedPage({ allowed }) {',
      '  if (allowed) {',
      '    return <OwnerDashboard />;',
      '  } else {',
      '    return <PermissionFallback />;',
      '  }',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(
      '/workspace/src/RoutedPage.tsx',
      source,
    );

    expect(transformed.match(/\.resolveRenderCondition\(/gu)).toHaveLength(1);
    expect(transformed).toContain('"expression":"<RoutedPage> branch: allowed"');
    expect(transformed).toContain('"fallbackBranch":"falsy"');
    expect(transformed).toContain('"falsyLabel":"<PermissionFallback>"');
    expect(transformed).toContain('"ownerName":"RoutedPage"');
    expect(transformed).not.toContain('"targetBranch"');
    expect(transformed).toContain('"truthyLabel":"<OwnerDashboard>"');
  });

  /** Fails closed on incomplete editor syntax rather than applying parser-recovery offsets. */
  it('preserves incomplete TSX snapshots', () => {
    const source = 'export function Page() { return ready && <Panel>; }';

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });
});
