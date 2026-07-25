# Variable Route Factory 복구 작업 계획

상태: 구현 대기  
대상 결함: `create*App(...)` 계열 팩토리의 JSX 콜백에 주입되는
`{pageRoutes}` / `{subModuleRoutes}`가 선택 경로로 연결되지 않아 마지막
`<Route path="*" ...>`만 렌더링되는 문제

## 1. 이 문서의 실행 규칙

이 계획은 저비용 하위 모델이 추가 설계 판단 없이 위에서 아래 순서대로 실행하도록
작성했다.

1. 각 단계의 파일과 함수 이름을 그대로 사용한다.
2. 먼저 명시된 실패 테스트를 추가하고 실패 이유를 확인한 뒤 제품 코드를 수정한다.
3. 아래에 없는 광범위한 리팩터링, 이름 변경, 의존성 추가를 하지 않는다.
4. `FiSta`, 특정 URL, 특정 프로젝트의 타입·함수·변수 이름을 제품 코드에 하드코딩하지
   않는다.
5. 프로젝트 소스인 `rtcc-poc-page`는 읽기 전용 회귀 사례로만 사용한다. 해당 프로젝트를
   수정하지 않는다.
6. 기존 dirty worktree 변경을 되돌리거나 덮어쓰지 않는다.
7. 파일은 1,000줄을 넘기지 않는다. 수정 후 매 단계에서 `npm run check:lines`를 실행한다.
8. 새 파일과 새 공개 함수에는 역할, 입력 제한, 실패 시 동작을 설명하는 상세 JSDoc을
   작성한다.
9. 명시된 심볼을 찾지 못하면 비슷한 코드를 새로 만들지 말고 `rg -n "<심볼>" src test`로
   위치를 확인한다. 그래도 없으면 작업을 중지하고 누락된 심볼을 보고한다.
10. 테스트를 통과시키기 위해 wildcard Route를 제거하거나 항상 첫 페이지를 강제로
    렌더링하지 않는다. 정확한 선택 경로가 Router에 전달되어야 한다.

## 2. 재현 사례

대표 구조는 다음과 같다.

```tsx
export const FeatureApp = createAppModule(
  '/feature',
  {
    FeatureListPage,
    FeatureCreatePage,
  },
  [FeatureManagementApp],
  ({ pageRoutes, subModuleRoutes }) => (
    <AppErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <FeatureLayout>
          <Routes>
            {pageRoutes}
            {subModuleRoutes}
            <Route path="*" element={<NotFoundStatus />} />
          </Routes>
        </FeatureLayout>
      </Suspense>
    </AppErrorBoundary>
  ),
);
```

실제 읽기 전용 검증 대상:

- `/Users/lky/project/rtcc-poc-page/zuzu/client/src/legal/fi-sta/app/fi-sta-app.tsx`
- `/Users/lky/project/rtcc-poc-page/zuzu/client/src/legal/fi-sta/management/app/fi-sta-management-app.tsx`
- `/Users/lky/project/rtcc-poc-page/zuzu/client/src/legal/app/create-app-module.tsx`
- `/Users/lky/project/rtcc-poc-page/zuzu/client/src/common/packages/create-app-module-base.tsx`
- `/Users/lky/project/rtcc-poc-page/zuzu/client/src/legal/pages.json`

## 3. 확인된 원인

### 3.1 이미 동작하는 부분

- `previewInspectorRouteFactory.ts`의
  `collectPreviewInspectorRouteFactoryEvidence`는 팩토리의 절대 `basePath`를 읽는다.
- 같은 파일의 `readRouteFactoryChoices`는 두 번째 인자의 페이지 객체와 세 번째 인자의
  하위 모듈 배열을 읽는다.
- `previewInspectorRouteLocation.ts`는 페이지 이름을 route catalog와 연결한다.
- `previewInspectorRouteBranchPlan.ts`는 선택한 하위 router만 재귀적으로 따라간다.
- `previewInspectorPageCandidateRuntimeSource.ts`의
  `createPreviewInspectorCandidateInitialEntry`는 로드된 root에 `basePath` 정적 속성이 있으면
  전체 경로를 해당 app module의 로컬 경로로 바꾼다.

