/** Covers diagnostics behavior for previewInspectorBundleFrontier. */
/** Verifies authored-source previewInspectorBundleFrontier invariants. */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPreviewCompilerFrontierPolicy } from '../../../../src/domain/previewCompilerFrontier';

import { preparePreviewInspectorBundleFrontier } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';

import { createPreviewInspectorBundleDiagnosticsCollector } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleDiagnostics';

import type { PreviewInspectorAncestorPlan } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorPlan';

describe('preparePreviewInspectorBundleFrontier', () => {
  it('keeps frontier identity and membership stable across repeated equivalent source reads', async () => {
    const workspaceRoot = '/workspace';
    const targetPath = '/workspace/Target.tsx';
    const helperPath = '/workspace/helper.ts';
    const sources = new Map<string, string>([
      [targetPath, "import { helper } from './helper'; export const Target = helper;"],
      [helperPath, 'export const helper = null;'],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [
        { dependencyPaths: [], edges: [], root: { exportName: 'Target', sourcePath: targetPath } },
      ],
      root: { exportName: 'Target', sourcePath: targetPath },
      target: { exportName: 'Target', sourcePath: targetPath },
    } as unknown as PreviewInspectorAncestorPlan;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        preparePreviewInspectorBundleFrontier({
          plan,
          policy,
          readSource: (sourcePath) => Promise.resolve(sources.get(sourcePath)),
          resolveModule: (specifier, importer) =>
            specifier === './helper'
              ? path.resolve(path.dirname(importer), 'helper.ts')
              : undefined,
          workspaceRoot,
        }),
      ),
    );
    const first = results[0];
    if (first === undefined) throw new Error('Expected one frontier result.');
    for (const result of results.slice(1)) {
      expect(result.frontier.identity).toBe(first.frontier.identity);
      expect(result.frontier.authenticSourcePaths).toEqual(first.frontier.authenticSourcePaths);
      expect(result.frontier.projectedEdges).toEqual(first.frontier.projectedEdges);
      expect(result.frontier.summary).toEqual(first.frontier.summary);
    }
    expect(Object.isFrozen(first.frontier.authenticSourcePaths)).toBe(true);
    expect(Object.isFrozen(first.frontier.summary)).toBe(true);
  });

  it('preserves interleaved queue traces, serialization, and diagnostics with an observer', async () => {
    const workspaceRoot = '/workspace';
    const exactA = '/workspace/ExactA.tsx';
    const exactB = '/workspace/ExactB.tsx';
    const shared = '/workspace/Shared.ts';
    const supportA = '/workspace/SupportA.ts';
    const optionalA = '/workspace/OptionalA.tsx';
    const optionalASupport = '/workspace/OptionalASupport.ts';
    const optionalB = '/workspace/OptionalB.tsx';
    const optionalBSupport = '/workspace/OptionalBSupport.ts';
    const optionalBroken = '/workspace/OptionalBroken.tsx';
    const optionalZ = '/workspace/OptionalZ.ts';
    const sources = new Map<string, string>([
      [
        exactA,
        [
          "import { shared as first } from './Shared';",
          "import { shared as second } from './Shared';",
          "import { support } from './SupportA';",
          'export const ExactA = first ?? second ?? support;',
        ].join('\n'),
      ],
      [exactB, "import { shared } from './Shared'; export const ExactB = shared;"],
      [shared, 'export const shared = true;'],
      [supportA, "import 'generic-package'; export const support = true;"],
      [
        optionalA,
        [
          "import { value as z } from './OptionalZ';",
          "import { value as a } from './OptionalASupport';",
          "import { value as zAgain } from './OptionalZ';",
          'export default function OptionalA() { return z ?? a ?? zAgain; }',
        ].join('\n'),
      ],
      [optionalASupport, 'export const value = "a";'],
      [
        optionalB,
        "import { value } from './OptionalBSupport'; export default function OptionalB() { return value; }",
      ],
      [optionalBSupport, 'export const value = "b";'],
      [optionalZ, 'export const value = "z";'],
    ]);
    const resolutions = new Map<string, string>([
      [`${exactA}\0./Shared`, shared],
      [`${exactA}\0./SupportA`, supportA],
      [`${exactB}\0./Shared`, shared],
      [`${optionalA}\0./OptionalZ`, optionalZ],
      [`${optionalA}\0./OptionalASupport`, optionalASupport],
      [`${optionalB}\0./OptionalBSupport`, optionalBSupport],
    ]);
    const plan = {
      edges: [],
      pageCandidates: [],
      root: { exportName: 'ExactA', sourcePath: exactA },
      target: { exportName: 'ExactA', sourcePath: exactA },
    } as unknown as PreviewInspectorAncestorPlan;
    const executionCandidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'ExactA',
          id: 'exact-a',
          omittedTopLevelEffectCount: 0,
          sourcePath: exactA,
          strategy: 'authentic-module-export',
          watchSourcePaths: [exactA],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'ExactB',
          id: 'exact-b',
          omittedTopLevelEffectCount: 0,
          sourcePath: exactB,
          strategy: 'authentic-module-export',
          watchSourcePaths: [exactB],
        },
      ],
      evidenceSourcePaths: [],
      fidelity: 'page-sliced',
      id: 'stable-queue-candidate',
      optionalSurfaces: [optionalB, optionalBroken, optionalA].map((sourcePath, index) => ({
        bypassedWrapperNames: [],
        exportName: 'default',
        id: `optional-${index.toString()}`,
        omittedTopLevelEffectCount: 0,
        sourcePath,
        strategy: 'selected-route-surface',
        watchSourcePaths: [sourcePath],
      })),
      watchSourcePaths: [exactA, exactB, optionalA, optionalB, optionalBroken],
    } as never;
    const policy = createPreviewCompilerFrontierPolicy('fast');
    if (policy === undefined) throw new Error('Expected the automatic fast frontier policy.');
    const prepare = (
      bundleDiagnostics?: ReturnType<typeof createPreviewInspectorBundleDiagnosticsCollector>,
    ): {
      readonly resolverCalls: string[];
      readonly result: ReturnType<typeof preparePreviewInspectorBundleFrontier>;
      readonly sourceReads: string[];
    } => {
      const sourceReads: string[] = [];
      const resolverCalls: string[] = [];
      const result = preparePreviewInspectorBundleFrontier({
        ...(bundleDiagnostics === undefined ? {} : { bundleDiagnostics }),
        executionCandidate,
        plan,
        policy,
        readSource: (sourcePath) => {
          sourceReads.push(sourcePath);
          return Promise.resolve(sources.get(sourcePath));
        },
        resolveModule: (specifier, importer) => {
          resolverCalls.push(`${importer}\0${specifier}`);
          return resolutions.get(`${importer}\0${specifier}`);
        },
        runtimeCompanionSourcePaths: [exactA],
        workspaceRoot,
      });
      return { resolverCalls, result, sourceReads };
    };

    const withoutDiagnostics = prepare();
    let clockMicros = 0n;
    const diagnostics = createPreviewInspectorBundleDiagnosticsCollector(true, () => {
      const now = clockMicros;
      clockMicros += 1_000n;
      return now;
    });
    if (diagnostics === undefined) throw new Error('Expected bundle diagnostics.');
    const withDiagnostics = prepare(diagnostics);
    const [baseline, observed] = await Promise.all([
      withoutDiagnostics.result,
      withDiagnostics.result,
    ]);

    expect(withDiagnostics.sourceReads).toEqual(withoutDiagnostics.sourceReads);
    expect(withDiagnostics.resolverCalls).toEqual(withoutDiagnostics.resolverCalls);
    expect(withoutDiagnostics.sourceReads).toEqual([
      exactA,
      exactB,
      shared,
      supportA,
      optionalA,
      optionalASupport,
      optionalZ,
      optionalB,
      optionalBSupport,
      optionalBroken,
    ]);
    expect(withoutDiagnostics.resolverCalls).toEqual([
      `${exactA}\0./Shared`,
      `${exactA}\0./Shared`,
      `${exactA}\0./SupportA`,
      `${exactB}\0./Shared`,
      `${supportA}\0generic-package`,
      `${optionalA}\0./OptionalZ`,
      `${optionalA}\0./OptionalASupport`,
      `${optionalA}\0./OptionalZ`,
      `${optionalB}\0./OptionalBSupport`,
    ]);
    expect(JSON.stringify(observed)).toBe(JSON.stringify(baseline));
    expect(baseline.frontier.identity).toBe(
      'b4377a6e1c2907af5b99a45b19a054aca6b518601c83bb7982aab12154a67be3',
    );
    expect(baseline.frontier.authenticSourcePaths).toEqual([
      exactA,
      exactB,
      optionalA,
      optionalASupport,
      optionalB,
      optionalBSupport,
      optionalZ,
      shared,
      supportA,
    ]);
    expect(baseline.frontier.exactSourcePaths).toEqual([exactA, exactB]);
    expect(baseline.frontier.packageDemandSourcePaths).toEqual([supportA]);
    expect(baseline.frontier.authenticComponentExports).toEqual([
      {
        exportNames: ['default'],
        runtimeHookExportNames: [],
        sourcePath: optionalA,
      },
      {
        exportNames: ['default'],
        runtimeHookExportNames: [],
        sourcePath: optionalB,
      },
    ]);
    expect(baseline.frontier.projectedEdges).toEqual([
      {
        exportNames: ['default'],
        importerPath: optionalBroken,
        moduleSpecifier: optionalBroken,
        occurrenceStart: 0,
        reason: 'exact-source-unreadable',
        runtimeHookExportNames: [],
        targetPath: optionalBroken,
      },
    ]);
    expect(baseline.frontier.sourceKinds).toEqual({
      [exactA]: 'critical-surface',
      [exactB]: 'critical-surface',
      [shared]: 'critical-support',
      [supportA]: 'critical-support',
      [optionalA]: 'optional-surface',
      [optionalASupport]: 'optional-support',
      [optionalZ]: 'optional-support',
      [optionalB]: 'optional-surface',
      [optionalBSupport]: 'optional-support',
    });
    expect(baseline.frontier.summary).toEqual({
      authoredEdgeCount: 8,
      exactModuleCount: 2,
      maximumDepth: 1,
      optionalComponentCount: 2,
      packageDemandSourceCount: 1,
      projectedEdgeCount: 1,
      sourceBytes: 695,
      supportModuleCount: 5,
      totalAuthoredModuleCount: 9,
      truncationReasons: [],
    });
    const nonDurationDiagnostics = Object.fromEntries(
      Object.entries(diagnostics.snapshot()).filter(([name]) => !name.endsWith('Micros')),
    );
    expect(nonDurationDiagnostics).toEqual({
      authoredPathCheckCount: 14,
      candidateSelectionSortCount: 0,
      diagnosticsVersion: 1,
      edgeVisitCount: 13,
      frontierCount: 1,
      inventoryComputationCount: 9,
      inventoryHitCount: 0,
      inventoryReadPathCacheHitCount: 0,
      inventoryReadRequestCount: 10,
      inventoryRequestCount: 9,
      optionalClosureProbeCount: 3,
      queueIterationCount: 17,
      queuePeakLength: 8,
      queueSortCount: 17,
      rawSourceReadCount: 10,
      resolveModuleCount: 9,
      sliceComputationCount: 0,
      sliceHitCount: 0,
      sliceRequestCount: 0,
    });
    expect(diagnostics.snapshot().queueSortCount).toBe(diagnostics.snapshot().queueIterationCount);
  });
});
