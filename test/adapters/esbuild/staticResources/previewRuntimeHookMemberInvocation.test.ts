/**
 * Verifies that instrumented store/facade member calls are marked as ordinary invocations.
 * The runtime relies on this marker to avoid render-scoped React hooks when such a call executes
 * in an event handler, effect, query function, or HTTP interceptor.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('createPreviewRuntimeHookReplacements member invocations', () => {
  /** Reproduces an Axios request interceptor that reads a Zustand store outside React render. */
  it('marks a store getState() call as a member invocation', () => {
    const source = [
      "import axios from 'axios';",
      "import { useAuthStore } from '../stores/authStore';",
      "export const apiClient = axios.create({ baseURL: '/v1' });",
      'apiClient.interceptors.request.use((config) => {',
      '  const { token, company_id } = useAuthStore.getState();',
      '  if (token) config.headers.Authorization = `Bearer ${token}`;',
      "  if (company_id) config.headers['X-Company-ID'] = company_id;",
      '  return config;',
      '});',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/src/api/client.ts', source),
    );

    expect(transformed).toContain('"hookName":"useAuthStore.getState"');
    expect(transformed).toContain('"invocation":"member"');
  });

  /** Genuine hook calls keep the render-scoped subscription and therefore carry no marker. */
  it('leaves direct hook invocations unmarked', () => {
    const source = [
      "import { useAuthStore } from '../stores/authStore';",
      'export function TopBar() {',
      '  const email = useAuthStore((state) => state.email);',
      '  return <span>{email.toUpperCase()}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/src/TopBar.tsx', source),
    );

    expect(transformed).toContain('"hookName":"useAuthStore"');
    expect(transformed).not.toContain('"invocation":"member"');
  });

  /** A namespace-qualified hook is syntactically a member access but still a real hook call. */
  it('leaves namespace hook invocations unmarked', () => {
    const source = [
      "import * as Hooks from '../hooks';",
      'export function Profile() {',
      '  const { name } = Hooks.useProfile();',
      '  return <span>{name.toUpperCase()}</span>;',
      '}',
    ].join('\n');

    const transformed = applyHookReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/src/Profile.tsx', source),
    );

    expect(transformed).toContain('"hookName":"useProfile"');
    expect(transformed).not.toContain('"invocation":"member"');
  });
});

/** Applies non-overlapping replacements from the end so earlier offsets remain valid. */
function applyHookReplacements(
  source: string,
  replacements: ReturnType<typeof createPreviewRuntimeHookReplacements>,
): string {
  let transformed = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
