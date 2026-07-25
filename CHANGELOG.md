# 변경 기록

이 프로젝트는 사용자에게 영향을 주는 변경을 이 문서에 기록합니다.

## 0.1.1190 - 2026-07-25

- `App.tsx`처럼 수백 경로를 소유한 파일은 모든 경로를 컴포넌트 모듈 없이 메타데이터로 색인하고, 공통 경로
  폴더·breadcrumb·검색 UI에서 선택한 한 가지 branch만 재분석·번들링하도록 변경
- `RouterProvider`가 다른 파일의 router 또는 route descriptor 배열만 감싸는 중간 모듈을 재귀적으로 따라가,
  실제 leaf 페이지가 나올 때까지 경로를 합성하고 선택되지 않은 형제 페이지는 읽거나 번들 corridor에 포함하지 않음
- route 선택 메시지를 현재 runtime revision과 정적 component/path chain으로 검증하고 pinned 탭별 선택을 보존하며,
  320개 경로·중첩 RouterProvider·import된 route 배열·형제 모듈 미로딩 회귀 테스트 추가

## 0.1.1189 - 2026-07-25

- `Provider > Suspense > Routes > {pageRoutes}`처럼 화면을 직접 만들지 않는 상위 route-factory export를
  빈 컴포넌트로 처리하지 않고, page map·submodule 인자와 route catalog를 연결해 실제 자식 페이지 경로 선택지를 생성
- 선택한 페이지마다 정확한 pathname으로 MemoryRouter를 다시 구성하고 해당 page module만 빠른 번들 corridor에
  보존해, 대형 eager route registry를 모두 묶지 않으면서도 경로 선택 시 실제 화면이 나타나도록 개선
- Page path 선택기에 자식 컴포넌트명을 표시하고, 선택한 route가 비어 있을 때 props 부족으로 오인하지 않도록
  다른 경로 선택 또는 해당 자식의 첫 조건 확인을 안내하며 named/default factory export 회귀 테스트 추가

## 0.1.1188 - 2026-07-25

- 같은 파일의 상수로 선언한 base path를 route factory 인자까지 안전하게 추적하고, factory 결과를 소유한
  module/HOC를 페이지 후보로 승격해 중첩 route의 실제 pathname과 application shell을 복구
- hook 값이 로컬 helper의 switch·비교·문자열 union·Boolean 분기를 통과하는 호출 흐름을 제한된 깊이로 분석해,
  빈 객체 대신 현재 JSX 경로에 도달하는 최소 scalar 조합을 자동 생성
- error/loading fallback이나 인접 후보 DOM을 현재 파일의 출력으로 오인하지 않도록 정확한 React Fiber 소유권을
  확인하고, 원래 runtime error와 blocker owner를 Inspector 및 진단 로그에 유지
- 동일한 context enrichment가 memory/watchdog stall 뒤 반복 실행되지 않도록 resource identity별 지수 backoff를
  추가하고, 대상 또는 의존성 변경 시에는 즉시 새 분석을 허용

## 0.1.1187 - 2026-07-25

- Inspector controls를 위로 줄인 뒤 다른 영역의 현재 높이가 controls의 새 상한으로 고정되어 다시 아래로
  늘릴 수 없던 clamp를 수정하고, 인접 영역의 최소 가시 높이만 예약해 양방향 재조절을 보장
- renderer와 별도 Inspector 탭에 축소 후 재확장 회귀 테스트 추가

## 0.1.1186 - 2026-07-25

- accordion 헤더에서 resize 동작을 분리해 `헤더 → 콘텐츠 → 하단 핸들` 순서로 배치하고, Inspector controls,
  Page context 및 component tree 영역을 각 영역의 실제 아래 경계에서 넓히거나 줄일 수 있도록 수정
- renderer와 별도 Inspector 탭 모두 9px 하단 separator, 접기 전용 헤더, 키보드 조절·초기화·scroll 보존을 공유

## 0.1.1185 - 2026-07-25

- Page context의 배지·경로·상태·보기·페이지 선택기를 각각 독립적인 intrinsic row로 고정해, 좁거나 높이를
  줄인 Inspector에서도 항목이 같은 grid row에 겹치지 않고 영역 내부에서 스크롤되도록 수정

## 0.1.1184 - 2026-07-25

