/** Builds the isolated router fixture and decodes complete browser artifacts for compiler integration assertions. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type PreviewBundle } from '../../../src/domain/preview';

/** Decodes the entry and every local lazy chunk when assertions inspect the complete render graph. */
export function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}

/** Installs the smallest project-local React Router surface required by adaptive compiler tests. */
export async function installCompilerFakeRouterPackage(projectRoot: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules/react-router-dom');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ exports: './index.js', name: 'react-router-dom', type: 'module' }),
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      [
        'export function BrowserRouter({ children }) { return children; }',
        'export function MemoryRouter({ children }) { return children; }',
        "export function useLocation() { return { pathname: '/' }; }",
      ].join('\n'),
      'utf8',
    ),
  ]);
}
