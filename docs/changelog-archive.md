# 변경 기록 보관

현재 `CHANGELOG.md`의 1,000줄 제한을 지키기 위해 오래된 변경 기록을 이 문서에 보관합니다.

## 0.1.1022 - 2026-07-16

- 현재 파일의 모든 direct component export를 한 번의 module index로 분석하고 실제 application EntryPoint까지
  export별 정적 render graph를 만들어, import identity가 증명된 `createRoot`/`hydrateRoot`/legacy ReactDOM
  mount를 일반 미사용 export와 구분
- named/wildcard re-export, literal `React.lazy`와 named `.then` adapter, JSX/createElement owner뿐 아니라
  route 배열·router 객체·page/app map의 top-level value flow를 통과하고 최대 8개 후보 경로를 보존
- route `element`의 layout·guard와 entry wrapper를 경로에 포함하고 실제 entry 도달 후보를 story/test의
  끊긴 usage보다 우선하며, 복수 entry·orphan export·bounded graph를 Inspector toolbar에 명시
- 발견한 entry는 실행하지 않고 기존 importable ancestor mount와 분리해 bootstrap/API side effect를
  차단하며, target/ancestor/lazy/route/entry/wrapper source를 HMR dependency로 연결
- filename은 후보 선택에만 쓰고 ReactDOM import/call identity로 증명한 entry에서 target까지 literal import
  경로를 먼저 좁혀 분석하며, 실제 render 경로가 아니면 선형 reverse import index로 자동 fallback
- fallback의 반복 workspace scan을 relative dependency 역색인과 exact alias resolver memo로 교체하고,
  필요할 때만 bounded workspace로 넓혀 모노레포 sibling app을 지원하며 unsaved target fingerprint로 무효화
- EntryPoint 분석을 props/ancestor 탐색보다 먼저 수행하고 소스 캐시를 공유하며, 읽기·graph·path 한도는
  `graph-limit`으로 표시하고 non-selected export 경로까지 HMR/cache dependency로 추적
- 실제 10,693개 source의 `zuzu` 모노레포에서 812개 source read와 약 2.1초로
  `rtcc-public-upload-page → lazy export → publicRoutes → router → AppRouter → BUILD_TARGETS → src/index.tsx`
  경로와 `RightToConsentOrConsultLayout`, `TwoFactorRedirectChecker`, `RootLayout` wrapper를 확인하고,
  fallback reverse closure도 동일 fixture에서 141초에서 9.3초로 단축

## 0.1.1021 - 2026-07-16

- Browserify 전제의 브라우저 package가 자유 `process`를 읽어도 target graph 평가 전에 기존 값을 보존하거나
  `platform`, `env`, `cwd`, `nextTick`만 가진 bounded browser compatibility object를 설치하도록 보강
- Node filesystem·network·native binding은 제공하지 않고 hot entry 사이에서 같은 fallback을 재사용하며,
  실제 선택 상태를 Globals runtime boundary에 표시
- `window.name = window.name || importedBinding` 및 `??` 형태의 app bootstrap을 실행 없이 증명해
  `process/browser`, `Buffer` 같은 정확한 project import를 기존 lexical bridge로 재사용
- `process is not defined`를 일반 package 설치 문제가 아닌 browser process boundary 오류로 별도 설명하고,
  실제 `rtcc-public-upload-page.tsx`의 2,296개 의존 graph와 53개 chunk가 경고 없이 번들되는 것을 검증

## 0.1.1020 - 2026-07-16

- 직접 export component의 필수 prop 타입과 비옵셔널 receiver 사용 경로를 bounded하게 분석해 string,
  number, boolean, array, object container와 no-op function의 가장 낮은 우선순위 정적 shape를 생성
- 실제 JSX 사용, 공통/setup/export별 props와 Inspector override를 자동 shape 위에 깊이별로 병합하고,
  optional chain은 없는 상태를 유지하며 prototype-sensitive key·깊이·node 수를 제한
- Page Inspector toolbar와 일반 gallery label에 자동 생성값의 path/kind를 표시해 사용자가 임의 정적값을
  확인·수정할 수 있도록 하고, 선택 target 오류는 부모·외부 sibling을 유지하는 inline placeholder로 격리
