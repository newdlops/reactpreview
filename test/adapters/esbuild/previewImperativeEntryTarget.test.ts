/** Verifies safe pseudo-root synthesis for export-less ReactDOM application entry modules. */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPreviewImperativeEntryAnalysisSource,
  preparePreviewCompilerTarget,
  preparePreviewImperativeEntryRuntimeSource,
  selectPreviewImperativeEntryTarget,
} from '../../../src/adapters/esbuild/previewImperativeEntryTarget';
import { selectPreviewTargetExports } from '../../../src/adapters/esbuild/previewTargetExports';

const ENTRY_PATH = '/workspace/src/index.tsx';
const JAVASCRIPT_ENTRY_PATH = '/workspace/src/index.js';

describe('previewImperativeEntryTarget', () => {
  /** Converts a local private App into a default preview target and suppresses both root calls. */
  it('synthesizes an importable root for assigned createRoot render syntax', () => {
    const sourceText = [
      "import * as ReactDOMClient from 'react-dom/client';",
      'const root = ReactDOMClient.createRoot(document.getElementById("root")!);',
      'function App() { return <main>LOCAL_ENTRY_PAGE</main>; }',
      'root.render(<App />);',
    ].join('\n');
    const target = selectPreviewImperativeEntryTarget(ENTRY_PATH, sourceText);

    expect(target).toMatchObject({
      componentName: 'ReactPreviewImperativeEntryRoot',
      exportName: 'default',
      renderedJsx: '<App />',
      sourcePath: ENTRY_PATH,
    });
    expect(target?.rootInitializer).toBeDefined();
    const analysisSource = createPreviewImperativeEntryAnalysisSource(
      sourceText,
      requireTarget(target),
    );
    const runtimeSource = preparePreviewImperativeEntryRuntimeSource(ENTRY_PATH, sourceText);

    expect(selectPreviewTargetExports(ENTRY_PATH, analysisSource)).toEqual([
      {
        displayName: 'ReactPreviewImperativeEntryRoot',
        exportName: 'default',
        kind: 'explicit',
      },
    ]);
    expect(analysisSource).toContain('root.render(<App />)');
    expect(runtimeSource).not.toContain('ReactDOMClient.createRoot(document');
    expect(runtimeSource).not.toContain('root.render(<App />)');
    expect(runtimeSource).toContain('return (<App />);');
    expect(runtimeSource).toContain('export default ReactPreviewImperativeEntryRoot;');
  });

  /** Hydration receives JSX in another argument but is exposed through the identical pseudo root. */
  it('supports imported App through hydrateRoot without running authored hydration', () => {
    const sourceText = [
      "import { hydrateRoot } from 'react-dom/client';",
      "import App from './App';",
      'hydrateRoot(document.getElementById("root")!, <App boot="static" />);',
    ].join('\n');
    const runtimeSource = preparePreviewImperativeEntryRuntimeSource(ENTRY_PATH, sourceText);

    expect(runtimeSource).not.toContain('hydrateRoot(document');
    expect(runtimeSource).toContain('return (<App boot="static" />);');
    expect(runtimeSource).toContain('export default ReactPreviewImperativeEntryRoot;');
  });

  /** Legacy JavaScript entry modules retain JSX instead of being misparsed as TypeScript syntax. */
  it('synthesizes an export-less JSX mount authored in index.js', () => {
    const sourceText = [
      "import { createRoot } from 'react-dom/client';",
      "import App from './App';",
      'createRoot(document.getElementById("root")).render(<App />);',
    ].join('\n');

    const target = selectPreviewImperativeEntryTarget(JAVASCRIPT_ENTRY_PATH, sourceText);
    const runtimeSource = preparePreviewImperativeEntryRuntimeSource(
      JAVASCRIPT_ENTRY_PATH,
      sourceText,
    );

    expect(target).toMatchObject({ exportName: 'default', renderedJsx: '<App />' });
    expect(runtimeSource).not.toContain('createRoot(document');
    expect(runtimeSource).toContain('return (<App />);');
  });

  /** Canonical esbuild loads still match an editor target opened through a workspace symlink. */
  it('prepares the canonical source behind a symlinked entry path', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-imperative-symlink-'));
    const sourceDirectory = path.join(fixtureRoot, 'real-src');
    const linkedDirectory = path.join(fixtureRoot, 'linked-src');
    const sourcePath = path.join(sourceDirectory, 'index.tsx');
    const linkedPath = path.join(linkedDirectory, 'index.tsx');
    const sourceText = [
      "import { createRoot } from 'react-dom/client';",
      'function App() { return <main>SYMLINK_ENTRY</main>; }',
      'createRoot(document.body).render(<App />);',
    ].join('\n');
    try {
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(sourcePath, sourceText, 'utf8');
      await symlink(
        sourceDirectory,
        linkedDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const selection = preparePreviewCompilerTarget({
        documentPath: linkedPath,
        renderMode: 'page-inspector',
        sourceText,
      });

      const runtimeSource = selection.prepareSource(await realpath(sourcePath), sourceText);

      expect(selection.isImperativeEntry).toBe(true);
      expect(runtimeSource).not.toContain('createRoot(document');
      expect(runtimeSource).toContain('return (<App />);');
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  /** Existing authored exports keep normal component selection and source preparation unchanged. */
  it('keeps ordinary exported component targets authoritative', () => {
    const sourceText = [
      "import { createRoot } from 'react-dom/client';",
      'export function App() { return <main>EXPORTED</main>; }',
      'createRoot(document.body).render(<App />);',
    ].join('\n');
    const selection = preparePreviewCompilerTarget({
      documentPath: ENTRY_PATH,
      renderMode: 'page-inspector',
      sourceText,
    });

    expect(selection.isImperativeEntry).toBe(false);
    expect(selection.explicitExportNames).toEqual(['App']);
    expect(selection.prepareSource(ENTRY_PATH, sourceText)).toBe(sourceText);
  });

  /** Nested bootstrap calls fail closed because their local values cannot be moved to module scope. */
  it('rejects mounts nested inside bootstrap functions', () => {
    const sourceText = [
      "import { createRoot } from 'react-dom/client';",
      'function App() { return <main />; }',
      'function bootstrap(container: Element) {',
      '  const label = "local";',
      '  createRoot(container).render(<App data-label={label} />);',
      '}',
    ].join('\n');

    expect(selectPreviewImperativeEntryTarget(ENTRY_PATH, sourceText)).toBeUndefined();
  });

  /** An expression-bodied arrow still owns a closure despite its top-level variable statement. */
  it('rejects mounts nested inside top-level arrow initializers', () => {
    const sourceText = [
      "import { createRoot } from 'react-dom/client';",
      'function App() { return <main />; }',
      'const bootstrap = (container: Element) => createRoot(container).render(<App />);',
    ].join('\n');

    expect(selectPreviewImperativeEntryTarget(ENTRY_PATH, sourceText)).toBeUndefined();
  });
});

/** Narrows optional selection output after the test asserted its presence. */
function requireTarget<T>(target: T | undefined): T {
  if (target === undefined) throw new Error('Expected imperative entry target evidence.');
  return target;
}
