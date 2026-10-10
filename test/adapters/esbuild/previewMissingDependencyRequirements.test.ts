/** Verifies that automatic acquisition accepts only declared unresolved npm package roots. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Message } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  collectPreviewDependencyResolutionPreflightMessages,
  collectPreviewMissingDependencyRequirements,
  createPreviewDependencyResolutionHintPlan,
  createPreviewRenderOnlyDependencyResolutionHintPlan,
  mergePreviewDependencyResolutionHintPlans,
  tryAcquirePreviewMissingDependencies,
} from '../../../src/adapters/esbuild/previewMissingDependencyRequirements';
import { PreviewDependencyResolutionNeuralModel } from '../../../src/adapters/esbuild/previewDependencyResolutionNeuralModel';
import type { PreviewDependencyProfile } from '../../../src/adapters/node/previewDependencyProfile';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

const PROFILE: PreviewDependencyProfile = {
  dependencyPaths: ['/workspace/package.json', '/workspace/package-lock.json'],
  fingerprint: 'profile',
  hasReusableLockEvidence: true,
  lockfileDigests: { 'package-lock.json': 'lock' },
  lockfileEvidenceStatus: 'reusable',
  manifestPath: '/workspace/package.json',
  requirementsByField: {
    dependencies: {
      '@mui/styled-engine': 'npm:@mui/styled-engine-sc@latest',
      '@scope/widget': '2.0.0',
      'aliased-package': 'npm:real-package@1.0.0',
      'bad-alias-path': 'npm:../real-package@1.0.0',
      'bad-alias-protocol': 'npm:real-package@workspace:*',
      'local-package': 'file:../local-package',
      'react-dom': '19.2.7',
    },
    devDependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  },
  schemaVersion: 2,
};

/** React-only manifest fixture modeling a generated package whose lock retains React DOM. */
const REACT_COMPANION_PROFILE: PreviewDependencyProfile = {
  ...PROFILE,
  requirementsByField: {
    dependencies: { react: 'latest' },
    devDependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
  },
};