### 3.2 끊어진 부분

1. 팩토리 JSX 콜백의 구조분해 매개변수가 실제 `<Routes>` 자식 표현식으로 쓰였다는
   증거를 별도로 보존하지 않는다.
2. route choice가 어느 app module의 `basePath` 아래에서 생성됐는지 compiler-side
   mount chain으로 보존하지 않는다.
3. `previewInspectorRootPlugin.ts`의 `__reactPreviewComposeVirtualPage`는 원본 `Content`를
   새 `ReactPreviewVirtualPage` 함수로 감싸지만 `Content.basePath`를 복사하지 않는다.
4. 브라우저 런타임은 `loadState.value.basePath`만 확인한다. 3번 때문에 값이 없으면
   `/investor/easy-contract/...` 같은 전체 URL을 내부 `<Routes>`에 그대로 전달한다.
5. 내부 Route는 app module 기준의 로컬 경로를 기대하므로 일치하지 않고 마지막
   `path="*"`가 선택된다.

## 4. 완료 조건

모든 조건을 충족해야 완료다.

- 팩토리 콜백의 구조분해 이름이 alias여도 Route 슬롯을 찾는다.
- `{pageRoutes}`와 `{subModuleRoutes}`가 모두 선택 가능한 경로 증거에 연결된다.
- root app의 직접 페이지와 중첩 submodule의 페이지를 각각 선택할 수 있다.
- 선택한 페이지 marker가 렌더링되고 `NotFoundStatus` marker는 렌더링되지 않는다.
- VirtualPage가 원본 route-owner의 안전한 정적 계약을 보존한다.
- 정적 속성이 없어도 compiler가 증명한 mount base로 초기 Router 경로를 현지화한다.
- compiler 증거가 다른 root 소유자에게 속하면 경로를 잘못 잘라내지 않는다.
- 선택하지 않은 형제 페이지를 번들에 포함하지 않는다.
- wildcard만 존재하거나 경로를 증명하지 못한 경우 기존 authored fallback을 유지하고
  추측 경로를 만들지 않는다.
- 기존 Next App Router 및 Next Pages Router 테스트가 모두 통과한다.
- 전체 `npm run check`가 성공한다.

## 5. 고정 데이터 계약

아래 타입 이름과 필드를 그대로 사용한다.

### 5.1 팩토리 Route 슬롯

`src/adapters/esbuild/inspector/previewInspectorRouteFactory.ts`에 추가한다.

```ts
export interface PreviewInspectorRouteFactorySlotEvidence {
  /** 구조분해 뒤 JSX에서 실제로 참조된 로컬 식별자. */
  readonly localName: string;
  /** 구조분해 원본 property 이름. */
  readonly propertyName: string;
  /** JSX expression의 source offset. */
  readonly occurrenceStart: number;
}
```

`PreviewInspectorRouteFactoryEvidence`에 다음 필드를 추가한다.

```ts
readonly routeSlots: readonly PreviewInspectorRouteFactorySlotEvidence[];
readonly hasWildcardFallback: boolean;
```

의미:

- `routeSlots`는 팩토리 콜백의 첫 번째 object-binding 매개변수에서 시작해 같은 콜백이
  반환하는 `<Routes>` 계열 경계의 직접 JSX expression까지 정적으로 증명된 값만 담는다.
- `hasWildcardFallback`은 같은 `<Routes>` 경계에 정적 `path="*"` Route가 있을 때만
  `true`다.

### 5.2 route-owner mount

`previewInspectorRouteFactoryChoices.ts`에 다음 타입을 추가한다.

```ts
export interface PreviewInspectorRouteFactoryOwnerEvidence {
  readonly basePath: string;
  readonly hasWildcardFallback: boolean;
  readonly routeSlotCount: number;
  readonly sourcePath: string;
  readonly exportName: string;
}
```

`PreviewInspectorRouteFactoryChoiceInventory`에 다음 필드를 추가한다.

```ts
readonly owner?: PreviewInspectorRouteFactoryOwnerEvidence;
```

`previewInspectorRouteLocation.ts`에 다음 타입을 추가한다.

