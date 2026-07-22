/** Verifies deterministic Yarn v1/Berry closure planning without network or workspace writes. */
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readPreviewDependencyProfile,
  type PreviewDependencyProfile,
} from '../../../src/adapters/node/previewDependencyProfile';
import { createPreviewYarnLockPlan } from '../../../src/adapters/node/previewYarnLockPlan';

const temporaryRoots: string[] = [];
const SHA512_SRI = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('createPreviewYarnLockPlan', () => {
  /** Follows classic runtime edges, skips absent optional edges, and normalizes the public URL. */
  it('plans a Yarn v1 dependency closure from declared missing roots', async () => {
    const projectRoot = await createProject(
      { alpha: '^1.0.0' },
      classicLock([
        classicEntry('alpha@^1.0.0', 'alpha', '1.0.0', {
          dependencies: { bravo: '^2.0.0' },
          optionalDependencies: { absent: '^1.0.0' },
        }),
        classicEntry('bravo@^2.0.0', 'bravo', '2.1.0'),
      ]),
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['alpha'],
    });

    expect(plan).toEqual({
      entries: [
        {
          integrity: SHA512_SRI,
          packageName: 'alpha',
          resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz',
          targetRelativePath: 'alpha',
          version: '1.0.0',
        },
        {
          integrity: SHA512_SRI,
          packageName: 'bravo',
          resolved: 'https://registry.npmjs.org/bravo/-/bravo-2.1.0.tgz',
          targetRelativePath: 'bravo',
          version: '2.1.0',
        },
      ],
      flavor: 'classic',
    });
  });

  /** Seeds app-declared peers even when the selected package record contains no peer edge. */
  it('includes a direct project peer omitted from package lock metadata', async () => {
    const projectRoot = await createProject(
      { widget: '1.0.0' },
      classicLock([
        classicEntry('widget@1.0.0', 'widget', '1.0.0'),
        classicEntry('react@18.2.0', 'react', '18.2.0'),
      ]),
      { peerDependencies: { react: '18.2.0' } },
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['widget'],
    });

    expect(plan?.entries.map(({ targetRelativePath }) => targetRelativePath)).toEqual([
      'react',
      'widget',
    ]);
  });

  /** Skips unsupported supplemental protocols and leaves unrequested development roots inert. */
  it('skips non-public supplemental roots without weakening required-root validation', async () => {
    const projectRoot = await createProject(
      { 'file-helper': 'file:../file-helper', widget: '1.0.0' },
      [
        '__metadata:',
        '  version: 6',
        '',
        '"widget@npm:1.0.0":',
        '  version: 1.0.0',
        '  resolution: "widget@npm:1.0.0"',
        '  languageName: node',
        '  linkType: hard',
        '',
        '"@scope/local@workspace:packages/local":',
        '  version: 0.0.0-use.local',
        '  resolution: "@scope/local@workspace:packages/local"',
        '  languageName: unknown',
        '  linkType: soft',
        '',
        '"dev-tool@npm:1.0.0":',
        '  version: 1.0.0',
        '  resolution: "dev-tool@npm:1.0.0"',
        '  languageName: node',
        '  linkType: hard',
        '',
      ].join('\n'),
      {
        devDependencies: { 'dev-tool': '1.0.0' },
        optionalDependencies: { '@scope/local': 'workspace:packages/local' },
        peerDependencies: { 'git-helper': 'git+https://example.test/git-helper.git' },
      },
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['widget'],
    });

    expect(plan?.entries.map(({ targetRelativePath }) => targetRelativePath)).toEqual(['widget']);
  });

  /** Nests a conflicting version below its owner while hoisting the first compatible instance. */
  it('creates ordinary Node lookup slots for competing classic versions', async () => {
    const projectRoot = await createProject(
      { alpha: '1.0.0', beta: '1.0.0' },
      classicLock([
        classicEntry('alpha@1.0.0', 'alpha', '1.0.0', {
          dependencies: { shared: '^1.0.0' },
        }),
        classicEntry('beta@1.0.0', 'beta', '1.0.0', {
          dependencies: { shared: '^2.0.0' },
        }),
        classicEntry('shared@^1.0.0', 'shared', '1.5.0'),
        classicEntry('shared@^2.0.0', 'shared', '2.5.0'),
      ]),
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['alpha', 'beta'],
    });

    expect(
      plan?.entries.map(({ targetRelativePath, version }) => [targetRelativePath, version]),
    ).toEqual([
      ['alpha', '1.0.0'],
      ['beta', '1.0.0'],
      ['shared', '1.5.0'],
      ['beta/node_modules/shared', '2.5.0'],
    ]);
  });

  /** Keeps Berry aliases at their requested slot while retaining the archive's real package name. */
  it('plans exact Berry npm resolutions and defers archive integrity to metadata', async () => {
    const projectRoot = await createProject(
      { alias: 'npm:actual@^3.0.0' },
      [
        '__metadata:',
        '  version: 6',
        '  cacheKey: 8',
        '',
        '"alias@npm:actual@^3.0.0":',
        '  version: 3.2.1',
        '  resolution: "actual@npm:3.2.1"',
        '  dependencies:',
        '    child: ^1.0.0',
        '  checksum: abcdef',
        '  languageName: node',
        '  linkType: hard',
        '',
        '"child@npm:^1.0.0":',
        '  version: 1.4.0',
        '  resolution: "child@npm:1.4.0"',
        '  checksum: fedcba',
        '  languageName: node',
        '  linkType: hard',
        '',
      ].join('\n'),
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['alias'],
    });

    expect(plan).toEqual({
      entries: [
        {
          packageName: 'actual',
          targetRelativePath: 'alias',
          version: '3.2.1',
        },
        {
          packageName: 'child',
          targetRelativePath: 'child',
          version: '1.4.0',
        },
      ],
      flavor: 'berry',
    });
  });

  /** Keeps a classic npm alias in its authored slot while downloading the real package archive. */
  it('preserves classic alias placement and package identity', async () => {
    const projectRoot = await createProject(
      { alias: 'npm:actual@^3.0.0' },
      classicLock([classicEntry('alias@npm:actual@^3.0.0', 'actual', '3.2.1')]),
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['alias'],
    });

    expect(plan?.entries).toEqual([
      {
        integrity: SHA512_SRI,
        packageName: 'actual',
        resolved: 'https://registry.npmjs.org/actual/-/actual-3.2.1.tgz',
        targetRelativePath: 'alias',
        version: '3.2.1',
      },
    ]);
  });

  /** Resolves Berry virtual peer locators to their exact underlying public npm package. */
  it('unwraps a bounded Berry virtual locator', async () => {
    const projectRoot = await createProject(
      { widget: 'virtual:abcdef1234#npm:^2.0.0' },
      [
        '__metadata:',
        '  version: 6',
        '',
        '"widget@virtual:abcdef1234#npm:^2.0.0":',
        '  version: 2.4.0',
        '  resolution: "widget@virtual:abcdef1234#npm:2.4.0"',
        '  languageName: node',
        '  linkType: hard',
        '',
      ].join('\n'),
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['widget'],
    });

    expect(plan?.entries).toEqual([
      { packageName: 'widget', targetRelativePath: 'widget', version: '2.4.0' },
    ]);
  });

  /** Skips a missing Berry dependency only when dependenciesMeta proves that edge optional. */
  it('honors Berry optional dependency metadata', async () => {
    const projectRoot = await createProject(
      { alpha: '^1.0.0' },
      [
        '__metadata:',
        '  version: 6',
        '',
        '"alpha@npm:^1.0.0":',
        '  version: 1.0.0',
        '  resolution: "alpha@npm:1.0.0"',
        '  dependencies:',
        '    optional-child: ^2.0.0',
        '  dependenciesMeta:',
        '    optional-child:',
        '      optional: true',
        '  languageName: node',
        '  linkType: hard',
        '',
      ].join('\n'),
    );
    const profile = await requireProfile(projectRoot);

    const plan = await createPreviewYarnLockPlan({
      profile,
      projectRoot,
      requiredPackageNames: ['alpha'],
    });

    expect(plan?.entries).toEqual([
      { packageName: 'alpha', targetRelativePath: 'alpha', version: '1.0.0' },
    ]);
  });

  /** Rejects overlapping descriptor records even when name and version alone happen to match. */
  it('fails closed for competing metadata on the same classic descriptor', async () => {
    const projectRoot = await createProject(
      { alpha: '^1.0.0' },
      classicLock([
        classicEntry('alpha@^1.0.0, alpha@~1.0.0', 'alpha', '1.2.0'),
        classicEntry('alpha@^1.0.0', 'alpha', '1.2.0', {
          dependencies: { unexpected: '1.0.0' },
        }),
      ]),
    );
    const profile = await requireProfile(projectRoot);

    await expect(
      createPreviewYarnLockPlan({
        profile,
        projectRoot,
        requiredPackageNames: ['alpha'],
      }),
    ).resolves.toBeUndefined();
  });

  /** Rejects local workspace protocols because no public immutable archive proves their bytes. */
  it('fails closed for a Berry workspace package', async () => {
    const projectRoot = await createProject(
      { '@scope/local': 'workspace:packages/local' },
      [
        '__metadata:',
        '  version: 6',
        '',
        '"@scope/local@workspace:packages/local":',
        '  version: 0.0.0-use.local',
        '  resolution: "@scope/local@workspace:packages/local"',
        '  languageName: unknown',
        '  linkType: soft',
        '',
      ].join('\n'),
    );
    const profile = await requireProfile(projectRoot);

    await expect(
      createPreviewYarnLockPlan({
        profile,
        projectRoot,
        requiredPackageNames: ['@scope/local'],
      }),
    ).resolves.toBeUndefined();
  });

  /** Rejects manifest edits made after the compiler captured its dependency profile. */
  it('detects manifest evidence changing before acquisition', async () => {
    const projectRoot = await createProject(
      { alpha: '1.0.0' },
      classicLock([classicEntry('alpha@1.0.0', 'alpha', '1.0.0')]),
    );
    const profile = await requireProfile(projectRoot);
    await writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ dependencies: { alpha: '2.0.0' }, name: 'fixture', version: '1.0.0' }),
      'utf8',
    );

    await expect(
      createPreviewYarnLockPlan({
        profile,
        projectRoot,
        requiredPackageNames: ['alpha'],
      }),
    ).resolves.toBeUndefined();
  });

  /** Rejects same-shaped lock replacement after profile discovery using the captured digest. */
  it('detects lock evidence changing before acquisition', async () => {
    const projectRoot = await createProject(
      { alpha: '1.0.0' },
      classicLock([classicEntry('alpha@1.0.0', 'alpha', '1.0.0')]),
    );
    const profile = await requireProfile(projectRoot);
    await writeFile(
      path.join(projectRoot, 'yarn.lock'),
      classicLock([classicEntry('alpha@1.0.0', 'alpha', '1.0.1')]),
      'utf8',
    );

    await expect(
      createPreviewYarnLockPlan({
        profile,
        projectRoot,
        requiredPackageNames: ['alpha'],
      }),
    ).resolves.toBeUndefined();
  });
});

