# 호환성과 제한

이 문서는 React File Preview가 자동으로 처리하는 프로젝트 요소와 의도적으로 실행하지 않는 경계를
정리합니다. 프로젝트별 Provider와 명시적 프리뷰 값을 구성하는 방법은
[프로젝트 setup 가이드](project-setup.md)를 참고하세요.

## 기본 요구사항

- VS Code 1.100 이상
- React 16.8 이상과 호환되는 ReactDOM
- 로컬 파일 또는 VS Code Remote의 workspace extension host
- Workspace Trust가 허용된 워크스페이스
- runtime default export 또는 PascalCase named component export

프로젝트에 설치된 React와 ReactDOM을 가장 먼저 사용합니다. local 설치가 없을 때는 지원되는 lockfile로
증명된 관리 dependency 또는 프로젝트 manifest 범위와 호환되는 확장 내장 React 18/19 runtime을 사용할 수
있습니다.

VS Code for Web과 가상 워크스페이스는 지원하지 않습니다. Remote SSH, Dev Container와 Codespaces에서는
확장이 원격 호스트에 설치되므로 해당 운영체제와 CPU용 Marketplace 패키지가 필요합니다.

## 소스와 export

지원하는 파일 형식:

- `.tsx`, `.jsx`, `.ts`, `.js`
- `.mts`, `.cts`, `.mjs`, `.cjs`
- 직접 선택한 `.mdx`

다음 export를 프리뷰 대상으로 찾습니다.

- runtime default export
- 직접 선언한 PascalCase named export
- `export *`에서 발견되는 PascalCase runtime re-export
- 실제 JSX 사용과 `React.lazy`·`next/dynamic` 경로로 연결되는 page/layout/App 후보

lowercase 이름만 가진 named export는 React 컴포넌트로 자동 판별하지 않습니다. SolidJS와 Lit처럼 별도의
JSX compiler 또는 template runtime이 필요한 파일도 React 컴포넌트로 변환하지 않습니다.

## 모듈과 모노레포

- 일반 JS/TS import, package exports와 가장 가까운 tsconfig/jsconfig alias
- 모노레포의 hoisted dependency와 workspace sibling consumer
- symlink package의 실제 경로와 체크인된 source fallback
- literal dynamic import, re-export, local route/page map과 `React.lazy`·`next/dynamic(() => import(...))`
- Vite `import.meta.glob`/`import.meta.globEager`의 제한된 정적 패턴
- Webpack `require.context`의 제한된 상대 경로 패턴
- 정적 template 또는 문자열 결합으로 확인할 수 있는 dynamic `import()`/`require()`

실행 시점에만 결정되는 import 경로, workspace 밖 경로, alias/bare glob과 프로젝트 bundler plugin은 자동으로
실행하거나 추측하지 않습니다.

## 스타일과 자산

지원하는 스타일:

- 일반 CSS와 CSS Modules
- 가장 가까운 Dart Sass를 사용하는 `.scss`, `.sass`와 Sass Modules
- Tailwind CSS v2/v3의 PostCSS 처리. `tailwind.config.*`는 실행하지 않고 데이터로만 읽어 `theme`,
  `darkMode`, `prefix`, `important`, `separator`, `corePlugins`, `safelist`와 지역 데이터 preset을 반영
- Tailwind CSS v4의 `@tailwindcss/postcss`
- Vite/CRA 진입 파일(`index.html`의 module script 또는 `src/main.*`, `src/index.*`)이 page root를 직접
  import할 때 그 진입 파일의 side-effect CSS
- styled-components v5/v6, `createGlobalStyle`, ThemeProvider와 StyleSheetManager
- 직접 도달한 theme import가 하나로 확인될 때의 실제 디자인 토큰
- `index.html`의 HTTPS stylesheet link, 렌더 경로의 앱 셸 wrapper(예: react-helmet으로 폰트를 넣는
  ThemeProvider)에 정적으로 쓰인 HTTPS `<link rel="stylesheet">`, 실행 중 추가되는 HTTPS stylesheet와 CSS의
  `@import url(https://…)`로 불러오는 웹 폰트(`reactPreview.remoteStylesheets`로 끌 수 있음)

지원하는 자산:

