# FiSta 계열 변수 Route 복구 구현 계획

상태: 구현 대기  
대상:
`/Users/lky/project/rtcc-poc-page/zuzu/client/src/legal/fi-sta/app/fi-sta-app.tsx`  
목표: terra medium이 설계 결정을 추가하지 않고 아래 체크리스트를 순서대로 구현하도록
파일, 타입, 알고리즘, 테스트 입력과 기대값을 고정한다.

## 1. 실행 규칙

1. 단계 순서를 바꾸지 않는다.
2. 각 단계에서 먼저 명시된 실패 테스트를 추가하고 실패를 확인한 뒤 제품 코드를 수정한다.
3. `FiSta`, `zuzu`, `easy-contract`, `createAppModule` 같은 측정 프로젝트 고유 이름을 제품
   코드에 하드코딩하지 않는다.
4. 실제 `rtcc-poc-page`는 읽기 전용 검증 corpus로만 사용한다.
5. 외부 프로젝트 파일을 수정하지 않는다.
6. 기존 dirty worktree 변경을 되돌리거나 덮어쓰지 않는다.
7. maintained file은 1,000줄을 넘기지 않는다.
8. 새 파일과 공개 타입·함수에는 역할, 안전 경계, 실패 동작을 설명하는 JSDoc을 작성한다.
9. 정적으로 증명할 수 없는 경로는 생성하지 않는다.
10. wildcard Route를 삭제하거나 무조건 첫 페이지를 렌더링하는 방식으로 테스트를 통과시키지
    않는다.
11. factory 함수나 프로젝트 모듈을 extension host에서 실행하지 않는다.
12. 각 단계가 끝날 때 해당 단계의 테스트, `npm run typecheck`, `npm run check:lines`를
    실행한다.
13. 아래에서 지정한 심볼을 찾지 못하면 먼저
    `rg -n "<심볼>" src test`로 확인한다. 그래도 없으면 구현을 중지하고 누락된 심볼을
    보고한다.

## 2. 실제 소스에서 확인된 Route 생성 과정

### 2.1 선택 파일

`fi-sta-app.tsx`에는 실제 page Route의 `path`와 `element`가 없다.

```tsx
export const FiStaApp = createAppModule(
  '/investor/easy-contract',
  {
    FiStaListPage,
    FiStaBillingDetailPage,
    FiStaCompanyOwnerCheckPage,
    FiStaCreatePage,
    FiStaContactPage,
    FiStaJoinPage,
    FiStaFaqPage,
    FiStaBillingListPage,
  },
  [FiStaManagementApp],
  ({ pageRoutes, subModuleRoutes }) => (
    <FiStaLayout>
      <Routes>
        {pageRoutes}
        {subModuleRoutes}
        <Route path="*" element={<NotFoundStatus />} />
      </Routes>
    </FiStaLayout>
  ),
);
```

소스에 직접 존재하는 Route는 wildcard fallback 하나뿐이다.

### 2.2 factory alias 경계

`legal/app/create-app-module.tsx`는 Route를 만들지 않고 curried factory를 export한다.

```ts
export const createAppModule = createAppModuleBase(pageNamePathMap);
```

따라서 선택 파일의 callee import만 따라가면 한 단계 더 안쪽의 반환 함수를 찾아야 한다.

### 2.3 Route 생성 경계

`common/packages/create-app-module-base.tsx`가 실제 Route를 생성한다.

