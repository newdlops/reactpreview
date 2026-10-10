/** Verifies that explicit server modules doing host I/O become render-only contracts before bundling. */
import { describe, expect, it } from 'vitest';
import { collectPreviewHostIoServerSourcePaths } from '../../../src/adapters/esbuild/previewHostIoServerModules';
import { createPreviewDependencyResolutionHintPlan } from '../../../src/adapters/esbuild/previewMissingDependencyRequirements';
import type { PreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';

const TARGET_PATH = '/workspace/src/app/login/page.tsx';
const SOURCES: Readonly<Record<string, string>> = {
  '/workspace/src/lib/browser-fs.ts': "import fs from 'fs'; export const read = () => fs;",
  '/workspace/src/modules/actions.ts':
    "'use server';\nimport { execFile } from 'node:child_process';\nexport async function run() { execFile('ls'); }",
  '/workspace/src/modules/format.ts':
    "import 'server-only';\nimport path from 'node:path';\nexport const name = (file: string) => path.basename(file);",
  '/workspace/src/modules/markdown.ts': [
    "import 'server-only';",
    "import { readFile } from 'node:fs/promises';",
    "import { parse } from 'kordoc';",
    'export const convert = async (file: string) => parse(await readFile(file));',
  ].join('\n'),
  '/workspace/src/modules/types.ts':
    "import 'server-only';\nimport type { Stats } from 'node:fs';\nexport type Entry = Stats;",
  [TARGET_PATH]:
    "import 'server-only';\nimport fs from 'fs';\nexport default function Page() { return fs; }",
};

const PROFILE: PreviewDependencyProfile = {
  dependencyPaths: ['/workspace/package.json'],
  fingerprint: 'profile',
  hasReusableLockEvidence: false,
  lockfileDigests: {},
  lockfileEvidenceStatus: 'absent',
  manifestPath: '/workspace/package.json',
  requirementsByField: {
    dependencies: { kordoc: '4.7.1' },
    devDependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  },
  schemaVersion: 2,
};

describe('collectPreviewHostIoServerSourcePaths', () => {
  /** Only explicit server modules with a runtime host I/O import qualify; the target never does. */
  it('selects explicit server modules that import filesystem or process built-ins', async () => {
    const paths = await collectPreviewHostIoServerSourcePaths({
      readSource: (sourcePath) => SOURCES[sourcePath],
      sourcePaths: Object.keys(SOURCES),
      targetPath: TARGET_PATH,
    });

    expect(paths).toEqual([
      '/workspace/src/modules/actions.ts',
      '/workspace/src/modules/markdown.ts',
    ]);
  });
});

describe('createPreviewDependencyResolutionHintPlan host I/O admission', () => {
  /** No missing package is needed: the module is contracted, and nothing is acquired. */
  it('adds host I/O server modules as scored facade candidates', async () => {
    const plan = await createPreviewDependencyResolutionHintPlan(
      [],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile: PROFILE },
        projectRoot: '/workspace',
        readSource: (sourcePath) => SOURCES[sourcePath],
        targetPath: TARGET_PATH,
        workspaceRoot: '/workspace',
      },
      undefined,
      ['/workspace/src/modules/markdown.ts', '/workspace/src/lib/browser-fs.ts', TARGET_PATH],
    );

    expect(plan.facadeSourcePaths).toEqual(['/workspace/src/modules/markdown.ts']);
    expect(plan.facadeCandidates[0]?.score.action).toBe('facade-server-contract');
    expect(plan.packageNames).toEqual([]);
  });
});