- import된 이미지, SVG, 폰트, 오디오, 비디오와 PDF
- SVG URL, `{ ReactComponent }`, `?react`, `?raw`, `?url`
- 가장 가까운 package의 `public` 디렉터리를 기준으로 한 `/...` CSS asset
- 정적 `new URL(..., import.meta.url)` asset

프로젝트가 작성한 Tailwind/PostCSS config와 plugin, Less, 고급 SVGR 옵션은 실행하지 않습니다. Tailwind
config 안의 함수 값, package plugin/preset처럼 데이터가 아닌 값은 건너뛰고 build warning으로 알립니다.
그 결과 Tailwind가 만들 수 없는 `@apply` class는 해당 class만 제거하고 나머지 stylesheet를 compile하며
제거한 class를 warning으로 알립니다. Tailwind compile 전략(v4 PostCSS adapter, v2/v3 plugin의 `content`/`purge`)은
설치된 버전마다 작은 자가 시험으로 검증해 전역 저장소에 기억하고, 버전 규칙이 고른 전략이 실패하면 학습한 순서로
다른 전략을 씁니다. 이미 있는 전략 중에서만 고르며 새 방식을 만들지는 않습니다. 확장에는 Tailwind 1.9.6–4.3.3의
대표 릴리스 25개를 실제 파이프라인으로 미리 측정한 결과(`scripts/pretrain-tailwind-strategies.mjs`)가 들어 있어 이
버전들은 자가 시험 없이 바로 씁니다. Tailwind 4.0.x는 `@source inline`이 없어 파일 scan으로 compile하므로, 저장하지
않은 편집의 새 class는 저장 후에 반영됩니다. 프로젝트에 설치본이 없을 때는 lockfile 근거와 선언된 범위에 맞춰 v2/v3는
`tailwindcss`, v4는 선언된 `@tailwindcss/postcss`를 관리 저장소에 받습니다. `@tailwindcss/vite`만 선언한 v4
프로젝트는 아직 compiler를 받지 않아 Tailwind directive가 원본 CSS로 남습니다. JSX의
`<img src="/logo.png">`처럼 import 근거가 없는 root URL literal은 자동 asset으로 바꾸지 않습니다.

## React 런타임 경계

도달한 source에서 필요성이 확인되면 다음 preview-only 경계를 구성할 수 있습니다.

- React Router의 지역 MemoryRouter
- selector 사용 경로만 가진 읽기 전용 Redux store
- submit과 validation을 실행하지 않는 Formik boundary
- 네트워크 transport가 없는 Apollo Client
- 프로젝트 package의 `QueryClient`를 쓰는 TanStack/React Query(v3–v5) Provider
- TypeScript Context shape 또는 custom context hook 사용에서 확인된 중립 값
- hook이 throw하거나 강제로 연 조건 분기의 nullable 상태가 비어 있을 때 프로젝트에 선언된 TypeScript
  타입으로 만든 값([타입 기반 자동 복구](type-guided-recovery.md))
- styled-components ThemeProvider와 StyleSheetManager
- `.react-preview/setup.*` 또는 설정한 setup file
- setup이 없을 때 가까운 `.storybook/preview.*` decorator

실제 Provider가 이미 페이지에 있으면 중복 Router나 Provider를 만들지 않습니다. 자동값은 실제 hook 결과의
존재하는 field와 identity를 우선하고, 렌더링에 필요하다고 확인된 누락 path만 보완합니다.

## Backend와 데이터

Page Inspector는 외부 backend를 실행하지 않습니다. 도달한 요청은 가능한 경우 탭 내부 payload registry에서
종료합니다.

- Apollo operation의 selection, alias, fragment와 list 구조
- 페이지가 쓰는 `TypedDocumentNode`(codegen 등)의 선언 결과 타입에 따른 목록 여부·숫자·enum 값
- browser `fetch`
- 정확한 `axios` package import의 HTTP method
- Axios instance 같은 browser client가 사용하는 최종 XMLHttpRequest
- TypeScript response type과 필드명에서 만든 Auto/Lorem payload. 범용 fetch helper(`fetchJson<Settings>(…)`)와
  SWR(`useSWR<User>(…)`)의 선언 응답 타입도 endpoint 이름 추측보다 우선. 키가 선언되지 않은
  `Record<string, number>` 필드는 프로젝트가 그 필드에서 읽는 리터럴 키(`trend['w-1']`, 그 필드를 받은 함수의
  `['w-5', 'w-4'].map((k) => trend[k])`, `for…of` 상수 키 배열)로 채우고, 읽는 키가 없으면 빈 객체로 둠
