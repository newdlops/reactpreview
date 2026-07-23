/** Verifies syntax-only JSX condition instrumentation without executing application expressions. */
import { describe, expect, it } from 'vitest';
import { instrumentReactConditionalRendering } from '../../../../src/adapters/esbuild/staticResources/reactConditionalRendering';

/** Reads stable authored-condition identities without coupling tests to generated resolver IDs. */
function readAuthoredExpressions(transformed: string): readonly string[] {
  return [...transformed.matchAll(/"authoredExpression":("(?:\\.|[^"\\])*")/gu)].map(
    (match) => JSON.parse(match[1] ?? '""') as string,
  );
}

/** Counts eager and lazy condition resolvers without coupling assertions to one syntax family. */
function readRenderConditionCalls(transformed: string): readonly string[] {
  return transformed.match(/\.resolveRenderCondition(?:Lazy)?\(/gu) ?? [];
}

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

    expect(readRenderConditionCalls(transformed)).toHaveLength(2);
    expect(transformed).toContain(
      ', () => (visible), {"authoredExpression":"visible","column":8,"expression":"visible"',
    );
    expect(transformed).toContain('.resolveRenderConditionLazy(');
    expect(transformed).toContain('"kind":"logical-and"');
    expect(transformed).toContain('"truthyLabel":"<Panel>"');
    expect(transformed).toContain(
      ', (ready), {"authoredExpression":"ready","column":8,"expression":"ready"',
    );
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(2);
    expect(transformed).toContain('resolveRenderCondition');
    expect(readAuthoredExpressions(transformed)).toEqual([
      'user.isStaff',
      'window.APP.service === "staff"',
    ]);
    expect(transformed).toContain('"truthyLabel":"<StaffApplication> route"');
    expect(transformed).toContain('const options = user.isStaff && { cache: true };');
  });

  /** Instruments every guard regardless of the parser's left- or right-associated AND shape. */
  it('flattens left- and right-nested logical render chains without duplicate guards', () => {
    const variants = [
      'export const Page = ({ a, b }) => a && b && <Panel />;',
      'export const Page = ({ a, b }) => a && (b && <Panel />);',
    ];

    for (const source of variants) {
      const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

      expect(readRenderConditionCalls(transformed)).toHaveLength(2);
      expect(readAuthoredExpressions(transformed)).toEqual(['a', 'b']);
      expect(transformed.match(/"authoredExpression":"b"/gu)).toHaveLength(1);
      expect(transformed).toContain('"truthyLabel":"<Panel>"');
    }
  });

  /** Gives same-prefix long hot edits distinct metadata fingerprints and runtime condition IDs. */
  it('fingerprints the complete authored condition beyond its metadata display limit', () => {
    const sharedPrefix = `state.${'permission'.repeat(24)}`;
    const transform = (suffix: string): string =>
      instrumentReactConditionalRendering(
        '/workspace/src/LongGate.tsx',
        `export const Page = () => ${sharedPrefix}.${suffix} && <Panel />;`,
      );
    const first = transform('canRead');
    const second = transform('canWrite');
    const readFingerprint = (source: string): string | undefined =>
      /"expressionFingerprint":"([a-f\d]{64})"/u.exec(source)?.[1];
    const readConditionId = (source: string): string | undefined =>
      /\.resolveRenderConditionLazy\("([^"]+)"/u.exec(source)?.[1];

    expect(readAuthoredExpressions(first)).toEqual(readAuthoredExpressions(second));
    expect(readAuthoredExpressions(first)[0]).toHaveLength(180);
    expect(readFingerprint(first)).not.toBe(readFingerprint(second));
    expect(readConditionId(first)).not.toBe(readConditionId(second));
  });

  /** Keeps the outer AND gate and the nested ternary choice independently controllable. */
  it('instruments logical guards leading to a nested JSX ternary terminal', () => {
    const source = 'export const Page = ({ a, b }) => a && (b ? <Panel /> : null);';

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(readRenderConditionCalls(transformed)).toHaveLength(2);
    expect(readAuthoredExpressions(transformed)).toEqual(['a', 'b']);
    expect(transformed).toContain('"kind":"logical-and"');
    expect(transformed).toContain('"kind":"ternary"');
    expect(transformed).toContain('"truthyLabel":"<Panel>"');
  });

  /** Keeps the source-wide logical decision that static return-outcome analysis identifies. */
  it('prefers an outer logical guard over its overlapping nested ternary condition', () => {
    const source = [
      'export function Page({ flag }) {',
      '  return (flag ? <Gate /> : null) && <Panel />;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
    expect(readAuthoredExpressions(transformed)).toEqual(['flag ? <Gate /> : null']);
    expect(transformed).toContain('.resolveRenderConditionLazy(');
    expect(transformed).toContain('"kind":"logical-and"');
    expect(transformed).not.toContain('"authoredExpression":"flag"');
  });

  /** Keeps the outer ternary choice when its complete condition contains a JSX logical gate. */
  it('prefers an outer ternary condition over its overlapping nested logical guard', () => {
    const source = [
      'export function Page({ allowed }) {',
      '  return (allowed && <Gate />) ? <Panel /> : <Fallback />;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);
    const authoredExpressions = readAuthoredExpressions(transformed);

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
    expect(authoredExpressions).toHaveLength(1);
    expect(authoredExpressions[0]).toContain('allowed && <Gate />');
    expect(transformed).toContain('.resolveRenderCondition(');
    expect(transformed).toContain('"kind":"ternary"');
    expect(transformed).not.toContain('"authoredExpression":"allowed"');
  });

  /** Avoids controls whose authored values were frozen when the module was first evaluated. */
  it('does not instrument module-initializer logical or ternary render values', () => {
    const source = [
      'const moduleGate = ready && <Panel />;',
      'const moduleChoice = ready ? <Content /> : <Fallback />;',
      'export function Page() {',
      '  return <>{moduleGate}{moduleChoice}</>;',
      '}',
    ].join('\n');

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });

  /** Follows only unique lexical JSX aliases and stops when a parameter shadows an outer alias. */
  it('recognizes safe module and function JSX aliases while failing closed on shadowing', () => {
    const source = [
      'const moduleBody = <ModulePanel />;',
      'const shadowedBody = <OuterPanel />;',
      'export function Page({ showModule, showLocal }) {',
      '  const localBody = <LocalPanel />;',
      '  return <>{showModule && moduleBody}{showLocal && localBody}</>;',
      '}',
      'export function Shadowed({ show, shadowedBody }) {',
      '  return show && shadowedBody;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(readRenderConditionCalls(transformed)).toHaveLength(2);
    expect(readAuthoredExpressions(transformed)).toEqual(['showModule', 'showLocal']);
    expect(transformed).toContain('"truthyLabel":"<ModulePanel>"');
    expect(transformed).toContain('"truthyLabel":"<LocalPanel>"');
    expect(transformed).not.toContain('"authoredExpression":"show"');
  });

  /** Rejects mutable aliases and limits catch-parameter shadowing to its lexical catch block. */
  it('fails closed on mutable and catch-shadowed render aliases', () => {
    const source = [
      'const body = <OuterPanel />;',
      'export function Page({ showCatch, showMutable }) {',
      '  let mutableBody = <MutablePanel />;',
      '  mutableBody = <ReplacementPanel />;',
      '  try {',
      '    runTask();',
      '  } catch (body) {',
      '    return showCatch && body;',
      '  }',
      '  return showMutable && mutableBody;',
      '}',
    ].join('\n');

    expect(instrumentReactConditionalRendering('/workspace/src/Page.tsx', source)).toBe(source);
  });

  /** Preserves overlay metadata for exact React.createElement component factories. */
  it('instruments React.createElement terminals and classifies modal factories as overlays', () => {
    const source = [
      'export function Page({ open }) {',
      '  return open && React.createElement(DeleteModal, { open: true });',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
    expect(readAuthoredExpressions(transformed)).toEqual(['open']);
    expect(transformed).toContain('"role":"overlay"');
    expect(transformed).toContain('"truthyLabel":"<DeleteModal>"');
  });

  /** Treats a bounded literal array as one render outcome while retaining its component names. */
  it('instruments arrays of JSX terminals without instrumenting scalar arrays', () => {
    const source = [
      'export function Page({ items, show }) {',
      '  const scalar = show && items.map((item) => item.id);',
      '  return show && [<Header key="h" />, <Panel key="p" />];',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
    expect(readAuthoredExpressions(transformed)).toEqual(['show']);
    expect(transformed).toContain('"truthyLabel":"<Header> | <Panel>"');
    expect(transformed).toContain('const scalar = show && items.map((item) => item.id);');
  });

  /** Reaches JSX returned from map and flatMap callbacks and exposes their nested branch choices. */
  it('instruments render-producing map and flatMap callback paths', () => {
    const source = [
      'export function Page({ groups, items, showGroups, showRows }) {',
      '  return <>',
      '    {showRows && items.map((item) => item.visible && <Row key={item.id} />)}',
      '    {showGroups && groups.flatMap((group) =>',
      '      group.open ? [<Group key={group.id} />] : [],',
      '    )}',
      '  </>;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering('/workspace/src/Page.tsx', source);

    expect(readRenderConditionCalls(transformed)).toHaveLength(4);
    expect(readAuthoredExpressions(transformed)).toEqual([
      'showRows',
      'item.visible',
      'showGroups',
      'group.open',
    ]);
    expect(transformed).toContain('"truthyLabel":"<Row>"');
    expect(transformed).toContain('"truthyLabel":"<Group>"');
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(3);
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
    expect(transformed).toContain('"expression":"<Application> gate: !session"');
    expect(transformed).toContain('"fallbackBranch":"truthy"');
    expect(transformed).toContain('"kind":"early-return"');
    expect(transformed).toContain('"ownerName":"Application"');
    expect(transformed).toContain('"targetBranch":"falsy"');
    expect(transformed).toContain('"falsyLabel":"continue <Application>"');
  });

  /** Marks a route-mutating early return so runtime DFS can preserve the original route on pass one. */
  it('classifies an exact Navigate return as a synchronous navigation continuation', () => {
    const source = [
      'export function GuardedPage({ isStaffMode }) {',
      '  if (!isStaffMode) return <Navigate to="/login" replace />;',
      '  return <InvestmentContractUploadPanel />;',
      '}',
    ].join('\n');

    const transformed = instrumentReactConditionalRendering(
      '/workspace/src/GuardedPage.tsx',
      source,
    );

    expect(transformed).toContain('"fallbackBranch":"truthy"');
    expect(transformed).toContain('"role":"navigation"');
    expect(transformed).toContain('"targetBranch":"falsy"');
    expect(transformed).toContain('"truthyLabel":"<Navigate>"');
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
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

    expect(readRenderConditionCalls(transformed)).toHaveLength(1);
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
