/** Proves hook-only editor modules mount the real generic React page that consumes their JSX. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler generic hook module context', () => {
  /** Recovers a page even when target export selection excludes both a hook and data constant. */
  it('mounts a consuming authored page for a hook-returned JSX callback', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/hook-module-context-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const pageDirectory = path.join(sourceDirectory, 'pages');
    const hookPath = path.join(sourceDirectory, 'use-phone-modal.tsx');
    const pagePath = path.join(pageDirectory, 'CompanyPage.tsx');
    const hookSource = [
      "export const COMPANY_PHONE_MUTATION = { kind: 'Document' } as const;",
      'export function useCompanyPhoneModal() {',
      "  return { renderModal: () => <aside data-hook='HOOK_MODAL'>phone</aside> };",
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();
    try {
      await mkdir(pageDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(hookPath, hookSource, 'utf8'),
        writeFile(
          pagePath,
          [
            "import { useCompanyPhoneModal } from '../use-phone-modal';",
            'export default function CompanyPage() {',
            '  const { renderModal } = useCompanyPhoneModal();',
            "  return <main data-page='GENERIC_HOOK_PAGE'>{renderModal()}</main>;",
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          path.join(sourceDirectory, 'main.tsx'),
          [
            "import { createRoot } from 'react-dom/client';",
            "import CompanyPage from './pages/CompanyPage';",
            'createRoot(document.body).render(<CompanyPage />);',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: hookPath,
        language: 'tsx',
        preparationMode: 'full',
        renderMode: 'page-inspector',
        sourceText: hookSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('GENERIC_HOOK_PAGE');
      expect(javascript).toContain('HOOK_MODAL');
      expect(javascript).toContain('import-chain');
      expect(javascript).toContain('The selected module participates in this authored page');
      expect(bundle.dependencies).toEqual(expect.arrayContaining([hookPath, pagePath]));
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