- `Inspector controls`와 `Page context` accordion 제목이 자신이 제어하는 내용 아래에 놓여 다음 구역의
  제목처럼 보이고 좁은 Inspector에서 문맥 정보가 겹치던 grid 순서를 `제목 → 내용`으로 교정
- renderer와 별도 Inspector 탭의 5행 grid를 같은 순서로 맞추고 접기·높이 복원·작은 화면 workbench 최소
  높이 동작을 유지하는 DOM 순서 회귀 테스트 추가

## 0.1.1183 - 2026-07-25

- Inspector control, page context, component tree/선택 상세의 세 가로 경계를 disclosure button과 drag rail이
  결합된 accordion으로 바꿔 각 구역을 독립적으로 접고 펼치면서 높이도 계속 조절할 수 있도록 개선
- 접힌 rail을 drag하거나 키보드로 조절하면 자동으로 펼치고 마지막 확장 높이를 복원하며, 접힘·높이 상태와
  scroll을 preview 및 별도 Inspector 탭에서 독립적으로 보존

## 0.1.1182 - 2026-07-25

- Inspector의 toolbar 아래와 page context 아래에도 전체 폭 높이 조절 핸들을 추가해, 화면에 보이는 세 가로
  경계를 모두 직접 드래그할 수 있도록 확장
- 작은 화면에서 다른 header와 component workbench의 최소 높이를 예약하고, 별도 Inspector 탭의 inert snapshot에도
  같은 키보드·double-click reset·탭별 높이 저장 동작을 연결

## 0.1.1181 - 2026-07-25

- Components 트리와 선택 상세 사이에 세로 분할 핸들을 추가하고, Source·State·Payload·fallback 카드마다
  독립적인 높이 조절 핸들을 제공해 필요한 영역을 직접 넓히거나 줄일 수 있도록 개선
- 드래그 중 React 재렌더 없이 local CSS 높이만 갱신하고, 키보드·double-click reset·최소 높이 clamp를 지원하며
  preview와 별도 Inspector 탭의 크기를 각각 저장해 snapshot 교체와 hot reload 뒤에도 유지

## 0.1.1180 - 2026-07-25

- page catalog와 JSX render callback을 서로 다른 인자로 받는 route factory를 정적으로 연결해, 선택 페이지의
  route 주입·Provider·Layout을 소유한 가장 가까운 실제 App owner를 VirtualPage 셸로 실행
- render-prop 반환 JSX를 일반 component prop으로 평탄화해 `children is not a function`이 발생하고 Header·Bottom
  navigation이 사라지던 문제를 수정하며, 바깥 application bootstrap은 계속 실행하지 않는 회귀 테스트 추가

## 0.1.1179 - 2026-07-25

- route factory·page catalog의 서로 배타적인 페이지 export를 일반 JSX sibling으로 합성하지 않고 각각의
  `PAGE PATH` 후보로 유지해 한 프리뷰 안에 여러 페이지가 `VirtualPage`로 이어지던 문제 수정
- 선택 페이지의 Header·Navigation·PageAction 같은 실제 chrome은 유지하면서 다른 `*Page`/`*Screen`/`*View`
  endpoint만 제외하는 일반화된 합성 규칙과 route-catalog 회귀 테스트 추가
- 합성 루트 하나만 `PagePreview(페이지명)`으로 표시하고 하위 격리 facade는 authored component 이름을 보존해
  컴포넌트 트리에서 페이지 경계와 실제 자식 컴포넌트를 명확하게 구분

## 0.1.1178 - 2026-07-25

- `mounted`, `host output`, `target corridor` 같은 React 내부 진단어를 화면에서 제거하고 현재 파일 상태를
  `Page loaded → File ran → Nothing visible`의 3단계 visibility path와 `NOT VISIBLE` 상태로 설명
- render callback 대기, wrapper/fallback 대체, 현재 branch의 빈 반환을 서로 다른 상태·행동으로 분류해
  가장 가까운 원인을 찾는 버튼과 상세 패널이 동일한 사용자 용어를 사용하도록 개선
- 자동 최소값 탐색, 재시도, 파일 단독 보기와 page-path 이탈 상태의 버튼·트리 badge·문서를 행동 중심 문구로 정리

## 0.1.1177 - 2026-07-25

