/**
 * Builds one budgeted TypeScript program so preview adapters can read declared types.
 *
 * The program is analysis-only: nothing is emitted or executed. Heap use grows with parsed text
 * (roughly 26-34 bytes of heap per source byte, measured), so admission is breadth-first from the
 * preview roots under one text-byte budget that covers every program file, TypeScript's lib files
 * included. A file that does not fit is refused while smaller files keep being admitted; refused
 * modules stay unresolved and simply type as `any`. The
 * compiler host serves only admitted files, so triple-slash references cannot bypass the budget.
 * Bare specifiers that the project cannot resolve fall back to the managed dependency layers the
 * esbuild graph already uses, and dirty editor snapshots override saved files. Parsed source files
 * are reused across builds when their text is unchanged.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Inputs that define one analysis program. */
export interface PreviewTypeProgramInput {
  /** Directory holding TypeScript's `lib.es*.d.ts` files; defaults to the compiler's own. */
  readonly libDirectory?: string;
  /** Extra `node_modules` roots used when project resolution fails (managed layers). */
  readonly managedNodeModulesPaths: readonly string[];
  /** Returns dirty editor contents for an absolute path, or `undefined` for the saved file. */
  readonly readSnapshot: (sourcePath: string) => string | undefined;
  /** Absolute project files whose declared types the current build may request. */
  readonly rootPaths: readonly string[];
  /** Optional explicit tsconfig/jsconfig path; otherwise the nearest config to the first root. */
  readonly tsconfigPath?: string;
}

/** Hard limits that keep analysis inside the compiler worker's memory budget. */
export interface PreviewTypeProgramBudget {
  /** Largest admitted non-root file; generated schemas and style typings beyond it type as `any`. */
  readonly maxFileBytes: number;
  /** Maximum admitted non-declaration project files, roots included; bounds admission time. */
  readonly maxProjectFiles: number;
  /** Maximum total text of every program file, roots and TypeScript lib files included. */
  readonly maxTextBytes: number;
}

/** Diagnostics describing how much of the requested graph the program covers. */
export interface PreviewTypeProgramStatus {
  /** Text bytes of every file the program may load, lib files included. */
  readonly admittedBytes: number;
  /** Text budget this program was created with. */
  readonly budgetBytes: number;
  readonly createMs: number;
  readonly declarationBytes: number;
  readonly projectFiles: number;
  /** Text bytes of distinct modules refused by the budget. */
  readonly refusedBytes: number;
  /** Distinct modules refused by the budget. */
  readonly refusedModules: number;
}

/**
 * Default admission limits for the interactive worker (4 GiB heap on the developer's machine).
 * Generated schemas such as an 8 MB GraphQL codegen module carry exactly the server data shapes a
 * page needs, so single files up to 16 MiB are admitted. Project files are capped by count because
 * barrel re-exports otherwise pull a whole application in: a 400-file program of an Apollo/MUI
 * page measured 16 MiB of text, about 600 MiB of heap, and 0.6 s to rebuild with warm parses.
 * The oracle lowers `maxTextBytes` further when the worker's live heap headroom is smaller.
 */
export const PREVIEW_TYPE_PROGRAM_DEFAULT_BUDGET: PreviewTypeProgramBudget = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxProjectFiles: 400,
  maxTextBytes: 32 * 1024 * 1024,
});

const DECLARATION_PATTERN = /\.d\.[cm]?ts$/u;
const NODE_MODULES_SEGMENT = /[\\/]node_modules[\\/]/u;
const PROBE_FILE_NAME = '__react_preview_types__.ts';

/** Analysis program plus the admission facts needed to explain partial coverage. */
export interface PreviewTypeProgram {
  readonly checker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly status: PreviewTypeProgramStatus;
}

/**
 * Finds TypeScript's ECMAScript lib files for a bundled worker.
 *
 * @param bundledNodeModulesPath Extension `node_modules`; its sibling `dist/typescript-lib` is used.
 * @returns First directory containing `lib.es2022.d.ts`, or `undefined` to keep TypeScript's own.
 */