```ts
export interface PreviewInspectorRouteMountEvidence {
  readonly basePath: string;
  readonly hasWildcardFallback: boolean;
  readonly routeSlotCount: number;
  readonly sourcePath: string;
  readonly exportName: string;
}
```

`PreviewInspectorRouteLocation`에 다음 필드를 추가한다.

```ts
readonly routeMounts?: readonly PreviewInspectorRouteMountEvidence[];
```

규칙:

- `routeMounts`는 바깥 app module부터 안쪽 app module 순서다.
- 중첩 경로 합성 시 부모 배열 뒤에 자식 owner를 한 번만 붙인다.
- `sourcePath + "\0" + exportName + "\0" + basePath`가 같은 항목은 중복 제거한다.
- direct `<Route>`와 Next filesystem route는 이 필드를 만들지 않는다.

### 5.3 브라우저 후보의 현지화 기준

`PreviewInspectorPageCandidate`에 다음 필드를 추가한다.

```ts
readonly routeMountBasePath?: string;
readonly routeSlotCount?: number;
readonly wildcardFallbackPresent?: boolean;
```

이 값들은 전체 mount chain을 브라우저로 보내지 않고, 실제 VirtualPage `contentRoot`와
일치하는 단 하나의 mount에서 얻은 base path와 bounded 진단 scalar만 보낸다.

## 6. 구현 단계

### 단계 1. VirtualPage runtime 코드를 별도 모듈로 분리

수정:

- `src/adapters/esbuild/inspector/previewInspectorRootPlugin.ts`

추가:

- `src/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource.ts`
- `test/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource.test.ts`

작업:

1. `previewInspectorRootPlugin.ts`에 문자열 배열로 들어 있는 다음 생성 코드만 새 모듈로
   이동한다.
   - `__reactPreviewVirtualPageContentProbe`
   - `__reactPreviewVirtualPageShellBoundary`
   - `__reactPreviewReadPageName`
   - `__reactPreviewComposeVirtualPage`
2. 새 모듈에서
   `createPreviewInspectorVirtualPageRuntimeSource(): readonly string[]`를 export한다.
3. root plugin은 해당 함수를 import하여 기존 위치에 spread한다.
4. 이동 전후 생성 문자열의 순서와 동작은 바꾸지 않는다.
5. 기존 root plugin 테스트 중 위 helper 문자열만 검사하는 assertion은 새 테스트 파일로
   옮긴다.

이 단계를 먼저 하는 이유:

- `previewInspectorRootPlugin.ts`는 현재 약 960줄이다.
- 이후 정적 계약 복사 로직을 직접 추가하면 1,000줄 제한을 넘길 위험이 있다.

검증:

```bash
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRootPlugin.test.ts \
  test/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource.test.ts
npm run check:lines
```

### 단계 2. 팩토리 콜백의 Route 슬롯을 정적으로 수집

수정:

- `src/adapters/esbuild/inspector/previewInspectorRouteFactory.ts`

추가:

- `test/adapters/esbuild/inspector/previewInspectorRouteFactory.test.ts`

구현할 private 함수:

```ts
function readRouteFactoryRenderContract(
  callExpression: ts.CallExpression,
  sourceFile: ts.SourceFile,
): {
  readonly routeSlots: readonly PreviewInspectorRouteFactorySlotEvidence[];
  readonly hasWildcardFallback: boolean;
};
```

정확한 알고리즘:

1. 팩토리 호출 인자 중 네 번째 인자부터 마지막 인자까지 순서대로 검사한다.
2. 첫 번째 arrow function 또는 function expression만 JSX wrapper callback으로 사용한다.
3. callback의 첫 번째 매개변수가 object binding pattern이 아니면 빈 결과를 반환한다.
4. 각 binding element에서 다음 map을 만든다.
   - `{ pageRoutes }` → local `pageRoutes`, property `pageRoutes`
   - `{ pageRoutes: routes }` → local `routes`, property `pageRoutes`
5. expression body이면 그 expression을, block body이면 모든 `return` expression을 검사한다.
6. JSX tag의 마지막 이름이 `Routes`인 element만 Route 경계로 인정한다.
   - `<Routes>`
   - `<Router.Routes>`
