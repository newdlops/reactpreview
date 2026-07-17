<p align="center">
  <img src="assets/icon.png" alt="React File Preview 아이콘" width="128" height="128">
</p>

# React File Preview

현재 편집 중인 React 파일을 파일에 고정된 VS Code 웹뷰 탭에서 바로 렌더링하는 경량 확장입니다.
별도 백엔드, 프론트엔드 개발 서버, HTTP 포트, 프로젝트 빌드 명령 없이 저장 전 편집 내용까지
미리 보고, 서로 다른 파일의 프리뷰를 여러 탭에 나란히 열 수 있습니다.

> 현재 `0.1.x`는 Preview 릴리스입니다. 선택 파일이 실제 작성된 page 안에서 차지하는 위치를 확인하는 데
> 집중하며, 프레임워크 전체 실행 환경 대신 정적 page 문맥과 선택적인 프로젝트 setup 경계를 사용합니다.

기본 `React Preview` 명령은 workspace 안의 실제 JSX 사용과 app entry 경로를 정적으로 역추적해 선택 파일의
컴포넌트를 가장 가까운 작성자 page/layout/App root 안에서 렌더링합니다. 따라서 부모 children, sibling,
조건부 UI, event handler와 스타일을 포함한 페이지에서 대상이 어떤 컴포넌트인지 확인할 수 있습니다. 분석된
경로는 Inspector에 `PAGE COMPONENT · App › Page › Target`처럼 표시되며 대상 host DOM은 highlight됩니다.
정확한 page owner를 증명할 수 없을 때만 `STANDALONE` fallback임을 명시합니다.

보조 `Open Current File Export Gallery` 명령은 활성 파일의 컴포넌트 export를 소스 순서대로 독립 렌더링합니다.
두 모드 모두 각 export에서 정적으로 도달하는 자식 컴포넌트·CSS·CSS Modules·asset과 라이브러리 코드를
esbuild의 실제 import graph로 재귀 수집합니다. self-contained UI와 안전한 정적 Apollo operation은 바로
렌더링합니다. 도달한 styled-components 소스가 하나의 실제 `theme`을 명시하면
alias와 상대 경로를 실제 해석 파일로 합친 뒤 디자인 토큰을 지연 로드하고, 없는 토큰만 구조적으로
보완합니다. React Redux에는 inert 정적 store를 연결하고, 실제 target-rooted graph에서 증명된 route
consumer에는 프로젝트 소유 MemoryRouter를 연결합니다. Redux state는 도달 가능한 소스의
`useSelector` 계열 callback과 이후의 안전한 property 접근에서 필요한 객체 경로만 수집해 inert
skeleton으로 제공합니다. Redux leaf·업무 상태·실제 route table·권한은 임의로 만들지 않습니다. 반면 기본
Page Inspector의 `Payloads` 경계는 실제 backend 호출 대신 GraphQL selection과 REST TypeScript 타입을 근거로
명시적으로 표시된 preview-only payload를 만들며, 사용자가 JSON/Lorem/Auto 값을 직접 선택할 수 있습니다.
정확한 업무 scenario가 필요하면 setup이나 작은 preview harness로 네트워크 없는 계약을 조립합니다.

기본 Page Inspector는 workspace 안의 실제 JSX 사용과 barrel/tsconfig alias를 역추적해 찾은 importable
ancestor export를 마운트하므로 모노레포의 형제 app package까지 포함한 부모 children, sibling, 조건부 UI와
event handler가 일반 페이지처럼 실행됩니다.
동시에 `createRoot`/`hydrateRoot` import identity를 기준으로 실제 앱 entry를 정적으로 찾고, `React.lazy`,
re-export, route 배열·router 객체와 조건부 app map의 값 흐름을 따라 target까지의 후보 경로를 비교합니다.
발견한 entry는 구조와 HMR 근거일 뿐 실행하지 않으므로 인증 bootstrap, API client와 전체 route table은
웹뷰에 들어오지 않습니다. 독립 export gallery는 이 실제 page composition과 분리된 보조 모드입니다.

## 설치

Marketplace 공개 후 VS Code의 Extensions 화면에서 `React File Preview`를 검색하거나 다음 명령을
사용합니다.

```bash
code --install-extension newdlops.react-file-preview
```

검토용 플랫폼별 VSIX가 있다면 Extensions 화면의 `Install from VSIX...` 또는 다음 명령으로
설치할 수 있습니다.

```bash
code --install-extension react-file-preview-<version>-<platform>.vsix
```

## 사용 방법

1. React 18 이상이 설치된 신뢰할 수 있는 워크스페이스를 엽니다.
2. React 컴포넌트를 내보내는 `.tsx`, `.jsx`, `.ts`, `.js` 계열 파일을 엽니다.
3. 에디터에서 우클릭해 `Open Current React File in Page Context`를 선택하거나, 명령 팔레트에서
   `React Preview: Open Current React File in Page Context`를 실행합니다. 파일의 export만 각각 확인하려면
   보조 명령 `Open Current File Export Gallery`를 선택합니다.
4. 명령을 실행할 때마다 현재 파일에 고정된 새 프리뷰 탭이 열리며, 탭 제목에는 경로 대신 파일명만
   표시됩니다.
5. 대상 파일이나 번들에 포함된 의존 파일을 편집하면 해당 탭만 설정된 지연 시간 뒤 갱신됩니다.

