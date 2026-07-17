/**
 * Serializes a Context-hook call through the optional Page Inspector circuit breaker.
 *
 * The same transformed source can run in the lightweight gallery, where no Inspector API exists,
 * and in Page Inspector, where thrown/nullish/partially missing values can be completed. Keeping
 * this protocol expression outside the Context analyzer avoids mixing source inference with runtime
 * policy and keeps the already-large analyzer below the project file-length limit.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

const INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

/** Source facts required to identify one imported Context-hook invocation. */
export interface ReactContextHookRuntimeReplacementOptions {
  /** One-based source column shown in Inspector diagnostics. */
  readonly column: number;
  /** Module-level binding that owns the deeply frozen demand-shaped fallback. */
  readonly fallbackBinding: string;
  /** Imported hook callee text, such as `useAppContext`. */
  readonly hookName: string;
  /** One-based source line shown in Inspector diagnostics. */
  readonly line: number;
  /** Unchanged authored hook-call expression, including type arguments. */
  readonly originalCall: string;
  /** Absolute project source path retained only in the local webview diagnostic. */
  readonly sourcePath: string;
  /** Original source offset used to disambiguate repeated calls on the same line. */
  readonly start: number;
}

/**
 * Creates an expression that executes the authored hook exactly once in either preview mode.
 *
 * Page Inspector invokes its synchronous resolver with thunks so provider exceptions can be cut.
 * Other preview modes preserve the historical `hookCall ?? fallback` behavior. The API lookup is
 * stable for the lifetime of a generated entry, so the same hook branch runs on every render.
 *
 * @param options Static callsite facts and the generated fallback binding.
 * @returns Parenthesized JavaScript/TypeScript expression replacing the original call.
 */
export function createReactContextHookRuntimeReplacement(
  options: ReactContextHookRuntimeReplacementOptions,
): string {
  const normalizedSourcePath = path.normalize(options.sourcePath);
  const metadata = {
    column: options.column,
    evidence: 'required imported Context hook value paths',
    fallbackLabel: 'generated Context value',
    hookName: options.hookName,
    id: createHash('sha256')
      .update(
        JSON.stringify([
          normalizedSourcePath,
          options.hookName,
          options.start,
          options.fallbackBinding,
        ]),
      )
      .digest('hex')
      .slice(0, 24),
    line: options.line,
    moduleSpecifier: 'project Context hook',
    sourcePath: normalizedSourcePath,
  };
  const api = `globalThis[Symbol.for(${JSON.stringify(INSPECTOR_API_SYMBOL)})]`;
  return `((__reactPreviewContextApi) => typeof __reactPreviewContextApi?.resolveRuntimeHook === 'function' ? __reactPreviewContextApi.resolveRuntimeHook(() => (${options.originalCall}), () => (${options.fallbackBinding}), ${JSON.stringify(metadata)}) : (${options.originalCall} ?? ${options.fallbackBinding}))(${api})`;
}