```tsx
pageRoutes: Object.entries(pages).map(([pageName, PageComponent]) => (
  <Route
    path={extractRelativePath(strippedBasePath, pageNamePathMap[pageName])}
    element={<PageComponent />}
  />
)),
subModuleRoutes: subModules.map((App) => (
  <Route
    path={`${extractRelativePath(strippedBasePath, App.basePath)}/*`}
    element={<App />}
  />
)),
```

즉 Route manifest를 만들려면 다음 네 값을 결합해야 한다.

1. 선택 factory 호출의 첫 번째 인자 `basePath`
2. 두 번째 인자 page component map
3. 세 번째 인자 submodule component array
4. `pageNamePathMap`의 근거인 `pages.json`

### 2.4 catalog 경계

`legal/pages-map.ts`는 JSON을 즉시 export하지 않는다.

```ts
import pages from "./pages.json";
const pagePathNameMap = _.mapKeys(toPagePathNameMap(pages), ...);
export const pageNamePathMap = _.invert(pagePathNameMap);
```

현재 analyzer가 filename 기반 source inventory에서 `pages-map.ts`를 우연히 찾지 못하면
factory page 이름을 path로 연결할 수 없다.

### 2.5 상위 App Route 경계

`legal/app/app.tsx`의 Route path도 literal이 아니다.

```tsx
<Route
  path={getRoutingPath(`${FiStaApp.basePath}/*`)}
  element={
    <SecondaryServiceLayout>
      <FiStaApp />
    </SecondaryServiceLayout>
  }
/>
```

현재 direct Route analyzer는 literal path만 읽고 element의 최상위 component만
`SecondaryServiceLayout`로 인식한다. 따라서 같은 Route 안쪽의 `FiStaApp`과 computed path를
연결하지 못한다.

### 2.6 중첩 module 경계

`FiStaManagementApp`의 base path에는 정규식 parameter가 있다.

```ts
const basePath = '/investor/easy-contract/:fiStaManagementId(\\d+)';
```

내부 wrapper는 부모 Route가 제공하는 parameter를 요구한다.

```tsx
const { fiStaManagementId = '' } = useParams();
if (!fiStaManagementId) throw Error('never');
```

`FiStaManagementApp`을 직접 VirtualPage root로 마운트하면 두 문제가 생긴다.

1. raw base pattern의 `:fiStaManagementId(\d+)`와 concrete pathname의 `1`을 문자열 prefix로
   비교할 수 없다.
2. 부모 `<Route path=":fiStaManagementId/*">`가 없으므로 `useParams()`가 빈 값을 반환한다.

## 3. 확정된 실패 원인

### 원인 A: variable Route와 page map의 path 결합이 없다

현재 `previewInspectorRouteFactory.ts`는 callback의 Route 슬롯과 page/submodule 이름을
수집하지만 각 항목에 다음을 결합한 manifest를 만들지 않는다.

- component reference
- catalog absolute pattern
- owner 기준 relative Router pattern
- page 또는 submodule 구분

### 원인 B: catalog 발견이 bounded source inventory의 filename에 의존한다

`previewInspectorRouteLocation.ts`는 `ROUTE_REGISTRY_SOURCE_PATTERN`과 일치하는
`options.sourcePaths`만 찾아 JSON import를 읽는다. 실제 render path에 `pages-map.ts`가
포함되지 않으면 factory choice에 대응하는 candidate가 0개가 된다.

### 원인 C: wildcard fallback이 정상 page choice와 같은 후보로 들어간다

`previewInspectorDirectRouteChoices.ts`는
`<Route path="*" element={<NotFoundStatus />}>`를 ordinary choice로 반환한다.

factory page candidates가 catalog 누락으로 0개가 되면 wildcard가 유일한 route choice가
되어 자동 선택된다. 이 상태가 “Route를 해석하지 못하고 NotFound만 보이는” 직접 원인이다.

### 원인 D: computed outer Route와 감싼 target을 연결하지 못한다

`getRoutingPath(\`${ImportedApp.basePath}/*\`)`는 literal reader가 거부한다.
element는 Layout이 최상위라 target app identity도 잃는다. 결과적으로 상위 layout과 app
route가 authored path 증거로 연결되지 않는다.

### 원인 E: raw dynamic base pattern을 concrete URL에 문자열 prefix로 적용한다

`previewInspectorPageCandidateRuntimeSource.ts`의
`createPreviewInspectorCandidateInitialEntry`는 `pathname.startsWith(basePath + "/")`를
사용한다. 정규식 parameter가 포함된 base pattern은 concrete pathname과 절대 일치하지
않는다.

### 원인 F: VirtualPage content root를 너무 안쪽으로 선택하면 부모 Route parameter가 사라진다

중첩 app이나 leaf page를 직접 마운트하면 outer factory가 만든 Route chain이 실행되지 않는다.
경로 문자열만 맞춰도 `useParams`, relative nested Routes, wrapper provider 계약은 복원되지
않는다.

## 4. 고정 설계

구현은 다음 pipeline 하나로 고정한다.

```text
selected factory call
  → bounded factory-definition trace
  → exact catalog import trace
  → factory route manifest
  → fallback-separated route inventory
  → selected nested branch + mount chain
  → outermost required route-owner execution root
  → pattern-aware MemoryRouter pathname
  → authentic factory wrapper renders selected page
```

legacy direct Route, Next App Router, Next Pages Router 경로는 그대로 유지한다.

## 5. 고정 데이터 계약

### 5.1 신규 파일

다음 파일을 추가한다.

- `src/adapters/esbuild/inspector/previewInspectorRouteFactoryManifestTypes.ts`
- `src/adapters/esbuild/inspector/previewInspectorRouteFactoryDefinition.ts`
- `src/adapters/esbuild/inspector/previewInspectorRouteFactoryCatalog.ts`
- `src/adapters/esbuild/inspector/previewInspectorRouteFactoryManifest.ts`
- `src/adapters/esbuild/inspector/previewInspectorRoutePatternMatch.ts`

### 5.2 factory manifest 타입

`previewInspectorRouteFactoryManifestTypes.ts`에 정확히 다음 타입을 둔다.

```ts
export type PreviewInspectorFactoryRouteKind = 'page' | 'submodule';

export interface PreviewInspectorFactoryRouteEntry {
  readonly absolutePattern: string;
  readonly componentExportName?: string;
  readonly componentName: string;
  readonly componentSourcePath?: string;
  readonly kind: PreviewInspectorFactoryRouteKind;
  readonly relativeRouterPattern: string;
}

export interface PreviewInspectorFactoryFallbackEntry {
  readonly componentName: string;
  readonly occurrenceStart: number;
  readonly pattern: '*';
}

export interface PreviewInspectorRouteFactoryManifest {
  readonly basePattern: string;
  readonly dependencies: readonly string[];
  readonly fallbacks: readonly PreviewInspectorFactoryFallbackEntry[];
  readonly ownerExportName: string;
  readonly ownerSourcePath: string;
  readonly routes: readonly PreviewInspectorFactoryRouteEntry[];
  readonly routeSlotCount: number;
  readonly unresolvedChoiceNames: readonly string[];
}
```

규칙:

- `absolutePattern`은 catalog/factory에 쓰인 정규식 constraint를 보존한다.
- `relativeRouterPattern`은 React Router v6에 실제 전달되는 형태다.
- index page의 relative pattern은 빈 문자열 `""`이다.
- submodule relative pattern은 마지막에 `/*`를 가진다.
- wildcard fallback은 `routes`에 넣지 않는다.
- 배열은 source order 또는 catalog traversal order를 유지하고 freeze한다.

## 6. 단계별 구현

### 단계 1: 재현 fixture를 먼저 추가

신규 파일:

- `test/adapters/esbuild/inspector/previewInspectorVariableRouteFactoryManifest.test.ts`
- `test/adapters/esbuild/inspector/previewInspectorVariableRouteFactoryIntegration.test.ts`

fixture 디렉터리는 테스트마다 `mkdtemp`로 만들고 다음 구조를 작성한다.

```text
src/
  application.tsx
  create-section-module.ts
  create-section-module-base.tsx
  page-map.ts
  pages.json
  section-app.tsx
  management-app.tsx
  layout.tsx
  pages/list-page/index.ts
  pages/list-page/list-page.tsx
  pages/create-page/index.ts
  pages/create-page/create-page.tsx
  pages/payment-page/index.ts
  pages/payment-page/payment-page.tsx
  not-found.tsx
```

fixture는 실제 구조를 일반화해서 다음 모양으로 작성한다.

```tsx
export const SectionApp = createSectionModule(
  '/section',
  { ListPage, CreatePage },
  [ManagementApp],
  ({ generatedPages, generatedModules }) => (
    <Layout>
      <Routes>
        {generatedPages}
        {generatedModules}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  ),
);
```

중첩 module:

```tsx
export const ManagementApp = createSectionModule(
  '/section/:managementId(\\d+)',
  { PaymentPage },
  [],
  ({ generatedPages }) => {
    const { managementId = '' } = useParams();
    if (!managementId) throw Error('missing managementId');
    return (
      <Routes>
        {generatedPages}
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  },
);
```

상위 application:

```tsx
<Route
  path={normalizeRoute(`${SectionApp.basePath}/*`)}
  element={
    <OuterLayout>
      <SectionApp />
    </OuterLayout>
  }
/>
```

catalog:

```json
{
  "section": {
    "index": "ListPage",
    "create": "CreatePage",
    ":managementId(\\d+)": {
      "payment": "PaymentPage"
    }
  }
}
```

최초 테스트 기대값:

- manifest test는 아직 module이 없어서 실패해야 한다.
- integration test는 수정 전 `NOT_FOUND_MARKER` 또는 missing parameter error를 관찰해야
  한다.

### 단계 2: pattern 조작을 별도 모듈로 구현

신규:

- `src/adapters/esbuild/inspector/previewInspectorRoutePatternMatch.ts`
- `test/adapters/esbuild/inspector/previewInspectorRoutePatternMatch.test.ts`

export 함수:

```ts
export function stripPreviewInspectorRouteConstraints(pattern: string): string;

export function relativizePreviewInspectorRoutePattern(
  ownerBasePattern: string,
  absoluteChildPattern: string,
): string | undefined;

export function localizePreviewInspectorRoutePathname(
  ownerBasePattern: string,
  concretePathname: string,
): string | undefined;
```

정확한 알고리즘:

1. pattern을 `/` 기준 segment로 나눈다.
2. parameter segment는
   `^:([$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*)(?:\((.*)\))?\??$`
   형태로 파싱한다.
3. static segment는 동일 문자열일 때만 호환된다.
4. parameter segment끼리는 이름이 같아야 한다.
5. owner에 constraint가 있고 child에 없으면 owner constraint를 유지한다.
6. child에 constraint가 있고 owner에 없으면 child constraint를 유지한다.
7. 서로 다른 parameter 이름 또는 서로 다른 static segment면 `undefined`를 반환한다.
8. relative pattern은 호환되는 owner segment 수만큼 child 앞부분을 제거한다.
9. 남는 segment가 없으면 `""`를 반환한다.
10. React Router v6용 relative pattern에서는 `(...)` constraint를 제거한다.
11. concrete pathname localization은 static segment를 exact 비교한다.
12. dynamic segment는 concrete segment 하나를 소비한다.
13. numeric constraint가 `\d`, `[0-9]`, `digit`을 포함하면 concrete segment가 숫자일 때만
    소비한다.
14. owner pattern 전체가 매치되면 남은 concrete segment를 `/`로 시작하는 pathname으로
    반환한다.
15. 남은 segment가 없으면 `/`를 반환한다.
16. query와 hash는 입력 단계에서 거부한다.

필수 단위 테스트:

```text
relativize("/section", "/section") → ""
relativize("/section", "/section/create") → "create"
relativize(
  "/section/:managementId(\\d+)",
  "/section/:managementId(\\d+)/payment"
) → "payment"
localize("/section", "/section/1/payment") → "/1/payment"
localize(
  "/section/:managementId(\\d+)",
  "/section/1/payment"
) → "/payment"
localize(
  "/section/:managementId(\\d+)",
  "/section/text/payment"
) → undefined
```

기존 `previewInspectorRoutePattern.ts`의 normalize/materialize 함수는 이동하지 않는다.

### 단계 3: curried factory definition을 bounded trace

신규:

- `previewInspectorRouteFactoryDefinition.ts`
- `test/adapters/esbuild/inspector/previewInspectorRouteFactoryDefinition.test.ts`

export 타입과 함수:

```ts
export interface PreviewInspectorRouteFactoryDefinition {
  readonly baseParameterName: string;
  readonly catalogBindingName?: string;
  readonly dependencyPaths: readonly string[];
  readonly pageCollectionParameterName: string;
  readonly pageSlotPropertyName: string;
  readonly submoduleCollectionParameterName: string;
  readonly submoduleSlotPropertyName: string;
  readonly wrapperParameterName: string;
}

export async function resolvePreviewInspectorRouteFactoryDefinition(options: {
  readonly callExpression: ts.CallExpression;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}): Promise<PreviewInspectorRouteFactoryDefinition | undefined>;
```

bounded trace 규칙:

1. 최대 8개 module을 읽는다.
2. 최대 32개 identifier/initializer edge를 따라간다.
3. cycle key는 `sourcePath + "\0" + exportName`이다.
4. selected call callee가 local import면 resolver로 source를 찾는다.
5. named/default export alias를 따라간다.
6. exported const initializer가 다른 factory call이면 그 callee를 한 번 더 따라간다.
7. curried outer call의 인자는 inner returned function의 closure dependency로 보존한다.
8. returned arrow/function의 parameter를 selected call argument 위치와 연결한다.
9. wrapper parameter에 적용되는 HOC/call chain 안에서 object literal을 찾는다.
10. object property initializer가 page collection parameter를 참조하며
    `Object.entries(...).map(...)` 형태면 그 property를 page slot으로 기록한다.
11. object property initializer가 submodule collection parameter의 `.map(...)` 형태면 그
    property를 submodule slot으로 기록한다.
12. property 이름은 어떤 문자열이어도 된다.
13. `withProps`라는 callee 이름에 의존하지 않는다.
14. object가 최종 wrapper parameter에 component/HOC 인자로 연결된 것이 증명되어야 한다.
15. computed property, mutation, spread-only object는 unresolved로 종료한다.
16. unresolved면 `undefined`를 반환하고 factory를 실행하지 않는다.

fixture 기대값:

```text
baseParameterName = "basePath"
pageCollectionParameterName = "pages"
submoduleCollectionParameterName = "subModules"
wrapperParameterName = "Component"
pageSlotPropertyName = "generatedPages"
submoduleSlotPropertyName = "generatedModules"
```

### 단계 4: catalog를 factory dependency에서 직접 찾기

신규:

- `previewInspectorRouteFactoryCatalog.ts`
- `test/adapters/esbuild/inspector/previewInspectorRouteFactoryCatalog.test.ts`

export 함수:

```ts
export async function collectPreviewInspectorRouteFactoryCatalog(options: {
  readonly catalogBindingName: string;
  readonly expectedComponentNames: ReadonlySet<string>;
  readonly maximumModules?: number;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
}): Promise<{
  readonly dependencyPaths: readonly string[];
  readonly patternsByComponentName: ReadonlyMap<string, readonly string[]>;
}>;
```

알고리즘:

1. factory definition의 `catalogBindingName`에서 시작한다.
2. import/export alias와 same-file const initializer만 따라간다.
3. initializer identifier dependency를 DFS로 따른다.
4. 최대 module 8개, initializer edge 64개다.
5. 도달한 `.json` import만 parse한다.
6. JSON object key를 path segment로 사용한다.
7. `"index"`와 빈 key는 segment를 추가하지 않는다.
8. string leaf가 `expectedComponentNames`에 있으면 absolute pattern을 기록한다.
9. 동일 component가 여러 path에 있으면 모두 보존한다.
10. expected name과 한 개도 겹치지 않는 JSON은 결과에서 제외한다.
11. filename이 `pages.json`인지 여부로 판별하지 않는다.
12. JSON 외 JS/TS initializer를 실행하지 않는다.
13. 읽은 source와 JSON 파일을 모두 `dependencyPaths`에 넣는다.

actual 구조에서 trace는 다음 순서로 끝나야 한다.

```text
selected createAppModule call
→ legal/app/create-app-module.tsx
→ createAppModuleBase(pageNamePathMap)
→ legal/pages-map.ts
→ imported JSON
```

### 단계 5: factory route manifest 생성

신규:

- `previewInspectorRouteFactoryManifest.ts`

수정:

- `previewInspectorRouteFactory.ts`
- `previewInspectorRouteFactoryChoices.ts`

export 함수:

```ts
export async function collectPreviewInspectorRouteFactoryManifest(options: {
  readonly exportName: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
  readonly sourceText: string | undefined;
}): Promise<PreviewInspectorRouteFactoryManifest | undefined>;
```

알고리즘:

1. 기존 `collectPreviewInspectorRouteFactoryEvidence`로 selected export의 call 하나를 선택한다.
2. 동일 export factory가 여러 개면 occurrence가 가장 빠른 하나만 사용한다.
3. 단계 3 definition으로 page/submodule slot provenance를 증명한다.
4. callback object binding alias를 property 기준으로 slot과 연결한다.
5. 두 번째 argument object에서 page choice를 source order로 읽는다.
6. 세 번째 argument array에서 submodule choice를 source order로 읽는다.
7. page choice import reference를 기존 resolver로 연결한다.
8. page component 이름 set으로 단계 4 catalog를 수집한다.
9. 각 page choice와 catalog path를 결합한다.
10. `relativizePreviewInspectorRoutePattern(basePattern, absolutePattern)`이 성공한 entry만
    `routes`에 넣는다.
11. submodule import source를 읽어 해당 export의 factory base evidence를 수집한다.
12. submodule absolute base를 owner base 기준으로 relativize하고 `/*`를 붙인다.
13. callback의 동일 `<Routes>` boundary 안 literal wildcard는 `fallbacks`에만 넣는다.
14. catalog path가 없는 page, source를 못 찾은 submodule은
    `unresolvedChoiceNames`에 넣는다.
15. unresolved choice를 wildcard로 대체하지 않는다.

실제 outer manifest 기대값:

```text
basePattern = "/investor/easy-contract"
routes:
  FiStaListPage → absolute "/investor/easy-contract", relative ""
  FiStaCreatePage → absolute "/investor/easy-contract/create", relative "create"
  FiStaBillingDetailPage
    → absolute "/investor/easy-contract/billing-detail/:billingId(\\d+)"
    → relative "billing-detail/:billingId"
  FiStaManagementApp
    → absolute "/investor/easy-contract/:fiStaManagementId(\\d+)"
    → relative ":fiStaManagementId/*"
fallbacks.length = 1
```

### 단계 6: wildcard와 ordinary choice를 분리

수정:

- `previewInspectorDirectRouteChoices.ts`
- `previewInspectorRouteLocation.ts`
- 관련 기존 테스트

`PreviewInspectorDirectRouteChoice`에 추가:

```ts
readonly role: "page" | "fallback";
```

규칙:

1. normalized pattern의 마지막 segment가 `*`이고 element가 존재하면 `fallback`이다.
2. 그 외에는 `page`다.
3. direct router만 분석하는 legacy 화면에서는 fallback을 metadata로 보존한다.
4. factory manifest가 있는 owner에서는 같은 callback boundary의 fallback을
   `choices`에 넣지 않는다.
5. manifest route가 0개여도 fallback을 자동 선택하지 않는다.
6. 이 경우 `primary`는 factory owner base이고 inventory에
   `unresolvedFactoryRoutes: true`를 기록한다.

`PreviewInspectorRouteLocationInventory`에 추가:

```ts
readonly fallbackCount: number;
readonly unresolvedFactoryRoutes: boolean;
```

필수 테스트:

- catalog가 정상일 때 List/Create/Management만 choice이고 NotFound는 choice가 아니다.
- catalog import가 끊겨도 NotFound가 default choice가 아니다.
- ordinary non-factory `<Routes>`의 wildcard metadata는 손실되지 않는다.

### 단계 7: manifest route를 location inventory의 우선 입력으로 사용

수정:

- `previewInspectorRouteLocation.ts`

구현 순서:

1. selected source를 읽은 직후 factory manifest를 한 번 수집한다.
2. manifest가 있으면 manifest route별 `PreviewInspectorRouteLocation`을 직접 만든다.
3. component name으로 전역 ranked candidate를 다시 검색하지 않는다.
4. manifest entry가 이미 component reference를 가지면 그대로 사용한다.
5. manifest absolute pattern을 `pathname` materialization에 사용한다.
6. owner mount에는 manifest base pattern을 넣는다.
7. manifest dependency를 location dependency에 넣는다.
8. legacy registry source scan은 manifest가 없는 target에만 primary path로 사용한다.
9. manifest가 있으나 일부 route만 unresolved면 resolved route를 먼저 제공하고 unresolved
   이름을 diagnostics에 보존한다.
10. `MAX_ROUTE_CANDIDATES`와 기존 branch cap은 유지한다.

성능 조건:

- factory source 하나당 definition/catalog trace는 한 번만 실행한다.
- `readSource` promise cache를 manifest collector와 location collector가 공유한다.
- route 선택 변경 시 catalog와 manifest parse 결과를 build snapshot key로 재사용한다.
- 모든 page module 본문을 읽지 않는다.

### 단계 8: computed Route path와 감싼 target을 연결

수정:

- `previewInspectorDirectRouteChoices.ts`

타입 확장:

```ts
export interface PreviewInspectorDirectRouteRenderedComponent {
  readonly componentName: string;
  readonly exportName?: string;
  readonly sourcePath?: string;
  readonly wrapperDepth: number;
}

// PreviewInspectorDirectRouteChoice
readonly renderedComponents: readonly PreviewInspectorDirectRouteRenderedComponent[];
readonly pathEvidenceKind: "literal" | "component-base";
```

element 분석:

1. Route element JSX를 DFS한다.
2. intrinsic lowercase tag는 무시한다.
3. 최대 64개 component identity와 wrapper depth를 기록한다.
4. 최상위 Layout과 하위 target app을 모두 보존한다.
5. 같은 component/source/export는 첫 occurrence만 남긴다.

path expression 분석:

1. 기존 literal path를 먼저 시도한다.
2. identifier이면 same-file immutable initializer를 최대 8번 따른다.
3. template expression과 `+` binary expression에서
   `ImportedComponent.basePath` property access를 찾는다.
4. one-argument call이면 인자를 최대 4단계 unwrap한다.
5. path expression의 component binding이 `renderedComponents` 중 하나와 일치해야 한다.
6. 해당 import source를 읽고 selected export의 factory base evidence를 찾는다.
7. 찾은 base pattern을 canonical route pattern으로 사용한다.
8. template의 terminal `/*`는 canonical pattern에도 붙인다.
9. wrapper call의 구현을 실행하거나 의미를 추측하지 않는다.
10. component binding과 element descendant가 다르면 증거를 폐기한다.

actual 상위 Route 기대값:

```text
pattern = "/investor/easy-contract/*"
pathEvidenceKind = "component-base"
renderedComponents:
  SecondaryServiceLayout depth 0
  FiStaApp depth 1
```

이 증거를 ancestor/render path에 연결해 `SecondaryServiceLayout`을 shell로 유지한다.

### 단계 9: 중첩 route-owner 실행 root를 고정

수정:

- `previewInspectorRouteBranchPlan.ts`
- `previewInspectorAncestorPlan.ts`
- `previewInspectorAncestorTypes.ts`
- `previewInspectorVirtualPagePlan.ts`

`PreviewInspectorRouteBranchPlan`에 추가:

```ts
readonly executionRoot?: {
  readonly basePattern: string;
  readonly exportName: string;
  readonly sourcePath: string;
};
```

선택 규칙:

1. active location의 `routeMounts`를 outer-to-inner 순서로 읽는다.
2. selected pathname을 소유하는 첫 번째 importable mount를 고른다.
3. 그 mount를 `executionRoot`로 사용한다.
4. leaf page보다 route owner를 우선한다.
5. outer owner가 없을 때만 기존 VirtualPage content scoring을 사용한다.
6. `previewInspectorAncestorPlan.ts`는 execution root candidate를 동일 render path에 한 번
   추가한다.
7. `previewInspectorVirtualPagePlan.ts`는 execution root가 있으면 이를 content root로
   고정한다.
8. route owner의 wrapper callback과 selected corridor page는 실제로 번들한다.
9. 선택하지 않은 page/submodule은 기존 corridor projection으로 제외한다.

FiSta management page 선택 시 기대 실행 구조:

```text
MemoryRouter initial entry = "/1/payment"
  FiStaApp
    Route path=":fiStaManagementId/*"
      FiStaManagementApp
        useParams() = { fiStaManagementId: "1" }
        Route path="payment"
          selected page
```

`FiStaManagementApp`을 직접 root로 마운트하지 않는다. 그래야 부모 Route parameter와 실제
provider/layout chain이 유지된다.

### 단계 10: initial pathname을 pattern-aware하게 현지화

수정:

- `previewInspectorPageCandidateRuntimeSource.ts`
- `previewInspectorRootPlugin.ts`
- 관련 runtime source 테스트

변경:

1. `routeMountBasePath` 이름을 `routeMountBasePattern`으로 변경한다.
2. browser candidate에 raw authored base pattern을 직렬화한다.
3. `createPreviewInspectorCandidateInitialEntry`에서 문자열 `startsWith`를 제거한다.
4. 단계 2의 browser-safe 동일 알고리즘을 runtime source로 생성한다.
5. root own data property `basePath`와 compiler base pattern에 같은 matcher를 적용한다.
6. runtime static을 우선하고 compiler evidence를 fallback으로 사용한다.
7. direct target에는 기존처럼 localization을 적용하지 않는다.

필수 runtime 테스트:

```text
base "/section", pathname "/section/1/payment" → "/1/payment"
base "/section/:managementId(\\d+)",
  pathname "/section/1/payment" → "/payment"
base "/section/:managementId(\\d+)",
  pathname "/section/text/payment" → unchanged
base getter → getter 호출 없이 compiler fallback 사용
directTarget true → unchanged
```

### 단계 11: diagnostics 추가

수정:

- `previewInspectorPageCandidateRuntimeSource.ts`
- runtime health 테스트

`page-context-selected.detail`에 bounded scalar만 추가한다.

```ts
factoryManifestFound: boolean;
factoryPageRouteCount: number;
factorySubmoduleRouteCount: number;
factoryFallbackCount: number;
factoryUnresolvedChoiceCount: number;
routeExecutionRootSourcePath: string | undefined;
routeExecutionRootExportName: string | undefined;
routeMountBasePattern: string | undefined;
routePathnameBeforeLocalization: string;
requestedRouterPathname: string;
routePathEvidenceKind: 'literal' | 'component-base' | 'none';
```

전체 route 배열, 전체 JSON, 전체 source text는 로그에 넣지 않는다.

별도 warning 조건:

- manifest가 있고 resolved route가 0개
- selected submodule에 factory base evidence가 없음
- execution root와 mount chain이 불일치
- base pattern이 concrete pathname과 매치되지 않음

warning 문구에는 fallback component 이름을 정상 page처럼 표시하지 않는다.

## 7. 통합 회귀 테스트

`previewInspectorVariableRouteFactoryIntegration.test.ts`에서 다음 case를 모두 통과시킨다.

### Case 1: outer index

선택 pathname: `/section`

기대:

- `OUTER_LAYOUT_MARKER` 존재
- `SECTION_LAYOUT_MARKER` 존재
- `LIST_PAGE_MARKER` 존재
- `NOT_FOUND_MARKER` 없음

### Case 2: outer direct child

선택 pathname: `/section/create`

기대:

- `CREATE_PAGE_MARKER` 존재
- `NOT_FOUND_MARKER` 없음

### Case 3: nested dynamic child

선택 pathname: `/section/1/payment`

기대:

- `MANAGEMENT_PARAM_MARKER:1` 존재
- `PAYMENT_PAGE_MARKER` 존재
- `NOT_FOUND_MARKER` 없음
- missing parameter error 없음

### Case 4: catalog source가 render path inventory에 없음

`sourcePaths`에서 `page-map.ts`와 JSON을 제외한다.

기대:

- factory dependency trace가 catalog를 직접 발견한다.
- Case 1과 동일하게 List page가 렌더링된다.

### Case 5: unresolved catalog

JSON resolver를 의도적으로 끊는다.

기대:

- `unresolvedFactoryRoutes = true`
- NotFound를 자동 선택하지 않음
- 명시적 “factory route catalog unresolved” diagnostics

### Case 6: sibling pruning

선택하지 않은 page module마다 고유 top-level marker를 둔다.

기대:

- output bundle에 selected marker만 존재
- sibling top-level marker 없음
- route metadata에는 sibling label은 남을 수 있음

### Case 7: lazy re-export

page map 값은 `lazy(() => import("./page"))`를 export하는 index module이다.

기대:

- route component reference는 index named export를 유지
- runtime에서 lazy leaf가 정상 렌더링

## 8. 기존 테스트에서 반드시 유지할 항목

다음 suite를 수정 후 모두 실행한다.

```bash
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteFactory.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteLocation.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteBranchPlan.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRootPlugin.test.ts
npm test -- --run test/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorDirectRouteChoices.test.ts
```

Next 관련 suite가 별도 파일이면 다음 검색으로 찾고 전부 실행한다.

```bash
rg -l "next-app-filesystem|next-pages-filesystem" test/adapters/esbuild
```

## 9. 성능 및 안전 예산

고정 상한:

- factory definition module: 8
- definition identifier edge: 32
- catalog trace module: 8
- catalog initializer edge: 64
- rendered component identities per Route: 64
- computed path unwrap depth: 8
- nested route owner depth: 기존 8 유지
- route candidates: 기존 4,096 유지

금지:

- repository 전체 DFS
- 모든 JSON parse
- 모든 page module 본문 read
- route 선택마다 factory definition 재분석
- esbuild에서 모든 sibling을 eager import

cache key:

```text
source snapshot revision
+ factory owner sourcePath
+ factory owner exportName
+ selected route branch id
```

## 10. 실제 corpus 수동 검증

구현 완료 후 Extension Development Host에서 다음 순서로 확인한다.

1. `fi-sta-app.tsx`를 연다.
2. Page Preview를 실행한다.
3. route selector에 list/index, create, billing list/detail, management submodule이 있는지
   확인한다.
4. index를 선택하고 `FiStaLayout`과 list page가 함께 보이는지 확인한다.
5. management의 concrete child를 선택한다.
6. `Error("never")`가 발생하지 않는지 확인한다.
7. `NotFoundStatus`가 정상 route 대신 표시되지 않는지 확인한다.
8. 상위 `SecondaryServiceLayout`이 page shell에 보존되는지 확인한다.
9. runtime health 로그에서 manifest 발견, page 8개, submodule 1개, fallback 1개,
   unresolved 0개, outer execution root와 localized pathname을 확인한다.

## 11. 최종 검증 명령

순서대로 실행하고 하나라도 실패하면 완료 처리하지 않는다.

```bash
npm run check:lines
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```
