/** Builds browser-runnable, code-split vendor facades for package imports externalized per preview. */
import { ImportType, init, parse } from 'es-module-lexer';
import { build, type Metafile, type OutputFile } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  PreviewBundle,
  PreviewBundleChunk,
  PreviewBundleModuleImport,
} from '../../domain/preview';
import {
  createPreviewGlobalPackageBridgePlugin,
  type PreviewGlobalPackageBridgePlan,
} from './globalPackageBridge';
import { PREVIEW_BROWSER_OUTPUT_OPTIONS } from './previewBrowserOutputOptions';
import { isPreviewBareModuleSpecifier } from './previewInstalledPackageExternalizationPlugin';
import {
  createPreviewNodeBuiltinPlugin,
  PREVIEW_NODE_PATH_GLOBAL_DEFINES,
} from './previewNodeBuiltinPlugin';

interface PreviewVendorDemand {
  readonly namedExports: readonly string[];
  readonly resolveDir: string;
  readonly specifier: string;
  readonly wildcard: boolean;
}

/** Invalidates persisted vendor outputs whenever the browser-module closure contract changes. */
const PREVIEW_VENDOR_BUILD_SCHEMA = 9;

export interface PreviewVendorBuildOutput {
  readonly chunks: readonly PreviewBundleChunk[];
  /** Local build inputs retained only for managed-store admission; persistent caches may omit it. */
  readonly dependencyPaths?: readonly string[];
  readonly moduleImports: readonly PreviewBundleModuleImport[];
  readonly stylesheet?: Uint8Array;
}

/** Browser bundle plus private file evidence from the vendor graph that produced it. */
export interface PreparedPreviewVendorModules {
  readonly bundle: PreviewBundle;
  readonly dependencyPaths: readonly string[];
}

/** Optional cross-process cache; callers must treat every cache fault as a local-build miss. */
export interface PreviewVendorModuleCacheBackend {
  getOrBuild(
    identity: string,
    build: () => Promise<PreviewVendorBuildOutput>,
  ): Promise<PreviewVendorBuildOutput>;
}

interface PreviewVendorCacheRecord {
  readonly demands: readonly PreviewVendorDemand[];
  readonly environmentIdentity: string;
  readonly output: Promise<PreviewVendorBuildOutput>;
}

export interface PreparePreviewVendorModulesOptions {
  readonly bundle: PreviewBundle;
  readonly globalPackagePlan: PreviewGlobalPackageBridgePlan;
  readonly metafile: Metafile;
  readonly nodePaths: readonly string[];
  /** Nearest package boundary whose node_modules owns the target's bare dependencies. */
  readonly projectRoot: string;
  readonly workspaceRoot: string;
}

/** Compiler-lifetime cache whose returned buffers are cloned before worker transfer. */
export class PreviewVendorModuleBuilder {
  private readonly outputByIdentity = new Map<string, Promise<PreviewVendorBuildOutput>>();
  private readonly records: PreviewVendorCacheRecord[] = [];

  /** Creates a compiler-scoped vendor cache, optionally backed by an independently verified shared cache. */
  public constructor(private readonly sharedCache?: PreviewVendorModuleCacheBackend) {}

  /** Returns the browser bundle after satisfying its external package demands through vendor facades. */
  public async prepare(options: PreparePreviewVendorModulesOptions): Promise<PreviewBundle> {
    return (await this.prepareWithEvidence(options)).bundle;
  }

