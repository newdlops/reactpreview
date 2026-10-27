/** Generates local target wrappers and page-root boundaries within the shared Inspector scope. */

/** Returns source concatenated at its original lexical position; declarations share the session scope. */
export function createPreviewInspectorLocalTargetRuntimeSource(): string {
  return String.raw`/** Accepts only compiler-shaped exact source/export metadata for a selected local binding. */
function normalizePreviewInspectorLocalTargetMetadata(metadata) {
  if (
    metadata?.compilerExportEvidence !== true ||
    metadata?.facadeResolutionEvidence !== true ||
    typeof metadata?.exportName !== 'string' ||
    metadata.exportName.length === 0 ||
    metadata.exportName.length > 240 ||
    typeof metadata?.sourcePath !== 'string' ||
    metadata.sourcePath.length === 0 ||
    metadata.sourcePath.length > 4_096 ||
    typeof metadata?.preparedSourceDigest !== 'string' ||
    metadata.preparedSourceDigest.length === 0 ||
    metadata.preparedSourceDigest.length > 128
  ) return undefined;
  return Object.freeze({
    ...metadata,
    exportName: metadata.exportName,
    sourcePath: metadata.sourcePath.replaceAll('\\', '/'),
  });
}

/** Mirrors the facade's final runtime check before changing one exported application value. */
function isPreviewInspectorLocalTargetRenderable(value) {
  if (typeof value === 'function' || React.isValidElement(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (PREVIEW_INSPECTOR_LOCAL_TARGET_OBJECT_TYPES.has(value.$$typeof)) return true;
  // styled-components v6 exposes a forward-ref-shaped object. Some compatibility builds retain
  // its exact styled contract while the public $$typeof read is unavailable, so require all three
  // library-owned fields before treating that selected compiler export as renderable.
  return typeof value.render === 'function' &&
    typeof value.styledComponentId === 'string' &&
    value.styledComponentId.length > 0 &&
    value.componentStyle !== null && typeof value.componentStyle === 'object';
}

/** Preserves styled/HOC statics needed by same-module interpolation and wrapper composition. */
function copyPreviewInspectorLocalTargetStatics(source, target) {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) return;
  for (const propertyName of Reflect.ownKeys(source)) {
    if (PREVIEW_INSPECTOR_LOCAL_TARGET_BLOCKED_STATICS.has(propertyName)) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, propertyName);
      if (descriptor !== undefined) Object.defineProperty(target, propertyName, descriptor);
    } catch {
      /* Frozen or exotic component statics are non-essential to the render boundary. */
    }
  }
  pinPreviewInspectorLocalStyledCompositionTarget(source, target);
}

/** Keeps styled(styled(Target)) composition from flattening past the local Inspector boundary. */
function pinPreviewInspectorLocalStyledCompositionTarget(source, target) {
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
    /* The copied styled contract remains usable when an exotic target is not configurable. */
  }
}

/**
 * Gives same-module references the exact boundary normally supplied by the selected import facade.
 * The wrapper is generated only for compiler-selected variable exports and is reused by the facade.
 */
function wrapPreviewInspectorLocalTarget(Component, rawMetadata) {
  const metadata = normalizePreviewInspectorLocalTargetMetadata(rawMetadata);
  if (metadata === undefined || !isPreviewInspectorLocalTargetRenderable(Component)) {
    return Component;
  }
  const identity = metadata.sourcePath + '\0' + metadata.exportName + '\0' +
    metadata.preparedSourceDigest;
  let wrappersByIdentity = previewInspectorLocalTargetWrapperCache.get(Component);
  if (!(wrappersByIdentity instanceof Map)) {
    wrappersByIdentity = new Map();
    previewInspectorLocalTargetWrapperCache.set(Component, wrappersByIdentity);
  }
  const existing = wrappersByIdentity.get(identity);
  if (existing !== undefined) return existing;
  const targetMarker = {};
  registerPreviewInspectorCompilerCapability(targetMarker, metadata);
  registerPreviewInspectorTargetOwnershipPhase(metadata, 'compiler-export-evidence');
  registerPreviewInspectorTargetOwnershipPhase(metadata, 'local-binding-rewrite');
  const WrappedPreviewInspectorLocalTarget = React.forwardRef((targetProps, forwardedRef) => {
    registerPreviewInspectorTargetOwnershipPhase(metadata, 'wrapper-render');
    registerPreviewInspectorCompilerCapability(targetMarker, metadata);
    return React.createElement(PreviewInspectorTargetRenderer, {
      Component,
      forwardedRef,
      metadata,
      targetMarker,
      targetProps,
    });
  });
  WrappedPreviewInspectorLocalTarget.displayName =
    'ReactPreviewInspectorLocal(' + metadata.exportName + ')';
  copyPreviewInspectorLocalTargetStatics(Component, WrappedPreviewInspectorLocalTarget);
  previewInspectorLocalTargetWrapperMetadata.set(WrappedPreviewInspectorLocalTarget, metadata);
  wrappersByIdentity.set(identity, WrappedPreviewInspectorLocalTarget);
  return WrappedPreviewInspectorLocalTarget;
}

/** Resolves one deferred source wrapper only after the entry-owned Inspector API is installed. */
function createPreviewInspectorLocalTargetElement(Component, metadata, targetProps, forwardedRef) {
  const WrappedTarget = wrapPreviewInspectorLocalTarget(Component, metadata);
  if (WrappedTarget === Component && !isPreviewInspectorLocalTargetRenderable(Component)) return null;
  return React.createElement(WrappedTarget, {
    ...(targetProps !== null && typeof targetProps === 'object' ? targetProps : {}),
    ...(forwardedRef === undefined || forwardedRef === null ? {} : { ref: forwardedRef }),
  });
}

/** Lets the import facade avoid adding a second boundary around the same exact local wrapper. */
function isPreviewInspectorLocalTargetWrapper(Component, rawMetadata) {
  if ((typeof Component !== 'object' && typeof Component !== 'function') || Component === null) {
    return false;
  }
  const expected = normalizePreviewInspectorLocalTargetMetadata(rawMetadata);
  const actual = previewInspectorLocalTargetWrapperMetadata.get(Component);
  return expected !== undefined && actual !== undefined &&
    actual.exportName === expected.exportName &&
    actual.sourcePath === expected.sourcePath &&
    actual.preparedSourceDigest === expected.preparedSourceDigest;
}
/** Creates one registered outer target without exposing its private role token to project props. */
function createPreviewInspectorContextualTargetElement(Component, metadata, roleToken, children) {
  const role = typeof validatePreviewInspectorContextualBoundaryRoleToken === 'function'
    ? validatePreviewInspectorContextualBoundaryRoleToken(roleToken, metadata)
    : undefined;
  if (role === undefined) return undefined;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const pathname = candidate?.routeLocation?.pathname;
  // The facade beside the page has no authored owner to pass props: mount it with the candidate's
  // usage literals and typed required props so a required closed-set prop is not undefined.
  const targetElement = createPreviewCandidateRouterElement(
    React.createElement(Component, { ...(candidate?.targetAutomaticProps ?? {}) }, children),
    {
      initialEntry: typeof pathname === 'string' ? pathname : undefined,
      ownsRouter: false,
    },
  );
  return React.createElement(
    PreviewInspectorContextualBoundaryRoleContext.Provider,
    { value: roleToken },
    targetElement,
  );
}
const PreviewInspectorDirectTargetContext = React.createContext(undefined);
/** Reads the live extension-owned target token at an authored hook position. */
function usePreviewInspectorTargetOwnershipToken() {
  const OwnershipContext = readPreviewInspectorJsxOwnershipContext();
  return OwnershipContext === undefined ? undefined : React.useContext(OwnershipContext);
}
function PreviewInspectorDirectTarget(targetProps) {
  const definition = React.useContext(PreviewInspectorDirectTargetContext);
  return React.createElement(PreviewInspectorTargetRenderer, {
    Component: definition?.Component,
    forwardedRef: undefined,
    metadata: definition?.metadata,
    targetProps,
  });
}
function PreviewInspectorRoutedDirectTarget(targetProps) {
  return createPreviewCandidateRouterElement(
    React.createElement(PreviewInspectorDirectTarget, targetProps),
    { ownsRouter: false },
  );
}
function PreviewPageInspectorRootRenderer({ descriptor, previewConfig, storyContext, targetProps, useStorybook }) {
  usePreviewInspectorStore();
  if (descriptor?.inspector === undefined) {
    const metadata = {
      exportName: descriptor?.exportName ?? 'default',
      inferredPropShape: descriptor?.inferredPropShape,
      inferredProps: descriptor?.inferredProps,
      sourcePath: descriptor?.sourcePath,
    };
    const directTarget = useStorybook
      ? React.createElement(StorybookPreviewRoot, {
          PreviewTarget: PreviewInspectorRoutedDirectTarget,
          previewConfig,
          storyContext,
          targetProps,
        })
      : React.createElement(PreviewInspectorRoutedDirectTarget, targetProps);
    return React.createElement(
      PreviewInspectorDirectTargetContext.Provider,
      { value: { Component: descriptor?.value, metadata } },
      directTarget,
    );
  }
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const selectedRoot = selectedCandidate?.root ?? descriptor?.inspector?.root;
  const rootName = createPreviewInspectorRootName(selectedRoot);
  const automaticRootProps = normalizePreviewInspectorProps(
    selectedCandidate?.rootAutomaticProps ?? descriptor?.automaticProps ?? {},
  );
  const fallbackValuesEnabled = readPreviewInspectorFallbackValuesEnabled();
  const baseRootProps = createPreviewPropsFromLayers(
    fallbackValuesEnabled ? selectedCandidate?.rootInferredPropShape : undefined,
    automaticRootProps,
    targetProps,
  );
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(rootName, baseRootProps);
  }, [rootName, stringifyPreviewInspectorProps(baseRootProps)]);
  const overrideProps = materializePreviewInspectorRuntimeFallbackOverride(
    previewInspectorSession.overridesByExport.get(rootName) ?? {},
  );
  const effectiveProps = { ...baseRootProps, ...overrideProps };
  const candidateKey = selectedCandidate?.id ?? 'nearest-authored-owner';
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  const neuralRevision = previewInspectorSession.runtimeFallbackNeuralRevision ?? 0;
  const renderKey = candidateKey + ':condition:' + String(conditionRevision) +
    ':neural:' + String(neuralRevision);
  return useStorybook
    ? React.createElement(StorybookPreviewRoot, {
        PreviewTarget: descriptor.value,
        key: renderKey,
        previewConfig,
        storyContext: { ...storyContext, args: effectiveProps },
        targetProps: effectiveProps,
      })
    : createPreviewInspectorElement(descriptor.value, {
        ...effectiveProps,
        key: renderKey,
      });
}
function PreviewPageInspectorExportBoundary({ descriptor, children }) {
  usePreviewInspectorStore();
  const inspectedExportName =
    descriptor?.inspector?.target?.exportName ?? descriptor?.exportName ?? 'default';
  const targetRevision =
    previewInspectorSession.propsRevisionByExport.get(inspectedExportName) ?? 0;
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const rootName = createPreviewInspectorRootName(
    selectedCandidate?.root ?? descriptor?.inspector?.root,
  );
  const rootRevision = previewInspectorSession.propsRevisionByExport.get(rootName) ?? 0;
  const dataRevision = previewInspectorSession.dataRevision ?? 0;
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  const neuralRevision = previewInspectorSession.runtimeFallbackNeuralRevision ?? 0;
  return React.createElement(
    PreviewExportErrorBoundary,
    {
      exportName: descriptor?.exportName ?? inspectedExportName,
      key: inspectedExportName + ':candidate:' + String(selectedCandidate?.id ?? ''),
      parentSlice: descriptor?.parentSlice,
      resetKey: String(targetRevision) + ':' + rootName + ':' + String(rootRevision) +
        ':data:' + String(dataRevision) + ':condition:' + String(conditionRevision) +
        ':neural:' + String(neuralRevision),
    },
    children,
  );
}
`;
}
