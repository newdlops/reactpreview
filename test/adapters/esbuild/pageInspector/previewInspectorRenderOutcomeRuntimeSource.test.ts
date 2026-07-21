/**
 * Verifies the browser-side bridge between static JSX return outcomes and runtime branch controls.
 *
 * These tests intentionally evaluate generated JavaScript in an inert VM instead of mounting React.
 * That keeps the contract focused on source-qualified scenario lookup, precedence, bounds, and the
 * single-remount notification policy shared by boolean conditions and switch choices.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';
import { createPreviewInspectorRenderOutcomeRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderOutcomeRuntimeSource';
import {
  boundedPreviewRenderText,
  createPreviewRenderExpressionFingerprint,
} from '../../../../src/adapters/esbuild/staticResources/previewReactRenderOutcomeSyntax';

interface RenderOutcomeRuntimeObservations {
  commits: number;
  notifications: number;
  persists: number;
}

interface RenderOutcomeRuntimeHarness {
  readonly clearOutcome: () => boolean;
  readonly observations: RenderOutcomeRuntimeObservations;
  readonly readChoiceOverrides: () => Record<string, string>;
  readonly readConditionOverrides: () => Record<string, boolean>;
  readonly readOutcome: () => Record<string, unknown> | undefined;
  readonly readOutcomes: () => readonly Record<string, unknown>[];
  readonly readSelection: () => string | undefined;
  readonly resolveChoice: (
    choiceId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly resolveCondition: (
    conditionId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly selectOutcome: (outcomeId: string) => boolean;
  readonly setChoice: (choiceId: string, branchId: string) => boolean;
  readonly setCondition: (conditionId: string, enabled: boolean) => void;
  readonly session: Record<string, unknown>;
}

interface RenderOutcomeFixtureOptions {
  readonly exportName?: string;
  readonly outcomes: readonly Record<string, unknown>[];
  readonly persistedState?: Record<string, unknown>;
  readonly selectedExportName?: string;
  readonly selectedOutcomeId?: string;
}

describe('Preview Inspector render outcome runtime source', () => {
  /** Selects the exact export plan and projects only a same-source condition onto its boolean gate. */
  it('looks up the selected outcome and source-qualifies boolean branch overrides', () => {
    const harness = createRenderOutcomeRuntimeHarness({
      exportName: 'Dashboard',
      outcomes: [
        {
          conditions: [
            {
              branch: 'falsy',
              expression: 'ready && enabled',
              source: { column: 17, line: 24, path: '/workspace/src/Dashboard.tsx' },
            },
          ],
          id: 'dashboard-loading',
          label: 'Loading',
        },
      ],
      selectedOutcomeId: 'dashboard-loading',
    });
    const matchingMetadata = {
      column: 17,
      expression: ' ready  &&  enabled ',
      kind: 'ternary',
      line: 24,
      sourcePath: 'src/Dashboard.tsx',
    };

    expect(harness.readOutcome()).toMatchObject({
      id: 'dashboard-loading',
      label: 'Loading',
    });
    expect(harness.resolveCondition('dashboard-gate', true, matchingMetadata)).toBe(false);

    // Identical source coordinates in another absolute file must retain their authored value.
    expect(
      harness.resolveCondition('other-file-gate', true, {
        ...matchingMetadata,
        sourcePath: '/workspace/src/OtherDashboard.tsx',
      }),
    ).toBe(true);
  });

  /** Retains the 160-180 character range shared by static edges and runtime authored metadata. */
  it('matches condition expressions up to the runtime 180-character boundary', () => {
    const authoredExpression = `state.${'a'.repeat(164)}`;
    const staticExpression = boundedPreviewRenderText(authoredExpression);
    expect(authoredExpression).toHaveLength(170);
    expect(staticExpression).toBe(authoredExpression);

    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [
            {
              branch: 'falsy',
              expression: staticExpression,
              source: { column: 13, line: 18, path: '/workspace/src/LongGate.tsx' },
            },
          ],
          id: 'long-gate-falsy',
        },
      ],
      selectedOutcomeId: 'long-gate-falsy',
    });

    expect(
      harness.resolveCondition('long-gate', true, {
        authoredExpression: boundedPreviewRenderText(authoredExpression),
        column: 13,
        expression: 'long condition',
        kind: 'ternary',
        line: 18,
        sourcePath: '/workspace/src/LongGate.tsx',
      }),
    ).toBe(false);
  });

  /** Rejects stale same-position decisions by fingerprint before using legacy bounded text. */
  it('does not match same-prefix over-limit conditions with a different fingerprint', () => {
    const sharedPrefix = `state.${'permission'.repeat(24)}`;
    const firstAuthoredExpression = `${sharedPrefix}.canRead`;
    const secondAuthoredExpression = `${sharedPrefix}.canWrite`;
    const firstExpression = boundedPreviewRenderText(firstAuthoredExpression);
    const secondExpression = boundedPreviewRenderText(secondAuthoredExpression);
    const firstFingerprint = createPreviewRenderExpressionFingerprint(firstAuthoredExpression);
    const secondFingerprint = createPreviewRenderExpressionFingerprint(secondAuthoredExpression);
    expect(firstExpression).toHaveLength(180);
    expect(secondExpression).toBe(firstExpression);
    expect(secondFingerprint).not.toBe(firstFingerprint);
    expect(firstExpression.endsWith('…')).toBe(true);

    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [
            {
              branch: 'falsy',
              expression: firstExpression,
              expressionFingerprint: firstFingerprint,
              source: { column: 9, line: 31, path: '/workspace/src/LongGate.tsx' },
            },
          ],
          id: 'first-long-gate-falsy',
        },
      ],
      selectedOutcomeId: 'first-long-gate-falsy',
    });
    const runtimeMetadata = {
      authoredExpression: secondExpression,
      column: 9,
      expression: 'long condition',
      expressionFingerprint: secondFingerprint,
      kind: 'early-return',
      line: 31,
      sourcePath: '/workspace/src/LongGate.tsx',
    };

    expect(harness.resolveCondition('stale-same-position-gate', true, runtimeMetadata)).toBe(true);
    expect(
      harness.resolveCondition('matching-fingerprint-gate', true, {
        ...runtimeMetadata,
        expressionFingerprint: firstFingerprint,
      }),
    ).toBe(false);
    expect(
      harness.resolveCondition('mixed-version-legacy-gate', true, {
        ...runtimeMetadata,
        expressionFingerprint: undefined,
      }),
    ).toBe(false);
    expect(
      harness.resolveCondition('different-column-gate', true, {
        ...runtimeMetadata,
        column: 10,
      }),
    ).toBe(true);
    expect(
      harness.resolveCondition('different-line-gate', true, {
        ...runtimeMetadata,
        line: 32,
      }),
    ).toBe(true);
  });

  /** Keeps JSX logical-AND visibility independent from whole-return scenario selection. */
  it('does not project or clear logical-and boolean switches from a selected outcome', () => {
    const condition = {
      branch: 'falsy',
      column: 8,
      expression: 'showDetails',
      kind: 'logical-and',
      line: 20,
      sourcePath: '/workspace/Page.tsx',
    };
    const metadata = {
      column: 8,
      expression: 'showDetails',
      kind: 'logical-and',
      line: 20,
      sourcePath: '/workspace/Page.tsx',
    };
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        { conditions: [], id: 'authored' },
        { conditions: [condition], id: 'details-hidden' },
      ],
    });

    expect(harness.resolveCondition('details-switch', true, metadata)).toBe(true);
    harness.setCondition('details-switch', true);
    expect(harness.selectOutcome('details-hidden')).toBe(true);
    expect(harness.readConditionOverrides()).toEqual({ 'details-switch': true });
    expect(harness.resolveCondition('details-switch', false, metadata)).toBe(true);
  });

  /** Joins a readable modal label through its raw expression and preserves inverted visibility. */
  it('projects a modal null-return outcome onto normalized visible-state semantics', () => {
    const harness = createRenderOutcomeRuntimeHarness({
      exportName: 'DeleteModal',
      outcomes: [
        {
          conditions: [
            {
              branch: 'truthy',
              column: 7,
              expression: '!open',
              line: 3,
              sourcePath: '/workspace/DeleteModal.tsx',
            },
          ],
          id: 'modal-hidden',
        },
      ],
      selectedOutcomeId: 'modal-hidden',
    });

    expect(
      harness.resolveCondition('modal-visibility', true, {
        authoredExpression: '!open',
        authoredExpressionNegated: true,
        column: 7,
        expression: '<DeleteModal> visibility: !open',
        kind: 'overlay-visibility',
        line: 3,
        role: 'overlay',
        sourcePath: '/workspace/DeleteModal.tsx',
      }),
    ).toBe(false);
  });

  /** Keeps a selected whole-return scenario authoritative over later exact debugger edits. */
  it('reconciles a late manual boolean override with the selected outcome', () => {
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [
            {
              branch: 'falsy',
              column: 9,
              expression: 'hasSession',
              line: 12,
              sourcePath: '/workspace/Page.tsx',
            },
          ],
          id: 'signed-out',
        },
      ],
      selectedOutcomeId: 'signed-out',
    });
    const metadata = {
      column: 9,
      expression: 'hasSession',
      kind: 'early-return',
      line: 12,
      sourcePath: '/workspace/Page.tsx',
    };

    expect(harness.resolveCondition('session-gate', false, metadata)).toBe(false);
    harness.setCondition('session-gate', true);

    expect(harness.resolveCondition('session-gate', false, metadata)).toBe(false);
    expect(harness.readConditionOverrides()).toEqual({});
  });

  /** Maps static switch case/default arms and reconciles a conflicting exact manual selection. */
  it('selects safe switch cases and defaults from one return scenario', () => {
    const branches = [
      { id: 'case-summary', label: 'case summary', selectable: true, value: 'summary' },
      { id: 'case-detail', label: 'case detail', selectable: true, value: 'detail' },
      { default: true, id: 'case-default', label: 'default', selectable: true },
    ];
    const choiceMetadata = {
      branches,
      column: 5,
      expression: 'viewMode',
      kind: 'switch',
      line: 41,
      sourcePath: '/workspace/Page.tsx',
    };
    const caseHarness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [
            {
              branch: 'case',
              column: 5,
              expression: 'viewMode',
              line: 41,
              sourcePath: '/workspace/Page.tsx',
              value: 'detail',
            },
          ],
          id: 'detail-view',
        },
      ],
      selectedOutcomeId: 'detail-view',
    });

    expect(caseHarness.resolveChoice('view-choice', 'summary', choiceMetadata)).toBe('detail');
    expect(caseHarness.setChoice('view-choice', 'case-summary')).toBe(true);
    expect(caseHarness.resolveChoice('view-choice', 'detail', choiceMetadata)).toBe('detail');
    expect(caseHarness.readChoiceOverrides()).toEqual({});

    const defaultHarness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [
            {
              branch: 'default',
              column: 5,
              expression: 'viewMode',
              line: 41,
              sourcePath: '/workspace/Page.tsx',
            },
          ],
          id: 'default-view',
        },
      ],
      selectedOutcomeId: 'default-view',
    });

    expect(typeof defaultHarness.resolveChoice('view-choice', 'summary', choiceMetadata)).toBe(
      'symbol',
    );
  });

  /**
   * A whole-return selection owns its exact branch conjunction, while source-unrelated debugger
   * edits remain durable for the component/file where the user created them.
   */
  it('clears only source-matched persisted boolean and switch overrides when selecting an outcome', () => {
    const branches = [
      { id: 'case-summary', label: 'case summary', selectable: true, value: 'summary' },
      { id: 'case-detail', label: 'case detail', selectable: true, value: 'detail' },
    ];
    const matchingCondition = {
      column: 9,
      expression: 'hasSession',
      kind: 'early-return',
      line: 12,
      sourcePath: '/workspace/Page.tsx',
    };
    const matchingChoice = {
      branches,
      column: 5,
      expression: 'viewMode',
      kind: 'switch',
      line: 41,
      sourcePath: '/workspace/Page.tsx',
    };
    const unrelatedCondition = {
      ...matchingCondition,
      sourcePath: '/workspace/OtherPage.tsx',
    };
    const unrelatedChoice = {
      ...matchingChoice,
      sourcePath: '/workspace/OtherPage.tsx',
    };
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [
            { ...matchingCondition, branch: 'falsy' },
            { ...matchingChoice, branch: 'case', value: 'detail' },
          ],
          id: 'signed-out-detail',
        },
        { conditions: [], id: 'other-outcome' },
      ],
      persistedState: {
        renderChoiceOverrides: {
          'other-choice': 'case-detail',
          'view-choice': 'case-summary',
        },
        renderConditionOverrides: {
          'other-gate': false,
          'session-gate': true,
        },
      },
    });

    // Evaluation registers the source metadata that makes exact cleanup possible.
    expect(harness.resolveCondition('session-gate', false, matchingCondition)).toBe(true);
    expect(harness.resolveCondition('other-gate', true, unrelatedCondition)).toBe(false);
    expect(harness.resolveChoice('view-choice', 'detail', matchingChoice)).toBe('summary');
    expect(harness.resolveChoice('other-choice', 'summary', unrelatedChoice)).toBe('detail');

    expect(harness.selectOutcome('signed-out-detail')).toBe(true);
    expect(harness.observations).toEqual({ commits: 1, notifications: 1, persists: 1 });
    expect(harness.readConditionOverrides()).toEqual({ 'other-gate': false });
    expect(harness.readChoiceOverrides()).toEqual({ 'other-choice': 'case-detail' });
    expect(harness.resolveCondition('session-gate', true, matchingCondition)).toBe(false);
    expect(harness.resolveCondition('other-gate', true, unrelatedCondition)).toBe(false);
    expect(harness.resolveChoice('view-choice', 'summary', matchingChoice)).toBe('detail');
    expect(harness.resolveChoice('other-choice', 'summary', unrelatedChoice)).toBe('detail');

    // Selecting the already active complete outcome neither revisits overrides nor remounts.
    expect(harness.selectOutcome('signed-out-detail')).toBe(false);
    expect(harness.observations).toEqual({ commits: 1, notifications: 1, persists: 1 });
  });

  /** Commits each effective select/clear operation once and makes repeated actions inert. */
  it('persists, notifies, and schedules one remount commit per scenario change', () => {
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        { conditions: [], id: 'content' },
        { conditions: [], id: 'empty' },
      ],
    });

    expect(harness.selectOutcome('content')).toBe(true);
    expect(harness.readSelection()).toBe('content');
    expect(harness.observations).toEqual({ commits: 1, notifications: 1, persists: 1 });
    expect(harness.selectOutcome('content')).toBe(false);
    expect(harness.observations).toEqual({ commits: 1, notifications: 1, persists: 1 });

    expect(harness.clearOutcome()).toBe(true);
    expect(harness.readSelection()).toBeUndefined();
    expect(harness.observations).toEqual({ commits: 2, notifications: 2, persists: 2 });
    expect(harness.clearOutcome()).toBe(false);
    expect(harness.observations).toEqual({ commits: 2, notifications: 2, persists: 2 });
  });

  /** A single unconditional return is authored truth, not a scenario requiring confirmation. */
  it('treats one unconditional outcome as selected without persistence or a remount', () => {
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [{ conditions: [], id: 'only-authored-return', label: 'Content' }],
    });

    expect(harness.readSelection()).toBe('only-authored-return');
    expect(harness.readOutcome()).toMatchObject({
      id: 'only-authored-return',
      label: 'Content',
    });
    expect(harness.observations).toEqual({ commits: 0, notifications: 0, persists: 0 });
    expect(harness.selectOutcome('only-authored-return')).toBe(false);
    expect(harness.clearOutcome()).toBe(false);
    expect(harness.observations).toEqual({ commits: 0, notifications: 0, persists: 0 });
  });

  /** Keeps current-file choices available while the page renderer selects an ancestor/root export. */
  it('falls back to the descriptor target outcome plan for an ancestor selection', () => {
    const harness = createRenderOutcomeRuntimeHarness({
      exportName: 'CurrentFile',
      outcomes: [
        { conditions: [], id: 'content' },
        { conditions: [], id: 'empty' },
      ],
      selectedExportName: '@root:/workspace/App.tsx:App',
      selectedOutcomeId: 'content',
    });

    expect(harness.readOutcomes()).toHaveLength(2);
    expect(harness.readSelection()).toBe('content');
    expect(harness.readOutcome()).toMatchObject({ id: 'content' });
  });

  /** Removes a persisted exact override when its previously inactive branch first registers. */
  it('reconciles unregistered persisted overrides after outcome restoration', async () => {
    const metadata = {
      column: 9,
      expression: 'hasSession',
      kind: 'early-return',
      line: 12,
      sourcePath: '/workspace/Page.tsx',
    };
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes: [
        {
          conditions: [{ ...metadata, branch: 'falsy' }],
          id: 'signed-out',
        },
      ],
      persistedState: { renderConditionOverrides: { 'session-gate': true } },
      selectedOutcomeId: 'signed-out',
    });

    expect(harness.resolveCondition('session-gate', true, metadata)).toBe(false);
    expect(harness.readConditionOverrides()).toEqual({});
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.observations).toEqual({ commits: 0, notifications: 0, persists: 1 });
  });

  /** Enforces the static scenario cap and treats a source-edited persisted identity as stale. */
  it('bounds outcomes and rejects stale or out-of-bound identities', () => {
    const outcomes = Array.from({ length: 34 }, (_, index) => ({
      conditions: [],
      id: `outcome-${String(index)}`,
    }));
    const harness = createRenderOutcomeRuntimeHarness({
      outcomes,
      selectedOutcomeId: 'outcome-32',
    });

    expect(harness.readOutcomes()).toHaveLength(32);
    expect(harness.readOutcome()).toBeUndefined();
    expect(harness.selectOutcome('outcome-32')).toBe(false);
    expect(harness.selectOutcome('deleted-by-hot-edit')).toBe(false);
    expect(harness.observations).toEqual({ commits: 0, notifications: 0, persists: 0 });
  });
});