- fallback shape가 있다는 이유만으로 `useXXX` custom hook 전체를 no-op projection하던 정책을 반환 값 흐름
  분류로 교체해 filter/map/reduce, formatter, 기본값, 조건 분기, view model 조합과 transforming callback을 보존
- 계산을 소유한 hook은 재귀 VirtualPage root로 유지하고 그 내부의 직접 query/store/context/effect pass-through
  leaf만 다음 DFS edge에서 projection해 작성된 JavaScript 로직과 backend 없는 빠른 번들링을 함께 유지
- named alias와 단일 wildcard hook barrel/re-export도 concrete 구현까지 계속 추적하며, derived hook은 남고
  nested backend leaf는 번들에서 제외되는 compiler 회귀 테스트 추가

## 0.1.1176 - 2026-07-25

- VirtualPage가 `useModalActions` 같은 React 로컬 UI controller를 일반 project hook으로 오인해 `show()`/`hide()`를
  no-op으로 만들던 문제를 수정하고, state 값과 action callback의 동일한 closure를 원본 그대로 보존
- React 외 runtime import, effect, query, store, unknown helper가 없고 `useState` setter의 정적 UI action과 반환
  visibility가 함께 증명된 hook만 보존해 API·세션·권한 격리 정책은 유지
- 현재 파일의 modal 조건, 선택 file 설정, 실제 click handler가 하나의 상태 전이로 동작하는 corridor 회귀 테스트와
  network-shaped sibling hook이 계속 projection되는 안전성 테스트 추가

## 0.1.1175 - 2026-07-25

- 조기 `return null`이나 상위 short-circuit 때문에 아직 실행되지 않은 현재 파일의 JSX 조건도 컴파일 시점의
  안정적인 ID와 소스 근거로 등록해 시나리오 ON/OFF 버튼을 첫 렌더부터 조작할 수 있도록 개선
- 중첩 시나리오를 선택하면 정적으로 증명된 상위 조건을 바깥쪽부터 함께 예약하고, 미도달 값은 authored 값과
  혼동하지 않도록 `QUEUED ON/OFF`로 표시한 뒤 실제 실행 시 동일한 수동 override를 적용
- `rows.map(...)`/`flatMap(...)` 콜백의 JSX 반환과 내부 ternary·`&&` 조건을 실행 없이 펼쳐, 빈 collection
  조기 종료 뒤의 아코디언·행 상태·모달 시나리오도 원래 상위 스위치 계통으로 복원하는 회귀 테스트 추가

## 0.1.1174 - 2026-07-25

- generated `companyId` 때문에 JSX mount 조건이 authored true여도 `show: false`와 `file: null`로 숨은 overlay를
  사용자의 명시적 조건 ON 의도와 구분하지 못하던 문제 수정
- overlay mount 스위치의 manual true override를 시각 활성화 요청으로 처리해 outer React element의 기존
  visibility prop과 nullish entity prop을 preview-only 최소값으로 함께 보강
- authored true/manual ON, authored false/forced ON, reset 상태를 분리한 runtime 회귀 테스트 추가

## 0.1.1173 - 2026-07-25

- `onClick={() => onOpen(file)}`이 여러 로컬 컴포넌트의 callback prop을 거쳐 상위 modal action에 도달하는
  경로를 같은 모듈의 lexical binding과 명시적 JSX attribute만으로 bounded 추적
- `setInfoFile(file); modalActions.show()`처럼 선택 데이터 설정 뒤 overlay를 여는 다중 statement handler도
  실제 mounted event closure를 사용자가 명시적으로 활성화할 수 있는 Deferred UI 트리 노드로 연결
- 동일 prop 경로의 여러 사용처가 서로 다른 UI controller로 끝나거나 shadow/mutable/cycle인 경우는 추측하지
  않고 제외하며, 대상 파일 구조와 모호한 다중 call-site를 재현하는 회귀 테스트 추가

## 0.1.1172 - 2026-07-25

- JSX 자식에서 호출되는 immutable zero-argument 로컬 함수를 실제 렌더 경로로 증명하고, 연속된
  `if (...) return <...>` 분기를 ternary와 동등한 정적 결과로 펼쳐 페이지 구성에서 누락하지 않도록 개선
- `paginationControls` 같은 JSX receiver와 `renderMainArea()` 같은 다중 반환 helper를 한 부모 Virtual DOM
  결과로 조합하며, helper 내부 조건도 Components 트리의 ON/OFF 스위치와 정확한 소스 위치로 연결
