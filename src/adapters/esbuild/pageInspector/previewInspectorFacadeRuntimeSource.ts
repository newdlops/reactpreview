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
}

/**
 * Wraps one exact source export while preserving its authored parent and descendant React tree.
 * The wrapper delegates props, target markers, and remount behavior to the entry-owned inspector.
 */
export function wrapPreviewInspectorTarget(Component, metadata) {
  if (Component === undefined || Component === null) {
    return Component;
  }
  const displayName =
    metadata?.exportName ?? Component.displayName ?? Component.name ?? 'default';
  const WrappedPreviewInspectorTarget = React.forwardRef((targetProps, forwardedRef) => {
    const inspectorApi = globalThis[PREVIEW_INSPECTOR_API_KEY];
    const TargetRenderer = inspectorApi?.TargetRenderer;
    if (typeof TargetRenderer !== 'function') {
      const fallbackProps = forwardedRef === null
        ? targetProps
        : { ...targetProps, ref: forwardedRef };
      return React.isValidElement(Component)
        ? React.cloneElement(Component, fallbackProps)
        : React.createElement(Component, fallbackProps);
    }
    return React.createElement(TargetRenderer, {
      Component,
      forwardedRef,
      metadata,
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
