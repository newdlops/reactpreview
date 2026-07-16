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
  /** VS Code contribution points relevant to these manifest integration tests. */
  readonly contributes?: {
    /** Commands made available to contribution points and command discovery. */
    readonly commands?: readonly { readonly command: string }[];
    /** Menu items keyed by their VS Code menu contribution identifier. */
    readonly menus?: {
      /** Commands visible in a text editor's context menu. */
      readonly 'editor/context'?: readonly EditorContextMenuContribution[];
    };
  };
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
  it('exposes the existing open command in supported trusted source-editor context menus', async () => {
    const manifest = await readExtensionManifest();
    const registeredCommands = manifest.contributes?.commands?.map(({ command }) => command);
    const contextContribution = manifest.contributes?.menus?.['editor/context']?.find(
      ({ command }) => command === 'reactPreview.open',
    );

    expect(registeredCommands).toContain('reactPreview.open');
    expect(contextContribution).toEqual({
      command: 'reactPreview.open',
      group: 'navigation@10',
      when: 'isWorkspaceTrusted && (resourceScheme == file || resourceScheme == vscode-remote) && (editorLangId == javascript || editorLangId == javascriptreact || editorLangId == typescript || editorLangId == typescriptreact)',
    });
  });

  /** Exposes the opt-in actual-parent inspector beside the safe component preview action. */
  it('exposes the page inspector in the same supported source-editor contexts', async () => {
    const manifest = await readExtensionManifest();
    const registeredCommands = manifest.contributes?.commands?.map(({ command }) => command);
    const contextContribution = manifest.contributes?.menus?.['editor/context']?.find(
      ({ command }) => command === 'reactPreview.openPageInspector',
    );

    expect(registeredCommands).toContain('reactPreview.openPageInspector');
    expect(contextContribution).toEqual({
      command: 'reactPreview.openPageInspector',
      group: 'navigation@11',
      when: 'isWorkspaceTrusted && (resourceScheme == file || resourceScheme == vscode-remote) && (editorLangId == javascript || editorLangId == javascriptreact || editorLangId == typescript || editorLangId == typescriptreact)',
    });
  });
});
