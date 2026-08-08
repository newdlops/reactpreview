/** Builds browser-runnable, code-split vendor facades for package imports externalized per preview. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { build, type Metafile, type OutputFile } from 'esbuild';
import { ImportType, init, parse } from 'es-module-lexer';
import type {
  PreviewBundle,
  PreviewBundleChunk,
  PreviewBundleModuleImport,
} from '../../domain/preview';
import { isPreviewBareModuleSpecifier } from './previewInstalledPackageExternalizationPlugin';
import {
  createPreviewGlobalPackageBridgePlugin,
  type PreviewGlobalPackageBridgePlan,
} from './globalPackageBridge';
import { createPreviewNodeBuiltinPlugin } from './previewNodeBuiltinPlugin';

interface PreviewVendorDemand {
  readonly namedExports: readonly string[];
  readonly specifier: string;
  readonly wildcard: boolean;
}

/** Invalidates persisted vendor outputs whenever the browser-module closure contract changes. */
const PREVIEW_VENDOR_BUILD_SCHEMA = 2;

export interface PreviewVendorBuildOutput {
  readonly chunks: readonly PreviewBundleChunk[];
  readonly moduleImports: readonly PreviewBundleModuleImport[];
  readonly stylesheet?: Uint8Array;
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
  readonly workspaceRoot: string;
}

/** Compiler-lifetime cache whose returned buffers are cloned before worker transfer. */
export class PreviewVendorModuleBuilder {
  private readonly outputByIdentity = new Map<string, Promise<PreviewVendorBuildOutput>>();
  private readonly records: PreviewVendorCacheRecord[] = [];

  public constructor(private readonly sharedCache?: PreviewVendorModuleCacheBackend) {}

  public async prepare(options: PreparePreviewVendorModulesOptions): Promise<PreviewBundle> {
    const demands = await collectVendorDemands(options.bundle, options.metafile);
    if (demands.length === 0) return options.bundle;
    const environmentIdentity = createVendorEnvironmentIdentity(
      options.workspaceRoot,
      options.nodePaths,
      createGlobalPackageBridgeIdentity(options.globalPackagePlan),
    );
    const reusable = this.records.find(
      (record) =>
        record.environmentIdentity === environmentIdentity &&
        vendorDemandsCover(record.demands, demands),
    );
    if (reusable !== undefined) {
      return attachVendorOutput(options.bundle, await reusable.output);
    }
    const identity = createVendorIdentity(
      options.workspaceRoot,
      options.nodePaths,
      demands,
      createGlobalPackageBridgeIdentity(options.globalPackagePlan),
    );
    let pending = this.outputByIdentity.get(identity);
    if (pending === undefined) {
      let localBuild: Promise<PreviewVendorBuildOutput> | undefined;
      const build = (): Promise<PreviewVendorBuildOutput> =>
        (localBuild ??= buildVendorOutput({ ...options, demands }).then((output) =>
          validateVendorBuildOutput(output, demands),
        ));
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
    return attachVendorOutput(options.bundle, vendor);
  }

  public clear(): void {
    this.outputByIdentity.clear();
    this.records.length = 0;
  }
}

function collectExternalModuleSpecifiers(metafile: Metafile): readonly string[] {
  const specifiers = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external && isPreviewBareModuleSpecifier(imported.path)) {
        specifiers.add(imported.path);
      }
    }
  }
  return [...specifiers].sort();
}

async function collectVendorDemands(
  bundle: PreviewBundle,
  metafile: Metafile,
): Promise<readonly PreviewVendorDemand[]> {
  const demandBySpecifier = new Map<string, { namedExports: Set<string>; wildcard: boolean }>(
    collectExternalModuleSpecifiers(metafile).map((specifier) => [
      specifier,
      { namedExports: new Set<string>(), wildcard: false },
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
    collectSourceDemands(new TextDecoder().decode(bytes), demandBySpecifier);
  }
  return [...demandBySpecifier]
    .map(([specifier, demand]) => ({
      namedExports: [...demand.namedExports].sort(),
      specifier,
      wildcard: demand.wildcard,
    }))
    .sort((left, right) => compareText(left.specifier, right.specifier));
}

function collectSourceDemands(
  source: string,
  demands: Map<string, { namedExports: Set<string>; wildcard: boolean }>,
): void {
  const namespaceBindings = new Map<string, string>();
  const [imports] = parse(source);
  for (const imported of imports) {
    if (imported.n === undefined) continue;
    let demand = demands.get(imported.n);
    if (demand === undefined) {
      if (!isPreviewBareModuleSpecifier(imported.n)) continue;
      demand = { namedExports: new Set<string>(), wildcard: false };
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

async function buildVendorOutput(
  options: PreparePreviewVendorModulesOptions & {
    readonly demands: readonly PreviewVendorDemand[];
  },
): Promise<PreviewVendorBuildOutput> {
  const virtualBySpecifier = new Map(
    options.demands.map((demand) => [
      demand.specifier,
      `vendor-entry:${Buffer.from(demand.specifier).toString('base64url')}`,
    ]),
  );
  const demandByVirtual = new Map(
    options.demands.map((demand) => [virtualBySpecifier.get(demand.specifier)!, demand]),
  );
  const outdir = path.resolve(options.workspaceRoot, 'react-preview-vendor-output');
  const result = await build({
    absWorkingDir: options.workspaceRoot,
    bundle: true,
    chunkNames: 'chunks/vendor/shared/[hash]',
    define: { 'process.env.NODE_ENV': '"development"' },
    entryNames: 'chunks/vendor/entries/[name]-[hash]',
    entryPoints: Object.fromEntries(
      options.demands.map((demand, index) => [
        `module-${index.toString().padStart(4, '0')}`,
        virtualBySpecifier.get(demand.specifier)!,
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
      createVendorEntryPlugin(demandByVirtual, options.workspaceRoot),
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

function createVendorEntryPlugin(
  demandByVirtual: ReadonlyMap<string, PreviewVendorDemand>,
  workspaceRoot: string,
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
          resolveDir: workspaceRoot,
        };
      });
    },
  };
}

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

function cloneVendorOutput(output: PreviewVendorBuildOutput): PreviewVendorBuildOutput {
  return {
    chunks: output.chunks.map((chunk) => ({ ...chunk, contents: chunk.contents.slice() })),
    moduleImports: output.moduleImports.map((moduleImport) => ({ ...moduleImport })),
    ...(output.stylesheet === undefined ? {} : { stylesheet: output.stylesheet.slice() }),
  };
}

function createVendorIdentity(
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
        workspaceRoot: path.resolve(workspaceRoot),
      }),
    )
    .digest('hex');
}

function createVendorEnvironmentIdentity(
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

function vendorDemandsCover(
  available: readonly PreviewVendorDemand[],
  requested: readonly PreviewVendorDemand[],
): boolean {
  const availableBySpecifier = new Map(available.map((demand) => [demand.specifier, demand]));
  return requested.every((demand) => {
    const candidate = availableBySpecifier.get(demand.specifier);
    if (candidate === undefined || (demand.wildcard && !candidate.wildcard)) return false;
    const candidateNames = new Set(candidate.namedExports);
    return demand.namedExports.every((name) => candidateNames.has(name));
  });
}

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

function toOutputRelativePath(outputPath: string, outdir: string): string {
  return path.relative(outdir, outputPath).split(path.sep).join('/');
}

function isJavaScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) && value !== 'default';
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