  /** Preserves vendor graph inputs for background admission without exposing store paths publicly. */
  public async prepareWithEvidence(
    options: PreparePreviewVendorModulesOptions,
  ): Promise<PreparedPreviewVendorModules> {
    const demands = await collectVendorDemands(
      options.bundle,
      options.metafile,
      options.projectRoot,
      options.workspaceRoot,
      options.nodePaths,
    );
    if (demands.length === 0) {
      return { bundle: options.bundle, dependencyPaths: Object.freeze([]) };
    }
    const vendorGlobalPackagePlan = selectPreviewVendorGlobalPackagePlan(
      options.globalPackagePlan,
      options.metafile,
      demands,
      options.workspaceRoot,
    );
    const environmentIdentity = createVendorEnvironmentIdentity(
      options.projectRoot,
      options.workspaceRoot,
      options.nodePaths,
      createGlobalPackageBridgeIdentity(vendorGlobalPackagePlan),
    );
    const reusable = this.records.find(
      (record) =>
        record.environmentIdentity === environmentIdentity &&
        vendorDemandsCover(record.demands, demands),
    );
    if (reusable !== undefined) {
      const output = await reusable.output;
      return {
        bundle: attachVendorOutput(options.bundle, output),
        dependencyPaths: Object.freeze([...(output.dependencyPaths ?? [])]),
      };
    }
    const identity = createVendorIdentity(
      options.projectRoot,
      options.workspaceRoot,
      options.nodePaths,
      demands,
      createGlobalPackageBridgeIdentity(vendorGlobalPackagePlan),
    );
    let pending = this.outputByIdentity.get(identity);
    if (pending === undefined) {
      let localBuild: Promise<PreviewVendorBuildOutput> | undefined;
      const build = (): Promise<PreviewVendorBuildOutput> =>
        (localBuild ??= buildVendorOutput({
          ...options,
          demands,
          globalPackagePlan: vendorGlobalPackagePlan,
        }).then((output) => validateVendorBuildOutput(output, demands)));
      pending =
        this.sharedCache === undefined
          ? build()
          : this.sharedCache
              .getOrBuild(identity, build)
              .then((output) => validateVendorBuildOutput(output, demands))
              .catch(() => build());
      this.outputByIdentity.set(identity, pending);
      const record = { demands, environmentIdentity, output: pending };
      this.records.push(record);
      void pending.catch(() => {
        this.outputByIdentity.delete(identity);
        const index = this.records.indexOf(record);
        if (index >= 0) this.records.splice(index, 1);
      });
    }
    const vendor = cloneVendorOutput(await pending);
    return {
      bundle: attachVendorOutput(options.bundle, vendor),
      dependencyPaths: Object.freeze([...(vendor.dependencyPaths ?? [])]),
    };
  }

  /** Drops retained vendor identities and in-flight references when the owning compiler is released. */
  public clear(): void {
    this.outputByIdentity.clear();
    this.records.length = 0;
  }
}

/** Associates each emitted bare package edge with its authored importer's resolution directory. */
function collectExternalModuleDemands(
  metafile: Metafile,
  projectRoot: string,
  workspaceRoot: string,
): ReadonlyMap<string, string> {
  const specifiers = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      // Import maps can serve only browser ESM edges. Esbuild deliberately preserves a missing
      // `require()` inside try/catch for optional peers (for example Framer Motion's Emotion hook);
      // turning that guarded fallback into an unconditional vendor entry makes a valid app fail.
      if (
        imported.external &&
        (imported.kind === 'import-statement' || imported.kind === 'dynamic-import') &&
        isPreviewBareModuleSpecifier(imported.path)
      ) {
        specifiers.add(imported.path);
      }
    }
  }
  const resolveDirectories = new Map<string, Set<string>>();
  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    const resolveDir = readVendorImporterResolveDirectory(inputPath, workspaceRoot);
    if (resolveDir === undefined) continue;
    for (const imported of input.imports) {
      if (
        !imported.external ||
        (imported.kind !== 'import-statement' && imported.kind !== 'dynamic-import') ||
        !specifiers.has(imported.path)
      ) {
        continue;
      }
      const directories = resolveDirectories.get(imported.path) ?? new Set<string>();
      directories.add(resolveDir);
      resolveDirectories.set(imported.path, directories);
    }
  }
  return new Map(
    [...specifiers]
      .sort()
      .map((specifier) => [
        specifier,
        [...(resolveDirectories.get(specifier) ?? [])].sort(compareText)[0] ?? projectRoot,
      ]),
  );
}

