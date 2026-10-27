/** Generates target element creation and ownership-aware rendering within the shared Inspector scope. */

/** Returns source concatenated at its original lexical position; declarations share the session scope. */
export function createPreviewInspectorTargetRenderingRuntimeSource(): string {
  return String.raw`function createPreviewInspectorElement(Component, props) {
  return React.isValidElement(Component)
    ? React.cloneElement(Component, props)
    : React.createElement(Component, props);
}
function PreviewInspectorTargetRenderer({ Component, contextualBoundaryRoleToken, forwardedRef, metadata, targetMarker, targetProps }) {
  usePreviewInspectorStore();
  const exportName = metadata?.exportName ?? Component?.displayName ?? Component?.name ?? 'default';
  const sourcePath = typeof metadata?.sourcePath === 'string' ? metadata.sourcePath : '';
  const targetIdentity = sourcePath.replaceAll('\\', '/') + '\0' + exportName;
  rememberPreviewInspectorTargetRuntimeOwner(exportName, Component);
  const ownershipToken = React.useMemo(
    () => createPreviewInspectorOwnershipToken(targetMarker, metadata),
    [targetMarker, metadata?.exportName, metadata?.sourcePath],
  );
  const contextualBoundaryRoleTokenFromFactory = React.useContext(PreviewInspectorContextualBoundaryRoleContext);
  const contextualBoundaryRole = typeof validatePreviewInspectorContextualBoundaryRoleToken === 'function'
    ? validatePreviewInspectorContextualBoundaryRoleToken(
        contextualBoundaryRoleToken ?? contextualBoundaryRoleTokenFromFactory,
        metadata,
      )
    : undefined;
  const fallbackValuesEnabled = readPreviewInspectorFallbackValuesEnabled();
  const inferredTargetPropsEnabled = fallbackValuesEnabled ||
    metadata?.targetOnlyExecution === true;
  const generatedListSampleCount = readPreviewGeneratedListSampleCount();
  const automaticTargetProps = React.useMemo(
    () => createPreviewTargetPropsFromLayers(
      inferredTargetPropsEnabled ? metadata?.inferredPropShape : undefined,
      targetProps,
    ),
    [inferredTargetPropsEnabled, generatedListSampleCount, metadata?.inferredPropShape, targetProps],
  );
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(exportName, automaticTargetProps);
  }, [exportName, automaticTargetProps]);
  const overrideProps = materializePreviewInspectorRuntimeFallbackOverride(
    previewInspectorSession.overridesByExport.get(exportName) ?? {},
  );
  const resolverProps = materializePreviewInspectorRuntimeFallbackOverride(
    previewInspectorSession.resolverPropsByExport.get(exportName) ?? {},
  );
  const effectiveProps = createPreviewPropsFromLayers(
    undefined,
    automaticTargetProps,
    resolverProps,
    overrideProps,
  );
  // Compare only while both props records are live. The resulting scalar lets the output proof
  // distinguish a retained route passed through this facade unchanged from a replacement supplied
  // by a later prop layer, without retaining a project element or exposing the role token.
  const ownChildrenDescriptor = targetProps !== null && typeof targetProps === 'object'
    ? Object.getOwnPropertyDescriptor(targetProps, 'children')
    : undefined;
  const effectiveChildrenDescriptor = effectiveProps !== null && typeof effectiveProps === 'object'
    ? Object.getOwnPropertyDescriptor(effectiveProps, 'children')
    : undefined;
  const contextualChildrenUnchanged = contextualBoundaryRole !== undefined &&
    ownChildrenDescriptor !== undefined && ownChildrenDescriptor.value !== undefined &&
    ownChildrenDescriptor.value !== null && effectiveChildrenDescriptor !== undefined &&
    effectiveChildrenDescriptor.value === ownChildrenDescriptor.value;
  if (forwardedRef !== undefined && forwardedRef !== null) {
    effectiveProps.ref = forwardedRef;
  }
  const revision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
  const instanceEpoch = previewInspectorSession.instanceEpochByExport.get(exportName) ?? 0;
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  const targetElement = metadata?.intentionalNavigationOutput === true
    ? null
    : createPreviewInspectorElement(Component, {
        ...effectiveProps,
        key: targetIdentity + ':instance:' + String(instanceEpoch),
      });
  const targetBoundary = React.createElement(
    PreviewInspectorTargetBoundary,
    {
      exportName,
      key: targetIdentity,
      resetKey: String(revision) + ':' + String(conditionRevision),
      sourcePath,
      contextualBoundaryKey: contextualBoundaryRole?.key,
      contextualBoundaryRole: contextualBoundaryRole?.role,
      contextualChildrenUnchanged,
      effectControllerOutputCandidate: metadata?.effectControllerOutputCandidate === true,
      ownershipToken,
    },
    targetElement,
  );
  // The generated contextual role belongs only to this outer target facade. Without a reset
  // provider, a transparent target that returns the retained route leaks the same role into every
  // authored occurrence of that export below it, making the unique boundary selector fail closed.
  return contextualBoundaryRole === undefined
    ? targetBoundary
    : React.createElement(
        PreviewInspectorContextualBoundaryRoleContext.Provider,
        { value: undefined },
        targetBoundary,
      );
}

const previewInspectorLocalTargetWrapperMetadata = new WeakMap();
const previewInspectorLocalTargetWrapperCache = new WeakMap();
const PREVIEW_INSPECTOR_LOCAL_TARGET_OBJECT_TYPES = new Set([
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
]);
const PREVIEW_INSPECTOR_LOCAL_TARGET_BLOCKED_STATICS = new Set([
  '$$typeof', '_debugInfo', '_init', '_payload', 'arguments', 'arity', 'callee', 'caller',
  'childContextTypes', 'compare', 'contextType', 'contextTypes', 'defaultProps', 'displayName',
  'getDefaultProps', 'getDerivedStateFromError', 'getDerivedStateFromProps', 'length', 'mixins',
  'name', 'propTypes', 'prototype', 'render', 'type',
]);

`;
}