7. 해당 경계의 direct child `JsxExpression`이 단일 identifier이고 4번 map에 있으면
   `routeSlots`에 기록한다.
8. 해당 경계의 direct child `<Route>` 또는 `<Router.Route>`가 정적
   `path="*"` attribute를 가지면 `hasWildcardFallback = true`로 기록한다.
9. expression을 실행하거나 identifier initializer를 따라가지 않는다.
10. 슬롯은 `propertyName + "\0" + localName + "\0" + occurrenceStart`로 중복 제거하고 source
    offset 순으로 정렬한다.

필수 테스트:

1. `{ pageRoutes, subModuleRoutes }` 두 슬롯과 wildcard를 수집한다.
2. `{ pageRoutes: own, subModuleRoutes: nested }` alias 두 슬롯을 수집한다.
3. `<Layout><Routes>...</Routes></Layout>`처럼 중첩된 경계를 수집한다.
4. callback 밖의 동일 이름 identifier는 수집하지 않는다.
5. `<Other>{pageRoutes}</Other>`는 Route 슬롯으로 수집하지 않는다.
6. computed `path={fallbackPath}`는 wildcard로 인정하지 않는다.
7. 기존 page object/submodule choice 수집 결과가 변하지 않는다.

검증:

```bash
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteFactory.test.ts
npm run typecheck
npm run check:lines
```

### 단계 3. 선택된 팩토리 owner 계약을 choice inventory에 보존

수정:

- `src/adapters/esbuild/inspector/previewInspectorRouteFactoryChoices.ts`
- `test/adapters/esbuild/inspector/previewInspectorRouteLocation.test.ts`

작업:

1. `collectPreviewInspectorRouteFactoryChoices`에서 기존 필터와 동일하게 선택 export를
   소유한 factory evidence만 모은다.
2. occurrence가 가장 앞선 factory 하나를 owner로 선택한다.
3. owner의 `basePath`, `hasWildcardFallback`, `routeSlots.length`, `sourcePath`와 실제
   `exportName`을 `inventory.owner`에 담는다.
4. 선택 factory가 없으면 `owner` 필드를 생략한다.
5. source text가 없을 때 반환하는 빈 inventory에도 `owner`를 만들지 않는다.
6. 기존 `choices`와 `references` 동작은 변경하지 않는다.

필수 테스트:

- named export factory의 owner 정보가 정확하다.
- default export factory의 `exportName`은 `"default"`다.
- 한 파일에 다른 factory가 있어도 선택 export의 owner만 사용한다.

주의:

- `pageRoutes`라는 property 이름 자체를 owner 판별 조건으로 사용하지 않는다.
- `routeSlots.length === 0`이어도 기존 factory choice는 제거하지 않는다. 기본 wrapper를
  내부에서 만드는 factory의 기존 동작을 보존해야 한다.

### 단계 4. 중첩 route mount chain 생성

수정:

- `src/adapters/esbuild/inspector/previewInspectorRouteLocation.ts`
- `src/adapters/esbuild/inspector/previewInspectorRouteBranchPlan.ts`
- `test/adapters/esbuild/inspector/previewInspectorRouteLocation.test.ts`
- `test/adapters/esbuild/inspector/previewInspectorRouteBranchPlan.test.ts`

작업:

1. `collectPreviewInspectorRouteLocationInventory`가 얻은
   `factoryChoiceInventory.owner`를 compiler-side inventory에 보존한다.
2. factory가 만든 `primary`와 `choices`를 freeze할 때 owner 한 개를 `routeMounts`에 넣는다.
3. `composeNestedRouteChoice(parent, child)`에서 다음 순서로 mount chain을 만든다.
   - `parent.routeMounts`
   - `child.routeMounts`
4. 동일 mount identity는 처음 한 번만 남긴다.
5. `activeWithCorridor`를 만들 때 `routeMounts`를 그대로 보존한다.
6. direct route, Next App route, Next Pages route에는 mount chain을 합성하지 않는다.

필수 테스트:

1. `/workspace/:workspaceId/feature` factory의 직접 페이지 choice가 outer mount 하나를 가진다.
2. outer factory가 inner factory를 선택하고 inner가 leaf를 선택하면 mount 순서는
   `[outer, inner]`다.
