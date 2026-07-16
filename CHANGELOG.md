# 변경 기록

이 프로젝트는 사용자에게 영향을 주는 변경을 이 문서에 기록합니다.

## 0.1.1017 - 2026-07-16

- 에디터 우클릭과 명령 팔레트에 opt-in `Inspect Current React File in Page Context`를 추가하고,
  일반 component gallery와 같은 파일에서도 독립적으로 고정되는 Page Inspector 세션을 제공
- workspace 안의 실제 JSX 사용과 barrel/consumer tsconfig alias를 최대 8단계 역추적해 바깥쪽 importable owner export를
  마운트함으로써 작성된 부모·자식·형제 JSX, 조건부 UI, event handler와 도달한 CSS/import graph를
  실제 브라우저 React tree에서 실행; private owner·cycle·한도에서는 안전한 partial root에 정지
- 선택 target import만 facade로 계측하고 application DOM marker/layout wrapper 없이 read-only React host
  lookup과 격리된 Shadow DOM toolbar를 사용해 target highlight, DOM element picker와 정적 ancestry를 제공
- page/layout/App 후보 우선순위와 test/story 감점, route 배열·router 객체 root 거부, named/wildcard barrel,
  모노레포 sibling package와 alias-aware target facade resolution을 추가
- target 또는 실제 ancestor root의 직렬화 가능한 props를 JSON으로 적용·초기화하고 명시적으로 remount할
  수 있는 도구 추가; boolean prop 분기는 UI에서 바꿀 수 있지만 임의의 hook/local state slot은 수정하지 않음
- Inspector의 선택 export, highlight와 props override를 패널별 webview state에 보존하고, 선택된 ancestor
  dependency 변경 시 기존 서버 없는 ESM/CSS hot reload를 수행한 뒤 override를 다시 적용
- 실제 page owner graph를 실행하는 Inspector도 외부 연결 차단 CSP, Workspace Trust, package 경계와 bounded
  정적 탐색을 유지하며 전체 app entry, backend, 개발 서버나 프로젝트별 업무 상태를 자동 실행하지 않음

## 0.1.1016 - 2026-07-16

- 실제 JSX target 사용을 역추적해 sibling과 parent owner를 실행하지 않고 intrinsic/imported wrapper 한
  갈래만 export별 Virtual DOM recipe로 합성하는 pinpoint parent render slice 추가
- 같은 파일의 private `Body` 사용과 render-function children을 bounded하게 따라가고, dynamic prop·spread가
  필요한 imported Form/Provider에서는 검증된 inner partial path만 유지하는 fail-closed 경계 추가
- 선택된 wrapper와 target만 가상 ESM이 import하도록 분리해 wrapper의 styled-components/CSS/자식 graph는
  esbuild의 정방향 해석을 재사용하고 unrelated parent/sibling export는 tree-shake
- parent slice consumer를 dependency cache와 hot reload graph에 포함하고 runtime 오류에 wrapper 수와
  complete/partial 상태를 표시; 명시적 setup과 Storybook composition은 자동 slice보다 우선

## 0.1.1013 - 2026-07-16

- target-rooted graph에서 Formik consumer/provider 근거를 수집하고, 부모 `<Form>` 없이 직접 연 leaf
  컴포넌트에는 프로젝트가 설치한 동일 Formik 인스턴스로 backend 없는 정적 Provider를 자동 구성
- import된 `use*Context` 호출이 실제로 역참조하는 객체 container와 호출 메서드만 bounded하게 수집해,
  실제 Provider 값은 보존하면서 missing custom Context에 stable·deeply frozen fallback을 제공
- `Object.keys/values/entries`를 사용하는 같은 파일의 bounded helper까지 객체 요구를 전파하고 leaf 값,
  computed/optional/unsafe 경로와 프로젝트 업무 상태는 추측하지 않는 fail-closed 경계 유지
- 모노레포의 nested package에서 workspace root에 hoist된 package와 package-export `.mjs`/`.cjs` entry를
  기본 resolver로 해석하는 독립 회귀 테스트 추가

## 0.1.1012 - 2026-07-16

- 프리뷰 에디터 탭 제목을 긴 workspace 경로 대신 대상 파일명만 표시하도록 변경
- 첫 렌더 뒤에는 서버 없이 새 local ESM/CSS를 기존 웹뷰에 교체하고 전달 실패·timeout 시 전체 HTML로
  복구하는 hot-reload 경로 추가; React Fast Refresh state 보존은 의도적으로 제공하지 않음
- 일반 JS/TS import·package export·tsconfig alias·symlink를 esbuild 기본 resolver에 맡기고 source
  plugin은 dirty overlay와 bounded transform만 수행하도록 단순화해 대형 graph의 resolver 오버헤드 감소
- 가장 가까운 package 단위로 source/실제 JSX literal prop 근거를 초기 인덱싱하고 여러 탭에서 재사용하는
  bounded cache 추가; 모노레포 형제 경계 차단, dirty consumer 즉시 무효화와 짧은 negative TTL 적용
- 활성 export에서 도달 가능한 자식·손자 컴포넌트와 CSS/asset/library import graph를 esbuild 기준으로
  재귀 수집하고, 원래 dynamic import 경계를 local ESM chunk로 분리·게시해 실제 지연 로딩 추가
- 도달한 styled-components 소스의 named/default value 및 named type-only `theme` 근거를 수집하고,
  alias·상대 경로를 resolved file identity로 합쳐 유일한 실제 theme을 지연 적용하도록 확장
