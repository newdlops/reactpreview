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
- 실제 JSX 사용과 `React.lazy` 경로로 연결되는 page/layout/App 후보

lowercase 이름만 가진 named export는 React 컴포넌트로 자동 판별하지 않습니다. SolidJS와 Lit처럼 별도의
JSX compiler 또는 template runtime이 필요한 파일도 React 컴포넌트로 변환하지 않습니다.

## 모듈과 모노레포

- 일반 JS/TS import, package exports와 가장 가까운 tsconfig/jsconfig alias
- 모노레포의 hoisted dependency와 workspace sibling consumer
- symlink package의 실제 경로와 체크인된 source fallback
- literal dynamic import, re-export, local route/page map과 `React.lazy`
- Vite `import.meta.glob`/`import.meta.globEager`의 제한된 정적 패턴
- Webpack `require.context`의 제한된 상대 경로 패턴
- 정적 template 또는 문자열 결합으로 확인할 수 있는 dynamic `import()`/`require()`

실행 시점에만 결정되는 import 경로, workspace 밖 경로, alias/bare glob과 프로젝트 bundler plugin은 자동으로
실행하거나 추측하지 않습니다.

## 스타일과 자산

지원하는 스타일:

- 일반 CSS와 CSS Modules
- 가장 가까운 Dart Sass를 사용하는 `.scss`, `.sass`와 Sass Modules
- Tailwind CSS v2/v3의 안전한 기본 PostCSS 처리
- Tailwind CSS v4의 `@tailwindcss/postcss`
- styled-components v5/v6, `createGlobalStyle`, ThemeProvider와 StyleSheetManager
- 직접 도달한 theme import가 하나로 확인될 때의 실제 디자인 토큰

지원하는 자산:

- import된 이미지, SVG, 폰트, 오디오, 비디오와 PDF
- SVG URL, `{ ReactComponent }`, `?react`, `?raw`, `?url`
- 가장 가까운 package의 `public` 디렉터리를 기준으로 한 `/...` CSS asset
- 정적 `new URL(..., import.meta.url)` asset

프로젝트가 작성한 Tailwind/PostCSS config와 plugin, Less, 고급 SVGR 옵션은 실행하지 않습니다. JSX의
`<img src="/logo.png">`처럼 import 근거가 없는 root URL literal은 자동 asset으로 바꾸지 않습니다.

## React 런타임 경계

도달한 source에서 필요성이 확인되면 다음 preview-only 경계를 구성할 수 있습니다.

- React Router의 지역 MemoryRouter
- selector 사용 경로만 가진 읽기 전용 Redux store
- submit과 validation을 실행하지 않는 Formik boundary
- 네트워크 transport가 없는 Apollo Client
- TypeScript Context shape 또는 custom context hook 사용에서 확인된 중립 값
- styled-components ThemeProvider와 StyleSheetManager
- `.react-preview/setup.*` 또는 설정한 setup file
- setup이 없을 때 가까운 `.storybook/preview.*` decorator

실제 Provider가 이미 페이지에 있으면 중복 Router나 Provider를 만들지 않습니다. 자동값은 실제 hook 결과의
존재하는 field와 identity를 우선하고, 렌더링에 필요하다고 확인된 누락 path만 보완합니다.

## Backend와 데이터

Page Inspector는 외부 backend를 실행하지 않습니다. 도달한 요청은 가능한 경우 탭 내부 payload registry에서
종료합니다.

- Apollo operation의 selection, alias, fragment와 list 구조
- browser `fetch`
- 정확한 `axios` package import의 HTTP method
- Axios instance 같은 browser client가 사용하는 최종 XMLHttpRequest
- TypeScript response type과 필드명에서 만든 Auto/Lorem payload
- 요청별 성공, 빈 데이터, HTTP 오류와 지연 scenario
- 같은 REST resource에 대한 탭 내부 CRUD 상태

임의의 custom socket/client protocol, 실제 로그인과 업무 세션, backend side effect는 재현하지 않습니다.
업무 enum, 권한, route parameter와 객체 관계가 중요하면 JSON 또는 setup fixture를 사용하세요.

## 프레임워크 처리

### Next.js

manifest에 Next.js가 선언된 프로젝트에서는 `next/image`, `next/link`, `next/font/google`의 브라우저 시각
계약과 App Router의 page/layout/template 문맥을 제한적으로 처리합니다.

Next.js SSR, React Server Components, server-only module, loader/action과 framework config 실행은 지원하지
않습니다.

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
