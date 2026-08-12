/** Fixed real-compiler fixture for cold fast Page Inspector build measurements. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { EsbuildPreviewCompiler } from '../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = process.cwd();

const REQUIRED_MARKERS = [
  'COLD_LAYOUT_MARKER',
  'COLD_CHROME_MARKER',
  'COLD_SELECTED_PAGE_MARKER',
  'COLD_TARGET_MARKER',
] as const;
const FORBIDDEN_MARKERS = ['COLD_INACTIVE_ROUTE_MARKER', 'COLD_UNUSED_MARKER'] as const;

/** Writes one fixture module and returns its absolute path. */
async function writeSource(
  rootPath: string,
  relativePath: string,
  sourceText: string,
): Promise<string> {
  const sourcePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, sourceText, 'utf8');
  return sourcePath;
}

/** Creates the same shallow authored page shell for every isolated process sample. */
async function createFixture(): Promise<{
  readonly rootPath: string;
  readonly targetPath: string;
  readonly targetSource: string;
}> {
  const rootPath = await mkdtemp(
    path.join(REPOSITORY_ROOT, 'test/fixtures/react-preview-cold-page-inspector-'),
  );
  const componentSources = Array.from({ length: 32 }, (_, index) => {
    const name = `ChromePart${index.toString()}`;
    return {
      name,
      relativePath: `src/chrome/${name}.tsx`,
      sourceText: `export default function ${name}() { return <span>COLD_CHROME_PART_${index.toString()}</span>; }`,
    };
  });
  const targetSource =
    'export default function Target() { return <article>COLD_TARGET_MARKER</article>; }';
  await Promise.all([
    writeFile(
      path.join(rootPath, 'package.json'),
      '{"private":true,"dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}',
      'utf8',
    ),
    writeSource(
      rootPath,
      'node_modules/react/package.json',
      '{"name":"react","version":"19.0.0","exports":{".":"./index.js","./jsx-dev-runtime":"./jsx-dev-runtime.js","./jsx-runtime":"./jsx-runtime.js"}}',
    ),
    writeSource(
      rootPath,
      'node_modules/react/index.js',
      'export const createElement = (type, props) => ({ type, props }); export default { createElement };',
    ),
    writeSource(
      rootPath,
      'node_modules/react/jsx-dev-runtime.js',
      'export const Fragment = Symbol.for("react.fragment"); export const jsxDEV = (type, props) => ({ type, props });',
    ),
    writeSource(
      rootPath,
      'node_modules/react/jsx-runtime.js',
      'export const Fragment = Symbol.for("react.fragment"); export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;',
    ),
    writeSource(
      rootPath,
      'node_modules/react-dom/package.json',
      '{"name":"react-dom","version":"19.0.0","exports":{".":"./index.js","./client":"./client.js"}}',
    ),
    writeSource(
      rootPath,
      'node_modules/react-dom/index.js',
      'export const createPortal = (value) => value; export default { createPortal };',
    ),
    writeSource(
      rootPath,
      'node_modules/react-dom/client.js',
      'export const createRoot = () => ({ render() {} });',
    ),
    writeSource(
      rootPath,
      'src/main.tsx',
      "import { createRoot } from 'react-dom/client'; import App from './App'; createRoot(document.body).render(<App />);",
    ),
    writeSource(
      rootPath,
      'src/App.tsx',
      "import RootLayout from './RootLayout'; import Inactive from './Inactive'; export default function App() { return <RootLayout />; } export const inactive = Inactive;",
    ),
    writeSource(
      rootPath,
      'src/Inactive.tsx',
      'export default function Inactive() { return <aside>COLD_INACTIVE_ROUTE_MARKER</aside>; }',
    ),
    writeSource(
      rootPath,
      'src/Unused.tsx',
      'export default function Unused() { return <aside>COLD_UNUSED_MARKER</aside>; }',
    ),
    writeSource(
      rootPath,
      'src/SelectedPage.tsx',
      "import Target from './Target'; export default function SelectedPage() { return <main>COLD_SELECTED_PAGE_MARKER<Target /></main>; }",
    ),
    writeSource(rootPath, 'src/Target.tsx', targetSource),
    writeSource(
      rootPath,
      'src/RootLayout.tsx',
      [
        ...componentSources.map(
          (component) => `import ${component.name} from './chrome/${component.name}';`,
        ),
        "import SelectedPage from './SelectedPage';",
        "import Unused from './Unused';",
        'export default function RootLayout() { return <div>COLD_LAYOUT_MARKER<header>COLD_CHROME_MARKER</header>',
        ...componentSources.map((component) => `<${component.name} />`),
        '<SelectedPage /></div>; }',
        'export const unused = Unused;',
      ].join('\n'),
    ),
    ...componentSources.map((component) =>
      writeSource(rootPath, component.relativePath, component.sourceText),
    ),
  ]);
  return { rootPath, targetPath: path.join(rootPath, 'src/Target.tsx'), targetSource };
}

/** Runs exactly one fresh-compiler compile; fixture setup and shutdown are outside the timer. */
export async function runPageInspectorColdBuildFixture(): Promise<number> {
  const fixture = await createFixture();
  const compiler = new EsbuildPreviewCompiler();
  try {
    const startedAt = performance.now();
    const bundle = await compiler.compile({
      dependencySnapshots: [],
      documentPath: fixture.targetPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText: fixture.targetSource,
      useStorybookPreview: false,
      workspaceRoot: fixture.rootPath,
    });
    const durationMs = performance.now() - startedAt;
    const artifact = Buffer.concat([
      Buffer.from(bundle.javascript),
      ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
    ]).toString('utf8');
    const errors = bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (errors.length > 0) throw new Error(errors.map((error) => error.message).join('\n'));
    if (REQUIRED_MARKERS.some((marker) => !artifact.includes(marker))) {
      throw new Error('Cold fixture omitted a required Page Inspector artifact marker.');
    }
    if (FORBIDDEN_MARKERS.some((marker) => artifact.includes(marker))) {
      throw new Error('Cold fixture emitted an inactive or unused artifact marker.');
    }
    return durationMs;
  } finally {
    await compiler.shutdown();
    await rm(fixture.rootPath, { force: true, recursive: true });
  }
}

/** Profiles one real target without including harness bundling or fixture setup in the duration. */
export async function runPageInspectorTargetColdBuild(
  targetPath: string,
  workspaceRoot: string,
): Promise<{
  readonly activities: readonly unknown[];
  readonly bundleBytes: number;
  readonly chunkCount: number;
  readonly durationMs: number;
  readonly stages: Readonly<Record<string, number>>;
}> {
  const sourceText = await readFile(targetPath, 'utf8');
  const compiler = new EsbuildPreviewCompiler();
  const startedAt = performance.now();
  const stages: Record<string, number> = {};
  const activities: unknown[] = [];
  try {
    const bundle = await compiler.compile(
      {
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText,
        useStorybookPreview: true,
        workspaceRoot,
      },
      {
        reportProgress: (stage, activity) => {
          stages[stage] ??= performance.now() - startedAt;
          if (activity !== undefined) activities.push(activity);
        },
      },
    );
    const errors = bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (errors.length > 0) throw new Error(errors.map((error) => error.message).join('\n'));
    return {
      activities: Object.freeze([...activities]),
      bundleBytes:
        bundle.javascript.byteLength +
        bundle.chunks.reduce((total, chunk) => total + chunk.contents.byteLength, 0),
      chunkCount: bundle.chunks.length,
      durationMs: performance.now() - startedAt,
      stages: Object.freeze({ ...stages }),
    };
  } finally {
    await compiler.shutdown();
  }
}
