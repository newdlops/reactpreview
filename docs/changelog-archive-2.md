# 변경 기록 보관 2

[첫 보관 문서](changelog-archive.md)가 1,000줄 제한에 닿아, 그 뒤에 이어지는 오래된 변경 기록을 이 문서에
보관합니다. 새로 옮기는 기록은 맨 위에 추가하고, 더 오래된 기록은 첫 보관 문서에 있습니다.

## 0.1.1154 - 2026-07-24

- foreground `prepare`가 같은 profile의 선택적 background package admission을 기다리던 경로를 제거해,
  atomic commit이 끝난 layer만 다음 빌드에서 사용하고 현재 프리뷰는 프로젝트 설치로 즉시 계속 진행
- 수천 개 esbuild 입력을 filesystem 조회 전에 package root로 축약하고 검증 동시성을 16개로 제한하며,
  여러 탭의 cache copy를 직렬화하고 이미 저장된 package slot은 증분 admission에서 제외
- legacy 중복 full-graph layer를 시작 시 읽지 않는 `dependency-store/v4`로 전환하고 첫 compiler milestone을
  profile 탐색 전에 게시해 worker 시작과 실제 정체 단계를 구분
- 보고된 3,019-dependency 대상에서 cold fast 화면 번들 6.8초, cache admission 중 즉시 재빌드 3.1초,
  진단 0건을 확인하고 pending admission 비대기·package slot 중복 억제 회귀 테스트 추가

## 0.1.1153 - 2026-07-24

- hook이 제공한 함수를 호출한 뒤 배열·객체 구조 분해하는 구문을 함수 존재 요구로만 축약하지 않고,
  호출 결과의 최소 정적 shape까지 재귀 추론해 `checkPagePermission()` 같은 tuple 계약을 보존
- Boolean 조기-return guard는 프로젝트 이름이 아니라 실제 제어 흐름을 분석해 페이지 본문으로 계속되는 값을
  선택하고, 일반 객체 payload의 `if (!data) return`은 Boolean으로 오인하지 않도록 타입 증거를 제한
- 반환값이 있는 생성 함수를 global Symbol data descriptor로 표시해 Auto/Smart Fill JSON 왕복 뒤에도 단순
  no-op으로 퇴화하지 않게 하고, destructured 함수와 direct hook method 양쪽 회귀 테스트 추가

## 0.1.1152 - 2026-07-24

- fast Page Inspector 전체에 적용되던 단일 45초 watchdog을 단계별 inactivity budget으로 바꿔, 실제
  `bundling-modules` 진입 시 최대 120초를 새로 부여하고 전체 active request는 180초로 제한
- full page bundling도 240초·전체 360초의 유한 상한을 사용하며 component-only preview와 명시적 host
  override는 기존의 더 작은 고정 budget을 유지
- 서로 다른 compiler milestone만 budget을 갱신해 같은 progress 반복으로 무한 연장되지 않게 하고,
  worker V8 512 MiB·esbuild Go 384 MiB 메모리 격리와 cancellation 재시작 경계는 그대로 보존
- 보고된 `investment-agreement-management-grid.tsx` fast graph를 3,017개 의존성, 약 9.7초, 진단 0건으로 검증

## 0.1.1151 - 2026-07-24

- 공용 component와 hook/HOC/factory 모듈을 첫 번째 caller page에만 귀속시키지 않고, 정적으로 증명된 모든
  exported consumer와 authored page를 독립적인 `PAGE PATH x/n` VirtualPage 후보로 보존
- 각 후보가 자신의 promoted target, module import context와 안정적인 identity를 소유하게 해 페이지를
  전환해도 첫 후보의 hook context나 target reachability가 섞이지 않도록 수정
- fast corridor는 캐시된 path inventory에서 target 근접 page 후보를 먼저 고른 뒤 실제 import edge만
  검증하고, entry 연결 경로와 부분 consumer 경로를 함께 유지해 전체 source 본문을 읽지 않고 다중 사용처 탐색
- 실제 공용 HOC의 서로 다른 두 page 조합을 2,971개 의존성, 약 7.2초, build 진단 0건으로 검증하고 direct
  component 및 HOC 다중 page 선택·후보별 context 격리 회귀 테스트 추가

## 0.1.1150 - 2026-07-24