/** Reads external imports from emitted browser modules and correlates them with their admitted package resolution directories. */
async function collectVendorDemands(
  bundle: PreviewBundle,
  metafile: Metafile,
  projectRoot: string,
  workspaceRoot: string,
  nodePaths: readonly string[],
): Promise<readonly PreviewVendorDemand[]> {
  const absentOptionalPeers = await collectAbsentOptionalPeerSpecifiers(
    metafile,
    workspaceRoot,
    nodePaths,
  );
  const demandBySpecifier = new Map<
    string,
    { namedExports: Set<string>; resolveDir: string; wildcard: boolean }
  >(
    [...collectExternalModuleDemands(metafile, projectRoot, workspaceRoot)]
      .filter(([specifier]) => !absentOptionalPeers.has(specifier))
      .map(([specifier, resolveDir]) => [
        specifier,
        { namedExports: new Set<string>(), resolveDir, wildcard: false },
      ]),
  );
  const javascriptFiles = [
    bundle.javascript,
    ...bundle.chunks
      .filter((chunk) => chunk.relativePath.endsWith('.js'))
      .map((chunk) => chunk.contents),
  ];
  await init;
  for (const bytes of javascriptFiles) {
    collectSourceDemands(
      new TextDecoder().decode(bytes),
      demandBySpecifier,
      projectRoot,
      absentOptionalPeers,
    );
  }
  return [...demandBySpecifier]
    .map(([specifier, demand]) => ({
      namedExports: [...demand.namedExports].sort(),
      resolveDir: path.resolve(demand.resolveDir),
      specifier,
      wildcard: demand.wildcard,
    }))
    .sort(
      (left, right) =>
        compareText(left.specifier, right.specifier) ||
        compareText(left.resolveDir, right.resolveDir),
    );
}

/** Collects static named and wildcard package import demands from one emitted JavaScript module. */
function collectSourceDemands(
  source: string,
  demands: Map<string, { namedExports: Set<string>; resolveDir: string; wildcard: boolean }>,
  defaultResolveDir: string,
  absentOptionalPeers: ReadonlySet<string>,
): void {
  const namespaceBindings = new Map<string, string>();
  const [imports] = parse(source);
  for (const imported of imports) {
    if (imported.n === undefined) continue;
    let demand = demands.get(imported.n);
    if (demand === undefined) {
      if (!isPreviewBareModuleSpecifier(imported.n) || absentOptionalPeers.has(imported.n))
        continue;
      demand = {
        namedExports: new Set<string>(),
        resolveDir: defaultResolveDir,
        wildcard: false,
      };
      demands.set(imported.n, demand);
    }
    if (
      imported.t === ImportType.Dynamic ||
      imported.t === ImportType.DynamicDeferPhase ||
      imported.t === ImportType.DynamicSourcePhase
    ) {
      demand.wildcard = true;
      continue;
    }
    const statement = source.slice(imported.ss, imported.se);
    if (/^\s*export\s*\*/u.test(statement)) demand.wildcard = true;
    const namespace = /\*\s*as\s*([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(statement)?.[1];
    if (namespace !== undefined) namespaceBindings.set(namespace, imported.n);
    const named = /\{([^}]*)\}/u.exec(statement)?.[1];
    if (named === undefined) continue;
    for (const binding of named.split(',')) {
      const importedName = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(binding)?.[1];
      if (importedName !== undefined && importedName !== 'type') {
        demand.namedExports.add(importedName);
      }
    }
  }
  for (const [localName, specifier] of namespaceBindings) {
    const demand = demands.get(specifier);
    if (demand === undefined) continue;
    const accessPattern = new RegExp(
      `\\b${localName}\\s*(?:\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)|\\[\\s*["']([^"']+)["']\\s*\\])`,
      'gu',
    );
    for (const match of source.matchAll(accessPattern)) {
      const name = match[1] ?? match[2];
      if (name !== undefined) demand.namedExports.add(name);
    }
  }
}

/** Bundles only demanded package facades into browser chunks and retains local input evidence for store admission. */
async function buildVendorOutput(
  options: PreparePreviewVendorModulesOptions & {
    readonly demands: readonly PreviewVendorDemand[];
  },
): Promise<PreviewVendorBuildOutput> {
  const virtualDemands = options.demands.map((demand) => ({
    demand,
    virtualSpecifier: `vendor-entry:${Buffer.from(demand.specifier).toString('base64url')}`,
  }));
  const demandByVirtual = new Map(
    virtualDemands.map(({ demand, virtualSpecifier }) => [virtualSpecifier, demand]),
  );
  const outdir = path.resolve(options.workspaceRoot, 'react-preview-vendor-output');
  const result = await build({
    ...PREVIEW_BROWSER_OUTPUT_OPTIONS,
    absWorkingDir: options.workspaceRoot,
    bundle: true,
    chunkNames: 'chunks/vendor/shared/[hash]',
    define: { ...PREVIEW_NODE_PATH_GLOBAL_DEFINES, 'process.env.NODE_ENV': '"development"' },
    entryNames: 'chunks/vendor/entries/[name]-[hash]',
    entryPoints: Object.fromEntries(
      virtualDemands.map(({ virtualSpecifier }, index) => [
        `module-${index.toString().padStart(4, '0')}`,
        virtualSpecifier,
      ]),
    ),
    format: 'esm',
    legalComments: 'none',
    loader: {
      '.eot': 'dataurl',
      '.gif': 'dataurl',
      '.jpeg': 'dataurl',
      '.jpg': 'dataurl',
      '.js': 'jsx',
      '.otf': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.ttf': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
    },
    logLevel: 'silent',
    metafile: true,
    nodePaths: [...options.nodePaths],
    outdir,
    platform: 'browser',
    plugins: [
      createVendorEntryPlugin(demandByVirtual),
      createPreviewGlobalPackageBridgePlugin({ plan: options.globalPackagePlan }),
      createPreviewNodeBuiltinPlugin(),
    ],
    splitting: true,
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  return createVendorBuildOutput(
    result.outputFiles,
    result.metafile,
    demandByVirtual,
    outdir,
    options.workspaceRoot,
  );
}

/** Supplies compiler-owned facade modules for the exact vendor demands in this build. */
function createVendorEntryPlugin(
  demandByVirtual: ReadonlyMap<string, PreviewVendorDemand>,
): import('esbuild').Plugin {
  return {
    name: 'preview-vendor-entry',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^vendor-entry:/ }, (args) => ({
        namespace: 'preview-vendor-entry',
        path: args.path,
      }));
      buildContext.onLoad({ filter: /.*/, namespace: 'preview-vendor-entry' }, (args) => {
        const demand = demandByVirtual.get(args.path);
        if (demand === undefined) throw new Error(`Unknown preview vendor entry: ${args.path}`);
        return {
          contents: createVendorFacadeSource(demand),
          loader: 'js',
          resolveDir: demand.resolveDir,
        };
      });
    },
  };
}

