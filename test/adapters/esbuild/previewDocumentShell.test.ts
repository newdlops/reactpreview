/** Exercises safe static HTML-shell parsing independently from VS Code webview rendering. */
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { parsePreviewDocumentShell } from '../../../src/adapters/esbuild/previewDocumentShell';
import { createPreviewDocumentShellRuntimeSource } from '../../../src/adapters/esbuild/previewDocumentShellRuntimeSource';

describe('parsePreviewDocumentShell', () => {
  /** Preserves selector/layout attributes while excluding executable and unrelated document data. */
  it('extracts html, body, and preferred React mount attributes', () => {
    const shell = parsePreviewDocumentShell(`<!doctype html>
      <html lang="ko" dir="ltr" onload="unsafe()">
        <body class="body normal" data-tenant="preview" aria-label="ignored">
          <div id="splash"></div>
          <main id="root" class="application-shell" style="min-height: 100vh"></main>
        </body>
      </html>`);

    expect(shell).toEqual({
      bodyAttributes: [
        { name: 'class', value: 'body normal' },
        { name: 'data-tenant', value: 'preview' },
      ],
      htmlAttributes: [
        { name: 'lang', value: 'ko' },
        { name: 'dir', value: 'ltr' },
      ],
      rootAttributes: [
        { name: 'id', value: 'root' },
        { name: 'class', value: 'application-shell' },
        { name: 'style', value: 'min-height: 100vh' },
      ],
    });
  });

  /** Encodes values as data for DOM APIs rather than copying authored HTML into the webview. */
  it('generates an idempotent DOM-attribute adapter', () => {
    const shell = parsePreviewDocumentShell(
      '<html lang="ko"><body class="body"><div id="root"></div></body></html>',
    );
    const source = createPreviewDocumentShellRuntimeSource(shell);

    expect(source).toContain('initializePreviewDocumentShell');
    expect(source).toContain('applyPreviewDocumentAttributes');
    expect(source).toContain('"bodyAttributes":[{"name":"class","value":"body"}]');
    expect(source).toContain('"rootAttributes":[{"name":"id","value":"root"}]');
    expect(source).not.toContain('<body');
  });

  /** Serializes only safe proven portal IDs and creates missing hosts through inert DOM APIs. */
  it('generates bounded portal hosts before project modules load', () => {
    const source = createPreviewDocumentShellRuntimeSource(undefined, [
      'toast-root',
      'bottom-sheet-root',
      'toast-root',
      'invalid id',
    ]);

    expect(source).toContain('const previewPortalHostIds = ["bottom-sheet-root","toast-root"]');
    expect(source).toContain('initializePreviewPortalHosts(previous.portalHosts ?? [])');
    expect(source).toContain("host.setAttribute?.('id', hostId)");
    expect(source).toContain(
      'host.setAttribute?.(previewPortalHostMarker, previewPortalHostOwner)',
    );
    expect(source).not.toContain('invalid id');
  });

  /** Removes stale adapter-owned nodes across revisions without touching authored replacements. */
  it('reconciles only extension-owned portal hosts during hot rebuilds', () => {
    const document = new FakePreviewDocument();
    const mountNode = document.createElement('main');
    const projectHost = document.createElement('div');
    projectHost.setAttribute('id', 'project-root');
    projectHost.setAttribute(PORTAL_HOST_MARKER, 'newdlops.react-file-preview');
    document.body.append(projectHost);
    const runtimeContext = { document, mountNode };

    executeDocumentShellRevision(
      createPreviewDocumentShellRuntimeSource(undefined, [
        'project-root',
        'replaced-root',
        'stale-root',
      ]),
      runtimeContext,
    );
    const replacedExtensionHost = document.getElementById('replaced-root');
    expect(replacedExtensionHost).not.toBeNull();
    replacedExtensionHost?.remove();
    const authoredReplacement = document.createElement('section');
    authoredReplacement.setAttribute('id', 'replaced-root');
    authoredReplacement.setAttribute(PORTAL_HOST_MARKER, 'newdlops.react-file-preview');
    document.body.append(authoredReplacement);

    executeDocumentShellRevision(
      createPreviewDocumentShellRuntimeSource(undefined, ['next-root']),
      runtimeContext,
    );

    expect(document.getElementById('stale-root')).toBeNull();
    expect(document.getElementById('project-root')).toBe(projectHost);
    expect(document.getElementById('replaced-root')).toBe(authoredReplacement);
    expect(document.getElementById('next-root')?.getAttribute(PORTAL_HOST_MARKER)).toBe(
      'newdlops.react-file-preview',
    );
  });
});

const PORTAL_HOST_MARKER = 'data-react-preview-portal-host';

/** Minimal mutable DOM element supporting the exact APIs exercised by the generated runtime. */
class FakePreviewElement {
  private readonly attributes = new Map<string, string>();
  public readonly children: FakePreviewElement[] = [];
  private parent: FakePreviewElement | undefined;

  /** Creates a detached fake node with one stable diagnostic tag name. */
  public constructor(public readonly tagName: string) {}

  /** Adds one child while retaining enough ownership information for `remove()`. */
  public append(child: FakePreviewElement): void {
    child.parent = this;
    this.children.push(child);
  }

  /** Returns an exact authored/runtime attribute or null like the browser DOM. */
  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /** Removes this exact object from its current parent without touching same-ID siblings. */
  public remove(): void {
    if (this.parent === undefined) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = undefined;
  }

  /** Supports shell attribute cleanup even though this fixture uses an empty document shell. */
  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** Stores inert string attributes exactly as `HTMLElement.setAttribute` would. */
  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

/** Small document tree that resolves IDs by live element identity in deterministic traversal order. */
class FakePreviewDocument {
  public readonly documentElement = new FakePreviewElement('html');
  public readonly body = new FakePreviewElement('body');

  /** Creates the fixed html/body hierarchy required by the document-shell runtime. */
  public constructor() {
    this.documentElement.append(this.body);
  }

  /** Creates one detached element for the generated portal-host adapter. */
  public createElement(tagName: string): FakePreviewElement {
    return new FakePreviewElement(tagName);
  }

  /** Searches the live fake document and never returns a previously removed extension node. */
  public getElementById(id: string): FakePreviewElement | null {
    const pending = [this.documentElement];
    while (pending.length > 0) {
      const element = pending.shift();
      if (element === undefined) break;
      if (element.getAttribute('id') === id) return element;
      pending.unshift(...element.children);
    }
    return null;
  }
}

/** Evaluates one generated revision in an isolated module-like scope over a persistent page global. */
function executeDocumentShellRevision(
  source: string,
  context: { readonly document: FakePreviewDocument; readonly mountNode: FakePreviewElement },
): void {
  runInNewContext(`(() => { ${source}\ninitializePreviewDocumentShell(mountNode); })()`, context);
}
