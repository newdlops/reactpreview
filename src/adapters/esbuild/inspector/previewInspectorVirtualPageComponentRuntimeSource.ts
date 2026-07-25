/**
 * Generates the shared browser runtime used by every authentic VirtualPage component facade.
 *
 * Keeping React error isolation in one virtual module prevents a deep JSX tree from duplicating an
 * error-boundary implementation for every component. Per-component facades then contain only one
 * authored import, one registration call, and their exact ESM export surface.
 */

/** Private ESM request emitted by VirtualPage component facades and resolved by the corridor. */
export const PREVIEW_INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_SPECIFIER =
  'react-preview:inspector-virtual-page-component-runtime';

/**
 * Creates the shared component registration, static forwarding, and error-boundary implementation.
 *
 * @returns Browser-safe ESM source emitted once in each selected Page Inspector bundle.
 */
export function createPreviewInspectorVirtualPageComponentRuntimeSource(): string {
  return `
import * as React from 'react';

const inspectorApiKey = Symbol.for('newdlops.react-file-preview.page-inspector');

/** React protocol fields that must remain owned by the generated forwardRef facade. */
const blockedStaticNames = new Set([
  '$$typeof', '_init', '_payload', 'arguments', 'caller', 'compare', 'displayName',
  'length', 'name', 'prototype', 'render', 'type',
]);

/** Mountable React object types accepted in addition to ordinary function components. */
const renderableObjectTypes = new Set([
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
]);

/** React wrapper names that reveal implementation mechanics instead of the authored component. */
const unhelpfulComponentNames = new Set(['Component', 'ForwardRef', 'Memo', 'default']);

/** Registers an authentic source before its first render-condition lookup. */
export function registerVirtualPageSource(sourcePath) {
  globalThis[inspectorApiKey]?.registerVirtualPageSource?.(sourcePath);
}

/** Returns true only for values React can mount as a component or clone as an element. */
function isRenderableComponent(value) {
  if (typeof value === 'function' || React.isValidElement(value)) return true;
  return value !== null && typeof value === 'object' &&
    renderableObjectTypes.has(value.$$typeof);
}

/** Preserves styled/HOC metadata without replacing React-owned wrapper protocol fields. */
function copyComponentStatics(source, target) {
  if ((typeof source !== 'function' && typeof source !== 'object') || source === null) return;
  for (const propertyName of Reflect.ownKeys(source)) {
    if (blockedStaticNames.has(propertyName)) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, propertyName);
      if (descriptor !== undefined) Object.defineProperty(target, propertyName, descriptor);
    } catch {
      // Frozen framework component objects may reject optional metadata forwarding.
    }
  }
}

/**
 * Preserves the authored component identity in the tree instead of labeling every isolated facade
 * as another VirtualPage. Named components win; named exports come next; default anonymous exports
 * receive a readable PascalCase name derived from their source file.
 */
function readVirtualPageComponentName(Component, exportName, sourcePath) {
  const authoredName = typeof Component?.displayName === 'string' && Component.displayName.length > 0
    ? Component.displayName
    : typeof Component?.name === 'string' && Component.name.length > 0
      ? Component.name
      : undefined;
  if (authoredName !== undefined && !unhelpfulComponentNames.has(authoredName)) return authoredName;
  if (exportName !== 'default') return exportName;
  const pathSegments = String(sourcePath).split(String.fromCharCode(92)).join('/').split('/');
  const fileName = pathSegments.at(-1) ?? '';
  const sourceStem = fileName.replace(/\\.[^.]+$/u, '') === 'index'
    ? (pathSegments.at(-2) ?? 'AuthoredComponent')
    : fileName.replace(/\\.[^.]+$/u, '');
  const inferredName = sourceStem
    .split(/[^A-Za-z0-9_$]+/u)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('');
  return inferredName || 'AuthoredComponent';
}

/** Keeps one failed descendant local and leaves a visible, inspectable page-region marker. */
class VirtualPageComponentBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    globalThis.console?.warn?.('[React Preview] VirtualPage component isolated', {
      error,
      exportName: this.props.exportName,
      sourcePath: this.props.sourcePath,
    });
    globalThis[inspectorApiKey]?.recordRuntimeHealth?.({
      category: 'render-isolation',
      detail: {
        error: String(error),
        exportName: this.props.exportName,
        sourcePath: this.props.sourcePath,
      },
      event: 'virtual-page-component-isolated',
    });
  }
  render() {
    if (this.state.error === null) return this.props.children;
    if (this.props.fallbackChildren !== undefined && this.props.fallbackChildren !== null) {
      return this.props.fallbackChildren;
    }
    return React.createElement('span', {
      'aria-label': 'Preview fallback for ' + this.props.exportName,
      'data-react-preview-virtual-page-error': this.props.exportName,
      style: {
        alignItems: 'center',
        border: '1px dashed rgba(220,80,70,0.7)',
        borderRadius: '4px',
        boxSizing: 'border-box',
        color: 'rgb(150,55,50)',
        display: 'inline-flex',
        fontSize: '11px',
        maxWidth: '100%',
        minHeight: '1.5rem',
        overflow: 'hidden',
        padding: '0.2rem 0.4rem',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    }, this.props.exportName);
  }
}

/** Wraps only renderable values; non-component exports retain exact authored identity. */
export function createVirtualPageComponent(Component, exportName, sourcePath) {
  if (!isRenderableComponent(Component)) return Component;
  const VirtualPageComponent = React.forwardRef((props, forwardedRef) => {
    const componentProps = forwardedRef === null
      ? props
      : Object.assign({}, props, { ref: forwardedRef });
    const authoredElement = React.isValidElement(Component)
      ? React.cloneElement(Component, componentProps)
      : React.createElement(Component, componentProps);
    return React.createElement(
      VirtualPageComponentBoundary,
      { exportName, fallbackChildren: props?.children, sourcePath },
      authoredElement,
    );
  });
  copyComponentStatics(Component, VirtualPageComponent);
  VirtualPageComponent.displayName = readVirtualPageComponentName(Component, exportName, sourcePath);
  try {
    Object.defineProperty(VirtualPageComponent, 'reactPreviewFacadeKind', {
      configurable: false,
      enumerable: false,
      value: 'virtual-page-component-isolation',
    });
  } catch {}
  return VirtualPageComponent;
}
`;
}
