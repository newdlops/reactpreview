/**
 * Verifies repository-independent classification of browser runtime dependency failures.
 * Only direct error messages are accepted by the production classifier, so generated stack paths
 * and project package names cannot silently change the recovery advice.
 */
import { describe, expect, it } from 'vitest';
import { classifyPreviewRuntimeMessage } from '../../../src/adapters/esbuild/previewRuntimeDiagnostics';

describe('classifyPreviewRuntimeMessage', () => {
  /** Recognizes React Redux's public missing-context message without reading application paths. */
  it('classifies the branded React Redux provider failure', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'could not find react-redux context value; please ensure the component is wrapped in a <Provider>',
    );

    expect(diagnostic.kind).toBe('redux-context');
    expect(diagnostic.title).toBe('React Redux provider required');
  });

  /** Keeps Apollo's compact URL distinct from the narrower missing-provider public message. */
  it('classifies an Apollo compact invariant without assuming its version-specific meaning', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'An error occurred! See https://go.apollo.dev/c/err#encoded-details',
    );

    expect(diagnostic.kind).toBe('apollo-invariant');
  });

  /** Recognizes router-owned guidance while leaving route and parameter values project-owned. */
  it('classifies a React Router context failure', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'useNavigate() may be used only in the context of a <Router> component.',
    );

    expect(diagnostic.kind).toBe('router-context');
  });

  /** Recognizes Formik's public invariant without assuming project form values. */
  it('classifies a Formik context failure', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'Formik context is undefined, please verify you are calling useFormikContext() as child of a <Formik> component.',
    );

    expect(diagnostic.kind).toBe('formik-context');
    expect(diagnostic.title).toBe('Formik provider required');
  });

  /** Recognizes the JavaScript engine's generic custom-hook destructuring failure. */
  it('classifies a null custom Context hook result without a project-specific hook name', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      "Cannot destructure property 'isStaffMode' of 'useAppContext(...)' as it is null.",
    );

    expect(diagnostic.kind).toBe('custom-context');
    expect(diagnostic.title).toBe('React context value unavailable');
    expect(diagnostic.recovery).toContain('automatic demand-shaped Context boundary');
  });

  /** Recognizes a URL-state provider failure before it falls back to a generic runtime category. */
  it('classifies the use-query-params provider failure as a context dependency', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'Error: useQueryParams must be used within a QueryParamProvider',
    );

    expect(diagnostic.kind).toBe('custom-context');
    expect(diagnostic.title).toBe('React context value unavailable');
  });

  /** Recognizes explicit theme-object language while leaving arbitrary undefined reads generic. */
  it('classifies a branded theme-shape failure', () => {
    expect(
      classifyPreviewRuntimeMessage('TypeError: props.theme.spacing is not a function').kind,
    ).toBe('theme-contract');
  });

  /** Separates a missing build/bootstrap global from provider and component lifecycle failures. */
  it('classifies an undefined free runtime identifier', () => {
    const diagnostic = classifyPreviewRuntimeMessage('dayjs is not defined');

    expect(diagnostic.kind).toBe('missing-runtime-global');
    expect(diagnostic.title).toBe('Build-provided global unavailable');
    expect(diagnostic.recovery).toContain('statically proven project bootstrap globals');
  });

  /** Gives the bounded browser compatibility boundary priority over generic package advice. */
  it('classifies a missing Browserify process global without suggesting a Node runtime', () => {
    const diagnostic = classifyPreviewRuntimeMessage('ReferenceError: process is not defined');

    expect(diagnostic.kind).toBe('missing-browser-process');
    expect(diagnostic.title).toBe('Browser process compatibility unavailable');
    expect(diagnostic.recovery).toContain('without starting Node');
  });

  /** Treats ambiguous property reads and arbitrary render failures as project runtime issues. */
  it.each(['Cannot read properties of undefined', 'Unexpected component failure'])(
    'keeps an unbranded message generic: %s',
    (message) => {
      expect(classifyPreviewRuntimeMessage(message).kind).toBe('project-runtime');
    },
  );

  /** Explains a concrete nullish property read without assuming that a backend is mandatory. */
  it('classifies a missing static value independently from provider failures', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      "TypeError: Cannot read properties of undefined (reading 'value')",
    );

    expect(diagnostic.kind).toBe('missing-preview-value');
    expect(diagnostic.recovery).toContain('React Page Inspector');
    expect(diagnostic.recovery).toContain('Payloads');
    expect(
      classifyPreviewRuntimeMessage(
        "Cannot destructure property 'data' of 'result' as it is undefined.",
      ).kind,
    ).toBe('missing-preview-value');
  });

  /** Demonstrates that stack-only package words are outside the classifier contract. */
  it('does not classify a package name supplied separately from the direct message', () => {
    const directMessage = 'Rendering failed';
    const ignoredStack = 'at useSelector (/node_modules/react-redux/index.js:1:1)';

    expect(ignoredStack).toContain('react-redux');
    expect(classifyPreviewRuntimeMessage(directMessage).kind).toBe('project-runtime');
  });
});