- 지원되는 React source editor의 우클릭 메뉴에서 새 `React Preview` 탭을 바로 여는 항목 추가
- target-rooted esbuild graph 전체에서 React Router consumer/provider 근거를 수집하고, 자식·손자에서만
  consumer가 발견되면 최대 한 번 adaptive rebuild해 프로젝트 소유 `MemoryRouter`를 연결하도록 확장
- custom/Storybook setup의 존재만으로 자동 Router를 끄지 않고 실제 provider 근거가 있을 때 nested
  Router를 방지하며, setup별 bounded location·명시적 비활성화 계약 유지
- workspace TypeScript의 명시적인 `createContext` missing default를 inline 구조뿐 아니라 같은 파일의
  non-generic·acyclic interface/type alias까지 제한적으로 보완하고, import/generic/recursive/extends/
  merged 선언은 변환하지 않는 fail-closed 경계 추가
- 명령을 실행할 때마다 대상 URI에 고정되는 독립 프리뷰 탭을 생성해 여러 파일을 동시에 비교 가능
- 프리뷰 포커스 변경이 활성 소스로 오인되어 재빌드·대상 변경을 일으키던 동작 제거
- 포커스된 프리뷰를 우선 갱신하고 기존 탭의 대상은 바꾸지 않는 명시적 refresh 동작 추가
- 패널별 revision·의존 그래프·debounce와 참조 횟수 기반 artifact lease 관리 추가
- TS/TSX AST 기반 `import.meta.glob`/`globEager`, `require.context`, 상대 template·연결식 dynamic
  import/require 발견 추가
- `.mjs/.cjs/.mts/.cts`와 도달한 dependency source에도 동일한 bounded resource 분석 적용
- `new URL(..., import.meta.url)`, package별 `public` asset·CSS import, 임의 로컬 파일의 `?url` 변환 추가
- 프로젝트 설정이나 `.env`를 실행하지 않는 안전한 기본 `import.meta.env` 값 추가
- 매크로별 패턴/파일/조회/깊이와 빌드 전체 참조·조회·watch directory 정적 리소스 한도 추가
- 활성 파일의 runtime default와 모든 PascalCase named export를 소스 순서대로 렌더링하는 갤러리,
  `export *` 확장, export별 오류 격리와 props override 추가
- 대상 import 전 global namespace와 `.react-preview/setup.*` initialize 실행, Provider와 props 계약 추가
- 정상 Storybook preview decorator/Apollo parameter 자동 재사용과 깨진 setup의 setup-free 재시도 추가
- Storybook setup graph 오류만 폴백하고 누락된 상대 import의 안전한 생성 디렉터리를 계속 감시
- 프로젝트 Apollo Client를 자동 감지해 backend 요청 없는 Provider와 bounded selection-shaped 정적
  응답을 제공하고 setup별 operation 결과·cache seed·비활성화 계약 추가
- 활성 styled-components 파일이 직접 import한 실제 theme을 자동 재사용하고 primitive/CSS array를
  보존하면서 누락 token·실패 helper만 보완하는 ThemeProvider 및 document style 복원 추가
- 프로젝트 React Redux를 자동 감지하고 target-reachable `useSelector` 계열 callback과 이후의 안전한
  property 접근에서 객체 container path만 수집해 deeply frozen inert state skeleton을 제공하도록 확장;
  leaf 값은 추측하지 않고 setup별 exact state·비활성화 계약과 reducer/bootstrap 비실행 경계를 유지
- runtime 오류의 direct headline, 실패 phase, target/export/setup/classification, React component stack,
  JavaScript stack, cause/AggregateError와 primitive own field를 함께 보존하는 bounded 상세 보고서 추가
- Apollo invariant URL payload의 version/code/args를 네트워크 없이 로컬 decode하고 Apollo·Redux·Router·
  Theme 자동 경계의 실제 적용 상태를 오류 보고서에 표시
- React 19 root error callback과 JSX development source metadata를 연결하고, 프로젝트 CSS와 충돌하지
  않도록 runtime 진단 패널의 스타일을 격리
- 특정 저장소 상태나 앱 의미를 내장하지 않고 backend·개발 서버·외부 오류 조회 없이 범용 preview
  harness/setup 복구 안내를 제공

## 0.1.0 - 2026-07-15

- 서버 없이 현재 React 파일을 번들링하는 VS Code 확장 초기 구조 추가
- 저장 전 문서 overlay, React 기본 내보내기 mount, CSS·기본 asset 처리 추가
- 도달 가능한 import graph만 유지하는 default-only target bridge 추가
- import된 `.js` JSX, 추가 이미지·폰트·미디어, `?raw`, SVG component import 지원
- 저장하지 않은 참조 컴포넌트 overlay와 dependency 편집 자동 갱신 추가
- 비표준 alias 구성을 위한 선택적 `reactPreview.tsconfig` 설정 추가
- compiler resolver note를 패널 진단에 보존
- 비정상·대용량 asset 사전 차단과 query/fragment 의존 경로 정규화 추가
- Workspace Trust, 제한된 local resource root, 네트워크 차단 CSP 적용
- debounce, stale revision 방지, 의존 파일 저장 시 갱신 추가
- 직렬 artifact queue, 안전한 revision 정리, 종료 시 비동기 캐시 삭제 추가
- symlink 문서 overlay와 CSS Modules local class 처리 추가
- 현재 호스트 target이 표시된 플랫폼별 VSIX 패키징 추가
- `newdlops` publisher 메타데이터, Marketplace 아이콘과 배포·지원 문서 추가
- strict TypeScript, ESLint 계층 규칙, Prettier, 1,000줄 검사 구성
- domain, application, 실제 esbuild, CSP/escape 테스트 추가