프리뷰 준비 중에는 대상 확인, 프로젝트 분석, 컴포넌트 문맥 탐색, 정적 런타임 준비, 번들링, 로컬 산출물
게시, React 로딩의 실제 7단계를 표시합니다. 최초 빌드는 전체 화면으로 진행상황을 보여주고, hot reload는
현재 화면을 유지한 채 오른쪽 위의 격리된 상태 패널만 갱신합니다. 시간 기반 퍼센트를 추측하지 않으며
새 revision이 시작되면 이전 빌드의 늦은 상태 메시지는 무시합니다. 완료 표시는 단순한
`createRoot().render()` 호출이 아니라 실제 React commit 뒤에 닫히며, entry module이 시작조차 못 하면
30초 안에 복구 가능한 오류 문서로 전환됩니다.

기본 Page Inspector는 독립 component가 잠시 잘못 표시되지 않도록 첫 artifact부터 application entry,
parent/sibling, props와 전역 근거를 포함한 full page context를 만듭니다. Export Gallery의 cold preview만 현재
export에서 정방향으로 도달하는 component/style/library graph를 단일 entry로 먼저 게시하고, 실제 mount 뒤
자동 Storybook setup과 code-split full graph를 백그라운드에서 보강합니다. full context를 한 번 확립한 탭의
다음 hot rebuild는 증분 full context를 한 번만 실행합니다.

프리뷰 탭을 클릭하거나 다른 에디터로 이동해도 대상 파일이 바뀌거나 다시 빌드되지 않습니다.
숨겨졌다 다시 표시된 탭도 마지막 성공 화면과 고정 대상을 유지합니다. 소스가 바뀌면 같은 웹뷰 문서가
새 로컬 ESM/CSS를 받아 component tree를 다시 마운트하므로 React Fast Refresh처럼 컴포넌트 state를
보존하지는 않습니다. `React Preview: Refresh Focused Preview`는 포커스된 프리뷰를 즉시 다시 빌드하며,
포커스된 프리뷰가 없으면 현재 소스 파일과 연결된 가장 최근 탭을 갱신하거나 새 탭을 엽니다. 저장하지
않은 대상·의존 파일 내용은 디스크보다 우선합니다.

## Page Inspector

Page Inspector는 Chrome Elements와 비슷한 선택·강조 경험을 React source 단위로 제공하는 기본 모드입니다.
대상 파일의 default export를 우선하고, 없으면 첫 직접 PascalCase export를 선택합니다. workspace 안에서
그 export를 실제로 import해 렌더링하는 사용처를 찾고, named/`export *` barrel과 각 consumer의 가장 가까운
tsconfig/jsconfig alias를 통과하면서 최대 8개의 project-level owner를 거슬러 올라갑니다. 렌더 가능한
page/layout/route/App 후보를 tests/stories/examples보다 우선해 가장 바깥쪽 작성자 export를 실제 root로
마운트합니다. 같은 파일의 private owner도 bounded하게 통과하지만 route 배열·router 객체·private terminal,
cycle 또는 깊이 한도에서는 마지막으로 확인된 React root와 partial 이유를 유지합니다.

별도의 inert render graph는 현재 파일의 모든 direct component export를 한 번 인덱싱하고 각 export에서
실제 ReactDOM mount까지 여러 후보를 탐색합니다. literal
dynamic import와 named/wildcard re-export, route `element`의 layout·guard, local page map/router 값 흐름을
통과하고 실제 entry에 도달한 경로를 story/test의 끊긴 사용처보다 먼저 선택합니다. 서로 다른 app entry가
모두 유효하면 후보를 보존하며, 사용처가 없는 export는 `entry-unreachable`인 standalone fallback으로
구분합니다. Inspector의 Target 목록에서 아직 현재 root에 렌더되지 않은 sibling export도 선택해 이 경로를
확인할 수 있습니다. 실제로 번들링하는 root는 계속 검증된 importable component export이므로 entry side
effect는 실행되지 않습니다.

대형 저장소에서는 `index`/`main`/`entry` 계열 파일을 이름만으로 entry라고 가정하지 않고, 해당 후보에서
ReactDOM mount import와 호출 identity를 먼저 AST로 증명합니다. 증명된 entry의 literal import를 target까지
정방향으로 따라간 작은 source slice만 상세 분석하며, import 경로와 실제 render 경로가 다르거나 entry를
찾지 못하면 선형 역색인 기반 target consumer closure로 자동 전환합니다.

bare wildcard만 있어 export identity를 정적으로 증명할 수 없는 파일은 parent/sibling 문맥 없이 direct-root
fallback으로 열립니다. 이 경우에도 export 선택, 자동 highlight, JSON props와 picker는 동작하며 Output에
ancestor 문맥이 없다는 warning을 남깁니다.

Inspector는 기본적으로 Chrome DevTools와 유사한 크기 조절식 하단 drawer를 엽니다. 위치 선택기에서 좌측·우측
drawer 또는 floating 패널로 바꿀 수 있고, drawer 경계와 floating 모서리를 드래그해 크기를 조절하며 floating
이동 핸들로 중요한 프리뷰 영역을 피할 수 있습니다. 왼쪽 `Components` 영역은 HTML tag가 아니라 runtime React
component를 부모·형제·자식 계층으로 보여주고, 오른쪽 상세 영역은 선택 component의 props, hook/class state
snapshot과 authored source를 보여줍니다.
runtime Fiber를 아직 읽을 수 없는 초기·실패 상태에서는 정적으로 증명한 EntryPoint→target component 경로를
같은 tree에 fallback으로 표시합니다.

Inspector dock에서는 다음 작업을 할 수 있습니다.