describe('collectPreviewMissingDependencyRequirements', () => {
  /** Probes bounded authored TypeScript and CSS edges before the expensive native build. */
  it('preflights only unresolved bare dependencies, including stylesheet imports', async () => {
    const loggerPath = '/workspace/src/lib/logger.ts';
    const stylePath = '/workspace/src/app/globals.css';
    const sourceByPath = new Map([
      [
        loggerPath,
        'import pino from "pino"; import React from "react"; import path from "node:path";',
      ],
      [
        stylePath,
        '@import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";\n@import "tw-animate-css";',
      ],
    ]);

    const messages = await collectPreviewDependencyResolutionPreflightMessages({
      readSource: (sourcePath) => sourceByPath.get(sourcePath),
      resolveModule: (moduleSpecifier) =>
        moduleSpecifier === 'react' ? '/workspace/node_modules/react/index.js' : undefined,
      sourcePaths: [loggerPath, stylePath],
    });

    expect(messages.map((item) => ({ file: item.location?.file, text: item.text }))).toEqual([
      { file: loggerPath, text: 'Could not resolve "pino"' },
      {
        file: stylePath,
        text: 'Could not resolve "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"',
      },
      { file: stylePath, text: 'Could not resolve "tw-animate-css"' },
    ]);
  });

  /** Carries safe contracts forward while keeping speculative preflight off the network. */
  it('strips acquisition hints and merges render-only contracts without duplicates', async () => {
    const targetPath = '/workspace/src/app/page.tsx';
    const stylePath = '/workspace/src/app/globals.css';
    const acquisitionProfile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          'lucide-react': '0.575.0',
        },
      },
    };
    const acquisitionPlan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "lucide-react"', targetPath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile: acquisitionProfile },
        projectRoot: '/workspace',
        readSource: () =>
          'import { Star } from "lucide-react"; export default function Page() { return <Star />; }',
        targetPath,
        workspaceRoot: '/workspace',
      },
    );
    const styleProfile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          'tw-animate-css': '^1.4.0',
        },
      },
    };
    const stylePlan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "tw-animate-css"', stylePath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile: styleProfile },
        projectRoot: '/workspace',
        targetPath,
        workspaceRoot: '/workspace',
      },
    );

    const renderOnlyPlan = createPreviewRenderOnlyDependencyResolutionHintPlan(acquisitionPlan);
    const mergedPlan = mergePreviewDependencyResolutionHintPlans(
      mergePreviewDependencyResolutionHintPlans(renderOnlyPlan, stylePlan),
      stylePlan,
    );

    expect(acquisitionPlan.packageNames).toEqual(['lucide-react']);
    expect(renderOnlyPlan.packageNames).toEqual([]);
    expect(renderOnlyPlan.packageCandidates).toEqual([]);
    expect(mergedPlan.packageNames).toEqual([]);
    expect(mergedPlan.styleCandidates).toHaveLength(1);
    expect(mergedPlan.styleCandidates[0]?.moduleSpecifier).toBe('tw-animate-css');
  });

  /** Normalizes package subpaths and removes repeated build diagnostics. */
  it('collects declared package roots in stable order', () => {
    const result = collectPreviewMissingDependencyRequirements(
      [
        message('Could not resolve "react-dom/client"'),
        message('Could not resolve "@scope/widget/subpath"'),
        message('Could not resolve "react-dom/client"'),
      ],
      PROFILE,
    );

    expect(result).toEqual(['@scope/widget', 'react-dom']);
  });

  /** Uses explicit server evidence to cut a server dependency graph while connecting UI packages. */
  it('turns neural dependency judgment into facade and package hints', async () => {
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          '@prisma/client': '7.4.1',
          'lucide-react': '0.575.0',
          react: '19.2.3',
        },
      },
    };
    const serverPath = '/workspace/src/server.ts';
    const targetPath = '/workspace/src/Target.tsx';
    const plan = await createPreviewDependencyResolutionHintPlan(
      [
        messageAt('Could not resolve "@prisma/client"', serverPath),
        messageAt('Could not resolve "lucide-react"', targetPath),
        message('Could not resolve "react/jsx-runtime"'),
      ],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: (sourcePath) =>
          sourcePath === serverPath
            ? 'import "server-only"; import { Prisma } from "@prisma/client"; export const load = () => Prisma;'
            : undefined,
        targetPath,
        workspaceRoot: '/workspace',
      },
    );

    expect(plan.facadeSourcePaths).toEqual([serverPath]);
    expect(plan.packageNames).toEqual(['react', 'lucide-react']);
    expect(plan.packageNames).not.toContain('@prisma/client');
    expect(plan.facadeCandidates[0]?.score.action).toBe('facade-server-contract');
  });

  /** Attaches safe adjacent-test defaults to the exact server facade selected by build evidence. */
  it('learns stable server return contracts without treating the adjacent test as a page', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-hint-learning-'));
    const routeDirectory = path.join(projectRoot, 'src/app/(builder)/edit');
    const targetPath = path.join(routeDirectory, 'page.tsx');
    const testPath = path.join(routeDirectory, 'page.test.tsx');
    const serverPath = path.join(projectRoot, 'src/service.ts');
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          '@prisma/client': '7.4.1',
        },
      },
    };
    try {
      await mkdir(routeDirectory, { recursive: true });
      await Promise.all([
        writeFile(targetPath, 'export default async function Page() { return null; }', 'utf8'),
        writeFile(
          serverPath,
          'import "server-only"; import { Prisma } from "@prisma/client"; export const loadRows = async () => Prisma;',
          'utf8',
        ),
        writeFile(
          testPath,
          [
            "import { loadRows } from '../../service';",
            "import { vi } from 'vitest';",
            "vi.mocked(loadRows).mockResolvedValue({ rows: [], status: 'draft' } as Result);",
          ].join('\n'),
          'utf8',
        ),
      ]);

      const plan = await createPreviewDependencyResolutionHintPlan(
        [messageAt('Could not resolve "@prisma/client"', serverPath)],
        {
          environment: { identity: 'cold', nodeModulesPaths: [], profile },
          projectRoot,
          resolveModule: (moduleSpecifier) =>
            moduleSpecifier === '../../service' ? serverPath : undefined,
          targetPath,
          workspaceRoot: projectRoot,
        },
      );

      expect(plan.facadeCandidates).toHaveLength(1);
      expect(plan.facadeCandidates[0]).toMatchObject({
        contractExamples: [
          {
            evidenceSourcePath: testPath,
            exportName: 'loadRows',
            mode: 'resolved',
            sourcePath: serverPath,
            value: { rows: [], status: 'draft' },
          },
        ],
        evidenceSourcePaths: [testPath],
        sourcePath: canonicalizeExistingPath(serverPath),
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Preserves exact CSS edges so the bundler can fail softly after a package connection miss. */
  it('emits neural style-contract hints for declared stylesheet dependencies', async () => {
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          pretendard: '^1.3.9',
          'tw-animate-css': '^1.4.0',
        },
      },
    };
    const stylePath = '/workspace/src/app/globals.css';
    const plan = await createPreviewDependencyResolutionHintPlan(
      [
        messageAt(
          'Could not resolve "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"',
          stylePath,
        ),
        messageAt('Could not resolve "tw-animate-css"', stylePath),
      ],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        targetPath: '/workspace/src/app/page.tsx',
        workspaceRoot: '/workspace',
      },
    );

    expect(
      plan.styleCandidates.map(({ moduleSpecifier, sourcePath }) => ({
        moduleSpecifier,
        sourcePath,
      })),
    ).toEqual([
      {
        moduleSpecifier: 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css',
        sourcePath: stylePath,
      },
      { moduleSpecifier: 'tw-animate-css', sourcePath: stylePath },
    ]);
    expect(
      plan.styleCandidates.every((candidate) => candidate.score.action === 'facade-style-contract'),
    ).toBe(true);
  });

  /** Preserves the target module while neutralizing only its unavailable server package edge. */
  it('keeps the selected target source and emits a narrow server-package contract', async () => {
    const targetPath = '/workspace/src/page.tsx';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          '@prisma/client': '7.4.1',
        },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "@prisma/client"', targetPath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () => 'import "server-only"; export default function Page() {}',
        targetPath,
        workspaceRoot: '/workspace',
      },
    );

    expect(plan.facadeSourcePaths).toEqual([]);
    expect(plan.packageNames).toEqual([]);
    expect(plan.packageContractCandidates).toHaveLength(1);
    expect(plan.packageContractCandidates[0]).toMatchObject({
      moduleSpecifier: '@prisma/client',
      sourcePath: targetPath,
    });
  });

  /** Bridges a server-affinity dependency when its wrapper omitted an explicit server marker. */
  it('lets deterministic evidence admit an unmarked pino edge for neural ranking', async () => {
    const loggerPath = '/workspace/src/lib/logger.ts';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          pino: '10.3.1',
        },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "pino"', loggerPath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () =>
          'import pino from "pino"; export const logger = pino({ level: process.env.LOG_LEVEL });',
        targetPath: '/workspace/src/app/page.tsx',
        workspaceRoot: '/workspace',
      },
    );

    expect(plan.facadeSourcePaths).toEqual([]);
    expect(plan.packageNames).toEqual([]);
    expect(plan.packageContractCandidates).toHaveLength(1);
    expect(plan.packageContractCandidates[0]).toMatchObject({
      moduleSpecifier: 'pino',
      packageName: 'pino',
      sourcePath: loggerPath,
    });
    expect(plan.packageContractCandidates[0]?.score.action).toBe('facade-package-contract');
  });

  /** Uses importer semantics rather than an ever-growing package-name exception list. */
  it('admits an unknown server runtime from exact source evidence', async () => {
    const loggerPath = '/workspace/src/lib/audit-logger.ts';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          'opaque-audit-runtime': '1.0.0',
        },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "opaque-audit-runtime"', loggerPath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () =>
          'import audit from "opaque-audit-runtime"; export const logger = audit(process.env.AUDIT_LEVEL);',
        targetPath: '/workspace/src/app/page.tsx',
        workspaceRoot: '/workspace',
      },
    );

    expect(plan.packageNames).toEqual([]);
    expect(plan.packageContractCandidates).toHaveLength(1);
    expect(plan.packageContractCandidates[0]).toMatchObject({
      moduleSpecifier: 'opaque-audit-runtime',
      sourcePath: loggerPath,
    });
  });

  /** Keeps archive acquisition locked down while allowing a declared render-only contract. */
  it('does not require reusable lock evidence for a manifest-proven package contract', async () => {
    const loggerPath = '/workspace/src/lib/logger.ts';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      dependencyPaths: ['/workspace/package.json'],
      hasReusableLockEvidence: false,
      lockfileDigests: {},
      lockfileEvidenceStatus: 'absent',
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          pino: '10.3.1',
        },
      },
    };
    const errors = [messageAt('Could not resolve "pino"', loggerPath)];
    const plan = await createPreviewDependencyResolutionHintPlan(errors, {
      environment: { identity: 'manifest-only', nodeModulesPaths: [], profile },
      projectRoot: '/workspace',
      readSource: () => 'import pino from "pino"; export const logger = pino();',
      targetPath: '/workspace/src/app/page.tsx',
      workspaceRoot: '/workspace',
    });

    expect(collectPreviewMissingDependencyRequirements(errors, profile)).toEqual([]);
    expect(plan.packageNames).toEqual([]);
    expect(plan.packageContractCandidates).toHaveLength(1);
  });

  /** Requires server-side importer evidence before an opaque target dependency can be neutralized. */
  it('keeps an unknown visual target package on the acquisition path', async () => {
    const targetPath = '/workspace/src/app/page.tsx';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          'opaque-visual-runtime': '1.0.0',
        },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "opaque-visual-runtime"', targetPath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () =>
          'import Widget from "opaque-visual-runtime"; export default function Page() { return <Widget />; }',
        targetPath,
        workspaceRoot: '/workspace',
      },
    );

    expect(plan.packageContractCandidates).toEqual([]);
    expect(plan.packageNames).toEqual(['opaque-visual-runtime']);
  });

  /** A server-sounding folder alone (`api/`, `services/`) must not neutralize a browser library. */
  it('acquires first and keeps only a fallback contract for path-only server evidence', async () => {
    const clientPath = '/workspace/src/api/client.ts';
    const formatPath = '/workspace/src/services/format.ts';
    const envPath = '/workspace/src/api/env.ts';
    const sourceByPath = new Map([
      [
        clientPath,
        'import axios from "axios"; export const api = axios.create({ baseURL: "/v1" });',
      ],
      [formatPath, 'import { get } from "lodash"; export const read = get;'],
      [envPath, 'import qs from "qs"; export const query = qs.stringify(process.env.FILTER);'],
    ]);
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          axios: '1.7.9',
          lodash: '4.17.21',
          qs: '6.13.0',
        },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [
        messageAt('Could not resolve "axios"', clientPath),
        messageAt('Could not resolve "lodash"', formatPath),
        messageAt('Could not resolve "qs"', envPath),
      ],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: (sourcePath) => sourceByPath.get(sourcePath),
        targetPath: '/workspace/src/pages/InventoryPage.tsx',
        workspaceRoot: '/workspace',
      },
    );

    expect([...plan.packageNames].sort()).toEqual(['axios', 'lodash']);
    expect(
      plan.packageContractCandidates.map(({ fallbackOnly, packageName }) => ({
        fallbackOnly,
        packageName,
      })),
    ).toEqual(
      expect.arrayContaining([
        { fallbackOnly: true, packageName: 'axios' },
        { fallbackOnly: true, packageName: 'lodash' },
        { fallbackOnly: undefined, packageName: 'qs' },
      ]),
    );
    expect(plan.packageContractCandidates).toHaveLength(3);
    // The first build must fail on these edges so acquisition can run; a private env read is strong.
    expect(
      createPreviewRenderOnlyDependencyResolutionHintPlan(plan).packageContractCandidates.map(
        (candidate) => candidate.packageName,
      ),
    ).toEqual(['qs']);
  });

  /** Public build-time env names are client code; a private name still marks a server module. */
  it('acquires first for public process.env reads but not for private ones', async () => {
    const storePath = '/workspace/lib/store/store.ts';
    const clientPath = '/workspace/src/lib/apis/axiosInstance.ts';
    const middlewarePath = '/workspace/src/middleware.ts';
    const sourceByPath = new Map([
      [
        storePath,
        'import createSagaMiddleware from "redux-saga"; export const dev = process.env.NODE_ENV !== "production"; export const saga = createSagaMiddleware();',
      ],
      [
        clientPath,
        'import axios from "axios"; export const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_BASE_URL });',
      ],
      [
        middlewarePath,
        'import { jwtVerify } from "jose"; export const key = new TextEncoder().encode(process.env.JWT_SECRET); export const verify = jwtVerify;',
      ],
    ]);
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          axios: '1.7.9',
          jose: '5.9.6',
          'redux-saga': '1.3.0',
        },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [
        messageAt('Could not resolve "redux-saga"', storePath),
        messageAt('Could not resolve "axios"', clientPath),
        messageAt('Could not resolve "jose"', middlewarePath),
      ],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: (sourcePath) => sourceByPath.get(sourcePath),
        targetPath: '/workspace/src/pages/Home.tsx',
        workspaceRoot: '/workspace',
      },
    );

    expect([...plan.packageNames].sort()).toEqual(['axios', 'redux-saga']);
    expect(
      Object.fromEntries(
        plan.packageContractCandidates.map((candidate) => [
          candidate.packageName,
          candidate.fallbackOnly === true,
        ]),
      ),
    ).toEqual({ axios: true, jose: false, 'redux-saga': true });
  });

  /** Without lock evidence nothing can be acquired, so the path-only contract applies directly. */
  it('keeps a path-only contract when the lockfile cannot restore the package', async () => {
    const clientPath = '/workspace/src/api/client.ts';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      dependencyPaths: ['/workspace/package.json'],
      hasReusableLockEvidence: false,
      lockfileDigests: {},
      lockfileEvidenceStatus: 'absent',
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: { ...PROFILE.requirementsByField.dependencies, axios: '1.7.9' },
      },
    };
    const plan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "axios"', clientPath)],
      {
        environment: { identity: 'manifest-only', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () => 'import axios from "axios"; export const api = axios.create();',
        targetPath: '/workspace/src/pages/InventoryPage.tsx',
        workspaceRoot: '/workspace',
      },
    );

    expect(plan.packageNames).toEqual([]);
    expect(plan.packageContractCandidates).toHaveLength(1);
    expect(plan.packageContractCandidates[0]?.fallbackOnly).toBeUndefined();
    expect(
      createPreviewRenderOnlyDependencyResolutionHintPlan(plan).packageContractCandidates,
    ).toHaveLength(1);
  });

  /** Lets verified model history switch a safe candidate from contract fallback to acquisition. */
  it('changes strategy when neural outcomes outweigh close deterministic preferences', async () => {
    const loggerPath = '/workspace/src/lib/logger.ts';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          pino: '10.3.1',
        },
      },
    };
    const model = new PreviewDependencyResolutionNeuralModel();
    const features = {
      declaredPackageRatio: 1,
      errorDensity: 1 / 12,
      explicitServerBoundary: 0,
      frameworkRuntime: 0,
      jsxConsumer: 0,
      packageCoreRuntime: 0,
      packageServerAffinity: 1,
      packageUiAffinity: 0,
      styleConsumer: 0,
      targetModule: 0,
      useServerDirective: 0,
    };
    const contractScore = model.score('facade-package-contract', features, 0.98);
    const acquisitionScore = model.score('acquire-package', features, 0.58);
    for (let index = 0; index < 100; index += 1) {
      model.recordOutcome(contractScore, false);
      model.recordOutcome(acquisitionScore, true);
    }

    const plan = await createPreviewDependencyResolutionHintPlan(
      [messageAt('Could not resolve "pino"', loggerPath)],
      {
        environment: { identity: 'cold', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () =>
          'import pino from "pino"; export const logger = pino({ level: process.env.LOG_LEVEL });',
        targetPath: '/workspace/src/app/page.tsx',
        workspaceRoot: '/workspace',
      },
      model,
    );

    expect(plan.packageContractCandidates).toEqual([]);
    expect(plan.packageNames).toEqual(['pino']);
  });

  /** Admits only complete npm aliases, including a scoped real package and authored alias slot. */
  it('collects strict npm alias declarations', () => {
    const result = collectPreviewMissingDependencyRequirements(
      [
        message('Could not resolve "aliased-package/subpath"'),
        message('Could not resolve "@mui/styled-engine"'),
      ],
      PROFILE,
    );

    expect(result).toEqual(['@mui/styled-engine', 'aliased-package']);
  });

  /** Keeps malformed aliases, local files, built-ins, URLs, and undeclared typos off the network. */
  it('rejects every unresolved identity that lacks exact declaration evidence', () => {
    const result = collectPreviewMissingDependencyRequirements(
      [
        message('Could not resolve "./generated"'),
        message('Could not resolve "@/components/Button"'),
        message('Could not resolve "common/ui"'),
        message('Could not resolve "fs/promises"'),
        message('Could not resolve "node:path"'),
        message('Could not resolve "https://example.com/module.js"'),
        message('Could not resolve "react-dom/client?worker"'),
        message('Could not resolve "react-dmo"'),
        message('Could not resolve "bad-alias-path"'),
        message('Could not resolve "bad-alias-protocol"'),
        message('Could not resolve "local-package"'),
      ],
      PROFILE,
    );

    expect(result).toEqual([]);
  });

  /** Disables acquisition when no reusable lock evidence exists. */
  it('requires reusable lock evidence', () => {
    expect(
      collectPreviewMissingDependencyRequirements([message('Could not resolve "react-dom"')], {
        ...PROFILE,
        hasReusableLockEvidence: false,
        lockfileEvidenceStatus: 'absent',
      }),
    ).toEqual([]);
  });

  /** Restores only the exact React DOM companion root proven by direct React and lock evidence. */
  it('collects an undeclared exact react-dom root for a direct registry React dependency', () => {
    expect(
      collectPreviewMissingDependencyRequirements(
        [message('Could not resolve "react-dom"')],
        REACT_COMPANION_PROFILE,
      ),
    ).toEqual(['react-dom']);
    expect(
      collectPreviewMissingDependencyRequirements(
        [message('Could not resolve "react-dom/client"')],
        REACT_COMPANION_PROFILE,
      ),
    ).toEqual([]);
  });

  /** Keeps local, development-only, and unrelated undeclared requirements outside the exception. */
  it('rejects unsafe or unrelated companion inference', () => {
    const localReactProfile: PreviewDependencyProfile = {
      ...REACT_COMPANION_PROFILE,
      requirementsByField: {
        ...REACT_COMPANION_PROFILE.requirementsByField,
        dependencies: { react: 'file:../react' },
      },
    };
    const developmentReactProfile: PreviewDependencyProfile = {
      ...REACT_COMPANION_PROFILE,
      requirementsByField: {
        ...REACT_COMPANION_PROFILE.requirementsByField,
        dependencies: {},
        devDependencies: { react: 'latest' },
      },
    };

    expect(
      collectPreviewMissingDependencyRequirements(
        [message('Could not resolve "react-dom"')],
        localReactProfile,
      ),
    ).toEqual([]);
    expect(
      collectPreviewMissingDependencyRequirements(
        [message('Could not resolve "react-dom"')],
        developmentReactProfile,
      ),
    ).toEqual([]);
    expect(
      collectPreviewMissingDependencyRequirements(
        [message('Could not resolve "react-dmo"')],
        REACT_COMPANION_PROFILE,
      ),
    ).toEqual([]);
  });

  /** Preserves caller cancellation instead of replacing it with the original missing-import error. */
  it('rethrows an acquisition failure when the active preview was cancelled', async () => {
    const controller = new AbortController();
    const cancellation = new Error('preview replaced');
    const acquisition = tryAcquirePreviewMissingDependencies({
      context: {
        environment: { identity: 'before-acquisition', nodeModulesPaths: [], profile: PROFILE },
        projectRoot: '/workspace',
        targetPath: '/workspace/Target.tsx',
        workspaceRoot: '/workspace',
      },
      errors: [message('Could not resolve "react-dom/client"')],
      signal: controller.signal,
      store: {
        acquireLockedDependencies: () => {
          controller.abort(cancellation);
          return Promise.reject(cancellation);
        },
        prepare: () => Promise.reject(new Error('Cancelled acquisition must not prepare.')),
      },
    });

    await expect(acquisition).rejects.toBe(cancellation);
  });

  /** Keeps registry or unsupported-lock failures recoverable when the preview remains current. */
  it('returns a miss for a non-cancellation acquisition failure', async () => {
    await expect(
      tryAcquirePreviewMissingDependencies({
        context: {
          environment: { identity: 'before-acquisition', nodeModulesPaths: [], profile: PROFILE },
          projectRoot: '/workspace',
          targetPath: '/workspace/Target.tsx',
          workspaceRoot: '/workspace',
        },
        errors: [message('Could not resolve "react-dom/client"')],
        signal: new AbortController().signal,
        store: {
          acquireLockedDependencies: () => Promise.reject(new Error('registry unavailable')),
          prepare: () => Promise.reject(new Error('Failed acquisition must not prepare.')),
        },
      }),
    ).resolves.toBeUndefined();
  });

  /** Keeps an exact CSS contract retry available when archive acquisition cannot publish a layer. */
  it('returns style hints after a recoverable package acquisition miss', async () => {
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: {
          ...PROFILE.requirementsByField.dependencies,
          pretendard: '^1.3.9',
        },
      },
    };
    const plan = await tryAcquirePreviewMissingDependencies({
      context: {
        environment: { identity: 'before-acquisition', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        targetPath: '/workspace/src/app/page.tsx',
        workspaceRoot: '/workspace',
      },
      errors: [
        messageAt(
          'Could not resolve "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"',
          '/workspace/src/app/globals.css',
        ),
      ],
      signal: new AbortController().signal,
      store: {
        acquireLockedDependencies: () => Promise.reject(new Error('archive exceeds safety limit')),
        prepare: () => Promise.reject(new Error('Failed acquisition must not prepare.')),
      },
    });

    expect(plan?.styleCandidates).toHaveLength(1);
    expect(plan?.styleCandidates[0]?.moduleSpecifier).toContain('pretendard');
  });

  /** A failed acquisition still leaves the path-only package's neutral contract for the retry. */
  it('requests a path-only package and keeps its contract when acquisition fails', async () => {
    const clientPath = '/workspace/src/api/client.ts';
    const profile: PreviewDependencyProfile = {
      ...PROFILE,
      requirementsByField: {
        ...PROFILE.requirementsByField,
        dependencies: { ...PROFILE.requirementsByField.dependencies, axios: '1.7.9' },
      },
    };
    const requested: string[][] = [];
    const plan = await tryAcquirePreviewMissingDependencies({
      context: {
        environment: { identity: 'before-acquisition', nodeModulesPaths: [], profile },
        projectRoot: '/workspace',
        readSource: () => 'import axios from "axios"; export const api = axios.create();',
        targetPath: '/workspace/src/pages/InventoryPage.tsx',
        workspaceRoot: '/workspace',
      },
      errors: [messageAt('Could not resolve "axios"', clientPath)],
      signal: new AbortController().signal,
      store: {
        acquireLockedDependencies: (options) => {
          requested.push([...options.requiredPackageNames]);
          return Promise.resolve(false);
        },
        prepare: () => Promise.reject(new Error('Failed acquisition must not prepare.')),
      },
    });

    expect(requested).toEqual([['axios']]);
    expect(plan?.packageContractCandidates).toEqual([
      expect.objectContaining({ fallbackOnly: true, packageName: 'axios', sourcePath: clientPath }),
    ]);
  });

  /** Avoids an expensive rebuild when acquisition published no new resolution environment. */
  it('returns a miss when the acquired layer was already selected', async () => {
    let progressReports = 0;
    await expect(
      tryAcquirePreviewMissingDependencies({
        context: {
          environment: { identity: 'unchanged', nodeModulesPaths: [], profile: PROFILE },
          projectRoot: '/workspace',
          reportAcquisition: () => {
            progressReports += 1;
          },
          targetPath: '/workspace/Target.tsx',
          workspaceRoot: '/workspace',
        },
        errors: [message('Could not resolve "react-dom/client"')],
        signal: new AbortController().signal,
        store: {
          acquireLockedDependencies: () => Promise.resolve(true),
          prepare: () =>
            Promise.resolve({ identity: 'unchanged', nodeModulesPaths: [], profile: PROFILE }),
        },
      }),
    ).resolves.toBeUndefined();
    expect(progressReports).toBe(1);
  });
});

/** Creates the subset of esbuild Message used by the pure diagnostic parser. */
function message(text: string): Message {
  return {
    detail: undefined,
    id: '',
    location: null,
    notes: [],
    pluginName: '',
    text,
  };
}

/** Adds one file-backed location to an unresolved-module fixture diagnostic. */
function messageAt(text: string, file: string): Message {
  return {
    ...message(text),
    location: {
      column: 0,
      file,
      length: 1,
      line: 1,
      lineText: '',
      namespace: 'file',
      suggestion: '',
    },
  };
}