- async/generator/인자 필요 함수, mutable alias, 실행문·부작용 guard는 계속 fail-closed하는 회귀 테스트 추가

## 0.1.1171 - 2026-07-25

- `condition && <Modal {...modalProps} entity={selected} />`처럼 mount 조건과 실제 `show/open` 및 선택
  데이터 상태가 분리된 overlay를 같은 조건 ID로 연결해, 사용자가 스위치를 ON하면 시각적 계약도 함께 활성화
- 강제로 열린 overlay의 기존 visibility prop만 보이는 값으로 바꾸고 null인 file/item/data 계열 prop에는 짧은
  키 기반 정적값을 지연 생성하며, 작성된 기본 상태·원본 props·다른 overlay는 그대로 보존
- hook spread 뒤에 숨은 `show: false`와 별도 `useState(null)` 조합을 재현하는 source/runtime 회귀 테스트 추가

## 0.1.1170 - 2026-07-25

- Components 트리 행을 선택해도 `Selected blocker`/`Inspect selection` 탭으로 자동 이동하지 않고 현재 트리
  탭과 동일한 스크롤 viewport를 유지하도록 선택과 상세 탐색 동작을 분리
- Components 탭 아래에 선택 상세 영역을 고정해 component의 Props·State·Source·Payload와 condition/blocker
  편집기를 트리 문맥 안에서 바로 확인하며, 명시적으로 연 상세 탭도 같은 편집기를 재사용
- 행 클릭·키보드 선택·현재 파일 Reveal 전후의 트리 좌표를 보존하고, blocker 행도 일반 트리 선택과 동일하게
  처리하는 generated runtime 및 companion scroll 회귀 테스트를 보강

## 0.1.1169 - 2026-07-25

- 사용자가 상위 JSX 스위치를 변경하면 종료된 DFS 상태, overlay 1회 probe와 no-progress rejection을 새 bounded
  convergence epoch로 재개해 새로 도달한 하위 Modal/Drawer의 가시성 조건을 다시 분석
- 동일 페이지에 선언됐다는 이유로 sibling overlay를 열지 않으면서, 정적 root→현재 파일 경로에 포함되고
  여러 소스에서 중복되지 않은 overlay owner는 정확한 corridor 조건으로 인정해 visible branch를 자동 선택
- dormant blocker 안내를 수동으로 OFF된 자식 스위치와 자동 재시도 중인 자식 overlay로 구분하고,
  정확히 어떤 하위 스위치를 ON 또는 authored 상태로 복원해야 하는지 표시

## 0.1.1168 - 2026-07-25

- 현재 파일의 정적 return 경로 전체에서 모든 자식 분기를 공통으로 지배하고 동일한 ON/OFF 값을 요구하는
  가장 가까운 조건만 부모로 인정해 JSX 스위치를 보수적인 계통형 표로 표시
- 부모 스위치가 필요한 값과 다르거나 아직 실행되지 않았으면 기존 runtime registry에 남은 자식 값을
  `BLOCKED`로 구분하고, 부모 관계·필요 값·하위 스위치 수를 들여쓰기와 연결선으로 안내
- 각 스위치에 `Highlight code` 버튼을 추가해 별도 Inspector 탭에서도 소스 위치를 열고 선택 분기를
  강조하며, 소스 전환 및 ON/OFF 조작 전후의 시나리오 표 스크롤 좌표를 계속 보존

## 0.1.1167 - 2026-07-25

- 현재 파일의 JSX 시나리오에서 수집한 `&&`, 삼항식, 조기 반환 등 ON/OFF 분기 위치를 committed graph로
  재검증한 뒤 이미 열린 소스 에디터에 노란색 whole-line 데코레이터로 동시에 표시
- 분기 데코레이터는 파일을 열거나 포커스·코드 스크롤을 움직이지 않으며 hot reload revision, 배치 순서,
  최대 256개 위치와 panel 수명주기를 적용해 오래된 표시를 안전하게 제거
- ON/OFF 조작 시 교체되는 시나리오 표에 독립 스크롤 ID를 부여해 가로·세로 위치를 그대로 복원

## 0.1.1166 - 2026-07-25

