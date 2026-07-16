/**
 * Generates the browser-only Formik compatibility boundary used by previews.
 * The boundary is deliberately small: it supplies stable static form values and a no-op submit
 * handler without importing application stores, validators, effects, routes, or backend clients.
 */

/** Resolved project module required to build the optional Formik preview boundary. */
export interface PreviewFormikRuntimeSourceOptions {
  /** Absolute browser-resolved entry for the target project's own Formik package. */
  readonly formikModulePath: string;
}

/**
 * Creates a virtual module that conditionally composes a Formik provider around the preview.
 * Reached source modules register whether they consume or own Formik context. The generated entry
 * can then add a boundary only for an otherwise-unowned consumer, preserving real inner providers.
 *
 * @param options Project-owned Formik entry selected through esbuild's normal resolver.
 * @returns JavaScript source loaded inside the private Formik bridge namespace.
 */
export function createPreviewFormikRuntimeSource(
  options: PreviewFormikRuntimeSourceOptions,
): string {
  const encodedModulePath = JSON.stringify(normalizeImportPath(options.formikModulePath));
  return `
import * as React from 'react';
import * as FormikModule from ${encodedModulePath};

const BLOCKED_VALUE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EMPTY_INITIAL_VALUES = Object.freeze({});
const MAX_INITIAL_VALUE_DEPTH = 16;
const MAX_INITIAL_VALUE_ENTRIES = 512;
const MAX_INITIAL_VALUE_KEY_LENGTH = 128;
const MAX_INITIAL_VALUE_ARRAY_LENGTH = 256;
const INVALID_INITIAL_VALUES = Symbol('invalid-preview-formik-initial-values');
const cachedInitialValues = new WeakMap();
let consumesFormik = false;
let ownsFormik = false;
let previewRuntimeStatus = 'available: static Formik provider has not been composed yet';

/** Reports whether a value is a non-array object suitable for setup or registration data. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Accepts only ordinary object roots so setup cannot smuggle executable class instances. */
function isPlainRecord(value) {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Records bounded syntax evidence from one reached target module.
 * Boolean evidence is monotonic and idempotent, so module order and duplicate imports cannot make
 * an already-observed consumer or provider disappear later in preview initialization.
 */
export function registerPreviewFormikRequirement(requirement) {
  if (!isRecord(requirement)) {
    return;
  }
  consumesFormik ||= requirement.consumesFormik === true;
  ownsFormik ||= requirement.ownsFormik === true;
}

/** Returns the last automatic Formik decision for detailed preview runtime diagnostics. */
export function readPreviewRuntimeStatus() {
  return previewRuntimeStatus;
}

/** Adds one node to the sanitizer budget and rejects values beyond the global entry bound. */
function consumeBudget(budget) {
  budget.entries += 1;
  return budget.entries <= MAX_INITIAL_VALUE_ENTRIES;
}

/**
 * Copies JSON-like setup values into prototype-safe, deeply frozen containers.
 * Unsupported values, cycles, excessive depth, and oversized arrays reject the entire configured
 * root instead of partially inventing a form shape that differs from the user's explicit setup.
 */
function copyStaticValue(value, budget, activeValues, depth) {
  if (depth > MAX_INITIAL_VALUE_DEPTH || !consumeBudget(budget)) {
    return INVALID_INITIAL_VALUES;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object' || value === null || activeValues.has(value)) {
    return INVALID_INITIAL_VALUES;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_INITIAL_VALUE_ARRAY_LENGTH) {
      return INVALID_INITIAL_VALUES;
    }
    activeValues.add(value);
    const copy = [];
    for (const item of value) {
      const copiedItem = copyStaticValue(item, budget, activeValues, depth + 1);
      if (copiedItem === INVALID_INITIAL_VALUES) {
        activeValues.delete(value);
        return INVALID_INITIAL_VALUES;
      }
      copy.push(copiedItem);
    }
    activeValues.delete(value);
    return Object.freeze(copy);
  }

  if (!isPlainRecord(value)) {
    return INVALID_INITIAL_VALUES;
  }
  activeValues.add(value);
  const copy = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) {
      continue;
    }
    if (
      key.length === 0 ||
      key.length > MAX_INITIAL_VALUE_KEY_LENGTH ||
      BLOCKED_VALUE_KEYS.has(key) ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      activeValues.delete(value);
      return INVALID_INITIAL_VALUES;
    }
    const copiedValue = copyStaticValue(descriptor.value, budget, activeValues, depth + 1);
    if (copiedValue === INVALID_INITIAL_VALUES) {
      activeValues.delete(value);
      return INVALID_INITIAL_VALUES;
    }
    copy[key] = copiedValue;
  }
  activeValues.delete(value);
  return Object.freeze(copy);
}

/** Reads and memoizes a safe plain initial-values root from setup configuration. */
function readInitialValues(configuration) {
  if (!isRecord(configuration) || !Object.prototype.hasOwnProperty.call(configuration, 'initialValues')) {
    return { configured: false, rejected: false, values: EMPTY_INITIAL_VALUES };
  }
  const initialValuesDescriptor = Object.getOwnPropertyDescriptor(configuration, 'initialValues');
  if (
    initialValuesDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(initialValuesDescriptor, 'value')
  ) {
    return { configured: true, rejected: true, values: EMPTY_INITIAL_VALUES };
  }
  const configuredValues = initialValuesDescriptor.value;
  if (!isPlainRecord(configuredValues)) {
    return { configured: true, rejected: true, values: EMPTY_INITIAL_VALUES };
  }
  const cachedValue = cachedInitialValues.get(configuredValues);
  if (cachedValue !== undefined) {
    return { configured: true, rejected: false, values: cachedValue };
  }
  const copiedValue = copyStaticValue(configuredValues, { entries: 0 }, new Set(), 0);
  if (copiedValue === INVALID_INITIAL_VALUES || !isPlainRecord(copiedValue)) {
    return { configured: true, rejected: true, values: EMPTY_INITIAL_VALUES };
  }
  cachedInitialValues.set(configuredValues, copiedValue);
  return { configured: true, rejected: false, values: copiedValue };
}

/** Resolves an export across native ESM and common CommonJS namespace interop layouts. */
function readFormikExport(exportName) {
  return FormikModule[exportName] ?? FormikModule.default?.[exportName];
}

/** No-op submit callback guarantees that the automatic form boundary cannot contact a backend. */
function submitStaticPreviewForm(_values, _helpers) {}

/**
 * Calls the project's useFormik hook from a proper React component and publishes its exact bag.
 * A real provider rendered inside this component remains the nearest context and therefore wins.
 */
function StaticFormikHookBoundary({ children, initialValues }) {
  const useFormik = readFormikExport('useFormik');
  const FormikProvider = readFormikExport('FormikProvider');
  const formikProps = useFormik({
    initialValues,
    onSubmit: submitStaticPreviewForm,
    validateOnBlur: false,
    validateOnChange: false,
    validateOnMount: false,
  });
  return React.createElement(FormikProvider, { value: formikProps }, children);
}

/** Uses the public Formik render-prop API when hook/provider exports are unavailable. */
function StaticFormikRenderPropBoundary({ children, initialValues }) {
  const Formik = readFormikExport('Formik') ??
    (typeof FormikModule.default === 'function' ? FormikModule.default : undefined);
  return React.createElement(
    Formik,
    {
      initialValues,
      onSubmit: submitStaticPreviewForm,
      validateOnBlur: false,
      validateOnChange: false,
      validateOnMount: false,
    },
    () => children,
  );
}

/** Returns whether the installed package can provide the hook-based static boundary. */
function hasHookBoundary() {
  return (
    typeof readFormikExport('FormikProvider') === 'function' &&
    typeof readFormikExport('useFormik') === 'function'
  );
}

/** Returns whether the installed package exposes a compatible Formik component boundary. */
function hasRenderPropBoundary() {
  return (
    typeof readFormikExport('Formik') === 'function' ||
    typeof FormikModule.default === 'function'
  );
}

/**
 * Wraps a composed preview tree only when reached modules consume otherwise-unowned Formik state.
 * formikPreview=false disables automation; formikPreview={ initialValues } provides bounded static
 * values. Provider evidence suppresses the outer boundary, while any missed real inner provider
 * still retains standard nearest-context precedence under React.
 */
export function createFormikPreviewElement(children, options) {
  const configuration = options?.configuration;
  if (configuration === false) {
    previewRuntimeStatus = 'disabled by setup (formikPreview=false)';
    return children;
  }
  if (!consumesFormik) {
    previewRuntimeStatus = 'inactive: no target-reachable Formik consumer was detected';
    return children;
  }
  if (ownsFormik) {
    previewRuntimeStatus = 'inactive: target graph provides its own Formik boundary';
    return children;
  }

  const initialValues = readInitialValues(configuration);
  const Boundary = hasHookBoundary()
    ? StaticFormikHookBoundary
    : hasRenderPropBoundary()
      ? StaticFormikRenderPropBoundary
      : undefined;
  if (Boundary === undefined) {
    previewRuntimeStatus = 'unavailable: installed formik package has no compatible provider API';
    return children;
  }
  previewRuntimeStatus = initialValues.rejected
    ? 'active: static Formik provider with empty values (invalid setup initialValues rejected)'
    : initialValues.configured
      ? 'active: static Formik provider with setup-owned initial values'
      : 'active: static Formik provider with empty initial values';
  return React.createElement(Boundary, { initialValues: initialValues.values }, children);
}
`;
}

/**
 * Normalizes Windows separators before embedding an absolute path as an ESM import specifier.
 *
 * @param modulePath Absolute file path selected by esbuild's browser-aware resolver.
 * @returns Slash-separated import path safe to JSON-encode into generated JavaScript.
 */
function normalizeImportPath(modulePath: string): string {
  return modulePath.replaceAll('\\', '/');
}