/**
 * Evaluates outcome and condition sources against a descriptor-shaped, host-inert browser fixture.
 *
 * The commit counter represents the Page Inspector's coalesced page remount scheduler. Source-path
 * helpers mirror the production UI helpers because the outcome adapter deliberately shares their
 * exact absolute/relative matching policy without importing a second implementation.
 */
function createRenderOutcomeRuntimeHarness(
  options: RenderOutcomeFixtureOptions,
): RenderOutcomeRuntimeHarness {
  const exportName = options.exportName ?? 'default';
  const descriptor = {
    exportName,
    inspector: {
      renderOutcomesByExport: {
        [exportName]: { exportName, outcomes: options.outcomes },
      },
      target: { exportName },
    },
  };
  const initialSession = {
    descriptors: [descriptor],
    devtoolsState:
      options.selectedOutcomeId === undefined
        ? {}
        : { renderOutcomeSelectionByExport: { [exportName]: options.selectedOutcomeId } },
    selectedExportName: options.selectedExportName ?? exportName,
  };
  const observations: RenderOutcomeRuntimeObservations = {
    commits: 0,
    notifications: 0,
    persists: 0,
  };
  const context: {
    __renderOutcomeRuntime?: RenderOutcomeRuntimeHarness;
    descriptor: Record<string, unknown>;
    initialSession: Record<string, unknown>;
    observations: RenderOutcomeRuntimeObservations;
    persistedState: Record<string, unknown>;
  } = { descriptor, initialSession, observations, persistedState: options.persistedState ?? {} };

  vm.runInNewContext(
    `
      const previewInspectorSession = { ...initialSession };
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readPersistedPreviewInspectorState = () => persistedState;
      const persistPreviewInspectorState = () => { observations.persists += 1; };
      const notifyPreviewInspector = () => { observations.notifications += 1; };
      const schedulePreviewInspectorCommitRefresh = () => { observations.commits += 1; };
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const recordPreviewInspectorBlockerAutoDecision = () => undefined;
      const normalizePreviewInspectorConditionSourcePath = (value) =>
        typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
      const matchesPreviewInspectorConditionSourcePath = (left, right) => {
        if (left === right) return true;
        const leftAbsolute = left.startsWith('/') || /^[A-Za-z]:\\//u.test(left);
        const rightAbsolute = right.startsWith('/') || /^[A-Za-z]:\\//u.test(right);
        if (leftAbsolute === rightAbsolute) return false;
        const absolute = leftAbsolute ? left : right;
        const relative = leftAbsolute ? right : left;
        return relative.length > 0 && absolute.endsWith('/' + relative.replace(/^\\.\\//u, ''));
      };
      ${createPreviewInspectorRenderOutcomeRuntimeSource()}
      ${createPreviewInspectorConditionRuntimeSource()}
      globalThis.__renderOutcomeRuntime = {
        clearOutcome: clearPreviewInspectorRenderOutcome,
        observations,
        readChoiceOverrides: () => serializePreviewInspectorRenderChoiceOverrides(),
        readConditionOverrides: () => serializePreviewInspectorRenderConditionOverrides(),
        readOutcome: readPreviewInspectorSelectedRenderOutcome,
        readOutcomes: readPreviewInspectorStaticRenderOutcomes,
        readSelection: readPreviewInspectorSelectedRenderOutcomeId,
        resolveChoice: resolvePreviewInspectorRenderChoice,
        resolveCondition: resolvePreviewInspectorRenderCondition,
        selectOutcome: selectPreviewInspectorRenderOutcome,
        session: previewInspectorSession,
        setChoice: setPreviewInspectorRenderChoiceOverride,
        setCondition: setPreviewInspectorRenderConditionOverride,
      };
    `,
    context,
  );
  if (context.__renderOutcomeRuntime === undefined) {
    throw new Error('Render outcome runtime fixture did not initialize.');
  }
  return context.__renderOutcomeRuntime;
}