- 별도 Inspector 탭과 preview 내부 셸에 `toolbar → page context → workbench`의 명시적인 높이 체인을
  적용해 좁은 화면에서 여러 줄로 접힌 상단 UI가 Components·상세·Console 영역을 0px로 밀어내지 않도록 수정
- 짧은 display에서는 workbench 최소 높이를 보장하고 Inspector 셸 자체를 최종 세로 스크롤 경계로 사용해,
  각 탭의 기존 내부 스크롤과 함께 화면 아래의 Props·Payload·Console 조작까지 항상 접근 가능하게 개선
- hot reload나 companion snapshot 교체 뒤에도 바깥 Inspector 셸과 트리·상세의 독립 스크롤 좌표를 복원하며,
  compact viewport·companion sanitizer·scroll ledger 회귀 테스트를 추가

## 0.1.1165 - 2026-07-25

- `if (!selectedUrl) return null` 같은 JavaScript truthiness 가드를 무조건 Boolean으로 오해하지 않고 URL·ID·
  data 등 정적으로 증명된 값 종류를 유지해, 부모가 넘긴 nullable target prop을 최소 유효값으로 교정
- `fetch(...).then(response => response.text())`와 await response binding의 `.text()`/`.json()` 소비 방식을
  구분하고, HTML 문서 소비에는 iframe·rich-text editor가 표시할 수 있는 안전한 정적 문서를 반환
- JSON API 응답과 명시적 text/csv 자원은 기존 semantics를 유지하며 styled target, null prop 병합,
  Fetch metadata 및 text/HTML response 직렬화 회귀 테스트를 추가

## 0.1.1164 - 2026-07-25

- module-consumer 후보가 page path와 함께 발견돼도 선택 파일의 prop inference를 facade와 Inspector descriptor에
  계속 전달해, nullable 대상 값이 실제 객체로 승격되지 않은 채 조건만 강제되던 불가능한 상태를 제거
- `Pick<외부 OverlayProps, "show">`처럼 외부 타입 본문을 해석할 수 없어도 정확히 노출된 overlay visibility
  키를 복구하고, 두 개 이상의 visibility 키가 있으면 임의 선택하지 않도록 제한
- JSX에 직접 출력되는 중첩 prop의 `id`, `name` 등 의미가 분명한 leaf만 짧은 키 기반 정적값으로 생성해
  `file == null` 가드를 통과한 모달이 빈 값이나 `file.documentId` 오류 없이 내용을 표시하도록 보강
- overlay 타입 분석을 별도 모듈로 분리하고 nullable prop 병합·Smart props·target facade 회귀 테스트를 추가

## 0.1.1163 - 2026-07-25

- Inspector의 JSX 시나리오/컴포넌트 트리와 우측 상세를 동시에 압축하던 2열 workbench를 제거하고,
  `JSX scenarios`, `Components`, `Inspect selection`, `Console` 네 개의 전체 폭 상위 탭으로 분리
- 트리·시나리오 행이나 wireframe blocker를 선택하면 상세 탭으로, picker와 현재 파일 reveal은 Components
  탭으로 자동 전환하며 선택한 source decoration과 highlight 상태는 그대로 유지
- 각 탭의 세로·가로 스크롤을 독립적으로 보존하고 좁은 dock에서는 탭 제목을 축소하지 않고 탭 바만 가로
  스크롤되게 하며, 방향키/Home/End로도 섹션을 전환할 수 있게 접근성 보강
- 선택 상세 내부의 component-local Props/State/Source/Payload 탭은 유지해 전역 섹션 탐색과 컴포넌트
  디버깅 관점을 분리하고, legacy Components/Blockers 탭 상태도 새 구조로 안전하게 이관

## 0.1.1162 - 2026-07-24

- Page Inspector의 기본 화면을 현재 선택 파일에서 정적으로 발견한 JSX Boolean 시나리오 표로 변경하고,
  `&&`, 삼항식, 조기 반환, overlay 조건의 OFF/ON 결과·현재 값·제어 출처를 한눈에 비교하도록 구성
- 아직 short-circuit 뒤에 있어 실행되지 않은 조건도 `WAIT` 상태로 보존하되 실제 runtime registry에 도달한
  조건만 OFF/ON으로 조작하게 해 프로젝트 표현식을 Inspector가 임의 평가하지 않도록 경계를 유지