- VirtualPage의 작성된 ancestor/component 홉 제한을 제거하고 exact module/export identity와 순환 검출로
  DFS를 종료해 깊은 header, navigation, page body, overlay까지 실제 컴포넌트로 전이 구성
- 혼합 component/hook 모듈은 hook export만 정적값 경계로 남기고 component export는 로컬 오류 경계 안에서
  실제 구현을 유지해 한 하위 가지의 런타임 오류가 완성된 페이지 전체를 지우지 않도록 변경
- 자식 component prop의 외부 TypeScript 타입을 import/re-export 경로로 순환 안전하게 펼쳐 중첩 배열 필드를
  부모 hook payload에 역전파하고, 작성된 equality literal과 RegExp 같은 안전한 native 값을 Smart Fill이 보존
- fast overlay 최적화가 현재 선택 파일을 placeholder로 치환하지 않도록 보장해 닫힌 모달도 실제 페이지에서
  자동 visibility 조건과 함께 렌더링하며, 2,938개 의존성 실페이지를 약 6.5초·격리 오류 0건으로 검증

## 0.1.1149 - 2026-07-24

- 애플리케이션 root를 그대로 실행하던 fast Page Inspector를 `VirtualPage` 생성 파이프라인으로 전환해,
  동일한 정적 render path의 구체적인 Page 체크포인트를 본문으로 선택하고 생략된 App 경로를 recipe로 보존
- Next App/Pages의 작성된 layout 조합은 유지하면서 일반 Router 앱은 정적으로 증명된 layout/shell만
  본문 주변에 합성해 인증 bootstrap, 전체 route catalog와 무관한 백엔드 초기화를 첫 렌더에서 제외
- VirtualPage shell의 조기 반환문은 정확한 source와 계속 진행 branch가 증명된 경우 즉시 통과시키고,
  데이터 의존적인 navigation/sidebar는 읽을 수 있는 반응형 와이어프레임으로 투영해 전체 shell 실패를 방지
- fast 경로에서도 project hook alias와 downstream property 요구를 추적해 GraphQL/Redux/layout 값의 최소
  구조를 생성하고, 실제 대형 모노레포의 header·sidebar·footer·page body를 약 4.1초, 진단·브라우저 예외 0건으로 검증

## 0.1.1148 - 2026-07-24

- fast 패키지 barrel 최적화가 esbuild `onResolve` 안에서 같은 package root를 재해석하던 교착 경로를
  제거하고, 기존 정적 resolver가 runtime/source entry를 증명하지 못하면 기본 번들링으로 즉시 복귀
- JSX component prop 분석에서 lowercase helper와 ALL_CAPS query/상수를 시각 React branch로 오인하지
  않아 페이지 경로와 패키지 수요가 실행 데이터 때문에 확장되지 않도록 제한
- 실제 격리 워커에서 보고된 modal과 manager settings page를 각각 약 8.6초, 0개 진단으로 재검증

## 0.1.1147 - 2026-07-23

- fast 페이지 경로에서 정적으로 복구 가능한 프로젝트 hook을 호출부의 최소값으로 대체하고,
  비활성 route fallback은 페이지의 1-depth 형제로 다시 묶지 않아 번들 그래프 재확장을 방지
- `styled(Component)` selector는 원래 레이아웃 CSS와 host 위치를 유지하는 얕은 컴포넌트로 투영하고,
  대형 package barrel은 실제 named export leaf만 읽어 512 MiB 격리 워커의 메모리·시간 사용량을 제한
- 보고된 `rtcc-manager-settings-page.tsx`를 실제 격리 워커에서 45초 중단 없이 약 9.9초,
  0개 진단으로 컴파일하는 회귀 검증을 추가

## 0.1.1146 - 2026-07-23

- `styled(callback)`·HOC 내부의 런타임 값은 보존하고 실제 JSX 자식만 1-depth projection
- 정적 경로와 흔한 `default` export는 원본 소스가 일치할 때만 실제 mount로 판정해 target 진단을 일관되게 표시

## 0.1.1145 - 2026-07-23

- fast 1-depth 페이지 보강이 같은 기능 폴더의 demo/example 소비자를 실제 제품 페이지 후보로 다시
  승격하지 않도록 보조 소스 판별을 App-to-target 탐색과 통일
- 선택 경로 밖의 `React.lazy` component-prop 라우트 선택지는 shallow 문맥으로 재활성화하지 않고,
  실제 lazy sibling/wrapper는 유지해 페이지 레이아웃과 첫 번들 범위를 함께 보존
