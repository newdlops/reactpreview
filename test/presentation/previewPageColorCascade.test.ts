/** Checks browser-computed page colors across authored CSS layers and editor theme changes. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCompiledPreviewHeadlessly } from '../../src/adapters/node/previewHeadlessRenderer';
import type { PreviewBuildRequest, PreviewBundle } from '../../src/domain/preview';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT_COLORS = `
@layer theme, base, utilities;
@layer theme {
  :root { --background: #fff; --foreground: #212529; }
  :root.dark { --background: #181818; --foreground: #f8f9fa; }
}
@layer base {
  :root { color-scheme: light; }
  :root.dark { color-scheme: dark; }
  body { background-color: var(--background); color: var(--foreground); }
  button { color: inherit; }
}
`;

describe('preview page color cascade', () => {
  it('preserves layered page tokens through light, dark, host-theme, and light-return states', async () => {
    const colors = await renderColors(
      PROJECT_COLORS,
      `
record('light');
document.documentElement.classList.add('dark');
await frame();
record('dark');
document.documentElement.style.setProperty('--vscode-editor-foreground', '#ff00ff');
document.documentElement.style.setProperty('--vscode-editor-background', '#00ffff');
await frame();
record('editor-change');
document.documentElement.classList.remove('dark');
await frame();
record('light-return');
`,
    );
    expect(colors).toEqual([
      color('light', 'rgb(33, 37, 41)', 'rgb(255, 255, 255)', 'light'),
      color('dark', 'rgb(248, 249, 250)', 'rgb(24, 24, 24)', 'dark'),
      color('editor-change', 'rgb(248, 249, 250)', 'rgb(24, 24, 24)', 'dark'),
      color('light-return', 'rgb(33, 37, 41)', 'rgb(255, 255, 255)', 'light'),
    ]);
  });

  it('keeps a readable bare page while allowing unlayered app colors to take precedence', async () => {
    const colors = await renderColors(
      undefined,
      `
record('bare');
document.documentElement.style.setProperty('--vscode-editor-foreground', '#ff00ff');
await frame();
record('editor-change');
const authored = document.createElement('style');
authored.textContent = 'body { color: #123456; background-color: #abcdef; }';
document.head.append(authored);
await frame();
record('authored');
`,
    );
    expect(
      colors.map(({ label, foreground, background }) => ({ label, foreground, background })),
    ).toEqual([
      { label: 'bare', foreground: 'rgb(17, 17, 17)', background: 'rgb(255, 255, 255)' },
      { label: 'editor-change', foreground: 'rgb(17, 17, 17)', background: 'rgb(255, 255, 255)' },
      { label: 'authored', foreground: 'rgb(18, 52, 86)', background: 'rgb(171, 205, 239)' },
    ]);
  });
});

/** One observed browser state, including inherited heading color and native-control scheme. */
interface ColorObservation {
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  readonly heading: string;
  readonly scheme: string;
}

/** Creates the expected body/heading pair without tying assertions to a stylesheet implementation. */
function color(
  label: string,
  foreground: string,
  background: string,
  scheme: string,
): ColorObservation {
  return { label, foreground, background, heading: foreground, scheme };
}

/** Executes generated HTML with VS Code's initial default layer and returns actual CSS values. */
async function renderColors(
  stylesheet: string | undefined,
  scenario: string,
): Promise<ColorObservation[]> {
  const sourceText = `
const mount = document.querySelector('[data-react-preview-mount]');
const api = acquireVsCodeApi();
const revision = Number(mount.dataset.reactPreviewRuntimeRevision);
const token = mount.dataset.reactPreviewRuntimeToken;
void (async () => {
  try {
    const editor = document.createElement('style');
    editor.textContent = '@layer vscode-default { body { background-color: transparent; color: var(--vscode-editor-foreground); } }';
    document.head.prepend(editor);
    document.documentElement.style.setProperty('--vscode-editor-foreground', '#eeeeee');
    document.documentElement.style.setProperty('--vscode-editor-background', '#222222');
    mount.innerHTML = '<h1>Authored page</h1>';
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const records = [];
    const record = label => {
      const body = getComputedStyle(document.body);
      records.push({ label, foreground: body.color, background: body.backgroundColor,
        heading: getComputedStyle(mount.querySelector('h1')).color,
        scheme: getComputedStyle(document.documentElement).colorScheme });
    };
    await frame();
    ${scenario}
    mount.innerHTML = '<output data-colors="' + btoa(JSON.stringify(records)) + '">PAGE_COLORS</output>';
    api.postMessage({revision, token, type: 'react-preview-runtime-ready'});
  } catch (error) {
    mount.textContent = error.stack;
    api.postMessage({revision, token, type: 'react-preview-runtime-failed'});
  }
})();
`;
  const bundle: PreviewBundle = {
    javascript: new TextEncoder().encode(sourceText),
    chunks: [],
    dependencies: [],
    diagnostics: [],
    watchDirectories: [],
    contextCoverage: 'partial',
    ...(stylesheet === undefined ? {} : { stylesheet: new TextEncoder().encode(stylesheet) }),
  };
  const request: PreviewBuildRequest = {
    workspaceRoot: ROOT,
    documentPath: path.join(ROOT, 'test/fixtures/page-colors.tsx'),
    sourceText,
    dependencySnapshots: [],
    language: 'tsx',
  };
  const rendered = await renderCompiledPreviewHeadlessly(bundle, request);
  expect(rendered.status, rendered.protocolError).toBe('ready');
  expect(rendered.evidence.windowErrors).toEqual([]);
  expect(rendered.evidence.cdpExceptions ?? []).toEqual([]);
  expect(rendered.cleanup).toEqual({
    browserTerminated: true,
    profileRemoved: true,
    serverClosed: true,
  });
  const encoded = /data-colors="([^"]+)"/u.exec(rendered.rootHtml)?.[1];
  expect(encoded).toBeDefined();
  return JSON.parse(Buffer.from(encoded ?? '', 'base64').toString()) as ColorObservation[];
}
