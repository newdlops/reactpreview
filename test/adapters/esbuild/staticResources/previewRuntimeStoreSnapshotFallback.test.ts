import { describe, expect, it } from 'vitest';
import { requiresPreviewDependencyCompatibility } from '../../../../src/adapters/esbuild/staticResources/previewDependencyCompatibility';
import { createPreviewRuntimeHookReplacements } from '../../../../src/adapters/esbuild/staticResources/previewRuntimeHookInstrumentation';

describe('preview runtime store snapshot fallback', () => {
  it('supplements a Zustand-style getState snapshot that fails a URL initialization guard', () => {
    const source = [
      "import { useSiteSettingsStore } from './site-settings-store';",
      'export function getPageUrl() {',
      '  const { siteSettings } = useSiteSettingsStore.getState();',
      '  if (!siteSettings.legalSiteUrl) {',
      '    throw new Error("siteSettings have not been initialized");',
      '  }',
      '  return siteSettings.legalSiteUrl;',
      '}',
    ].join('\n');

    const transformed = applyReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/pages-map.ts', source),
    );

    expect(transformed).toContain('useSiteSettingsStore.getState()');
    expect(transformed).toContain('"hookName":"useSiteSettingsStore.getState"');
    expect(transformed).toContain('"legalSiteUrl": "https://example.invalid/"');
    expect(transformed).toContain('"renderGuardPaths":["siteSettings.legalSiteUrl"]');
    expect(transformed).toContain('"requiredPaths":["siteSettings.legalSiteUrl"]');
    expect(requiresPreviewDependencyCompatibility(source, false)).toBe(true);
  });

  it('keeps ordinary store workflow guards at their neutral authored semantics', () => {
    const source = [
      "import { useFeatureStore } from './feature-store';",
      'export function FeaturePanel() {',
      '  const { settings } = useFeatureStore.getState();',
      '  if (!settings.enabled) return null;',
      '  return <main>{settings.label}</main>;',
      '}',
    ].join('\n');

    const transformed = applyReplacements(
      source,
      createPreviewRuntimeHookReplacements('/workspace/feature-panel.tsx', source),
    );

    expect(transformed).toContain('"enabled": false');
    expect(transformed).toContain('"label": "label"');
    expect(transformed).not.toContain('"renderGuardPaths"');
  });

  it('does not reinterpret a getState method on an arbitrary imported hook facade', () => {
    const source = [
      "import { useRemoteService } from './remote-service';",
      'export function readRemote() {',
      '  const { value } = useRemoteService.getState();',
      '  return value;',
      '}',
    ].join('\n');

    expect(createPreviewRuntimeHookReplacements('/workspace/remote.ts', source)).toEqual([]);
    expect(requiresPreviewDependencyCompatibility(source, false)).toBe(false);
  });
});

/** Applies source replacements from right to left so authored offsets remain stable. */
function applyReplacements(
  source: string,
  replacements: readonly {
    readonly end: number;
    readonly replacement: string;
    readonly start: number;
  }[],
): string {
  let rewritten = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.replacement}${rewritten.slice(replacement.end)}`;
  }
  return rewritten;
}