- 보고된 대형 AG Grid 대상에서 실제 page→panel 경로를 선택하고 fast 전체 컴파일을 약 8.5초에 완료

## 0.1.1144 - 2026-07-23

- fast App-to-target 탐색에 import/re-export export demand를 유지해 한 barrel의 다른 page export나
  config/demo 소비자를 실제 대상 경로로 오인하지 않고 JSX·lazy·HOC render 경로를 우선
- default-exported HOC가 private page를 감싼 경우 제한된 component value-flow를 역추적해 render-prop
  helper 대신 실제 page와 application root를 마운트 후보로 승격
- route factory의 lowercase path/map helper를 shallow React placeholder에서 제외해 문자열·객체 계약과
  Router 초기화를 보존하면서 component-shaped route element만 1-depth 시각 문맥으로 유지
- 페이지 로드 로그에 선택·탈락 후보, stop reason, route/root와 정적 application path를 함께 기록하고,
  실제 commit 뒤에는 authored path, observed Fiber path, 누락 shell, mount/output 집계와 blocker 소유 경로를
  최대 20행 component tree로 별도 기록
- 페이지 상태 로그 앞에 사람이 바로 읽을 수 있는 요약을 추가하고 preview에서 격리한 반복 effect 경고도
  host protocol로 전달해 구조화 JSON을 직접 대조하지 않고도 실패 단계를 파악하도록 개선

## 0.1.1143 - 2026-07-23

- 최단 App-to-target 경로의 각 JSX 반환 단계에서 같은 렌더 결과에 놓인 header, sidebar,
  wrapper와 component prop을 직접 시각 문맥으로 수집
- 경로를 운반하는 Provider/HOC와 현재 파일의 자식은 원래 렌더링을 유지하고, 생략된 형제 루트의 다음
  프로젝트 컴포넌트 경계만 구조 placeholder로 제한해 실제 1-depth 페이지 뼈대를 빠르게 구성
- 정적 import, `React.lazy`, named lazy projection, `memo`, styled/HOC와 component/render/as prop을
  동일한 얕은 문맥 증거로 처리하며 비활성 route와 다른 export/조건 결과는 제외
- 단계별 round-robin 예약과 잘림 신호를 추가하고 실제 bundle에서 shell/target은 포함하되 deep child,
  unused component와 49개 비활성 route가 제외되는 회귀 테스트를 추가

## 0.1.1142 - 2026-07-23

- fast Page Inspector가 bounded entry-to-target corridor와 정적 route projection으로 App, Router,
  layout, header, sidebar를 보존하면서 실제 대형 모노레포 페이지를 약 5.9초에 번들링
- 선택 경로의 `<Navigate>`/`<Redirect>` 조기 반환만 첫 렌더에서 동기적으로 통과해 Router가 대상
  페이지를 떠나기 전에 현재 파일을 authored page 본문 안에 마운트
- 잘린 corridor나 불완전한 runtime-global 증거는 빠른 앱 셸을 먼저 유지한 채 `partial`로 전달해
  백그라운드 전체 문맥 보강을 생략하지 않도록 수정
- 실제 `rtcc-poc-page`에서 헤더·사이드바·투자계약서 업로드 본문과 작성된 스타일을 함께 렌더링하고
  3,203개 의존성, 0개 진단·브라우저 예외로 검증

## 0.1.1141 - 2026-07-23

- JSX를 직접 export하지 않는 HOC/factory 파일의 실제 소비 페이지를 선택할 때 폐기되는 callable 구간의
  source evidence를 승격된 page step에 보존해 연속 권한·모드 가드를 현재 파일 경로로 인식
- 불완전한 `index`/lazy barrel보다 구체적인 완성 page 후보를 먼저 렌더링해 대형 registry 보강과 흰 화면을 방지
- Fiber에서 관찰한 `Navigate` 같은 runtime-only fallback 이름을 분기 목적지 근거로 사용하지 않아
  Owner 권한 → Staff 모드처럼 중첩된 HOC 가드를 순서대로 통과
- 효과 없는 자동 분기는 롤백·세션 제외해 반복 루프를 막고, 실제 `rtcc-poc-page`의 페이지·모달·HOC 소비
  페이지를 각각 7–14초에 빌드해 작성된 스타일과 가시 host output을 검증

