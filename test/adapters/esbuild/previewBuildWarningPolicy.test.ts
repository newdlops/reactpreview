/** Verifies stale dependency JSX pragmas are hidden only with exact transpilation evidence. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type Message } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { selectReportablePreviewBuildWarnings } from '../../../src/adapters/esbuild/previewBuildWarningPolicy';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('selectReportablePreviewBuildWarnings', () => {
  /** Suppresses the react-spinners shape only after proving its JavaScript contains emitted JSX calls. */
  it('removes an inert pragma warning from already-transpiled node_modules JavaScript', async () => {
    const root = await createTemporaryRoot();
    const relativePath = path.join('node_modules', 'react-spinners', 'BarLoader.js');
    await writeSource(
      root,
      relativePath,
      [
        '"use strict";',
        '/** @jsx jsx */',
        'const core = require("@emotion/core");',
        'exports.Loader = () => core.jsx("span", { role: "status" });',
      ].join('\n'),
    );
    const result = await build({
      absWorkingDir: root,
      bundle: false,
      entryPoints: [path.join(root, relativePath)],
      jsx: 'automatic',
      loader: { '.js': 'jsx' },
      logLevel: 'silent',
      write: false,
    });

    expect(result.warnings.map((warning) => warning.id)).toContain('unsupported-jsx-comment');
    await expect(selectReportablePreviewBuildWarnings(result.warnings, root)).resolves.toEqual([]);
  });

  /** Keeps the same warning for authored code even when that source has already been transformed. */
  it('preserves authored source diagnostics', async () => {
    const root = await createTemporaryRoot();
    const relativePath = path.join('src', 'AuthoredComponent.js');
    await writeSource(root, relativePath, '/** @jsx jsx */\nexport const view = jsx("div", {});');
    const warning = createUnsupportedJsxCommentWarning(relativePath);

    await expect(selectReportablePreviewBuildWarnings([warning], root)).resolves.toEqual([warning]);
  });

  /** Keeps dependency warnings when raw JSX remains because the ignored pragma may change styling. */
  it('preserves node_modules diagnostics when JSX still requires transformation', async () => {
    const root = await createTemporaryRoot();
    const relativePath = path.join('node_modules', 'raw-jsx-package', 'index.js');
    await writeSource(
      root,
      relativePath,
      '/** @jsx jsx */\nexport const View = () => <div data-authored />;',
    );
    const warning = createUnsupportedJsxCommentWarning(relativePath);

    await expect(selectReportablePreviewBuildWarnings([warning], root)).resolves.toEqual([warning]);
  });

  /** Fails closed when a warning has no readable source evidence or belongs to another diagnostic. */
  it('preserves missing files and unrelated warning identities', async () => {
    const root = await createTemporaryRoot();
    const missing = createUnsupportedJsxCommentWarning(
      path.join('node_modules', 'missing-package', 'index.js'),
    );
    const unrelated = { ...missing, id: 'another-warning', text: 'Another warning' };

    await expect(selectReportablePreviewBuildWarnings([missing, unrelated], root)).resolves.toEqual(
      [missing, unrelated],
    );
  });
});

/** Allocates one isolated workspace root and registers deterministic cleanup. */
async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'react-preview-warning-policy-'));
  temporaryRoots.push(root);
  return root;
}

/** Writes one fixture source after creating its package or authored parent directory. */
async function writeSource(root: string, relativePath: string, source: string): Promise<void> {
  const sourcePath = path.join(root, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, source, 'utf8');
}

/** Creates the exact esbuild diagnostic emitted for legacy `@jsx` comments in automatic mode. */
function createUnsupportedJsxCommentWarning(relativePath: string): Message {
  return {
    detail: undefined,
    id: 'unsupported-jsx-comment',
    location: {
      column: 0,
      file: relativePath,
      length: 15,
      line: 2,
      lineText: '/** @jsx jsx */',
      namespace: 'file',
      suggestion: '',
    },
    notes: [],
    pluginName: '',
    text: "The JSX factory cannot be set when using React's automatic JSX transform",
  };
}
