# 변경 기록

이 프로젝트는 사용자에게 영향을 주는 변경을 이 문서에 기록합니다.

## 0.1.1108 - 2026-07-21

- Smart fill이 최상위 `data` 경로만 관찰해도 GraphQL selection으로 생성한 `data/payload/response/result`의 비어 있지 않은 구조를 bounded copy로 보존
- 이미 처리한 Smart 값은 반복 적용하지 않되 required path signature가 확장된 값만 한 번 다시 탐색해 자동 해결 루프와 신규 경로 누락을 함께 방지
- 변경할 새 요구사항이 없으면 `settled`로 표시하고 현재 corridor에서 발견된 실제 payload 경로 수를 pass 0부터 정확히 보고

## 0.1.1107 - 2026-07-21

- `{ loading, data, ...result }` 객체 rest가 있는 hook 결과도 하나의 응답 계약으로 추론해 `QueryRenderer`가 값 누락으로 현재 파일의 JSX를 건너뛰지 않도록 수정
- 동일한 payload frontier는 전체 탐색 종료가 아닌 정착 상태로 처리하고, 현재 파일의 확정 Boolean gate 및 새로 발견된 최소 데이터 탐색을 계속 진행
- 로더·500 fallback 같은 래퍼 DOM과 authored JSX 출력을 분리하고 실제 출력이 없으면 현재 export 아래 `Expected JSX` 트리와 제한된 payload 요약을 표시

## 0.1.1106 - 2026-07-21

- 사용성이 낮은 Blocker/Render flow graph와 camera·Preview setup 탭을 제거하고 모든 렌더 조작을 하나의 Components tree와 선택 행 상세 화면으로 통합
- 정적 outcome과 runtime condition을 합쳐 단락 평가 뒤의 `Not reached yet` guard까지 소유 component 아래에 인라인 Boolean switch로 표시
- 별도 Inspector snapshot 교체와 모든 버튼·토글·선택 뒤 tree/detail/console/document의 가로·세로 스크롤을 안정 좌표로 복원

## 0.1.1105 - 2026-07-21

- 좌·우 결합된 JSX `&&` 체인을 평가 순서대로 펼쳐 미도달 guard까지 독립 Boolean 스위치로 제공하고 별칭·배열·삼항식·`React.createElement`·map callback의 render terminal까지 보수적으로 추적
- visible/hidden 조합은 하나의 결과로 접고 authored identity와 단락 평가를 보존하며, 강제로 연 뒤의 property guard 예외는 Off switch와 Console warning으로 격리해 다음 값 보정으로 계속 진행

## 0.1.1104 - 2026-07-21

- modal의 선택된 JSX 반환 결과와 자동 visibility DFS가 충돌하지 않게 source identity를 연결하고, 같은 overlay reveal은 page corridor별 한 번만 수행하며 target 내부 오류에서는 추가 gate 탐색과 rollback을 중단
- 자동 `open/show` prop을 사용자 JSON과 분리된 revision-local layer에 고정하고, 자동 보정 시 건강한 page, Router, Provider, portal과 modal state를 remount하지 않도록 stable key와 error reset signal을 분리
- cold/direct 및 Storybook decorator component identity를 안정화하고, 사용자 `Remount`만 target child instance를 교체하도록 구분해 모달이 생성·해제를 반복하는 루프를 차단

## 0.1.1103 - 2026-07-21

- 기본 `Preview setup`을 backend/hook/props의 최소값을 준비하는 `Preview data`와 현재 파일의 정적 JSX 반환 후보만 고르는 `Rendered component` 두 항목으로 단순화하고, 자동 데이터 준비를 항목 수와 무관한 한 번의 persistence/render transaction으로 병합
- 반환 후보가 없거나 하나뿐이면 사용자 선택 없이 authored/fixed 상태로 유지하고, 후보 선택 시 같은 source condition/choice에 남은 수동 override만 정리해 선택 결과가 즉시 적용되도록 개선
- Router/Provider/Theme, target reachability와 내부 condition 수렴은 읽기 전용 자동 상태로 이동하고, 코드 오류는 Console, 수동 값 편집과 전체 blocker DAG는 접힌 `Advanced diagnostics`에서만 확인하도록 정리

## 0.1.1102 - 2026-07-21

- 현재 파일 export의 `if/else`, 삼항식, `&&`, `switch/case` JSX 반환 후보를 정적으로 분석해 반환
  결과를 node, 결과를 선택하는 조건 조합을 edge로 표시하고 Resolver에서 한 번에 선택·복원하도록 추가
- `Main` graph를 compiler-ranked application entry 최단 경로와 현재 파일 반환 선택지만 보이도록 단순화하고,
  실제 mounted Fiber, 정적 target, unmounted inventory 순서로 `Locate current file` 근거를 우선하도록 수정
- 반환 결과의 JSX component를 import, local alias, barrel re-export, 일반 HOC와 lazy dynamic import까지 bounded
  DFS로 확장해 Layout/Header/Sidebar 같은 page 구성 근거와 HMR dependency를 수집하되 scalar prop 분기는 제외
- condition/choice registry를 outcome별로 다시 정렬하지 않고 snapshot당 한 번만 source identity index로 만들어
  큰 반환 그래프의 CPU와 임시 배열 할당을 줄임

## 0.1.1101 - 2026-07-20

- Inspector snapshot sanitizer가 의미 없는 실행 권한을 추가하지 않고 `header`와 `article` 레이아웃 경계를
  보존하도록 해 Blocker Flow가 거대한 타원이나 잘못된 grid로 변형되던 문제를 해결
- Advanced Blocker Flow를 기본 `Focus` 10개, current-file corridor 중심 `Main` 24개, 전체 bounded graph인
  `All` 세 범위로 나누고 Advanced 화면의 중복 요약을 제거해 graph와 별도 Resolver에 집중하도록 정리
- 범위 전환 시 graph를 자동으로 fit하고 기존 pan·선택·Resolver 동기화를 유지하며, graph pane 기본 폭을 52%로
  조정하고 splitter가 좁은 화면에서는 상하 배치로 반응형 전환되도록 개선

## 0.1.1100 - 2026-07-20

- Advanced Blocker Resolver의 노드를 이름과 의미 아이콘만 남긴 작은 형태로 단순화하고, 현재 파일·직접
  blocker·확정된 활성 경로는 선명하게 유지하면서 추정·휴면·대기 경로와 비활성 연결선은 흐리게 표시
- 상세 kind/state/owner/branch 정보는 노드의 접근 가능한 설명과 오른쪽 Inspector에 보존해 캔버스에서는 주요
  흐름을 한눈에 확인하고 노드를 선택한 뒤 세부 정보와 해결 옵션을 독립적으로 확인하도록 정리
- 별도 Inspector 탭의 `100%`와 `Fit all` 카메라를 명확히 구분하고, 빈 캔버스를 primary pointer로 자유롭게
  끌어 이동하는 pan·pointer capture·camera persistence를 추가하되 노드 클릭과 오른쪽 상세 선택은 그대로 유지

## 0.1.1099 - 2026-07-20

- Tailwind 지시어가 있는 workspace CSS만 CSS별 nearest package의 v4 `@tailwindcss/postcss` 또는
  configuration-free v2/v3 fallback으로 컴파일해 raw `@tailwind utilities` 때문에 utility class가 모두
  사라지던 문제를 해결하고, dirty TSX 후보도 bounded Oxide scan으로 hot rebuild에 포함
- PostCSS/Next/Vite/Tailwind config는 실행하지 않으며 nested CSS의 `@plugin`/`@config`, workspace 밖
  `@source`/import source modifier와 quoted/unquoted `url(...)` import 우회는 preflight에서 차단하고 CSS Modules,
  재사용 v4 processor 및 bounded style watch evidence를 유지; PnP zero-install은 hook 실행 대신 해결 방법 warning 제공
- 구형 Babel regenerator bundle이 strict ESM에서 CSP로 금지된 `Function(...)` fallback을 호출하지 않도록
  target/setup import 전에 writable global runtime slot을 준비하고, 기존 runtime binding과 `unsafe-eval` 차단은 보존
- React 16.8·17 프로젝트에서는 `useState`/`useEffect` 기반 Context registration 구독으로 전환해 React 18의
  `useSyncExternalStore`가 없어도 lazy Context provider가 뒤늦게 등록되는 흐름을 유지
- 실제 `react-dom` runtime manifest와 export map을 기준으로 root API를 선택하고 최신
  `@types/react-dom/client.d.ts`를 실행 가능한 subpath로 오인하지 않도록 해 React 16·17 프로젝트의
  `Could not resolve "react-dom/client"` 빌드 실패를 해결
