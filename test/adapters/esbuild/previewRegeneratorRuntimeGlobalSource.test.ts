/**
 * Executes the legacy-regenerator compatibility source in isolated strict JavaScript realms.
 * The fixture reproduces Babel's CSP-sensitive fallback without importing a project dependency.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewRegeneratorRuntimeGlobalSource } from '../../../src/adapters/esbuild/previewRegeneratorRuntimeGlobalSource';

const execFileAsync = promisify(execFile);

/** Result returned after reproducing the legacy assignment and forbidden recovery branch. */
interface RegeneratorAssignmentResult {
  readonly dynamicFunctionCalls: number;
  readonly installedRuntime: unknown;
  readonly slotEnumerable: boolean;
  readonly slotWritable: boolean;
  readonly status: string;
}

/**
 * Evaluates the generated initializer before the exact strict assignment shape used by Babel.
 * A local `Function` replacement makes the test fail if the CSP-incompatible branch is entered.
 */
async function executeStrictLegacyAssignment(): Promise<RegeneratorAssignmentResult> {
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `
      ${createPreviewRegeneratorRuntimeGlobalSource()}
      const status = initializePreviewRegeneratorRuntimeGlobal();
      const runtime = Object.freeze({ marker: 'PACKAGE_RUNTIME' });
      let dynamicFunctionCalls = 0;
      const Function = () => {
        dynamicFunctionCalls += 1;
        throw new EvalError('unsafe-eval is disabled');
      };
      try {
        regeneratorRuntime = runtime;
      } catch (accidentalStrictMode) {
        Function('r', 'regeneratorRuntime = r')(runtime);
      }
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'regeneratorRuntime');
      console.log(JSON.stringify({
        dynamicFunctionCalls,
        installedRuntime: globalThis.regeneratorRuntime,
        slotEnumerable: descriptor.enumerable,
        slotWritable: descriptor.writable,
        status,
      }));
    `,
  ]);
  return JSON.parse(stdout) as RegeneratorAssignmentResult;
}

describe('preview regenerator runtime global source', () => {
  /** Proves a strict free assignment succeeds without weakening CSP or invoking dynamic code. */
  it('keeps the legacy Babel Function fallback unreachable', async () => {
    const result = await executeStrictLegacyAssignment();

    expect(result.dynamicFunctionCalls).toBe(0);
    expect(result.installedRuntime).toEqual({ marker: 'PACKAGE_RUNTIME' });
    expect(result.slotEnumerable).toBe(false);
    expect(result.slotWritable).toBe(true);
    expect(result.status).toContain('CSP-safe bootstrap slot installed');
  });

  /** Keeps an application- or host-provided runtime authoritative across preview initialization. */
  it('preserves an existing regenerator runtime binding', () => {
    const existingRuntime = { marker: 'AUTHORED_RUNTIME' };
    const context = createContext({ regeneratorRuntime: existingRuntime });
    const result = runInContext(
      `(() => {
        ${createPreviewRegeneratorRuntimeGlobalSource()}
        return {
          runtime: globalThis.regeneratorRuntime,
          status: initializePreviewRegeneratorRuntimeGlobal(),
        };
      })()`,
      context,
    ) as { readonly runtime: unknown; readonly status: string };

    expect(result.runtime).toBe(existingRuntime);
    expect(result.status).toContain('preserved an existing browser runtime binding');
  });
});