/** Creates one isolated project whose only install evidence is a Yarn lockfile. */
async function createProject(
  dependencies: Readonly<Record<string, string>>,
  lockText: string,
  additionalRequirements: {
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  } = {},
): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-yarn-plan-'));
  temporaryRoots.push(projectRoot);
  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies,
        ...additionalRequirements,
        name: 'fixture',
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(path.join(projectRoot, 'yarn.lock'), lockText, 'utf8'),
  ]);
  return projectRoot;
}

/** Requires the production profile reader to recognize the test lock evidence. */
async function requireProfile(projectRoot: string): Promise<PreviewDependencyProfile> {
  const profile = await readPreviewDependencyProfile(projectRoot);
  if (profile === undefined) throw new Error('Expected a dependency profile for the Yarn fixture.');
  return profile;
}

/** Serializes a minimal classic lock from independently inspectable entry strings. */
function classicLock(entries: readonly string[]): string {
  return ['# yarn lockfile v1', '', ...entries].join('\n');
}

/** Creates one classic public package entry with optional dependency maps. */
function classicEntry(
  descriptor: string,
  packageName: string,
  version: string,
  options: {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
  } = {},
): string {
  const lines = [
    `"${descriptor}":`,
    `  version "${version}"`,
    `  resolved "https://registry.yarnpkg.com/${packageName}/-/${packageName}-${version}.tgz#deadbeef"`,
    `  integrity ${SHA512_SRI}`,
  ];
  appendClassicMap(lines, 'dependencies', options.dependencies);
  appendClassicMap(lines, 'optionalDependencies', options.optionalDependencies);
  lines.push('');
  return lines.join('\n');
}

/** Appends one indented classic dependency map when a fixture needs it. */
function appendClassicMap(
  lines: string[],
  field: string,
  values: Readonly<Record<string, string>> | undefined,
): void {
  if (values === undefined) return;
  lines.push(`  ${field}:`);
  for (const [name, specifier] of Object.entries(values)) {
    lines.push(`    ${name} "${specifier}"`);
  }
}
