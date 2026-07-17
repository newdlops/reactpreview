# 변경 기록

이 프로젝트는 사용자에게 영향을 주는 변경을 이 문서에 기록합니다.

## 0.1.1041 - 2026-07-17

- Page Inspector가 application의 모든 attribute/text mutation, scroll, resize와 1초 polling마다 React Fiber를
  재수집하던 경로를 제거하고 실제 child-list/React commit만 component tree invalidation으로 처리
- highlight는 animation frame의 저비용 DOM reconciliation으로 분리하고 Fiber snapshot은 cache한 뒤 최대
  초당 4회, browser idle 구간에서만 갱신해 `Code Helper (Renderer)` CPU 폭증과 GUI starvation을 방지
- Console/API·GraphQL request/condition/runtime fallback registry 갱신을 application-wide React store에서
  Inspector 전용 lane으로 분리하고, 패널을 접거나 webview가 숨겨지면 tree subscription과 timer를 중단
- burst commit 100회가 highlight frame 하나와 tree refresh 하나로 합쳐지는 scheduler 동작 및 attribute/text,
  scroll/resize polling 회귀 방지 테스트 추가

## 0.1.1040 - 2026-07-17

- 한 target을 호출하는 정적 render-chain 후보별로 importable ancestor를 독립 탐색하고, 실제 mount owner가
  다른 page context를 최대 6개까지 `pageCandidates`로 보존
- Page Inspector context 행에 `PAGE PATH` 선택기를 추가해 entry→page root→target 흐름을 비교하고, 선택한
  authored root의 children/sibling/component tree와 props/error boundary를 함께 재구성
- 후보 root를 dynamic import loader 뒤에 두어 선택하지 않은 page module의 browser 평가를 미루고, 선택 id를
  패널 webview state에 저장해 hot reload 뒤에도 같은 caller page를 유지
- 대안 탐색이 source inventory와 frontier별 JSX/owner 분석 cache를 공유하고 같은 mount chain은 중복 제거해
  여러 후보 지원이 저장소 재분석과 불필요한 UI 선택지를 늘리지 않도록 제한

## 0.1.1038 - 2026-07-17

- full ESM build가 2,048개를 넘는 lazy chunk를 만들면 실패시키는 대신 같은 graph를 자동으로 coalesced
  local artifact로 재빌드하는 adaptive output strategy 추가
- 일반 graph는 기존 file-level dynamic import splitting을 유지하고, oversized graph만 dynamic module의
  실행 시점 lazy initializer를 보존한 채 per-module 파일 분할을 비활성화해 수천 번의 게시·로드 I/O를 제거
- split output 개수를 포함한 warning diagnostic을 남기고 target/runtime별 결정을 compiler session에 bounded
  cache하여 같은 탭의 hot reload가 실패할 split build를 반복하지 않도록 개선
- TypeScript 정적 분석, reverse component 탐색, source transform과 esbuild orchestration을 전용 Node worker
  thread로 이동하고 탭 전체에서 compile을 하나씩 실행하며 queued cold fast pass를 full enrichment보다 우선
- Page Inspector도 cold direct graph를 먼저 게시하고 실제 page ancestor 문맥은 React commit 뒤 보강하도록 바꿔
  큰 프로젝트에서 editor를 막거나 빈 화면으로 full build를 기다리지 않도록 개선
- ancestor 탐색은 nearest package index를 먼저 사용하고 실제 sibling workspace 가능성이 있을 때만 workspace로
  확장해 단일-app 모노레포의 중복 전체 scan을 제거
- 깨진 자동 Storybook setup은 누락 후보/setup/config 증거가 바뀔 때까지 setup-free 결정을 재사용하고,
  oversized-output 및 ancestor advisory도 같은 compiler session에서 한 번만 기록
- bundle content/chunk digest를 worker에서 계산하고 `ArrayBuffer` ownership을 host로 transfer해 대형 결과의
  복사와 extension-host 동기 hashing을 제거
- `rtcc-public-upload-page.tsx` production probe에서 cold fast 1.56초, 최초 full 15.33초, 동일 full rebuild
  0.72초와 full output 54개를 확인하고 반복 Storybook warning 0건을 검증

## 0.1.1035 - 2026-07-17

- 초기 경량 프리뷰 기준의 고정 32 MiB output 제한을 모노레포 page graph에 맞는 기본 128 MiB로 상향
- resource-scoped `reactPreview.maxOutputSizeMiB` 설정을 추가해 프로젝트별 32–512 MiB 범위에서 조절하고,
  설정 변경 시 고정된 preview session이 같은 대상 파일을 자동 rebuild하도록 연결
