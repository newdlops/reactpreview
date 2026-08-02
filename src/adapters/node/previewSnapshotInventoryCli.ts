/** Command-line entry point for two-pass confined snapshot inventory evidence. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewBuildRequest,
  PreviewResolutionConfinement,
  PreviewSourceLanguage,
} from '../../domain/preview';
import { EsbuildPreviewCompiler } from '../esbuild/esbuildPreviewCompiler';
import { freezePreviewSnapshotInventoryLineage } from './previewSnapshotInventoryLineage';

interface PreviewSnapshotInventoryArguments {
  readonly evidence: string;
  readonly resolutionConfinement: PreviewResolutionConfinement;
  readonly target: string;
  readonly tsconfig?: string;
  readonly workspace: string;
}

export async function runPreviewSnapshotInventoryCli(
  arguments_: readonly string[],
): Promise<number> {
  const values = parsePreviewSnapshotInventoryArguments(arguments_);
  const target = path.resolve(values.target);
  const sourceText = await readFile(target, 'utf8');
  const request: PreviewBuildRequest = Object.freeze({
    dependencySnapshots: Object.freeze([]),
    documentPath: target,
    language: inferLanguage(target),
    preparationMode: 'fast',
    renderMode: 'page-inspector',
    resolutionConfinement: values.resolutionConfinement,
    sourceText,
    ...(values.tsconfig === undefined ? {} : { tsconfigPath: path.resolve(values.tsconfig) }),
    useStorybookPreview: true,
    workspaceRoot: path.resolve(values.workspace),
  });
  const manifest = await freezePreviewSnapshotInventoryLineage({
    createCompiler: () => new EsbuildPreviewCompiler(),
    evidencePath: path.resolve(values.evidence),
    request,
  });
  process.stdout.write(
    `${JSON.stringify({
      counts: manifest.counts,
      inventoryDigest: manifest.inventoryDigest,
      requestDigest: manifest.requestDigest,
      routes: manifest.routes.length,
    })}\n`,
  );
  return 0;
}

export function parsePreviewSnapshotInventoryArguments(
  arguments_: readonly string[],
): PreviewSnapshotInventoryArguments {
  const values = new Map<string, string>();
  const approvedDependencyRoots: string[] = [];
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error(`Invalid snapshot inventory argument near ${name ?? '<missing>'}.`);
    }
    if (name === '--approved-dependency-root') {
      approvedDependencyRoots.push(value);
      continue;
    }
    if (
      ![
        '--confinement-policy-digest',
        '--dependency-view-digest',
        '--evidence',
        '--source-manifest-digest',
        '--source-root',
        '--target',
        '--tsconfig',
        '--workspace',
      ].includes(name)
    ) {
      throw new Error(`Unknown snapshot inventory argument: ${name}`);
    }
    if (values.has(name)) throw new Error(`Duplicate snapshot inventory argument: ${name}`);
    values.set(name, value);
  }
  for (const required of [
    '--confinement-policy-digest',
    '--dependency-view-digest',
    '--evidence',
    '--source-manifest-digest',
    '--source-root',
    '--target',
    '--workspace',
  ]) {
    if (!values.has(required)) throw new Error(`Missing snapshot inventory argument: ${required}`);
  }
  const normalizedRoots = approvedDependencyRoots.map((root) => path.resolve(root));
  if (normalizedRoots.length === 0 || new Set(normalizedRoots).size !== normalizedRoots.length) {
    throw new Error('Snapshot inventory dependency roots must be non-empty and unique.');
  }
  const tsconfig = values.get('--tsconfig');
  return Object.freeze({
    evidence: values.get('--evidence') ?? '',
    resolutionConfinement: Object.freeze({
      approvedDependencyRoots: Object.freeze([...normalizedRoots].sort()),
      dependencyViewDigest: values.get('--dependency-view-digest') ?? '',
      policyDigest: values.get('--confinement-policy-digest') ?? '',
      sourceManifestDigest: values.get('--source-manifest-digest') ?? '',
      sourceRoot: path.resolve(values.get('--source-root') ?? ''),
    }),
    target: values.get('--target') ?? '',
    ...(tsconfig === undefined ? {} : { tsconfig }),
    workspace: values.get('--workspace') ?? '',
  });
}

function inferLanguage(filePath: string): PreviewSourceLanguage {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jsx':
      return 'jsx';
    case '.js':
      return 'js';
    case '.tsx':
      return 'tsx';
    case '.ts':
      return 'ts';
    default:
      throw new Error(`Unsupported preview target extension: ${path.extname(filePath)}`);
  }
}
