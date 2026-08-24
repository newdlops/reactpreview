import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EsbuildPreviewCompiler } from '../src/adapters/esbuild/esbuildPreviewCompiler';
import { renderCompiledPreviewHeadlessly } from '../src/adapters/node/previewHeadlessRenderer';

const [, , workspaceArgument, ...targetArguments] = process.argv;
if (workspaceArgument === undefined || targetArguments.length === 0) {
  throw new Error('Usage: tmp-validate-target-render <workspace> <target...>');
}

const workspaceRoot = path.resolve(workspaceArgument);
const chromiumPath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
const preparationMode = process.env.REACTPREVIEW_VALIDATION_MODE === 'fast' ? 'fast' : 'full';
const compiler = new EsbuildPreviewCompiler();

try {
  for (const targetArgument of targetArguments) {
    const documentPath = path.resolve(targetArgument);
    const sourceText = await readFile(documentPath, 'utf8');
    const request = Object.freeze({
      dependencySnapshots: Object.freeze([]),
      documentPath,
      language: documentPath.endsWith('.jsx') ? ('jsx' as const) : ('tsx' as const),
      preparationMode,
      renderMode: 'page-inspector' as const,
      sourceText,
      useStorybookPreview: true,
      workspaceRoot,
    });
    const startedAt = Date.now();
    let previousProgress = '';
    const bundle = await compiler.compile(request, {
      reportProgress(stage, activity): void {
        const progress = JSON.stringify({ activity, elapsedMs: Date.now() - startedAt, stage });
        if (progress === previousProgress) return;
        previousProgress = progress;
        process.stderr.write(`[validation-progress] ${progress}\n`);
      },
    });
    const compiledAt = Date.now();
    const result = await renderCompiledPreviewHeadlessly(bundle, request, {
      chromiumPath,
      timeoutMs: 45_000,
      virtualTimeMs: 5_000,
    });
    const composition = result.stabilization?.compositionSnapshot;
    process.stdout.write(
      `${JSON.stringify({
        activeBlockers: composition?.activeBlockers,
        compileDurationMs: compiledAt - startedAt,
        contextCoverage: bundle.contextCoverage,
        contextModuleSourcePath: composition?.contextModuleSourcePath,
        currentFileMounted: composition?.currentFileMounted,
        dependencyCount: bundle.dependencies.length,
        diagnosticErrors: bundle.diagnostics
          .filter((diagnostic) => diagnostic.severity === 'error')
          .map((diagnostic) => diagnostic.message),
        headlessStatus: result.status,
        nestedMountCount: composition?.pageExecutionNestedMountCount,
        preparationMode,
        rootHtmlPreview: result.rootHtml.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 320),
        stabilizedOutcome: result.stabilizedOutcome,
        targetContextualFallbackRequested: composition?.targetContextualFallbackRequested,
        targetError: composition?.targetError,
        targetErrorMessage: composition?.targetErrorMessage,
        targetHasOutput: composition?.targetHasOutput,
        targetMounted: composition?.targetMounted,
        targetStage: composition?.targetStage,
        targetStatus: composition?.targetStatus,
        target: documentPath,
        totalDurationMs: Date.now() - startedAt,
      })}\n`,
    );
  }
} finally {
  await compiler.shutdown();
}
