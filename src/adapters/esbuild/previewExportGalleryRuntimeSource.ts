/** Generates gallery-only browser runtime code outside the entry bootstrap module. */
import type { PreviewRenderMode } from '../../domain/preview';

/** Values interpolated into one revision's gallery source. */
export interface PreviewExportGalleryRuntimeSourceOptions {
  readonly renderMode: PreviewRenderMode;
  readonly setupKind: 'custom' | 'none' | 'storybook';
  readonly storybookRuntimeSource: string;
}

/** Keeps export isolation, gallery rendering, and Storybook parameter wrapping together. */
export function createPreviewExportGalleryRuntimeSource(
  options: PreviewExportGalleryRuntimeSourceOptions,
): string {
  const encodedRenderMode = JSON.stringify(options.renderMode);
  const encodedSetupKind = JSON.stringify(options.setupKind);
  return String.raw`
/** Isolates one export so a broken component cannot remove later gallery entries. */
class PreviewExportErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { componentStack: '', error: undefined, resetKey: props.resetKey };
  }
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null;
    return { componentStack: '', error: undefined, resetKey: props.resetKey };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, errorInfo) {
    rememberCapturedReactError(error);
    const componentStack = errorInfo?.componentStack;
    if (typeof componentStack === 'string' && componentStack !== this.state.componentStack) {
      this.setState({ componentStack });
    }
    const details = describeRuntimeError(error, {
      componentStack,
      exportName: this.props.exportName,
      parentSlice: this.props.parentSlice,
      phase: 'React export render or lifecycle',
    });
    recordPreviewInspectorRuntimeConsoleEntry(error, {
      componentStack,
      details,
      exportName: this.props.exportName,
      phase: 'React export render or lifecycle',
      source: 'react-boundary',
    });
    console.warn('React Preview isolated one failed export and kept the remaining preview mounted.\\n' + details);
  }
  render() {
    if (this.state.error !== undefined) {
      return React.createElement(
        'react-preview-inline-error',
        { className: 'react-preview-export-error', role: 'status' },
        React.createElement('strong', undefined, 'Static preview placeholder'),
        React.createElement(
          'span',
          undefined,
          String(this.props.exportName ?? 'default') + ': ' + createRuntimeErrorHeadline(this.state.error),
        ),
      );
    }
    return this.props.children;
  }
}

${options.storybookRuntimeSource}

/** Renders one descriptor behind a local Suspense fallback so siblings remain independently visible. */
function PreviewExportRenderer({ descriptor, previewConfig, setupModule, sharedProps, storyContext }) {
  if (${encodedRenderMode} === 'page-inspector') {
    usePreviewInspectorStore();
  }
  if (!isReactLikePreviewValue(descriptor.value)) {
    throw new TypeError(
      'Export "' + descriptor.exportName + '" is not a renderable React component or element.',
    );
  }
  const fallbackValuesEnabled = ${encodedRenderMode} !== 'page-inspector' ||
    readPreviewInspectorFallbackValuesEnabled();
  const targetProps = createExportProps(
    setupModule,
    descriptor.exportName,
    sharedProps,
    fallbackValuesEnabled ? descriptor.automaticProps : undefined,
    fallbackValuesEnabled ? descriptor.inferredPropShape : undefined,
  );
  const rendered = ${encodedRenderMode} === 'page-inspector'
    ? React.createElement(PreviewPageInspectorRootRenderer, {
        descriptor,
        previewConfig,
        storyContext,
        targetProps,
        useStorybook: ${encodedSetupKind} === 'storybook',
      })
    : ${encodedSetupKind} === 'storybook'
      ? React.createElement(StorybookPreviewRoot, {
          PreviewTarget: descriptor.value,
          previewConfig,
          storyContext: { ...storyContext, args: targetProps },
          targetProps,
        })
      : createTargetElement(descriptor.value, targetProps);
  const suspenseFallback = React.createElement(
    'div',
    { className: 'react-preview-suspense-placeholder', role: 'status' },
    'Loading ' + String(descriptor.displayName ?? descriptor.exportName) + '…',
  );
  return React.createElement(React.Suspense, { fallback: suspenseFallback }, rendered);
}

/** Displays every selected export in bridge order with labels that never wrap target DOM. */
function PreviewExportGallery({ descriptors, previewConfig, setupModule, sharedProps, storyContext }) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    return React.createElement(
      'p',
      { className: 'react-preview-empty-gallery' },
      'This file has no direct default or PascalCase component exports to preview.',
    );
  }
  if (${encodedRenderMode} === 'page-inspector') {
    return React.createElement(
      React.Fragment,
      undefined,
      descriptors.map((descriptor, index) =>
        React.createElement(
          PreviewPageInspectorExportBoundary,
          { descriptor, key: descriptor.exportName + ':' + index.toString() },
          React.createElement(PreviewExportRenderer, {
            descriptor,
            previewConfig,
            setupModule,
            sharedProps,
            storyContext: {
              ...storyContext,
              id: 'react-file-preview-' + index.toString(),
              name: descriptor.displayName,
            },
          }),
        ),
      ),
    );
  }
  return React.createElement(
    'div',
    { className: 'react-preview-gallery' },
    descriptors.map((descriptor, index) => {
      const runtimeName = descriptor.parentSlice === undefined
        ? typeof descriptor.value === 'function'
          ? descriptor.value.displayName ?? descriptor.value.name
          : descriptor.value?.displayName
        : undefined;
      const baseLabel = descriptor.displayName === 'default' && runtimeName
        ? 'default · ' + runtimeName
        : descriptor.displayName;
      const inferredValueCount = Array.isArray(descriptor.inferredProps)
        ? descriptor.inferredProps.length
        : 0;
      const label = inferredValueCount > 0
        ? baseLabel + ' · ' + String(inferredValueCount) + ' auto value(s)'
        : baseLabel;
      const exportStoryContext = {
        ...storyContext,
        id: 'react-file-preview-' + index.toString(),
        name: label,
      };
      return React.createElement(
        React.Fragment,
        { key: descriptor.exportName + ':' + index.toString() },
        React.createElement('div', { className: 'react-preview-export-label' }, label),
        React.createElement(
          PreviewExportErrorBoundary,
          { exportName: descriptor.exportName, parentSlice: descriptor.parentSlice },
          React.createElement(PreviewExportRenderer, {
            descriptor,
            previewConfig,
            setupModule,
            sharedProps,
            storyContext: exportStoryContext,
          }),
        ),
      );
    }),
  );
}

/** Reuses Storybook Apollo addon parameters without loading its manager or server runtime. */
function applyStorybookParameterProviders(previewElement, parameters) {
  const apolloOptions = parameters?.apolloClient;
  const MockedProvider = apolloOptions?.MockedProvider;
  if (MockedProvider === undefined || MockedProvider === null) return previewElement;
  const { MockedProvider: _ignoredProvider, globalMocks = [], mocks = [], ...providerProps } = apolloOptions;
  const combinedMocks = [
    ...(Array.isArray(globalMocks) ? globalMocks : []),
    ...(Array.isArray(mocks) ? mocks : []),
  ];
  return React.createElement(MockedProvider, { ...providerProps, mocks: combinedMocks }, previewElement);
}
`;
}