- 하단·좌측·우측 drawer와 floating 배치를 선택하고 크기·위치를 pointer 또는 방향키로 조절하거나 접기
- `Main component`로 tree 선택을 현재 파일의 대표 export와 실제 mounted target으로 즉시 되돌리기
- 정적으로 증명된 application entry-to-target 경로와 대안 수를 확인하고 target/ancestor root를 선택
- highlight를 켜거나 끄고, element picker로 DOM을 고른 뒤 가장 가까운 React component를 tree에서 선택
- 직렬화 가능한 boolean·number·string·array·plain object props를 JSON으로 적용하거나 초기화
- `Auto values`로 타입과 실제 receiver 경로에서 자동 생성된 preview-only 값을 켜거나 끄고 path/kind 확인
- `Payloads`에서 관찰된 GraphQL/REST 요청, 타입 추론 근거와 실제 전달할 JSON을 확인하고 `Generate Lorem`,
  `Use Auto`, `Apply JSON`, `Reset override`로 backend 없는 응답을 변경
- `Console`에서 hook/Provider, React lifecycle, promise와 project `console.*` 로그를 level/text로 필터링하고
  component stack·JavaScript stack·failure phase를 펼쳐 보거나 로그를 비우기
- reached TSX/JSX의 `condition && <Component />`와 JSX 삼항식 조건 행을 클릭해 분기를 반전하거나,
  상세 패널에서 truthy/falsy/fallback branch와 `Use authored value`를 명시적으로 선택
- 선택 component를 명시적으로 remount해 local state를 초기 상태로 되돌리기
- JSX development metadata 또는 정적 graph가 증명한 component source를 VS Code editor에서 열기

component highlight는 application DOM에 marker나 wrapper를 삽입하지 않습니다. 버전별 React boundary tree를
읽기 전용으로 따라가 선택 component 아래의 top-level host DOM을 찾고, 실패하면 지원되는 ReactDOM lookup
또는 picker로 폴백한 뒤 기존 DOM element outline만 사용합니다. dock host와 내용은 Shadow DOM으로 프로젝트
스타일에서 분리됩니다. boolean prop이나 root의 조건 prop은 JSON에서
바꾸면 동적 children/sibling 분기가 다시 렌더링되고, 일반 event-driven state는 실제 페이지 UI로
조작할 수 있습니다. 상세 패널의 runtime props와 hook/class state는 getter를 실행하지 않는 bounded read-only
snapshot입니다. React tree adapter는 Fiber나 hook queue를 수정하지 않습니다.
조건 계측도 기본 상태에서는 authored 값을 그대로 반환합니다. 사용자가 강제한 경우에만 boolean 분기를
바꾸고 실제 page root를 remount합니다. 그 branch가 API/GraphQL 값을 요청하면 no-network data boundary가
타입 근거로 생성한 payload를 공급하며, 생성값은 `GENERATED · AUTO` 또는 `GENERATED · LOREM`으로 표시됩니다.
자동 타입 근거로 표현할 수 없는 app context나 업무 invariant는 기존 component-local 오류 경계가 해당
위치에 진단을 유지합니다.
React는 임의의 hook/local state slot을 수정하는 공개 API를 제공하지 않으므로 Inspector도 이를 추측하거나
덮어쓰지 않습니다.
`Open source` 요청은 webview의 임의 경로를 신뢰하지 않으며, 해당 panel의 마지막 정상 bundle dependency로
확인된 JS/TS source만 현재 local/remote workspace URI를 유지해 엽니다. 실제 Inspector 버튼 클릭은
target별 HMAC과 일회성 nonce로 인증되므로 렌더링된 project code가 같은 host message를 위조할 수 없습니다.

선택 target의 render/lifecycle이 정적값 부족으로 실패하면 해당 target 위치만 작은 placeholder로 바뀌고
실제 ancestor와 바깥 sibling, Inspector toolbar는 유지됩니다. 전체 stack과 자동 runtime 경계 상태는
Inspector의 `Console` 탭과 원래 웹뷰 console에 함께 남습니다. `Payloads`에서 값을 생성·수정하면 request cache를 포함한 page
export가 다시 마운트되고, 일반 오류는 `Retry` 또는 toolbar의 `Remount`로 해당 target만 다시 시도합니다.

`Console`은 `console.log/info/warn/error/debug`, React boundary와 unhandled runtime/promise 실패를 시간순으로
표시합니다. level과 text 검색을 지원하고 같은 연속 로그는 `×N`으로 합치며, 각 preview 탭의 최신 250건만
메모리에 보관합니다. 프로젝트 object는 getter를 실행하지 않는 bounded 문자열로 복사되고 로그 자체는 VS Code
webview state에 영구 저장되지 않습니다. 따라서 hot reload 중에는 진단을 유지하지만 전체 탭 reload나 `Clear`로
초기화됩니다.

선택 export, highlight 상태, props/payload override, Auto payload 설정과 Inspector 배치·크기·위치는 해당
웹뷰 탭에만 저장됩니다. 소스,
선택된 ancestor 또는 entry/lazy/route 경로 근거가 바뀌면 같은 패널이 서버 없는 ESM/CSS hot reload를
수행하고 설정과 override를 다시 적용합니다.
프로젝트 React root 자체는 다시 마운트되므로 임의의 hook state는 보존되지 않습니다. 여러 실제 사용처가
있으면 page/layout/App 관례와 테스트 경로 감점을 적용한 결정적 후보를 고르지만 업무 route 의미까지
추측하지는 않습니다. 다른 scenario나 Provider state가 필요하면
[프로젝트 setup 가이드](docs/project-setup.md)의 setup 또는 harness를 사용하세요.

## 요구사항

- VS Code 1.96 이상
- React 18 이상과 `react-dom/client`가 설치된 대상 프로젝트
- React 컴포넌트 또는 React 엘리먼트인 runtime default나 PascalCase named export
- 로컬 파일 워크스페이스 또는 VS Code Remote의 workspace extension host
- Workspace Trust가 허용된 워크스페이스

가상 워크스페이스와 VS Code for Web은 지원하지 않습니다. Remote SSH, Dev Container,
Codespaces에서는 확장이 원격 호스트에 설치되므로 해당 운영체제·CPU용 패키지가 필요합니다.

