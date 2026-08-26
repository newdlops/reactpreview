import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('EsbuildPreviewCompiler neural dependency hints', () => {
  /** Rebuilds once with an explicit server contract instead of requiring its absent SDK graph. */
  it('connects a compile-stage neural facade hint to the real bundler', async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-neural-compile-')),
    );
    temporaryRoots.push(fixtureRoot);
    const projectRoot = path.join(fixtureRoot, 'project');
    const targetPath = path.join(projectRoot, 'Target.tsx');
    const testPath = path.join(projectRoot, 'Target.test.tsx');
    const serverPath = path.join(projectRoot, 'server.ts');
    await mkdir(projectRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({
          dependencies: {
            'missing-server-sdk': '1.0.0',
            next: '16.3.0',
            react: '19.2.7',
            'react-dom': '19.2.7',
          },
          name: 'neural-dependency-hint-fixture',
          version: '1.0.0',
        }),
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; import { Client } from "missing-server-sdk"; export const loadLabel = () => new Client();',
        'utf8',
      ),
      writeFile(
        targetPath,
        'import { loadLabel } from "./server"; export default async function Target() { return <main>{String(await loadLabel())}</main>; }',
        'utf8',
      ),
      writeFile(
        testPath,
        'import { loadLabel } from "./server"; import { vi } from "vitest"; vi.mocked(loadLabel).mockResolvedValue("Learned server label");',
        'utf8',
      ),
    ]);
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      managedDependencyStoreRoot: path.join(fixtureRoot, 'global-storage'),
    });

    try {
      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        preparationMode: 'fast',
        sourceText: await readFile(targetPath, 'utf8'),
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });

      expect(bundle.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
        'neural dependency hint',
      );
      expect(bundle.dependencies).toContain(serverPath);
      expect(bundle.dependencies).toContain(testPath);
      expect(new TextDecoder().decode(bundle.javascript)).toContain('Learned server label');
      await expect(readFile(path.join(projectRoot, 'node_modules'))).rejects.toThrow();
    } finally {
      await compiler.shutdown();
    }
  }, 15_000);

  /** Uses a narrow package contract instead of downloading an unneeded server logging closure. */
  it('cooperates on an unmarked pino wrapper through the real compiler retry', async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'react-preview-neural-package-')),
    );
    temporaryRoots.push(fixtureRoot);
    const projectRoot = path.join(fixtureRoot, 'project');
    const targetPath = path.join(projectRoot, 'Target.tsx');
    const loggerPath = path.join(projectRoot, 'logger.ts');
    await mkdir(projectRoot, { recursive: true });
    const manifest = {
      dependencies: {
        next: '16.3.0',
        pino: '10.3.1',
        react: '19.2.7',
        'react-dom': '19.2.7',
      },
      name: 'neural-package-contract-fixture',
      version: '1.0.0',
    };
    await Promise.all([
      writeFile(path.join(projectRoot, 'package.json'), JSON.stringify(manifest), 'utf8'),
      writeFile(
        path.join(projectRoot, 'package-lock.json'),
        JSON.stringify({
          lockfileVersion: 3,
          name: manifest.name,
          packages: {
            '': manifest,
            'node_modules/pino': {
              integrity:
                'sha512-r34yH/GlQpKZbU1BvFFqOjhISRo1MNx1tWYsYvmj6KIRHSPMT2+yHOEb1SG6NMvRoHRF0a07kCOox/9yakl1vg==',
              resolved: 'https://registry.npmjs.org/pino/-/pino-10.3.1.tgz',
              version: '10.3.1',
            },
          },
          requires: true,
          version: manifest.version,
        }),
        'utf8',
      ),
      writeFile(
        loggerPath,
        'import pino from "pino"; export const logger = pino({ level: process.env.LOG_LEVEL });',
        'utf8',
      ),
      writeFile(
        targetPath,
        'import { logger } from "./logger"; export default function Target() { logger.warn("preview"); return <main>Connected</main>; }',
        'utf8',
      ),
    ]);
    let acquisitionRequests = 0;
    const progressStages: string[] = [];
    const compiler = new EsbuildPreviewCompiler({
      bundledNodeModulesPath: path.resolve('node_modules'),
      lockedDependencyAcquirer: () => {
        acquisitionRequests += 1;
        return Promise.resolve(undefined);
      },
      managedDependencyStoreRoot: path.join(fixtureRoot, 'global-storage'),
    });

    try {
      const bundle = await compiler.compile(
        {
          dependencySnapshots: [],
          documentPath: targetPath,
          language: 'tsx',
          preparationMode: 'fast',
          renderMode: 'page-inspector',
          sourceText: await readFile(targetPath, 'utf8'),
          useStorybookPreview: false,
          workspaceRoot: projectRoot,
        },
        { reportProgress: (stage) => progressStages.push(stage) },
      );

      expect(bundle.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
        'cooperating deterministic and neural dependency hints',
      );
      expect(bundle.dependencies).toContain(loggerPath);
      expect(new TextDecoder().decode(bundle.javascript)).toContain('neutral dependency contract');
      expect(acquisitionRequests).toBe(0);
      expect(progressStages.filter((stage) => stage === 'discovering-components')).toHaveLength(1);
    } finally {
      await compiler.shutdown();
    }
  }, 15_000);
});