/** Generates exports for the demanded package surface, preserving wildcard demands when required. */
function createVendorFacadeSource(demand: PreviewVendorDemand): string {
  if (demand.specifier === 'react-dom') return createReactDomVendorFacadeSource(demand);
  const exports = demand.namedExports
    .filter(isJavaScriptIdentifier)
    .map(
      (name, index) =>
        `const exported${index.toString()} = value[${JSON.stringify(name)}]; export { exported${index.toString()} as ${name} };`,
    )
    .join('\n');
  return `import * as value from ${JSON.stringify(demand.specifier)};\n${demand.wildcard ? `export * from ${JSON.stringify(demand.specifier)};` : ''}\n${exports}\nexport default value.default ?? value;`;
}

/** Keeps preview portals renderable when a generated ref is truthy but is not an actual DOM host. */
function createReactDomVendorFacadeSource(demand: PreviewVendorDemand): string {
  const exports = demand.namedExports
    .filter((name) => name !== 'createPortal' && isJavaScriptIdentifier(name))
    .map(
      (name, index) =>
        `const exported${index.toString()} = value[${JSON.stringify(name)}]; export { exported${index.toString()} as ${name} };`,
    )
    .join('\n');
  return [
    "import * as React from 'react';",
    `import * as value from ${JSON.stringify(demand.specifier)};`,
    demand.wildcard ? `export * from ${JSON.stringify(demand.specifier)};` : '',
    "const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');",
    'const isPortalContainer = (candidate) => candidate !== null && typeof candidate === "object" && [1, 9, 11].includes(candidate.nodeType) && typeof candidate.appendChild === "function";',
    'export const createPortal = (children, container, key) => { const Context = globalThis[apiKey]?.readJsxOwnershipContext?.(); const ownedChildren = Context === undefined ? children : React.createElement(Context.Provider, { value: undefined }, children); const fallback = globalThis.document?.body ?? globalThis.document?.documentElement; const target = isPortalContainer(container) ? container : isPortalContainer(fallback) ? fallback : undefined; return target === undefined ? ownedChildren : value.createPortal(ownedChildren, target, key); };',
    exports,
    'const originalDefault = value.default ?? value;',
    "const defaultAdapter = originalDefault !== null && (typeof originalDefault === 'object' || typeof originalDefault === 'function') ? new Proxy(originalDefault, { get(target, key) { return key === 'createPortal' ? createPortal : Reflect.get(target, key, target); } }) : originalDefault;",
    'export default defaultAdapter;',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Converts native vendor outputs into validated relative chunks, imports, stylesheet bytes, and private dependency evidence. */
function createVendorBuildOutput(
  outputFiles: readonly OutputFile[],
  metafile: Metafile,
  demandByVirtual: ReadonlyMap<string, PreviewVendorDemand>,
  outdir: string,
  workspaceRoot: string,
): PreviewVendorBuildOutput {
  const chunks = outputFiles
    .filter((output) => output.path.endsWith('.js'))
    .map((output) => ({
      contents: output.contents,
      relativePath: toOutputRelativePath(output.path, outdir),
    }))
    .sort((left, right) => compareText(left.relativePath, right.relativePath));
  const moduleImports: PreviewBundleModuleImport[] = [];
  for (const [outputPath, metadata] of Object.entries(metafile.outputs)) {
    if (metadata.entryPoint === undefined) continue;
    const virtual = metadata.entryPoint.replace(/^preview-vendor-entry:/u, '');
    const demand = demandByVirtual.get(virtual);
    if (demand === undefined) continue;
    moduleImports.push({
      relativePath: toOutputRelativePath(path.resolve(workspaceRoot, outputPath), outdir),
      specifier: demand.specifier,
    });
  }
  moduleImports.sort((left, right) => compareText(left.specifier, right.specifier));
  const stylesheets = outputFiles
    .filter((output) => output.path.endsWith('.css'))
    .sort((left, right) => compareText(left.path, right.path));
  return {
    chunks,
    dependencyPaths: collectVendorDependencyPaths(metafile, workspaceRoot),
    moduleImports,
    ...(stylesheets.length === 0
      ? {}
      : { stylesheet: concatenateBytes(stylesheets.map((output) => output.contents)) }),
  };
}

/**
 * Rejects stale cache records and any vendor build that would defer a package edge to the browser.
 * Application chunks may use bare specifiers only through the generated import map; vendor chunks
 * themselves must be a closed relative-URL graph.
 */
function validateVendorBuildOutput(
  output: PreviewVendorBuildOutput,
  demands: readonly PreviewVendorDemand[],
): PreviewVendorBuildOutput {
  const chunkPaths = new Set(output.chunks.map((chunk) => chunk.relativePath));
  const pathBySpecifier = new Map<string, string>();
  for (const moduleImport of output.moduleImports) {
    if (
      pathBySpecifier.has(moduleImport.specifier) ||
      !chunkPaths.has(moduleImport.relativePath) ||
      !moduleImport.relativePath.endsWith('.js')
    ) {
      throw new Error(`Invalid preview vendor module mapping: ${moduleImport.specifier}`);
    }
    pathBySpecifier.set(moduleImport.specifier, moduleImport.relativePath);
  }
  const missing = demands
    .map((demand) => demand.specifier)
    .filter((specifier) => !pathBySpecifier.has(specifier));
  if (missing.length > 0) {
    throw new Error(`Preview vendor build omitted browser module mappings: ${missing.join(', ')}`);
  }
  const unresolved = new Set<string>();
  for (const chunk of output.chunks) {
    const [imports] = parse(new TextDecoder().decode(chunk.contents));
    for (const imported of imports) {
      if (imported.n !== undefined && isPreviewBareModuleSpecifier(imported.n)) {
        unresolved.add(imported.n);
      }
    }
  }
  if (unresolved.size > 0) {
    throw new Error(
      `Preview vendor build left browser-unresolvable module specifiers: ${[...unresolved].sort().join(', ')}`,
    );
  }
  return output;
}

/** Combines verified vendor chunks and import mappings with the authored preview bundle. */
function attachVendorOutput(
  bundle: PreviewBundle,
  vendor: PreviewVendorBuildOutput,
): PreviewBundle {
  const stylesheetParts = [
    ...(bundle.stylesheet === undefined ? [] : [bundle.stylesheet]),
    ...(vendor.stylesheet === undefined ? [] : [vendor.stylesheet.slice()]),
  ];
  return {
    ...bundle,
    chunks: [
      ...bundle.chunks,
      ...vendor.chunks.map((chunk) => ({ ...chunk, contents: chunk.contents.slice() })),
    ],
    moduleImports: vendor.moduleImports,
    ...(stylesheetParts.length === 0 ? {} : { stylesheet: concatenateBytes(stylesheetParts) }),
  };
}

/** Copies transferable chunk and stylesheet buffers so one worker transfer cannot detach cached bytes. */
function cloneVendorOutput(output: PreviewVendorBuildOutput): PreviewVendorBuildOutput {
  return {
    chunks: output.chunks.map((chunk) => ({ ...chunk, contents: chunk.contents.slice() })),
    ...(output.dependencyPaths === undefined
      ? {}
      : { dependencyPaths: Object.freeze([...output.dependencyPaths]) }),
    moduleImports: output.moduleImports.map((moduleImport) => ({ ...moduleImport })),
    ...(output.stylesheet === undefined ? {} : { stylesheet: output.stylesheet.slice() }),
  };
}

/** Restores real vendor metafile inputs while excluding compiler-owned virtual modules. */
function collectVendorDependencyPaths(
  metafile: Metafile,
  workspaceRoot: string,
): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        Object.keys(metafile.inputs).flatMap((inputPath) => {
          if (inputPath.startsWith('<') || /^[A-Za-z][A-Za-z0-9_-]*:/u.test(inputPath)) return [];
          return [
            path.normalize(
              path.isAbsolute(inputPath) ? inputPath : path.resolve(workspaceRoot, inputPath),
            ),
          ];
        }),
      ),
    ].sort(compareText),
  );
}

