# 변경 기록 보관

현재 `CHANGELOG.md`의 1,000줄 제한을 지키기 위해 오래된 변경 기록을 이 문서에 보관합니다.

## 0.1.1030 - 2026-07-17

- Inspector에 `Payloads` 탭을 추가해 관찰된 API/GraphQL 요청, source/type 근거와 실제 전달되는 JSON을 표시
- GraphQL selection·alias·fragment·list, REST TypeScript generic/interface/type alias와 필드명 의미를 합쳐
  backend 없는 결정적 Auto payload를 만들고 모든 생성값을 `GENERATED` provenance로 구분
- `Generate Lorem`, `Use Auto`, `Apply JSON`, `Reset override`를 추가하고 payload/Auto 설정을 탭별 저장하며,
  변경 시 page export를 remount해 Apollo/REST hook cache가 새 값을 다시 읽도록 구현
- global `fetch`, fetch 기반 HTTP(S)/`/api`/`/graphql` client와 정확한 `axios` import의 HTTP method를
  no-network Response/AxiosResponse로 종료하고 imported Axios instance의 XMLHttpRequest도 같은 registry에
  연결하되 상대 JSON/TXT/CSV fetch fixture와 임의 project method는 보존
- source instrumentation, data registry/generator와 Payload UI를 독립 모듈로 분리하고 request·shape
  depth/field/count, URL metadata와 prototype key를 bounded하게 처리

## 0.1.1029 - 2026-07-17

- Inspector toolbar에 `Main component` 버튼을 추가해 sibling, descendant 또는 조건 행을 살펴본 뒤에도 현재
  파일의 대표 default/첫 PascalCase export와 실제 mounted target으로 즉시 복귀하도록 구현
- reached TSX/JSX graph의 `condition && <Component />`와 JSX 삼항식을 구문으로 계측하고, 원래 truthiness를
  기본값으로 보존하면서 component tree에서 각 조건의 visible/hidden 또는 양쪽 branch를 직접 토글하도록 추가
- 조건 행을 JSX source가 같은 가장 가까운 React component 아래에 배치하고 source 근거가 부족하면 별도
  `Render conditions` 그룹에 유지하며, authored/forced 상태와 fallback branch 여부를 표시
- `Auto values` 토글로 타입·사용처에서 추론한 preview-only prop 값을 켜고 끌 수 있게 하고, 조건/자동값 선택을
  탭별 webview state에 저장해 hot reload 뒤에도 유지
- condition AST transform, condition registry/UI, Inspector persistence와 source replacement 적용을 각각 독립
  모듈로 분리해 모든 유지보수 파일의 1000줄 제한을 계속 준수

## 0.1.1028 - 2026-07-17

- 접힌 Inspector의 Shadow DOM portal host를 viewport 전체에 고정하고 pointer input을 shell로 한정하며, 접힌
  shell의 left/width를 숫자로 다시 계산해 이전 drawer/floating 좌표가 우측 화면 밖으로 밀어내지 못하게 수정
- Page Inspector 첫 화면에서 독립 export fast pass를 제거하고 처음부터 실제 ancestor page root, sibling,
  styles와 application render-chain을 포함한 full context만 커밋
- Inspector 상단에 `PAGE COMPONENT`/`PAGE ROOT`/`STANDALONE` 상태와 `App › Page › Target` 경로를 표시해
  선택 파일이 현재 작성된 page 안에서 어떤 의미를 갖는지 명시
- 기본 React Preview 명령과 새 패널이 필요한 Refresh를 Page Inspector로 전환하고, 기존 독립 export 렌더링은
  `Open Current File Export Gallery` 보조 명령으로 유지

## 0.1.1027 - 2026-07-17

- React Page Inspector를 크기 조절식 하단·좌측·우측 drawer와 이동/크기 조절 가능한 floating 패널로 확장
- pointer drag와 키보드 방향키를 모두 지원하고, 복원된 크기·좌표를 현재 webview viewport 안으로 제한
- Inspector 배치·크기·위치·접힘 상태를 탭별 hot session과 VS Code webview state에 저장해 hot reload 및
  전체 webview 복원 뒤에도 유지
- layout/CSS 책임을 별도 runtime source로 분리해 Inspector component tree 및 host navigation 경계와 격리

## 0.1.1026 - 2026-07-17

- cold fast pass에서 자동 Storybook setup과 convention watcher 수집을 실제 mount 뒤로 미루고 dynamic import를
  단일 entry로 합쳐 최초 artifact publication의 수백 개 파일 쓰기와 깨진 선택적 setup 영향을 제거
- route가 많은 full graph의 in-memory output/chunk 제한을 2,048개로 높이고 artifact filesystem worker를
  16개로 확장하되 기존 32 MiB 총출력 한도와 content-addressed 경로 검증은 유지
- 브라우저 graph가 선택적으로 노출한 `fs` 등 Node built-in을 host capability 없는 neutral CommonJS shim으로
  바꿔 실제 Node API를 쓰지 않는 component가 module resolution 단계에서 실패하지 않도록 처리
- 가장 가까운 monorepo package에서 `sass`를 찾아 SCSS/Sass와 CSS Modules를 컴파일하고 transitive partial을
  hot-reload dependency로 추적하며, compiler 부재·style 오류는 component build를 막지 않는 warning으로 전환
