/**
 * Proves the normal compiler, document, provider, and runtime boundary in real local Chromium.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn as spawnChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewCompiler } from '../../../src/application/previewCompiler';
import type { PreviewBuildRequest } from '../../../src/domain/preview';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import {
  PREVIEW_HEADLESS_FAILED_CAPTURE_MS,
  PREVIEW_HEADLESS_STABILIZATION_CAP_MS,
  PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
  classifyPreviewHeadlessStabilizedOutcome,
  createPreviewHeadlessCdpCommands,
  createPreviewHeadlessBridgeSource,
  createPreviewHeadlessTimeoutExpression,
  decodePreviewHeadlessCdpFrames,
  mimeTypeForPreviewArtifact,
  renderPreviewHeadlessly,
  type PreviewHeadlessCompositionDiagnostic,
  type PreviewHeadlessResult,
} from '../../../src/adapters/node/previewHeadlessRenderer';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('preview headless renderer', () => {
  /** Retains exact MIME routing and terminal correlation in the generated host bridge. */
  it('uses bounded exact artifact and terminal protocol helpers', () => {
    const bridge = createPreviewHeadlessBridgeSource(
      '1:expected',
      1,
      '__reactPreviewHeadless_test',
    );
    const frames = decodePreviewHeadlessCdpFrames(
      '{"id":1,"result":{}}\0{"method":"Runtime.bindingCalled"}\0{"id":',
    );
    const commands = createPreviewHeadlessCdpCommands(
      '__reactPreviewHeadless_test',
      'http://127.0.0.1:1234/index.html',
      1_000,
    );

    expect(mimeTypeForPreviewArtifact('entry.js')).toBe('text/javascript; charset=utf-8');
    expect(mimeTypeForPreviewArtifact('styles/value.css')).toBe('text/css; charset=utf-8');
    expect(mimeTypeForPreviewArtifact('asset.bin')).toBe('application/octet-stream');
    expect(frames.messages).toHaveLength(2);
    expect(frames.remainder).toBe('{"id":');
    expect(commands.map((command) => command.method)).toEqual([
      'Page.enable',
      'Runtime.enable',
      'Log.enable',
      'Runtime.addBinding',
      'Page.navigate',
      'Emulation.setVirtualTimePolicy',
    ]);
    expect(bridge).toContain('message.token === expectedToken');
    expect(bridge).toContain('message.revision === expectedRevision');
    expect(bridge).toContain('if (bridgeState.terminal !== undefined) return');
    expect(bridge).toContain("typeof binding === 'function'");
    expect(bridge).toContain("addEventListener('unhandledrejection'");
    expect(bridge).toContain(PREVIEW_HEADLESS_STABILIZATION_QUIET_MS.toString());
    expect(bridge).toContain(PREVIEW_HEADLESS_STABILIZATION_CAP_MS.toString());
    expect(bridge).toContain(PREVIEW_HEADLESS_FAILED_CAPTURE_MS.toString());
    expect(bridge).toContain('activeBlockerProvenance');
    expect(bridge).toContain('targetErrorOwner');
    expect(bridge).toContain('targetSourcePath');
    expect(bridge).toContain('progressVisible');
    expect(bridge).toContain("document.querySelector?.('[data-react-preview-mount]')");
    expect(createPreviewHeadlessTimeoutExpression('__reactPreviewHeadless_test')).toContain(
      'bridgeInstalled',
    );
    expect(createPreviewHeadlessTimeoutExpression('__reactPreviewHeadless_test')).toContain(
      'runtimeErrorText',
    );
    expect(createPreviewHeadlessTimeoutExpression('__reactPreviewHeadless_test')).toContain(
      'progressVisible',
    );
    expect(createPreviewHeadlessTimeoutExpression('__reactPreviewHeadless_test')).toContain(
      "document.querySelector?.('[data-react-preview-mount]')",
    );
  });

  /** Does not capture a transient blank frame while a neural or page retry owns the corridor. */
  it('keeps neural settlement and page execution retry states pending', () => {
    const bridge = createPreviewHeadlessBridgeSource(
      '1:pending',
      1,
      '__reactPreviewHeadless_pending',
      true,
    );

    expect(bridge).toContain("'settling-neural-render-state'");
    expect(bridge).toContain("'retrying-page-execution'");
    expect(bridge).toContain("composition.targetStatus === 'retrying-page-execution'");
  });

  it('classifies stabilized evidence with failure and blockage precedence', () => {
    const healthy = createStabilizedHeadlessResult();
    expect(classifyPreviewHeadlessStabilizedOutcome(healthy)).toBe('ready');
    expect(
      classifyPreviewHeadlessStabilizedOutcome({
        ...healthy,
        rootHtml: '',
        stabilization: {
          ...healthy.stabilization!,
          mountMutationCount: 0,
          compositionSnapshot: {
            ...healthy.stabilization!.compositionSnapshot!,
            currentFileMounted: 0,
            hostOutput: 0,
            targetRenderedEmpty: true,
          },
        },
      }),
    ).toBe('ready-empty');
    const blocked = {
      ...healthy,
      stabilization: {
        ...healthy.stabilization!,
        compositionSnapshot: {
          ...healthy.stabilization!.compositionSnapshot!,
          activeBlockers: 1,
          targetOutputKind: 'fallback-output',
        },
      },
    };
    expect(classifyPreviewHeadlessStabilizedOutcome(blocked)).toBe('partial-blocked');
    expect(
      classifyPreviewHeadlessStabilizedOutcome({
        ...healthy,
        stabilization: { ...healthy.stabilization!, progressVisible: true },
      }),
    ).toBe('partial-blocked');
    expect(
      classifyPreviewHeadlessStabilizedOutcome({
        ...blocked,
        evidence: { ...blocked.evidence, windowErrors: ['late rejection'] },
      }),
    ).toBe('post-commit-failed');
    expect(
      classifyPreviewHeadlessStabilizedOutcome({
        ...healthy,
        evidence: {
          ...healthy.evidence,
          consoleFailures: ['styled-components-configuration-partial'],
          incidentalNetworkFailures: ['favicon.ico 404'],
        },
      }),
    ).toBe('ready');
    expect(
      classifyPreviewHeadlessStabilizedOutcome({
        ...healthy,
        stabilization: {
          ...healthy.stabilization!,
          capReached: true,
          quiet: false,
        },
      }),
    ).toBe('insufficient-evidence');
  });

  /** Normalizes optional target errors without fabricating absence or hiding real strings. */
  it('treats absent and null target error fields as healthy while retaining genuine text', () => {
    const readComposition = createBridgeCompositionFixture();
    const absent = readComposition({
      errorMessage: null,
      errorOwner: undefined,
      errorPhase: null,
      fallbackOwner: undefined,
      hasOutput: true,
      pageRootCommitted: true,
      stage: 'target-output',
    });
    expect(absent).toMatchObject({ targetError: false });
    expect(absent).not.toHaveProperty('targetErrorOwner');
    expect(absent).not.toHaveProperty('targetErrorPhase');

    const genuine = readComposition({
      errorMessage: '[undefined]',
      errorOwner: 'SelectedPage',
      errorPhase: 'render',
    });
    expect(genuine).toMatchObject({
      targetError: true,
      targetErrorOwner: 'SelectedPage',
      targetErrorPhase: 'render',
    });
  });

  it('retains a composition snapshot emitted before the ready terminal', () => {
    const readComposition = createBridgeCompositionFixture({ terminalFirst: false });
    expect(
      readComposition({
        hasOutput: true,
        mounted: true,
        pageRootCommitted: true,
        stage: 'target-output',
        status: 'reached',
      }),
    ).toMatchObject({
      activeBlockers: 0,
      targetHasOutput: true,
      targetMounted: true,
      targetStage: 'target-output',
      targetStatus: 'reached',
    });
  });

  /** Converts launch errors, early exits, and missing terminals into fully cleaned protocol failures. */
  it('cleans every owned resource after invalid launch, early exit, and forced timeout', async () => {
    const compiler = createInertCompiler();
    const request = createInertRequest();
    const invalid = await renderPreviewHeadlessly(compiler, request, {
      chromiumPath: '/definitely/missing/react-preview-chromium',
      timeoutMs: 500,
      virtualTimeMs: 100,
    });
    expect(invalid.status).toBe('protocol-error');
    expect(invalid.cleanup).toEqual({
      browserTerminated: true,
      profileRemoved: true,
      serverClosed: true,
    });

    const earlyExit = await renderPreviewHeadlessly(compiler, request, {
      chromiumPath: '/usr/bin/false',
      timeoutMs: 500,
      virtualTimeMs: 100,
    });
    expect(earlyExit.status).toBe('protocol-error');
    expect(earlyExit.cleanup).toEqual({
      browserTerminated: true,
      profileRemoved: true,
      serverClosed: true,
    });

    const forcedTimeout = await renderPreviewHeadlessly(compiler, request, {
      chromiumPath: process.env.CHROMIUM_PATH ?? '/opt/homebrew/bin/chromium',
      timeoutMs: 500,
      virtualTimeMs: 100,
    });
    expect(forcedTimeout.status).toBe('protocol-error');
    expect(forcedTimeout.timeoutDiagnostic).toContain('bridgeInstalled');
    expect(forcedTimeout.cleanup).toEqual({
      browserTerminated: true,
      profileRemoved: true,
      serverClosed: true,
    });
  }, 15_000);

  it('sanitizes the explicit Chromium spawn environment without mutating its source', async () => {
    const parentEnvironment: NodeJS.ProcessEnv = {
      DYLD_INSERT_LIBRARIES: '/missing/injection.dylib',
      LD_AUDIT: '/missing/audit.so',
      LD_LIBRARY_PATH: '/unsafe/ld',
      LD_PRELOAD: '/missing/preload.so',
      PORT_MANAGER_HOOK: '1',
      SAFE_SENTINEL: 'preserved',
    };
    const parentBefore = { ...parentEnvironment };
    const processBefore = { ...process.env };
    let observedEnvironment: NodeJS.ProcessEnv | undefined;
    let observedArguments: readonly string[] = [];
    const result = await renderPreviewHeadlessly(createInertCompiler(), createInertRequest(), {
      chromiumPath: '/usr/bin/false',
      parentEnvironment,
      spawnProcess: (executable: string, arguments_: readonly string[], options: SpawnOptions) => {
        observedArguments = arguments_;
        observedEnvironment = options.env;
        return spawnChildProcess(executable, [...arguments_], options);
      },
      timeoutMs: 500,
      virtualTimeMs: 100,
    });

    expect(result.status).toBe('protocol-error');
    expect(observedArguments).toContain('--remote-debugging-pipe');
    expect(observedEnvironment).toEqual({
      PORT_MANAGER_HOOK: '0',
      SAFE_SENTINEL: 'preserved',
    });
    expect(parentEnvironment).toEqual(parentBefore);
    expect(process.env).toEqual(processBefore);
  });

  /** Executes both successful output and a provider failure through ReactDOM and the runtime boundary. */
  it('renders committed DOM and reports a provider Router invariant from Chromium', async () => {
    const fixtureRoot = await mkdtemp(path.join(PROJECT_ROOT, 'test/fixtures/headless-runtime-'));
    temporaryDirectories.push(fixtureRoot);
    const documentPath = path.join(fixtureRoot, 'Preview.tsx');
    const setupModulePath = path.join(fixtureRoot, 'setup.tsx');
    const sourceText =
      'export default function Preview() { return <main id="actual-preview">ACTUAL_PREVIEW_DOM</main>; }';
    await writeFile(documentPath, sourceText, 'utf8');
    const compiler = new EsbuildPreviewCompiler();

    try {
      const positive = await renderPreviewHeadlessly(
        compiler,
        {
          dependencySnapshots: [],
          documentPath,
          language: 'tsx',
          sourceText,
          useStorybookPreview: false,
          workspaceRoot: PROJECT_ROOT,
        },
        process.env.CHROMIUM_PATH === undefined ? {} : { chromiumPath: process.env.CHROMIUM_PATH },
      );
      expect(positive.status, positive.protocolError).toBe('ready');
      expect(positive.terminal).toMatchObject({
        revision: 1,
        type: 'react-preview-runtime-ready',
      });
      expect(positive.rootHtml).toContain('<main id="actual-preview">ACTUAL_PREVIEW_DOM</main>');
      expect(positive.stabilization?.progressVisible).toBe(false);
      expect(positive.cleanup).toEqual({
        browserTerminated: true,
        profileRemoved: true,
        serverClosed: true,
      });

      const setupSource = [
        "import type { PropsWithChildren } from 'react';",
        'export function PreviewProviders(_props: PropsWithChildren) {',
        "  throw new Error('useRoutes() may be used only in the context of a <Router>');",
        '}',
      ].join('\n');
      await writeFile(setupModulePath, setupSource, 'utf8');
      const negative = await renderPreviewHeadlessly(
        compiler,
        {
          dependencySnapshots: [],
          documentPath,
          language: 'tsx',
          setupModulePath,
          sourceText,
          useStorybookPreview: false,
          workspaceRoot: PROJECT_ROOT,
        },
        process.env.CHROMIUM_PATH === undefined ? {} : { chromiumPath: process.env.CHROMIUM_PATH },
      );
      expect(negative.status, negative.protocolError).toBe('failed');
      expect(negative.terminal).toMatchObject({
        revision: 1,
        type: 'react-preview-runtime-failed',
      });
      expect(negative.runtimeErrorText).toContain(
        'useRoutes() may be used only in the context of a <Router>',
      );
      expect(negative.rootHtml).toContain('react-preview-runtime-error');
      expect(negative.cleanup).toEqual({
        browserTerminated: true,
        profileRemoved: true,
        serverClosed: true,
      });
    } finally {
      await compiler.shutdown();
    }
  }, 60_000);
});