## 동작 방식

```text
파일에 고정된 TextDocument 스냅샷
  → application/BuildPreview
  → adapters/esbuild (역방향 JSX slice + 정방향 import graph + 브라우저 번들, write:false)
  → adapters/vscode (참조 횟수를 관리하는 globalStorageUri 해시 캐시)
  → presentation/panel session (독립 revision + 의존 그래프)
  → presentation/webview (asWebviewUri + 제한된 CSP)
```

- esbuild의 `serve()`나 다른 서버 API를 호출하지 않습니다.
- esbuild는 JavaScript로 다시 구현된 번들러가 아니라 설치 플랫폼의 Go 네이티브 실행 파일입니다. 같은
  target/runtime plan은 persistent `context.rebuild()`로 parsed graph를 재사용하고, 새 revision은 이전 native
  build를 취소합니다. 직전 reached graph의 Router·lexical global 계획도 재사용해 보통 한 번의 pass로 끝냅니다.
- 현재 파일과 도달 가능한 dirty 참조 파일의 저장 전 내용은 esbuild overlay가 우선 사용합니다.
- component export gallery는 대상에서 가장 가까운 `package.json`을 모노레포 package 경계로 선택하고,
  최초 빌드에서 그 경계 안의
  authored source 경로와 실제 JSX prop/wrapper 사용을 구문만 읽어 정적 환경 인덱스로 만듭니다. source,
  module/entry/import fact는 변경된 파일만 다시 읽고 같은 package의 여러 탭과 재빌드가 공유합니다. 기본
  Page Inspector의 reverse index만 bounded workspace
  전체로 넓혀 sibling package의 app owner를 찾되 workspace 밖으로는 확장하지 않습니다.
- 활성 export를 entry root로 삼은 esbuild graph가 정적 import, re-export, 자식·손자 컴포넌트와 그
  CSS/asset/library import를 재귀적으로 수집합니다. 일반 JS/TS import, package export, tsconfig alias와
  symlink 및 모노레포 상위로 hoist된 `node_modules` 해석은 esbuild의 기본 resolver에 맡기고, 확장
  plugin은 dirty overlay·가상 bridge·bounded resource 변환만 담당해 별도의 수동 resolver 비용을
  만들지 않습니다.
- 제한된 정적 분석기가 파일 시스템 패턴을 명시적 import로 바꿔 동적 리소스도 번들에 포함합니다.
- AST export inventory와 ordered bridge가 활성 파일의 runtime default 및 PascalCase named export를
  선언 순서대로 갤러리에 전달합니다. 각 export의 렌더 오류는 다른 export와 격리됩니다.
- Page Inspector는 semantic ReactDOM entry 후보를 먼저 증명하고 그 entry에서 target까지의 literal import
  경로만 작은 module index로 만듭니다. `React.lazy`·re-export·JSX owner·route value flow가 실제 render
  경로를 만들지 못하면 선형 reverse import index를 안전망으로 사용합니다. nearest package/config에서
  먼저 찾고 entry가 없을 때만 bounded workspace로 넓혀 모노레포 sibling app을 지원합니다. entry 파일은
  실행하지 않으며 선택 경로와 wrapper source만 dependency/HMR 근거로 남깁니다.
- setup이 없으면 export별 실제 JSX 사용에서 target의 syntactic ancestor를 안쪽부터 역추적합니다.
  intrinsic element와 정적으로 import된 wrapper, primitive prop, 일반 children/render-function children만
  recipe에 남기고 sibling JSX와 parent owner 함수는 버립니다. 같은 파일의 private `Body` 사용도 bounded하게
  따라가며, dynamic prop·spread가 필요한 Form/Provider를 만나면 그 직전의 검증된 partial path에서
  멈춥니다. 선택된 wrapper만 가상 모듈이 import하므로 wrapper의 자식 graph와 styled/CSS도 esbuild가
  정방향으로 수집합니다. 명시적 setup이나 Storybook은 이 자동 slice보다 우선합니다.
- 대상 import 전에 안전한 전역 namespace와 프로젝트 setup을 준비하고 render 시 Provider를 조립합니다.
  별도로 package의 ambient `typeof import()` 전역 선언과 entry의 직접
  `globalThis/window.name = importedBinding` 할당과 동일 global을 먼저 확인하는 `name || importedBinding`/`??`
  bootstrap을 실행 없이 수집합니다. 둘이 가리키는 정확한 project wrapper export를 esbuild lexical inject로
  먼저 연결하며, 그런 강한 근거가 없을 때는 실제 도달 graph에서 자유 식별자로 확인된 동일 이름 설치
  package만 최대 한 번의 adaptive rebuild로 제공합니다. local binding은 덮어쓰지 않고 wrapper의
  plugin·locale·helper 정체성을 bare package보다 우선합니다.
- Browserify가 주입하던 자유 `process`를 사용하는 브라우저 package를 위해 setup과 target graph 평가 전에
  기존 `globalThis.process`를 보존하거나 `platform`, mutable `env`, `cwd`, `nextTick`과 inert event method만
  가진 bounded object를 설치합니다. hot reload에서는 같은 object를 재사용하며 Node filesystem, network,
  native binding이나 process 제어 권한은 만들지 않습니다. project bootstrap이 `process/browser`를 정확히
  연결한 근거가 있으면 위 lexical bridge도 그 project package identity를 재사용합니다.
- Apollo Client가 설치된 프로젝트에는 HTTP transport가 없는 메모리 전용 Provider를 제공합니다. Export
  Gallery는 기존 selection-shaped 중립 데이터를 사용하고, Page Inspector는 alias·fragment·list를 포함한
  operation shape를 editable payload registry에 등록해 타입에 맞는 Auto/Lorem 값을 공급합니다.