- blocker trace와 runtime-health 로그에 웹뷰 수명 동안 유지되는 `runtimeSessionId`, content-addressed
  `artifactId`, hot `runtimeRevision`을 공통 기록해 같은 trace 번호를 가진 다른 탭·reload와 실제 반복 루프를 구분
- 기본 Blockers 화면을 `Current blocking path → Current blocker → Next action → Fix now` 한 열로 단순화하고,
  전체 flow graph와 오른쪽 Resolver 및 graph layout 계산은 `Advanced`를 명시적으로 열 때만 생성
- 좁은 Inspector에서 경로·편집기·버튼이 내부 폭에 맞춰 줄바꿈되도록 보강하고, 중복 condition 제어와 효과 없는
  재선택 버튼을 제거하며 튜토리얼·선후 관계는 접이식 고급 정보로 이동

## 0.1.1097 - 2026-07-20

- Blocker Resolver의 minimum-requirement 탐색에 revision-local semantic frontier fingerprint를 추가해 동일 상태와
  A→B→A 진동을 다음 remount 전에 중단하고, terminal 검색을 pass 0으로 자동 재시작하던 무한 루프를 차단
- 자동 hook/backend pass를 이전 render trace가 정착된 뒤에만 직렬 실행하며 재시작 사이에도 누적 8-pass 상한을
  유지하고, condition registry가 사라져도 원래 page corridor를 한 번만 재개하도록 attempt identity를 보존
- hook required-path 집합을 정렬한 signature로 비교해 발견 순서만 달라진 동일 Smart 값이 Auto로 재개방되지 않게
  하고, Resolver에 cycle/limit 중단 사유·반복 길이·진행 상태와 명시적 retry 경로를 표시
- 좁은 Inspector에서 graph와 Resolver를 세로 배치하고 카메라를 3열/2열로 축약하며 관계·조건·JSON 편집기를
  내부 wrap/scroll 처리해 작은 폭과 낮은 높이에서도 컨트롤이 화면 밖으로 벗어나지 않도록 개선

## 0.1.1096 - 2026-07-20

- Blockers를 왼쪽 `Control & render flow` 캔버스와 오른쪽 `Blocker Resolver`로 분리해 선택 block의
  active/dormant·exact/inferred 상태, owner/source, 선행·후행 관계와 기존 Auto/Smart/branch 편집기를 한 화면에서 확인
- 별도 Inspector 탭이 소유하는 `−/100%/+/Center/Fit` 카메라를 추가해 preview React를 다시 렌더하지 않고 35~200%로
  확대·축소하며, snapshot 교체 뒤에도 그래프 중심과 zoom을 보존하고 Inspector 전체 스크롤을 이동하지 않도록 개선
- `Locate current file`이 단순 component 이름 대신 선택 export·정확한 source·mounted 경계를 모두 확인한 함수 진입점을
  선택·중앙 정렬하고, 아직 마운트되지 않았으면 가장 가까운 path blocker 또는 정적 current-file 문맥을 안내
- Resolver에 `Locate → Trace → Resolve → Verify` 가이드를 제공하고 대형 bounded graph에서도 current-file target,
  active/direct blocker를 우선 보존하며 label·edge·source·HOC/slot 변화가 즉시 layout을 갱신하도록 fingerprint를 강화

## 0.1.1095 - 2026-07-20

- Blockers를 카드 목록 대신 debugger control-flow graph로 표시해 함수 진입, 조건 판단, `true`/`false` 및
  `case`/`default` 분기, component 호출, return과 합류 지점을 실제 선으로 추적하고 활성·비활성 경로를 구분
- 정적으로 안전하게 증명한 component-local `switch/case`를 계측해 literal case와 default를 Inspector에서
  선택·초기화할 수 있게 하고, 동적 case는 오판 없이 읽기 전용으로 유지
- `memo`, `forwardRef`, `compose`, `with…` 계열 HOC와 `component`/`as`/render prop을 render graph부터
  Components tree와 Blockers flow까지 보존해 고차 컴포넌트 및 전달된 컴포넌트의 호출 문맥을 명시적으로 표시
- 프로젝트에 `react-dom/client`가 없으면 legacy `react-dom`의 `render`/`unmountComponentAtNode` adapter를 자동
  선택해 React 16·17 프로젝트도 확장에 포함된 React 19가 아니라 해당 프로젝트의 module root에서 bundle

## 0.1.1094 - 2026-07-20

- Blockers Render flow에서 선택한 현재 파일 export가 최종 owner인 미해결 blocker만 `CURRENT FILE BLOCKER`
  배지, 노란 시작선과 상단 개수로 강조해 ancestor·descendant·sibling blocker와 즉시 구분
- current-file 판정은 단순 component 이름이나 target 상태를 재사용하지 않고 mounted selected export, exact owner
  ID와 일치하는 source path를 요구해 imported child·정적 inventory·fallback owner 추정의 오탐을 차단
- blocker의 active/waiting 상태와 기존 선후행 그래프는 그대로 유지하고 텍스트 배지와 접근 가능한 label도 함께
  제공해 색상에 의존하지 않고 현재 파일 렌더를 직접 막는 지점을 선택·조정 가능

## 0.1.1093 - 2026-07-20

- Inspector의 1차 탐색을 `Components`와 `Blockers` 탭으로 분리하고, Blockers를 단순 오류 목록 대신
  workspace/app/route에서 현재 파일까지의 `component function → render condition → selected return JSX → child`
  흐름으로 시각화해 현재 파일 전후의 렌더 문맥과 선행·후행 blocker를 함께 확인하도록 개선
- compiler가 계측한 `&&`, ternary, early return, overlay visibility에는 authored/effective 상태와 true/false/reset
  스위치를 flow card에 직접 제공하고, runtime/data blocker도 같은 그래프 안에서 기존 Smart/JSON/retry 편집기를
  펼치되 명시적인 Reveal 전에는 Components tree 선택과 스크롤을 변경하지 않도록 분리
- 선택 component 상세를 `Props`, `State`, `Source`, `Payload` debugger로 정리하고 exact owner/source에 귀속된
  render switch, API·GraphQL payload와 hook fallback만 노출하며 임의 React hook slot은 읽기 전용으로 유지
- 별도 Inspector 탭 snapshot에서 Components와 Blockers의 독립 가로·세로 스크롤 및 안전한 `hidden` 속성을 보존하고,
  blocker 완료 이력도 hot revision/view/page/export 단위로 격리해 후보 전환 뒤 오래된 flow가 섞이지 않도록 수정

## 0.1.1092 - 2026-07-20

- 전체 application path에 흔한 `Modal`/`Page`/`Layout` 이름만으로 무관한 overlay 조건을 열지 않고, 선택 target의
  정확한 owner 또는 root-to-target source 근거가 있는 gate만 자동 통과하도록 target-guided DFS 범위를 제한
- 자동 JSX gate가 새 fatal runtime 오류를 만들면 해당 preview-only 결정을 authored 값으로 rollback하고 오류 경계도
  함께 remount해 authored branch를 복구하며, 같은 page 탐색에서 재선택하지 않고 condition/trace identity를 기록
- `.filter()`/`.map()`/array item access가 정적으로 증명된 정확한 경로에서만 object placeholder를 실제 Array로
  교정해 `options.filter is not a function` 연쇄를 차단하고, 실제 sibling·설정 object·기존 Array identity는 보존
- direct artifact, 선택 export, page candidate, hot revision 사이에서 hook/effect 자동 상태를 격리하고 실제 activate된
  hot entry만 scope를 교체하며, 후보 전환 시 바깥 Provider tree도 remount해 app Router 결과와 새 후보를 이전
  후보의 provider 값이나 늦은 async effect가 오염하지 않도록 개선

## 0.1.1091 - 2026-07-20

- Page Component Tree에서 mounted component 행을 선택하면 남아 있던 Pick hover 후보를 해제하고
  `Highlight`를 자동으로 켜, 실제 페이지에 연결된 해당 React host root를 즉시 노란 outline으로 표시
- export 전환·hot refresh로 Fiber 구조 ID가 바뀐 경우 export identity로 최신 트리 노드를 한 번 더 찾아
  오래된 행 ID가 다른 component를 강조하거나 선택 표시만 남기는 문제를 방지
- `PAGE PATH`, blocker, unmounted inventory처럼 실제 host가 없는 행은 존재하지 않는 영역을 강조하지 않고
  이전 Pick outline만 정리하며, authored inline outline과 priority가 highlight 해제 시 정확히 복원되도록 검증

## 0.1.1090 - 2026-07-20

- 별도 Inspector 탭이 스냅샷마다 트리 DOM을 교체해도 문서와 Component Tree의 가로·세로 스크롤을
  보존하고, 일반 행 선택과 Pick·Wireframe·Current file의 명시적 reveal을 분리해 불필요한 최상단 점프를 제거
