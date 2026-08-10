/** Generates the browser-only StyleSheetManager boundary embedded in the theme bridge. */
export function createPreviewStyleSheetManagerRuntimeSource(): string {
  return `
const PREVIEW_STYLE_SHEET_MANAGER_MAX_LAYERS = 4;
const PREVIEW_STYLE_SHEET_MANAGER_MAX_PLUGINS = 8;
let previewStyleSheetRuntimeStatus = 'unavailable: StyleSheetManager has not been prepared';

/** Returns a bounded diagnostic string without exposing project paths or executable values. */
export function readPreviewStyleSheetRuntimeStatus() {
  return previewStyleSheetRuntimeStatus;
}

function reportPreviewStyleSheetRuntimeHealth(event, detail) {
  try {
    globalThis[Symbol.for('newdlops.react-file-preview.page-inspector')]?.recordRuntimeHealth?.({
      category: 'styled-components', detail: detail ?? {}, event,
    });
  } catch {
    // Health reporting must never alter render behavior.
  }
}

function readOwnDataMember(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return { kind: 'absent' };
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return { kind: 'absent' };
  if (!('value' in descriptor)) return { kind: 'unsafe' };
  return { kind: 'value', value: descriptor.value };
}

function readStyleSheetManager() {
  return StyledComponents.StyleSheetManager ?? StyledComponents.default?.StyleSheetManager;
}

function createSyntheticStyleSheetPlan(reason) {
  return {
    evidence: 'synthetic', ignoredReasons: reason === undefined ? [] : [reason],
    layers: [{ sourceKind: 'synthetic' }], sharedRuntimeChunk: false, version: 1,
  };
}

function readRuntimePlan(plan) {
  if (plan === null || typeof plan !== 'object') {
    return createSyntheticStyleSheetPlan('malformed-browser-plan');
  }
  const version = readOwnDataMember(plan, 'version');
  const planLayers = readOwnDataMember(plan, 'layers');
  const evidence = readOwnDataMember(plan, 'evidence');
  const ignoredReasons = readOwnDataMember(plan, 'ignoredReasons');
  const sharedRuntimeChunk = readOwnDataMember(plan, 'sharedRuntimeChunk');
  if (
    version.kind !== 'value' || version.value !== 1 ||
    planLayers.kind !== 'value' || !Array.isArray(planLayers.value) ||
    evidence.kind !== 'value' ||
    ignoredReasons.kind !== 'value' ||
    sharedRuntimeChunk.kind !== 'value'
  ) return createSyntheticStyleSheetPlan('malformed-browser-plan');
  if (planLayers.value.length > PREVIEW_STYLE_SHEET_MANAGER_MAX_LAYERS) {
    return createSyntheticStyleSheetPlan('malformed-browser-plan');
  }
  const layers = [];
  for (const candidate of planLayers.value) {
    const sourceKind = readOwnDataMember(candidate, 'sourceKind');
    if (candidate === null || typeof candidate !== 'object' || sourceKind.kind !== 'value' ||
      (sourceKind.value !== 'authored' && sourceKind.value !== 'synthetic')) {
      return createSyntheticStyleSheetPlan('malformed-browser-plan');
    }
    const layer = { sourceKind: sourceKind.value };
    for (const key of ['disableCSSOMInjection', 'disableVendorPrefixes', 'enableVendorPrefixes']) {
      const member = readOwnDataMember(candidate, key);
      if (member.kind === 'unsafe') return createSyntheticStyleSheetPlan('malformed-browser-plan');
      if (member.kind === 'value') {
        if (typeof member.value !== 'boolean') return createSyntheticStyleSheetPlan('malformed-browser-plan');
        layer[key] = member.value;
      }
    }
    const shouldForwardProp = readOwnDataMember(candidate, 'shouldForwardProp');
    if (shouldForwardProp.kind === 'unsafe') return createSyntheticStyleSheetPlan('malformed-browser-plan');
    if (shouldForwardProp.kind === 'value') {
      if (typeof shouldForwardProp.value !== 'function') return createSyntheticStyleSheetPlan('malformed-browser-plan');
      layer.shouldForwardProp = shouldForwardProp.value;
    }
    const stylisPlugins = readOwnDataMember(candidate, 'stylisPlugins');
    if (stylisPlugins.kind === 'unsafe') return createSyntheticStyleSheetPlan('malformed-browser-plan');
    if (stylisPlugins.kind === 'value') {
      if (!Array.isArray(stylisPlugins.value) || stylisPlugins.value.length > PREVIEW_STYLE_SHEET_MANAGER_MAX_PLUGINS || stylisPlugins.value.some((value) => typeof value !== 'function')) {
        return createSyntheticStyleSheetPlan('malformed-browser-plan');
      }
      layer.stylisPlugins = stylisPlugins.value.slice();
    }
    layers.push(layer);
  }
  return {
    evidence: evidence.value === 'authored' ? 'authored' : 'synthetic',
    ignoredReasons: Array.isArray(ignoredReasons.value) ? ignoredReasons.value.filter((value) => typeof value === 'string').slice(0, 16) : [],
    layers, sharedRuntimeChunk: sharedRuntimeChunk.value === true, version: 1,
  };
}

function readSetupStyleSheetPlan(configuration, configurationStatus) {
  if (configurationStatus === 'unsafe') return { plan: createSyntheticStyleSheetPlan('unsafe-setup-accessor'), precedence: 'synthetic' };
  if (configurationStatus !== 'value') return undefined;
  if (configuration === false) return { disabled: true, precedence: 'setup' };
  if (configuration === null || typeof configuration !== 'object' || Array.isArray(configuration) ||
    (Object.getPrototypeOf(configuration) !== Object.prototype && Object.getPrototypeOf(configuration) !== null)) {
    return { plan: createSyntheticStyleSheetPlan('invalid-setup-value'), precedence: 'synthetic' };
  }
  const allowed = new Set(['disableCSSOMInjection', 'disableVendorPrefixes', 'enableVendorPrefixes', 'shouldForwardProp', 'stylisPlugins']);
  const layer = { sourceKind: 'synthetic' };
  const ignoredReasons = [];
  for (const key of Reflect.ownKeys(configuration)) {
    const member = readOwnDataMember(configuration, key);
    if (member.kind !== 'value') return { plan: createSyntheticStyleSheetPlan('unsafe-setup-accessor'), precedence: 'synthetic' };
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return { plan: createSyntheticStyleSheetPlan('invalid-setup-object'), precedence: 'synthetic' };
    }
    if (typeof key !== 'string' || !allowed.has(key)) {
      ignoredReasons.push(key === 'target' || key === 'sheet' || key === 'nonce' ? key : 'unsupported-prop');
      continue;
    }
    if (key === 'shouldForwardProp') {
      if (typeof member.value === 'function') layer[key] = member.value;
      else ignoredReasons.push('invalid-setup-value');
    } else if (key === 'stylisPlugins') {
      if (Array.isArray(member.value) && member.value.length <= PREVIEW_STYLE_SHEET_MANAGER_MAX_PLUGINS && member.value.every((value) => typeof value === 'function')) layer[key] = member.value.slice();
      else ignoredReasons.push('invalid-setup-value');
    } else if (typeof member.value === 'boolean') {
      layer[key] = member.value;
    } else {
      ignoredReasons.push('invalid-setup-value');
    }
  }
  if (layer.disableVendorPrefixes === true && layer.enableVendorPrefixes === true) {
    return { plan: createSyntheticStyleSheetPlan('conflicting-vendor-prefix-props'), precedence: 'synthetic' };
  }
  return { plan: { evidence: 'setup', ignoredReasons, layers: [layer], sharedRuntimeChunk: false, version: 1 }, precedence: 'setup' };
}

function chooseStyleSheetPlan(configuration, configurationStatus, plan) {
  const setup = readSetupStyleSheetPlan(configuration, configurationStatus);
  if (setup !== undefined) return setup;
  const staticPlan = readRuntimePlan(plan);
  if (staticPlan.evidence === 'authored') return { plan: staticPlan, precedence: 'authored' };
  return { plan: staticPlan, precedence: 'synthetic' };
}

/** Detects styled-components v4's class boundary, which rejects a missing sheet and target. */
function requiresOwnedLegacyTarget(StyleSheetManager) {
  const prototype = readOwnDataMember(StyleSheetManager, 'prototype');
  if (prototype.kind !== 'value') return false;
  const getContext = readOwnDataMember(prototype.value, 'getContext');
  return getContext.kind === 'value' && typeof getContext.value === 'function';
}

function createStyleSheetManagerElement(StyleSheetManager, child, target, plan) {
  let element = child;
  for (let index = plan.layers.length - 1; index >= 0; index -= 1) {
    const layer = plan.layers[index];
    const props = {};
    if (layer.disableCSSOMInjection !== undefined) props.disableCSSOMInjection = layer.disableCSSOMInjection;
    if (layer.disableVendorPrefixes !== undefined) props.disableVendorPrefixes = layer.disableVendorPrefixes;
    if (layer.enableVendorPrefixes !== undefined) props.enableVendorPrefixes = layer.enableVendorPrefixes;
    if (layer.shouldForwardProp !== undefined) props.shouldForwardProp = layer.shouldForwardProp;
    if (layer.stylisPlugins !== undefined) props.stylisPlugins = layer.stylisPlugins;
    if (index === 0 && target !== undefined) props.target = target;
    element = React.createElement(StyleSheetManager, props, element);
  }
  return element;
}

/** Replays authored options and supplies only legacy managers with an isolated required target. */
export function preparePreviewStyleSheetBoundary(options) {
  const StyleSheetManager = readStyleSheetManager();
  const selected = chooseStyleSheetPlan(options?.configuration, options?.configurationStatus, options?.plan);
  const targetMode = requiresOwnedLegacyTarget(StyleSheetManager) ? 'owned-legacy' : 'document-default';
  let target;
  let activated = false;
  let disposed = false;
  let committed = false;
  const makeTarget = () => {
    if (targetMode !== 'owned-legacy') return undefined;
    if (target !== undefined) return target;
    if (typeof document === 'undefined' || document.head === null || document.head === undefined) return undefined;
    target = document.createElement('div');
    target.setAttribute('data-react-preview-styled-components-target', '');
    return target;
  };
  const identity = selected.disabled === true || typeof StyleSheetManager !== 'function';
  if (identity) {
    previewStyleSheetRuntimeStatus = selected.disabled === true
      ? 'disabled by setup (styledComponentsPreview=false)'
      : 'unavailable: installed styled-components has no StyleSheetManager export';
  } else {
    previewStyleSheetRuntimeStatus = 'prepared: ' + selected.precedence + ' StyleSheetManager boundary';
  }
  return Object.freeze({
    activate() {
      if (disposed || activated || identity) return;
      const ownedTarget = makeTarget();
      if (targetMode === 'owned-legacy' && ownedTarget === undefined) {
        previewStyleSheetRuntimeStatus = 'unavailable: document.head is not available for legacy StyleSheetManager';
        return;
      }
      if (ownedTarget !== undefined) document.head.appendChild(ownedTarget);
      activated = true;
      reportPreviewStyleSheetRuntimeHealth('styled-components-boundary-composed', {
        evidence: selected.plan.evidence, layerCount: selected.plan.layers.length,
        sharedRuntimeChunk: selected.plan.sharedRuntimeChunk, targetMode, targetOwned: ownedTarget !== undefined,
        vendorPrefixMode: selected.plan.layers.some((layer) => layer.disableVendorPrefixes === true) ? 'disabled' : 'default',
      });
      if (selected.plan.ignoredReasons.length > 0) reportPreviewStyleSheetRuntimeHealth('styled-components-configuration-partial', { ignoredReasons: selected.plan.ignoredReasons.slice(0, 16), selectedFallback: selected.precedence });
    },
    commit() {
      if (disposed || committed || !activated) return;
      committed = true;
      const styles = target !== undefined
        ? target.querySelectorAll('style')
        : typeof document === 'undefined'
        ? []
        : document.head?.querySelectorAll('style[data-styled]') ?? [];
      let ruleCount = 0;
      for (const style of styles) {
        try { ruleCount += style.sheet?.cssRules?.length ?? 0; } catch { /* cross-origin rules are intentionally opaque */ }
      }
      reportPreviewStyleSheetRuntimeHealth('styled-components-style-commit', { ruleCount: Math.min(ruleCount, 1000000), styleTagCount: Math.min(styles.length, 1000000), targetMode, targetOwned: target !== undefined });
    },
    createElement(child) {
      if (identity || disposed) return child;
      return createStyleSheetManagerElement(StyleSheetManager, child, makeTarget(), selected.plan);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (target?.parentNode !== null && target?.parentNode !== undefined) target.parentNode.removeChild(target);
      target = undefined;
      activated = false;
    },
    readStatus() { return previewStyleSheetRuntimeStatus; },
  });
}
`;
}