- compiler API에서 잘못된 숫자가 들어와도 기본값 또는 512 MiB 절대 상한으로 정규화해 extension host의
  메모리·global storage 보호를 유지하고, 실패 메시지에 실제 출력 크기와 변경할 설정을 함께 표시

## 0.1.1033 - 2026-07-17

- Vite의 project-root 절대 `import.meta.glob('/src/...')` 패턴을 nearest package root 기준으로 해석하고,
  생성 import는 importer-relative specifier로 번들링하면서 앱이 읽는 object key는 원래 `/src/...`로 보존
- 모노레포 workspace 안의 sibling으로 빠지는 `..` 및 project root 밖을 가리키는 symlink를 거부하고,
  기존 상대 glob은 workspace 경계를 유지해 절대 패턴 지원이 filesystem 접근 범위를 넓히지 않도록 제한
- generated icon registry처럼 256개가 넘는 유한 Vite glob은 빌드 전체 1,024개 참조 한도까지 허용하되
  기존 16,384개 조회·2,048개 output·32 MiB 한도는 유지
- `rtcc-poc-page`의 Agent 문서 41개, generated icon 330개와 정확한 `ui-test-page.tsx`를 fast/full production
  compiler로 검증하고 full build 453 chunks, 4,280 dependencies, diagnostics 0건을 확인

## 0.1.1032 - 2026-07-17

- Page Inspector의 reached workspace source에서 render-critical project hook과 `use-query-params` 호출을
  정적으로 식별하고, 실제 non-nullish 결과는 그대로 보존하면서 Provider 예외·필수 nullish 결과만
  사용처/이름/작성된 default 기반의 preview-only 값으로 우회하는 render circuit breaker 추가
- Suspense thenable과 `Auto values`를 끈 상태의 예외는 원래대로 전달하고, 생성 tuple/object는 required
  property path·호출 leaf까지 frozen shape로 만들어 fallback 직후의 연쇄 `undefined` 오류를 감소
- Inspector에 `Fallbacks` 탭과 toolbar count를 추가해 hook, 원본 오류, source, 추론 근거와 실제 생성값을
  `GENERATED RENDER VALUE`로 표시하고 같은 내용을 fatal error가 아닌 Console warning으로 보존
- `rtcc-poc-page`의 `ListQueryRenderer`에서 `usePagination`, `useQueryParam`, `useQueryVar`, project `useQuery`를
  실제 54-chunk page build로 검증하고 syntax/runtime/compiler 회귀 테스트를 추가

## 0.1.1031 - 2026-07-17

- Page Inspector 오른쪽에 `Console` 탭을 추가해 `console.log/info/warn/error/debug`, React render/lifecycle
  boundary, 전역 runtime 및 unhandled promise 오류를 VS Code 개발자 도구 없이 확인하도록 구현
- `useQueryParams must be used within a QueryParamProvider` 같은 hook/provider 실패에 export, phase,
  React component stack과 JavaScript stack을 보존하고 실패 target의 inline placeholder 및 나머지 page는 유지
- 원래 browser console 호출은 그대로 전달하고 동일 연속 로그는 횟수로 병합하며, 탭별 최신 250건만 메모리에
  유지하고 level/text 필터·상세 stack 펼치기·Clear를 제공
- console capture registry와 UI를 독립 runtime source로 분리하고 getter를 실행하지 않는 bounded argument
  formatter, hot-reload-safe native console capture와 동작 테스트를 추가

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

- app entry를 실행하지 않고 ambient `typeof import()` 전역 선언과 import-backed
  `globalThis/window` 직접 할당을 정적으로 수집해 정확한 project wrapper export를 lexical inject로 연결
- runtime assignment > ambient declaration > 동일 이름 package 순서를 적용하고, 충돌·미해석·분석 한도
  초과에서는 의미가 다른 bare package로 내려가지 않는 fail-closed 전역 bridge planner 추가
- 강한 wrapper 근거가 없을 때 실제 target-rooted graph에서 자유 식별자로 증명되고 같은 이름의 설치
  package가 해석되는 경우에만 Router 요구와 합쳐 최대 한 번 adaptive rebuild하도록 확장
- esbuild scope injection으로 local/import/shadow/type/property/JSX intrinsic/`typeof` probe를 보존하고 ESM
  default·named·namespace와 CommonJS identity, 모노레포 hoist, dirty wrapper HMR dependency를 지원
- package source evidence와 선택된 declaration/wrapper metadata를 탭과 hot rebuild 사이에서 bounded하게
  공유하고 generated/public 역방향 인덱스를 제외해 실제 대형 프로젝트의 후속 rebuild 시간을 단축
- `name is not defined`를 `missing-runtime-global`로 분류하고 오류 보고서에 Globals bridge 상태를 추가

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