- Pick on page로 고른 실제 DOM host를 가장 가까운 React 컴포넌트 트리 행과 연결하고, 선택 경로를 자동으로
  펼쳐 해당 행만 트리 viewport 안으로 이동하도록 해 페이지와 컴포넌트 계층의 위치를 즉시 대응
- 선택한 정확한 host를 React mount·이벤트·Fiber를 건드리지 않고 하나씩 숨기는 `Hide picked`와 최근/전체 복원을
  추가하고, 트리별 숨김 수·bounded locator·hot-reload 재연결 검증으로 가역성과 오선택 방지를 강화

## 0.1.1089 - 2026-07-20

- Redux 대괄호 selector, Reselect 중간 객체, 중첩 destructure·collection 오류, 같은 파일의
  `styled`·`memo`·`forwardRef` HOC를 정적으로 연결하고 default export의 실제 함수명까지 추적해 전체 데이터 경로와
  export props를 복구하되, hook/local receiver는 target props에 잘못 투영하지 않도록 제한
- Next.js App Router의 root-to-leaf `layout` 체인과 파일시스템 route를 페이지 shell로 합성하고, 관련 route source를
  hot reload 의존성에 포함하며 동적 `params`·`searchParams`를 동기/Promise 양쪽에서 읽을 수 있게 제공해 선택
  컴포넌트뿐 아니라 헤더·사이드바를 포함한 실제 페이지 맥락을 우선 렌더링
- 분리된 모듈의 ReactDOM portal host와 exact ID selector, 패키지 CSS `style` export를 정적으로 발견하고 Tailwind
  package import와 overlay root를 webview 시작 전에 준비하며, hot revision에서 확장 소유의 오래된 host만 정리
- root-to-target 경로에 속한 hook/API만 작은 frontier로 순차 자동 생성하고 Auto payload cache를 모드별로 분리해,
  형제 컴포넌트의 과잉 데이터 생성과 반복 렌더를 줄이면서 unknown list는 Smart 단계에서 최소 항목으로 확장
- 자동 Blocker 수정은 결과가 3개 snapshot과 320ms 동안 안정화된 뒤 원래 시도에 귀속하고 최대 960ms 내에 종료하며,
  동일 Smart 재시도·새 시도의 대체·오류 재발까지 기록해 잘못된 성공 판정과 후속 오류 인과관계 손실을 제거

## 0.1.1088 - 2026-07-20

- 실패한 selector 결과가 `?.`로만 읽히더라도 실제 nullish 반환은 그대로 보존하면서 예외가 난 경우에는
  optional 경로의 최소 구조를 생성해, 하위 helper의 기본 sentinel이 또 다른 런타임 오류를 만드는 연쇄를 차단
- `timeSeconds`·`milliseconds`·`durationMs` 같은 시간 수치 키를 0으로 추론해 음수 기본값 검증을 통과시키고,
  비교 전용 selector는 enum 비교를 무조건 참으로 만들지 않아 Loading·Error·Overlay가 잘못 활성화되지 않도록 수정
- 반환값을 사용하지 않는 analytics·effect-once·scroll-lock 류 훅 실패는 정확한 소스와 오류를 Console에 유지하되
  Page Component Tree의 사용자 해결 대상과 blocker trace 자동 선택에서 제외해 실제 렌더 중단 원인을 선명하게 표시
- optional 실패 구조는 루트 selector/data hook에만 적용하고 Context의 중첩 optional destructure는 기존 단락을 유지해,
  권한·파트너 같은 선택 데이터가 자동 생성 때문에 오히려 보호 분기를 활성화하는 회귀를 방지

## 0.1.1087 - 2026-07-20

- Page Component Tree 행의 pointer/keyboard 선택 직전에 트리와 미리보기 문서의 유한한 scroll 좌표를 hot session에
  캡처하고, export 선택으로 Inspector shell이 remount되어도 layout commit과 다음 animation frame에서 복원
- remount된 Components pane이 깊은 선택 행의 조상을 접은 채 먼저 렌더링해 브라우저가 저장 좌표를 0으로 clamp하지
  않도록 초기 state부터 선택 경로를 펼치고, 이후 외부 선택도 paint 이전 layout effect에서 조상 경로를 확장
- 일반 사용자 스크롤은 최신 안정 좌표로 계속 기억하되 pending row-click 복구 중 발생하는 임시 scroll event는
  저장값을 덮지 않도록 tree scroll 수명주기를 독립 런타임 모듈과 회귀 테스트로 분리

## 0.1.1086 - 2026-07-20

- Page Component Tree의 모든 선택 변경에서 행 reveal을 실행하던 동작을 명시적인 Wireframe/Current file 이동의
  one-shot 요청으로 제한해, 사용자가 이미 보고 있는 깊은 행을 클릭할 때 트리 스크롤이 최상위로 돌아가지 않도록 수정
- Modal·Dialog·Drawer·Portal의 visibility prop, 내부 null guard, `condition && <Modal />`을 동일한 overlay gate로
  분류하고, 양쪽 라벨에 같은 Modal 이름이 있어 target 점수가 동점이어도 visible 분기가 현재 파일에 필요하면 자동 활성화
- 선택 파일 자체가 평소 숨겨진 overlay인 빠른 직접 프리뷰에서도 compiler-proven owner가 일치하면 기본 visible 상태로
  렌더링하고, 수동 분기 값이 이를 다시 숨기면 해당 조건을 Page Component Tree의 current-file blocker로 표시

## 0.1.1085 - 2026-07-20

- `styled(...)`, `memo(...)` 같은 HOC/factory 안의 PascalCase render owner를 복구하고 `if/else` 양쪽이 서로
  다른 컴포넌트를 반환하는 조건도 blocker로 기록해, 선택 파일로 이어지는 component 이름과 일치하는 true/false
  분기를 target-guided DFS가 자동으로 선택하도록 개선
- 상대 `Route path`가 `createAppModule('/base', ...)` 형태의 앱 모듈 안에 선언되면 factory의 절대 base를 함께
  합성해, `/contract-upload-preview` 대신 실제 중첩 페이지 경로를 초기 webview location으로 복원
- 역할 boolean은 전체 후보 이름의 우연한 단어 일치가 아니라 `App`·`Layout`·`Provider` 같은 identity container의
  모든 복합 역할 토큰이 일치할 때만 활성화해, owner 페이지에서 `LegalPartnerSelectPage`라는 자식 이름 때문에
  partner-staff 상태가 켜지는 잘못된 Smart Fill을 방지
- `legalPartnersForCompanyCreate`처럼 복수 명사가 `for`/`by`/`of` 수식어 앞에 놓인 GraphQL 필드도 collection으로
  추론하고, no-network XHR adapter를 독립 런타임 모듈로 분리해 자동 payload의 `.map()` 오류와 모듈 비대화를 해소

## 0.1.1084 - 2026-07-20

- Reselect `createSelector`의 로컬 input selector를 역추적해 projector가 객체로 사용하는 중간 Redux 경로까지
  정적 상태에 생성하고, 목표 페이지 경로를 근거로 인증·역할 boolean의 최소 통과값만 선택해 데이터는 준비됐지만
  로그인/권한 분기에서 멈추던 페이지 탐색을 개선
- `condition && { path, element: <Page /> }` 형태의 조건부 React route entry를 일반 객체 계산과 구분해 Inspector
  blocker로 기록하고, 선택 파일로 이어지는 페이지 element 이름이 증명되면 해당 route만 자동으로 활성화
- Emotion styled component selector에 안정적인 compiler target을 주입하고 Next dynamic의 CommonJS 이중 default
  결과를 정규화해, Babel 전용 selector 오류와 `React.lazy`가 컴포넌트 대신 module object를 받은 실패를 방지
- 일반 `console.error`와 React 개발 경고를 실제 render failure chain에서 분리하되 Inspector Console에는 유지해,
  native bridge 안내나 설정 경고 때문에 성공한 렌더 revision이 실패로 판정되는 현상을 제거
- 빠른 첫 revision이 앱 소유 `RouterProvider`를 만나 중첩 Router 오류가 나면 선택 컴포넌트 boundary가 이를
  placeholder로 확정하지 않고 바깥 candidate boundary가 추론한 MemoryRouter만 제거해 즉시 재시도하며, 복구 중
  발생하는 개발용 browser error event도 실패 revision으로 기록하지 않도록 수정

## 0.1.1081 - 2026-07-20

- PnP virtual workspace source의 상대 import를 물리 파일로 읽은 뒤에도 consumer별 virtual module identity를
  자식 경로에 유지해, 앱이 제공한 `peerDependencies`가 `UNDECLARED_DEPENDENCY`로 잘못 끊기지 않도록 수정