- 페이지 대상을 찾는 동안 비워 두는 REST 목록은 대상이 렌더되고 진행 중인 탐색·neural 복원이 끝난 뒤 선언된 행
  타입으로 한 번 채우고, 오류가 나거나 페이지가 다시 안정됐을 때 대상 출력이 없거나 blocker가 늘었으면 되돌림(오류로
  되돌린 경로는 그 세션 동안 다시 채우지 않음). 유지된 뒤 새로 등록되는 요청(늦게 열리는 패널·탭·모달)은 리비전·
  대상 경로당 최대 3라운드까지 같은 검증으로 이어서 채움. 행을 채운 동안 처음 보는 행 컴포넌트의 조기 반환 가드는
  VirtualPage 부트스트랩으로 열지 않음
- 대상 도달 전 자동 탐색이 넣은 최소 한 행(자동 Smart)은 도달한 뒤 같은 검증으로 목록 샘플 수(기본 3행)까지 늘려
  제공(덮어쓰기는 그대로 두고 리비전마다 다시 검증). 첫 행은 탐색이 고른 값을 유지하고, 덧붙인 행의 일반 문자열
  값은 `name 2`처럼 순번을 붙여 구별. 사용자가 넣은 JSON·Smart 버튼·Lorem 값은 바꾸지 않음
- 훅 단계 GraphQL 값(Apollo `useQuery` 등의 응답이 아직 없거나 선택한 필드가 비어 있을 때 쓰는 selection
  모양의 값)의 한 행 목록도, 페이지가 그 목록을 직접 `map`하지 않고 자식 컴포넌트에 props로 넘겨 컴파일러 렌더
  근거가 없으면 같은 라운드에서 같은 검증으로 목록 샘플 수까지 늘려 제공. 그 훅의 최근 대체 기록이 페이지가 그
  목록을 훅 값에서 받았다고 보여 줄 때(목록이나 그 상위 값을 훅 값으로 채웠거나, 응답의 빈 목록에 훅 값의 행을
  통째로 채운 경우)만 늘리고, 응답이 행을 가진 목록은 그대로 둠. 캐시된 훅 값은 바꾸지 않고 옆에서 제공(neural
  지문·Fallbacks 창은 원래 한 행 값). 직접 `map`하는 목록은 기존처럼 렌더 근거 행 수 전략을 따르고, 사용자 값·
  Smart 값은 바꾸지 않음. 대상에 도달하지 못한 페이지(페이지 문맥 복구 중이거나 복구가 끝나지 않은 페이지)는
  REST와 마찬가지로 채우지 않음
- 목록이 대상 자신의 본문인 페이지: 대상이 이미 빈 상태를 출력하는 동안에는 대상 자신의 목록 비어 있음 가드
  (`orders.length === 0`)를 강제로 넘기지 않아 빈 목록으로 출력을 잃지 않게 하고, 선언된 REST 응답 타입은
  GraphQL selection처럼 대상 도달 전 최소 한 행의 근거로 사용
- 행 안에만 있는 대상: 같은 식을 쓰는 형제 조건(표 머리글 `hasTrend && <th>`)을 열어 봐도 대상이 나오지 않았다는
  이유만으로 페이지 옆 대체 표시로 넘기지 않음. 거절된 조건의 분기가 대상을 그린다고 증명된 경우에만 그렇게 하고,
  그 밖에는 목록 요청을 채우는 필요값 탐색을 이어 감
- 요청별 성공, 빈 데이터, HTTP 오류와 지연 scenario
- 같은 REST resource에 대한 탭 내부 CRUD 상태

임의의 custom socket/client protocol, 실제 로그인과 업무 세션, backend side effect는 재현하지 않습니다.
업무 enum, 권한, route parameter와 객체 관계가 중요하면 JSON 또는 setup fixture를 사용하세요.

## 프레임워크 처리

### Next.js

manifest에 Next.js가 선언된 프로젝트에서는 `next/image`, `next/link`, `next/font/google`의 브라우저 시각
계약과 App Router의 page/layout/template 문맥을 제한적으로 처리합니다.

