# 프로젝트 프리뷰 환경 설정

React 컴포넌트가 Theme, Router, GraphQL, Redux 또는 브라우저 전역에 의존한다면 import graph만
번들링하는 것으로는 충분하지 않습니다. React File Preview는 앱 전체 엔트리나 개발 서버를 실행하는
대신, 프로젝트가 제공한 작은 setup 모듈을 대상 파일보다 먼저 실행합니다.

## 선택 순서

컴파일러는 다음 순서로 하나의 setup만 선택합니다.

1. 리소스 설정의 `reactPreview.setupFile`
2. 가장 가까운 `package.json` 아래 `.react-preview/setup.tsx`(이후 TS/JS 확장자 순서)
3. `reactPreview.useStorybookPreview`가 켜져 있을 때 `.storybook/preview.tsx`
4. setup 없음

Storybook `main`이나 Vite/Webpack 설정, addon manager와 서버는 실행하지 않습니다. 자동으로 선택한
Storybook preview 자체가 번들링되지 않으면 대상만 다시 빌드하고 Output Channel에 경고를 남깁니다.
이 경우 전용 setup을 추가하면 프로젝트의 현재 구조를 명확하게 표현할 수 있습니다.

## setup 계약

setup 모듈은 아래 named export를 필요한 만큼만 제공할 수 있습니다.

| export               | 실행 시점             | 역할                                                |
| -------------------- | --------------------- | --------------------------------------------------- |
| `initializePreview`  | 대상 모듈 import 전   | 전역 객체, 날짜/숫자 유틸리티와 mock service 초기화 |
| `PreviewProviders`   | React render 시       | Theme, Router, GraphQL, Redux 등의 Provider 조립    |
| `previewProps`       | 대상 element 생성 전  | 모든 대상에 전달할 정적 props 객체                  |
| `createPreviewProps` | 대상 element 생성 전  | 파일 이름에 따라 props를 만드는 동기/비동기 함수    |
| `apolloPreview`      | Apollo client 생성 시 | 자동 정적 응답을 조정하거나 `false`로 비활성화      |

`initializePreview`와 `createPreviewProps`에는 `{ documentName, setupKind }`가 전달됩니다.
`PreviewProviders`도 같은 값과 `children`을 받습니다. setup 파일과 도달 가능한 import는 일반 대상
의존성과 똑같이 번들링·감시되므로, 저장 전 편집 내용과 자동 갱신 규칙도 동일합니다.

setup 모듈의 정적 import는 JavaScript 규칙상 `initializePreview`보다 먼저 평가됩니다. 초기화할 전역을
import 시점에 읽는 앱 barrel이나 GraphQL 모듈은 setup에서 직접 import하지 말고, 부작용 없는 Provider와
theme leaf module만 사용하세요. 꼭 필요한 초기화 의존성은 `initializePreview` 안에서 동적으로 import할
수 있지만 실제 API client나 인증 bootstrap을 불러오지 말고 메모리 mock으로 대체해야 합니다.

## 일반 예시

다음 파일을 대상 package의 `.react-preview/setup.tsx`에 둡니다. import 경로와 mock 상태는 각
프로젝트의 실제 Provider 계약에 맞게 조정해야 합니다.

```tsx
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';

import { theme } from '../src/theme/theme';
import type { PropsWithChildren } from 'react';

export async function initializePreview() {
  const previewGlobal = globalThis as typeof globalThis & {
    APP_CONFIG?: Record<string, unknown>;
  };
  previewGlobal.APP_CONFIG ??= {};
}

export function PreviewProviders({ children }: PropsWithChildren) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

export function createPreviewProps({ documentName }: { documentName: string }) {
  return documentName.endsWith('/UserCard.tsx') ? { name: 'Preview user', role: 'Developer' } : {};
}
```

setup은 웹뷰 안에서 실행되며 extension host에서는 import되지 않습니다. 그래도 대상 코드와 동일한
신뢰 경계이므로 네트워크 client, 분석 SDK, 실제 인증값 대신 메모리 mock을 사용해야 합니다.

## Apollo 정적 프리뷰

대상 package에서 `@apollo/client`를 찾으면 확장은 그 프로젝트의 복사본으로 `ApolloProvider`를
자동 생성합니다. 내부 link는 `HttpLink`, URI, `fetch`를 만들거나 다음 link로 operation을 전달하지
않습니다. 쿼리의 alias, 중첩 selection과 fragment를 최대 깊이 20·필드 512개까지 따라가며 빈 문자열,
`"0"`, `0`, `false`, 빈 배열과 중첩 객체로 구성된 truthy data root를 즉시 반환합니다. 웹뷰 CSP의
`connect-src 'none'`도 그대로 유지됩니다.

