/**
 * Generates the preview-only bridge between a JSX overlay mount switch and its visual props.
 *
 * React applications often split one modal decision across two layers: a parent condition mounts the
 * component while a hook-owned `show`/`open` prop and a selected entity decide whether it emits host
 * output. When the user explicitly reveals the mount branch, preserving those dormant values makes
 * the switch appear broken. This runtime clones only that compiler-proven overlay element, only while
 * an override changes its authored gate from false to true, and never mutates project-owned props.
 */

/** Maximum lazy properties retained by one generated entity placeholder. */
const PREVIEW_INSPECTOR_OVERLAY_PLACEHOLDER_PROPERTY_LIMIT = 64;

/** Creates browser source evaluated after condition and generated-value helpers are available. */
export function createPreviewInspectorOverlayActivationRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_OVERLAY_PLACEHOLDER_PROPERTY_LIMIT =
  ${PREVIEW_INSPECTOR_OVERLAY_PLACEHOLDER_PROPERTY_LIMIT};
const previewInspectorOverlayPositiveVisibilityProps = new Set([
  'active',
  'defaultopen',
  'defaultvisible',
  'expanded',
  'isopen',
  'isvisible',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);
const previewInspectorOverlayNegativeVisibilityProps = new Set(['hidden', 'ishidden']);
const previewInspectorOverlayCollectionPropPattern =
  /(?:items|rows|list|options|results|nodes|edges|records|entries|files|documents)$/iu;
const previewInspectorOverlayEntityPropPattern =
  /(?:context|data|details|document|entity|file|info|item|model|payload|record|response|result|session|settings|config|params|user|company)$/iu;

/** Normalizes common JSX visibility spellings without assigning meaning to unrelated prop names. */
function normalizePreviewInspectorMountedOverlayActivationPropName(propertyName) {
  return String(propertyName).replace(/[-_]/gu, '').toLowerCase();
}

/**
 * Returns true when a manual ON explicitly requests the overlay or an override reveals its mount.
 *
 * A generated non-null parent prop can make the authored mount condition true before the user acts,
 * while hook-owned "show: false" and "file: null" still keep the modal invisible. A manual ON is
 * therefore itself a visual activation request even when the Boolean branch was already mounted.
 */
function isPreviewInspectorOverlayActivationRequested(conditionIds) {
  initializePreviewInspectorConditionState();
  if (!Array.isArray(conditionIds)) return false;
  return conditionIds.slice(0, 16).some((conditionId) => {
    if (typeof conditionId !== 'string') return false;
    const manualOverride = previewInspectorSession.renderConditionOverrides?.get?.(conditionId);
    if (manualOverride === true) return true;
    const condition = previewInspectorSession.renderConditions.get(conditionId);
    return condition?.authoredEnabled === false && condition.effectiveEnabled === true;
  });
}

/** Creates a short readable label from an authored prop key. */
function createPreviewInspectorOverlayPlaceholderLabel(propertyName) {
  const label = String(propertyName).trim() || 'value';
  return label.length <= 32 ? label : label.slice(0, 31) + '…';
}

/**
 * Creates an extension-owned entity whose first-level fields are generated lazily from their keys.
 *
 * The proxy is intentionally shallow. It supports ordinary reads such as file.documentId and
 * item.name without manufacturing an unbounded application model. Every generated field is cached
 * as an own data property, then remains absent so the value cannot become an accidental Promise,
 * and hostile symbols or prototype keys are never synthesized.
 */
function createPreviewInspectorOverlayEntityPlaceholder(propertyName) {
  const label = createPreviewInspectorOverlayPlaceholderLabel(propertyName);
  const target = { active: true, id: 'preview-1', name: label };
  if (typeof Proxy !== 'function') return target;
  return new Proxy(target, {
    get(current, childName, receiver) {
      if (childName === 'then') return undefined;
      if (childName === Symbol.toPrimitive) return () => label;
      if (typeof childName !== 'string') return Reflect.get(current, childName, receiver);
      if (blockedInspectorPropNames.has(childName)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(current, childName);
      if (descriptor !== undefined) {
        return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      }
      if (Reflect.ownKeys(current).length >= PREVIEW_INSPECTOR_OVERLAY_PLACEHOLDER_PROPERTY_LIMIT) {
        return createPreviewInspectorRequiredPathKeyText(childName);
      }
      const generated = materializePreviewInspectorRuntimeFallbackOverride(
        createPreviewInspectorRequiredPathLeaf(childName, false),
      );
      try {
        Object.defineProperty(current, childName, {
          configurable: true,
          enumerable: true,
          value: generated,
          writable: true,
        });
      } catch {
        return generated;
      }
      return generated;
    },
  });
}

/** Produces the minimum neutral value for one nullish, explicitly authored overlay prop. */
function createPreviewInspectorOverlayActivationValue(propertyName) {
  if (previewInspectorOverlayCollectionPropPattern.test(propertyName)) {
    return [createPreviewInspectorOverlayEntityPlaceholder(propertyName.replace(/s$/iu, '') || 'item')];
  }
  if (previewInspectorOverlayEntityPropPattern.test(propertyName)) {
    return createPreviewInspectorOverlayEntityPlaceholder(propertyName);
  }
  return undefined;
}

/**
 * Clones one compiler-proven overlay element with a coherent visible-state contract.
 *
 * Existing visibility props are the only booleans changed. Nullish values are generated only for
 * semantically entity-shaped prop names, so optional anchors, callbacks, children, and layout props
 * preserve their authored values. React's clone operation supplies a new immutable props object while
 * keeping the original type, key, ref, children, and every non-nullish application value.
 */
function resolvePreviewInspectorOverlayActivationRenderValue(conditionIds, renderValue) {
  if (
    !isPreviewInspectorOverlayActivationRequested(conditionIds) ||
    !React.isValidElement(renderValue)
  ) {
    return renderValue;
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(renderValue.props ?? {});
  } catch {
    return renderValue;
  }
  const patch = {};
  for (const [propertyName, descriptor] of Object.entries(descriptors)) {
    if (
      blockedInspectorPropNames.has(propertyName) ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      continue;
    }
    const normalizedName = normalizePreviewInspectorMountedOverlayActivationPropName(propertyName);
    if (previewInspectorOverlayPositiveVisibilityProps.has(normalizedName)) {
      if (descriptor.value !== true) patch[propertyName] = true;
      continue;
    }
    if (previewInspectorOverlayNegativeVisibilityProps.has(normalizedName)) {
      if (descriptor.value !== false) patch[propertyName] = false;
      continue;
    }
    if (descriptor.value !== null && descriptor.value !== undefined) continue;
    const generated = createPreviewInspectorOverlayActivationValue(propertyName);
    if (generated !== undefined) patch[propertyName] = generated;
  }
  return Object.keys(patch).length === 0
    ? renderValue
    : React.cloneElement(renderValue, patch);
}
`;
}