- 자동 Storybook graph와 target graph가 동시에 실패해도 setup-free retry를 허용해 stale preview import를
  격리하고, target 자체 오류가 남으면 두 번째 build의 정확한 target diagnostic을 표시

## 0.1.1025 - 2026-07-17

- 기존 우측 floating toolbar를 Chrome DevTools Elements와 유사한 하단 dock으로 교체하고, 실제 page는
  그대로 유지한 채 왼쪽 React component tree와 오른쪽 props/state/source 상세를 분리해 표시
- 선택 target boundary에서 React 16-19 Fiber를 root까지 읽기 전용으로 추적해 부모·형제·자식 component를
  수집하고 DOM host tag는 기본 tree에서 제외하며, Fiber가 없으면 정적 entry-to-target 경로를 fallback으로 표시
- element picker가 고른 host DOM을 가장 가까운 React component로 역매핑하고 tree 선택 component의 실제
  top-level host node를 강조하며, traversal·snapshot depth·key 수를 제한해 대형 page에서도 bounded하게 동작
- 함수 hook/class state와 runtime props는 getter나 update queue를 실행하지 않는 read-only snapshot으로 보여주고,
  계측된 target/root의 직렬화 가능한 props override와 remount만 기존 안전 계약으로 편집
- JSX development source 또는 정적 render/ancestor graph가 증명한 source를 Inspector에서 열 수 있게 하고,
  실제 source-button 클릭을 target별 HMAC과 일회성 nonce로 인증한 뒤 extension host가 현재 panel의
  committed dependency allowlist 안 파일만 검증해 editor 위치로 이동

## 0.1.1024 - 2026-07-17

- 번들러가 이미 Go 네이티브 esbuild임을 유지하고, 동일한 target/runtime plan은 최대 12개의
  `context.rebuild()` 캐시에서 parsed dependency graph를 재사용하도록 변경
- cold preview는 도달 가능한 target graph를 먼저 게시하고 browser mount 확인 뒤 전체 entry/parent/props
  문맥을 백그라운드에서 보강하며, 보강 실패 시 빠른 프리뷰를 유지하고 warm rebuild는 full context 한 번만 실행
- 새 revision과 dispose가 이전 target resolution·analysis·native build를 `AbortSignal`/`context.cancel()`로
  중단하고 debounce는 최신 요청만 남기며, publish 중 취소된 artifact lease도 즉시 반환
- source text·module/entry/import fact를 disk mtime/size 또는 dirty snapshot SHA-256 단위로 캐시하고,
  inventory TTL 뒤에도 파일 경로 fingerprint가 같으면 positive render/usage graph를 재사용
- 직전 reached graph의 Router와 lexical global 계획을 기억해 정상 hot rebuild를 한 번의 native pass로 줄이고,
  plugin별 compilation-local asset budget은 매 rebuild마다 초기화
- entry/CSS와 `chunks/[hash].js`를 session-level content-addressed 파일로 공유하고 bundle/파일 reference count,
  portable path+digest 충돌 검증, zero-reference URL tombstone, 최대 8개 병렬 write/delete와 partial rollback을 추가
- setup 뒤 runtime bridge·props·target graph를 병렬 준비하고, hot reload는 새 ESM·CSS와 provider element가 모두
  준비된 뒤에만 root를 교체해 빈 화면 구간을 줄이며 preload/빌드 실패 시 마지막 정상 프리뷰를 그대로 유지
- CSS만 바뀐 revision도 entry query로 ESM cache를 무효화하고, same-session content-addressed URI와
  revision/applied/retained ACK를 양쪽에서 검증해 stale 교체와 artifact lease 오판을 차단
- export별 Suspense와 local 오류 placeholder를 복원해 한 lazy/실패 component가 나머지 gallery나 commit 확인을
  막지 않으며, 병렬 target 평가 오류도 원래 runtime phase를 보존
- 준비 단계별 소요 시간과 completed/failed/cancelled 결과를 구조화된 debug log로 남겨 실제 병목을 측정 가능하게 함

## 0.1.1023 - 2026-07-17

- 프리뷰 준비 과정을 대상 확인, 프로젝트 분석, 컴포넌트 문맥 탐색, 정적 runtime 준비, 모듈 번들링,
  local artifact 게시, React 로딩의 7개 실제 단계로 표시하고 가짜 시간 기반 퍼센트는 사용하지 않음
- 최초 빌드는 접근 가능한 전체 loading 문서로 단계를 갱신하고, hot reload는 기존 화면을 보존한 채
  project CSS와 분리된 declarative Shadow DOM 상태 패널에서 진행상황과 browser bootstrap phase를 표시
- compiler/application/presentation 경계에 optional progress observer를 추가하고 session revision을
  extension-to-webview 메시지에서도 검증해 stale build나 이전 hot import가 최신 진행상황을 지우지 않게 함
- `role=status`, `aria-live`, `aria-busy`, indeterminate progressbar와 reduced-motion 처리를 추가하고,
  progress message를 bounded 구조로 검증해 DOM text만 갱신하는 no-server/CSP 정책을 유지
- React 실제 commit 전에는 완료 표시를 숨기지 않고 completed revision을 terminal로 고정하며, 초기 ESM
  entry가 실행 전에 실패해도 token/revision handshake와 30초 watchdog으로 영구 loading을 방지

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