화면 의미상 정확한 값이 필요하면 setup에서 operation별 메모리 결과를 반환합니다. plain object는
`data`로 감싸지고 `{ data, errors, extensions }` 형태도 그대로 사용할 수 있습니다.

```tsx
export const apolloPreview = {
  resolveOperation({ operationName }: { operationName: string }) {
    if (operationName === 'CurrentCompany') {
      return { company: { id: 'preview-company', name: 'Preview company' } };
    }
    return undefined; // 다른 operation은 자동 selection-shaped 결과를 사용합니다.
  },
};
```

`resolveOperation`에는 `operationName`, `variables`, `query`, `documentName`, `setupKind`가 전달됩니다.
함수는 여러 번 호출될 수 있으므로 외부 요청이나 지속되는 부작용 없이 결정적인 메모리 값만 반환해야
합니다. `initialState` 객체를 함께 지정하면 `InMemoryCache.restore()`의 초기값으로 사용됩니다.
프로젝트의 `PreviewProviders`가 자체 Apollo client를 제공한다면 그 Provider가 자동 outer Provider보다
가까워 정상적으로 우선합니다. 자동 계층이 필요 없으면 `export const apolloPreview = false`로 끕니다.

## 복잡한 페이지와 preview harness

이 확장은 특정 저장소 이름, Redux slice, route, theme token 또는 업무 상태를 내장하지 않습니다.
Apollo operation처럼 문서 자체에 응답 구조가 있는 경우에만 중립값을 자동 생성합니다. Redux selector의
상태 의미, URL parameter, 권한, locale, theme 함수와 필수 props는 같은 타입 이름이어도 프로젝트마다
다르므로 임의 Proxy나 빈 객체를 넣지 않습니다. 그런 값은 오류를 숨기면서 잘못된 화면 분기를 만들 수
있습니다.

앱 루트에 강하게 결합된 페이지는 작은 `*.preview.tsx` harness를 소스 옆이나 별도 preview 폴더에 두는
방법이 가장 명확합니다. harness는 실제 API client나 앱 bootstrap 대신 메모리 store, 정적 route,
프로젝트 theme와 의미 있는 props만 조립한 뒤 대상 컴포넌트를 default export합니다.

```tsx
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';

import { ComponentUnderPreview } from './component-under-preview';
import { previewStore } from '../preview/preview-store';
import { theme } from '../theme/theme';

export default function ComponentUnderPreviewHarness() {
  return (
    <Provider store={previewStore}>
      <MemoryRouter initialEntries={['/preview']}>
        <ThemeProvider theme={theme}>
          <ComponentUnderPreview title="Static preview" items={[]} />
        </ThemeProvider>
      </MemoryRouter>
    </Provider>
  );
}
```

여러 컴포넌트가 같은 root context를 공유하면 `.react-preview/setup.tsx`의 `PreviewProviders`로 올리고,
화면마다 달라지는 state·route·props는 harness가 소유하게 하세요. 플러그인은 두 방식 모두 일반 React
파일처럼 번들링하며 프로젝트 코드를 extension host에서 실행하지 않습니다.

## 전역 namespace 발견

setup import 전에 `public/index.html`, package `index.html`, `.storybook/main.*`의 최대 1MiB prefix를
문자열로만 읽습니다. `window.NAME = window.NAME || {}`와 같은 빈 객체 초기화에서 안전한 namespace
이름만 추출해 빈 객체를 만듭니다. 파일을 실행하거나 property 값, template placeholder, `.env`, API
키와 라이선스를 복사하지 않습니다. 실제 값이 필요하면 `initializePreview`에서 비밀이 아닌 mock을
명시하세요.

## named export 선택

대상에 runtime default export가 없으면 현재 편집기 AST를 사용해 다음 순서로 선택합니다.

1. 파일명을 PascalCase로 바꾼 이름과 정확히 같은 named export
2. 유일한 PascalCase named runtime export

type/interface/`declare`는 후보에서 제외됩니다. 여러 컴포넌트가 남으면 임의로 고르지 않고 후보를
포함한 진단을 표시합니다. 그 파일에 원하는 컴포넌트를 default로 다시 export하면 선택이
명확해집니다.