## 0.1.1140 - 2026-07-23

- React effect 반복 보호를 1초 누적 횟수가 아닌 한 browser frame 안의 동기 폭주로 판별해
  `requestAnimationFrame`·상태 갱신 기반 60/120fps 애니메이션은 계속 재생하면서 무한 update loop는 격리
- 생성 소스가 없는 `Spinner`/`Skeleton` placeholder에 project animation token 우선, namespaced
  `infinite` keyframe fallback을 적용하고 작성된 1회 애니메이션·`animation: none`은 그대로 보존
- 실제 Tailwind `animate-spin`과 독립 generated Skeleton을 Chromium timing으로 검증하고 frame 반복,
  timer fallback, 동기 폭주, hot revision 및 authored override 회귀 테스트를 추가

## 0.1.1139 - 2026-07-23

- 직접 선택한 `examples`/`demo` 파일을 target-affinity lazy registry와 Next App Router page에 제한적으로 역연결하고 파일 경로로 동적 route parameter를 복원해 root layout·전역 CSS 안에서 현재 컴포넌트를 렌더링
- CSS `style` 조건만 노출하는 `tw-animate-css`류 package export를 정적 manifest로 해석하고 현재 파일·하위 import의 Tailwind 후보를 우선 보존해 대형 page shell에서도 뒤쪽 utility가 8,192개 한도에 잘리지 않도록 수정
- 체크아웃에 generated UI source가 없으면 Button, Card, field, overlay, Accordion과 table 역할에 system-color 기반 최소 의미 스타일을 적용하되 작성된 inline style과 `asChild` 자식 스타일을 우선
- 실제 `apps/v4/examples` 표본을 약 3.7~4.9초의 complete page context와 84 KiB CSS로 복구하고 대형 lazy registry 탐색은 24/96 import·128 route-directory 상한 안에 유지

## 0.1.1138 - 2026-07-23

- Yarn PnP의 React-only workspace package는 동일 React 범위를 가진 application issuer에서 `react-dom` companion을 엄격히 복구하고, Next Pages fast preview는 최초 artifact부터 `_app`과 route parameter 경로를 결합
- browser에서 도달한 `fs`/`fs/promises` 서버 helper에 host I/O를 노출하지 않는 빈 text/byte API를 제공해 Next App registry의 `replace` runtime crash를 방지
- 값 없는 Promise rejection은 정상 mount를 깨지 않는 warning으로 격리하고, React children item은 scalar로 생성하며 hook 값이 자식 props로 전달되면 `data.data.rides.map()` 같은 제한된 후속 shape도 역전파
- fast Page Inspector는 test/story entry를 제외하고 8개 초과 dormant lazy 선택지와 48개 초과 eager React Router registry를 page-local 경로 아래로 잘라 실제 97MB·64초 graph를 6.5MB·약 2.6초로 축소

## 0.1.1137 - 2026-07-23

- direct React export가 없는 JSX hook·factory를 빠른 준비 단계에서도 bounded reverse-consumer 경로로 추적해 실제 소비 컴포넌트와 page root를 렌더링하고 GraphQL document export는 대상에서 제외
- fast first paint는 최상위 page candidate 하나만 번들링하고 대체 App/route registry는 full 보강으로 지연해 실제 `document-version-viewer.tsx`의 45초 watchdog 중단을 동일 격리 제한에서 약 3.6초 빌드로 단축
- 생략한 후보가 있으면 context를 `partial`로 유지하고 fast 자동 후보는 full의 더 강한 application root로 승격하되 사용자가 직접 선택한 page candidate는 보강과 hot reload 뒤에도 보존

## 0.1.1136 - 2026-07-23

- generic React Page Inspector에서 의미 있는 ReactDOM 진입점의 forward BFS와 현재 파일 인접 owner의 bounded reverse 탐색을 만나게 해 전체 package inventory 없이 App에서 선택 export까지의 최단 import corridor를 구성
- 확정된 page root에서 JSX 중심 DFS로 layout, header, sidebar와 page sibling을 추가해 현재 파일만 고립해서 보여주지 않고 실제 application shell 안에서 렌더링
- page/layout 또는 semantic entry corridor가 완성된 fast artifact를 `complete`로 전달해 화면 표시 직후 동일 graph의 full enrichment와 스타일 재탐색을 반복하지 않도록 수정
- Tailwind v4의 package-wide `@source` 탐색을 증명된 page corridor의 Oxide 후보로 제한해 작성된 theme/CSS는 유지하면서 실제 대형 Next 페이지의 첫 빌드를 약 5.1초로 단축

