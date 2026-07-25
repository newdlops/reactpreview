/** Verifies safe render-library registration recovery without evaluating an application entry. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorRenderBootstrapSlice } from '../../../../src/adapters/esbuild/inspector';

const ENTRY_PATH = '/workspace/application/index.tsx';

describe('collectPreviewInspectorRenderBootstrapSlice', () => {
  /** Keeps a static dependency registry call while dropping unrelated entry behavior. */
  it('extracts same-package module registration as a standalone ESM slice', () => {
    const slice = collectPreviewInspectorRenderBootstrapSlice(
      ENTRY_PATH,
      `
        import { Registry, VisualPlugin, LicenseManager } from 'visual-library';
        import { createRoot } from 'react-dom/client';
        import App from './App';

        const licenseKey = window.APP_LICENSE_KEY;
        if (licenseKey) LicenseManager.setLicenseKey(licenseKey);
        Registry.register([VisualPlugin]);
        createRoot(document.getElementById('root')!).render(<App />);
      `,
    );

    expect(slice).toMatchObject({ sourcePath: ENTRY_PATH, statementCount: 1 });
    expect(slice?.source).toContain('import { Registry as Registry } from "visual-library";');
    expect(slice?.source).toContain(
      'import { VisualPlugin as VisualPlugin } from "visual-library";',
    );
    expect(slice?.source).toContain('Registry.register([VisualPlugin]);');
    expect(slice?.source).not.toContain('LicenseManager');
    expect(slice?.source).not.toContain('createRoot');
    expect(slice?.source).not.toContain('window.APP_LICENSE_KEY');
  });

  /** Treats dependency subpaths as one package while preserving their exact import requests. */
  it('supports plugin registration imported through a dependency subpath', () => {
    const slice = collectPreviewInspectorRenderBootstrapSlice(
      ENTRY_PATH,
      `
        import Engine from 'render-engine';
        import LayoutPlugin from 'render-engine/plugins/layout';
        Engine.use(LayoutPlugin);
      `,
    );

    expect(slice?.statementCount).toBe(1);
    expect(slice?.source).toContain('import { default as Engine } from "render-engine";');
    expect(slice?.source).toContain(
      'import { default as LayoutPlugin } from "render-engine/plugins/layout";',
    );
    expect(slice?.source).toContain('Engine.use(LayoutPlugin);');
  });

  /** Refuses local state, SDK configuration, cross-package values, and relative project modules. */
  it('rejects calls that can execute application-specific initialization', () => {
    const slice = collectPreviewInspectorRenderBootstrapSlice(
      ENTRY_PATH,
      `
        import Analytics from 'analytics-sdk';
        import { Registry } from 'visual-library';
        import { ForeignPlugin } from 'another-library';
        import { LocalPlugin } from './plugins';

        const configuration = { key: window.RUNTIME_KEY };
        Analytics.init({ key: 'public-key' });
        Registry.register([ForeignPlugin]);
        Registry.register([LocalPlugin]);
        Registry.register(configuration);
      `,
    );

    expect(slice).toBeUndefined();
  });

  /** Leaves nested callbacks and computed expressions out of the generated registration module. */
  it('requires data-only registration arguments', () => {
    const slice = collectPreviewInspectorRenderBootstrapSlice(
      ENTRY_PATH,
      `
        import { Registry, Plugin } from 'visual-library';
        Registry.register([Plugin.configure()]);
        Registry.register([{ plugin: Plugin, enabled: readFlag() }]);
      `,
    );

    expect(slice).toBeUndefined();
  });
});
