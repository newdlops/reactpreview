/**
 * Generates the tiny runtime imported by Page Inspector target facades.
 *
 * Facades stay independent from the generated entry by communicating through one global Symbol.
 * The entry installs that API before dynamically importing the ancestor/target module graph, so a
 * normal preview never receives inspector behavior and hot reload can replace either side safely.
 */
import { PREVIEW_PAGE_INSPECTOR_API_SYMBOL } from './previewPageInspectorRuntimeSource';

/**
 * Builds an ESM module exporting the stable target-wrapper contract used by compiler facades.
 *
 * @returns Browser ESM source with `wrapPreviewInspectorTarget(component, metadata)`.
 */
export function createPreviewInspectorFacadeRuntimeSource(): string {
  const encodedApiSymbol = JSON.stringify(PREVIEW_PAGE_INSPECTOR_API_SYMBOL);
  return `
import * as React from 'react';

const PREVIEW_INSPECTOR_API_KEY = Symbol.for(${encodedApiSymbol});

/** React-owned statics that must never replace the facade's own forwardRef protocol fields. */
const blockedPreviewInspectorStaticNames = new Set([
  '$$typeof', '_debugInfo', '_init', '_payload', 'arguments', 'arity', 'callee', 'caller',
  'childContextTypes', 'compare', 'contextType', 'contextTypes', 'defaultProps', 'displayName',
  'getDefaultProps', 'getDerivedStateFromError', 'getDerivedStateFromProps', 'length', 'mixins',
  'name', 'propTypes', 'prototype', 'render', 'type',
]);

/** React object protocols that represent mountable component types rather than application data. */
const previewInspectorRenderableObjectTypes = new Set([
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
]);

/** Prevents an unusual target from growing an unbounded per-props Suspense record catalog. */
const PREVIEW_INSPECTOR_ASYNC_TARGET_RECORD_LIMIT = 32;
const PREVIEW_INSPECTOR_ASYNC_TARGET_TIMEOUT_MS = 1500;
const previewInspectorAsyncTargetValueIds = new WeakMap();
let previewInspectorNextAsyncTargetValueId = 1;

/** Returns one stable identifier for non-serializable values participating in async page props. */
function readPreviewInspectorAsyncTargetValueId(value) {
  let identifier = previewInspectorAsyncTargetValueIds.get(value);
  if (identifier !== undefined) return identifier;
  identifier = previewInspectorNextAsyncTargetValueId;
  previewInspectorNextAsyncTargetValueId += 1;
  previewInspectorAsyncTargetValueIds.set(value, identifier);
  return identifier;
}

/** Creates a bounded repeatable key so retries reuse the same async component thenable. */
function stringifyPreviewInspectorAsyncTargetProps(value) {
  const seen = new WeakSet();
  try {
    const serialized = JSON.stringify(value, (_name, propertyValue) => {
      if (typeof propertyValue === 'bigint') return propertyValue.toString();
      if (typeof propertyValue === 'symbol') return String(propertyValue);
      if (typeof propertyValue === 'function') {
        return '[Function:' + String(readPreviewInspectorAsyncTargetValueId(propertyValue)) + ']';
      }
      if (propertyValue !== null && typeof propertyValue === 'object') {
        if (typeof propertyValue.then === 'function' && Object.keys(propertyValue).length === 0) {
          return '[Thenable:' + String(readPreviewInspectorAsyncTargetValueId(propertyValue)) + ']';
        }
        if (seen.has(propertyValue)) return '[Circular]';
        seen.add(propertyValue);
      }
      return propertyValue;
    }) ?? '{}';
    return serialized.length <= 65_536
      ? serialized
      : serialized.slice(0, 65_536) + ':' + String(serialized.length);
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Converts an async Server Component into a synchronous component with one stable thenable.
 * React can retry this boundary without invoking the authored async page on every render pass.
 */
function adaptPreviewInspectorAsyncTarget(Component, metadata) {
  if (
    typeof Component !== 'function' ||
    Component.constructor?.name !== 'AsyncFunction'
  ) return Component;
  const records = new Map();
  const displayName = metadata?.exportName ?? Component.displayName ?? Component.name ?? 'default';
  function ReactPreviewAsyncTarget(targetProps) {
    const propsKey = stringifyPreviewInspectorAsyncTargetProps(targetProps);
    let record = records.get(propsKey);
    if (record === undefined) {
      let resume;
      const promise = new Promise((resolve) => { resume = resolve; });
      record = { promise, status: 'pending', value: null };
      if (records.size >= PREVIEW_INSPECTOR_ASYNC_TARGET_RECORD_LIMIT) {
        const oldestKey = records.keys().next().value;
        if (oldestKey !== undefined) records.delete(oldestKey);
      }
      records.set(propsKey, record);
      const timer = setTimeout(() => {
        if (record.status !== 'pending') return;
        record.status = 'fulfilled';
        record.value = React.createElement('span', {
          'data-react-preview-async-target': 'timeout',
          role: 'status',
          title: displayName + ': async server output timed out in preview',
        }, '…');
        resume();
      }, PREVIEW_INSPECTOR_ASYNC_TARGET_TIMEOUT_MS);
      Promise.resolve().then(() => Component(targetProps)).then(
        (value) => {
          if (record.status !== 'pending') return;
          clearTimeout(timer);
          record.status = 'fulfilled';
          record.value = value;
          resume();
        },
        (error) => {
          if (record.status !== 'pending') return;
          clearTimeout(timer);
          record.status = 'rejected';
          record.value = error;
          resume();
        },
      );
    }
    if (record.status === 'pending') throw record.promise;
    if (record.status === 'rejected') throw record.value;
    return record.value;
  }
  ReactPreviewAsyncTarget.displayName = 'ReactPreviewAsyncTarget(' + displayName + ')';
  return ReactPreviewAsyncTarget;
}

/**
 * Distinguishes React element types from GraphQL documents, route metadata, and other plain data.
 *
 * The static export inventory deliberately avoids evaluating project modules and can therefore be
 * conservative around unusual declarations. This runtime check is the final semantic boundary:
 * wrapping a non-component object would change its identity inside the authored application before
 * React ever attempts to render it. Already-created elements remain valid direct preview targets.
 */
function isPreviewInspectorRenderableTarget(value) {
  if (typeof value === 'function') return true;
  if (React.isValidElement(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (previewInspectorRenderableObjectTypes.has(value.$$typeof)) return true;
  return typeof value.render === 'function' &&
    typeof value.styledComponentId === 'string' &&
    value.styledComponentId.length > 0 &&
    value.componentStyle !== null && typeof value.componentStyle === 'object';
}

/** Copies safe component statics so owner modules can keep reading ordinary metadata. */
function copyPreviewInspectorComponentStatics(source, target) {
  for (const propertyName of Reflect.ownKeys(source)) {
    if (blockedPreviewInspectorStaticNames.has(propertyName)) {
      continue;
    }
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, propertyName);
      if (descriptor !== undefined) {
        Object.defineProperty(target, propertyName, descriptor);
      }
    } catch {
      // Frozen or exotic React component objects may reject a non-essential static property.
    }
  }
  pinPreviewInspectorStyledCompositionTarget(source, target);
}

/** Keeps styled(styled(Target)) composition from flattening past the Inspector boundary. */
function pinPreviewInspectorStyledCompositionTarget(source, target) {
  try {
    const styledComponentId = Object.getOwnPropertyDescriptor(source, 'styledComponentId');
    const styledTarget = Object.getOwnPropertyDescriptor(target, 'target');
    if (
      typeof styledComponentId?.value !== 'string' ||
      styledComponentId.value.length === 0 ||
      styledTarget === undefined ||
      !Object.hasOwn(styledTarget, 'value')
    ) return;
    Object.defineProperty(target, 'target', { ...styledTarget, value: target });
  } catch {
    // The copied styled contract remains usable even when an exotic target is not configurable.
  }
}

/**
 * Wraps one exact source export while preserving its authored parent and descendant React tree.
 * The wrapper delegates props, target markers, and remount behavior to the entry-owned inspector.
 */
export function wrapPreviewInspectorTarget(Component, metadata) {
  const initialInspectorApi = globalThis[PREVIEW_INSPECTOR_API_KEY];
  if (metadata?.compilerExportEvidence === true) {
    initialInspectorApi?.registerTargetOwnershipPhase?.(metadata, 'compiler-export-evidence');
  }
  if (metadata?.facadeResolutionEvidence === true) {
    initialInspectorApi?.registerTargetOwnershipPhase?.(metadata, 'facade-resolution');
  }
  initialInspectorApi?.registerTargetOwnershipPhase?.(metadata, 'facade-evaluation');
  if (Component === undefined || Component === null) {
    return Component;
  }
  const renderable = isPreviewInspectorRenderableTarget(Component);
  const inspectorApi = globalThis[PREVIEW_INSPECTOR_API_KEY];
  inspectorApi?.registerTargetRenderability?.(metadata?.exportName, renderable);
  if (!renderable) {
    return Component;
  }
  if (inspectorApi?.isLocalTargetWrapper?.(Component, metadata) === true) {
    return Component;
  }
  // One facade invocation represents one compiler-selected source export. This opaque value never
  // reaches application props or markup; it is carried only through the private TargetRenderer.
  const targetMarker = {};
  inspectorApi?.registerCompilerCapability?.(targetMarker, metadata);
  const displayName =
    metadata?.exportName ?? Component.displayName ?? Component.name ?? 'default';
  const RenderComponent = adaptPreviewInspectorAsyncTarget(Component, metadata);
  const WrappedPreviewInspectorTarget = React.forwardRef((targetProps, forwardedRef) => {
    const activeInspectorApi = globalThis[PREVIEW_INSPECTOR_API_KEY];
    activeInspectorApi?.registerTargetOwnershipPhase?.(metadata, 'wrapper-render');
    activeInspectorApi?.registerCompilerCapability?.(targetMarker, metadata);
    const TargetRenderer = activeInspectorApi?.TargetRenderer;
    if (typeof TargetRenderer !== 'function') {
      const fallbackProps = forwardedRef === null
        ? targetProps
        : { ...targetProps, ref: forwardedRef };
      return React.isValidElement(RenderComponent)
        ? React.cloneElement(RenderComponent, fallbackProps)
        : React.createElement(RenderComponent, fallbackProps);
    }
    return React.createElement(TargetRenderer, {
      Component: RenderComponent,
      forwardedRef,
      metadata,
      targetMarker,
      targetProps,
    });
  });
  WrappedPreviewInspectorTarget.displayName = 'ReactPreviewInspector(' + displayName + ')';
  if (
    (typeof Component === 'function' || typeof Component === 'object') &&
    Component !== null
  ) {
    copyPreviewInspectorComponentStatics(Component, WrappedPreviewInspectorTarget);
  }
  return WrappedPreviewInspectorTarget;
}

`;
}