## 0.1.1135 - 2026-07-23

- fast Page Inspector의 generated lazy registry를 누락 소스 복구보다 먼저 단일 corridor 모듈로 합치고 importer별 import/export 수요를 AST 1회로 색인해 실제 3,758개 분기 Next 페이지를 45초 중단에서 약 5.6초 페이지 번들로 단축
- `generateStaticParams`의 imported collection, awaited dynamic import, 중첩 `for...of`/`for...in`, computed lookup과 literal `includes` guard를 bounded하게 따라 `/view/new-york-v4/dashboard-01` 같은 실제 첫 경로를 루트 layout과 함께 렌더링
- 선택 target facade를 corridor보다 우선하고 `index` target은 부모 디렉터리 stem만 보존하며 읽기 실패는 pruning 증거로 쓰지 않아 2,048개 registry 성능 경계에서도 현재 파일·레이아웃·정확한 lazy child를 유지

## 0.1.1134 - 2026-07-23

- 최초 fast 빌드에서 graph-wide 대형 package barrel projection을 생략하고 full 보강에서만 정확한 leaf projection을 유지해 일반 대형 React 페이지가 `bundling-modules` watchdog에 걸리던 회귀를 제거
- 대형 barrel 리졸버를 authored workspace importer로 한정하고 importer별 AST inventory·동일 resolve/evidence Promise를 공유해 dependency-to-dependency import와 중복 선언의 TypeScript 재분석을 차단
- fast 의존성은 비호환 resource/framework 문법만 정밀 변환하고 정적으로 닫힌 overlay는 동적 import 없는 임시 marker로 분리해 첫 화면 그래프와 메모리를 줄이되 full 페이지 컨텍스트에서 원본 컴포넌트를 복원

## 0.1.1133 - 2026-07-23

- foreground·context-enrichment 빌드를 분리하고 미시작 요청을 새 워커에서 재생해 탭 간 OOM·watchdog·취소 오류 전파와 반복 보강 루프를 차단
- Next App Router를 증거 기반 bounded corridor와 후속 full 탐색으로 구성하고 layout segment·async root·병렬 slot 계약·navigation/link facade를 보강
- 훅·JSX factory의 실제 앱 소비 경로, 안전한 dormant overlay 지연 로딩, 기본값 존중 props 추론과 문서 revision 기반 경량 재시도 식별자를 추가

## 0.1.1132 - 2026-07-23

- Next App `page/layout/template`과 이를 소비하는 helper·MDX 모듈은 최초 fast 빌드부터 단일 page corridor를 구성해 수천 개 generated registry 분기를 esbuild가 분석하기 전에 제외
- 추론한 `pathname`·`params`·`searchParams`를 page/layout과 `next/navigation(.js)` 정적 facade에 함께 공급해 Nuqs/App Router context invariant와 runtime props의 `undefined` 덮어쓰기를 차단
- 확장자 없는 동적 template import를 실제 `.tsx/.ts/.jsx/.js` 및 directory index 파일에 유한 매핑해 `./__lucide__` 같은 프로젝트 bundler 해석을 브라우저 프리뷰에서도 재현
- layout의 동일 깊이 하위 page는 최대 16개만 읽고 source 크기·runtime import·generated registry fan-out 비용을 비교해 더 가벼운 실제 페이지를 우선 선택하며 page-context health log에 pathname과 context 적용 여부를 분리

## 0.1.1131 - 2026-07-22

- Next App Router의 component export뿐 아니라 helper, provider, registry, default object가 실제로 도달하는 `page.tsx`와 암시적 layout 체인을 정적 import로 역연결해 `app` 소스를 페이지 단위로 프리뷰
- package-local 탐색 실패 시에만 bounded monorepo inventory로 넓히고, 정적 import를 deferred loader보다 우선하며 전체 32 MiB/2,048 module 상한과 target-affinity pruning으로 대형 generated registry의 CPU·메모리 폭증을 차단
- `loading.tsx`·`error.tsx`·`not-found.tsx`를 소유 route의 layout 안에서 렌더링하고 parallel/private route 오탐, nested `app` segment, type-only/unused/shadowed import, unresolved broad alias branch를 보강