export function resolvePreviewTypeLibDirectory(
  bundledNodeModulesPath: string | undefined,
): string | undefined {
  const candidates = [
    bundledNodeModulesPath === undefined
      ? undefined
      : path.join(path.dirname(bundledNodeModulesPath), 'dist', 'typescript-lib'),
    path.dirname(ts.getDefaultLibFilePath({})),
  ];
  return candidates.find(
    (candidate) =>
      candidate !== undefined && ts.sys.fileExists(path.join(candidate, 'lib.es2022.d.ts')),
  );
}

/** Keeps parsed source files between builds so unchanged files are not parsed again. */
export class PreviewTypeSourceFileCache {
  private readonly entries = new Map<
    string,
    { readonly file: ts.SourceFile; readonly settings: string; readonly text: string }
  >();
  private readonly resolutions = new Map<string, string | null>();
  private resolutionScope = '';

  /** Returns a cached parse when text and parse settings match, otherwise parses and caches it. */
  public get(
    fileName: string,
    text: string,
    languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions,
  ): ts.SourceFile {
    const key = readPreviewTypeFileKey(fileName);
    const settings =
      typeof languageVersion === 'object'
        ? `${String(languageVersion.languageVersion)}:${String(languageVersion.impliedNodeFormat)}`
        : String(languageVersion);
    const cached = this.entries.get(key);
    if (cached?.text === text && cached.settings === settings) {
      return cached.file;
    }
    const file = ts.createSourceFile(fileName, text, languageVersion, true);
    this.entries.set(key, { file, settings, text });
    return file;
  }

  /** Drops parses of files outside `fileKeys`, so the cache never outgrows one program. */
  public retainOnly(fileKeys: ReadonlySet<string>): void {
    for (const key of this.entries.keys()) {
      if (!fileKeys.has(key)) this.entries.delete(key);
    }
  }

  /** Text bytes of the retained parses; their heap is reused by the next unchanged build. */
  public textBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.text.length;
    return total;
  }

  /** Drops every retained parse, returning its memory to the worker. */
  public clear(): void {
    this.entries.clear();
    this.resolutions.clear();
  }

  /** Keeps module resolutions only while compiler options and dependency layers are unchanged. */
  public useResolutionScope(scope: string): void {
    if (scope === this.resolutionScope && this.resolutions.size < MAX_CACHED_RESOLUTIONS) return;
    this.resolutions.clear();
    this.resolutionScope = scope;
  }

  /** Returns a remembered resolution: a path, `null` for a remembered miss, `undefined` if unknown. */
  public readResolution(key: string): string | null | undefined {
    return this.resolutions.get(key);
  }

  /** Remembers one resolution, including a miss, for later builds in this worker. */
  public writeResolution(key: string, resolvedFileName: string | undefined): void {
    this.resolutions.set(key, resolvedFileName ?? null);
  }
}

/**
 * Import edges remembered across builds. Resolution walks the file system (stat, realpath) for
 * every edge of a 400-file program, which dominated warm rebuilds; a new specifier is always
 * resolved fresh, and a remembered miss lasts only until the worker is recycled.
 */
const MAX_CACHED_RESOLUTIONS = 50_000;

/** Canonical key for comparing host file names with admitted module paths. */
function readPreviewTypeFileKey(fileName: string): string {
  return path.normalize(fileName);
}

/**
 * Creates the budgeted analysis program.
 *
 * @param input Roots, snapshots, managed dependency layers, and optional tsconfig.
 * @param cache Parse cache shared with the previous build of the same project.
 * @param budget Admission limits.
 * @returns Program, checker, and coverage status. Never throws for unreadable project files.
 */
