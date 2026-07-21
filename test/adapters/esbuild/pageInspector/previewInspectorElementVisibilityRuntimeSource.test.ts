/** Verifies reversible exact-host hiding without mounting project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorElementVisibilityRuntimeSource,
  PREVIEW_INSPECTOR_HIDDEN_ELEMENT_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorElementVisibilityRuntimeSource';

const HIDDEN_ATTRIBUTE = 'data-newdlops-react-preview-hidden';

/** Minimal mutable style declaration required by the retained highlight compatibility functions. */
class FakeStyleDeclaration {
  private readonly properties = new Map<string, { priority: string; value: string }>();

  /** Reads one synthetic inline declaration. */
  getPropertyValue(name: string): string {
    return this.properties.get(name)?.value ?? '';
  }

  /** Reads one synthetic inline priority. */
  getPropertyPriority(name: string): string {
    return this.properties.get(name)?.priority ?? '';
  }

  /** Removes one synthetic inline declaration. */
  removeProperty(name: string): void {
    this.properties.delete(name);
  }

  /** Stores one synthetic inline declaration. */
  setProperty(name: string, value: string, priority = ''): void {
    this.properties.set(name, { priority, value });
  }
}

/** Small element tree supporting exact attributes, element-child paths, and connection changes. */
class FakeElement {
  readonly children: FakeElement[] = [];
  readonly localName: string;
  readonly nodeType = 1;
  readonly style = new FakeStyleDeclaration();
  readonly tagName: string;
  isConnected = true;
  parentElement: FakeElement | undefined = undefined;
  parentNode: FakeElement | undefined = undefined;
  textContent = '';
  private readonly attributes = new Map<string, string>();

  /** Creates one lower/uppercase DOM tag spelling pair. */
  constructor(tagName: string) {
    this.localName = tagName.toLocaleLowerCase();
    this.tagName = tagName.toLocaleUpperCase();
  }

  /** Appends a connected element child. */
  append(child: FakeElement): void {
    child.parentElement = this;
    child.parentNode = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
  }