Pages Router의 `next.config.*`에 리터럴 `i18n`(`defaultLocale`·`locales`)이 있으면 실행하지 않고 읽어
`useRouter()`의 `locale`·`defaultLocale`·`locales`로 제공합니다. 설치된 Next를 해석할 수 없으면
`next/navigation`·`next/link`·`next/dynamic`·`next/server`는 브라우저 facade를 쓰고, 서버 전용 API인
`next/headers`(빈 cookies·headers, `draftMode` 꺼짐)와 `next/cache`(revalidate 무시, `unstable_cache` 통과)는
항상 inert facade를 씁니다.

Next.js SSR, React Server Components, server-only module, loader/action과 framework config 실행은 지원하지
않습니다. `server-only` import나 `'use server'`가 있는 모듈이 `fs`·`child_process` 같은 host I/O 내장 모듈을
import하면 첫 빌드부터 render-only 실행 계약(export가 inert 값)으로 바꿔, 그 모듈이 쓰는 Node 전용 package를
브라우저에서 평가하지 않습니다.

### Storybook

정상적으로 번들링되는 `.storybook/preview.*`의 global decorator와 일부 Apollo parameter를 첫 화면 뒤
재사용할 수 있습니다. Storybook server, `main` 설정과 addon manager는 실행하지 않습니다.

### MDX

직접 선택한 MDX는 로컬 compiler fallback으로 렌더링할 수 있습니다. collection query는 frontmatter와 검색
metadata만 제한적으로 처리하며 프로젝트의 remark/rehype 설정은 실행하지 않습니다.

## Dependency 준비

프로젝트의 정상적인 local 또는 Yarn PnP resolution이 항상 우선합니다. local package가 없을 때 자동으로
준비할 수 있는 근거는 다음과 같습니다.

- npm `package-lock.json` v2/v3의 exact URL과 SHA-512 integrity
- Yarn v1 lock의 exact version, public registry URL과 SHA-512 integrity
- Yarn Berry lock의 exact `npm:` resolution과 public npm exact-version metadata

private/custom registry, git dependency, pnpm lock, `workspace:`, `file:`, `link:` package와 install script 또는
native build가 필요한 package는 자동 다운로드 대상이 아닙니다. 확장은 package manager나 lifecycle script를
실행하지 않으며 프로젝트 manifest, lockfile과 `node_modules`를 수정하지 않습니다.

## 의도적인 제한

React File Preview는 다음 항목을 자동 복제하지 않습니다.

- 전체 app entry와 인증 bootstrap 실행
- 프리뷰 문서 밖으로의 이동: 페이지의 `navigate(-1)`·`history.back()`은 같은 문서 안의 기록일 때만 이동하고,
  `location.assign()` 같은 다른 문서 이동은 경고와 함께 취소
- 실제 API transport, backend와 Web Worker
- Node filesystem, network 또는 native binding
- 프로젝트 Vite, Webpack, Babel, Next config와 build command
- 임의 React Fiber, hook 또는 local state slot 수정
- 여러 사용처 중 업무적으로 올바른 route와 scenario 추측
- 실제 Provider 내부 로직과 업무 데이터의 의미
- 함수, symbol과 순환 객체 props의 JSON 편집

이 경계가 필요한 화면은 self-contained preview harness를 만들고 setup에서 명시적으로 선택하는 편이 정확합니다.

## 크기와 탐색 한도

- inline asset은 파일당 5 MiB, 한 빌드 합계 20 MiB
- 기본 JS/CSS/encoded asset 출력 상한은 128 MiB
- `reactPreview.maxOutputSizeMiB`로 프로젝트별 32–512 MiB 조정 가능
- 큰 동적 graph는 제한된 로컬 chunk로 분리하며 파일 수가 너무 많으면 한 번 coalesced build로 전환
- glob, context와 source index는 workspace/package 경계 안에서 제한된 파일·조회 예산 사용

한도 오류가 발생하면 더 가까운 page 또는 상대 경로로 graph를 줄이거나 실제 애플리케이션에서 확인하세요.

## 관련 문서

- [상세 사용자 가이드](user-guide.md)
- [프로젝트 setup 가이드](project-setup.md)
- [지원 정책](../SUPPORT.md)
- [보안 정책](../SECURITY.md)
- [아키텍처](architecture.md)