3. 선택하지 않은 형제 submodule의 mount는 active location에 들어가지 않는다.
4. route pattern/pathname 합성 결과는 기존 기대값과 동일하다.
5. wildcard fallback은 choice 목록에 포함되지 않는다.

파일 크기 규칙:

- `previewInspectorRouteLocation.test.ts`가 900줄을 넘으면 신규 테스트를
  `previewInspectorVariableRouteLocation.test.ts`로 분리한다.
- `previewInspectorRouteLocation.ts`가 850줄을 넘으면 mount chain의 중복 제거와 합성 함수를
  `previewInspectorRouteMount.ts`로 분리한다.

### 단계 5. VirtualPage content root와 정확히 일치하는 mount 선택

수정:

- `src/adapters/esbuild/inspector/previewInspectorAncestorTypes.ts`
- `src/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.ts`
- `test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts`

추가할 private 함수:

```ts
function selectPreviewInspectorRouteMountBasePath(
  routeLocation: PreviewInspectorPageCandidate['routeLocation'],
  contentRoot: PreviewInspectorPageCandidate['root'],
): string | undefined;
```

정확한 알고리즘:

1. `routeLocation`에 `routeMounts`가 없으면 `undefined`를 반환한다.
2. `contentRoot.sourcePath`와 mount `sourcePath`는 `path.normalize` 후 비교한다.
3. `contentRoot.exportName`과 mount `exportName`이 모두 같아야 한다.
4. 여러 개가 일치하면 chain에서 가장 안쪽, 즉 배열의 마지막 항목을 선택한다.
5. 일치한 `basePath`만 반환한다.
6. source 또는 export 중 하나라도 다르면 경로를 추측해서 선택하지 않는다.
7. `createBrowserCandidate`가 반환하는 후보에 결과가 있을 때만 다음 세 필드를 추가한다.
   - `routeMountBasePath`
   - 일치한 mount의 `routeSlotCount`
   - 일치한 mount의 `hasWildcardFallback`을 옮긴 `wildcardFallbackPresent`

필수 테스트:

- authored root와 content root가 같은 outer app이면 outer base를 선택한다.
- content root가 inner app이면 inner base를 선택한다.
- content root가 leaf page이면 필드를 생략한다.
- 파일은 같지만 export가 다르면 필드를 생략한다.
- route mount가 없는 Next 후보는 기존 객체와 동일하다.

### 단계 6. VirtualPage가 안전한 route 정적 계약을 보존

수정:

- `src/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource.ts`
- `test/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource.test.ts`

생성 runtime에 다음 helper를 추가한다.

```js
function __reactPreviewCopyVirtualPageRouteStatics(target, source) {
  for (const key of ['basePath', 'allPages', 'pageNames']) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        continue;
      }
      Object.defineProperty(target, key, descriptor);
    } catch {}
  }
}
```

`__reactPreviewComposeVirtualPage`에서 `ReactPreviewVirtualPage` 함수 선언 직후,
`displayName`과 `virtualPageRecipe`를 정의하기 전에 다음을 호출한다.

```js
__reactPreviewCopyVirtualPageRouteStatics(ReactPreviewVirtualPage, Content);
```

안전 규칙:

- allowlist는 정확히 `basePath`, `allPages`, `pageNames` 세 개다.
- getter를 읽거나 호출하지 않는다.
- prototype chain을 탐색하지 않는다.
- 속성 복사 실패는 해당 속성만 건너뛴다.

필수 테스트:

- `basePath` data descriptor가 wrapper에 복사된다.
- `allPages`, `pageNames` reference가 보존된다.
- getter descriptor는 getter를 실행하지 않고 복사하지 않는다.
- allowlist 밖의 임의 정적 속성은 복사하지 않는다.
- `displayName`과 `virtualPageRecipe`는 계속 존재한다.

### 단계 7. compiler mount fallback으로 Router 초기 경로 현지화

수정:

- `src/adapters/esbuild/inspector/previewInspectorRootPlugin.ts`
- `src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource.ts`
- `test/adapters/esbuild/inspector/previewInspectorRootPlugin.test.ts`
- `test/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource.test.ts`