function createStabilizedHeadlessResult(): PreviewHeadlessResult {
  const composition: PreviewHeadlessCompositionDiagnostic = {
    activeBlockerProvenance: [],
    activeBlockers: 0,
    criticalEvidenceTruncated: false,
    currentFileMounted: 1,
    hostOutput: 1,
    requirementSearchExhausted: false,
    requirementSearchSettled: true,
    requirementSearchStatus: 'reached',
    targetError: false,
    targetExportName: 'SelectedPage',
    targetHasOutput: true,
    targetMounted: true,
    targetOutputKind: 'target-output',
    targetOwnershipPhases: {},
    targetPageRootCommitted: true,
    targetRenderedEmpty: false,
    targetSourcePath: '/workspace/SelectedPage.tsx',
    targetStage: 'target-output',
    targetStatus: 'reached',
  };
  return {
    browserExitCode: 0,
    cleanup: { browserTerminated: true, profileRemoved: true, serverClosed: true },
    diagnostics: [],
    evidence: {
      cdpExceptions: [],
      consoleFailures: [],
      extensionMessages: [],
      incidentalNetworkFailures: [],
      loopbackRequests: [],
      requiredArtifactFailures: [],
      runtimeEvents: [],
      windowErrors: [],
    },
    rootHtml: '<main>healthy</main>',
    stabilization: {
      capReached: false,
      compositionSnapshot: composition,
      durationMs: PREVIEW_HEADLESS_STABILIZATION_QUIET_MS,
      messagesTruncated: false,
      mountMutationCount: 1,
      postTerminalSnapshotReceived: true,
      progressVisible: false,
      quiet: true,
      snapshotCount: 1,
      structuredRuntimeError: false,
    },
    status: 'ready',
    terminal: { revision: 1, token: '1:test', type: 'react-preview-runtime-ready' },
  };
}