- 소스 제어에서 제외되고 앱의 codegen 단계가 만드는 `generated`/`__generated__`/`*.generated.ts` 모듈이
  아직 없으면 일반 누락 컴포넌트와 구분해 재귀적으로 안전한 render-only contract 값으로 대체하고, generated-only
  export barrel의 임의 named DTO import까지 유지하면서 생성 디렉터리를 감시해 실제 산출물이 생기면 hot reload

## 0.1.1080 - 2026-07-20

- Yarn Plug'n'Play가 peer dependency별 workspace package를 `.yarn/__virtual__` 가상 경로로 반환해도
  `.pnp.cjs`를 실행하지 않고 Yarn의 depth 규칙으로 실제 monorepo source를 복원해, 존재하지 않는 가상 파일을
  직접 읽다가 발생하던 `ENOENT` preview build 실패를 제거하고 정적 import graph도 같은 물리 경로를 사용
- Inspector component tree의 선택 행 reveal에서 문서 전체를 움직이는 `scrollIntoView`를 제거하고 tree viewport의
  `scrollTop`/`scrollLeft`만 필요한 만큼 조정해, 깊은 노드를 클릭할 때 Inspector나 preview가 맨 위로 점프하지
  않도록 수정

## 0.1.1079 - 2026-07-19

- 이미 Auto 값이 적용된 hook/API 관찰 항목을 미해결 blocker 집계에서 제외하고, 같은 렌더 스택의 자동 결정과
  tree discovery/update를 bounded batch로 기록해 대형 페이지마다 수백 번 발생하던 webview 메시지·소스 재읽기·
  pretty JSON 출력을 줄이면서 실제 remount 결정과 후속 오류의 trace ID 인과관계는 유지
- 자동 Storybook preview entry의 직접 runtime import를 전체 번들 전에 AST로 검사해 누락된 로컬 모듈이 명확한
  경우 실패가 예정된 첫 esbuild를 생략하고 setup-free build를 바로 시작하며, 누락 후보와 상위 디렉터리를 감시해
  파일 생성 또는 setup 수정 시 자동으로 원래 설정을 재시도
- lazy root의 첫 로딩 여유는 보존하되 이후 page-path DFS probe를 260ms 고정 대기에서 48ms continuation으로 바꿔
  16패스 최대 순수 대기 예산을 약 4.2초에서 0.9초로 줄이고, 비치명 React/AG Grid 설정 경고가 자동 해결 실패
  chain을 시작하지 않도록 분리
- `meetingList { objectList { ... } }`처럼 pageInfo를 생략한 GraphQL collection wrapper를 외부 배열로 오인하던
  shape 추론을 수정하고, 한 객체 안에서 부모 데이터 명사와 연결된 비파괴적 역할 boolean이 여러 개면 첫 분기만
  활성화해 `undefined.length`와 all-false exhaustive dispatcher의 `Error: never`를 자동 데이터 단계에서 차단

## 0.1.1078 - 2026-07-19

- Auto/Smart backend payload와 hook/blocker fallback의 일반 문자열을 긴 임의 문장 대신 실제 leaf key로 생성해
  `name`, `description`, `employeeName`처럼 출처를 바로 알 수 있는 짧은 값으로 렌더링하고, 32자를 넘는 key는
  말줄임 처리해 콘텐츠 때문에 컴포넌트 폭이 비정상적으로 확장되지 않도록 개선
- 명시적으로 선택한 Lorem 모드는 문장형 fixture를 유지하고, ID·이메일·전화번호·날짜·URL처럼 런타임 형식이
  필요한 필드는 유효한 전용 값을 보존해 compact Auto 값이 프로젝트 로직의 새 오류를 만들지 않도록 구분
- `.filter()`·`.map()` 같은 Array prototype 호출을 callback property가 아니라 collection receiver 증거로 해석해
  `legalPartnersForCompanyCreate.filter is not a function`처럼 Auto payload가 스스로 만드는 타입 오류를 방지
- 동일한 GraphQL/REST 응답과 수동 hook override의 객체·callback identity를 세션 동안 유지하고, 짧은 시간에 같은
  effect가 24회 넘게 재실행되면 해당 source site만 render-only 경고로 격리해 update-depth 무한 루프를 차단
- Page Inspector가 전체 저장소를 다시 스캔하지 않고 package root와 `src`의 `index`·`main`·`bootstrap`,
  `global.d.ts` convention만 추가 확인해 앱 엔트리가 설치하는 `Buffer`·`decimal` 전역을 정확히 복원
- 자동 관찰 로그와 실제 remount를 일으킨 Auto/Smart 조작을 분리하고 `findDOMNode` 같은 비치명 React 개발 경고를
  subsequent error로 연결하지 않아 blocker trace가 실제 실패 원인만 보여주도록 정리

## 0.1.1077 - 2026-07-19

- 대형 background build의 artifact metadata와 실제 chunk가 운영체제 locale에 따라 서로 다르게 정렬되어
  정상 결과를 폐기하던 문제를 수정해, 빠른 단일 컴포넌트 프리뷰 뒤에 준비된 전체 페이지·스타일 context가
  안정적으로 교체되도록 개선
- ReactDOM entry까지 연결된 완전한 application root를 부분 `*App` wrapper보다 우선하고, 정적으로 증명된
  안전한 pathname을 app-owned BrowserRouter가 생성되기 전에 주입해 헤더·사이드 메뉴·페이지 layout·portal을
  실제 route 흐름으로 복원
- Page Inspector Auto mode에서 React의 effect/layout-effect가 websocket, analytics 같은 비시각 bootstrap
  의존성 때문에 실패해도 완성된 DOM을 제거하지 않도록 격리하고, 원본 오류와 source 위치는 Inspector console에
  render-only 경고로 유지
- 프로젝트 스타일이 준비되기 전 ready canvas에는 낮은 CSS 우선순위의 흰색 fallback을 사용해 VS Code 다크
  배경이 비치는 현상을 막되, 앱이 정의한 body/global style은 그대로 우선 적용되도록 변경

## 0.1.1076 - 2026-07-19

- Page Inspector의 lazy page root가 열리기 전에 전체 render corridor의 styled-components theme import를
  canonical module identity로 합쳐 정확한 프로젝트 theme를 주입하고, 구조적 fallback token이 원본 theme를
  덮거나 `spacing` 같은 함수형 token을 값으로 오인하던 스타일 손상을 방지
- 프로덕션 `index.html`에서 정적으로 증명된 `html`/`body`/mount root의 class, lang, dir, id, style, data 속성을
  webview 문서 셸에 복원해 `body.body` 같은 전역 reset과 앱의 root selector가 동일하게 동작하도록 개선
- 안전한 page root보다 위에 있는 app wrapper의 component flow만 제한적으로 역추적해 exported
  `createGlobalStyle`을 정확한 ThemeProvider 내부에 함께 렌더하고, 함께 import되는 Bootstrap/Sass 전역 스타일도
  실제 앱 순서로 복원
- esbuild의 aggregate entry CSS를 즉시 연결하지 않고 dynamic-import 경계별 static CSS ownership을 metadata로
  복구해 unopened route, editor, modal의 전역 selector가 현재 페이지를 오염하지 않도록 변경하고, hot reload가
  commit되면 이전 revision의 lazy stylesheet를 정리

## 0.1.1075 - 2026-07-19

- Page Inspector가 파일의 PascalCase/기본 export 중 실제 React component·element만 gallery에 남기고 GraphQL
  `DocumentNode`, Fragment 상수, Context 같은 비시각 export는 렌더 대상으로 선택하지 않도록 수정
- GraphQL Code Generator의 `getFragmentData(document, carrier)` 호출을 정적으로 식별해 실제 carrier가 비어 있어도
  fragment selection에 필요한 최소 필드를 Auto 값으로 복구하고, 공용 `useQuery` wrapper blocker를 document와 ID
  variable별로 분리해 서로 다른 요청 payload가 덮어쓰지 않도록 개선
- Context 이름의 project hook도 일반 runtime circuit breaker의 정밀한 사용처 추론을 이용하며, React
  `ComponentType`/`ElementType` prop과 JSX tag prop은 callback과 구분된 null-rendering placeholder로 보존해
  `<Icon />` 같은 필수 시각 prop이 `undefined`로 전체 export를 중단하지 않도록 보완
- TypeScript resolver가 `Buffer` 같은 package global을 `.d.ts`로 찾았을 때 인접한 JS/MJS/CJS 구현을 주입해
  declaration-only 빈 namespace와 Node builtin shim 대신 실제 browser polyfill API를 사용하도록 수정