- Page Inspector build는 global `fetch`와 정확한 `axios` package import의 HTTP method call만 no-network
  adapter로 계측합니다. `axios.get<T>()`와 JSON 변환 주변 TypeScript interface/type alias는 bounded shape로
  바꾸고, 외부 URL과 `/api`·`/graphql` fetch는 메모리 `Response`로 종료합니다. 상대 JSON/TXT/CSV fixture는
  원래 local fetch를 유지합니다. 별도 모듈에서 만든 Axios instance처럼 정적으로 call identity를 증명할 수
  없는 browser client도 최종 `XMLHttpRequest`를 메모리 응답으로 종료합니다.
- target 또는 도달 가능한 styled-components 자식이 하나의 `theme` value/type import를 명시하면
  esbuild가 alias와 상대 경로를 실제 파일 identity로 정규화합니다. 유일한 후보만 지연 import해 실제
  theme을 우선 사용하고, 누락 token이나 실패 helper만 보완합니다. 찾지 못하면 값 없는 fallback을
  사용합니다. React Redux에는 target-reachable source에서 정적으로 증명된 selector 객체 경로만 담은
  deeply frozen plain state와 상태를 변경하지 않는 inert store Provider를 제공합니다. selector의 leaf
  값, enum과 boolean은 추측하지 않으며 reducer, store module과 앱 bootstrap을 실행하지 않습니다.
- 실제 target-rooted esbuild graph 전체에서 React Router consumer와 provider import를 수집합니다.
  자식·손자에서만 consumer가 확인되어도 provider 근거가 없으면 최대 한 번 adaptive rebuild해 대상
  프로젝트의 `MemoryRouter`를 제공하며, 앱 route, browser history와 loader는 실행하지 않습니다.
  custom/Storybook setup의 존재만으로 자동 Router를 끄지 않고 실제 provider 근거가 있으면 nested
  Router를 만들지 않습니다.
- target-rooted graph가 Formik의 `useField`, `useFormikContext`, `Field` 같은 consumer를 사용하지만
  Provider 근거는 포함하지 않으면, 대상 프로젝트의 동일 Formik package로 빈 정적 form boundary를
  구성합니다. validation과 submit은 실행하지 않으며 setup에서 bounded `initialValues`를 지정하거나
  자동 경계를 끌 수 있습니다.
- workspace TS/TSX가 React의 `createContext<지원되는 구조>(undefined/null)`을 사용하면 inline 타입이나
  같은 파일의 유일한 non-generic·acyclic interface/type alias에서 확실한 primitive·배열·함수 구조만
  제한적으로 합성합니다. imported/generic/recursive/extends/merged 타입은 그대로 두며 실제 Provider
  값은 항상 더 가까운 Context로 우선합니다.
- workspace의 정적으로 import된 `use*Context` 호출은 호출부가 실제로 비옵셔널 역참조하는 plain object
  container와 호출 메서드만 별도로 수집합니다. Context 값이 없을 때 stable frozen object/no-op 함수로
  첫 정적 DOM을 허용합니다. 안전한 optional receiver는 absent 상태로 보존하며, 같은 module에서 증명된
  hook/Context identity는 project React의 raw Provider로도 합성합니다. leaf 값과 업무 의미는 만들지 않고
  실제 tree/setup Provider 반환값은 그대로 우선합니다.
- `.react-preview/setup.*`을 우선 사용하며, 없으면 정상적인 `.storybook/preview.*` decorator를
  첫 화면 뒤 full context에서 재사용합니다. Storybook main, addon manager와 서버는 실행하지 않습니다.
- React와 ReactDOM은 대상 프로젝트에 설치된 하나의 복사본을 번들링합니다.
- 생성된 entry JS, 원래 dynamic `import()` 경계를 보존한 보조 JS chunk와 집계 CSS는 인라인 코드나
  `eval`이 아니라 VS Code global storage의 content-addressed 외부 로컬 리소스로 로드합니다. 변하지 않은
  `chunks/[hash].js`와 CSS/entry는 revision과 탭 사이에서 공유하고, 마지막 lease가 끝날 때만 삭제합니다.
  로드된 URL은 session tombstone으로 다른 byte에 재사용되지 않으며, 도달한 CSS는 먼저 적용하고 JS chunk는
  브라우저가 해당 경계를 실행할 때 로드합니다.
- 첫 렌더 뒤의 성공 빌드는 서버나 포트 없이 cache-busted local ESM URI와 선택적 CSS URI를 기존
  웹뷰에 전달합니다. 웹뷰는 새 stylesheet, ESM, setup, provider와 target graph를 기존 tree 뒤에서 준비하고
  모두 성공한 뒤에만 root를 다시 마운트합니다. preload나 다음 빌드가 실패하면 마지막 정상 화면을 보존하고,
  교체가 시작된 뒤 실패하면 상세 runtime 오류 문서로 복구합니다. 메시지 전달이 실패하거나 30초 안에
  확인되지 않아도 전체 HTML 교체로 복구합니다. 이는 state를 유지하는 React Fast Refresh가 아닙니다.
- 렌더 실패 시 direct error headline과 실패 phase, target/export/setup/classification, parent render
  slice의 wrapper 수·complete/partial 상태, 자동 Globals·Apollo·Context·Formik·Redux·Router·Theme 경계 상태, React
  component stack, JavaScript stack, cause/AggregateError와 primitive field를
  한 보고서에 표시합니다. Apollo compact invariant payload도 외부 요청 없이 로컬에서 decode합니다.
  React 19 root callback과 JSX development source metadata를 활용하며 전용 CSS reset이 일반적인 프로젝트
  전역 스타일로부터 진단 패널의 가독성을 보호합니다.
