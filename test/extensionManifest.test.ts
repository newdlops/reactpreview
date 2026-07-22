/**
 * Guards the VS Code manifest integration exposed directly to users.
 * These assertions keep the editor context action aligned with the source, URI, and workspace
 * trust constraints enforced again by the command's runtime target resolver.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface EditorContextMenuContribution {
  /** Identifier of the already-registered extension command. */
  readonly command: string;
  /** Relative placement among VS Code's context-menu navigation actions. */
  readonly group?: string;
  /** Declarative visibility policy evaluated by VS Code for the active editor. */
  readonly when?: string;
}

interface ExtensionManifest {
  /** Explicit activation events retained for older supported VS Code versions. */
  readonly activationEvents?: readonly string[];
  /** Restricted workspace policy that permits only trust guidance before code execution. */
  readonly capabilities?: {
    readonly untrustedWorkspaces?: {
      readonly description?: string;
      readonly restrictedConfigurations?: readonly string[];
      readonly supported?: boolean | 'limited';
    };
  };
  /** VS Code contribution points relevant to these manifest integration tests. */
  readonly contributes?: {
    /** Commands made available to contribution points and command discovery. */
    readonly commands?: readonly { readonly command: string; readonly title?: string }[];
    /** Menu items keyed by their VS Code menu contribution identifier. */
    readonly menus?: {
      /** Commands visible in a text editor's context menu. */
      readonly 'editor/context'?: readonly EditorContextMenuContribution[];
    };
  };
  /** Runtime packages VSCE must retain for compiler and managed React seed environments. */
  readonly dependencies?: Readonly<Record<string, string>>;
  /** Exact build inputs copied into the versioned React 18 catalog below dist. */
  readonly devDependencies?: Readonly<Record<string, string>>;
  /** Minimum editor version required by the packaged extension-host module format. */
  readonly engines?: {
    readonly vscode?: string;
  };
  /** Packaged extension-host module loaded before `activate` can register commands. */
  readonly main?: string;
}

/**
 * Loads the checked-in package manifest without importing extension runtime code or VS Code.
 *
 * @returns Parsed manifest fields needed by contribution-point assertions.
 */
async function readExtensionManifest(): Promise<ExtensionManifest> {
  const manifestPath = path.resolve(import.meta.dirname, '..', 'package.json');
  return JSON.parse(await readFile(manifestPath, 'utf8')) as ExtensionManifest;
}

describe('extension manifest', () => {
  /** Keeps activation outside legacy workspace CommonJS hooks and permits trust-only guidance. */
  it('loads an ESM host entry and registers commands in limited Restricted Mode', async () => {
    const manifest = await readExtensionManifest();

    expect(manifest.engines?.vscode).toBe('^1.100.0');
    expect(manifest.main).toBe('./dist/extension.mjs');
    expect(manifest.dependencies).toMatchObject({
      '@yarnpkg/parsers': '3.0.3',
      esbuild: '0.28.1',
      react: '19.2.7',
      'react-dom': '19.2.7',
      tar: '7.5.20',
    });
    expect(manifest.devDependencies).toMatchObject({
      'react-preview-react-18': 'npm:react@18.3.1',
      'react-preview-react-dom-18': 'npm:react-dom@18.3.1',
      'react-preview-scheduler-18': 'npm:scheduler@0.23.2',
    });
    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining([
        'onCommand:reactPreview.open',
        'onCommand:reactPreview.openPageInspector',
        'onCommand:reactPreview.openComponentGallery',
        'onCommand:reactPreview.refresh',
      ]),
    );
    expect(manifest.capabilities?.untrustedWorkspaces).toEqual({
      description:
        'Preview commands explain the trust requirement, but bundling and executing workspace code remain disabled until the workspace is trusted.',
      restrictedConfigurations: [
        'reactPreview.tsconfig',
        'reactPreview.setupFile',
        'reactPreview.useStorybookPreview',
      ],
      supported: 'limited',
    });
  });

  it('exposes actual page context as the primary trusted source-editor action', async () => {
    const manifest = await readExtensionManifest();
    const registeredCommands = manifest.contributes?.commands?.map(({ command }) => command);
    const primaryCommand = manifest.contributes?.commands?.find(
      ({ command }) => command === 'reactPreview.open',
    );
    const contextContribution = manifest.contributes?.menus?.['editor/context']?.find(
      ({ command }) => command === 'reactPreview.open',
    );

    expect(registeredCommands).toContain('reactPreview.open');
    expect(primaryCommand?.title).toBe('Open Current React File in Page Context');
    expect(contextContribution).toEqual({
      command: 'reactPreview.open',
      group: 'navigation@10',
      when: 'isWorkspaceTrusted && (resourceScheme == file || resourceScheme == vscode-remote) && (editorLangId == javascript || editorLangId == javascriptreact || editorLangId == typescript || editorLangId == typescriptreact)',
    });
  });

  /** Keeps the direct export gallery as a secondary source-editor action. */
  it('exposes the component gallery beside the primary page-context action', async () => {
    const manifest = await readExtensionManifest();
    const registeredCommands = manifest.contributes?.commands?.map(({ command }) => command);
    const galleryCommand = manifest.contributes?.commands?.find(
      ({ command }) => command === 'reactPreview.openComponentGallery',
    );
    const contextContribution = manifest.contributes?.menus?.['editor/context']?.find(
      ({ command }) => command === 'reactPreview.openComponentGallery',
    );

    expect(registeredCommands).toContain('reactPreview.openComponentGallery');
    expect(galleryCommand?.title).toBe('Open Current File Export Gallery');
    expect(contextContribution).toEqual({
      command: 'reactPreview.openComponentGallery',
      group: 'navigation@11',
      when: 'isWorkspaceTrusted && (resourceScheme == file || resourceScheme == vscode-remote) && (editorLangId == javascript || editorLangId == javascriptreact || editorLangId == typescript || editorLangId == typescriptreact)',
    });
  });
});