## 0.1.1130 - 2026-07-22

- direct default/PascalCase export가 없는 helper·registry 파일은 빈 갤러리를 표시하되 대상 모듈, theme, 수천 개 lazy branch를 side-effect import하지 않고 package/workspace ancestor 분석도 생략해 `mdx-components.tsx`의 불필요한 3,758개 registry 번들을 차단
- workspace source 읽기·TypeScript AST 변환과 MDX metadata/body 처리를 공용 FIFO gate에서 최대 4개로 제한해 esbuild의 동시 callback이 전체 source text와 AST를 한꺼번에 보유하지 않도록 보강
- native esbuild context 보존량을 12개에서 최근 2개로 낮춰 여러 탭의 hot reload는 유지하면서 parsed graph, Tailwind processor, MDX cache가 시스템 메모리에 누적되는 상한을 축소

## 0.1.1129 - 2026-07-22

- `bundling-modules`에서 멈춘 직렬 compiler worker에 fast/full hard deadline과 cancel/shutdown acknowledgement deadline, 8개 queue 상한을 적용하고 중독된 worker가 완전히 종료된 뒤에만 다음 worker를 시작하도록 수정
- worker V8 heap을 512 MiB, esbuild Go heap을 384 MiB와 4 scheduler로 강제 제한하고 resource stall은 같은 그래프의 full fallback으로 재실행하지 않으며, 30초간 사용하지 않은 native graph worker를 회수해 메모리 폭증과 idle RSS가 시스템 전체로 번지는 경로를 차단
- 모든 프리뷰를 첫 시도부터 coalesced output으로 빌드하고 제외된 lazy route를 단일 placeholder로 합치며, parse 실패는 fail-closed하고 Next route parameter와 일치하는 대형 registry branch 하나와 이를 여는 작은 helper import만 실제로 보존
- 같은 package의 Tailwind processor를 직렬화하고 context 없는 v4 `@apply` leaf의 확정 실패를 건너뛰어 sibling stylesheet의 동시 graph allocation과 중복 오류를 줄임

## 0.1.1128 - 2026-07-22

- 현재 Next App Router page JSX가 실제로 사용하는 `next/dynamic` named component는 page corridor에서 보존하고, 라우트 registry에만 있는 lazy branch는 계속 제외해 `ForwardRef(LoadableComponent)` object render 오류를 차단
- `useRouter().replace()`와 string `replace`/`endsWith`의 receiver를 구분해 Smart Fill이 router API를 문자열로 바꾸지 않게 하고, 실제 string receiver는 key 길이의 작은 값으로 생성
- generated UI placeholder의 `PreviewGenerated(Component)` 이름을 실제 target Fiber로 정규화해 authored JSX가 렌더되었음에도 absent로 판정하는 오탐을 제거
- 미빌드 workspace package의 CSS export를 Tailwind processor에서도 source fallback으로 해석하고, fail-soft CSS의 `@reference`/`@import` prelude를 안전하게 정렬해 작성된 스타일을 최대한 보존

## 0.1.1127 - 2026-07-22

- Next App Router의 multiple root layout, `template`, route group, private folder, 중첩 일반 `app` 세그먼트와 catch-all 배열을 실제 page 단위로 분석하고 상위 layout의 `generateStaticParams`까지 병합
- Pages Router `_app`에 여러 실제 leaf를 bounded lazy 후보로 연결하고 개발용 route를 후순위로 두며, 기본 HOC export를 통과해 공유 모노레포 컴포넌트도 소비 application page까지 역추적
- Yarn/npm workspace manifest를 실행 없이 해석하고 Inspector page package에서 PnP peer를 복원해 `.pnp.cjs` 실행이나 프로젝트 `node_modules` 설치 없이 sibling application을 번들링
- 런타임 page-context 로그에 root/page/layout 근거 경로를 추가하고 컴포넌트 트리의 접기·펼치기 화살표와 클릭 영역을 확대해 작은 화면에서도 상태를 명확히 표시

## 0.1.1126 - 2026-07-22

