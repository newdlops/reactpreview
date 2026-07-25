/** Verifies the source-qualified JSX ON/OFF scenario projection without mounting project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorJsxScenarioUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorJsxScenarioUiRuntimeSource';

interface JsxScenarioRecord {
  readonly effectiveEnabled: boolean;
  readonly expression: string;
  readonly falsyLabel: string;
  readonly id?: string;
  readonly lineageBlocked: boolean;
  readonly lineageBlockedByExpression?: string;
  readonly lineageDepth: number;
  readonly lineageDescendantCount: number;
  readonly lineageParentExpression?: string;
  readonly lineageParentRequiredEnabled?: boolean;
  readonly reached: boolean;
  readonly sourcePath: string;
  readonly truthyLabel: string;
}

describe('Preview Inspector JSX scenario UI runtime source', () => {
  /** Parses the generated browser module and retains the explicit scenario table contract. */
  it('emits a current-file Boolean scenario table with reversible controls', () => {
    const source = createPreviewInspectorJsxScenarioUiRuntimeSource();

    expect(() => new vm.Script(source)).not.toThrow();
    expect(source).toContain('function collectPreviewInspectorJsxScenarioRecords()');
    expect(source).toContain("'Switch lineage / JSX condition'");
    expect(source).toContain("'OFF renders'");
    expect(source).toContain("'ON renders'");
    expect(source).toContain('setPreviewInspectorRenderConditionOverride(scenario.id, false)');
    expect(source).toContain('setPreviewInspectorRenderConditionOverride(scenario.id, true)');
    expect(source).toContain('resetPreviewInspectorRenderConditionOverride(scenario.id)');
    expect(source).toContain("'No Boolean JSX branches were found in the selected file.'");
    expect(source).toContain('function usePreviewInspectorJsxScenarioSourceDecorations()');
    expect(source).toContain("type: 'react-preview-inspector-branch-sources'");
    expect(source).toContain("'data-rpi-scroll-key': 'jsx-scenarios'");
    expect(source).toContain(
      'function attachPreviewInspectorJsxScenarioLineage(outcomes, records)',
    );
    expect(source).toContain('previewInspectorSourceNavigation.openSource(');
    expect(source).toContain("'Highlight code'");
  });

  /** Proves nested guards while excluding identical ancestor-app coordinates. */
  it('shows a conservative parent/child lineage and keeps independent switches at the root', () => {
    const records = evaluateJsxScenarioRecords();

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      effectiveEnabled: true,
      expression: 'loaded',
      falsyLabel: '<Loading>',
      id: 'runtime-loaded',
      lineageBlocked: false,
      lineageDepth: 0,
      lineageDescendantCount: 1,
      reached: true,
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<Content>',
    });
    expect(records[1]).toMatchObject({
      effectiveEnabled: false,
      expression: 'showDetails',
      lineageBlocked: false,
      lineageDepth: 1,
      lineageParentExpression: 'loaded',
      lineageParentRequiredEnabled: true,
      reached: false,
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<Details>',
    });
    expect(records[2]).toMatchObject({
      expression: 'standalone',
      lineageBlocked: false,
      lineageDepth: 0,
      reached: false,
    });
    expect(records.some((record) => record.expression === 'ancestorReady')).toBe(false);
  });

  /** A disabled outer guard makes a previously discovered child inactive in the table model. */
  it('reports the first unsatisfied parent instead of showing a stale child value as active', () => {
    const records = evaluateJsxScenarioRecords(false);
    const child = records.find((record) => record.expression === 'showDetails');

    expect(child).toMatchObject({
      lineageBlocked: true,
      lineageBlockedByExpression: 'loaded',
      lineageParentRequiredEnabled: true,
    });
  });
});

