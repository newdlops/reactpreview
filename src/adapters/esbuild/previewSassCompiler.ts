/** Project-scoped Sass API shared by the compiler thread and its finite initialization task. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Filesystem-only Sass options; project configuration and custom importers are never executed. */
export interface PreviewSassCompileInput {
  /** Canonical entry read only when esbuild actually requests this stylesheet. */
  readonly sourcePath: string;
  /** Nearest package whose declared Sass implementation owns syntax and output. */
  readonly projectRoot: string;
  /** Workspace fallback for conventional Sass load paths. */
  readonly workspaceRoot: string;
}

/** Exact CSS and transitive file URLs returned by the project's compiler. */
export interface PreviewSassCompileResult {
  /** Authored compiler output before esbuild's ordinary CSS processing. */
  readonly css: string;
  /** Transitive Sass inputs used by the existing dependency and refresh boundary. */
  readonly loadedUrls: readonly URL[];
}

/** Structural API compatible with the existing Dart JavaScript and embedded implementations. */
export interface PreviewSassImplementation {
  /** Package identity used to select the existing JavaScript-only synchronous fast path. */
  readonly info?: string;
  /** Available synchronous API; embedded/native implementations keep their asynchronous API. */
  readonly compile?: PreviewSassCompile;
  /** Required supported API exposed by the nearest project's Sass package. */
  readonly compileAsync: PreviewSassCompile;
}

/** Supported Sass invocation, including the asynchronous API required by embedded compilers. */
type PreviewSassCompile = (
  sourcePath: string,
  options: {
    readonly loadPaths: readonly string[];
    readonly logger: { debug(message: string): void; warn(message: string): void };
    readonly style: 'expanded';
  },
) => PreviewSassCompileResult | Promise<PreviewSassCompileResult>;

/** One lazily requested compilation whose initialization can overlap unrelated source analysis. */
export interface PreviewSassTask {
  /** Compiles current filesystem contents once; unavailable workers return a normal-path miss. */
  compile(): Promise<PreviewSassCompileResult | undefined>;
  /** Releases the task on success, cancellation, failure, or an unused prepared stylesheet. */
  dispose(): Promise<void>;
}

/** Injected Node transport; at most one task is prepared for a newly created build context. */
export type PreviewSassTaskFactory = (
  input: PreviewSassCompileInput,
  signal?: AbortSignal,
) => PreviewSassTask;

/** Resolves only the conventional Sass package, preserving the nearest package's API version. */
export function loadProjectSassImplementation(
  projectRoot: string,
): PreviewSassImplementation | undefined {
  try {
    const loaded: unknown = createRequire(path.join(projectRoot, 'package.json'))('sass');
    return (typeof loaded === 'object' || typeof loaded === 'function') &&
      loaded !== null &&
      'compileAsync' in loaded &&
      typeof loaded.compileAsync === 'function'
      ? (loaded as PreviewSassImplementation)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Admits the conventional JavaScript package before executing it in a finite task. */
export function loadProjectSassJavaScriptImplementation(
  projectRoot: string,
): PreviewSassImplementation | undefined {
  try {
    const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
    const packagePath = path.join(path.dirname(projectRequire.resolve('sass')), 'package.json');
    const manifest: unknown = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('name' in manifest) ||
      manifest.name !== 'sass'
    )
      return undefined;
    const sass = loadProjectSassImplementation(projectRoot);
    return sass !== undefined && isPreviewJavaScriptSass(sass) ? sass : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps native, embedded, async-only, and custom implementations on their existing API path. */
function isPreviewJavaScriptSass(sass: PreviewSassImplementation): boolean {
  return (
    typeof sass.compile === 'function' &&
    typeof sass.info === 'string' &&
    sass.info.startsWith('dart-sass\t') &&
    sass.info.includes('\ndart2js\t')
  );
}

/** Compiles live inputs with the same output options in either isolated thread. */
export async function compilePreviewSass(
  sass: PreviewSassImplementation,
  input: PreviewSassCompileInput,
): Promise<PreviewSassCompileResult> {
  const options = {
    loadPaths: [path.dirname(input.sourcePath), input.projectRoot, input.workspaceRoot],
    logger: { debug: (): void => undefined, warn: (): void => undefined },
    style: 'expanded' as const,
  };
  return isPreviewJavaScriptSass(sass) && sass.compile !== undefined
    ? sass.compile(input.sourcePath, options)
    : sass.compileAsync(input.sourcePath, options);
}
