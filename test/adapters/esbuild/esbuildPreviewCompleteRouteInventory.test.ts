import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewInspectorBundleSourceInventoryMemo } from '../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontier';
import type { PreviewStaticModuleResolutionMemo } from '../../../src/adapters/esbuild/previewStaticModuleResolver';
import type { PreviewResolutionConfinementPathMemo } from '../../../src/adapters/esbuild/previewResolutionConfinement';
import type { PreviewCompleteRouteUsageContext } from '../../../src/adapters/esbuild/preparePreviewCompilerUsage';
import {
  PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY,
  type PreviewCompleteRouteInventoryTelemetryEvent,
} from '../../../src/adapters/esbuild/inspector/previewInspectorCompleteRouteInventory';
import { PreviewRouteExecutionPlanInvariantError } from '../../../src/domain/preview';
import type { PreviewCompilerBundleFrontierActivity } from '../../../src/domain/previewCompilerActivity';
import {
  PreviewBuildStalledError,
  type PreviewBuildExecutionContext,
} from '../../../src/domain/previewBuildExecution';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
describe('EsbuildPreviewCompiler complete route replay', () => {
  it('replays generic nested wildcard alternates through the compiler-owned API', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/complete-route-replay-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'App.tsx');
    const nestedPath = path.join(sourceDirectory, 'Nested.tsx');
    const leafPath = path.join(sourceDirectory, 'Leaf.tsx');
    const setupPath = path.join(sourceDirectory, 'preview.setup.ts');
    const globalStylePath = path.join(sourceDirectory, 'GlobalStyle.tsx');
    const routerDirectory = path.join(projectRoot, 'node_modules/react-router-dom');
    const styledComponentsDirectory = path.join(projectRoot, 'node_modules/styled-components');
    const sourceText = `
      import { Route, Routes } from 'react-router-dom';
      import { GlobalStyle } from './GlobalStyle';
      import Nested from './Nested';
      export default function App() {
        return <><GlobalStyle /><Routes><Route path="/parent/*" element={<Nested />} /></Routes></>;
      }
    `;
    const nestedSource = `
      import { Route, Routes } from 'react-router-dom';
      import Leaf from './Leaf';
      export default function Nested() {
        return <Routes>
          <Route index element={<Leaf />} />
          <Route path="alternate/:itemId" element={<Leaf />} />
        </Routes>;
      }
    `;
    const leafSource = 'export default function Leaf() { return <main>leaf</main>; }';
    const setupSource = 'globalThis.__previewSetupParity = true;';
    const globalStyleSource = `
      import { createGlobalStyle } from 'styled-components';
      export const GlobalStyle = createGlobalStyle\`
        body { --final-frontier-style-companion: enabled; }
      \`;
    `;
    const compiler = new EsbuildPreviewCompiler();
    const outerEquivalentCompiler = new EsbuildPreviewCompiler();
    const resolutionMemoDisabledCompiler = new EsbuildPreviewCompiler();
    const unconfinedCompiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await mkdir(routerDirectory, { recursive: true });
      await mkdir(styledComponentsDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"react-router-dom":"6.30.1","styled-components":"6.1.0"}}',
          'utf8',
        ),
        writeFile(
          path.join(sourceDirectory, 'main.tsx'),
          `
            import { createRoot } from 'react-dom/client';
            import App from './App';
            createRoot(document.body).render(<App />);
          `,
          'utf8',
        ),
        writeFile(
          path.join(routerDirectory, 'package.json'),
          '{"name":"react-router-dom","version":"6.30.1","type":"module","exports":"./index.js"}',
          'utf8',
        ),
        writeFile(
          path.join(routerDirectory, 'index.js'),
          [
            'export function MemoryRouter({ children }) { return children; }',
            'export function Route({ element }) { return element; }',
            'export function Routes({ children }) { return children; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          path.join(styledComponentsDirectory, 'package.json'),
          '{"name":"styled-components","version":"6.1.0","type":"module","exports":"./index.js"}',
          'utf8',
        ),
        writeFile(
          path.join(styledComponentsDirectory, 'index.js'),
          [
            'export function createGlobalStyle() { return function GlobalStyle() { return null; }; }',
            'export function StyleSheetManager({ children }) { return children; }',
            'export function ThemeProvider({ children }) { return children; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(nestedPath, nestedSource, 'utf8'),
        writeFile(leafPath, leafSource, 'utf8'),
        writeFile(setupPath, setupSource, 'utf8'),
        writeFile(globalStylePath, globalStyleSource, 'utf8'),
      ]);
      const request = Object.freeze({
        dependencySnapshots: Object.freeze([
          Object.freeze({
            documentPath: nestedPath,
            language: 'tsx' as const,
            sourceText: nestedSource,
          }),
          Object.freeze({
            documentPath: leafPath,
            language: 'tsx' as const,
            sourceText: leafSource,
          }),
          Object.freeze({
            documentPath: globalStylePath,
            language: 'tsx' as const,
            sourceText: globalStyleSource,
          }),
          Object.freeze({
            documentPath: setupPath,
            language: 'ts' as const,
            sourceText: setupSource,
          }),
        ]),
        documentPath,
        language: 'tsx' as const,
        renderMode: 'page-inspector' as const,
        resolutionConfinement: Object.freeze({
          approvedDependencyRoots: Object.freeze([
            path.join(projectRoot, 'node_modules'),
            path.join(REPOSITORY_ROOT, 'node_modules'),
          ]),
          dependencyViewDigest: 'a'.repeat(64),
          policyDigest: 'b'.repeat(64),
          sourceManifestDigest: 'c'.repeat(64),
          sourceRoot: projectRoot,
        }),
        setupModulePath: setupPath,
        sourceText,
        workspaceRoot: projectRoot,
      });
      const prepareExecutionPlanMethod = 'prepareCompleteRouteExecutionPlanArtifact';
      const compilerInternals = compiler as unknown as Record<string, unknown>;
      const originalPrepareExecutionPlan = compilerInternals[prepareExecutionPlanMethod];
      if (typeof originalPrepareExecutionPlan !== 'function') {
        throw new Error('Expected compiler-owned execution planner.');
      }
      const invokeOriginalPrepareExecutionPlan = originalPrepareExecutionPlan as (
        ...args: unknown[]
      ) => Promise<unknown>;
      let rejectedRequestMemo: PreviewInspectorBundleSourceInventoryMemo | undefined;
      let rejectedResolutionMemo: PreviewStaticModuleResolutionMemo | undefined;
      let rejectedPathMemo: PreviewResolutionConfinementPathMemo | undefined;
      let rejectedUsageContext: PreviewCompleteRouteUsageContext | undefined;
      let executionPlanInvocation = 0;
      compilerInternals[prepareExecutionPlanMethod] = async (...args: unknown[]) => {
        rejectedRequestMemo = args[4] as PreviewInspectorBundleSourceInventoryMemo;
        rejectedResolutionMemo = args[5] as PreviewStaticModuleResolutionMemo;
        rejectedPathMemo = args[6] as PreviewResolutionConfinementPathMemo;
        rejectedUsageContext = args[7] as PreviewCompleteRouteUsageContext;
        executionPlanInvocation += 1;
        if (executionPlanInvocation === 2) {
          throw new Error('intentional execution planner failure');
        }
        return invokeOriginalPrepareExecutionPlan.apply(compiler, args);
      };
      try {
        await expect(compiler.collectCompleteRouteInventory(request)).rejects.toThrow(
          'intentional execution planner failure',
        );
      } finally {
        compilerInternals[prepareExecutionPlanMethod] = originalPrepareExecutionPlan;
      }
      if (rejectedRequestMemo === undefined) {
        throw new Error('Expected the failed execution request to allocate its exact memo.');
      }
      expectReleasedRequestMemo(rejectedRequestMemo, false);
      if (rejectedResolutionMemo === undefined) {
        throw new Error('Expected the failed execution request to allocate its resolution memo.');
      }
      expectReleasedReusableMemo(rejectedResolutionMemo, false);
      if (rejectedPathMemo === undefined) {
        throw new Error('Expected the failed confined request to allocate its path memo.');
      }
      expectReleasedReusableMemo(rejectedPathMemo, false);
      expect(rejectedUsageContext?.getStatistics().released).toBe(true);
      const telemetry: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
      const successfulRequestMemos: PreviewInspectorBundleSourceInventoryMemo[] = [];
      const successfulPathMemos: PreviewResolutionConfinementPathMemo[] = [];
      const successfulResolutionMemos: PreviewStaticModuleResolutionMemo[] = [];
      const successfulUsageContexts: PreviewCompleteRouteUsageContext[] = [];
      let successfulExecutionPlanInvocations = 0;
      compilerInternals[prepareExecutionPlanMethod] = (...args: unknown[]) => {
        successfulExecutionPlanInvocations += 1;
        successfulRequestMemos.push(args[4] as PreviewInspectorBundleSourceInventoryMemo);
        successfulResolutionMemos.push(args[5] as PreviewStaticModuleResolutionMemo);
        successfulPathMemos.push(args[6] as PreviewResolutionConfinementPathMemo);
        successfulUsageContexts.push(args[7] as PreviewCompleteRouteUsageContext);
        return invokeOriginalPrepareExecutionPlan.apply(compiler, args);
      };
      let inventory: Awaited<ReturnType<EsbuildPreviewCompiler['collectCompleteRouteInventory']>>;
      let repeatedInventory: typeof inventory;
      try {
        inventory = await compiler.collectCompleteRouteInventory(
          request,
          undefined,
          undefined,
          telemetry.push.bind(telemetry),
        );
        const executionPlanInvocationsAfterFirstInventory = successfulExecutionPlanInvocations;
        const pathMemoInvocationsAfterFirstInventory = successfulPathMemos.length;
        repeatedInventory = await compiler.collectCompleteRouteInventory(request);
        expect(successfulExecutionPlanInvocations).toBe(
          executionPlanInvocationsAfterFirstInventory,
        );
        expect(successfulPathMemos).toHaveLength(pathMemoInvocationsAfterFirstInventory);
      } finally {
        compilerInternals[prepareExecutionPlanMethod] = originalPrepareExecutionPlan;
      }
      expect(successfulExecutionPlanInvocations).toBeGreaterThan(1);
      expect(new Set(successfulRequestMemos).size).toBe(1);
      expectReleasedRequestMemo(successfulRequestMemos[0], true);
      expect(new Set(successfulResolutionMemos).size).toBe(1);
      const successfulResolutionMemo = successfulResolutionMemos[0];
      if (successfulResolutionMemo === undefined) {
        throw new Error('Expected successful execution planning to allocate its resolution memo.');
      }
      expectReleasedReusableMemo(successfulResolutionMemo, true);
      expect(new Set(successfulPathMemos).size).toBe(1);
      const successfulPathMemo = successfulPathMemos[0];
      if (successfulPathMemo === undefined) {
        throw new Error('Expected successful confined execution planning to share its path memo.');
      }
      expectReleasedReusableMemo(successfulPathMemo, true);
      expect(new Set(successfulUsageContexts).size).toBe(1);
      const successfulUsageStatistics = successfulUsageContexts[0]?.getStatistics();
      expect(successfulUsageStatistics?.released).toBe(true);
      expect(successfulUsageStatistics?.fastContextHits).toBeGreaterThan(0);
      const outerEquivalentTelemetry: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
      const outerEquivalentTelemetryAll: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
      const outerCompilerInternals = outerEquivalentCompiler as unknown as Record<string, unknown>;
      const originalOuterPrepareExecutionPlan = outerCompilerInternals[prepareExecutionPlanMethod];
      if (typeof originalOuterPrepareExecutionPlan !== 'function') {
        throw new Error('Expected outer compiler-owned execution planner.');
      }
      const invokeOriginalOuterPrepareExecutionPlan = originalOuterPrepareExecutionPlan as (
        ...args: unknown[]
      ) => Promise<unknown>;
      outerCompilerInternals[prepareExecutionPlanMethod] = (...args: unknown[]) => {
        args[4] = undefined;
        return invokeOriginalOuterPrepareExecutionPlan.apply(outerEquivalentCompiler, args);
      };
      let outerEquivalentInventory: Awaited<
        ReturnType<EsbuildPreviewCompiler['collectCompleteRouteInventory']>
      >;
      try {
        outerEquivalentInventory = await outerEquivalentCompiler.collectCompleteRouteInventory(
          request,
          undefined,
          undefined,
          (event) => {
            outerEquivalentTelemetryAll.push(event);
            if (
              ![
                'execution-frontier-candidates',
                'execution-frontier-bundle',
                'execution-frontier-ownership',
                'execution-frontier-target-contract',
                'execution-frontier-root-contract',
                'execution-frontier-artifact',
              ].includes(event.phase)
            ) {
              outerEquivalentTelemetry.push(event);
            }
          },
        );
      } finally {
        outerCompilerInternals[prepareExecutionPlanMethod] = originalOuterPrepareExecutionPlan;
      }
      const resolutionMemoDisabledTelemetry: PreviewCompleteRouteInventoryTelemetryEvent[] = [];
      const resolutionMemoDisabledInternals = resolutionMemoDisabledCompiler as unknown as Record<
        string,
        unknown
      >;
      const originalResolutionMemoDisabledPrepareExecutionPlan =
        resolutionMemoDisabledInternals[prepareExecutionPlanMethod];
      if (typeof originalResolutionMemoDisabledPrepareExecutionPlan !== 'function') {
        throw new Error('Expected resolution-memo-disabled compiler-owned execution planner.');
      }
      const invokeOriginalResolutionMemoDisabledPrepareExecutionPlan =
        originalResolutionMemoDisabledPrepareExecutionPlan as (
          ...args: unknown[]
        ) => Promise<unknown>;
      type ResolutionOrderEvent =
        | { readonly candidatePath: string; readonly kind: 'assert' }
        | {
            readonly consumerPath: string;
            readonly kind: 'resolve';
          }
        | { readonly kind: 'result'; readonly resolved: string | undefined };
      const resolutionOrder: ResolutionOrderEvent[] = [];
      let passThroughPathComputations = 0;
      let passThroughPathRequests = 0;
      const passThroughPathMemo: PreviewResolutionConfinementPathMemo = Object.freeze({
        assert: (candidatePath: string, compute: () => string) => {
          passThroughPathRequests += 1;
          passThroughPathComputations += 1;
          resolutionOrder.push({ candidatePath, kind: 'assert' });
          return compute();
        },
        getStatistics: () =>
          Object.freeze({
            computations: passThroughPathComputations,
            entries: 0,
            hits: 0,
            released: false,
            requests: passThroughPathRequests,
          }),
        release: () => undefined,
      });
      const passThroughResolutionMemo: PreviewStaticModuleResolutionMemo = Object.freeze({
        getStatistics: () =>
          Object.freeze({
            computations: 0,
            entries: 0,
            hits: 0,
            released: false,
            requests: 0,
          }),
        release: () => undefined,
        resolve: (
          _moduleSpecifier: string,
          consumerPath: string,
          compute: () => string | undefined,
        ) => {
          resolutionOrder.push({ consumerPath, kind: 'resolve' });
          const resolved = compute();
          resolutionOrder.push({ kind: 'result', resolved });
          return resolved;
        },
      });
      resolutionMemoDisabledInternals[prepareExecutionPlanMethod] = (...args: unknown[]) => {
        args[5] = passThroughResolutionMemo;
        args[6] = passThroughPathMemo;
        args[7] = undefined;
        return invokeOriginalResolutionMemoDisabledPrepareExecutionPlan.apply(
          resolutionMemoDisabledCompiler,
          args,
        );
      };
      let resolutionMemoDisabledInventory: Awaited<
        ReturnType<EsbuildPreviewCompiler['collectCompleteRouteInventory']>
      >;
      try {
        resolutionMemoDisabledInventory =
          await resolutionMemoDisabledCompiler.collectCompleteRouteInventory(
            request,
            undefined,
            undefined,
            (event) => {
              resolutionMemoDisabledTelemetry.push(event);
            },
          );
      } finally {
        resolutionMemoDisabledInternals[prepareExecutionPlanMethod] =
          originalResolutionMemoDisabledPrepareExecutionPlan;
      }
      const unconfinedInternals = unconfinedCompiler as unknown as Record<string, unknown>;
      const originalUnconfinedPrepareExecutionPlan =
        unconfinedInternals[prepareExecutionPlanMethod];
      if (typeof originalUnconfinedPrepareExecutionPlan !== 'function') {
        throw new Error('Expected unconfined compiler-owned execution planner.');
      }
      const invokeOriginalUnconfinedPrepareExecutionPlan =
        originalUnconfinedPrepareExecutionPlan as (...args: unknown[]) => Promise<unknown>;
      const unconfinedPathMemoArguments: unknown[] = [];
      const unconfinedUsageContextArguments: unknown[] = [];
      unconfinedInternals[prepareExecutionPlanMethod] = (...args: unknown[]) => {
        unconfinedPathMemoArguments.push(args[6]);
        unconfinedUsageContextArguments.push(args[7]);
        return invokeOriginalUnconfinedPrepareExecutionPlan.apply(unconfinedCompiler, args);
      };
      const { resolutionConfinement: _resolutionConfinement, ...unconfinedRequest } = request;
      void _resolutionConfinement;
      try {
        await expect(
          unconfinedCompiler.collectCompleteRouteInventory(unconfinedRequest),
        ).resolves.toMatchObject({ complete: true, truncated: false });
      } finally {
        unconfinedInternals[prepareExecutionPlanMethod] = originalUnconfinedPrepareExecutionPlan;
      }
      expect(outerEquivalentInventory).toEqual(inventory);
      expect(JSON.stringify(outerEquivalentInventory)).toBe(JSON.stringify(inventory));
      expect(resolutionMemoDisabledInventory).toEqual(inventory);
      expect(JSON.stringify(resolutionMemoDisabledInventory)).toBe(JSON.stringify(inventory));
      expect(unconfinedPathMemoArguments.length).toBeGreaterThan(1);
      expect(unconfinedPathMemoArguments.every((memo) => memo === undefined)).toBe(true);
      expect(unconfinedUsageContextArguments.every((context) => context === undefined)).toBe(true);
      expect(passThroughPathRequests).toBe(passThroughPathComputations);
      expect(passThroughPathComputations).toBeGreaterThan(0);
      const resolveEvents = resolutionOrder.filter((event) => event.kind === 'resolve');
      const resultEvents = resolutionOrder.filter((event) => event.kind === 'result');
      const assertEvents = resolutionOrder.filter((event) => event.kind === 'assert');
      expect(resultEvents).toHaveLength(resolveEvents.length);
      expect(assertEvents).toHaveLength(
        resolveEvents.length + resultEvents.filter((event) => event.resolved !== undefined).length,
      );
      for (const [index, event] of resolutionOrder.entries()) {
        if (event.kind !== 'resolve') continue;
        expect(resolutionOrder[index - 1]).toEqual({
          candidatePath: event.consumerPath,
          kind: 'assert',
        });
        const result = resolutionOrder[index + 1];
        expect(result?.kind).toBe('result');
        if (result?.kind === 'result' && result.resolved !== undefined) {
          expect(resolutionOrder[index + 2]).toEqual({
            candidatePath: result.resolved,
            kind: 'assert',
          });
        }
      }
      const dynamicTelemetryFields = new Set([
        'cpuSystemMicros',
        'cpuUserMicros',
        'elapsedMs',
        'heapUsedBytes',
        'rssBytes',
      ]);
      const serializeTelemetryStructure = (
        events: readonly PreviewCompleteRouteInventoryTelemetryEvent[],
      ): string =>
        JSON.stringify(events, (key: string, value: unknown): unknown =>
          dynamicTelemetryFields.has(key) || key === 'bundleDiagnostics' ? undefined : value,
        );
      expect(serializeTelemetryStructure(outerEquivalentTelemetryAll)).toBe(
        serializeTelemetryStructure(telemetry),
      );
      const serializeTelemetryNonDurationCounters = (
        events: readonly PreviewCompleteRouteInventoryTelemetryEvent[],
      ): string =>
        JSON.stringify(events, (key: string, value: unknown): unknown =>
          dynamicTelemetryFields.has(key) || key.endsWith('Micros') ? undefined : value,
        );
      expect(serializeTelemetryNonDurationCounters(resolutionMemoDisabledTelemetry)).toBe(
        serializeTelemetryNonDurationCounters(telemetry),
      );
      expect(
        resolutionMemoDisabledTelemetry
          .filter(
            (event) =>
              event.phase === 'execution-frontier-bundle' && event.transition === 'complete',
          )
          .map((event) => event.bundleDiagnostics?.resolveModuleCount),
      ).toEqual(
        telemetry
          .filter(
            (event) =>
              event.phase === 'execution-frontier-bundle' && event.transition === 'complete',
          )
          .map((event) => event.bundleDiagnostics?.resolveModuleCount),
      );
      expect(repeatedInventory).toEqual(inventory);
      expect(JSON.stringify(repeatedInventory)).toBe(JSON.stringify(inventory));
      expect(inventory).toMatchObject({
        analysisPasses: 3,
        complete: true,
        counts: { duplicate: 1, runnable: 2, total: 3, unresolved: 0 },
        replayPasses: 3,
        truncated: false,
      });
      expect(repeatedInventory.analysisPasses).toBe(inventory.analysisPasses);
      expect(repeatedInventory.replayPasses).toBe(inventory.replayPasses);
      expect(inventory.counts.total).toBe(
        inventory.counts.runnable + inventory.counts.duplicate + inventory.counts.unresolved,
      );
      expect(
        new Set(
          telemetry
            .filter((event) => event.phase.startsWith('execution-'))
            .map((event) => event.phase),
        ),
      ).toEqual(
        new Set([
          'execution-shared-context',
          'execution-route-usage',
          'execution-frontier-style',
          'execution-frontier-globals',
          'execution-frontier-plan',
          'execution-frontier-candidates',
          'execution-frontier-bundle',
          'execution-frontier-ownership',
          'execution-frontier-target-contract',
          'execution-frontier-root-contract',
          'execution-frontier-artifact',
        ]),
      );
      expect(telemetry.every((event) => event.version === 4)).toBe(true);
      const bundleCompleteEvents = telemetry.filter(
        (event) => event.phase === 'execution-frontier-bundle' && event.transition === 'complete',
      );
      expect(bundleCompleteEvents).toHaveLength(2);
      expect(
        telemetry.every(
          (event) =>
            (event.bundleDiagnostics !== undefined) ===
            (event.phase === 'execution-frontier-bundle' && event.transition === 'complete'),
        ),
      ).toBe(true);
      for (const event of bundleCompleteEvents) {
        const diagnostics = event.bundleDiagnostics;
        if (diagnostics === undefined) throw new Error('Expected bundle-complete diagnostics.');
        expect(Object.keys(diagnostics)).toEqual(
          PREVIEW_COMPLETE_ROUTE_INVENTORY_TELEMETRY_POLICY.bundleDiagnostics.fieldNames,
        );
        expect(diagnostics.sliceRequestCount).toBe(
          diagnostics.sliceComputationCount + diagnostics.sliceHitCount,
        );
        expect(diagnostics.inventoryRequestCount).toBe(
          diagnostics.inventoryComputationCount + diagnostics.inventoryHitCount,
        );
        expect(diagnostics.inventoryReadRequestCount).toBeGreaterThanOrEqual(
          diagnostics.inventoryReadPathCacheHitCount,
        );
        expect(diagnostics.queueSortCount).toBe(diagnostics.queueIterationCount);
        expect(diagnostics.queueIterationCount === 0).toBe(diagnostics.queuePeakLength === 0);
      }
      expect(
        new Set(
          outerEquivalentTelemetry
            .filter((event) => event.phase.startsWith('execution-'))
            .map((event) => event.phase),
        ),
      ).toEqual(
        new Set([
          'execution-shared-context',
          'execution-route-usage',
          'execution-frontier-style',
          'execution-frontier-globals',
          'execution-frontier-plan',
        ]),
      );
      const expectedExecutionOrder = [
        'execution-shared-context:start',
        'execution-shared-context:complete',
        'execution-route-usage:start',
        'execution-route-usage:complete',
        'execution-frontier-style:start',
        'execution-frontier-style:complete',
        'execution-frontier-globals:start',
        'execution-frontier-globals:complete',
        'execution-frontier-plan:start',
        'execution-frontier-candidates:start',
        'execution-frontier-candidates:complete',
        'execution-frontier-bundle:start',
        'execution-frontier-bundle:complete',
        'execution-frontier-ownership:start',
        'execution-frontier-ownership:complete',
        'execution-frontier-target-contract:start',
        'execution-frontier-target-contract:complete',
        'execution-frontier-root-contract:start',
        'execution-frontier-root-contract:complete',
        'execution-frontier-artifact:start',
        'execution-frontier-artifact:complete',
        'execution-frontier-plan:complete',
      ];
      for (const routeOrdinal of [1, 2]) {
        expect(
          telemetry
            .filter(
              (event) =>
                event.phase.startsWith('execution-') && event.routeOrdinal === routeOrdinal,
            )
            .map((event) => `${event.phase}:${event.transition}`),
        ).toEqual(expectedExecutionOrder);
      }
      expect(telemetry.map((event) => event.sequence)).toEqual(
        telemetry.map((_, index) => index + 1),
      );
      const alternate = inventory.entries.find(
        (entry) =>
          entry.disposition === 'runnable' && entry.pattern === '/parent/alternate/:itemId',
      );
      expect(alternate?.disposition).toBe('runnable');
      if (alternate?.disposition !== 'runnable') {
        throw new Error('Generic fixture did not produce its nested alternate.');
      }
      const repeatedAlternate = repeatedInventory.entries.find(
        (entry) => entry.disposition === 'runnable' && entry.id === alternate.id,
      );
      expect(repeatedAlternate?.disposition).toBe('runnable');
      if (repeatedAlternate?.disposition !== 'runnable') {
        throw new Error('Repeated planning did not preserve the nested alternate.');
      }
      expect(repeatedAlternate.executionPlan.digest).toBe(alternate.executionPlan.digest);
      expect(repeatedAlternate.executionPlan).toEqual(alternate.executionPlan);
      const artifactFrontierActivities: PreviewCompilerBundleFrontierActivity[] = [];
      const bundle = await compiler.compile(
        {
          ...request,
          inspectorRouteSelection: alternate.selection,
          inspectorTargetMode: 'selected-route-leaf',
          preparationMode: 'fast',
          routeExecutionPlan: alternate.executionPlan,
        },
        createFrontierActivityContext(artifactFrontierActivities),
      );
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');
      const artifactText = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...(bundle.stylesheet === undefined ? [] : [Buffer.from(bundle.stylesheet)]),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');
      expect(javascript).toContain('leaf');
      expect(javascript).toContain('__previewSetupParity');
      expect(artifactText).toContain('final-frontier-style-companion');
      expect(bundle.dependencies).toContain(setupPath);
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
      const ordinarySetupFrontierActivities: PreviewCompilerBundleFrontierActivity[] = [];
      const ordinarySetupCompilation = compiler.compile(
        {
          ...request,
          inspectorRouteSelection: alternate.selection,
          inspectorTargetMode: 'selected-route-leaf',
          preparationMode: 'fast',
        },
        createFrontierActivityContext(ordinarySetupFrontierActivities),
      );
      await expect(ordinarySetupCompilation).rejects.toBeInstanceOf(PreviewBuildStalledError);
      await expect(ordinarySetupCompilation).rejects.toMatchObject({
        reason: 'frontier-mismatch',
      });
      const { setupModulePath: configuredSetupModulePath, ...requestWithoutSetup } = request;
      expect(configuredSetupModulePath).toBe(setupPath);
      const ordinaryBaseFrontierActivities: PreviewCompilerBundleFrontierActivity[] = [];
      const ordinaryBaseBundle = await compiler.compile(
        {
          ...requestWithoutSetup,
          inspectorRouteSelection: alternate.selection,
          inspectorTargetMode: 'selected-route-leaf',
          preparationMode: 'fast',
        },
        createFrontierActivityContext(ordinaryBaseFrontierActivities),
      );
      expect(Buffer.from(ordinaryBaseBundle.javascript).toString('utf8')).toContain('leaf');
      expect(ordinarySetupFrontierActivities[0]).toEqual(ordinaryBaseFrontierActivities[0]);
      expect(ordinarySetupFrontierActivities[0]?.exactModuleCount).toBeGreaterThan(0);
      expect(artifactFrontierActivities[0]?.exactModuleCount).toBeGreaterThan(
        ordinarySetupFrontierActivities[0]?.exactModuleCount ?? Number.MAX_SAFE_INTEGER,
      );
      await expect(
        compiler.compile({
          ...request,
          inspectorRouteSelection: [{ componentName: 'MissingRoute', pattern: '/not-authored' }],
          inspectorTargetMode: 'selected-route-leaf',
          preparationMode: 'fast',
          routeExecutionPlan: alternate.executionPlan,
        }),
      ).rejects.toMatchObject({
        evidence: {
          mismatchField: 'routeSelectionResolution',
          requestedResolution: 'exact',
          routeId: alternate.id,
        },
      });
      await expect(
        compiler.compile({
          ...request,
          inspectorPageExecutionCandidateId: 'missing-execution-candidate',
          inspectorRouteSelection: alternate.selection,
          inspectorTargetMode: 'selected-route-leaf',
          preparationMode: 'fast',
          routeExecutionPlan: alternate.executionPlan,
        }),
      ).rejects.toMatchObject({
        evidence: {
          mismatchField: 'executionCandidateId',
          requestedResolution: 'exact',
          routeId: alternate.id,
        },
      });
      await expect(
        compiler.compile({
          ...request,
          dependencySnapshots: request.dependencySnapshots.map((snapshot) =>
            snapshot.documentPath === setupPath
              ? { ...snapshot, sourceText: 'export const broken = ;' }
              : snapshot,
          ),
          inspectorRouteSelection: alternate.selection,
          inspectorTargetMode: 'selected-route-leaf',
          preparationMode: 'fast',
          routeExecutionPlan: alternate.executionPlan,
        }),
      ).rejects.toMatchObject({
        evidence: {
          mismatchField: 'frontierIdentity',
          requestedResolution: 'exact',
          routeId: alternate.id,
        },
      });
      const staleRequest = {
        ...request,
        dependencySnapshots: request.dependencySnapshots.map((snapshot) =>
          snapshot.documentPath === leafPath
            ? {
                ...snapshot,
                sourceText: `import 'missing-plan-validation-sentinel';\n${snapshot.sourceText}`,
              }
            : snapshot,
        ),
        inspectorRouteSelection: alternate.selection,
        inspectorTargetMode: 'selected-route-leaf' as const,
        preparationMode: 'fast' as const,
        routeExecutionPlan: alternate.executionPlan,
      };
      try {
        await compiler.compile(staleRequest);
        throw new Error('Expected the stale route execution plan to fail before esbuild.');
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewRouteExecutionPlanInvariantError);
        expect((error as PreviewRouteExecutionPlanInvariantError).evidence).toMatchObject({
          mismatchField: 'executionIdentity',
          requestedResolution: 'exact',
          routeId: alternate.id,
        });
      }
      await expect(compiler.replayCompleteRouteInventoryEntry(request, alternate)).resolves.toEqual(
        {
          exact: true,
          replay: alternate.replay,
        },
      );
      await expect(
        compiler.replayCompleteRouteInventoryEntry(
          request,
          Object.freeze({ ...alternate, id: `${alternate.id}-changed` }),
        ),
      ).resolves.toEqual({
        exact: false,
        reason: 'exact-replay-identity-mismatch',
      });
    } finally {
      await unconfinedCompiler.shutdown();
      await resolutionMemoDisabledCompiler.shutdown();
      await outerEquivalentCompiler.shutdown();
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
  it('creates real fast plans for an exact component-base factory and nested submodule page', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/complete-factory-route-replay-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const routerDirectory = path.join(projectRoot, 'node_modules/react-router-dom');
    const documentPath = path.join(sourceDirectory, 'App.tsx');
    const sources = new Map<string, string>([
      [
        documentPath,
        `
          import { Route, Routes } from 'react-router-dom';
          import { SectionApp } from './SectionApp';
          export default function App() {
            return <Routes>
              <Route path={normalize(\`\${SectionApp.basePath}/*\`)} element={<SectionApp />} />
            </Routes>;
          }
        `,
      ],
      [
        path.join(sourceDirectory, 'SectionApp.tsx'),
        `
          import { createSectionModule } from './create-section-module';
          import { ListPage } from './ListPage';
          import { ManagementApp } from './ManagementApp';
          export const SectionApp = createSectionModule(
            '/section',
            { ListPage },
            [ManagementApp],
            ({ generatedPages, generatedModules }) =>
              <Routes>{generatedPages}{generatedModules}</Routes>,
          );
        `,
      ],
      [
        path.join(sourceDirectory, 'ManagementApp.tsx'),
        `
          import { createSectionModule } from './create-section-module';
          import { DetailsPage } from './DetailsPage';
          export const ManagementApp = createSectionModule(
            '/section/manage',
            { DetailsPage },
            [],
            ({ generatedPages, generatedModules }) =>
              <Routes>{generatedPages}{generatedModules}</Routes>,
          );
        `,
      ],
      [
        path.join(sourceDirectory, 'create-section-module.ts'),
        `
          import { createSectionModuleBase } from './create-section-module-base';
          import { routeNamePathMap } from './route-registry';
          export const createSectionModule = createSectionModuleBase(routeNamePathMap);
        `,
      ],
      [
        path.join(sourceDirectory, 'create-section-module-base.tsx'),
        `
          import { Route } from 'react-router-dom';
          export const createSectionModuleBase = (catalog) =>
            (basePath, pages, subModules, Component) => {
              const App = withProps({
                generatedPages: Object.entries(pages).map(([name, Page]) =>
                  <Route key={name} path={catalog[name]} element={<Page />} />,
                ),
                generatedModules: subModules.map((NestedApp) =>
                  <Route key={NestedApp.name} path={NestedApp.basePath} element={<NestedApp />} />,
                ),
              })(Component);
              App.basePath = basePath;
              return App;
            };
        `,
      ],
      [
        path.join(sourceDirectory, 'route-registry.ts'),
        `
          import routeData from './routes.json';
          const pathNameMap = normalizeCatalog(routeData);
          export const routeNamePathMap = invert(pathNameMap);
        `,
      ],
      [
        path.join(sourceDirectory, 'routes.json'),
        JSON.stringify({
          section: {
            index: 'ListPage',
            manage: { details: 'DetailsPage' },
          },
        }),
      ],
      [
        path.join(sourceDirectory, 'ListPage.tsx'),
        'export function ListPage() { return <main>list</main>; }',
      ],
      [
        path.join(sourceDirectory, 'DetailsPage.tsx'),
        'export function DetailsPage() { return <main>details</main>; }',
      ],
      [
        path.join(sourceDirectory, 'main.tsx'),
        `
          import { createRoot } from 'react-dom/client';
          import App from './App';
          createRoot(document.body).render(<App />);
        `,
      ],
    ]);
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await mkdir(routerDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"react-router-dom":"6.30.1"}}',
          'utf8',
        ),
        writeFile(
          path.join(routerDirectory, 'package.json'),
          '{"name":"react-router-dom","version":"6.30.1","type":"module","exports":"./index.js"}',
          'utf8',
        ),
        writeFile(
          path.join(routerDirectory, 'index.js'),
          [
            'export function MemoryRouter({ children }) { return children; }',
            'export function Route({ element }) { return element; }',
            'export function Routes({ children }) { return children; }',
          ].join('\n'),
          'utf8',
        ),
        ...[...sources].map(([sourcePath, sourceText]) =>
          writeFile(sourcePath, sourceText, 'utf8'),
        ),
      ]);
      const request = Object.freeze({
        dependencySnapshots: Object.freeze(
          [...sources]
            .filter(([sourcePath]) => sourcePath !== documentPath && !sourcePath.endsWith('.json'))
            .map(([sourcePath, sourceText]) =>
              Object.freeze({
                documentPath: sourcePath,
                language: sourcePath.endsWith('.tsx') ? ('tsx' as const) : ('ts' as const),
                sourceText,
              }),
            ),
        ),
        documentPath,
        language: 'tsx' as const,
        renderMode: 'page-inspector' as const,
        sourceText: sources.get(documentPath) ?? '',
        workspaceRoot: projectRoot,
      });
      const inventory = await compiler.collectCompleteRouteInventory(request);
      const nested = inventory.entries.find(
        (entry) => entry.disposition === 'runnable' && entry.componentName === 'DetailsPage',
      );
      expect(nested?.disposition).toBe('runnable');
      if (nested?.disposition !== 'runnable') {
        throw new Error('Real factory fixture did not produce its nested page.');
      }
      expect(nested.pattern).toBe('/section/manage/details');
      expect(nested.selection).toHaveLength(3);
      expect(nested.executionPlan.routeId).toBe(nested.id);
      await expect(compiler.replayCompleteRouteInventoryEntry(request, nested)).resolves.toEqual({
        exact: true,
        replay: nested.replay,
      });
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
/** Verifies that one request memo retained useful work and released every cache layer. */
function expectReleasedRequestMemo(
  memo: PreviewInspectorBundleSourceInventoryMemo | undefined,
  reused: boolean,
): void {
  if (memo === undefined) throw new Error('Expected an execution-planning request memo.');
  expect(memo.getStatistics()).toMatchObject({ entries: 0, released: true });
  expect(memo.getSliceStatistics()).toMatchObject({ sliceEntries: 0, released: true });
  const closures = memo.getClosureStatistics();
  expect(closures).toMatchObject({ closureEntries: 0, released: true });
  const graph = memo.getGraphStatistics();
  expect([
    graph.dynamicResolutionEntries,
    graph.proposalEntries,
    graph.resolvedNodeEntries,
    graph.rootedGraphEntries,
    graph.released,
  ]).toEqual([0, 0, 0, 0, true]);
  expect(graph.resolvedNodeComputations).toBeGreaterThan(0);
  expect(graph.resolvedNodeRequests).toBe(graph.resolvedNodeComputations + graph.resolvedNodeHits);
  if (reused)
    expect(
      closures.closureHits +
        graph.dynamicResolutionHits +
        graph.proposalHits +
        graph.resolvedNodeHits +
        graph.rootedGraphHits,
    ).toBeGreaterThan(0);
}

/** Verifies common successful-only resolution/path memo accounting after request release. */
function expectReleasedReusableMemo(
  memo: PreviewResolutionConfinementPathMemo | PreviewStaticModuleResolutionMemo,
  reused: boolean,
): void {
  const statistics = memo.getStatistics();
  expect(statistics).toMatchObject({ entries: 0, released: true });
  expect(statistics.requests).toBe(statistics.computations + statistics.hits);
  if (reused) expect(statistics.hits).toBeGreaterThan(0);
}

/** Captures each distinct final-frontier activity emitted by a real compiler invocation. */
function createFrontierActivityContext(
  activities: PreviewCompilerBundleFrontierActivity[],
): PreviewBuildExecutionContext {
  return {
    reportProgress: (stage, activity) => {
      void stage;
      if (activity?.kind !== 'bundle-frontier') return;
      if (activities.at(-1) !== activity) activities.push(activity);
    },
  };
}
