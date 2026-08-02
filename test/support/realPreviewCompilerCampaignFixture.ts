import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PreviewBuildRequest } from '../../src/domain/preview';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface RealPreviewCompilerCampaignFixture {
  readonly projectRoot: string;
  readonly request: PreviewBuildRequest;
}

/** Creates a real two-route compiler project for planner-to-campaign propagation coverage. */
export async function createRealPreviewCompilerCampaignFixture(): Promise<RealPreviewCompilerCampaignFixture> {
  const projectRoot = await mkdtemp(
    path.join(REPOSITORY_ROOT, 'test/fixtures/real-route-invariant-'),
  );
  const sourceDirectory = path.join(projectRoot, 'src');
  const routerDirectory = path.join(projectRoot, 'node_modules/react-router-dom');
  const documentPath = path.join(sourceDirectory, 'App.tsx');
  const firstPath = path.join(sourceDirectory, 'OptionOne.tsx');
  const secondPath = path.join(sourceDirectory, 'OptionTwo.tsx');
  const sourceText = `
    import { Route, Routes } from 'react-router-dom';
    import OptionOne from './OptionOne';
    import OptionTwo from './OptionTwo';
    export default function App() {
      return <Routes>
        <Route path="/option-one" element={<OptionOne />} />
        <Route path="/option-two" element={<OptionTwo />} />
      </Routes>;
    }
  `;
  const firstSource = 'export default function OptionOne() { return <main>one</main>; }';
  const secondSource = 'export default function OptionTwo() { return <main>two</main>; }';
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(routerDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      '{"private":true,"dependencies":{"react-router-dom":"6.30.1"}}',
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
    writeFile(documentPath, sourceText, 'utf8'),
    writeFile(firstPath, firstSource, 'utf8'),
    writeFile(secondPath, secondSource, 'utf8'),
  ]);
  return {
    projectRoot,
    request: Object.freeze({
      dependencySnapshots: Object.freeze([
        Object.freeze({
          documentPath: firstPath,
          language: 'tsx',
          sourceText: firstSource,
        }),
        Object.freeze({
          documentPath: secondPath,
          language: 'tsx',
          sourceText: secondSource,
        }),
      ]),
      documentPath,
      language: 'tsx',
      preparationMode: 'fast',
      renderMode: 'page-inspector',
      sourceText,
      workspaceRoot: projectRoot,
    }),
  };
}