- 대형 저장소의 entry-path 탐색을 중복 없는 우선순위 heap과 공통-root canonical identity로 바꾸고, 고정된 Page
  Inspector 경로 밖의 project-owned lazy route만 inert module로 치환해 실제 rtcc benchmark의 결과물을
  71.8MB/1,484 chunks에서 23.8MB/456 chunks로 줄이고 전체 준비 시간을 약 90초에서 약 41초로 단축
- 내부 theme/setup resolver probe는 lazy-route 경계에서 제외하고, 종료된 Auto 시도에 뒤늦은 오류가 잘못
  귀속되지 않도록 blocker trace의 causal window를 바로잡음

## 0.1.1074 - 2026-07-19

- Yarn PnP 같은 workspace 주입 CommonJS resolver가 VS Code의 conditional `require`를 거부해 확장 자체가
  활성화되지 않던 경로를 ESM extension-host entry로 분리하고, ESM 확장을 지원하는 VS Code 1.100을 최소
  버전으로 명시
- public command 네 개를 compiler·cache·panel보다 먼저 등록하고 무거운 서비스는 첫 trusted command까지
  지연해 adapter 초기화 실패가 불명확한 `command not found`로 축약되지 않도록 개선
- Restricted Mode에서는 명령과 Workspace Trust 안내만 제공하고, 사용자가 신뢰하기 전에는 workspace 번들링과
  실행을 시작하지 않으며 초기화 실패 시 `React Preview` Output channel로 바로 이동하는 선택지를 제공
- VSIX에서 이전 CommonJS host artifact와 로컬 진단 `log.txt`를 제외해 잘못된 entry 혼입과 사용자 로그 배포를
  방지

## 0.1.1066 - 2026-07-19

- Page Inspector blocker를 현재 상태가 아닌 `blocker-discovered → auto-selection → render-result →
subsequent-error` 시간순 trace로 기록하고, 한 Auto/Smart 시도와 그 뒤의 blocker 변화·오류에 같은 trace ID를 부여
- hook fallback, Virtual Backend Auto/Smart/Lorem payload, target-guided JSX gate, 최소 page-path DFS와 target prop
  Smart fill이 선택한 mode·생성 property path·bounded JSON 값을 구조화해 `React Preview` Output channel에 자동 출력
- blocker의 source path/line/offset이 마지막 정상 bundle dependency graph에 포함될 때만 해당 줄 전후의 authored source를
  확장 호스트에서 읽어 trace에 첨부하고, graph 밖 경로·malformed/unbounded webview payload는 소스 읽기 전에 차단
- 동일 tree snapshot과 반복 오류를 fingerprint로 합치고 source 읽기/pretty JSON 출력을 비동기 직렬화 lane에서 처리해
  project render와 VS Code UI thread를 막지 않으며, Inspector Console에 trace 확인 위치와 검색 marker를 안내

## 0.1.1065 - 2026-07-19

- 별도 React Page Inspector 탭의 Components tree와 Details 사이에 드래그 가능한 splitter를 추가해 두 영역의
  크기를 사용자가 직접 조절하고, double-click으로 현재 방향의 기본 비율을 복원하도록 개선
- 760px 이상에서는 좌우, 좁은 editor group에서는 상하 splitter로 자동 전환하며 두 방향의 비율을 독립적으로
  VS Code webview state에 저장해 탭 reload와 snapshot 교체 후에도 사용자가 정한 크기를 유지
- separator에 ARIA orientation/value를 제공하고 방향키, `Shift+방향키`, `Home`/`End` 조작을 지원하며 양쪽 pane의
  최소 가시 크기를 현재 workbench 크기에 맞춰 clamp해 화면 밖으로 밀려나지 않도록 제한
- pane drag를 companion 문서의 local grid update로 처리해 hidden project renderer에 pointer event나 React remount를
  전달하지 않고, Inspector 크기 조절 중 preview CPU와 snapshot traffic이 증가하지 않도록 격리

## 0.1.1064 - 2026-07-19

- `Fix blocker`가 관찰한 prop의 중간 container가 `null`이어도 same-file type/receiver inference의 가장 깊은
  증명 leaf까지 최소 구조를 다시 만들고, 사용자가 지정한 non-null 값은 그대로 유지하도록 Smart merge를 보완
- `reading 'value'` 같은 짧은 오류뿐 아니라 `props.field.value.address.split()` 같은 receiver 경로도 component의
  외부 prop path와 정렬하며, UI provenance 제한과 별개로 전체 inferred shape를 bounded scan해 누락을 방지
- 오류가 실제 dereference 실패를 증명한 Smart prop path에서는 blocking null scalar도 타입 호환 값으로 교체하되,
  일반 Auto fallback의 authored null/falsey branch 보존 정책은 바꾸지 않도록 completion 정책을 분리
- 이름 기반 fallback에서 `address`를 `add...` callback으로 오판하던 접두사 검사를 camelCase/snake_case 경계로
  제한하고, 실제 호출 또는 함수 타입이 증명된 prop만 no-op callback으로 materialize하도록 정교화

## 0.1.1063 - 2026-07-19

- `Fix blocker`의 props 편집기가 target의 첫 commit 전에 실패하면 `{}`로 시작하던 경로를 제거하고, export의
  same-file type/receiver 사용, 부모 JSX literal, 마지막 관찰값과 사용자 override를 합친 Smart prop 초안을 제공
- `reading 'value'`처럼 runtime 오류가 짧은 property만 알려줘도 inference provenance의 suffix와 결합해
  `field.value` 같은 증명된 전체 prop path에 최소값을 채우고, 근거 없는 중첩 위치는 임의로 추측하지 않도록 제한
- 함수형 prop을 JSON에서 제거하지 않고 `[Preview no-op function]`으로 표시·저장한 뒤 project render 경계에서만
  inert callback으로 복원해, callback-only props도 빈 객체로 보이거나 reload 후 사라지지 않도록 개선
- nested target의 inferred shape를 page descriptor에도 보존해 실제 React base-prop 등록 effect가 commit되기 전에도
  `Smart fill props`와 `Smart fill and retry`가 같은 descriptor-backed 최소값을 사용할 수 있게 통합

## 0.1.1062 - 2026-07-19

- Page Inspector의 전역 graph Router와 선택 page candidate의 지역 Router가 동시에 합성될 수 있던 경로를 제거해,
  각 candidate가 `rootOwnsRouter`와 실제 상위 context를 기준으로 정확히 한 경계만 선택하도록 수정
- `react-router-dom`뿐 아니라 `react-router` core entry의 consumer/provider import도 graph 및 candidate-local
  ownership 근거에 포함해 custom app Router의 정적 감지 범위를 확장
- custom wrapper/re-export 때문에 내부 Router를 정적으로 증명하지 못한 경우에도 nested-`<Router>` invariant만
  candidate 경계에서 포착해 추론한 MemoryRouter를 제거하고 같은 authored candidate를 즉시 다시 렌더링

## 0.1.1061 - 2026-07-19

- 실제 port나 backend process 없이 Fetch·Axios·XMLHttpRequest·Apollo 요청을 한 broker로 종료하는 탭 내부
  Virtual Backend를 추가하고, method·정규화 resource URL·redacted body/query fingerprint로 요청 variant를 구분
- REST GET 결과를 canonical resource로 유지하며 POST/PATCH/PUT/DELETE를 이후 GET에 반영하고, React remount나
  StrictMode 재실행에서 같은 POST fingerprint가 중복 row를 계속 추가하지 않도록 mutation 결과를 안정적으로 재사용
- GraphQL operation/variables별 fixture 상태를 격리하고 기존 selection/alias/fragment 및 TypeScript response shape
  inference를 Virtual Backend의 결정적 Auto/Lorem/Smart payload seed로 재사용
- Payloads 탭에서 요청별 Success/Empty data/HTTP error, 대표 error status와 지연 시간을 선택하고 ephemeral resource
  state 또는 response scenario를 독립적으로 초기화하며, request field와 resource identity를 함께 표시
- compiler가 직접 증명하지 못한 fetch client도 HTTP(S), `/v1` 같은 상대 backend 후보를 전역 경계에서 차단하되
  `./`·`../` JSON/TXT/CSV fixture는 기존 local fetch로 유지하고 credential property는 fingerprint 전에 redaction

## 0.1.1060 - 2026-07-19

- HOC export의 Inspector boundary만 mount되고 내부 guard가 `Navigate`/`null`을 반환한 상태를 성공으로 오판하지
  않도록, page root와 선택 target이 실제 host output을 함께 commit해야 target 도달로 판정
- reverse caller graph에 나타나지 않는 HOC guard도 같은 live reachability pass의 compiler-proven continuation이면
  bounded DFS 후보로 사용해 로그인/권한 wrapper 뒤의 실제 current-file component까지 자동 진행