- 기존 검색·blocker·source 선택·가로/세로 스크롤을 보존한 Page Component Tree를 두 번째 탭으로 이동하고,
  두 탭의 선택 및 독립 스크롤 좌표를 hot reload와 webview 상태 복원에서도 유지
- 좁은 dock에서는 표 열을 찌그러뜨리지 않고 Inspector 내부 가로 스크롤로 제공하며, 시나리오 행을 선택하면
  동일 조건의 기존 트리 상세·소스 데코레이션을 재사용하도록 연결

## 0.1.1161 - 2026-07-24

- 배열 callback 항목이 같은 파일의 formatter·route·permission helper로 전달될 때 helper parameter의 중첩
  사용 경로를 bounded하게 역전파해 `companies[].my.role` 같은 필수 payload가 누락되지 않도록 보강
- hook 결과의 property가 `onClick`/`renderX` JSX callback prop에 전달되면 직접 호출 구문이 없어도 no-op
  함수로 생성해 페이지가 뜬 뒤 첫 클릭에서 발생하던 `onClick is not a function` 오류를 제거
- 선택 파일의 non-null prop 조건을 통과시킬 때만 parent의 dormant `null`을 로컬 inferred prop shape로
  교정하고, 일반 페이지·setup·resolver·사용자 override의 명시적 null semantics는 그대로 유지
- 512개 일반 Fiber tree 한도 뒤에 밀린 실제 mounted target을 live boundary/host 근거로 별도 예약해
  현재 파일이 출력 중인데도 `not mounted`로 표시되던 blocker 경로를 정확히 복구

## 0.1.1160 - 2026-07-24

- 현재 파일의 `.map()` 등 정적 소비 형태가 배열 prop을 증명해도 상위 VirtualPage의 중립 placeholder `{}`가
  우선해 `data.map is not a function`을 만들던 병합 순서를 보완
- 자동 생성된 첫 parent-prop layer의 빈 객체만 로컬 배열·scalar·callback 계약으로 교정하고, 실제 작성 배열과
  setup/resolver/Inspector에서 명시한 사용자 값은 계속 우선하도록 경계를 제한
- `const data = useRows() || {}; data.map(...)`처럼 fallback alias를 거친 hook root의 collection 증거도 버리지
  않고 최소 배열 payload로 직렬화하며 직접 prop과 hook 양쪽 회귀 테스트 추가

## 0.1.1159 - 2026-07-24

- VirtualPage의 header/sidebar가 사용하는 navigation·tab·column 정적 카탈로그 훅을 일반 backend hook처럼
  한 항목 생성값으로 치환하지 않고, 반환 배열·복수 record·표시 문자열의 bounded syntax 증거로 원본 유지
- 보존한 UI 데이터 훅 내부의 session·permission·API hook은 기존 demand-shaped fallback으로 계속 차단해
  실제 메뉴 구조와 아이콘은 살리면서 프로젝트 backend 및 로그인 runtime이 다시 유입되지 않도록 분리
- 수백 개 메뉴 record는 최소 정적 증거가 확보되는 즉시 분석을 끝내 대형 navigation source가 parsing budget을
  소모하지 않게 하고 fluent `.filter(...)`, helper wrapper, local return alias 형태를 모두 지원
- 실제 RTCC 브라우저에서 한 줄짜리 `급여` placeholder가 9개 원본 메뉴 그룹으로 복원되고 header, page body,
  footer와 함께 예외 없이 표시되는 것을 확인했으며 fast bundle은 약 8.5초 유지

## 0.1.1158 - 2026-07-24

- JSX `src`/`srcSet`/`poster`/SVG `href`, URL 역할 변수·object property와 인라인 CSS `url(...)`의 정적
  asset 주소를 실제 import로 전환해 webview artifact 기준의 잘못된 상대·public 경로 해석을 제거
- nearest package의 `public` 및 source-relative 파일이 실제 존재하고 workspace 경계 안에 있을 때만 `?url`
  data asset으로 번들링하며, 누락·외부·traversal 경로는 원문을 유지하고 public tree 전수 탐색은 수행하지 않음
- fast preparation도 정적 render asset 증거가 있는 모듈만 정확 변환 경로로 보내 첫 화면과 full artifact가
  동일한 이미지를 사용하며, query 제거·SVG fragment·responsive descriptor와 중복 import 재사용을 보존