- Next App Router의 암시적 `layout -> children page` 파일시스템 경계를 복원해 layout 또는 그 helper를 선택해도 route group을 제외한 실제 하위 page와 상위 layout chain을 함께 렌더링
- `generateStaticParams`의 local/import/re-export/조건부 spread 배열을 실행 없이 bounded하게 따라 동적 route의 유효한 첫 parameter 조합을 복원하고 관련 source를 hot-reload dependency로 추적
- App Router page 후보를 단독 layout보다 우선하며 선택 파일이 layout이면 target facade를 유지하고, `server-only` marker를 정적 effectful facade로 바꿔 브라우저 throw와 무의미한 tree-shaking 경고를 방지

## 0.1.1125 - 2026-07-22

- Next Pages `_app`이 합성 자기 참조 대신 증명된 실제 leaf page를 한 번만 감싸고, 정적 registry가 허용하는 dynamic route parameter를 복원해 작성된 app shell과 페이지를 함께 렌더링
- direct React 선언과 lock 증거가 있을 때 호환 `react-dom` companion을 전역 dependency layer에 포함하고, Next image/font의 정적 facade와 cache 갱신으로 설치 없는 프로젝트의 framework import를 안정화
- string receiver·이미지 source·시간값·Nuqs authored default를 사용 지점에서 추론하고 빈 `{}` 자동 해결 반복을 중단해 Smart Fill의 잘못된 함수값과 무한 remount를 방지
- 중첩 async React component를 안정된 Suspense record로 격리해 서버 데이터가 늦거나 실패해도 작성된 페이지 전체가 반복 실행되지 않고 해당 경계만 정적 marker로 대체
- Next layout의 `html/head/body` singleton을 preview host로 정규화하고 동일 스크롤 좌표 이벤트를 생략하며, generated UI의 닫힌 overlay·불안정 hook·무한 contract proxy를 bounded fallback으로 바꿔 대형 페이지의 renderer CPU 고정을 방지

## 0.1.1124 - 2026-07-22

- Next App Router `app/**/layout.*`의 화면 밖 `metadata` 초기화를 격리해 배포 환경 URL이 없어도 실제 RootLayout과 현재 React 파일이 먼저 렌더링되도록 수정
- 프로젝트 루트의 공개 dotenv key만 bounded하게 읽어 `process.env`와 Vite `import.meta.env`에 공급하고, 누락된 공개 URL은 소유·열거 상태를 바꾸지 않는 비통신 `.invalid` 값으로 보완하며 hot reload 갱신과 비밀 key 차단을 검증

## 0.1.1123 - 2026-07-22

- target import, nearest manifest와 정확한 `jsxImportSource`를 함께 확인해 SolidJS/Lit 전용 파일을 React page 분석·의존성 획득 전에 구조화된 호환성 진단으로 중단하고 React+Solid 혼합 파일과 Preact/custom JSX는 보존
- 최초 빌드와 full-context 보강 실패 모두 소스 위치, 원인 메시지와 resolver note를 `React Preview` 출력에 남겨 `log.txt`만으로도 실제 첫 실패와 잘못된 설치 시도를 구분

## 0.1.1122 - 2026-07-22

- classic JSX의 암묵적 `React` namespace를 증거 기반 import로 복원하고 lock 없는 exact React 19 manifest에는 확장의 같은 major 최신 runtime을 사용해 `node_modules` 없는 React 18/19 샘플을 프리뷰
- export 없는 `createRoot`/`hydrateRoot`/legacy render entry를 안전한 합성 export로 전환하고 runtime global 오류가 Smart Fill payload blocker로 오인되지 않도록 진단 분류를 수정
- MDX collection query를 bounded metadata-first 모듈로 바꾸고 누락된 generated alias UI·미빌드 workspace package JS/CSS export를 문서·manifest·symlink 경계 증거가 있을 때만 복구
- 대형 side-effect-free package barrel을 증명된 named deep import로 축소하고 설치 없는 Next image/font/link 및 Tailwind root import를 정적 render-only fallback으로 처리

## 0.1.1121 - 2026-07-22

- named React runtime import만 있는 소스를 classic JSX로 낮출 때 정확한 `react` import·JSX·비어 있는 `React` runtime binding을 함께 증명해 lexical namespace fallback을 추가하고 custom JSX runtime과 작성된 binding은 보존
- `node_modules` 없는 React 18 webpack fixture를 Storybook 초기화 전후로 번들링해 모든 `createElement` receiver가 선언되고 프로젝트 installation은 생성되지 않는 것을 검증

## 0.1.1120 - 2026-07-22

