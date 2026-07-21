/**
 * Generates the Storybook decorator adapter shared by gallery and authored-page previews.
 *
 * Storybook accepts decorators that render their `Story` argument as a React component. Creating
 * that component inside every preview render changes its React type and remounts the entire nested
 * provider, Router, portal, and modal tree. This adapter composes stable layer component types once
 * per decorator-array identity, then transports changing context through ordinary props/Context.
 */

/** Returns browser runtime source that expects lexical `React` and `createTargetElement` bindings. */
export function createPreviewStorybookRuntimeSource(): string {
  return String.raw`
/** Merges decorator-supplied Storybook context fields while preserving nested argument objects. */
function mergeStoryContext(baseContext, contextUpdate) {
  if (contextUpdate === null || typeof contextUpdate !== 'object') return baseContext;
  return {
    ...baseContext,
    ...contextUpdate,
    args: { ...baseContext.args, ...contextUpdate.args },
    globals: { ...baseContext.globals, ...contextUpdate.globals },
    parameters: { ...baseContext.parameters, ...contextUpdate.parameters },
  };
}

/** Renders the project target after every decorator has contributed its bounded context update. */
function PreviewStorybookTarget({ PreviewTarget, contextUpdate, storyContext, targetProps }) {
  const context = mergeStoryContext(storyContext, contextUpdate);
  return createTargetElement(PreviewTarget, context?.args ?? targetProps);
}

/**
 * Creates one stable React layer for a single decorator.
 *
 * The stable Story bridge uses a Context consumer rather than a closure-local component. It works
 * both for decorators that render Story as JSX and those that call Story(update) directly without
 * making changing render data part of the component identity.
 */
function createPreviewStorybookDecoratorLayer(InnerStory, decorator) {
  const LayerContext = React.createContext(undefined);

  /** Forwards an optional decorator context update to the already composed inner layer. */
  function PreviewStorybookInnerBridge(storyUpdate) {
    return React.createElement(LayerContext.Consumer, undefined, (frame) =>
      React.createElement(InnerStory, {
        ...frame,
        contextUpdate: mergeStoryContext(frame.nextContext, storyUpdate),
      }),
    );
  }

  /** Invokes the project decorator from a stable component so its hook order remains attached. */
  function PreviewStorybookDecoratorInvocation() {
    const frame = React.useContext(LayerContext);
    return decorator(PreviewStorybookInnerBridge, frame.nextContext);
  }

  /** Supplies current render data without rebuilding the decorator or Story component types. */
  function PreviewStorybookDecoratorLayer(props) {
    const nextContext = mergeStoryContext(props.storyContext, props.contextUpdate);
    const frame = { ...props, nextContext };
    return React.createElement(
      LayerContext.Provider,
      { value: frame },
      React.createElement(PreviewStorybookDecoratorInvocation),
    );
  }

  return PreviewStorybookDecoratorLayer;
}

/** Composes later Storybook decorators outside earlier decorators exactly once per setup identity. */
function applyStorybookDecorators(decorators) {
  let Story = PreviewStorybookTarget;
  for (const decorator of decorators) {
    if (typeof decorator === 'function') {
      Story = createPreviewStorybookDecoratorLayer(Story, decorator);
    }
  }
  return Story;
}

/** Invokes decorators during React render while preserving their nested application component. */
function StorybookPreviewRoot({ PreviewTarget, previewConfig, storyContext, targetProps }) {
  const decorators = Array.isArray(previewConfig.decorators) ? previewConfig.decorators : [];
  const DecoratedStory = React.useMemo(
    () => applyStorybookDecorators(decorators),
    [decorators],
  );
  return React.createElement(DecoratedStory, {
    PreviewTarget,
    contextUpdate: undefined,
    storyContext,
    targetProps,
  });
}
`;
}