- API/XHR의 `connect-src 'none'`은 유지하면서 passive HTTPS CDN 이미지만 CSP에서 허용하고, source transform부터
  최종 PNG data URL artifact까지의 통합 회귀 테스트 추가

## 0.1.1157 - 2026-07-24

- VirtualPage가 전체 앱 entry를 실행하지 않으면서도 시각 라이브러리에 필요한 정적 module/plugin 등록 호출을
  dependency-only bootstrap으로 잘라내어 실제 page module보다 먼저 실행
- 같은 외부 package에서 import된 receiver와 정적 argument만 허용하고 local 변수, JSX, callback, SDK 설정,
  ReactDOM mount, 상대경로 module은 제외해 로그인·백엔드·분석 초기화가 다시 유입되지 않도록 제한
- 후보별 bootstrap을 dynamic page import보다 먼저 완료해 library registration과 component module 평가의
  race를 제거하고, entry snapshot·hot reload watch와 package-local resolution을 유지
- RTCC 실제 브라우저에서 이전 AG Grid 미등록 오류를 제거하고 header/sidebar/page body, 검색·페이지네이션,
  grid header와 생성 데이터 row, 현재 target host output을 함께 확인

## 0.1.1156 - 2026-07-24

- 정적 이름만으로 Modal을 추측하지 않고 React portal, dialog host semantic, 명시적 visibility prop을 결합해
  runtime overlay와 일반 Menu/Panel을 구분하며 Components tree에서 각 overlay를 `Visible/Hidden`으로 제어
- 현재 파일과 같은 page/source에 있다는 이유만으로 sibling overlay 조건을 자동 활성화하지 않고, exact
  condition/owner가 현재 target으로 증명된 overlay만 target DFS가 열도록 제한
- 자식 컴포넌트의 `show={target !== null}` 및 `show={open}` 계약을 부모 hook fallback으로 역전파해 누락 키를
  `undefined`로 두지 않고 각각 `null`/`false`로 생성하며, RTCC 실페이지에서 세 sibling modal의 기본 닫힘 확인
- fast build 6.7초, 3,090 dependencies, 현재 target host output과 header/body/footer 유지 및 회귀 테스트 통과

## 0.1.1155 - 2026-07-24

- VirtualPage가 현재 파일의 1-hop JSX만 나열하던 구성을 제거하고, 정확한 render outcome의 wrapper·owner와
  전후 sibling을 선택적으로 합성해 header, navigation, page body가 같은 작성된 페이지 프레임에 배치되도록 변경
- corridor owner가 `children` probe를 소비하지 않는다는 이유로 1.8초 뒤 제거되지 않게 하고, route catalog의
  경쟁 layout·component prop 슬롯·본문이 이미 소유한 wrapper는 중복 마운트하지 않도록 일반화
- `(data?.items ?? []) as Item[]` 같은 작성된 배열 계약과 import/re-export된 item 타입을 cross-module helper
  이전에 펼쳐 `{}` 대신 하위 배열·객체 필드까지 갖춘 최소 collection payload를 생성
- 보고된 3,090-dependency 화면에서 앱 topbar·sidebar·footer와 실제 투자계약 본문·overlay를 확인하고 fast
  build 7.4초, 진단·브라우저 격리 오류 0건 및 VirtualPage/정적 hook shape 회귀 테스트 통과

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

## 0.1.1115 - 2026-07-21

- Next.js Pages Router의 암묵적인 `pages/_app -> Component` 경계를 복원하고, 선택 route를 모듈 로드 전에 주입해 전역 provider·헤더·사이드바·스타일을 실제 페이지 문맥으로 렌더링
- 동적 Pages route의 pattern·query, RouterContext, 로컬 navigation 재렌더를 제공해 `useRouter`와 `next/link`가 Next bootstrap 없이도 정적 프리뷰에서 동작
- hook 결과의 optional collection, 1-hop identity alias, computed JSON scalar와 Array 길이 제약을 정적으로 추적해 `flatMap/map`, 중첩 설문 payload, 음수·과대 배열 길이 오류를 최소값으로 보정
- `steps[currentStep]` 형태의 고정 JSX 배열을 반환 선택지로 계측하고 현재 target 경로에 맞는 항목을 자동 선택하면서 사용자 스위치로 다른 화면도 확인 가능
- Node 내장 모듈의 browser shim을 쓰기 가능한 namespace와 로컬 EventEmitter로 보강해 PouchDB 계열의 prototype 확장이 모듈 평가를 중단하지 않도록 수정