export function createPreviewTypeProgram(
  input: PreviewTypeProgramInput,
  cache: PreviewTypeSourceFileCache,
  budget: PreviewTypeProgramBudget = PREVIEW_TYPE_PROGRAM_DEFAULT_BUDGET,
): PreviewTypeProgram {
  const started = Date.now();
  const rootPaths = [...new Set(input.rootPaths.map((rootPath) => path.normalize(rootPath)))];
  const options = readAnalysisOptions(input.tsconfigPath, rootPaths[0]);
  const host = ts.createCompilerHost(options, true);
  const libDirectory = input.libDirectory ?? path.dirname(ts.getDefaultLibFilePath(options));
  host.getDefaultLibLocation = () => libDirectory;
  host.getDefaultLibFileName = (compilerOptions) =>
    path.join(libDirectory, ts.getDefaultLibFileName(compilerOptions));
  const readText = (fileName: string): string | undefined =>
    input.readSnapshot(path.normalize(fileName)) ?? ts.sys.readFile(fileName);
  const readCandidate = (fileName: string, limit: number): string | number | undefined => {
    const snapshot = input.readSnapshot(path.normalize(fileName));
    if (snapshot !== undefined) return snapshot;
    const size = statSync(fileName, { throwIfNoEntry: false })?.size;
    // UTF-8 spends at most three bytes per UTF-16 code unit, so a larger file cannot fit.
    return size === undefined || size <= limit * 3 ? ts.sys.readFile(fileName) : size;
  };
  const resolutionCache = ts.createModuleResolutionCache(
    rootPaths[0] === undefined ? process.cwd() : path.dirname(rootPaths[0]),
    (fileName) => fileName,
    options,
  );
  cache.useResolutionScope(JSON.stringify([options, input.managedNodeModulesPaths]));
  const resolve = (specifier: string, containingFile: string): string | undefined => {
    const key = `${containingFile}\0${specifier}`;
    const remembered = cache.readResolution(key);
    if (remembered !== undefined) return remembered ?? undefined;
    const resolvedFileName = resolveUncached(specifier, containingFile);
    cache.writeResolution(key, resolvedFileName);
    return resolvedFileName;
  };
  const resolveUncached = (specifier: string, containingFile: string): string | undefined => {
    const direct = ts.resolveModuleName(specifier, containingFile, options, host, resolutionCache);
    if (direct.resolvedModule !== undefined) return direct.resolvedModule.resolvedFileName;
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) return undefined;
    for (const nodeModulesPath of input.managedNodeModulesPaths) {
      const managed = ts.resolveModuleName(
        specifier,
        path.join(nodeModulesPath, PROBE_FILE_NAME),
        options,
        host,
        resolutionCache,
      );
      if (managed.resolvedModule !== undefined) return managed.resolvedModule.resolvedFileName;
    }
    return undefined;
  };
  const lib = readPreviewTypeLibFiles(libDirectory, options.lib ?? []);
  const admission = admitModulesBreadthFirst(
    rootPaths,
    { readCandidate, readRoot: readText },
    resolve,
    budget,
    lib.bytes,
  );
  cache.retainOnly(new Set([...admission.texts.keys(), ...lib.texts.keys()]));
  host.readFile = (fileName) => readText(fileName);
  host.fileExists = (fileName) =>
    input.readSnapshot(path.normalize(fileName)) !== undefined || ts.sys.fileExists(fileName);
  // Only admitted modules and lib files are served: `/// <reference path|types>` directives in
  // admitted declarations would otherwise load files that the byte budget never counted.
  host.getSourceFile = (fileName, languageVersion) => {
    const key = readPreviewTypeFileKey(fileName);
    const text = admission.texts.get(key) ?? lib.texts.get(key);
    return text === undefined ? undefined : cache.get(fileName, text, languageVersion);
  };
  host.resolveTypeReferenceDirectiveReferences = (directives) =>
    directives.map(() => ({ resolvedTypeReferenceDirective: undefined }));
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => {
      const resolvedFileName = admission.resolved.get(`${containingFile}\0${literal.text}`);
      return resolvedFileName === undefined
        ? { resolvedModule: undefined }
        : {
            resolvedModule: {
              extension: readExtension(resolvedFileName),
              isExternalLibraryImport: NODE_MODULES_SEGMENT.test(resolvedFileName),
              resolvedFileName,
            },
          };
    });
  const program = ts.createProgram({
    host,
    options,
    rootNames: rootPaths.filter((rootPath) =>
      admission.texts.has(readPreviewTypeFileKey(rootPath)),
    ),
  });
  const checker = program.getTypeChecker();
  return {
    checker,
    program,
    status: {
      admittedBytes: admission.admittedBytes,
      budgetBytes: budget.maxTextBytes,
      createMs: Date.now() - started,
      declarationBytes: admission.declarationBytes,
      projectFiles: admission.projectFiles,
      refusedBytes: admission.refusedBytes,
      refusedModules: admission.refused.size,
    },
  };
}