- 각 패널은 처음 선택한 URI, revision, 의존 그래프와 생성물 lease를 독립적으로 소유합니다.
- 패널 포커스 변경은 빌드 이벤트가 아니며, 늦게 끝난 과거 revision도 화면에 반영되지 않습니다.
- 마지막 성공 빌드의 의존 파일이나 정적 패턴 탐색 디렉터리 안의 문서를 편집·저장하면 관련
  프리뷰만 다시 빌드하고, 새 ESM/CSS를 해당 웹뷰에 교체합니다.

자세한 책임과 의존 방향은 [아키텍처 문서](docs/architecture.md)를 참고하세요.

## 지원 범위

지원하는 항목:

- `.tsx`, `.jsx`, `.ts`, `.js`와 `.mts`, `.cts`, `.mjs`, `.cjs` 컴포넌트
- 활성 파일의 runtime default와 모든 직접 PascalCase named export를 source order로 순차 렌더링
- bare `export *` 위치에서 발견되는 PascalCase runtime re-export를 안정적인 이름 순서로 확장
- 같은 package의 실제 JSX import 사용에서 찾은 boolean·number·string·null literal props를 가장 낮은
  우선순위의 자동 props로 사용하고 setup·export별 props로 덮어쓰기
- 직접 export component의 same-file 필수 prop type과 비옵셔널 property/call/iteration receiver에서
  bounded object container·primitive·empty array·no-op function을 생성하고 경로를 Inspector에 표시;
  실제 사용/setup/사용자 값은 깊은 경로에서도 자동값보다 우선
- 같은 실제 JSX 사용에서 대상까지의 intrinsic/imported wrapper 한 갈래만 합성하고 형제 컴포넌트와
  부모 owner를 실행하지 않는 export별 parent render slice; private same-file owner와 render-prop 추적,
  dynamic imported-wrapper hard barrier 및 선택 wrapper의 style/import graph 포함
- 기본 Page Inspector에서 workspace-local 실제 JSX 사용과 named/wildcard barrel·consumer tsconfig alias를
  bounded하게 역추적해 importable ancestor를 마운트하고 작성된 parent/children/sibling·조건부 UI·도달
  CSS를 함께 실행
- semantic `createRoot`/`hydrateRoot`/legacy ReactDOM entry, literal `React.lazy`, route layout/guard와 local
  router/page-map 값 흐름을 정적으로 연결하고 entry-connected 복수 후보와 orphan export를 구분
- DOM marker/wrapper 없는 read-only React host lookup, 격리된 Shadow DOM toolbar, highlight
  toggle·element picker·target/root JSON props override와 패널별 hot-reload persistence
- 현재 파일과 import된 `.js` 컴포넌트의 JSX 문법
- 일반 CSS와 CSS Modules
- 가장 가까운 package의 Dart Sass를 사용하는 `.scss`/`.sass`와 Sass CSS Modules; compiler나 개별 style이
  실패하면 component는 유지하고 해당 style만 warning과 함께 생략
- import된 일반 이미지·폰트·오디오·비디오·PDF asset의 제한된 data URL
- SVG URL, `<img>` 기반 `{ ReactComponent }`/`?react`와 UTF-8 `?raw` import
- 현재 파일과 열려 있는 참조 컴포넌트의 저장 전 편집 내용
- 표준 tsconfig alias와 명시적으로 선택한 tsconfig/jsconfig
- symlink 경로, 확장자 없는 순환 import와 의존 파일 저장 감지
- 상대 패턴의 Vite `import.meta.glob`/`import.meta.globEager`: 문자열·문자열 배열, 제외 패턴,
  `eager`, `import`, `query`와 호환용 `as` 옵션
- 상대 디렉터리, 정적 재귀 플래그와 정규식 리터럴을 사용하는 Webpack `require.context`
- 상대 경로 템플릿·문자열 연결식 dynamic `import()`/`require()`와 정적
  `new URL(..., import.meta.url)` asset
- Export Gallery 최초 fast pass의 단일 ESM output과, full context에서 원래 dynamic `import()` 경계를
  유지하는 최대 2,048개 로컬 output 및 nested lazy component용 export별 `Suspense` 경계; 일반 정적 자식
  import의 실행 의미는 임의로 lazy 변환하지 않음
- 가장 가까운 `package.json` 기준 `public` 디렉터리의 `/...` asset·CSS `url()`/`@import`, 모든
  로컬 파일 형식의 명시적 `?url` import
- `MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`만 제공하는 안전한 `import.meta.env`
- Browserify 호환 package용 bounded `process` metadata/scheduler와 기존 project process 보존
- optional package graph가 노출한 `fs` 등 Node built-in의 browser-neutral shim; 실제 API를 호출하면
  `undefined`만 반환하며 extension host filesystem/network capability는 노출하지 않음
- bounded HTML/Storybook namespace 발견, `.react-preview/setup.*`의 initialize/Provider/props 계약
- 프로젝트 Apollo Client를 사용하는 자동 no-network Provider, bounded selection-shaped 정적 응답과
  setup별 operation 결과 override
- Page Inspector의 GraphQL selection 및 `fetch`/정확한 `axios` import용 editable payload registry,
  TypeScript/필드명 기반 Auto 값과 타입을 보존하는 Lorem/사용자 JSON override
- 활성 파일 또는 도달 가능한 styled-components 자식이 직접 참조한 실제 theme의 자동 재사용,
  alias/상대 경로의 resolved-file 병합, 지연 import, 누락 token/helper fallback과 setup별 exact theme/비활성화
- 프로젝트 React Redux를 사용하는 selector-derived inert state skeleton과 setup별 exact static
  state/비활성화
