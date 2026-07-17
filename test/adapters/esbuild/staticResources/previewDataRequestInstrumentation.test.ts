/** Verifies bounded backend-call interception and TypeScript payload-shape inference. */
import { describe, expect, it } from 'vitest';
import { instrumentPreviewDataRequests } from '../../../../src/adapters/esbuild/staticResources/previewDataRequestInstrumentation';

describe('instrumentPreviewDataRequests', () => {
  /** Rewrites exact axios and fetch calls while retaining local interface field types. */
  it('routes proven backend calls through the Page Inspector data boundary', () => {
    const source = [
      "import axios from 'axios';",
      "const payrollApi = axios.create({ baseURL: '/api' });",
      'interface Employee { id: string; name: string; active: boolean; salary: number }',
      "export const loadEmployees = () => axios.get<Employee[]>('/api/employees');",
      "export const loadPayroll = () => payrollApi.post<Employee>('/payroll', {});",
      "export async function loadCurrent() { const response = await fetch('/api/current');",
      '  return (await response.json()) as Employee;',
      '}',
    ].join('\n');

    const transformed = instrumentPreviewDataRequests('/workspace/employees.ts', source);

    expect(transformed).toContain('.previewAxiosRequest("GET", \'/api/employees\'');
    expect(transformed).toContain('.previewAxiosRequest("POST", \'/payroll\'');
    expect(transformed).toContain(".previewFetch('/api/current', undefined,");
    expect(transformed).toContain('"evidence":"TypeScript: Employee[]"');
    expect(transformed).toContain('"items":{"fields"');
    expect(transformed).toContain('"active":{"kind":"boolean"}');
    expect(transformed).toContain('"salary":{"kind":"number"}');
    expect(transformed).toContain('"evidence":"TypeScript: Employee"');
  });

  /** Avoids rewriting similarly named project clients and any module that shadows global fetch. */
  it('leaves unproven request-like calls unchanged', () => {
    const source = [
      'const api = { get: (url) => url };',
      'export function run(fetch) {',
      "  return [api.get('/records'), fetch('/local.json')];",
      '}',
    ].join('\n');

    expect(instrumentPreviewDataRequests('/workspace/client.ts', source)).toBe(source);
  });

  /** Keeps local JSON fixture fetches identifiable so the browser runtime may use native loading. */
  it('preserves endpoint text and source provenance for runtime policy', () => {
    const source = "export const loadFixture = () => fetch('./fixtures/users.json');";
    const transformed = instrumentPreviewDataRequests('/workspace/fixture.ts', source);

    expect(transformed).toContain(".previewFetch('./fixtures/users.json', undefined,");
    expect(transformed).toContain('"url":"./fixtures/users.json"');
    expect(transformed).toContain('"sourcePath":"/workspace/fixture.ts"');
  });
});