작업:

1. root plugin의 browser candidate 직렬화에 값이 있을 때만
   `routeMountBasePath`, `routeSlotCount`, `wildcardFallbackPresent`를 추가한다.
2. browser runtime에 공용 validator를 만든다.

```js
function normalizePreviewInspectorRouteMountBasePath(value) {
  // 기존 readPreviewInspectorPageRootBasePath와 동일한 문자열 제한을 적용한다.
}
```

3. `readPreviewInspectorPageRootBasePath`는 descriptor를 안전하게 읽은 뒤 위 validator를
   호출한다.
4. `createPreviewInspectorCandidateInitialEntry`는 base path를 다음 우선순위로 정한다.
   - 원본/VirtualPage root의 own data property `basePath`
   - `candidate.routeMountBasePath`
   - 없음
5. `directTarget === true`일 때는 기존처럼 경로를 자르지 않는다.
6. pathname이 base와 정확히 같으면 `/`를 반환한다.
7. pathname이 `base + "/"`로 시작할 때만 prefix를 제거한다.
8. 단순 문자열 prefix만 같은 `/feature-x`는 `/feature`로 자르지 않는다.

필수 테스트:

1. wrapper가 `basePath`를 보존한 정상 경로.
2. runtime static이 없고 compiler `routeMountBasePath`만 있는 fallback 경로.
3. runtime static과 compiler 값이 다르면 runtime static을 우선한다.
4. compiler mount가 pathname의 segment prefix가 아니면 원래 pathname을 유지한다.
5. direct target은 원래 pathname을 유지한다.
6. 잘못된 값, getter, 512자를 넘는 값, query/hash 포함 값은 무시한다.

### 단계 8. 실제 factory 구조 회귀 통합 테스트

추가:

- `test/adapters/esbuild/inspector/previewInspectorVariableRouteFactoryRuntime.test.ts`

fixture는 임시 디렉터리에 다음 파일을 생성한다.

```text
src/
  app.tsx
  create-app-module.tsx
  pages.json
  pages/list-page.tsx
  pages/create-page.tsx
  management/management-app.tsx
  management/detail-page.tsx
  not-found.tsx
```

fixture 요구사항:

1. `create-app-module.tsx`는 두 번째 인자 page map을 `<Route>` 배열로 만들고 세 번째 인자
   submodule array를 `<Route>` 배열로 만든다.
2. wrapper callback에는 alias를 사용한다.

```tsx
({ pageRoutes: ownRoutes, subModuleRoutes: nestedRoutes }) => (
  <Layout>
    <Routes>
      {ownRoutes}
      {nestedRoutes}
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Layout>
);
```

3. 반환 component에는 `Object.assign`으로 `basePath`, `allPages`, `pageNames`를 단다.
4. 각 페이지는 고유 marker 문자열을 렌더링한다.
5. 선택하지 않은 형제 페이지는 고유 `SIBLING_MODULE_MARKER` 문자열을 module top level에
   가진다.

필수 테스트 case:

1. outer index 선택:
   - `LIST_PAGE_MARKER` 존재
   - `LAYOUT_MARKER` 존재
   - `NOT_FOUND_MARKER` 없음
2. outer create 선택:
   - `CREATE_PAGE_MARKER` 존재
   - `NOT_FOUND_MARKER` 없음
3. nested management detail 선택:
   - `MANAGEMENT_DETAIL_MARKER` 존재
   - outer와 inner layout marker 존재
   - `NOT_FOUND_MARKER` 없음
4. bundle output:
   - 선택하지 않은 `SIBLING_MODULE_MARKER` 없음
5. route 선택을 변경한 두 번째 build:
   - 선택 marker만 바뀜
   - route 후보 수는 동일

이 테스트는 실제 백엔드, Storybook, 외부 네트워크를 사용하지 않는다.

### 단계 9. 진단 로그 보강

수정:

- `src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource.ts`
- `test/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource.test.ts`

`page-context-selected`의 `detail`에 다음 bounded field를 추가한다.

```ts
routeBasePathSource: 'runtime-static' | 'compiler-evidence' | 'none';
routeMountBasePath: string | undefined;
routePathnameBeforeLocalization: string;
routeSlotCount: number;
wildcardFallbackPresent: boolean;
```

