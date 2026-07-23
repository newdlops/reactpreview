import { describe, expect, it } from 'vitest';
import { requiresFastDependencyCompatibility } from '../../../../src/adapters/esbuild/staticResources/previewFastDependencyCompatibility';

/** Verifies the provisional native-parser boundary remains fast without dropping mount contracts. */
describe('requiresFastDependencyCompatibility', () => {
  /** Plain TSX and literal lazy imports are native esbuild inputs and need no preview AST pass. */
  it('passes ordinary component dependencies through', () => {
    expect(
      requiresFastDependencyCompatibility(
        `import('./Panel').then((module) => module.Panel); export const Card = () => <article />;`,
        false,
      ),
    ).toBe(false);
  });

  /** Provider consumers retain automatic boundaries during the provisional first render. */
  it.each(['react-router-dom', 'formik', 'useAppContext', 'react-redux'])(
    'retains the %s runtime boundary',
    (token) => {
      expect(requiresFastDependencyCompatibility(`const value = ${token};`, false)).toBe(true);
    },
  );

  /** Dynamic resource patterns still require finite filesystem expansion before esbuild runs. */
  it('retains non-native resource macros', () => {
    expect(
      requiresFastDependencyCompatibility(
        'const pages = import.meta.glob("./pages/*.tsx");',
        false,
      ),
    ).toBe(true);
    expect(
      requiresFastDependencyCompatibility('const page = import(`./pages/${name}.tsx`);', false),
    ).toBe(true);
  });

  /** Next metadata remains a compile-time contract only when the selected project uses Next. */
  it('scopes metadata compatibility to Next projects', () => {
    const source = 'export const metadata = { title: "Preview" };';
    expect(requiresFastDependencyCompatibility(source, false)).toBe(false);
    expect(requiresFastDependencyCompatibility(source, true)).toBe(true);
  });
});