- 프로젝트 Formik consumer/provider inventory, no-submit 정적 form boundary와 setup별 bounded
  `initialValues`/비활성화
- target-rooted graph 전체의 Router consumer/provider inventory, 최대 1회 adaptive rebuild로 제공하는
  프로젝트 React Router root MemoryRouter와 setup별 정적 entries/비활성화
- workspace TypeScript의 inline object 및 같은 파일 non-generic·acyclic interface/type alias Context에
  대한 bounded neutral missing-default 보완
- 정적으로 import된 custom `use*Context` 호출의 실제 역참조 형태에서 만든 stable frozen container와
  no-op callable fallback, exact hook/Context identity 기반 raw Provider 및 lazy registration 반영
- direct headline·phase·target/export/setup·component/JavaScript stack·cause·자동 경계 상태를 보존하는
  프로젝트 CSS 격리 runtime 보고서와 범용 harness/setup 안내
- 정상적으로 번들링되는 `.storybook/preview.*`의 global decorator와 Apollo MockedProvider parameter
- 컴파일 오류, 모듈 해석 오류, React 렌더 오류 표시

초기 버전에서 의도적으로 지원하지 않는 항목:

- Next.js SSR/RSC와 서버 전용 모듈
- Vite, Webpack, Babel 플러그인이나 프로젝트 빌드 명령 재사용
- Less, Tailwind 전처리와 SVGR 고급 변환 옵션·인라인 SVG DOM 조작
- 유한한 상대 정적 접두사 없이 런타임에만 결정되는 경로 import와 alias/bare glob
- JSX의 `<img src="/logo.png">`처럼 import가 아닌 root URL 리터럴(대신 import, CSS 또는
  `new URL('/logo.png', import.meta.url)` 사용)
- Vite 사용자 환경 변수, `.env` 로딩과 Redux leaf 값·앱 route graph·props 의미를 추측하는 모킹
- 전체 앱 entry의 **실행**, 인증 bootstrap, 실제 API client transport나 backend 실행. Page Inspector가
  증명한 `fetch`/`axios`/Apollo 요청은 local payload로 종료하지만 임의의 custom socket/client protocol을
  실행하거나 추측하지 않음. entry 위치와 render chain은
  구문으로 찾을 수 있고 import-backed 전역 할당/ambient 선언이 정적으로 증명한 한 module export는 entry
  자체를 실행하지 않고 lexical bridge로 재현할 수 있음
- runtime hook 결과나 동적 prop이 필요한 부모 Form/Provider의 자동 복제, 여러 사용처 중 업무적으로
  올바른 scenario 추측, 부모 함수의 실제 실행 결과와 동일한 Virtual DOM 보장
- Page Inspector에서 임의 React Fiber/hook/local state slot 수정, workspace 밖 app entry·업무 route scenario
  자동 선택, 함수·symbol·순환 객체 prop의 JSON 편집
- 실제 Node 내장 runtime·filesystem·network 동작, Web Worker, 외부 API 요청. neutral built-in과 bounded browser
  `process` metadata는 Node runtime 지원을 의미하지 않음
- lowercase 이름만 가진 named component export의 자동 판별

초기 package source 인덱스는 최대 16,384개 파일을 16개씩 읽으며 파일당 4 MiB, 합계 128 MiB로
제한합니다. `.git`, build output, `node_modules`와 symlink entry는 순회하지 않습니다. source 경로,
primitive prop과 inert wrapper recipe만 캐시하고 프로젝트 module을 실행하지 않으며, 새 파일을 반영하도록
경로 목록과 결과 없는 검색은 5초 뒤 만료됩니다. 선택 props나 parent slice를 제공한 파일은 크기·수정
시각이나 dirty snapshot이 바뀌면 다시 분석합니다.

서버 없이 메모리에서만 처리하는 경량 프리뷰이므로 인라인 asset은 파일당 5 MiB, 한 빌드에서
합계 20 MiB까지 허용하며 최종 JS/CSS 출력은 32 MiB, 출력 파일은 entry/CSS를 포함해 최대 2,048개로
제한합니다. 정적 매크로 하나는 최대
128개의 512자 이하 패턴, 256개 파일, 4,096개 파일 시스템 조회와 20단계 디렉터리를 허용합니다.
한 빌드 전체는 매크로 확장 128회, 생성 참조 1,024개, 조회 16,384개와 watch directory 128개로
제한합니다. 패턴과 따라가는 symlink 대상은 현재 워크스페이스 안에 있어야 하며 `.git`, `.hg`,
`.svn`과 중첩 `node_modules`는 wildcard로 순회하지 않습니다. 실제 import graph에서 도달한 패키지
소스는 동일한 AST 분석과 한도를 적용받습니다. 한도를 넘는 패턴과 더 큰 미디어는 범위를 줄이거나
실제 앱의 정적 파일 제공 경로에서 확인해 주세요.

## 설정

| 설정                               | 기본값 | 범위         | 설명                                                          |
| ---------------------------------- | ------ | ------------ | ------------------------------------------------------------- |
| `reactPreview.updateDelay`         | `300`  | `100`–`2000` | 편집 후 자동 갱신까지 기다릴 밀리초입니다.                    |
| `reactPreview.tsconfig`            | `""`   | 상대경로     | 비표준 alias용 tsconfig/jsconfig 경로입니다.                  |
| `reactPreview.setupFile`           | `""`   | 상대경로     | 명시적 프로젝트 setup 모듈이며 자동 convention보다 우선함     |
| `reactPreview.useStorybookPreview` | `true` | resource     | setup이 없을 때 Storybook preview decorator를 재사용할지 여부 |