- export 오류의 전체 보고서는 console warning으로 보존하면서 preview surface에는 작은 local placeholder만
  표시하고, 구체적인 nullish property read를 backend 전용 문제가 아닌 missing static value로 분류
- `styled((props) => <Target />)\`...\`` owner를 styled-components import identity로 증명해 실제 부모
  ancestry로 승격하되 임의 tagged template은 계속 fail closed하는 Page Inspector 탐색 보강

## 0.1.1019 - 2026-07-16

- 필수 Context 구조분해와 optional descendant가 함께 있을 때 optional receiver를 없는 값으로 유지하면서
  이미 증명된 object container fallback을 폐기하지 않도록 `use*Context` 분석을 보강
- React import identity로 같은 module의 `use*Context → useContext(LocalContext)` 관계를 bounded하게
  증명하고, 도달한 consumer shape를 정확한 raw Context Provider에 연결하는 범용 Context bridge 추가
- 여러 hook이 같은 Context를 읽으면 구조 fallback을 병합하고 object/callable 충돌은 해당 Context만
  제외하며, lazy chunk의 늦은 등록은 project React의 `useSyncExternalStore` 경계로 다시 합성
- 작성된 application Provider·bootstrap·backend는 실행하지 않고 실제 내부/setup Provider를 우선하며,
  nullish custom Context 구조분해 오류를 별도 분류하고 Context bridge 상태를 runtime 보고서에 표시
- HOC 안의 null-default Context, nested destructuring, optional map과 `new Set` 조합을 Page Inspector 전체
  compiler 경로에서 검증하는 회귀 테스트 추가

## 0.1.1018 - 2026-07-16

- app entry를 실행하지 않고 ambient `typeof import()` 전역 선언과 import-backed `globalThis/window` 직접 할당을 정적으로 수집해 정확한 project wrapper export를 lexical inject로 연결
- runtime assignment > ambient declaration > 동일 이름 package 순서를 적용하고, 충돌·미해석·분석 한도 초과에서는 의미가 다른 bare package로 내려가지 않는 fail-closed 전역 bridge planner 추가
- 강한 wrapper 근거가 없을 때 실제 target-rooted graph에서 자유 식별자로 증명되고 같은 이름의 설치 package가 해석되는 경우에만 Router 요구와 합쳐 최대 한 번 adaptive rebuild하도록 확장
- esbuild scope injection으로 local/import/shadow/type/property/JSX intrinsic/`typeof` probe를 보존하고 ESM default·named·namespace와 CommonJS identity, 모노레포 hoist, dirty wrapper HMR dependency를 지원
- package source evidence와 선택된 declaration/wrapper metadata를 탭과 hot rebuild 사이에서 bounded하게 공유하고 generated/public 역방향 인덱스를 제외해 실제 대형 프로젝트의 후속 rebuild 시간을 단축
- `name is not defined`를 `missing-runtime-global`로 분류하고 오류 보고서에 Globals bridge 상태를 추가

## 0.1.1017 - 2026-07-16

- 에디터 우클릭과 명령 팔레트에 opt-in `Inspect Current React File in Page Context`를 추가하고, 일반 component gallery와 같은 파일에서도 독립적으로 고정되는 Page Inspector 세션을 제공
- workspace 안의 실제 JSX 사용과 barrel/consumer tsconfig alias를 최대 8단계 역추적해 바깥쪽 importable owner export를 마운트함으로써 작성된 부모·자식·형제 JSX, 조건부 UI, event handler와 도달한 CSS/import graph를 실제 브라우저 React tree에서 실행; private owner·cycle·한도에서는 안전한 partial root에 정지
- 선택 target import만 facade로 계측하고 application DOM marker/layout wrapper 없이 read-only React host lookup과 격리된 Shadow DOM toolbar를 사용해 target highlight, DOM element picker와 정적 ancestry를 제공
- page/layout/App 후보 우선순위와 test/story 감점, route 배열·router 객체 root 거부, named/wildcard barrel, 모노레포 sibling package와 alias-aware target facade resolution을 추가
- target 또는 실제 ancestor root의 직렬화 가능한 props를 JSON으로 적용·초기화하고 명시적으로 remount할 수 있는 도구 추가; boolean prop 분기는 UI에서 바꿀 수 있지만 임의의 hook/local state slot은 수정하지 않음
- Inspector의 선택 export, highlight와 props override를 패널별 webview state에 보존하고, 선택된 ancestor dependency 변경 시 기존 서버 없는 ESM/CSS hot reload를 수행한 뒤 override를 다시 적용
- 실제 page owner graph를 실행하는 Inspector도 외부 연결 차단 CSP, Workspace Trust, package 경계와 bounded 정적 탐색을 유지하며 전체 app entry, backend, 개발 서버나 프로젝트별 업무 상태를 자동 실행하지 않음