interface ModuleAdmission {
  admittedBytes: number;
  declarationBytes: number;
  projectFiles: number;
  /** Canonical keys of modules refused by the budget. */
  readonly refused: Set<string>;
  /** Refused text, measured in file bytes when the file was too large to read. */
  refusedBytes: number;
  readonly resolved: Map<string, string>;
  /** Admitted module text by canonical key (roots included); the host serves only these. */
  readonly texts: Map<string, string>;
}

/** Reads admission candidates; a number is the byte size of a file too large to read. */
interface ModuleTextReader {
  readonly readCandidate: (fileName: string, limit: number) => string | number | undefined;
  readonly readRoot: (fileName: string) => string | undefined;
}

/**
 * Walks import edges nearest-first so the budget keeps the files closest to the roots.
 * Roots are always admitted. Every other module must fit the per-file limit and the remaining
 * text budget; a refused module does not stop smaller modules from being admitted later.
 */
function admitModulesBreadthFirst(
  rootPaths: readonly string[],
  reader: ModuleTextReader,
  resolve: (specifier: string, containingFile: string) => string | undefined,
  budget: PreviewTypeProgramBudget,
  libBytes: number,
): ModuleAdmission {
  const admission: ModuleAdmission = {
    admittedBytes: libBytes,
    declarationBytes: 0,
    projectFiles: 0,
    refused: new Set(),
    refusedBytes: 0,
    resolved: new Map(),
    texts: new Map(),
  };
  const queue: { readonly fileName: string; readonly text: string }[] = [];
  for (const rootPath of rootPaths) {
    const text = reader.readRoot(rootPath);
    const key = readPreviewTypeFileKey(rootPath);
    if (admission.texts.has(key) || text === undefined) continue;
    admission.texts.set(key, text);
    admission.admittedBytes += text.length;
    admission.projectFiles += 1;
    queue.push({ fileName: rootPath, text });
  }
  // The queue grows while it is iterated; array iteration visits the appended modules too.
  for (const containing of queue) {
    const imports = ts.preProcessFile(containing.text, true, true).importedFiles;
    for (const reference of imports) {
      const resolvedFileName = resolve(reference.fileName, containing.fileName);
      if (resolvedFileName === undefined) continue;
      const key = readPreviewTypeFileKey(resolvedFileName);
      const edge = `${containing.fileName}\0${reference.fileName}`;
      if (admission.texts.has(key) || isElidedPackageScript(resolvedFileName)) {
        // TypeScript never loads JavaScript from node_modules at `maxNodeModuleJsDepth: 0`.
        admission.resolved.set(edge, resolvedFileName);
        continue;
      }
      if (admission.refused.has(key)) continue;
      const declaration = DECLARATION_PATTERN.test(resolvedFileName);
      const limit = Math.min(budget.maxFileBytes, budget.maxTextBytes - admission.admittedBytes);
      const canAdmitKind = declaration || admission.projectFiles < budget.maxProjectFiles;
      const text = canAdmitKind ? reader.readCandidate(resolvedFileName, limit) : 0;
      if (text === undefined) continue;
      if (typeof text === 'number' || text.length > limit) {
        admission.refused.add(key);
        admission.refusedBytes += typeof text === 'number' ? text : text.length;
        continue;
      }
      admission.texts.set(key, text);
      admission.resolved.set(edge, resolvedFileName);
      admission.admittedBytes += text.length;
      if (declaration) admission.declarationBytes += text.length;
      else admission.projectFiles += 1;
      queue.push({ fileName: resolvedFileName, text });
    }
  }
  return admission;
}

