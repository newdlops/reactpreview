/** Keeps exact local export aliases in the fast import corridor without admitting other factories. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectFastLocalTargetExportDemands } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastCorridorReverse';
import { collectPreviewInspectorFastPageCorridor } from '../../../../src/adapters/esbuild/inspector/previewInspectorFastPageCorridor';

const DECLARATIONS = [
  'export const FeatureApp = createModule("/feature", {}, [], ({ routes }) => <Routes>{routes}</Routes>);',
  'export const OtherApp = createModule("/other", {}, [], ({ routes }) => <Routes>{routes}</Routes>);',
].join('\n');
const DEFAULTS = [
  'export default FeatureApp;',
  'export { FeatureApp as default };',
  'export default (((FeatureApp as typeof FeatureApp)!));',
];
const temporaryRoots: string[] = [];

/** Cleans only fixtures created by this test module, including on assertion failures. */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Reads one inert selected snapshot and never follows an initializer or imports application code. */
function collectDemands(
  sourceText: string,
  targetExportName = 'default',
): Promise<readonly string[]> {
  return collectFastLocalTargetExportDemands({
    documentPath: '/workspace/src/app.tsx',
    readSource: () => Promise.resolve(sourceText),
    targetExportName,
  });
}

describe('fast corridor exact default aliases', () => {
  it.each(DEFAULTS)('includes only the same local factory for %s', async (suffix) => {
    expect(await collectDemands(`${DECLARATIONS}\n${suffix}`)).toEqual(['default', 'FeatureApp']);
  });

  it('also admits a default consumer when the selected public export is named', async () => {
    expect(
      await collectDemands(`${DECLARATIONS}\nexport default FeatureApp;`, 'FeatureApp'),
    ).toEqual(['FeatureApp', 'default']);
  });

  it('retains a same-file JSX owner of the exact local default binding', async () => {
    expect(
      await collectDemands(
        `${DECLARATIONS}\nexport default FeatureApp;\nexport function Screen() { return <FeatureApp />; }`,
      ),
    ).toEqual(['default', 'FeatureApp', 'Screen']);
  });

  it.each([
    'export default wrap(FeatureApp);',
    'export default (OtherApp, FeatureApp);',
    'export { FeatureApp as default } from "./foreign";',
    'export type { FeatureApp as default };',
    'let MutableApp = FeatureApp; export default MutableApp;',
  ])('does not invent alias demands for %s', async (suffix) => {
    expect(await collectDemands(`${DECLARATIONS}\n${suffix}`)).toEqual(['default']);
  });

  it.each(DEFAULTS)('connects the actual named entry with %s', async (suffix) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fast-default-alias-corridor-'));
    temporaryRoots.push(root);
    await mkdir(path.join(root, 'src'));
    const target = path.join(root, 'src/app.tsx');
    const entry = path.join(root, 'src/main.tsx');
    const sources: Readonly<Record<string, string>> = {
      [target]: `${DECLARATIONS}\n${suffix}`,
      [entry]: [
        "import { createRoot } from 'react-dom/client';",
        "import { FeatureApp } from './app';",
        'createRoot(document.body).render(<FeatureApp />);',
      ].join('\n'),
    };
    await Promise.all(Object.entries(sources).map(([file, text]) => writeFile(file, text)));
    const corridor = await collectPreviewInspectorFastPageCorridor({
      additionalSourcePaths: Object.keys(sources),
      documentPath: target,
      projectRoot: root,
      readSource: (file) => readFile(file, 'utf8').catch(() => undefined),
      resolveModule: (specifier, importer) => {
        const candidate = `${path.resolve(path.dirname(importer), specifier)}.tsx`;
        return Object.hasOwn(sources, candidate) ? candidate : undefined;
      },
      targetExportName: 'default',
      workspaceRoot: root,
    });
    expect(corridor?.entryConnected).toBe(true);
    expect(corridor?.importPath).toEqual([entry, target]);
    expect(corridor?.truncated).toBe(false);
  });
});
