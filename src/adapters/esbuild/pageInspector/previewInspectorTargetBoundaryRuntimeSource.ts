/**
 * Generates the selected-target error boundary used by React Page Inspector.
 *
 * The boundary is emitted separately from the larger Inspector runtime so error containment stays
 * focused and the main generated-source module remains below the project file-size limit. Runtime
 * names referenced here are deliberately provided by the surrounding generated preview entry.
 */

/**
 * Creates browser source that contains failures at the selected component invocation.
 *
 * The successful path returns children without a host wrapper, preserving authored selectors and
 * layout. Only a failed selected target receives a compact custom-element placeholder. Because the
 * boundary sits inside the discovered ancestor page, React can retain that page and its siblings.
 *
 * @returns Plain JavaScript source concatenated into the Page Inspector browser runtime.
 */
export function createPreviewInspectorTargetBoundaryRuntimeSource(): string {
  return String.raw`
/** Returns one bounded message suitable for the selected target's inline failure placeholder. */
function describePreviewInspectorTargetError(error) {
  const headline = createRuntimeErrorHeadline(error);
  return headline.length > 180 ? headline.slice(0, 177) + '...' : headline;
}

/**
 * Contains render and lifecycle failures below the exact component selected in Page Inspector.
 * It intentionally adds no DOM on success; the custom element exists only along the error path.
 */
class PreviewInspectorTargetBoundary extends React.Component {
  /** Creates a fresh boundary whose authored child remains eligible for normal rendering. */
  constructor(props) {
    super(props);
    this.state = { componentStack: '', error: undefined };
  }

  /** Asks React to commit the compact fallback after a descendant render or lifecycle failure. */
  static getDerivedStateFromError(error) {
    return { error };
  }

  /** Registers the committed class instance whose subtree belongs to one target invocation. */
  componentDidMount() {
    this.unregisterBoundary = registerPreviewInspectorBoundary(this.props.exportName, this);
  }

  /**
   * Prevents the browser error listener from replacing the page and logs the complete diagnostic.
   * The React component stack is retained separately because the first fallback render precedes
   * componentDidCatch and therefore cannot include this commit-time information yet.
   */
  componentDidCatch(error, errorInfo) {
    rememberCapturedReactError(error);
    const componentStack =
      typeof errorInfo?.componentStack === 'string' ? errorInfo.componentStack : '';
    reportPreviewInspectorTargetFailure(error, {
      componentStack,
      exportName: this.props.exportName,
      phase: 'React Page Inspector selected target render or lifecycle',
    });
    if (componentStack !== this.state.componentStack) {
      this.setState({ componentStack });
    }
  }

  /** Refreshes outlines after target-owned state changes or the error placeholder commits. */
  componentDidUpdate() {
    schedulePreviewInspectorHighlight();
  }

  /** Removes the boundary before React removes its target or placeholder DOM nodes. */
  componentWillUnmount() {
    this.unregisterBoundary?.();
  }

  /** Remounts only this inspected export; its revision key also clears the captured error state. */
  retry = () => {
    remountPreviewInspectorExport(this.props.exportName);
  };

  /** Returns authored children directly, or one compact and locally recoverable failure marker. */
  render() {
    if (this.state.error === undefined) {
      return this.props.children;
    }
    return React.createElement(
      'react-preview-target-error',
      {
        'data-react-preview-target-error': this.props.exportName,
        role: 'alert',
        style: {
          alignItems: 'center',
          background: 'var(--vscode-inputValidation-errorBackground, rgba(127, 29, 29, 0.92))',
          border: '1px solid var(--vscode-inputValidation-errorBorder, #f14c4c)',
          borderRadius: '4px',
          boxSizing: 'border-box',
          color: 'var(--vscode-inputValidation-errorForeground, #ffffff)',
          display: 'inline-flex',
          font: '12px/1.35 var(--vscode-font-family, sans-serif)',
          gap: '8px',
          maxWidth: 'min(100%, 640px)',
          padding: '6px 8px',
          verticalAlign: 'middle',
        },
      },
      React.createElement('strong', undefined, this.props.exportName + ' failed'),
      React.createElement('span', undefined, describePreviewInspectorTargetError(this.state.error)),
      React.createElement(
        'button',
        {
          onClick: this.retry,
          style: { cursor: 'pointer', flex: '0 0 auto', font: 'inherit' },
          type: 'button',
        },
        'Retry',
      ),
    );
  }
}
`;
}