  /** Implements the bounded ancestry check used by locator creation. */
  contains(candidate: FakeElement): boolean {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  /** Finds Inspector-owned ancestors while declining arbitrary selectors. */
  closest(selector: string): FakeElement | null {
    if (
      selector === '[data-react-preview-inspector-ui]' &&
      this.getAttribute('data-react-preview-inspector-ui') !== null
    ) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  /** Supplies a measurable host marker to the normalizer. */
  getBoundingClientRect(): Record<string, number> {
    return { bottom: 10, height: 10, left: 0, right: 10, top: 0, width: 10 };
  }

  /** Reads one exact attribute. */
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /** Disconnects this style/host from its current parent. */
  remove(): void {
    if (this.parentElement !== undefined) {
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
    }
    this.parentElement = undefined;
    this.parentNode = undefined;
    this.isConnected = false;
  }

  /** Removes one exact attribute. */
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** Stores one exact attribute. */
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

/** Fiber snapshot subset consumed by remount locator reconciliation. */
interface VisibilitySnapshot {
  readonly hostNodesById: Map<string, FakeElement[]>;
  readonly nodeById: Map<string, VisibilityTreeNode>;
}

/** Component identity paired with selected host roots. */
interface VisibilityTreeNode {
  readonly id: string;
  readonly name: string;
}

/** Generated runtime behavior exposed to tests from the isolated VM realm. */
interface VisibilityRuntime {
  readonly canHide: () => boolean;
  readonly count: (treeNodeId: string) => number;
  readonly hide: () => boolean;
  readonly readOutline: (element: FakeElement) => {
    readonly offset: string;
    readonly offsetPriority: string;
    readonly outline: string;
    readonly outlinePriority: string;
  };
  readonly readPickerEnabled: () => boolean;
  readonly readStyle: () => { readonly connected: boolean; readonly text: string } | undefined;
  readonly reconcile: () => void;
  readonly refreshHighlight: () => void;
  readonly remember: (
    element: FakeElement,
    snapshot: VisibilitySnapshot,
    selection: { readonly hostNodes: FakeElement[]; readonly node: VisibilityTreeNode },
  ) => void;
  readonly restoreAll: () => number;
  readonly restoreLast: () => boolean;
  readonly setContext: (value: string) => void;
  readonly setHighlightEnabled: (enabled: boolean) => void;
  readonly selectTreeNode: (treeNodeId: string) => void;
  readonly setSnapshot: (snapshot: VisibilitySnapshot) => void;
  readonly summaries: () => readonly { readonly id: string; readonly label: string }[];
}

describe('Preview Inspector picked-element visibility runtime', () => {
  /** Hides exact picked hosts successively and restores the extension marker without style loss. */
  it('hides one picked element at a time and restores last or all', () => {
    const fixture = createVisibilityFixture();
    const first = new FakeElement('button');
    const second = new FakeElement('a');
    first.setAttribute(HIDDEN_ATTRIBUTE, 'project-owned');
    first.setAttribute('id', 'primary-action');
    second.setAttribute('data-testid', 'secondary-action');
    fixture.root.append(first);
    fixture.root.append(second);

    fixture.runtime.remember(first, fixture.snapshot, fixture.selection);
    expect(fixture.runtime.canHide()).toBe(true);
    expect(fixture.runtime.hide()).toBe(true);
    const firstHiddenId = first.getAttribute(HIDDEN_ATTRIBUTE);
    expect(firstHiddenId).toMatch(/^rpi-hidden-/u);
    if (firstHiddenId === null) throw new Error('First hidden record ID was not applied.');
    expect(fixture.runtime.readPickerEnabled()).toBe(true);

    fixture.runtime.remember(second, fixture.snapshot, fixture.selection);
    expect(fixture.runtime.hide()).toBe(true);
    const secondHiddenId = second.getAttribute(HIDDEN_ATTRIBUTE);
    if (secondHiddenId === null) throw new Error('Second hidden record ID was not applied.');
    expect(fixture.runtime.summaries()).toHaveLength(2);
    expect(fixture.runtime.count('component')).toBe(2);
    expect(fixture.runtime.readStyle()?.text).toContain(
      '[' + HIDDEN_ATTRIBUTE + '="' + firstHiddenId + '"]',
    );
    expect(fixture.runtime.readStyle()?.text).toContain(
      '[' + HIDDEN_ATTRIBUTE + '="' + secondHiddenId + '"]',
    );
    expect(fixture.runtime.readStyle()?.text).not.toContain('^=');

    expect(fixture.runtime.restoreLast()).toBe(true);
    expect(second.getAttribute(HIDDEN_ATTRIBUTE)).toBeNull();
    expect(first.getAttribute(HIDDEN_ATTRIBUTE)).toBe(firstHiddenId);
    expect(fixture.runtime.restoreAll()).toBe(1);
    expect(first.getAttribute(HIDDEN_ATTRIBUTE)).toBe('project-owned');
    expect(fixture.runtime.readStyle()).toBeUndefined();
  });

  /** Rebinds exact roots and strongly identified descendants after a React/HMR host replacement. */
  it('reapplies safe locators after remount while preserving the hot session', () => {
    const fixture = createVisibilityFixture();
    const original = new FakeElement('button');
    original.setAttribute('id', 'save-action');
    fixture.root.append(original);
    fixture.runtime.remember(original, fixture.snapshot, fixture.selection);
    fixture.runtime.hide();
    const hiddenId = original.getAttribute(HIDDEN_ATTRIBUTE);

    original.isConnected = false;
    fixture.root.isConnected = false;
    const replacementRoot = new FakeElement('main');
    const replacement = new FakeElement('button');
    replacement.setAttribute('id', 'save-action');
    replacementRoot.append(replacement);
    const replacementSnapshot = createSnapshot(replacementRoot);
    fixture.runtime.setSnapshot(replacementSnapshot);
    fixture.runtime.reconcile();

    expect(replacement.getAttribute(HIDDEN_ATTRIBUTE)).toBe(hiddenId);
    expect(fixture.runtime.summaries()).toHaveLength(1);
  });

  /** Declines ambiguous same-tag descendants instead of hiding a different sibling after reorder. */
  it('fails closed when a nested picked host has no strong remount identity', () => {
    const fixture = createVisibilityFixture();
    const ambiguous = new FakeElement('button');
    fixture.root.append(ambiguous);
    fixture.runtime.remember(ambiguous, fixture.snapshot, fixture.selection);
    fixture.runtime.hide();

    ambiguous.isConnected = false;
    fixture.root.isConnected = false;
    const replacementRoot = new FakeElement('main');
    const firstReplacement = new FakeElement('button');
    const secondReplacement = new FakeElement('button');
    replacementRoot.append(firstReplacement);
    replacementRoot.append(secondReplacement);
    fixture.runtime.setSnapshot(createSnapshot(replacementRoot));
    fixture.runtime.reconcile();

    expect(firstReplacement.getAttribute(HIDDEN_ATTRIBUTE)).toBeNull();
    expect(secondReplacement.getAttribute(HIDDEN_ATTRIBUTE)).toBeNull();
    expect(fixture.runtime.summaries()).toHaveLength(1);
  });

  /** Never lets the page picker hide the extension-owned Inspector toolbar or its descendants. */
  it('rejects Inspector UI hosts from the hide workflow', () => {
    const fixture = createVisibilityFixture();
    const inspectorHost = new FakeElement('aside');
    const inspectorButton = new FakeElement('button');
    inspectorHost.setAttribute('data-react-preview-inspector-ui', 'toolbar');
    inspectorHost.append(inspectorButton);

    fixture.runtime.remember(inspectorButton, fixture.snapshot, fixture.selection);

    expect(fixture.runtime.canHide()).toBe(false);
    expect(fixture.runtime.hide()).toBe(false);
    expect(inspectorButton.getAttribute(HIDDEN_ATTRIBUTE)).toBeNull();
  });

  /** Rejects a connected portal host picked before the user switched to another page candidate. */
  it('does not apply a stale pick after the authored page context changes', () => {
    const fixture = createVisibilityFixture();
    const portalButton = new FakeElement('button');
    portalButton.setAttribute('id', 'portal-action');
    fixture.root.append(portalButton);
    fixture.runtime.remember(portalButton, fixture.snapshot, fixture.selection);

    fixture.runtime.setContext('candidate-b');

    expect(fixture.runtime.canHide()).toBe(false);
    expect(fixture.runtime.hide()).toBe(false);
    expect(portalButton.getAttribute(HIDDEN_ATTRIBUTE)).toBeNull();
  });

  /** Highlights the connected host selected by its component-tree ID and restores authored styles. */
  it('outlines the exact mounted host selected from the component tree', () => {
    const fixture = createVisibilityFixture();
    fixture.root.style.setProperty('outline', '1px dotted blue');
    fixture.root.style.setProperty('outline-offset', '1px', 'important');

    fixture.runtime.selectTreeNode('component');
    fixture.runtime.setHighlightEnabled(true);
    fixture.runtime.refreshHighlight();

    expect(fixture.runtime.readOutline(fixture.root)).toEqual({
      offset: '2px',
      offsetPriority: 'important',
      outline: '2px solid #f2c94c',
      outlinePriority: 'important',
    });

    fixture.runtime.setHighlightEnabled(false);
    fixture.runtime.refreshHighlight();
    expect(fixture.runtime.readOutline(fixture.root)).toEqual({
      offset: '1px',
      offsetPriority: 'important',
      outline: '1px dotted blue',
      outlinePriority: '',
    });
  });

  /** Clears the prior host when an explicit pseudo/static row has no raw Fiber host identity. */
  it('treats an explicit hostless tree selection as an authoritative empty host set', () => {
    const fixture = createVisibilityFixture();
    fixture.runtime.selectTreeNode('component');
    fixture.runtime.setHighlightEnabled(true);
    fixture.runtime.refreshHighlight();
    expect(fixture.runtime.readOutline(fixture.root).outline).toBe('2px solid #f2c94c');

    fixture.runtime.selectTreeNode('static:render-placeholder');
    fixture.runtime.refreshHighlight();

    expect(fixture.runtime.readOutline(fixture.root)).toEqual({
      offset: '',
      offsetPriority: '',
      outline: '',
      outlinePriority: '',
    });
  });

  /** Keeps the generated source bounded and its limit explicit for hostile broad pages. */
  it('emits an exact-selector bounded implementation', () => {
    const source = createPreviewInspectorElementVisibilityRuntimeSource();

    expect(PREVIEW_INSPECTOR_HIDDEN_ELEMENT_LIMIT).toBe(128);
    expect(source).toContain("'{display:none!important}'");
    expect(source).toContain(
      'rememberPreviewInspectorPickedElement(candidate, snapshot, selection)',
    );
    expect(source).toContain('requestPreviewInspectorTreeReveal(selection.node.id)');
    expect(source).toContain('previewInspectorSession.pickerEnabled = true');
    expect(source).not.toContain("'^='");
  });
});

/** Creates one component root and evaluates the generated visibility module around it. */
function createVisibilityFixture(): {
  readonly root: FakeElement;
  readonly runtime: VisibilityRuntime;
  readonly selection: { readonly hostNodes: FakeElement[]; readonly node: VisibilityTreeNode };
  readonly snapshot: VisibilitySnapshot;
} {
  const root = new FakeElement('main');
  const snapshot = createSnapshot(root);
  const runtime = evaluateVisibilityRuntime(snapshot);
  const node = snapshot.nodeById.get('component');
  if (node === undefined) throw new Error('Visibility fixture component is missing.');
  return { root, runtime, selection: { hostNodes: [root], node }, snapshot };
}

/** Creates the non-enumerable-map-equivalent snapshot used by the generated resolver. */
function createSnapshot(root: FakeElement): VisibilitySnapshot {
  const node = { id: 'component', name: 'Toolbar' };
  return {
    hostNodesById: new Map([['component', [root]]]),
    nodeById: new Map([['component', node]]),
  };
}

/** Evaluates the generated browser functions with deterministic project/page dependencies. */
function evaluateVisibilityRuntime(initialSnapshot: VisibilitySnapshot): VisibilityRuntime {
  const head = new FakeElement('head');
  const documentFixture = {
    body: new FakeElement('body'),
    createElement: (tagName: string) => new FakeElement(tagName),
    documentElement: new FakeElement('html'),
    head,
  };
  const context: {
    __runtime?: VisibilityRuntime;
    document: typeof documentFixture;
    initialSnapshot: VisibilitySnapshot;
  } = { document: documentFixture, initialSnapshot };
  vm.runInNewContext(
    `
      const PREVIEW_INSPECTOR_UI_ATTRIBUTE = 'data-react-preview-inspector-ui';
      const previewHotRuntime = {};
      const previewInspectorSession = {
        boundariesByExport: new Map(),
        descriptorNames: ['Target'],
        highlightEnabled: true,
        manualElementsByExport: new Map(),
        selectedExportName: 'Target',
      };
      const ReactDOMNamespace = {};
      let currentContext = 'candidate-a';
      let currentSnapshot = initialSnapshot;
      const findSelectedPreviewInspectorDescriptor = () => ({
        inspector: { root: { exportName: 'Page', sourcePath: '/workspace/Page.tsx' } },
      });
      const readSelectedPreviewInspectorPageCandidate = () => ({
        id: currentContext,
        root: { exportName: 'Page', sourcePath: '/workspace/Page.tsx' },
      });
      const readPreviewInspectorRenderScenario = () => 'authored-page';
      const collectPreviewInspectorTreeSnapshot = () => currentSnapshot;
      const selectPreviewInspectorFiberTreeNode = (snapshot, id) => {
        const node = snapshot.nodeById.get(id);
        return node === undefined ? undefined : { hostNodes: snapshot.hostNodesById.get(id) ?? [], node };
      };
      const collectPreviewInspectorFiberElements = () => [];
      const findPreviewInspectorFiberTreeNodeByHost = () => undefined;
      const persistPreviewInspectorState = () => undefined;
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const requestPreviewInspectorTreeReveal = () => undefined;
      ${createPreviewInspectorElementVisibilityRuntimeSource()}
      globalThis.__runtime = {
        canHide: canHidePreviewInspectorPickedElement,
        count: countPreviewInspectorHiddenElementsForTreeNode,
        hide: hidePreviewInspectorPickedElement,
        readOutline: (element) => ({
          offset: element.style.getPropertyValue('outline-offset'),
          offsetPriority: element.style.getPropertyPriority('outline-offset'),
          outline: element.style.getPropertyValue('outline'),
          outlinePriority: element.style.getPropertyPriority('outline'),
        }),
        readPickerEnabled: () => previewInspectorSession.pickerEnabled === true,
        readStyle: () => {
          const style = previewHotRuntime.inspectorHiddenElementStyle;
          return style === undefined ? undefined : { connected: style.isConnected, text: style.textContent };
        },
        reconcile: reconcilePreviewInspectorHiddenElements,
        refreshHighlight: refreshPreviewInspectorHighlight,
        remember: rememberPreviewInspectorPickedElement,
        restoreAll: restoreAllPreviewInspectorHiddenElements,
        restoreLast: restoreLastPreviewInspectorHiddenElement,
        setContext: (value) => { currentContext = value; },
        setHighlightEnabled: (enabled) => { previewInspectorSession.highlightEnabled = enabled; },
        selectTreeNode: (treeNodeId) => {
          previewInspectorSession.selectedTreeNodeId = treeNodeId;
          previewInspectorSession.explicitTreeSelectionId = treeNodeId;
          previewInspectorSession.lastTreeSnapshot = currentSnapshot;
          previewInspectorSession.pickerCandidate = undefined;
        },
        setSnapshot: (value) => { currentSnapshot = value; },
        summaries: readPreviewInspectorHiddenElementSummaries,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Visibility runtime did not initialize.');
  return context.__runtime;
}