Apollo 정적 응답, 자동 theme, selector-derived Redux state와 MemoryRouter를 조정하거나 전역값과 props를
공급하는 방법은 [프로젝트 setup 가이드](docs/project-setup.md)를 참고하세요.

## 보안과 개인정보

이 확장은 대상 프로젝트의 소스, 선택된 setup과 `node_modules`를 실제 브라우저 코드로 실행하므로 신뢰된
워크스페이스에서만 활성화됩니다. 웹뷰의 로컬 접근 범위는 현재 세션 생성물로 제한되며 CSP가
네트워크 연결, 프레임, 워커, 폼, 인라인 스크립트와 `unsafe-eval`을 차단합니다. React의 `style`
속성과 CSS-in-JS 호환성을 위해 스타일에만 `unsafe-inline`을 허용합니다.

확장은 텔레메트리를 수집하거나 외부 서버로 데이터를 보내지 않습니다. Vite/Next/Webpack 설정,
package script와 `.env` 파일을 실행하거나 읽지 않으며 사용자 프로젝트에도 결과 파일을 쓰지
않습니다. 생성된 번들은 VS Code global storage의 세션 디렉터리에만 저장되고 확장 종료 시
삭제합니다. 보안 문제는 [보안 정책](SECURITY.md)에 따라 공개 이슈가 아닌 비공개 경로로
제보해 주세요.

## 문제 해결

| 증상                              | 확인할 내용                                                           |
| --------------------------------- | --------------------------------------------------------------------- |
| React 모듈을 찾지 못함            | 대상 워크스페이스에 React 18 이상과 ReactDOM이 설치됐는지 확인        |
| export가 갤러리에 표시되지 않음   | runtime default 또는 PascalCase 이름으로 직접 export했는지 확인       |
| Inspector가 기대한 페이지가 아님  | toolbar ancestry/partial 이유를 확인하고 다른 업무 scenario는 harness |
| Inspector target이 강조되지 않음  | target을 렌더하는 prop/state를 조정하거나 `Pick element`를 사용       |
| Inspector props가 적용되지 않음   | 선택 항목이 Target/Root 중 맞는지와 plain JSON object인지 확인        |
| ApolloProvider가 없다는 오류      | 이전 고정 탭을 Refresh하고 `apolloPreview` 비활성화를 확인            |
| Formik context가 없다는 오류      | Refresh 후 `formikPreview.initialValues` 또는 실제 Form Provider 확인 |
| Theme token 스타일이 비어 있음    | 도달한 styled 소스의 `theme` import가 모호한지 확인하거나 setup 지정  |
| Redux selector가 값·분기에 실패   | 자동 분석할 수 없는 값은 `reduxPreview.state`에 정확히 공급           |
| Router 경로나 parameter가 필요함  | setup의 `routerPreview.initialEntries` 또는 preview harness를 사용    |
| custom Context·필수 props 오류    | 자동값 path/kind를 확인·수정하고 의미 있는 값은 harness/setup에 공급  |
| 일부 component만 placeholder 표시 | Inspector `Console`을 확인하고 값 수정 후 Retry/Remount               |
| 런타임 오류 원인이 불분명함       | 보고서의 headline, phase, stack, cause와 자동 경계 상태를 함께 확인   |
| Storybook setup 건너뜀 경고       | 깨진 preview import를 고치거나 전용 `reactPreview.setupFile`을 지정   |
| 프레임워크 전용 import 오류       | 현재 지원 범위에 없는 Vite/Next/Webpack 플러그인 문법인지 확인        |
| 정적 리소스 탐색 한도 오류        | glob/context/template 범위를 더 가까운 상대 디렉터리로 제한           |
| Restricted Mode에서 실행되지 않음 | 워크스페이스 내용을 검토한 뒤 신뢰 여부를 직접 결정                   |
| Remote 환경에서 설치할 수 없음    | 원격 운영체제와 CPU용 Marketplace 패키지가 게시됐는지 확인            |

재현 가능한 일반 오류와 기능 요청은 [GitHub Issues](https://github.com/newdlops/reactpreview/issues)에
등록해 주세요. 로그에 프로젝트 비밀값이나 전체 비공개 소스를 첨부하지 마세요. 자세한 정보는
[지원 정책](SUPPORT.md)에 있습니다.

## 개발

필요한 개발 환경은 Node.js 22.13 이상과 VS Code 1.96 이상입니다.

```bash
nvm use
npm install
npm run check
```

VS Code에서 `F5`를 누른 뒤 개발 호스트에서 `examples/HelloPreview.tsx`를 열어 프리뷰 명령을
실행합니다. 개발 명령, 계층 선택과 완료 조건은 [기여 지침](CONTRIBUTING.md)에 있습니다.

배포 담당자는 [Marketplace 배포 가이드](docs/publishing.md)의 publisher 생성, 플랫폼별 VSIX,
인증 전환과 검증 절차를 따라야 합니다.

## 프로젝트 규칙

1. 사람이 관리하는 파일은 주석과 빈 줄을 포함해 1,000줄을 넘지 않습니다.
2. 폴더는 domain → application → adapter/presentation의 책임으로 나눕니다.
3. 안쪽 계층은 바깥 계층이나 VS Code/esbuild 구현을 import하지 않습니다.
4. 축약보다 의도를 드러내는 이름과 작은 단위의 코드를 사용합니다.
5. 컴파일러와 저장소처럼 실제로 교체 가능한 경계에 인터페이스를 둡니다.
6. 새 파일 형식, 컴파일러, 저장소, UI 상태를 기존 핵심 규칙 수정 없이 추가할 수 있게 합니다.
7. 소스 파일 상단과 모든 함수·클래스에는 책임, 입력, 출력, 오류, 부작용을 설명합니다.

## 라이선스

[MIT License](LICENSE) · Publisher: `newdlops`