/**
 * Excludes application wrappers that import the vendor modules currently being built.
 *
 * Re-injecting such a wrapper into its own vendor dependency graph evaluates its setup against a
 * private package copy. Stateful plugin APIs such as Day.js then mark a plugin as installed before
 * the application copy sees it, so the real wrapper's later `extend()` call becomes a no-op. Bare
 * package globals and unrelated project bridges remain available to vendor dependencies.
 */
function selectPreviewVendorGlobalPackagePlan(
  plan: PreviewGlobalPackageBridgePlan,
  metafile: Metafile,
  demands: readonly PreviewVendorDemand[],
  workspaceRoot: string,
): PreviewGlobalPackageBridgePlan {
  const demandedSpecifiers = new Set(demands.map((demand) => demand.specifier));
  const vendorConsumerPaths = new Set<string>();
  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    if (
      !input.imports.some((imported) => imported.external && demandedSpecifiers.has(imported.path))
    ) {
      continue;
    }
    const sourcePath = resolvePreviewVendorMetafileInputPath(inputPath, workspaceRoot);
    if (sourcePath !== undefined) vendorConsumerPaths.add(sourcePath);
  }
  if (vendorConsumerPaths.size === 0) return plan;

  const bridges = plan.bridges.filter(
    (bridge) =>
      ![bridge.moduleSpecifier, bridge.watchPath].some(
        (candidatePath) =>
          path.isAbsolute(candidatePath) && vendorConsumerPaths.has(path.normalize(candidatePath)),
      ),
  );
  return bridges.length === plan.bridges.length
    ? plan
    : Object.freeze({ ...plan, bridges: Object.freeze(bridges) });
}

