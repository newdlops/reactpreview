/**
 * Supplies `@prisma/client` model and enum types to the type oracle when the project uses
 * `prisma-client-js` but its client was never generated (no `node_modules/.prisma/client`), as in a
 * checkout whose dependencies are not installed. The declaration is built from the project's own
 * schema and served only to the analysis program; no project file is created or changed.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  createPreviewPrismaClientDeclaration,
  parsePreviewPrismaSchema,
} from './typeOracle/previewPrismaSchemaDeclaration';

/** Module specifier the declaration answers. */
export const PREVIEW_PRISMA_CLIENT_SPECIFIER = '@prisma/client';

const PRISMA_CLIENT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']@prisma\/client["']/u;
const CONFIG_SCHEMA_PATTERN = /\bschema\s*:\s*["']([^"']+)["']/u;
const MAXIMUM_SCHEMA_FILES = 64;
const MAXIMUM_SCHEMA_BYTES = 4 * 1024 * 1024;
const MAXIMUM_CACHED_DECLARATIONS = 8;
const CONFIG_FILE_NAMES = [
  'prisma.config.ts',
  'prisma.config.mts',
  'prisma.config.js',
  'prisma.config.mjs',
];

/** One declaration module served to the analysis program instead of normal resolution. */
export interface PreviewVirtualTypeModule {
  /** Absolute virtual file path; nothing exists there on disk. */
  readonly path: string;
  /** Bare specifier whose imports resolve to this module. */
  readonly specifier: string;
  /** Declaration text with top-level exports. */
  readonly text: string;
}

/** Inputs for one build. */
export interface PreviewPrismaClientTypesOptions {
  /** Sources of the current build; one must import `@prisma/client`. */
  readonly frontierSourcePaths: readonly string[];
  readonly projectRoot: string;
  /** Snapshot-aware bounded source reader. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly workspaceRoot: string;
}

const declarationCache = new Map<string, string>();

/**
 * Builds the `@prisma/client` declaration for a build that needs one.
 *
 * @param options Frontier sources, project boundary, and a bounded reader.
 * @returns The virtual module, or `undefined` when the build does not import the client, the
 * generated client exists, no schema is found, or the schema uses a custom client output.
 */
export async function collectPreviewPrismaClientTypes(
  options: PreviewPrismaClientTypesOptions,
): Promise<PreviewVirtualTypeModule | undefined> {
  let imported = false;
  for (const sourcePath of options.frontierSourcePaths) {
    if (PRISMA_CLIENT_IMPORT_PATTERN.test((await options.readSource(sourcePath)) ?? '')) {
      imported = true;
      break;
    }
  }
  if (!imported || (await hasGeneratedClient(options.projectRoot, options.workspaceRoot))) {
    return undefined;
  }
  const schemaFiles = await findPreviewPrismaSchemaFiles(options.projectRoot);
  if (schemaFiles.length === 0) return undefined;
  const identity = JSON.stringify(schemaFiles.map((file) => [file.path, file.mtimeMs, file.size]));
  let text = declarationCache.get(identity);
  if (text === undefined) {
    const schema = parsePreviewPrismaSchema(
      (await Promise.all(schemaFiles.map((file) => readFile(file.path, 'utf8')))).join('\n'),
    );
    // A custom `output` moves the client away from `@prisma/client`; imports then name that path.
    if (
      !schema.generators.some(
        (generator) => generator.provider === 'prisma-client-js' && generator.output === undefined,
      )
    ) {
      return undefined;
    }
    text = createPreviewPrismaClientDeclaration(schema);
    declarationCache.set(identity, text);
    // A long-lived worker sees few schemas; keep only the most recent ones.
    for (const staleIdentity of [...declarationCache.keys()].slice(
      0,
      -MAXIMUM_CACHED_DECLARATIONS,
    )) {
      declarationCache.delete(staleIdentity);
    }
  }
  return {
    path: path.join(options.projectRoot, '.react-preview-types', 'prisma-client.d.ts'),
    specifier: PREVIEW_PRISMA_CLIENT_SPECIFIER,
    text,
  };
}

/** Reports a generated client in any `node_modules` between the project and the workspace. */
async function hasGeneratedClient(projectRoot: string, workspaceRoot: string): Promise<boolean> {
  let directory = path.resolve(projectRoot);
  const boundary = path.resolve(workspaceRoot);
  for (;;) {
    const generated = path.join(directory, 'node_modules', '.prisma', 'client', 'index.d.ts');
    if ((await stat(generated).catch(() => undefined))?.isFile() === true) return true;
    const parent = path.dirname(directory);
    if (directory === boundary || parent === directory || !parent.startsWith(boundary))
      return false;
    directory = parent;
  }
}

/**
 * Finds schema files from `package.json`, a Prisma config, or the conventional locations.
 *
 * @param projectRoot Package boundary whose schema is wanted.
 * @returns Bounded schema files with their identities, or none.
 */
export async function findPreviewPrismaSchemaFiles(
  projectRoot: string,
): Promise<readonly { readonly mtimeMs: number; readonly path: string; readonly size: number }[]> {
  const candidates: string[] = [];
  try {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')) as {
      readonly prisma?: { readonly schema?: unknown };
    };
    if (typeof manifest.prisma?.schema === 'string') candidates.push(manifest.prisma.schema);
  } catch {
    // A missing or malformed manifest leaves the conventional locations.
  }
  for (const fileName of CONFIG_FILE_NAMES) {
    const configText = await readFile(path.join(projectRoot, fileName), 'utf8').catch(
      () => undefined,
    );
    const configured =
      configText === undefined ? undefined : CONFIG_SCHEMA_PATTERN.exec(configText)?.[1];
    if (configured !== undefined) candidates.push(configured);
  }
  candidates.push('prisma/schema.prisma', 'schema.prisma', 'prisma/schema');
  for (const candidate of candidates) {
    const candidatePath = path.resolve(projectRoot, candidate);
    if (!candidatePath.startsWith(path.resolve(projectRoot))) continue;
    const found = await stat(candidatePath).catch(() => undefined);
    if (found?.isFile() === true && found.size <= MAXIMUM_SCHEMA_BYTES) {
      return [{ mtimeMs: found.mtimeMs, path: candidatePath, size: found.size }];
    }
    if (found?.isDirectory() === true) {
      const names = (await readdir(candidatePath).catch(() => [] as string[]))
        .filter((name) => name.endsWith('.prisma'))
        .sort()
        .slice(0, MAXIMUM_SCHEMA_FILES);
      const files = [];
      let bytes = 0;
      for (const name of names) {
        const filePath = path.join(candidatePath, name);
        const fileStat = await stat(filePath).catch(() => undefined);
        if (fileStat?.isFile() !== true || bytes + fileStat.size > MAXIMUM_SCHEMA_BYTES) continue;
        bytes += fileStat.size;
        files.push({ mtimeMs: fileStat.mtimeMs, path: filePath, size: fileStat.size });
      }
      if (files.length > 0) return files;
    }
  }
  return [];
}
