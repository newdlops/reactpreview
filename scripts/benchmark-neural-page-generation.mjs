/** Measures availability and automatic selection with production runtimes and synthetic finite choices. */
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const iterations = Number(process.argv[2] ?? 10);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error('Iterations must be an integer between 1 and 100.');
}
const factories = ['NeuralResidual', 'NeuralChoice'];
const built = buildSync({
  stdin: {
    contents: factories
      .map(
        (name) =>
          `export { createPreviewInspector${name}RuntimeSource } from './src/adapters/esbuild/pageInspector/previewInspector${name}RuntimeSource';`,
      )
      .join('\n'),
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const factory = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: factory, exports: factory.exports });
const source = factories
  .map((name) => factory.exports['createPreviewInspector' + name + 'RuntimeSource']())
  .join('\n');
const context = vm.createContext({});
vm.runInContext(
  `
  const previewEntryRevision = 7;
  const record = { attemptsByBlocker: new Map() };
  const previewInspectorSession = {
    selectedExportName: 'Panel', automaticNeuralAssistanceByKey: new Map([['panel', record]]),
  };
  const readPreviewInspectorNeuralAssistanceReachability = () => ({ targetHasOutput: true });
  const createPreviewInspectorAutomaticNeuralAssistanceKey = () => 'panel';
  ${source}
  const model = createPreviewInspectorNeuralResidualModel();
  for (const key of PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS) {
    model.heads[key] = { evidence: 100, outputBias: 0.1, outputWeights: Array(16).fill(0.05), updates: 100 };
  }
  model.updates = 1000;
  for (let index = 0; index < 192; index++) {
    const family = PREVIEW_INSPECTOR_NEURAL_RESIDUAL_HEAD_KEYS[index % 10];
    model.candidateOutcomes[family + ':' + index.toString(16).padStart(8, '0')] = {
      attempts: 3, consecutiveFailures: 0, evidence: 2.5, lastConfidence: 0.85,
      lastLabel: 1, rewardSum: 2.5, sequence: index + 1,
    };
  }
  model.outcomeSequence = 192;
  previewInspectorSession.neuralResidualModel = model;
  const choices = Array.from({ length: 6 }, (_, index) => ({
    id: 'choice-' + index, choiceKind: 'render-condition',
    node: { blockerKind: 'render-condition', condition: { id: 'condition-' + index, effectiveEnabled: false } },
    choiceRecords: [{ path: 'field-' + index, candidates: [false, true].map((value) => ({
      id: String(value), label: String(value), value,
      actionKind: 'condition-override', conditionId: 'condition-' + index,
    })) }],
  }));
  readPreviewInspectorNeuralUserChoices = () => choices;
  globalThis.scenarios = {
    availability: () => hasPreviewInspectorNeuralPageGenerationWork(),
    selection: () => createPreviewInspectorNeuralPageGenerationPlan(record)?.attemptIdentity,
  };
  globalThis.countOperations = (name) => {
    const initialize = initializePreviewInspectorNeuralResidualModel;
    const infer = runPreviewInspectorNeuralResidualModel;
    const enumerate = enumeratePreviewInspectorNeuralChoiceGraph;
    let validation = 0, inference = 0, enumeration = 0;
    initializePreviewInspectorNeuralResidualModel = (...args) => { validation++; return initialize(...args); };
    runPreviewInspectorNeuralResidualModel = (...args) => { inference++; return infer(...args); };
    enumeratePreviewInspectorNeuralChoiceGraph = (...args) => { enumeration++; return enumerate(...args); };
    try {
      scenarios[name]();
      return { validation, inference, enumeration };
    } finally {
      initializePreviewInspectorNeuralResidualModel = initialize;
      runPreviewInspectorNeuralResidualModel = infer;
      enumeratePreviewInspectorNeuralChoiceGraph = enumerate;
    }
  };
`,
  context,
);

/** Returns the central sample without changing observation order. */
function median(values) {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

const results = {};
for (const [name, run] of Object.entries(context.scenarios)) {
  for (let warmup = 0; warmup < 2; warmup++) run();
  const durationsMs = [],
    cpuMs = [];
  let result;
  for (let sample = 0; sample < 5; sample++) {
    const cpu = process.cpuUsage();
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) result = run();
    durationsMs.push(performance.now() - start);
    const used = process.cpuUsage(cpu);
    cpuMs.push((used.user + used.system) / 1000);
  }
  results[name] = {
    durationsMs,
    medianMs: median(durationsMs),
    medianCpuMs: median(cpuMs),
    operations: context.countOperations(name),
    resultHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
  };
}
console.log(
  JSON.stringify(
    {
      iterations,
      retainedOutcomes: 192,
      choicePaths: 64,
      sourceHash: createHash('sha256').update(source).digest('hex'),
      results,
    },
    null,
    2,
  ),
);