## 0.1.1114 - 2026-07-21

- bare Node 내장 모듈 이름은 설치된 browser polyfill을 먼저 해석하고, 없을 때만 안전한 preview shim을 사용하며 enumerable EventEmitter fallback으로 PouchDB 계열의 `Pouch.on` 초기화를 지원
- target-to-entry render chain 순서를 보존해 앱 shell의 `/*`보다 현재 파일에 가까운 구체 route를 우선하고 HospitalRun·Zuzu의 실제 page URL로 진입
- 정적 props 타입이 HOC에서 사라져도 mounted facade에서 관찰한 단일 `show/open/visible: false` 값을 안전하게 `true`로 보정하며, 미도달 target은 자동 해결 결과의 remaining blocker에 계속 표시
- 이미 factory call로 변환되어 JSX가 남지 않은 `node_modules` JavaScript의 낡은 JSX pragma 경고만 제거해 react-spinners 경고 폭주를 줄이고 authored/raw JSX 경고는 유지

## 0.1.1113 - 2026-07-21

- React 16/구형 ReactDOM에서도 Inspector의 선택적 행 UI가 빈 결과를 `null`로 반환해 component tree 전체를 중단하지 않도록 수정
- 제거된 flowchart에 남아 있던 current-file node locator를 공용 runtime으로 이동하고 setup 없는 번들에도 안전한 browser `global` alias를 target import 전에 제공
- React Router v5 child Route와 target-near render identity를 우선해 `/patients` 같은 바깥 shell 대신 실제 동적 page 경로를 선택
- 동일 커밋 오류의 browser/boundary/fallback 중복과 hot rebuild의 동일 esbuild 경고를 한 번만 기록해 Inspector CPU·로그 사용량을 제한

## 0.1.1112 - 2026-07-21

- live Fiber와 authored JSX를 정확한 source occurrence로 대조해 `Modal`/`Modal2`·styled HOC 같은 이름 변환에서도 중복 정적 하위 트리를 제거
- 정적 outcome과 자손의 거짓 `not mounted` 표기를 없애고 처음 관측되지 않은 JSX만 `output not observed` frontier로 표시
- 닫힌 modal 아래의 미실행 render callback은 receiver가 실제로 mount되기 전까지 최상위 pending callback blocker로 오인하지 않도록 수정

## 0.1.1111 - 2026-07-21

- component tree 행을 선택하면 실제 mounted Fiber host만 노란 outline으로 강조하고 host 없는 route/blocker/placeholder에서는 이전 강조를 정확히 제거
- 선택 source의 line/offset을 현재 bundle graph로 재검증해 이미 열린 editor에 whole-line 데코레이터로 표시하며 추정 위치는 별도 스타일로 구분
- hot reload revision과 단조 sequence, 문서 변경 무효화, panel별 pending/cleanup으로 여러 preview의 코드 표시가 섞이거나 editor focus·scroll을 바꾸지 않도록 격리

## 0.1.1110 - 2026-07-21

- 함수형 children/render prop의 JSX를 지연 출력으로 식별하고 receiver의 확장된 hook·GraphQL 최소 shape부터 재탐색해 `mounted · no host output` 정착 상태를 통과
- `show/open/present` 이벤트 경로를 미마운트 상태부터 컴포넌트 트리 placeholder로 표시하고 현재 Fiber의 동일 handler가 확인될 때만 사용자 실행을 허용
- 0인자 로컬 JSX 반환 함수 호출을 모듈·컴포넌트 scope에서 bounded DFS로 확장하며 async·인자·side effect·cycle은 실행하지 않고 fail closed

## 0.1.1109 - 2026-07-21

- `gql`/`graphql` 태그·호출, `DocumentNode` 타입과 생성 AST 근거를 추적해 GraphQL 문서 export를 React 컴포넌트 대상에서 제외
- 평가 시 함수·React element·memo/forwardRef/lazy만 target facade로 감싸고 일반 객체 export의 identity를 보존
- hook과 mutation 문서만 있는 파일은 mutation을 억지로 mount하지 않고 직접 렌더 가능한 React export가 없음을 정확히 보고

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

초기 변경 기록은 [변경 기록 보관 문서](docs/changelog-archive.md)에 있습니다.