- `fallback: null`/`error: null`처럼 branch를 비활성화하는 명시적 중립값을 lorem scalar로 바꾸지 않고,
  더 깊은 object/array/callable path가 증명된 경우에만 필요한 형태를 보완
- Auto hook/API 값처럼 이미 통과된 보조값과 단순히 꺼진 JSX condition을 wireframe의 빨간 blocker에서 제외하고,
  실제 미해결 render stop만 `!` marker로 표시
- 동일한 DOM 사각형을 공유하는 HOC/styled/Fiber ownership을 의미 있는 React component 하나로 합치고 generic wrapper,
  중복 배경, 상단 route chip을 제거해 wireframe 아래 실제 페이지와 current-file highlight가 가려지지 않도록 개선
- `rtcc-poc-page`의 `investment-contract-analysis-page.tsx`를 2,213개 의존성의 full page context로 직접 검증해
  guard 자동 통과 후 breadcrumb, page title, status panel과 정적 payload file list가 commit되는 것을 확인

## 0.1.1059 - 2026-07-18

- Components tree의 root/nested list를 intrinsic `max-content` 폭으로 유지하고 row를 줄바꿈하지 않게 바꿔,
  깊은 component 경로도 옆으로 눌리지 않고 Inspector pane 안에서 가로 스크롤 가능
- hook 결과를 구조 분해한 뒤 직접 호출하거나 JSX event/callback prop으로 전달하는 사용처를 함수 요구로 판별해
  `showCreate()`, `renderModalForm()`, `getRootProps()` 같은 callable 최소값을 문자열·빈 객체 대신 no-op 함수로 생성
- `Find minimum requirements`가 현재 관찰값만 한 번 채우지 않고 새 branch에서 드러난 hook/API field를 최대 8개
  batch까지 제한적으로 수렴하며, pass 수·발견 path 수·종료 상태를 Path blocker 상세 화면에 표시
- 이미 같은 Smart hook/API 값이 적용된 pass는 변경으로 계산하지 않아 불필요한 remount와 Inspector/renderer CPU 갱신을 방지

## 0.1.1058 - 2026-07-18

- Inspector에 `VIEW` 선택기를 추가해 기본 `Page flow (as authored)`와 명시적
  `File components (all exports)`를 전환하고 선택을 preview tab별로 유지
- Page flow는 화면의 문구·status code·component 이름으로 정상/오류를 추측하지 않고 로그인, 빈 화면, fallback,
  오류 화면까지 작성된 경로의 실제 결과로 그대로 보존
- 현재 파일의 모든 정적으로 증명된 component export를 export별 dynamic import, Suspense, error boundary로 격리해
  하나가 load/render에 실패해도 나머지 component를 순서대로 확인할 수 있는 중립 overview 추가
- page root는 정상 commit됐지만 현재 파일이 mount되지 않은 경우를 `TARGET ABSENT` 흐름 결과로 구분하고,
  실제 runtime/value blocker와 혼동하지 않도록 다른 Page path 또는 File components 비교 행동을 안내

## 0.1.1057 - 2026-07-18

- 별도 Inspector shell을 CSS inline-size container로 만들고 toolbar/status/page selector/tree row/tab/action을
  폭에 따라 줄바꿈하며, 760px 이하에서는 workbench를 1열로 전환해 작은 editor group에서도 가로로 이탈하지 않게 개선
- hook blocker에 `Smart fill minimum`을 추가해 inferred fallback 전체를 복사하지 않고 실제 required property path만
  생성하며, 기존 사용자 JSON은 보존한 채 data descriptor로 확인한 scalar 타입·callable과 `items[]`의 한 항목만 보완
- GraphQL/REST Payload에 `GENERATED · SMART MINIMUM` 모드를 추가해 selection/type shape의 필드와 list 한 항목만
  생성하고, 사용자 JSON이 있으면 유지·보완한 `USER + SMART MINIMUM`으로 Lorem·기존 Auto와 provenance를 분리
- contained target error의 Smart fill은 관찰된/사용자 props를 보존하며 오류가 증명한 누락 path만 합성하고,
  page-path Smart fill은 같은 corridor의 hook/API blocker를 batch로 최소화한 뒤 통과한 branch gate를 유지해 재시도

## 0.1.1056 - 2026-07-18

- Inspector 상단에 `Preparing page context`/`Page rendering is blocked`/`Page context is ready` 상태 카드와
  `Fix next blocker`/`Reveal current file`/`Return to page` 다음 행동을 표시
- tree 바로 위에 `Component`, `Current file`, `Page path`, `Condition`, `Preview value`, `Blocks rendering`
  범례를 항상 노출하고 모든 tree row에도 `COMPONENT`/`CURRENT FILE`/`PAGE PATH`/`CONDITION`/
  `PREVIEW VALUE`/`BLOCKER` 역할 문자를 직접 표시
- condition, 이미 Auto/manual 값으로 통과한 hook/API, 실제 render stop을 같은 blocker로 칠하던 UX를 분리해
  노란 condition, 파란 preview value, 붉은 active blocker로 구분하고 색상 외 icon·label·설명도 함께 제공
- active blocker 행에는 `BLOCKS PAGE · CLICK TO FIX`를 표시하고 상세 화면 첫 부분에서 중단 이유와 Auto/JSON/
  retry를 이용한 다음 행동을 쉬운 문장으로 설명
- `Flow`/`Blocker` 탭과 단계 상태를 `Fix blockers`/`Fix blocker`, `Fix this first`, `Blocked by an earlier step`,
  `Show next fix`처럼 행동 중심 용어로 변경하고 generated runtime의 구문 회귀 테스트를 추가

## 0.1.1055 - 2026-07-18

- Page Inspector의 성공 조건을 단순 target boundary mount에서 `authored page root commit + 같은 렌더의
selected export mount`로 강화하고, context strip에 `PAGE PENDING`/`PAGE DFS`/`TARGET BLOCKED`/
  `PAGE READY` 상태를 표시
- bounded DFS가 더 진행하지 못해도 page candidate를 자동으로 direct-target module로 교체하지 않고 현재 page를
  그대로 유지해 로그인·권한·데이터 blocker를 계속 관찰할 수 있도록 변경
- target-only 렌더는 사용자가 선택하는 진단 모드로만 유지하고 Flow에서는 해결로 판정하지 않으며,
  `Return to page context`로 같은 authored page corridor를 다시 시작할 수 있게 추가
- Flow의 기본 단계는 실제 mounted target owner path와 정적 entry→route→page→target source/name 증거에 속한
  blocker만 우선 표시하고, sibling page blocker는 Components tree에 보존하면서 별도 supporting 개수로 안내
- page commit boundary를 host DOM wrapper 없이 구성해 table/SVG/layout 구조를 바꾸지 않으면서 descendant가
  commit 전에 throw한 경우 page 성공이 기록되지 않도록 보장

## 0.1.1054 - 2026-07-18

- page wireframe의 blocker를 이름이 붙은 큰 경고 버튼 대신 24px 원형 `!` marker 하나로 축소하고,
  접근 가능한 이름과 tooltip에는 정확한 blocker/component identity를 계속 제공
- `!`를 클릭하면 blocker tree row를 선택·확장하는 동시에 별도 `Inspector · 파일명` tab을 포커스하고,
  같은 blocker를 다시 클릭한 경우에도 `Blocker` 상세 editor를 강제로 다시 열도록 연결
- hook `Auto pass` 편집기에만 required path를 보이던 불일치를 제거하고, 표시 JSON과 실제 project hook에
  주입되는 fallback 모두 동일한 prototype-safe required-path 합성 결과를 사용하도록 변경
- dotted/numeric/`items[]` path, callable leaf, boolean polarity, ID/email/date/URL/status/number/collection
  semantic을 구분하고 실제 non-null sibling과 callback은 보존하면서 필요한 누락 leaf만 채우도록 개선
- `rows.map(row => ...)` 같은 local collection 소비의 callback parameter를 정적으로 분석해 사용된 item field를
  가진 최소 한 항목을 생성하고, empty list 때문에 target subtree가 보이지 않던 Auto preview를 개선

## 0.1.1053 - 2026-07-18

- Page Inspector의 component tree, Flow, Props, Payloads, Fallbacks와 Console workbench를 렌더러 위
  drawer/floating overlay에서 별도의 `Inspector · 파일명` VS Code editor tab으로 분리
- project React와 page bundle은 기존 preview webview에서 한 번만 실행하고, extension-owned Inspector DOM만
  bounded snapshot으로 옆 탭에 미러링해 두 번째 application runtime과 추가 bundle 평가를 방지