/** Restores a real primary-build metafile input to the vendor planner's filesystem identity. */
function resolvePreviewVendorMetafileInputPath(
  inputPath: string,
  workspaceRoot: string,
): string | undefined {
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  if (inputPath.startsWith('<') || /^[A-Za-z][A-Za-z0-9_-]*:/u.test(inputPath)) return undefined;
  return path.normalize(path.resolve(workspaceRoot, inputPath));
}

/** Hashes package demands together with their resolution environment to identify one reusable vendor build. */
function createVendorIdentity(
  projectRoot: string,
  workspaceRoot: string,
  nodePaths: readonly string[],
  demands: readonly PreviewVendorDemand[],
  globalPackageBridgeIdentity: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        buildSchema: PREVIEW_VENDOR_BUILD_SCHEMA,
        demands,
        globalPackageBridgeIdentity,
        nodePaths,
        projectRoot: path.resolve(projectRoot),
        workspaceRoot: path.resolve(workspaceRoot),
      }),
    )
    .digest('hex');
}

/** Hashes the project, workspace, package search paths, and global bridge plan without retaining generated source. */
function createVendorEnvironmentIdentity(
  projectRoot: string,
  workspaceRoot: string,
  nodePaths: readonly string[],
  globalPackageBridgeIdentity: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        buildSchema: PREVIEW_VENDOR_BUILD_SCHEMA,
        globalPackageBridgeIdentity,
        nodePaths,
        projectRoot: path.resolve(projectRoot),
        workspaceRoot: path.resolve(workspaceRoot),
      }),
    )
    .digest('hex');
}