/** Evaluates the generated data model with static outcomes and a small live condition inventory. */
function evaluateJsxScenarioRecords(loadedEnabled = true): readonly JsxScenarioRecord[] {
  const context: { __records?: readonly JsxScenarioRecord[] } = {};
  vm.runInNewContext(
    `
      const normalizePreviewInspectorConditionSourcePath = (value) =>
        typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
      const matchesPreviewInspectorConditionSourcePath = (left, right) =>
        left === right || (left.length > 0 && right.length > 0 &&
          (left.endsWith('/' + right) || right.endsWith('/' + left)));
      const readPreviewInspectorRenderOutcomeConditionSource = (condition) => ({
        column: condition.column,
        expression: condition.expression,
        expressionFingerprint: condition.expressionFingerprint,
        line: condition.line,
        sourcePath: condition.sourcePath,
      });
      const matchesPreviewInspectorRenderOutcomeCondition = (condition, runtime) =>
        condition.sourcePath === runtime.sourcePath &&
        condition.line === runtime.line &&
        condition.column === runtime.column &&
        condition.expression === runtime.authoredExpression;
      const outcomes = [
        {
          componentNames: ['Content'],
          conditions: [
            {
              branch: 'truthy',
              column: 5,
              expression: 'loaded',
              kind: 'ternary',
              line: 10,
              sourcePath: '/workspace/Page.tsx',
            },
            {
              branch: 'truthy',
              column: 3,
              expression: 'showDetails',
              kind: 'logical-and',
              line: 20,
              sourcePath: '/workspace/Page.tsx',
            },
          ],
          label: '<Content>',
        },
        {
          componentNames: ['Summary'],
          conditions: [
            {
              branch: 'truthy',
              column: 5,
              expression: 'loaded',
              kind: 'ternary',
              line: 10,
              sourcePath: '/workspace/Page.tsx',
            },
            {
              branch: 'falsy',
              column: 3,
              expression: 'showDetails',
              kind: 'logical-and',
              line: 20,
              sourcePath: '/workspace/Page.tsx',
            },
          ],
          label: '<Summary>',
        },
        {
          componentNames: ['Loading'],
          conditions: [{
            branch: 'falsy',
            column: 5,
            expression: 'loaded',
            kind: 'ternary',
            line: 10,
            sourcePath: '/workspace/Page.tsx',
          }],
          label: '<Loading>',
        },
        {
          componentNames: ['Standalone'],
          conditions: [{
            branch: 'truthy',
            column: 3,
            expression: 'standalone',
            kind: 'logical-and',
            line: 30,
            sourcePath: '/workspace/Page.tsx',
          }],
          label: '<Standalone>',
        },
        {
          conditions: [{
            branch: 'falsy',
            column: 3,
            expression: 'standalone',
            kind: 'logical-and',
            line: 30,
            sourcePath: '/workspace/Page.tsx',
          }],
          label: 'hidden',
        },
      ];
      const runtimeConditions = [
        {
          authoredEnabled: false,
          authoredExpression: 'loaded',
          column: 5,
          effectiveEnabled: ${loadedEnabled ? 'true' : 'false'},
          expression: 'loaded',
          falsyLabel: '<Loading>',
          id: 'runtime-loaded',
          kind: 'ternary',
          line: 10,
          override: true,
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: '<Content>',
        },
        {
          authoredEnabled: true,
          authoredExpression: 'ancestorReady',
          column: 1,
          effectiveEnabled: true,
          expression: 'ancestorReady',
          falsyLabel: '<Login>',
          id: 'ancestor-ready',
          kind: 'ternary',
          line: 2,
          sourcePath: '/workspace/App.tsx',
          truthyLabel: '<Page>',
        },
      ];
      const readPreviewInspectorSelectedRenderOutcomePlan = () => ({
        outcomes,
        sourcePath: '/workspace/Page.tsx',
      });
      const readPreviewInspectorStaticRenderOutcomes = () => outcomes;
      const readPreviewInspectorRenderConditions = () => runtimeConditions;
      const readPreviewInspectorLogicalSwitchRecords = () => [
        {
          conditionTreeId: 'logical-and:details',
          effectiveEnabled: false,
          expression: 'showDetails',
          falsyLabel: 'hidden',
          kind: 'logical-and',
          line: 20,
          column: 3,
          reached: false,
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: '<Details>',
        },
        {
          conditionTreeId: 'logical-and:standalone',
          effectiveEnabled: false,
          expression: 'standalone',
          falsyLabel: 'hidden',
          kind: 'logical-and',
          line: 30,
          column: 3,
          reached: false,
          sourcePath: '/workspace/Page.tsx',
          truthyLabel: '<Standalone>',
        },
      ];
      ${createPreviewInspectorJsxScenarioUiRuntimeSource()}
      globalThis.__records = collectPreviewInspectorJsxScenarioRecords();
    `,
    context,
  );
  if (context.__records === undefined) {
    throw new Error('Generated JSX scenario model did not initialize.');
  }
  return context.__records;
}