## 0.1.1016 - 2026-07-16

- 실제 JSX target 사용을 역추적해 sibling과 parent owner를 실행하지 않고 intrinsic/imported wrapper 한 갈래만 export별 Virtual DOM recipe로 합성하는 pinpoint parent render slice 추가
- 같은 파일의 private `Body` 사용과 render-function children을 bounded하게 따라가고, dynamic prop·spread가 필요한 imported Form/Provider에서는 검증된 inner partial path만 유지하는 fail-closed 경계 추가
- 선택된 wrapper와 target만 가상 ESM이 import하도록 분리해 wrapper의 styled-components/CSS/자식 graph는 esbuild의 정방향 해석을 재사용하고 unrelated parent/sibling export는 tree-shake
- parent slice consumer를 dependency cache와 hot reload graph에 포함하고 runtime 오류에 wrapper 수와 complete/partial 상태를 표시; 명시적 setup과 Storybook composition은 자동 slice보다 우선

## 0.1.1013 - 2026-07-16

- target-rooted graph에서 Formik consumer/provider 근거를 수집하고, 부모 `<Form>` 없이 직접 연 leaf 컴포넌트에는 프로젝트가 설치한 동일 Formik 인스턴스로 backend 없는 정적 Provider를 자동 구성
- import된 `use*Context` 호출이 실제로 역참조하는 객체 container와 호출 메서드만 bounded하게 수집해, 실제 Provider 값은 보존하면서 missing custom Context에 stable·deeply frozen fallback을 제공
- `Object.keys/values/entries`를 사용하는 같은 파일의 bounded helper까지 객체 요구를 전파하고 leaf 값, computed/optional/unsafe 경로와 프로젝트 업무 상태는 추측하지 않는 fail-closed 경계 유지
- 모노레포의 nested package에서 workspace root에 hoist된 package와 package-export `.mjs`/`.cjs` entry를 기본 resolver로 해석하는 독립 회귀 테스트 추가

## 0.1.1012 - 2026-07-16

- 파일 고정 다중 탭, 명시적 refresh와 서버 없는 ESM/CSS hot reload, revision·artifact lease를 추가
- esbuild 기본 resolver와 package별 source cache, dynamic import·glob·require context·public asset을 포함하는 bounded graph 분석을 도입
- export gallery, setup/Storybook fallback과 Apollo·Redux·Router·Theme·Context의 네트워크 없는 정적 runtime 경계를 추가
- React component/JS stack과 자동 runtime 경계 상태를 보존하는 bounded 오류 보고서 및 격리된 진단 UI를 추가
- 프로젝트 업무 의미를 내장하지 않는 범용 setup/harness 복구 원칙과 정적 리소스 안전 한도를 확립

## 0.1.0 - 2026-07-15

- 서버 없이 현재 React 파일과 도달 가능한 import graph를 번들링하는 VS Code 확장 초기 구조 추가
- 저장 전 문서/dependency overlay, JSX/CSS Modules/asset/SVG/query import와 alias 처리 추가
- Workspace Trust, 제한된 local resource root, 네트워크 차단 CSP와 대용량 asset 사전 차단 적용
- stale revision 방지, dependency hot rebuild, artifact queue/lease/cleanup 및 플랫폼별 VSIX 추가
- `newdlops` 배포 메타데이터와 strict TypeScript, 계층 lint, formatter, 1,000줄 및 통합 테스트 구성