- 확장에 React/ReactDOM/Scheduler 18.3.1/18.3.1/0.23.2와 기존 19.2.7/19.2.7/0.27.0 exact tuple을 함께 둔 versioned seed catalog를 추가해 호환 manifest만 있는 React 18 프로젝트도 `node_modules` 없이 프리뷰
- project-local React를 최우선, lock-proven managed runtime을 그다음, manifest range-compatible extension seed를 마지막으로 선택하고 extension package byte digest까지 seed identity에 묶어 React singleton과 재사용 안전성을 유지
- seed는 VSIX에 포함된 검증 byte만 global storage의 ordinary `node_modules` layout으로 복사하며 workspace를 수정하거나 lock evidence 없는 임의 package를 network에서 획득하지 않도록 경계와 manifest 회귀 테스트를 보강

## 0.1.1119 - 2026-07-21

- 프로젝트 `node_modules`가 없어 bare package 해석이 실패하면 npm `package-lock.json` v2/v3와 Yarn v1/Berry lock에서 선언된 exact public npm dependency closure만 찾아 VS Code global storage의 ordinary `node_modules` immutable layer로 복원
- npm/Yarn v1은 lock의 SHA-512 tarball integrity를, Berry는 exact `npm:` resolution과 registry exact-version metadata의 SHA-512를 검증하며 package manager·script를 실행하거나 workspace cache/install을 수정하지 않도록 추가
- project-local/PnP와 이미 검증된 layer를 계속 우선하고 새 environment로 전체 compile을 정확히 한 번만 재시도하며, pnpm·private/custom registry·git/file/link/workspace package와 integrity 없는 근거는 원래 resolve 오류를 유지하도록 fail closed
- Yarn lock에 peer edge가 없어도 앱의 direct runtime·optional·peer 선언을 함께 계획하고, 같은 requirement가 새 environment를 만들지 못하면 후속 hot reload에서 재다운로드·재빌드하지 않도록 보강
- 모든 archive를 추출 전에 closure 공용 40,000-entry/256-MiB payload와 gzip 절대 상한으로 검사하고, lockfile layer가 충돌하는 locally reached bytes에 가려지지 않도록 전역 layer 선택을 강화

## 0.1.1118 - 2026-07-21

- 성공한 browser bundle에 실제 도달한 public `node_modules` package를 nearest lock·dependency map·플랫폼별 content-hashed immutable layer로 전역 저장하고, 동일 profile의 다른 workspace가 설치 없이 local-first fallback으로 재사용하도록 추가
- 후속 target의 새 package를 같은 profile의 별도 layer로 누적하고 React/ReactDOM/scheduler 19는 compatible·project-local runtime 부재 시만 선택하며, managed React subpath/peer를 active issuer로 재해석해 singleton을 유지
- symlink·private/virtual package·민감 설정·실행 shim·oversized tree를 제외하고 package SHA-256 재검증, cross-window heartbeat lock, atomic commit, bounded LRU와 회귀 테스트를 추가

## 0.1.1117 - 2026-07-21

- 실제 esbuild 입력 그래프에 도달한 `node_modules`의 non-strict CommonJS만 검사하고 선언 없는 assignment-only 식별자를 원래 sloppy browser semantics인 `globalThis` 쓰기로 복원해 `md5-jkmyers` 같은 레거시 UMD self-test가 React mount를 중단하지 않도록 수정
- minified dependency 우선·파일/바이트/식별자 상한과 hot-build 계획 캐시를 적용하고, authored source·strict module·선언된 변수·read-only free global은 자동 보정에서 제외

## 0.1.1116 - 2026-07-21

- 성공한 esbuild 메타그래프에서 Yarn PnP 가상 경로를 실제 소스로 복원하고 `createPortal` 구현이 증명한 host ID를 엔트리 import 전에 생성해 Next `_app`의 spinner·popup·toast 전역 UI가 중단되지 않도록 수정
- 포털 host 계획을 target별 hot-build 캐시에 보존하고 실제 portal 구현과 같은 모듈의 ID만 허용해 warm rebuild를 유지하면서 일반 form element ID 오탐을 차단
- transitive dependency가 자유 전역 `Buffer`를 읽으면 설치된 `buffer` 패키지의 named export를 browser inject로 연결하고, 사용하지 않는 프로젝트에서는 polyfill 코드가 tree-shake되도록 보강