규칙:

- 대형 route 배열이나 전체 route catalog를 로그에 넣지 않는다.
- `routeSlotCount`와 `wildcardFallbackPresent`는 browser candidate에 별도 scalar metadata로
  직렬화한 경우에만 실제 값을 기록한다. 증거가 없으면 각각 `0`, `false`다.
- 기존 `requestedRouterPathname`은 현지화 후 값을 계속 기록한다.
- 로그만 보고 “전체 경로가 들어갔는지”, “어느 근거로 base를 잘랐는지”, “변수 Route 슬롯을
  발견했는지”를 판단할 수 있어야 한다.

## 7. 실패 시 명시적 동작

다음 경우에는 억지로 페이지를 렌더링하지 않는다.

- callback 매개변수가 computed binding이어서 local identifier를 증명할 수 없음
- route catalog에서 page 이름의 path를 찾지 못함
- selected content root와 route mount owner의 source/export가 일치하지 않음
- base path가 절대 경로가 아니거나 query/hash를 포함함
- 선택 경로가 wildcard밖에 없음

이 경우:

1. 기존 authored fallback 동작을 유지한다.
2. `page-context-selected` 로그에 `routeBasePathSource: "none"`을 기록한다.
3. wildcard를 실제 페이지인 것처럼 route selector에 추가하지 않는다.
4. 임의의 첫 페이지나 임의 URL을 생성하지 않는다.

## 8. 금지되는 우회 구현

- 제품 코드에 `pageRoutes`, `subModuleRoutes`, `FiStaApp`, `NotFoundStatus`를 탐지 문자열로
  하드코딩
- wildcard Route 삭제 또는 무조건 비활성화
- 모든 page-map component를 한 번에 import하거나 렌더링
- 팩토리 함수를 extension host에서 실행
- getter를 읽어서 app module metadata 수집
- route 선택마다 전체 repository 재탐색
- selected route가 아닌 모든 submodule을 번들 corridor에 포함
- 테스트 fixture에서만 동작하는 path 문자열 비교
- 1,000줄 제한을 넘긴 뒤 line checker 예외 추가

## 9. 최종 검증 순서

각 명령은 앞 명령이 성공한 뒤 실행한다.

```bash
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteFactory.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteLocation.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRouteBranchPlan.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorVirtualPagePlan.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorVirtualPageRuntimeSource.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorRootPlugin.test.ts
npm test -- --run test/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource.test.ts
npm test -- --run test/adapters/esbuild/inspector/previewInspectorVariableRouteFactoryRuntime.test.ts
npm run check:lines
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## 10. 수동 검증 절차

1. VS Code Extension Development Host를 연다.
2. `fi-sta-app.tsx`에서 Page Preview를 연다.
3. route selector에서 직접 페이지와 management submodule 페이지가 보이는지 확인한다.
4. 직접 페이지를 선택하고 레이아웃과 선택 페이지가 함께 보이는지 확인한다.
5. nested management 페이지를 선택하고 outer layout, inner layout, leaf가 함께 보이는지
   확인한다.
6. 어느 선택에서도 `NotFoundStatus`만 단독으로 보이지 않는지 확인한다.
7. 출력 로그의 다음 값을 저장한다.
   - `routeSlotCount`
   - `wildcardFallbackPresent`
   - `routeMountBasePath`
   - `routeBasePathSource`
   - `routePathnameBeforeLocalization`
   - `requestedRouterPathname`
8. route를 바꿨을 때 선택하지 않은 대형 sibling graph가 새로 번들링되지 않는지 준비 시간과
   output file 수를 확인한다.

## 11. 완료 보고 형식

구현자는 다음 형식으로만 결과를 요약한다.

```text
변경:
- Route 슬롯 수집:
- mount chain 보존:
- VirtualPage static 보존:
- Router 경로 현지화:

회귀 테스트:
- 직접 page route:
- nested submodule route:
- wildcard 억제:
- sibling bundle pruning:

검증:
- npm run check:
- 수동 FiSta 검증:

남은 제한:
- 정적으로 증명할 수 없는 computed route:
```
