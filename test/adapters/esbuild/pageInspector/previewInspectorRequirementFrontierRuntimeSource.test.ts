/** Exercises target-local requirement admission without mounting project React components. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRequirementFrontierRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRequirementFrontierRuntimeSource';

describe('Preview Inspector requirement frontier runtime source', () => {
  /**
   * Re-admits a Smart hook exactly when its compiler-required shape has expanded. A settled Smart
   * hook stays excluded, which prevents explicit Retry from reapplying the same value forever.
   */
  it('selects stale Smart paths once while excluding signatures already covered', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          runtimeFallbackSmartPathSignatures: new Map([
            ['stale', JSON.stringify(['data'])],
            ['settled', JSON.stringify(['data', 'loading'])],
          ]),
        };
        const records = [
          {
            id: 'stale', mode: 'smart', reachabilityKey: 'page:Target',
            requiredPaths: ['data', 'loading'],
          },
          {
            id: 'settled', mode: 'smart', reachabilityKey: 'page:Target',
            requiredPaths: ['loading', 'data'],
          },
          {
            id: 'opaque', mode: 'auto', reachabilityKey: 'page:Target',
            requiredPaths: ['<root>'],
          },
        ];
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) =>
          JSON.stringify([...new Set(paths)].sort());
        const readPreviewInspectorTargetPathEvidence = () => ({ nameScores: new Map(), paths: [] });
        const readPreviewInspectorRuntimeFallbacks = () => records;
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, false,
        );
      `,
      context,
    );

    expect(context.__result).toEqual({ hookIds: ['stale'], requestIds: [] });
  });

  /** Protects an explicit user value during background inference even if its Smart shape is stale. */
  it('does not revise a stale Smart manual value during deterministic search', () => {
    const context: { __result?: unknown } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = { runtimeFallbackSmartPathSignatures: new Map() };
        const normalizePreviewInspectorReachabilityPath = (value) => String(value ?? '');
        const createPreviewInspectorRuntimeFallbackPathSignature = (paths) =>
          JSON.stringify([...new Set(paths)].sort());
        const readPreviewInspectorTargetPathEvidence = () => ({ nameScores: new Map(), paths: [] });
        const readPreviewInspectorRuntimeFallbacks = () => [{
          id: 'manual', mode: 'smart-manual', reachabilityKey: 'page:Target',
          requiredPaths: ['data'],
        }];
        const readPreviewInspectorDataRequests = () => [];
        const readPreviewInspectorDataShapePaths = () => [];
        ${createPreviewInspectorRequirementFrontierRuntimeSource()}
        globalThis.__result = readPreviewInspectorRequirementBatch(
          {}, {}, { key: 'page:Target' }, true,
        );
      `,
      context,
    );

    expect(context.__result).toEqual({ hookIds: [], requestIds: [] });
  });
});
