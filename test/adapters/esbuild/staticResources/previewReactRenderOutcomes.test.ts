/** Verifies bounded JSX outcome and component-tree analysis without executing project code. */
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_REACT_RENDER_OUTCOME_LIMITS,
  analyzePreviewReactRenderOutcomes,
  type PreviewReactRenderOutcomePlan,
} from '../../../../src/adapters/esbuild/staticResources/previewReactRenderOutcomes';

describe('React render outcome analysis', () => {
  /** Models early exits and nested JSX choices as separate condition-selected results. */
  it('enumerates nested JSX branches and preserves a host-transparent component DFS tree', () => {
    const source = [
      'export function Dashboard({ session, ready, showModal }) {',
      '  if (!session) return <LoginPage />;',
      '  return (',
      '    <AppShell>',
      '      <Header />',
      '      <main>',
      '        {ready ? <Content><Widget /></Content> : <Loading />}',
      '        {showModal && <UI.Modal><ModalBody /></UI.Modal>}',
      '      </main>',
      '    </AppShell>',
      '  );',
      '}',
    ].join('\n');

    const plans = analyzePreviewReactRenderOutcomes('/workspace/src/Dashboard.tsx', source);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.exportName).toBe('Dashboard');
    expect(plans[0]?.outcomes).toHaveLength(5);
    expect(plans[0]?.outcomes[0]?.componentNames).toEqual(['LoginPage']);
    expect(plans[0]?.outcomes[0]?.conditions).toMatchObject([
      { branch: 'truthy', expression: '!session', kind: 'if', selectable: true },
    ]);

    const contentWithModal = plans[0]?.outcomes.find(
      (outcome) =>
        outcome.componentNames.includes('Content') && outcome.componentNames.includes('UI.Modal'),
    );
    expect(
      contentWithModal?.conditions.map(({ branch, expression }) => ({ branch, expression })),
    ).toEqual([
      { branch: 'falsy', expression: '!session' },
      { branch: 'truthy', expression: 'ready' },
      { branch: 'truthy', expression: 'showModal' },
    ]);
    expect(contentWithModal?.componentNames).toEqual([
      'AppShell',
      'Header',
      'Content',
      'Widget',
      'UI.Modal',
      'ModalBody',
    ]);
    expect(contentWithModal?.componentTree).toMatchObject([
      {
        children: [
          { children: [], name: 'Header' },
          { children: [{ children: [], name: 'Widget' }], name: 'Content' },
          { children: [{ children: [], name: 'ModalBody' }], name: 'UI.Modal' },
        ],
        name: 'AppShell',
      },
    ]);
  });

  /** Resolves default identifiers through nested memo/forwardRef/general HOC call chains. */
  it('finds wrapped default and aliased named component exports', () => {
    const source = [
      'const Inner = forwardRef((props, ref) =>',
      '  props.compact ? <CompactCard ref={ref} /> : <FullCard ref={ref} />',
      ');',
      'const MemoCard = memo(Inner);',
      'export default withTheme(MemoCard);',
      'export { Inner as PublicCard };',
      'export const helper = () => 42;',
    ].join('\n');

    const plans = analyzePreviewReactRenderOutcomes('/workspace/src/Card.tsx', source);

    expect(plans.map((plan) => plan.exportName)).toEqual(['default', 'PublicCard']);
    expect(plans[0]?.outcomes.map((outcome) => outcome.componentNames[0])).toEqual([
      'CompactCard',
      'FullCard',
    ]);
    expect(plans[1]?.outcomes.map((outcome) => outcome.conditions[0]?.expression)).toEqual([
      'props.compact',
      'props.compact',
    ]);
  });

  /** Retains exact primitive switch values while leaving dynamic cases explicitly read-only. */
  it('records selectable switch literals, dynamic cases, and the default outcome', () => {
    const source = [
      'export function StatusView({ status }) {',
      '  switch (status) {',
      '    case "ready": return <Ready />;',
      '    case -1: return <Retry />;',
      '    case null: return <Empty />;',
      '    case SOME_STATUS: return <Dynamic />;',
      '    default: return null;',
      '  }',
      '}',
    ].join('\n');

    const plan = analyzePreviewReactRenderOutcomes('/workspace/src/StatusView.tsx', source)[0];
    const edges = plan?.outcomes.map((outcome) => outcome.conditions[0]);

    expect(edges).toMatchObject([
      { branch: 'case', selectable: true, value: 'ready' },
      { branch: 'case', selectable: true, value: -1 },
      { branch: 'case', selectable: true, value: null },
      { branch: 'case', selectable: false },
      { branch: 'default', selectable: true },
    ]);
    expect(edges?.[3]).not.toHaveProperty('value');
    expect(edges?.[4]).not.toHaveProperty('value');
    expect(plan?.outcomes.at(-1)?.kind).toBe('empty');
  });

  /** Resolves local JSX values and treats logical-and's hidden side as an empty result. */
  it('follows bounded local render values and emits both logical-and outcomes', () => {
    const source = [
      'const body = <section><Result /></section>;',
      'export const SearchPage = ({ hasResult }) => hasResult && body;',
    ].join('\n');

    const outcomes = analyzePreviewReactRenderOutcomes('/workspace/src/SearchPage.tsx', source)[0]
      ?.outcomes;

    expect(outcomes?.map((outcome) => outcome.kind)).toEqual(['jsx', 'empty']);
    expect(outcomes?.[0]?.componentNames).toEqual(['Result']);
    expect(outcomes?.[1]?.conditions[0]).toMatchObject({
      branch: 'falsy',
      expression: 'hasResult',
      label: 'hidden',
    });
  });

  /** Gives every guard before a JSX terminal its own truthy/falsy Boolean-switch edge. */
  it('normalizes left- and right-associated logical-and JSX chains identically', () => {
    const source = [
      'export const LeftPage = ({ allowed, ready }) => allowed && ready && <Panel />;',
      'export const RightPage = ({ allowed, ready }) => allowed && (ready && <Panel />);',
    ].join('\n');
    const plans = analyzePreviewReactRenderOutcomes('/workspace/src/Page.tsx', source);

    for (const plan of plans) {
      expect(plan.outcomes).toHaveLength(3);
      expect(
        plan.outcomes.map((outcome) =>
          outcome.conditions.map((condition) => [condition.expression, condition.branch]),
        ),
      ).toEqual([
        [
          ['allowed', 'truthy'],
          ['ready', 'truthy'],
        ],
        [['allowed', 'falsy']],
        [
          ['allowed', 'truthy'],
          ['ready', 'falsy'],
        ],
      ]);
      expect(plan.outcomes[0]?.componentNames).toEqual(['Panel']);
      expect(plan.outcomes.slice(1).map((outcome) => outcome.kind)).toEqual(['empty', 'empty']);
      const logicalEdges = plan.outcomes.flatMap((outcome) => outcome.conditions);
      expect(new Set(logicalEdges.map((condition) => condition.logicalAndGroupId)).size).toBe(1);
      expect(logicalEdges.every((condition) => condition.logicalAndGuardCount === 2)).toBe(true);
      expect(
        logicalEdges.map((condition) => [condition.expression, condition.logicalAndGuardIndex]),
      ).toEqual([
        ['allowed', 0],
        ['ready', 1],
        ['allowed', 0],
        ['allowed', 0],
        ['ready', 1],
      ]);
    }
    expect(plans[0]?.outcomes[0]?.conditions[0]?.logicalAndGroupId).not.toBe(
      plans[1]?.outcomes[0]?.conditions[0]?.logicalAndGroupId,
    );
  });

  /** Invalidates condition, group, and outcome identities when only a truncated suffix changes. */
  it('fingerprints the complete logical condition beyond its bounded display prefix', () => {
    const sharedPrefix = `state.${'permission'.repeat(24)}`;
    const analyze = (suffix: string): PreviewReactRenderOutcomePlan | undefined =>
      analyzePreviewReactRenderOutcomes(
        '/workspace/src/LongGate.tsx',
        `export const Page = () => ${sharedPrefix}.${suffix} && <Panel />;`,
      )[0];
    const first = analyze('canRead');
    const second = analyze('canWrite');
    const firstCondition = first?.outcomes[0]?.conditions[0];
    const secondCondition = second?.outcomes[0]?.conditions[0];

    expect(firstCondition?.expression).toBe(secondCondition?.expression);
    expect(firstCondition?.expression).toHaveLength(180);
    expect(firstCondition?.expressionFingerprint).not.toBe(secondCondition?.expressionFingerprint);
    expect(firstCondition?.id).not.toBe(secondCondition?.id);
    expect(firstCondition?.logicalAndGroupId).not.toBe(secondCondition?.logicalAndGroupId);
    expect(first?.outcomes[0]?.id).not.toBe(second?.outcomes[0]?.id);
  });

  /** Ignores styling/data prop branches because scalar attributes do not choose rendered JSX. */
  it('does not turn scalar JSX attribute conditions into render outcomes', () => {
    const source = [
      'export function Action({ error, compact }) {',
      '  return (',
      '    <Button',
      "      color={error ? 'red' : 'blue'}",
      "      size={compact && 'small'}",
      '      data-state={error ? 500 : 200}',
      '    >',
      '      <Label />',
      '    </Button>',
      '  );',
      '}',
    ].join('\n');

    const plan = analyzePreviewReactRenderOutcomes('/workspace/src/Action.tsx', source)[0];

    expect(plan?.outcomes).toHaveLength(1);
    expect(plan?.outcomes[0]?.conditions).toEqual([]);
    expect(plan?.outcomes[0]?.componentNames).toEqual(['Button', 'Label']);
  });

  /** Preserves JSX aliases, component slots, and render callbacks while excluding scalar props. */
  it('expands statically proven render-valued attributes and component references', () => {
    const source = [
      'const body = <Body />;',
      'function renderRow({ ready }) {',
      '  return ready ? <ReadyRow /> : <PendingRow />;',
      '}',
      'export function SlotPage({ show, danger }) {',
      '  return (',
      '    <Shell',
      '      tone={danger ? "critical" : "neutral"}',
      '      component={PageFrame}',
      '      renderItem={renderRow}',
      '      content={body}',
      '      slot={show ? <Dialog /> : null}',
      '    />',
      '  );',
      '}',
    ].join('\n');

    const plan = analyzePreviewReactRenderOutcomes('/workspace/src/SlotPage.tsx', source)[0];
    const expressions = new Set(
      plan?.outcomes.flatMap((outcome) =>
        outcome.conditions.map((condition) => condition.expression),
      ),
    );

    expect(plan?.outcomes).toHaveLength(4);
    expect(expressions).toEqual(new Set(['ready', 'show']));
    expect(expressions.has('danger')).toBe(false);
    expect(plan?.outcomes.every((outcome) => outcome.componentNames.includes('PageFrame'))).toBe(
      true,
    );
    expect(plan?.outcomes.every((outcome) => outcome.componentNames.includes('Body'))).toBe(true);
    expect(plan?.outcomes.some((outcome) => outcome.componentNames.includes('ReadyRow'))).toBe(
      true,
    );
    expect(plan?.outcomes.some((outcome) => outcome.componentNames.includes('PendingRow'))).toBe(
      true,
    );
    expect(plan?.outcomes.some((outcome) => outcome.componentNames.includes('Dialog'))).toBe(true);
  });

  /** Bounds fallback AST discovery for generated/deep unsupported return expressions. */
  it('marks oversized static component discovery truncated without unbounded DFS', () => {
    const wideComponents = Array.from({ length: 700 }, (_, index) => `<Choice${String(index)} />`);
    const deeplyNested = `${'['.repeat(48)}<TooDeep />${']'.repeat(48)}`;
    const source = [
      'export function GeneratedPage() {',
      `  return inspect(${deeplyNested}, [${wideComponents.join(',')}]);`,
      '}',
    ].join('\n');

    const plan = analyzePreviewReactRenderOutcomes('/workspace/src/GeneratedPage.tsx', source)[0];

    expect(plan?.outcomes).toHaveLength(1);
    expect(plan?.outcomes[0]?.kind).toBe('unknown');
    expect(plan?.outcomes[0]?.componentNames.length).toBeLessThanOrEqual(
      PREVIEW_REACT_RENDER_OUTCOME_LIMITS.componentsPerOutcome,
    );
    expect(plan?.truncated).toBe(true);
  });

  /** Fails closed for malformed syntax and non-code resources. */
  it('returns an empty immutable inventory when parsing cannot be trusted', () => {
    const malformed = analyzePreviewReactRenderOutcomes(
      '/workspace/src/Broken.tsx',
      'export const Broken = () => <main>',
    );
    const stylesheet = analyzePreviewReactRenderOutcomes('/workspace/src/theme.scss', '.x {}');

    expect(malformed).toEqual([]);
    expect(stylesheet).toEqual([]);
    expect(Object.isFrozen(malformed)).toBe(true);
    expect(Object.isFrozen(stylesheet)).toBe(true);
  });

  /** Produces stable, deeply frozen, JSON-serializable transport records. */
  it('returns stable JSON-safe identities and recursively frozen arrays', () => {
    const source = 'export default function Page() { return <Layout><Panel /></Layout>; }';
    const first = analyzePreviewReactRenderOutcomes('/workspace/src/Page.tsx', source);
    const second = analyzePreviewReactRenderOutcomes('/workspace/src/Page.tsx', source);
    const outcome = first[0]?.outcomes[0];

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome?.conditions)).toBe(true);
    expect(Object.isFrozen(outcome?.componentTree)).toBe(true);
    expect(Object.isFrozen(outcome?.componentTree[0]?.children)).toBe(true);
  });

  /** Stops adversarial branch growth at the documented per-export outcome budget. */
  it('marks a plan truncated when authored branches exceed the outcome budget', () => {
    const guards = Array.from(
      { length: PREVIEW_REACT_RENDER_OUTCOME_LIMITS.outcomesPerExport + 8 },
      (_, index) => `  if (value === ${String(index)}) return <Choice${String(index)} />;`,
    );
    const source = [
      'export function ManyChoices({ value }) {',
      ...guards,
      '  return null;',
      '}',
    ].join('\n');

    const plan = analyzePreviewReactRenderOutcomes('/workspace/src/ManyChoices.tsx', source)[0];

    expect(plan?.outcomes).toHaveLength(PREVIEW_REACT_RENDER_OUTCOME_LIMITS.outcomesPerExport);
    expect(plan?.truncated).toBe(true);
  });
});