- Inspector 탭의 tree 선택, condition, props/payload JSON, Auto 값, retry/remount, picker/highlight와 Wireframe
  조작을 opaque control ID로 원래 preview에 전달하고 hot reload/full-document fallback 뒤 snapshot을 재연결
- companion markup은 active tag/resource/event attribute를 제거하고 CSS network construct를 차단하며, source
  버튼은 실제 companion click과 committed dependency graph allowlist를 모두 통과한 파일만 editor에서 열도록 유지
- preview에는 page/component wireframe과 blocker marker만 남겨 application renderer를 Inspector chrome이
  가리지 않게 하고, preview가 닫히면 companion을 닫되 companion만 닫아도 preview session은 계속 유지

## 0.1.1052 - 2026-07-18

- Inspector 상세 영역에 `Flow (N)` 탭을 추가해 page root에서 target까지 발견된 condition, hook fallback,
  backend payload, path reachability와 contained render error를 단계별 flow chart로 표시
- component ancestor blocker를 descendant보다 앞에 두고 같은 owner에서는 path→condition→hook→data→render error
  순서를 적용하되, 동일 phase와 sibling branch는 거짓 의존성을 만들지 않고 같은 stage의 병렬 카드로 유지
- 각 단계를 `Resolved`, `Solve now`, `Ready in parallel`, `Waiting for predecessor`로 분류하고 선행 blocker 이름과
  component owner breadcrumb, 전체 해결 progress를 함께 표시
- Flow 카드에서 기존 blocker editor와 Components tree를 연결하고, 선택 blocker가 해결되거나 트리에서 사라지면
  다음 predecessor-ready blocker로 자동 이동하며 사라진 단계도 pinned session의 완료 이력으로 보존
- flow history를 page candidate/export별 최대 96단계·8개 scope의 비영속 Map으로 제한해 backend/Fiber 객체나
  오래된 다른 page scenario가 webview persistence에 들어가지 않도록 유지

## 0.1.1051 - 2026-07-18

- Page Inspector 렌더러에 전체 viewport page frame과 실제 Fiber host 경계 기반 React component placement
  wireframe을 기본 표시하고, 현재 파일 export는 별도 색으로 구분하며 toolbar에서 즉시 켜고 끌 수 있게 추가
- 렌더 실패로 host DOM을 만들지 못한 component도 가장 가까운 surviving parent 안에 `Unrendered` 점선
  placeholder로 배치하고 condition/hook/data/path/target blocker를 그 위치의 클릭 가능한 경고 마커로 표시
- wireframe blocker를 클릭하면 접힌 Inspector를 펼치고 기존 검색 필터를 해제한 뒤 정확한 component-tree ancestor를
  자동 확장·스크롤하며, 같은 blocker detail에서 payload/pass/retry 값을 바로 편집하도록 연결
- Fiber snapshot의 DOM map을 직렬화 불가능한 비열거 runtime index로 UI tree까지 보존하고, scroll/resize 좌표
  갱신을 animation frame으로 합치며 화면당 160개 outline·768개 tree visit 한도를 적용

## 0.1.1050 - 2026-07-18

- 로그인·권한·로딩 화면처럼 오류 없이 정상 commit됐지만 현재 파일의 target export를 호출하지 않은 경우를
  `target-reachability` 논리 blocker로 판정하고 root→route→target application path에 표시
- component-local `if (...) return <Login />`/`return null` early exit와 기존 ternary/fallback condition에
  target continuation branch·정확한 owner metadata를 추가하고, 정적 경로에 속한 gate를 바깥쪽부터 한 개씩
  자동 통과해 다음 commit에서 새로 드러난 hook/API 소비 필드를 점진적으로 수집
- 같은 traversal pass에서 발견된 session/context hook required path와 GraphQL/REST response shape만 경로별로
  묶어 blocker detail에 표시하고, 사용자 condition/payload override가 자동 DFS 결정보다 항상 우선하도록 보장
- 더 이상 안전하게 통과할 정적 gate가 없으면 선택 파일의 대표 export를 기존 Router/Theme/provider/Auto payload
  경계 안에서 직접 렌더하며, `Retry application path`와 `Render target directly`를 Inspector에서 명시적으로 제공
- 직접 fallback을 export별 tree-shakeable 가상 모듈로 격리하고 command-selected export만 생성해 사용하지 않은
  sibling component와 전체 파일 graph가 번들에 추가되는 회귀를 방지

## 0.1.1049 - 2026-07-17

- hook/API 계측 시 source 위치뿐 아니라 직접 소유 함수·컴포넌트와 렌더에 실제 필요한 property path를 함께
  보존해 blocker가 동명의 다른 파일이나 공용 `Unlocated` 그룹이 아닌 정확한 component branch에 연결되도록 변경
- 실패로 Fiber가 사라진 컴포넌트는 React component stack으로 `page → blocked component → blocker` 합성 경로를
  복원하고 `render blocked here` badge를 표시하며, 실제 렌더 영역에도 실패 컴포넌트명과 missing property를 가진
  retry placeholder를 남기도록 개선
- 함수/undefined가 JSON 직렬화에서 제거되어 pass-value editor가 `{}`로 보이던 문제를 해결하고, inferred callback을
  `[Preview no-op function]`으로 표시한 뒤 적용 시에만 inert function으로 복원하며 required property tree를 자동 생성
- Auto payload가 꺼져 빈 seed `{}`가 선택되어도 추론된 suggested payload와 flattened response property 목록을
  Payload/Blocker detail에 제공하고 선택한 data blocker의 정확한 request editor를 열도록 수정

## 0.1.1048 - 2026-07-17

- Page Inspector tree를 `Workspace React render root`에서 시작하고 실행하지 않은 application
  entry/lazy/route/wrapper 근거를 실제 mounted authored page Fiber 위에 연결해 page→target→children/sibling 및
  overlay 문맥을 한 트리로 표시
- 같은 현재 파일의 모든 mounted export boundary를 한 Fiber snapshot에 합쳐 `current file export` badge와
  `Reveal` 버튼으로 선택·ancestor expansion·scroll·DOM highlight를 제공하고, 현재 PAGE PATH에서 마운트되지
  않은 component export도 명시적인 `not mounted` branch로 보존
- JSX condition, render-critical hook fallback, no-network API/GraphQL payload와 target-local contained error를
  가장 가까운 source-backed component 아래 blocker node로 표시하고 선택 시 별도 Blocker detail을 열도록 변경
- hook blocker마다 compiler inference 기반 `Auto pass` 또는 prototype-safe 64 KiB 이하 사용자 JSON pass value를
  적용·초기화하고 `auto`/`manual` provenance를 표시하며, override와 선택을 hot reload/webview state에 유지
- route/context pseudo node를 blocker owner 후보에서 제외하고 target failure가 host fallback만 남긴 경우에도
  target pseudo component와 retry/Auto values/props 편집 UI가 유지되도록 회귀 테스트 추가

## 0.1.1047 - 2026-07-17

- styled-components template에서 실제로 호출되는 `theme.<helper>(...)` 경로를 정적으로 수집하고 callee만
  계측해, 중첩 ThemeProvider가 helper를 `{}` 같은 불완전한 값으로 덮어도 export 전체가 중단되지 않도록 변경
- 현재 provider의 정상 helper를 최우선 보존하고, 비호출 값/실패 helper만 탐색된 정확한 root theme의 동일
  경로로 복구하며 마지막에는 `.unit` 기반 CSS 값 또는 빈 token으로 해당 style edge만 격리
- helper 이름을 `spacing`으로 하드코딩하지 않고 nested path까지 지원하며, 복구된 경로 수를 Theme runtime
  status에 표시하고 실제 `rtcc-poc-page` styled source 변환 및 정상/불완전 provider 회귀 테스트 추가

## 0.1.1046 - 2026-07-17

- direct `useContext`를 Context 전용 fallback과 일반 hook fallback이 동시에 수정해 발생한
  `Overlapping static resource expressions are unsupported` 빌드 실패를 중앙 replacement 조정으로 해결
- 동일 range는 먼저 등록된 전용 Context/default 변환을 유지하고, 포함 range는 dynamic import 같은 더 좁고
  구체적인 resource macro를 우선해 일반 hook 계측만 해당 호출에서 생략하도록 변경
- strict replacement 적용기는 analyzer 자체 회귀를 계속 검출하도록 유지하면서 production transformer만 명시적
  reconciliation을 사용하고, exact/nested/disjoint 충돌 정책 회귀 테스트 추가
- `rtcc-poc-page`의 대표 실패 파일과 직접 `useContext` 소비 파일 227개를 실제 source transformer로 검증

## 0.1.1045 - 2026-07-17