/** Reports package JavaScript, which TypeScript never loads at `maxNodeModuleJsDepth: 0`. */
function isElidedPackageScript(fileName: string): boolean {
  return NODE_MODULES_SEGMENT.test(fileName) && /\.(?:[cm]?js|jsx)$/u.test(fileName);
}

/** TypeScript lib files of one configured lib set; they never change during a worker's life. */
interface PreviewTypeLibFiles {
  readonly bytes: number;
  readonly texts: ReadonlyMap<string, string>;
}

const libFilesByDirectory = new Map<string, PreviewTypeLibFiles>();

/**
 * Follows `/// <reference lib>` directives from the configured lib files once per directory,
 * so every program charges the same fixed lib cost and serves exactly those files.
 */
function readPreviewTypeLibFiles(
  libDirectory: string,
  libNames: readonly string[],
): PreviewTypeLibFiles {
  const cacheKey = `${libDirectory}\0${libNames.join(',')}`;
  const cached = libFilesByDirectory.get(cacheKey);
  if (cached !== undefined) return cached;
  const texts = new Map<string, string>();
  let bytes = 0;
  const visit = (fileName: string): void => {
    const filePath = path.join(libDirectory, fileName);
    const key = readPreviewTypeFileKey(filePath);
    if (texts.has(key)) return;
    const text = ts.sys.readFile(filePath);
    if (text === undefined) return;
    texts.set(key, text);
    bytes += text.length;
    for (const reference of ts.preProcessFile(text, true, true).libReferenceDirectives) {
      visit(`lib.${reference.fileName.toLowerCase()}.d.ts`);
    }
  };
  for (const libName of libNames) visit(libName);
  const files = { bytes, texts };
  libFilesByDirectory.set(cacheKey, files);
  return files;
}

/** Checks a saved file through TypeScript's system host, keeping `ts.sys` as the receiver. */
function fileExists(fileName: string): boolean {
  return ts.sys.fileExists(fileName);
}

/** Reads project options and removes everything that would emit, widen, or inflate the program. */
function readAnalysisOptions(
  tsconfigPath: string | undefined,
  firstRoot: string | undefined,
): ts.CompilerOptions {
  const configPath =
    tsconfigPath ??
    (firstRoot === undefined
      ? undefined
      : (ts.findConfigFile(path.dirname(firstRoot), fileExists, 'tsconfig.json') ??
        ts.findConfigFile(path.dirname(firstRoot), fileExists, 'jsconfig.json')));
  let parsed: ts.CompilerOptions = {};
  if (configPath !== undefined) {
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
        // Only options are needed; expanding `include` globs would walk the whole project tree.
        readDirectory: () => [],
      },
    );
    parsed = config?.options ?? {};
  }
  return {
    ...parsed,
    allowJs: true,
    checkJs: false,
    composite: false,
    declaration: false,
    incremental: false,
    // DOM declarations dominate memory and never describe application data shapes.
    lib: ['lib.es2022.d.ts'],
    // Package JavaScript is never admitted, so TypeScript must not try to load it either.
    maxNodeModuleJsDepth: 0,
    noEmit: true,
    skipDefaultLibCheck: true,
    skipLibCheck: true,
    types: [],
  };
}

/** Maps a resolved file name to the extension TypeScript expects in a resolved module. */
function readExtension(fileName: string): ts.Extension {
  if (fileName.endsWith('.d.ts')) return ts.Extension.Dts;
  if (fileName.endsWith('.d.mts')) return ts.Extension.Dmts;
  if (fileName.endsWith('.d.cts')) return ts.Extension.Dcts;
  if (fileName.endsWith('.tsx')) return ts.Extension.Tsx;
  if (fileName.endsWith('.ts')) return ts.Extension.Ts;
  if (fileName.endsWith('.jsx')) return ts.Extension.Jsx;
  if (fileName.endsWith('.mjs')) return ts.Extension.Mjs;
  if (fileName.endsWith('.cjs')) return ts.Extension.Cjs;
  if (fileName.endsWith('.json')) return ts.Extension.Json;
  return ts.Extension.Js;
}