/** Captures only the canonical active bridges that can change vendor module semantics. */
function createGlobalPackageBridgeIdentity(plan: PreviewGlobalPackageBridgePlan): string {
  return JSON.stringify(
    [...plan.bridges]
      .map((bridge) => [
        bridge.globalName,
        bridge.moduleSpecifier,
        path.resolve(bridge.resolveDir),
        bridge.exportKind,
        bridge.exportName ?? '',
      ])
      .sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right))),
  );
}

/** Checks that a retained vendor surface satisfies every requested specifier, named export, and wildcard requirement. */
function vendorDemandsCover(
  available: readonly PreviewVendorDemand[],
  requested: readonly PreviewVendorDemand[],
): boolean {
  const availableBySpecifier = new Map(available.map((demand) => [demand.specifier, demand]));
  return requested.every((demand) => {
    const candidate = availableBySpecifier.get(demand.specifier);
    if (candidate?.resolveDir !== demand.resolveDir || (demand.wildcard && !candidate.wildcard)) {
      return false;
    }
    const candidateNames = new Set(candidate.namedExports);
    return demand.namedExports.every((name) => candidateNames.has(name));
  });
}

/** Restores a file-backed metafile input to the directory that owns its package resolution. */
/**
 * Finds bare specifiers that installed packages import only dynamically as optional peers that are
 * not installed, such as Resend's guarded `await import('@react-email/render')`. Esbuild keeps such
 * a guarded import external; in Node it rejects and the package's own `catch` handles it. Leaving
 * these specifiers out of the import map rejects them the same way in the browser instead of
 * failing the whole vendor build. Project-owned imports keep the normal (acquisition) path.
 */
async function collectAbsentOptionalPeerSpecifiers(
  metafile: Metafile,
  workspaceRoot: string,
  nodePaths: readonly string[],
): Promise<ReadonlySet<string>> {
  const candidates = new Set<string>();
  const disqualified = new Set<string>();
  const manifestByDirectory = new Map<string, Promise<PreviewVendorPackageManifest | undefined>>();
  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    for (const imported of input.imports) {
      if (
        !imported.external ||
        (imported.kind !== 'import-statement' && imported.kind !== 'dynamic-import') ||
        !isPreviewBareModuleSpecifier(imported.path)
      ) {
        continue;
      }
      const importerPath = readVendorImporterPath(inputPath, workspaceRoot);
      const absent =
        imported.kind === 'dynamic-import' &&
        importerPath !== undefined &&
        path.normalize(importerPath).split(path.sep).includes('node_modules') &&
        (await isAbsentOptionalPeer(imported.path, importerPath, nodePaths, manifestByDirectory));
      (absent ? candidates : disqualified).add(imported.path);
    }
  }
  return new Set([...candidates].filter((specifier) => !disqualified.has(specifier)));
}

