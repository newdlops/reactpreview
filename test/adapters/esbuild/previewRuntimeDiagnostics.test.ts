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

  /** Recognizes Apollo's compact invariant URL without coupling to a version-specific error code. */
  it('classifies an Apollo compact invariant URL', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'An error occurred! See https://go.apollo.dev/c/err#encoded-details',
    );

    expect(diagnostic.kind).toBe('apollo-context');
  });

  /** Recognizes router-owned guidance while leaving route and parameter values project-owned. */
  it('classifies a React Router context failure', () => {
    const diagnostic = classifyPreviewRuntimeMessage(
      'useNavigate() may be used only in the context of a <Router> component.',
    );

    expect(diagnostic.kind).toBe('router-context');
  });

  /** Treats ambiguous theme and arbitrary render TypeErrors as generic application runtime issues. */
  it.each([
    'TypeError: props.theme.spacing is not a function',
    'Cannot read properties of undefined',
    'Unexpected component failure',
  ])('keeps an unbranded message generic: %s', (message) => {
    expect(classifyPreviewRuntimeMessage(message).kind).toBe('project-runtime');
  });

  /** Demonstrates that stack-only package words are outside the classifier contract. */
  it('does not classify a package name supplied separately from the direct message', () => {
    const directMessage = 'Rendering failed';
    const ignoredStack = 'at useSelector (/node_modules/react-redux/index.js:1:1)';

    expect(ignoredStack).toContain('react-redux');
    expect(classifyPreviewRuntimeMessage(directMessage).kind).toBe('project-runtime');
  });
});
