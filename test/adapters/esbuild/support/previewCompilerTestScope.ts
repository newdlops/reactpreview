/** Owns compiler instances per integration case; the surrounding test module owns its native engine. */
import {
  EsbuildPreviewCompiler,
  type EsbuildPreviewCompilerOptions,
} from '../../../../src/adapters/esbuild/esbuildPreviewCompiler';

/** Explicit creation and cleanup boundary for every compiler created by a test module. */
export interface PreviewCompilerTestScope {
  /** Creates an instance with unchanged adapter options and retains it for case cleanup. */
  readonly create: (options?: EsbuildPreviewCompilerOptions) => EsbuildPreviewCompiler;
  /** Awaits all retained instance contexts and caches, including failed assertions. */
  readonly shutdown: () => Promise<void>;
}

/** Retains instances until the caller's afterEach hook has awaited their idempotent cleanup. */
export function createPreviewCompilerTestScope(): PreviewCompilerTestScope {
  const compilers = new Set<EsbuildPreviewCompiler>();
  return {
    create: (options) => {
      const compiler = new EsbuildPreviewCompiler(options);
      compilers.add(compiler);
      return compiler;
    },
    shutdown: async () => {
      const owned = [...compilers];
      compilers.clear();
      await Promise.all(owned.map((compiler) => compiler.shutdown()));
    },
  };
}