/** Evaluates the generated host bridge and returns its normalized latest composition snapshot. */
function createBridgeCompositionFixture(
  options: { readonly terminalFirst?: boolean } = {},
): (targetState: Record<string, unknown>) => PreviewHeadlessCompositionDiagnostic {
  const bindingName = '__reactPreviewHeadless_optional';
  const context: {
    MutationObserver: new () => { observe(): void };
    __api?: { postMessage(message: unknown): Promise<boolean> };
    __state?: { latestComposition?: PreviewHeadlessCompositionDiagnostic };
    acquireVsCodeApi?: () => { postMessage(message: unknown): Promise<boolean> };
    addEventListener(): void;
    console: { error(): void; warn(): void };
    document: {
      querySelector(): {
        innerHTML: string;
        querySelector(): null;
      };
    };
    setTimeout(): number;
  } = {
    MutationObserver: class {
      public observe(): void {}
    },
    addEventListener: () => undefined,
    console: { error: () => undefined, warn: () => undefined },
    document: {
      querySelector: () => ({
        innerHTML: '',
        querySelector: () => null,
      }),
    },
    setTimeout: () => 0,
  };
  vm.runInNewContext(
    `${createPreviewHeadlessBridgeSource('1:test', 1, bindingName, true)}
globalThis.__api = globalThis.acquireVsCodeApi();
globalThis.__state = globalThis[${JSON.stringify(`${bindingName}State`)}];`,
    context,
  );
  const api = context.__api;
  if (api === undefined || context.__state === undefined) {
    throw new Error('Headless bridge composition fixture did not initialize.');
  }
  if (options.terminalFirst !== false) {
    void api.postMessage({ revision: 1, token: '1:test', type: 'react-preview-runtime-ready' });
  }
  return (targetState) => {
    void api.postMessage({
      event: {
        detail: {
          blockerSummary: { active: 0, items: [] },
          requirementSearch: {
            exhausted: true,
            searchStatus: 'reached',
            settled: true,
          },
          statusCounts: { currentFileMounted: 1, hostOutput: 1 },
          targetState,
        },
        event: 'page-composition-snapshot',
      },
      runtimeRevision: 1,
      type: 'react-preview-runtime-health',
    });
    if (options.terminalFirst === false) {
      void api.postMessage({ revision: 1, token: '1:test', type: 'react-preview-runtime-ready' });
    }
    const composition = context.__state?.latestComposition;
    if (composition === undefined) {
      throw new Error('Headless bridge did not normalize the composition snapshot.');
    }
    return composition;
  };
}

/** Returns a compiler whose valid module intentionally never posts a terminal signal. */
function createInertCompiler(): PreviewCompiler {
  return {
    compile: () =>
      Promise.resolve({
        chunks: [],
        dependencies: [],
        diagnostics: [],
        javascript: new TextEncoder().encode('globalThis.__inertPreviewEntry = true;'),
        watchDirectories: [],
      }),
  };
}

/** Returns the smallest immutable request accepted by the headless compiler boundary. */
function createInertRequest(): PreviewBuildRequest {
  return {
    dependencySnapshots: [],
    documentPath: '/virtual/Inert.tsx',
    language: 'tsx' as const,
    sourceText: 'export default function Inert() { return null; }',
    workspaceRoot: '/virtual',
  };
}
