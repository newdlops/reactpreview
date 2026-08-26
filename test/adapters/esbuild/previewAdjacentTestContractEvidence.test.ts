import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewAdjacentTestContractEvidence } from '../../../src/adapters/esbuild/previewAdjacentTestContractEvidence';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('collectPreviewAdjacentTestContractEvidence', () => {
  /** Learns stable async and sync defaults without allowing a later scenario override to win. */
  it('collects complete imported mock values from a same-stem adjacent test', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-test-contract-'));
    temporaryRoots.push(projectRoot);
    const routeDirectory = path.join(projectRoot, 'src/app/(builder)/edit');
    const targetPath = path.join(routeDirectory, 'page.tsx');
    const testPath = path.join(routeDirectory, 'page.test.tsx');
    const servicePath = path.join(projectRoot, 'src/modules/service.ts');
    const tenantPath = path.join(projectRoot, 'src/lib/tenant.ts');
    await Promise.all([
      mkdir(routeDirectory, { recursive: true }),
      mkdir(path.dirname(servicePath), { recursive: true }),
      mkdir(path.dirname(tenantPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(targetPath, 'export default async function Page() { return null; }', 'utf8'),
      writeFile(
        servicePath,
        'export const loadRows = async () => []; export const getTheme = async () => null; export const isPublished = () => true; export const dynamicSession = async () => null;',
        'utf8',
      ),
      writeFile(tenantPath, 'export const requireOrg = async () => null;', 'utf8'),
      writeFile(
        testPath,
        [
          "import { loadRows as rows, getTheme, dynamicSession } from '@/modules/service';",
          "import { requireOrg } from '@/lib/tenant';",
          "import * as service from '@/modules/service';",
          "import { vi } from 'vitest';",
          "const ORG_ID = 'org-1';",
          'function mockSession(role: string, impersonation?: { canWrite: boolean }) {',
          '  vi.mocked(requireOrg).mockResolvedValue({',
          "    organization: { id: ORG_ID, slug: 'acme' },",
          '    role,',
          '    impersonation: impersonation ?? null,',
          '  } as Context);',
          '}',
          'beforeEach(() => {',
          "  mockSession('RECRUITER');",
          '  vi.mocked(rows).mockResolvedValue([]);',
          "  vi.mocked(getTheme).mockResolvedValue({ preset: 'minimal', columns: [1, 2] } as Theme);",
          '  vi.mocked(service.isPublished).mockReturnValue(false);',
          '  vi.mocked(dynamicSession).mockResolvedValue({ organization: { id: ORG_ID } });',
          '});',
          "it('overrides one scenario', () => { vi.mocked(rows).mockResolvedValue(['late']); });",
          "it('uses a lower role', () => { mockSession('MEMBER', { canWrite: false }); });",
          "it('uses one-shot data', () => { vi.mocked(rows).mockResolvedValueOnce(['once']); });",
        ].join('\n'),
        'utf8',
      ),
    ]);

    const examples = await collectPreviewAdjacentTestContractEvidence({
      projectRoot,
      resolveModule: (moduleSpecifier) => {
        if (moduleSpecifier === '@/modules/service') return servicePath;
        return moduleSpecifier === '@/lib/tenant' ? tenantPath : undefined;
      },
      targetPath,
    });

    expect(
      examples.map(({ evidenceSourcePath, exportName, mode, sourcePath, value }) => ({
        evidenceSourcePath,
        exportName,
        mode,
        sourcePath,
        value,
      })),
    ).toEqual([
      {
        evidenceSourcePath: testPath,
        exportName: 'loadRows',
        mode: 'resolved',
        sourcePath: servicePath,
        value: [],
      },
      {
        evidenceSourcePath: testPath,
        exportName: 'getTheme',
        mode: 'resolved',
        sourcePath: servicePath,
        value: { columns: [1, 2], preset: 'minimal' },
      },
      {
        evidenceSourcePath: testPath,
        exportName: 'isPublished',
        mode: 'returned',
        sourcePath: servicePath,
        value: false,
      },
      {
        evidenceSourcePath: testPath,
        exportName: 'dynamicSession',
        mode: 'resolved',
        sourcePath: servicePath,
        value: { organization: { id: 'org-1' } },
      },
      {
        evidenceSourcePath: testPath,
        exportName: 'requireOrg',
        mode: 'resolved',
        sourcePath: tenantPath,
        value: {
          impersonation: null,
          organization: { id: 'org-1', slug: 'acme' },
          role: 'RECRUITER',
        },
      },
    ]);
  });

  /** Ignores unrelated sibling stems while retaining the selected target's direct test contract. */
  it('reads the selected target stem beside the target or in its direct test directory', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-test-boundary-'));
    temporaryRoots.push(projectRoot);
    const routeDirectory = path.join(projectRoot, 'src/app/edit');
    const testsDirectory = path.join(routeDirectory, '__tests__');
    const targetPath = path.join(routeDirectory, 'page.tsx');
    const servicePath = path.join(projectRoot, 'src/service.ts');
    await Promise.all([
      mkdir(testsDirectory, { recursive: true }),
      mkdir(path.dirname(servicePath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(targetPath, 'export default function Page() { return null; }', 'utf8'),
      writeFile(servicePath, 'export const load = async () => null;', 'utf8'),
      writeFile(
        path.join(routeDirectory, 'other.test.tsx'),
        "import { load } from '../service'; vi.mocked(load).mockResolvedValue('wrong');",
        'utf8',
      ),
      writeFile(
        path.join(testsDirectory, 'page.spec.ts'),
        "import { load } from '../../service'; vi.mocked(load).mockResolvedValue('right');",
        'utf8',
      ),
    ]);

    const examples = await collectPreviewAdjacentTestContractEvidence({
      projectRoot,
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === '../../service' ? servicePath : undefined,
      targetPath,
    });

    expect(examples).toMatchObject([
      { exportName: 'load', mode: 'resolved', sourcePath: servicePath, value: 'right' },
    ]);
  });

  /** Learns route guard and session defaults from bounded ancestor layout/index tests. */
  it('collects App Router ancestor route-scope mocks in nearest-first order', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-layout-contract-'));
    temporaryRoots.push(projectRoot);
    const routeRoot = path.join(projectRoot, 'src/app');
    const routeGroup = path.join(routeRoot, '(admin)');
    const targetDirectory = path.join(routeGroup, 'admin/activity');
    const targetPath = path.join(targetDirectory, 'page.tsx');
    const layoutTestPath = path.join(routeGroup, 'layout.test.ts');
    const tenantPath = path.join(projectRoot, 'src/lib/tenant.ts');
    const adminPath = path.join(projectRoot, 'src/lib/admin.ts');
    const parentPageTestPath = path.join(routeGroup, 'admin/page.test.tsx');
    await Promise.all([
      mkdir(targetDirectory, { recursive: true }),
      mkdir(path.dirname(tenantPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(targetPath, 'export default async function Page() { return null; }', 'utf8'),
      writeFile(
        tenantPath,
        'export const getOrgSlug = async () => null; export const resolvePublicOrg = async () => null;',
        'utf8',
      ),
      writeFile(adminPath, 'export const requireAdminArea = async () => null;', 'utf8'),
      writeFile(
        parentPageTestPath,
        [
          "import { requireAdminArea } from '@/lib/admin';",
          "vi.mock('@/lib/admin', () => ({ requireAdminArea: vi.fn() }));",
          "vi.mocked(requireAdminArea).mockResolvedValue({ user: { role: 'SUPER_ADMIN' } });",
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        layoutTestPath,
        [
          "import { metadata } from './layout';",
          "vi.mock('@/lib/tenant', () => ({",
          '  getOrgSlug: vi.fn(),',
          '  resolvePublicOrg: vi.fn().mockResolvedValue(null),',
          '}));',
          "it('keeps metadata', () => expect(metadata).toBeDefined());",
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        path.join(routeGroup, 'unrelated.test.ts'),
        "vi.mock('@/lib/tenant', () => ({ getOrgSlug: vi.fn().mockResolvedValue('wrong') }));",
        'utf8',
      ),
    ]);

    const examples = await collectPreviewAdjacentTestContractEvidence({
      projectRoot,
      resolveModule: (moduleSpecifier) => {
        if (moduleSpecifier === '@/lib/tenant') return tenantPath;
        return moduleSpecifier === '@/lib/admin' ? adminPath : undefined;
      },
      targetPath,
    });

    expect(examples).toEqual([
      {
        evidenceSourcePath: parentPageTestPath,
        exportName: 'requireAdminArea',
        mode: 'resolved',
        sourcePath: adminPath,
        value: { user: { role: 'SUPER_ADMIN' } },
      },
      {
        evidenceSourcePath: layoutTestPath,
        exportName: 'getOrgSlug',
        mode: 'returned-undefined',
        sourcePath: tenantPath,
      },
      {
        evidenceSourcePath: layoutTestPath,
        exportName: 'resolvePublicOrg',
        mode: 'resolved',
        sourcePath: tenantPath,
        value: null,
      },
    ]);
  });
});
