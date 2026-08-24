/** Verifies browser materialization of data-only inferred prop shapes without project execution. */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewAutomaticPropsRuntimeSource } from '../../../src/adapters/esbuild/previewAutomaticPropsRuntimeSource';

describe('createPreviewAutomaticPropsRuntimeSource', () => {
  /** Creates nested neutral values and lets real partial values win at the deepest supplied path. */
  it('materializes and overlays bounded automatic props', () => {
    const context: { result?: Record<string, unknown> } = {};
    const shape = {
      kind: 'object',
      properties: {
        field: {
          kind: 'object',
          properties: {
            value: {
              kind: 'object',
              properties: { addressInput: { kind: 'object', properties: {} } },
            },
          },
        },
        helpers: {
          kind: 'object',
          properties: { setValue: { kind: 'function' } },
        },
      },
    };
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        `const value = createPreviewPropsFromLayers(${JSON.stringify(shape)}, { field: { value: { name: 'office' } } });`,
        'globalThis.result = {',
        '  addressInput: value.field.value.addressInput,',
        '  helperResult: value.helpers.setValue(),',
        '  name: value.field.value.name,',
        '};',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ addressInput: {}, helperResult: undefined, name: 'office' });
  });

  /** Rejects prototype keys and lets authored null remain an intentional semantic value. */
  it('bounds unsafe shapes and preserves explicit null', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { safe: { kind: 'string' }, constructor: { kind: 'object' } } };",
        'const value = createPreviewPropsFromLayers(shape, { safe: null });',
        'globalThis.result = { keys: Object.keys(value), safe: value.safe };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ keys: ['safe'], safe: null });
  });

  /** Does not execute an authored accessor while overlaying otherwise plain setup props. */
  it('ignores accessor properties instead of evaluating project getters', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { value: { kind: 'string' } } };",
        'let getterCalls = 0;',
        'const authored = {};',
        "Object.defineProperty(authored, 'value', { enumerable: true, get() { getterCalls += 1; return 'effect'; } });",
        'const value = createPreviewPropsFromLayers(shape, authored);',
        'globalThis.result = { getterCalls, value: value.value };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ getterCalls: 0, value: '' });
  });

  /**
   * Keeps a locally proven Array prop when an ancestor's generated payload supplied a neutral `{}`.
   */
  it('repairs a neutral parent placeholder with the inferred component prop kind', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { data: { kind: 'array' } } };",
        'const automatic = createPreviewPropsFromLayers(shape, { data: {} });',
        'const overridden = createPreviewPropsFromLayers(shape, { data: {} }, { data: { manual: true } });',
        'globalThis.result = {',
        '  automaticIsArray: Array.isArray(automatic.data),',
        '  mappedLength: automatic.data.map(String).length,',
        '  manual: overridden.data.manual,',
        '};',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({
      automaticIsArray: true,
      manual: true,
      mappedLength: 0,
    });
  });

  /** Materializes three independent samples only when inference provided an element contract. */
  it('keeps unknown arrays empty and creates a configurable structured sample list', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { unknown: { kind: 'array' }, pills: { kind: 'array', items: { kind: 'object', properties: { id: { kind: 'string', value: 'preview-id' }, label: { kind: 'string', value: 'label' } } } } } };",
        'const value = createPreviewPropsFromLayers(shape);',
        'setPreviewGeneratedListSampleCount(5);',
        'const resized = createPreviewPropsFromLayers(shape);',
        'value.pills.sort((left, right) => right.id.localeCompare(left.id));',
        'globalThis.result = { mutable: !Object.isFrozen(value.pills), unknownLength: value.unknown.length, pills: value.pills, resizedLength: resized.pills.length };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({
      mutable: true,
      unknownLength: 0,
      pills: [
        { id: 'preview-id-3', label: 'label 3' },
        { id: 'preview-id-2', label: 'label 2' },
        { id: 'preview-id', label: 'label' },
      ],
      resizedLength: 5,
    });
  });

  /** Keeps a typed scalar collection iterable and non-empty for direct array destructuring. */
  it('materializes samples for a consumed scalar array contract', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { documentIds: { kind: 'array', items: { kind: 'number' } } } };",
        'const value = createPreviewPropsFromLayers(shape);',
        'const [firstDocumentId] = value.documentIds;',
        'globalThis.result = { firstDocumentId, isArray: Array.isArray(value.documentIds), length: value.documentIds.length };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ firstDocumentId: 0, isArray: true, length: 3 });
  });

  /** Keeps primitive string selections visible and uniquely keyed without changing exact enums. */
  it('labels generated primitive string rows from their public collection name', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { projects: { kind: 'array', items: { kind: 'string' } }, statuses: { kind: 'array', items: { exactValue: true, kind: 'string', value: 'READY' } } } };",
        'const value = createPreviewPropsFromLayers(shape);',
        'globalThis.result = { projects: value.projects, statuses: value.statuses };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({
      projects: ['project', 'project 2', 'project 3'],
      statuses: ['READY', 'READY', 'READY'],
    });
  });

  /** Keeps an already materialized list when later prop layers start without another shape. */
  it('preserves generated list props through the final resolver and override merge', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { rows: { kind: 'array', items: { kind: 'object', properties: { id: { kind: 'string', value: 'row' } } } } } };",
        'const automatic = createPreviewTargetPropsFromLayers(shape, {});',
        'const effective = createPreviewPropsFromLayers(undefined, automatic, {}, {});',
        'globalThis.result = { ids: effective.rows.map((row) => row.id), length: effective.rows.length };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({ ids: ['row', 'row-2', 'row-3'], length: 3 });
  });

  /** Varies display identities without corrupting the GraphQL union discriminator. */
  it('keeps generated GraphQL typenames stable across repeated samples', () => {
    const context: { result?: unknown } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "globalThis.result = createPreviewGeneratedList(() => ({ __typename: 'ClosingFeed', id: 'preview-id', name: 'Company' }));",
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual([
      { __typename: 'ClosingFeed', id: 'preview-id', name: 'Company' },
      { __typename: 'ClosingFeed', id: 'preview-id-2', name: 'Company 2' },
      { __typename: 'ClosingFeed', id: 'preview-id-3', name: 'Company 3' },
    ]);
  });

  /** Completes compiler-generated parent rows with fields proven by the selected child target. */
  it('repairs nested generated array items without rewriting an authored list', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { project: { kind: 'object', properties: { issues: { kind: 'array', items: { kind: 'object', properties: { status: { exactValue: true, kind: 'string', value: 'backlog' }, title: { kind: 'string', value: 'title' }, userIds: { kind: 'array' } } } } } } } };",
        "const generatedParent = { project: { issues: [{ createdAt: '2024-01-01', status: 'PREVIEW', title: 'upstream title' }] } };",
        'markPreviewAutomaticGeneratedValue(generatedParent);',
        'const repaired = createPreviewTargetPropsFromLayers(shape, generatedParent);',
        "const authoredParent = { project: { issues: [{ createdAt: 'authored', status: 'custom' }] } };",
        'const authored = createPreviewTargetPropsFromLayers(shape, authoredParent);',
        'globalThis.result = {',
        '  authoredIssue: authored.project.issues[0],',
        '  repairedIssue: repaired.project.issues[0],',
        '};',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({
      authoredIssue: { createdAt: 'authored', status: 'custom' },
      repairedIssue: {
        createdAt: '2024-01-01',
        status: 'backlog',
        title: 'upstream title',
        userIds: [],
      },
    });
  });

  /**
   * Repairs a dormant parent's null only at the exact selected target whose local guard is forced.
   */
  it('materializes a coherent selected-target prop while preserving ordinary explicit null', () => {
    const context: { result?: Record<string, unknown> } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        "const shape = { kind: 'object', properties: { file: { kind: 'object', properties: { documentId: { kind: 'string', value: 'documentId' } } } } };",
        'const ordinary = createPreviewPropsFromLayers(shape, { file: null });',
        'const selected = createPreviewTargetPropsFromLayers(shape, { file: null });',
        'const overridden = createPreviewTargetPropsFromLayers(shape, { file: null }, { file: null });',
        'globalThis.result = {',
        '  ordinary: ordinary.file,',
        '  selectedDocumentId: selected.file.documentId,',
        '  overridden: overridden.file,',
        '};',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({
      ordinary: null,
      overridden: null,
      selectedDocumentId: 'documentId',
    });
  });

  /** Uses the data neural head to cover every compiler-proven table row discriminator. */
  it('fills rendered collection props with visible branch-diverse rows', () => {
    const context: { result?: Record<string, unknown>; selection?: unknown } = {};
    runInNewContext(
      [
        createPreviewAutomaticPropsRuntimeSource(),
        'function selectPreviewInspectorNeuralResidualCandidate(specification, candidates) {',
        '  globalThis.selection = { specification, candidates };',
        "  return { candidateId: 'branch-coverage', decision: { candidateId: 'branch-coverage' } };",
        '}',
        "const shape = { kind: 'object', properties: { events: { kind: 'array', renderedCollection: true, items: { kind: 'object', properties: { date: { kind: 'string' }, eventType: { kind: 'string', candidateValues: ['appointed', 'ended', 'co-ceo'], exactValue: true, value: 'appointed' } } } } } };",
        'setPreviewGeneratedListSampleCount(2);',
        'const value = createPreviewPropsFromLayers(shape);',
        'globalThis.result = { dates: value.events.map((row) => row.date), eventTypes: value.events.map((row) => row.eventType), length: value.events.length };',
      ].join('\n'),
      context,
    );

    expect(context.result).toEqual({
      dates: [
        '2026-01-15T09:00:00.000Z',
        '2026-01-16T09:00:00.000Z',
        '2026-01-17T09:00:00.000Z',
      ],
      eventTypes: ['appointed', 'ended', 'co-ceo'],
      length: 3,
    });
    expect(context.selection).toMatchObject({
      specification: {
        blockerKind: 'automatic-props',
        holeKind: 'rendered-collection-prop-data',
        numbers: { configuredRowCount: 2, variantCount: 3 },
      },
    });
  });
});