/** Package metadata read to recognize optional peer declarations. */
interface PreviewVendorPackageManifest {
  readonly name?: unknown;
  readonly peerDependencies?: unknown;
  readonly peerDependenciesMeta?: unknown;
}

/** Reports an optional peer of the importer's own package that no searched path installs. */
async function isAbsentOptionalPeer(
  specifier: string,
  importerPath: string,
  nodePaths: readonly string[],
  manifestByDirectory: Map<string, Promise<PreviewVendorPackageManifest | undefined>>,
): Promise<boolean> {
  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  if (packageName === undefined || (specifier.startsWith('@') && segments.length < 2)) return false;
  const manifest = await readOwningPackageManifest(path.dirname(importerPath), manifestByDirectory);
  const peers = manifest?.peerDependencies;
  const peerMeta = manifest?.peerDependenciesMeta;
  if (
    typeof peers !== 'object' ||
    peers === null ||
    !Object.hasOwn(peers, packageName) ||
    typeof peerMeta !== 'object' ||
    peerMeta === null ||
    (peerMeta as Record<string, { optional?: unknown } | undefined>)[packageName]?.optional !== true
  ) {
    return false;
  }
  const searchDirectories = [...nodePaths];
  for (let directory = path.dirname(importerPath); ; directory = path.dirname(directory)) {
    searchDirectories.push(path.join(directory, 'node_modules'));
    if (path.dirname(directory) === directory) break;
  }
  for (const directory of searchDirectories) {
    if (await isFile(path.join(directory, packageName, 'package.json'))) return false;
  }
  return true;
}

/** Reads the nearest named package manifest without leaving the importer's package. */
function readOwningPackageManifest(
  directory: string,
  manifestByDirectory: Map<string, Promise<PreviewVendorPackageManifest | undefined>>,
): Promise<PreviewVendorPackageManifest | undefined> {
  let pending = manifestByDirectory.get(directory);
  if (pending === undefined) {
    pending = (async () => {
      try {
        const parsed: unknown = JSON.parse(
          await readFile(path.join(directory, 'package.json'), 'utf8'),
        );
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as PreviewVendorPackageManifest).name === 'string'
        ) {
          return parsed;
        }
      } catch {
        // No manifest here; a nested `{ "type": "module" }` file also continues upward.
      }
      const parent = path.dirname(directory);
      return parent === directory || path.basename(directory) === 'node_modules'
        ? undefined
        : readOwningPackageManifest(parent, manifestByDirectory);
    })();
    manifestByDirectory.set(directory, pending);
  }
  return pending;
}

/** Reports an existing regular file. */
async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** Maps a metafile input to the directory its imports resolve from. */
function readVendorImporterResolveDirectory(
  inputPath: string,
  workspaceRoot: string,
): string | undefined {
  const sourcePath = readVendorImporterPath(inputPath, workspaceRoot);
  return sourcePath === undefined ? undefined : path.dirname(sourcePath);
}

/** Maps a metafile input to its file path inside the workspace. */
function readVendorImporterPath(inputPath: string, workspaceRoot: string): string | undefined {
  if (inputPath.startsWith('<')) return undefined;
  const sourcePath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : inputPath.includes(':')
      ? undefined
      : path.resolve(workspaceRoot, inputPath);
  if (sourcePath === undefined) return undefined;
  const relative = path.relative(path.resolve(workspaceRoot), sourcePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return sourcePath;
}

/** Allocates one contiguous byte buffer from the ordered stylesheet fragments. */
function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

/** Normalizes a native output filename to its portable path beneath the configured output directory. */
function toOutputRelativePath(outputPath: string, outdir: string): string {
  return path.relative(outdir, outputPath).split(path.sep).join('/');
}

/** Checks whether a name can appear as a direct JavaScript export identifier. */
function isJavaScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) && value !== 'default';
}

/** Provides deterministic lexical ordering independent of the host locale. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
