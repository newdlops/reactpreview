/**
 * Exercises custom React Context recovery through the complete Page Inspector compiler boundary.
 * The fixture mirrors a common application shape: a target is wrapped by an imported permission
 * HOC, while that helper consumes a null-default Context through a project-owned hook.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler custom Context fallback', () => {
  /**
   * Keeps the required root fallback when a nested destructured value later uses an optional map.
   * The optional receiver remains absent so the generated fallback preserves that short circuit
   * instead of inventing partner values or executing the map callback.
   */
  it('rewrites a null custom Context consumed inside an imported page HOC', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/context-fallback-compiler-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const contextPath = path.join(sourceDirectory, 'app-context.tsx');
    const permissionPath = path.join(sourceDirectory, 'with-page-permission.tsx');
    const targetPath = path.join(sourceDirectory, 'PermissionPage.tsx');
    const targetSource = [
      "import { withPagePermission } from './with-page-permission';",
      'function PermissionPage({ allowed }) {',
      '  return <main data-allowed={allowed}>PERMISSION_PAGE_MARKER</main>;',
      '}',
      'export default withPagePermission(PermissionPage);',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          contextPath,
          [
            "import { createContext, useContext } from 'react';",
            'const AppContext = createContext(null);',
            'export const useAppContext = () => useContext(AppContext);',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          permissionPath,
          [
            "import { useAppContext } from './app-context';",
            'export function withPagePermission(WrappedPage) {',
            '  return function PageComponent() {',
            '    const {',
            '      isStaffMode,',
            '      user: { isStaff, isLegalPartnerStaff, legalPartner },',
            '    } = useAppContext();',
            '    const permissionSet = new Set(',
            '      legalPartner?.permissionTypes.map((permission) => permission.value),',
            '    );',
            '    const allowed =',
            '      isStaffMode || isStaff || !isLegalPartnerStaff || permissionSet.size === 0;',
            '    return <WrappedPage allowed={allowed} />;',
            '  };',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(targetPath, targetSource, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText: targetSource,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('PERMISSION_PAGE_MARKER');
      expect(javascript).toMatch(/useAppContext\(\)\s*\?\?\s*__reactPreviewContextHookFallback/u);
      expect(javascript).toContain('"user": Object.freeze');
      expect(javascript).not.toContain('"legalPartner": Object.freeze');
      expect(javascript).not.toContain('"permissionTypes": Object.freeze');
      expect(javascript).toContain('registerPreviewContextIdentity');
      expect(javascript).toContain('registerPreviewContextRequirement');
      expect(javascript).toContain('createContextPreviewElement');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([contextPath, permissionPath, targetPath]),
      );
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