- hook이 완전히 `null`인 경우뿐 아니라 `{ data: {}, field: undefined }`처럼 일부 경로만 비어 있는 경우도
  실제 own data-property를 보존하면서 정적 추론값으로 누락 leaf만 보완하고, hook 위치별 stable identity를 유지
- imported `useX` hook을 특정 프로젝트/패키지 이름 대신 실제 destructuring·property·tuple·call·조건 사용 증거로
  분석하고 Apollo, Formik, Redux, 번역/상태 라이브러리 및 직접 `useContext` 실패를 동일한 경계에서 처리
- imported `use*Context` 호출도 Page Inspector resolver를 통과시켜 Provider exception, nullish root와 partial
  Context value를 복구하되 일반 Gallery에서는 기존 `hookCall ?? fallback` 동작을 그대로 보존
- 생성한 경로를 `Fallbacks`와 Console warning에 표시하고 getter, class instance, React element, callback 및
  prototype-sensitive key는 병합하지 않는 회귀 테스트 추가

## 0.1.1044 - 2026-07-17

- React Fiber의 project-owned Portal을 더 이상 내부 노드로 접지 않고 `OverlayPortal` layer로 보존해 Modal,
  Drawer 등 portal child와 실제 owner context를 Components tree에서 함께 표시하고 선택/highlight 가능하게 변경
- hostless Context/Provider를 통해 authored `children` identity를 그대로 전달하는 component를 bounded Fiber
  비교로 판정해 `wrapper` badge로 표시하고, Modal/Dialog 계열 component는 mounted/dormant overlay로 구분
- `open`/`isOpen`/`visible`/`show`/`hidden` 같은 overlay visibility prop, 정확한 ReactDOM `createPortal`
  logical/ternary branch와 overlay-local `if (...) return null` guard를 preview condition으로 계측
- 닫힌 overlay도 Components tree에 `overlay · dormant` 조건 행으로 남기고 클릭 또는 상세 버튼으로 열고 닫되,
  override가 없으면 authored value와 branch를 그대로 유지하도록 회귀 테스트 추가

## 0.1.1043 - 2026-07-17

- Page Inspector가 선택한 page 후보마다 target-facing render path의 Router 소유 여부를 별도로 기록해,
  애플리케이션 graph 어딘가의 Router가 실제로 분리 마운트된 후보의 자동 경계를 잘못 끄지 않도록 수정
- 선택 후보가 Router 밖에서 렌더될 때 대상 프로젝트의 `MemoryRouter`를 후보 지역 경계로 보충하고,
  setup/상위 Router context는 render 시점에 상속하며 Router를 직접 소유한 후보에는 중첩하지 않도록 보장
- detached 후보·기존 Router 내부 후보·Router 소유 후보가 모두 정확히 한 Router depth에서 렌더되는 회귀
  테스트와 후보 metadata 직렬화 테스트 추가

## 0.1.1042 - 2026-07-17

- direct JSX parent 탐색이 private factory/route value에서 끊겨도 이미 증명된 target→entry render graph의
  public component export를 page/form/app 체크포인트로 승격하고, 실제 page 후보와 가까운 fallback을 함께 보존
- `React.lazy(() => import(...))`로 재노출된 default/named export를 reverse frontier로 취급해 lazy index를
  거친 JSX caller를 찾고 각 `PAGE PATH` root만 선택 시 dynamic import하도록 유지
- 후보 root의 다음 render-path caller에서 literal props를 수집하고 identifier parameter, local intersection,
  `React.FC<Props>`, styled-components inline component 타입을 neutral props로 추론해 root에도 Auto values 적용
- 작성된 parameter default는 생성값으로 덮지 않고, 필수 truthiness leaf와 callable path만 provenance가 표시된
  정적값으로 채워 값 부재로 인한 target-local 렌더 실패를 감소
- 대형 프로젝트의 direct JSX 역추적은 두 단계 뒤 render graph 체크포인트로 전환하고 unrelated lazy registry의
  render facts를 분석하지 않으며 파일별 lazy facts를 캐시해 CPU·메모리 전수 재분석을 방지

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
- 첫 렌더 뒤에는 서버 없이 새 local ESM/CSS를 기존 웹뷰에 교체하고 전달 실패·timeout 시 전체 HTML로 복구하는 hot-reload 경로 추가; React Fast Refresh state 보존은 의도적으로 제공하지 않음
- 일반 JS/TS import·package export·tsconfig alias·symlink를 esbuild 기본 resolver에 맡기고 source plugin은 dirty overlay와 bounded transform만 수행하도록 단순화해 대형 graph의 resolver 오버헤드 감소
- 가장 가까운 package 단위로 source/실제 JSX literal prop 근거를 초기 인덱싱하고 여러 탭에서 재사용하는 bounded cache 추가; 모노레포 형제 경계 차단, dirty consumer 즉시 무효화와 짧은 negative TTL 적용
- 활성 export에서 도달 가능한 자식·손자 컴포넌트와 CSS/asset/library import graph를 esbuild 기준으로 재귀 수집하고, 원래 dynamic import 경계를 local ESM chunk로 분리·게시해 실제 지연 로딩 추가
- 도달한 styled-components 소스의 named/default value 및 named type-only `theme` 근거를 수집하고, alias·상대 경로를 resolved file identity로 합쳐 유일한 실제 theme을 지연 적용하도록 확장
- 지원되는 React source editor의 우클릭 메뉴에서 새 `React Preview` 탭을 바로 여는 항목 추가
- target-rooted esbuild graph 전체에서 React Router consumer/provider 근거를 수집하고, 자식·손자에서만 consumer가 발견되면 최대 한 번 adaptive rebuild해 프로젝트 소유 `MemoryRouter`를 연결하도록 확장
- custom/Storybook setup의 존재만으로 자동 Router를 끄지 않고 실제 provider 근거가 있을 때 nested Router를 방지하며, setup별 bounded location·명시적 비활성화 계약 유지
- workspace TypeScript의 명시적인 `createContext` missing default를 inline 구조뿐 아니라 같은 파일의 non-generic·acyclic interface/type alias까지 제한적으로 보완하고, import/generic/recursive/extends/merged 선언은 변환하지 않는 fail-closed 경계 추가
- 명령을 실행할 때마다 대상 URI에 고정되는 독립 프리뷰 탭을 생성해 여러 파일을 동시에 비교 가능
- 프리뷰 포커스 변경이 활성 소스로 오인되어 재빌드·대상 변경을 일으키던 동작 제거
- 포커스된 프리뷰를 우선 갱신하고 기존 탭의 대상은 바꾸지 않는 명시적 refresh 동작 추가
- 패널별 revision·의존 그래프·debounce와 참조 횟수 기반 artifact lease 관리 추가
- TS/TSX AST 기반 `import.meta.glob`/`globEager`, `require.context`, 상대 template·연결식 dynamic import/require 발견 추가
- `.mjs/.cjs/.mts/.cts`와 도달한 dependency source에도 동일한 bounded resource 분석 적용
- `new URL(..., import.meta.url)`, package별 `public` asset·CSS import, 임의 로컬 파일의 `?url` 변환 추가
- 프로젝트 설정이나 `.env`를 실행하지 않는 안전한 기본 `import.meta.env` 값 추가
- 매크로별 패턴/파일/조회/깊이와 빌드 전체 참조·조회·watch directory 정적 리소스 한도 추가
- 활성 파일의 runtime default와 모든 PascalCase named export를 소스 순서대로 렌더링하는 갤러리, `export *` 확장, export별 오류 격리와 props override 추가
- 대상 import 전 global namespace와 `.react-preview/setup.*` initialize 실행, Provider와 props 계약 추가
- 정상 Storybook preview decorator/Apollo parameter 자동 재사용과 깨진 setup의 setup-free 재시도 추가
- Storybook setup graph 오류만 폴백하고 누락된 상대 import의 안전한 생성 디렉터리를 계속 감시
- 프로젝트 Apollo Client를 자동 감지해 backend 요청 없는 Provider와 bounded selection-shaped 정적 응답을 제공하고 setup별 operation 결과·cache seed·비활성화 계약 추가
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

- 서버 없이 현재 React 파일과 도달 가능한 import graph를 번들링하는 VS Code 확장 초기 구조 추가
- 저장 전 문서/dependency overlay, JSX/CSS Modules/asset/SVG/query import와 alias 처리 추가
- Workspace Trust, 제한된 local resource root, 네트워크 차단 CSP와 대용량 asset 사전 차단 적용
- stale revision 방지, dependency hot rebuild, artifact queue/lease/cleanup 및 플랫폼별 VSIX 추가
- `newdlops` 배포 메타데이터와 strict TypeScript, 계층 lint, formatter, 1,000줄 및 통합 테스트 구성
