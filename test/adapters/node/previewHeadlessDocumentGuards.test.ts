/**
 * Proves in real Chromium that a page opening JavaScript dialogs or navigating away still reaches
 * its terminal signal with its own output. A VS Code webview has no `allow-modals`, so dialogs
 * return at once there; the preview document keeps itself open against history and URL changes.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import {
  renderPreviewHeadlessly,
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

describe('headless preview document guards', () => {
  /** An unanswered CDP dialog froze the renderer until the run timed out. */
  it('declines confirm and alert dialogs instead of freezing the page', async () => {
    const result = await renderSource(
      [
        "const answer = window.confirm('Leave this page?');",
        "window.alert('Invalid access');",
        'export default function Preview() {',
        '  return <main id="dialog-preview">{answer ? "CONFIRMED" : "DECLINED"}</main>;',
        '}',
      ].join('\n'),
    );

    expect(result.status, result.protocolError).toBe('ready');
    expect(result.rootHtml).toContain('DECLINED');
    expect(
      result.evidence.runtimeEvents.filter((event) => event.includes('javascriptDialogOpening')),
    ).toHaveLength(2);
  }, 60_000);

  /** `navigate(-1)` and redirects used to replace the preview with another document. */
  it('keeps the preview document when the page steps back or assigns another URL', async () => {
    const result = await renderSource(
      [
        "history.pushState({}, '', '/step');",
        'history.go(-2);',
        "location.assign('/elsewhere');",
        'export default function Preview() {',
        '  return <main id="navigation-preview">STAYED</main>;',
        '}',
      ].join('\n'),
    );

    expect(result.status, result.protocolError).toBe('ready');
    expect(result.rootHtml).toContain('STAYED');
    expect(result.evidence.consoleFailures.join('\n')).toContain('Kept the preview open');
  }, 60_000);
});

/** Renders one TSX module through the real compiler and Chromium. */
async function renderSource(sourceText: string): Promise<PreviewHeadlessResult> {
  const fixtureRoot = await mkdtemp(path.join(PROJECT_ROOT, 'test/fixtures/headless-guard-'));
  temporaryDirectories.push(fixtureRoot);
  const documentPath = path.join(fixtureRoot, 'Preview.tsx');
  await writeFile(documentPath, sourceText, 'utf8');
  const compiler = new EsbuildPreviewCompiler();
  try {
    return await renderPreviewHeadlessly(
      compiler,
      {
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: PROJECT_ROOT,
      },
      {
        timeoutMs: 30_000,
        ...(process.env.CHROMIUM_PATH === undefined
          ? {}
          : { chromiumPath: process.env.CHROMIUM_PATH }),
      },
    );
  } finally {
    await compiler.shutdown();
  }
}
