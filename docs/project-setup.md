# 프로젝트 프리뷰 환경 설정

React 컴포넌트가 Theme, Router, GraphQL, Redux, Formik 또는 브라우저 전역에 의존한다면 import graph만
번들링하는 것으로는 충분하지 않습니다. React File Preview는 앱 전체 entry, 인증 bootstrap, 실제 API
client, backend나 개발 서버를 실행하는 대신 프로젝트가 제공한 작은 setup 모듈을 대상 파일보다 먼저
실행합니다.

## 선택 순서

컴파일러는 다음 순서로 하나의 setup만 선택합니다.

1. 리소스 설정의 `reactPreview.setupFile`
2. 가장 가까운 `package.json` 아래 `.react-preview/setup.tsx`(이후 TS/JS 확장자 순서)
3. `reactPreview.useStorybookPreview`가 켜져 있을 때 `.storybook/preview.tsx`
4. setup 없음

Storybook `main`이나 Vite/Webpack 설정, addon manager와 서버는 실행하지 않습니다. 자동으로 선택한
Storybook preview는 최초 fast 화면이 commit된 뒤 full context에서 적용합니다. preview 자체가 번들링되지
않으면 대상만 다시 빌드하고 Output Channel에 경고를 남깁니다.
이 경우 전용 setup을 추가하면 프로젝트의 현재 구조를 명확하게 표현할 수 있습니다.

## package 경계, 자동 정적 props와 parent slice

setup, `public` root와 초기 정적 환경 인덱스의 project root는 대상에서 가장 가까운 `package.json`입니다.
package manifest가 없을 때만 workspace root를 사용하므로 모노레포의 형제 package 설정과 source를
한 프리뷰 환경으로 섞지 않습니다. 일반 package import는 대상 package에서 시작하는 esbuild resolver가
처리하므로 workspace root나 그 상위에 hoist된 `node_modules`도 Node의 통상 탐색 규칙으로 찾습니다.

프로젝트 resolver가 성공한 package가 항상 우선합니다. 성공한 preview graph에서 실제 도달한 일반
`node_modules` package는 nearest package-manager lockfile, exact dependency map과 플랫폼으로 구분한 VS Code
전역 저장소에 content-hashed immutable layer로 백그라운드 복사됩니다. 모노레포에서는 package부터 workspace
root까지 가장 가까운 lockfile을 사용합니다. 후속 target이 다른 package에 도달하면 같은 profile에 layer를
추가하므로 최초 graph의 부분집합으로 고정되지 않습니다. 같은 dependency·lock profile을 가진 다른
clone/workspace는 자기 프로젝트에 설치하지 않아도 검증된 layer를 fallback으로 사용합니다. 확장은 단일
React 19 fallback 대신 React/ReactDOM/Scheduler
18.3.1/18.3.1/0.23.2와 19.2.7/19.2.7/0.27.0 exact tuple을 versioned seed catalog로 포함합니다. 정상적인
project-local React 또는 ReactDOM을 항상 먼저 사용하고, 현재 lock profile의 검증된 managed runtime을 그다음,
manifest range에 호환되는 extension seed를 마지막으로 선택합니다. local React pair의 절반이라도 해석되면
seed를 섞지 않으며, 명시된 React/ReactDOM range가 tuple과 맞지 않아도 seed를 사용하지 않습니다. 두 range가
모두 없을 때만 19 tuple이 기본입니다. seed package의 authored identity는 ordinary `react`, `react-dom`,
`scheduler`로 복원되고 subpath와 peer는 active project에서 다시 해석하므로 두 React 인스턴스가 섞이지 않습니다.
Seed는 VSIX에 포함된 exact package byte를 global storage에 복사할 뿐 프로젝트를 수정하거나 lock evidence 없는
임의 package를 network에서 획득하지 않습니다.

프로젝트 `node_modules`와 기존 managed layer 모두에서 선언된 bare package를 찾지 못하면 컴파일러는 실패한
request의 package root만 후보로 삼습니다. 설치 없는 복원에 지원되는 lockfile 근거는 다음 세 가지입니다.

- npm `package-lock.json` v2/v3 `packages` map의 exact URL과 SHA-512 integrity
- Yarn v1 `yarn.lock`의 exact version, public npm/Yarn registry URL과 SHA-512 integrity
- Yarn Berry `yarn.lock`의 exact `npm:` resolution과 `registry.npmjs.org` exact-version metadata가 반환한
  tarball URL 및 SHA-512 integrity. Berry cache checksum 자체는 tarball SRI로 취급하지 않음

extension worker는 이 근거가 closure 전체에 있을 때만 public package를 global storage staging directory로
받습니다. tarball integrity와 추출 경로·package identity를 검증한 뒤 ordinary `node_modules` layout의 immutable
layer로 atomic publish하고, 새 dependency environment로 전체 compile을 한 번만 다시 시작합니다. 여러
unresolved import는 한 번의 bounded acquisition에 합치며 같은 requirement state가 반복되어도 두 번째
download/build를 시작하지 않습니다.

이 과정은 `npm install` 같은 package manager, lifecycle/install script와 프로젝트 config를 실행하지 않으며
프로젝트 `package.json`, lockfile, `.yarn` cache와 `node_modules`를 만들거나 수정하지 않습니다. 프로젝트의
정상 local/PnP resolution이 항상 우선이고, lock 획득 package도 publish 뒤 package별 content digest를 다시
검증합니다. pnpm lock, lockfile 없는 range, SHA-512 근거가 없는 entry, private/custom registry, git
dependency, Yarn workspace와 `workspace:`/`file:`/`link:` dependency 및 native/install-script 산출물이 필요한
package는 자동 network 복원 대상이 아닙니다. 이 경우 원래 resolve 오류를 유지하므로 프로젝트 설치,
unplugged package 또는 명시적 setup이 필요합니다.

최초 요청은 이 package 안의 authored source 경로를 bounded하게 열거하고, 대상 component를 실제로
import해 JSX에서 사용한 곳이 있으면 boolean·number·string·null literal attribute만 자동 props로
수집합니다. 선택 파일의 직접 export function은 same-file 필수 type과 실제 비옵셔널 receiver 경로도
분석합니다. 예를 들어 `field.value.addressInput`은 `{ field: { value: { addressInput: {} } } }`를,
`helpers.setValue(...)`는 no-op function을 만듭니다. optional chain 뒤의 값과 알 수 없는 최종 leaf는
없는 상태를 유지해 UI 분기를 바꾸지 않습니다.

이 값은 가장 낮은 우선순위입니다. 실제 JSX literal, `createPreviewProps`/`previewProps`,
`previewPropsByExport`, Inspector override 순서로 깊은 경로까지 덮어씁니다. dynamic spread, 실행해야 알 수
있는 표현식, 업무 객체와 인증·route 의미는 추측하지 않습니다. source 목록과 정적 사용
근거는 같은 package의 여러 탭과 재빌드가 잠시 공유하지만, 캐시된 props를 제공한 consumer가 dirty이면
즉시 다시 분석합니다.

setup이 없는 기본 프리뷰는 같은 JSX 사용에서 target까지 이어지는 ancestor 한 갈래도 정적 recipe로
만듭니다. lowercase intrinsic element와 직접 import된 wrapper, primitive prop, 일반 children과 명시적인
render-function children만 보존합니다. sibling JSX와 parent component 함수는 실행하지 않으므로 modal의
초기 `open=false`, API effect, route gate 때문에 target이 사라지는 문제를 피하면서 `Table → TableBody →
TargetRow`처럼 구조와 descendant style에 필요한 wrapper만 복원할 수 있습니다. 같은 파일의 private
`Body` 사용은 최대 8단계, 합성 wrapper는 최대 32개까지 따라갑니다.

imported Form/Provider에 dynamic prop이나 spread가 있으면 해당 wrapper를 불완전하게 복제하지 않고 바로
안쪽의 검증된 partial path에서 멈춥니다. 바깥쪽에는 Apollo·Context·Formik·Redux·Router·Theme의
기존 정적 fallback이 적용됩니다. runtime hook 결과, 업무 상태나 동적 Provider `value`는 추측하지 않으며
필요하면 아래 setup/harness가 공급해야 합니다. `reactPreview.setupFile`, `.react-preview/setup.*` 또는
Storybook preview가 선택되면 프로젝트가 명시한 composition을 존중하기 위해 자동 parent slice를 적용하지
않습니다.

이 인덱스는 source 경로, primitive literal, inert wrapper recipe와 파일 metadata만 저장합니다. 전체 app
entry, auth bootstrap, store reducer, route table이나 API client를 import·실행하는 환경 복구 기능이
아니며, target과 선택 wrapper의 실제 component/CSS/library 의존성은 esbuild forward graph가 별도로
수집합니다. 자동 props와 safe partial slice로 충분하지 않은 계약은 아래 setup 또는 작은 preview
harness에 명시합니다.

## 기본 실제 페이지 문맥: Page Inspector

에디터의 `Open Current React File in Page Context`는 실제 작성된 owner를 실행하는 기본 모드입니다. 대상
파일의 default export를 우선하고 없으면 첫 직접 PascalCase export를 선택한 뒤, workspace 안의 실제 JSX
import 사용과 barrel/consumer tsconfig alias를 역추적해 찾은 바깥쪽 importable owner export를 root로
마운트합니다. 이
root가 작성한 children, sibling, 조건식, hook, effect, event handler와 CSS/import graph가 함께 실행되므로
화면에서 보이는 문맥을 독립 export gallery보다 충실하게 확인할 수 있습니다. `Open Current File Export
Gallery`는 page ancestry가 필요 없는 경우에만 선택합니다.

Inspector는 별도로 import identity가 증명된 `createRoot`/`hydrateRoot`/legacy ReactDOM mount를 찾습니다.
현재 파일의 모든 direct component export가 한 module index를 공유하며, 각 export에서 `React.lazy`,
re-export, route `element`, page map과 router local value를 거슬러 실제 entry에 도달한 후보를 우선하고
route layout·guard를 정적 component 경로에 포함합니다. 아직 root가 렌더하지 않은 sibling export도 목록에서
선택해 정적 경로를 확인할 수 있습니다. 이 분석은 entry 파일이나 route
loader를 실행하지 않으며, 안전하게 실행할 root는 계속 importable component export로 분리합니다. 여러
entry가 연결되면 후보 수를 유지하고, 연결되지 않은 export는 standalone fallback으로 명시합니다.
직접 JSX 역추적이 route 배열, helper factory 또는 private owner에서 끝나면 같은 render path의 public
Page/Form/Layout/App export를 추가 mount 후보로 만듭니다. `React.lazy` index는 투명 frontier로 역추적하고,
후보별 root module은 `PAGE PATH`에서 선택하기 전까지 브라우저에서 평가하지 않습니다.

후보 root props는 render path의 다음 caller에서 확인된 literal을 먼저 사용하고 root 파일의 same-file
required type과 실제 property/call 사용으로 부족한 shape를 채웁니다. identifier parameter,
`React.FC<Props>`, local intersection과 styled-components inline function을 지원하고 destructuring default가
있는 prop은 생략해 작성된 기본값이 그대로 실행되게 합니다. 생성된 값은 `Auto values`와 props 상세의
provenance에서 확인하거나 끌 수 있습니다.
target/root가 props 등록 effect를 commit하기 전에 실패해도 Inspector는 같은 inference shape와 부모 JSX literal을
descriptor에서 다시 읽습니다. `Fix blocker`의 `SMART DRAFT`는 여기에 기존 관찰값·사용자 JSON을 우선순위대로
겹치고, runtime 오류의 짧은 property를 일치하는 provenance suffix의 전체 path로 확장합니다. 함수형 leaf는
`[Preview no-op function]` sentinel로 편집·저장되고 project component에 전달할 때만 inert callback으로 복원됩니다.
관찰된 중간 prop이 `null`이면 UI에 노출된 provenance 목록만 보지 않고 bounded full-shape scan으로 가장 깊은
receiver leaf를 찾아 최소 container를 복구합니다. 오류가 `props.…method()` 형태라면 `props` receiver를 제거하고
정적으로 확인된 array/string/function prop에 맞추며, 사용자가 입력한 non-null descendant는 덮어쓰지 않습니다.

분석 비용은 semantic entry-first source selection으로 제한합니다. `index`/`main` 같은 파일명은 검사 후보를
고르는 데만 사용하고 실제 entry 여부는 ReactDOM import/call identity로 결정합니다. 증명된 entry에서 target에
도달하는 literal import 경로만 먼저 파싱하며, 그 경로가 실제 React render 관계가 아니면 target consumer의
선형 reverse import index를 자동 fallback으로 사용합니다. 따라서 filename 관례가 없는 entry도 fallback에서
찾을 수 있고, 모노레포 alias는 두 경로 모두 프로젝트의 정확한 resolver가 판정합니다.

Inspector는 렌더러와 분리된 `Inspector · 파일명` editor tab의 왼쪽에 runtime React Components tree를,
오른쪽에 선택 component의 상세를 표시합니다. project React runtime은 preview에서 한 번만 실행되고 별도 탭은
extension-owned control snapshot과 bounded action만 교환합니다. 상단 page-context 행은 실제로 마운트한 작성자 root와 정적으로 증명한
entry-to-target 경로를 `PAGE COMPONENT`, `PAGE ROOT`, `STANDALONE` 중 하나로 구분합니다.
Components와 상세 사이 separator를 drag하면 두 pane 크기가 바뀝니다. editor 폭이 760px 미만이면 pane이 상하로
전환되고 separator도 세로 크기 조절로 바뀌며, 좌우/상하 비율은 VS Code webview state에 독립적으로 저장됩니다.
키보드 사용자는 separator에 focus한 뒤 방향키, `Shift+방향키`, `Home`/`End`를 사용할 수 있고 double-click으로
현재 방향의 기본값을 복원할 수 있습니다. 이 조작은 companion tab 안에서만 일어나 project React를 remount하지 않습니다.
HTML element tag 대신 부모·형제·자식 function/class/memo/forwardRef component가 중심이며, runtime Fiber를
얻기 전에는 정적으로 증명한 EntryPoint→target 경로가 fallback tree가 됩니다. 다음 값을 확인·조작할 수
있습니다.

- `Highlight`: 선택 component가 commit한 top-level DOM 범위와 이미 열린 source editor의 대응 줄을 함께 강조하거나 해제
- `Main component`: 현재 파일의 대표 default/첫 PascalCase export와 mounted target으로 tree 선택 복귀
- `Pick element`: 실제 DOM을 골라 가장 가까운 React component를 tree에서 선택
- `Serializable props (JSON)`: 선택한 target 또는 ancestor root의 plain data props를 적용·초기화하고,
  `Smart fill props`로 type/receiver/부모 JSX/blocker 증거를 합친 최소 JSON 초안을 적용
- `Auto values`: 확장이 만든 prop/data/hook path와 object/string/function 값을 모두 허용하거나 제외. 실제
  hook object가 일부 값을 제공하면 그 값은 유지하고 정적으로 필요한 nullish leaf만 preview 값으로 보완
- `Payloads`: 관찰된 API/GraphQL 요청과 타입 근거를 선택하고 Auto/Lorem payload를 생성하거나 JSON 직접 적용
- `Console`: hook/Provider와 React lifecycle, project `console.*`, unhandled promise/runtime 오류를 level/text로
  필터링하고 component/JavaScript stack과 failure phase 확인
- `보기 → 출력 → React Preview`: `React preview blocker trace`를 검색해 blocker 종류/owner/source code,
  Auto·Smart·Lorem·DFS가 선택한 최소값, 재렌더 blocker diff와 그 다음 warning/error를 같은 trace ID로 확인
- `Render condition`: `boolean && JSX` 또는 JSX 삼항식의 현재 authored/forced branch를 tree에서 반전하고
  truthy/falsy/fallback branch를 상세 패널에서 선택하거나 authored runtime 값으로 복귀
- `Remount`: 선택한 component error/local state를 새 instance로 초기화
- `Open source`: JSX metadata나 정적 graph가 가리키는 component 위치를 VS Code editor에서 열기

예를 들어 root의 `{ "show": false }` 또는 target의 `{ "enabled": true }`를 적용하면 그 prop을 읽는
삼항식이나 boolean branch가 실제 React render를 거쳐 바뀝니다. component 내부 `useState`는 페이지의
실제 button/input 같은 UI로 조작할 수 있습니다. 오른쪽에 보이는 runtime props와 hook/class state는 own data
descriptor만 제한된 크기로 복사한 read-only snapshot입니다. Inspector의 버전 격리 adapter는 Fiber root를
읽기 전용으로 순회하며 Fiber, hook queue나 local variable slot을 수정하지 않습니다. 함수, symbol, 순환
객체 prop도 JSON editor에 보존하지 않습니다. source 이동은 현재 panel의 마지막 정상 bundle dependency로
증명된 파일만 허용하므로 project code가 webview message로 임의 host 파일을 열 수 없습니다.

Page Inspector build는 reached JS/JSX/TS/TSX module에서 오른쪽이 직접 JSX 또는 exact ReactDOM Portal인
논리곱과 한쪽 이상이 같은 render branch인 삼항식을 계측합니다. Modal/Dialog/Drawer/Popover/Overlay 계열
JSX tag의 `open`, `isOpen`, `visible`, `isVisible`, `show`, `active`, `expanded`, `present`, `hidden` prop과,
overlay component 내부의 단일 early `return null` guard도 가시성 조건으로 표시합니다. project-owned Portal은
Components tree에서 `OverlayPortal`로, hostless child pass-through는 `wrapper`로 표시됩니다.
override가 없으면 object를 포함한 원래 condition 값을 그대로 반환해 JavaScript
truthiness와 `&&` 결과를 보존합니다. tree 조건 행을 클릭하거나 상세 branch 버튼을 누르면 해당 page context를
remount해 memoized owner도 새 결정을 읽습니다. 강제로 연 branch가 API/GraphQL 응답을 요구하면 아래의
no-network payload registry가 먼저 타입 근거로 값을 공급합니다. 프로젝트 Context나 업무 invariant처럼
request payload로 표현할 수 없는 값은 해당 component의 local error placeholder가 계속 안전 경계입니다.

### Preview payload와 Auto 타입 추론

Page Inspector는 backend transport를 실행하지 않고 다음 요청을 탭별 payload registry로 종료합니다.

- Apollo operation은 selection, alias, fragment와 list 구조를 shape로 사용
- global `fetch`는 compiler가 직접 호출을 계측하고, fetch 기반 third-party client의 HTTP(S)와 상대 backend
  후보 요청도 browser boundary에서 차단. `./`·`../` JSON/TXT/CSV fixture는 local fetch로 유지
- 정확히 `axios` package에서 import한 binding의 `get/post/put/patch/delete/head/options` 호출은
  `AxiosResponse` 형태의 메모리 결과로 대체
- 다른 모듈에서 만든 Axios instance처럼 call identity가 사라진 browser client는 최종 `XMLHttpRequest`
  boundary에서 같은 registry payload로 완료
- `axios.get<Employee[]>()`, local interface/type alias, `response.json()` 주변 assertion이 있으면
  string/number/boolean/object/array 타입을 bounded하게 추론

오른쪽 `Payloads` 탭에는 endpoint/operation, source, 타입 근거와 현재 JSON이 표시됩니다. `Auto payloads`는
기본으로 켜져 있고 필드명 의미까지 사용해 결정적인 값을 만듭니다. 예를 들어 `isActive`는 boolean,
`totalCount`는 number, `email`은 형식이 있는 string, `items`는 두 개의 배열 항목이 됩니다. `Generate Lorem`은
같은 타입 구조를 유지한 텍스트 fixture를 만들고, `Apply JSON`은 root array/scalar를 포함한 사용자 값을
그대로 우선합니다. 모든 자동 값은 generated provenance가 표시되며 실제 서버 데이터로 취급되지 않습니다.

같은 탭의 Virtual Backend controls에서 요청별 `Success`, `Empty data`, `HTTP error`와 지연 시간을 선택할 수
있습니다. HTTP error는 대표 status를 선택하고 Fetch/Axios/XHR/Apollo가 기대하는 오류 형태로 받습니다. 성공한
REST POST/PATCH/PUT/DELETE는 같은 resource의 탭 내부 상태를 변경하므로 이후 GET에 반영됩니다. `Reset resource
state`는 이 ephemeral CRUD 상태만 지우고, payload JSON과 response scenario는 별도로 유지합니다.

요청별 Lorem/JSON override, response scenario와 전역 Auto 설정은 해당 preview 탭에만 저장됩니다. 값을 바꾸면 page export를
remount해 Apollo/REST hook cache도 새 payload를 읽게 합니다. setup의 `apolloPreview.resolveOperation`처럼
프로젝트가 명시한 exact fixture는 자동 GraphQL fallback보다 우선합니다. 동적 custom client protocol이나
업무적으로 정확한 enum/state가 필요하면 이 자동값에 의존하지 말고 아래 setup/harness에 명시하세요.

실행 root 역추적은 project-level owner/barrel 최대 8단계와 same-file private owner 최대 12단계로
제한됩니다. 별도 render graph는 최대 32단계와 8개 후보를 유지하고 실제 entry 도달성을 우선합니다.
route config는 구조 근거로 통과하지만 loader/action과 업무 path 의미를 실행·추측하지 않습니다. private
terminal, cycle, 소스/그래프/깊이/경로 한도에서는 dock에 partial 또는 bounded 상태를 표시합니다. 원하는
scenario가 아니거나 root가 필수 auth,
route parameter, store leaf, dynamic Provider value 때문에 실패하면 아래 setup 또는 명시적인 preview
harness가 여전히 올바른 해결책입니다. setup의 `PreviewProviders`, props와 자동 runtime boundary는
Inspector가 선택한 실제 root 바깥에도 동일하게 적용됩니다.

선택 target의 render/lifecycle 오류는 target facade 안의 error boundary가 해당 위치만 inline placeholder로
대체하므로 실제 root와 target 바깥 sibling은 계속 동작합니다. 전체 오류 보고서는 Inspector `Console` 탭과
원래 browser console에 함께 남고 `Retry`/`Remount`는 export별 revision만 증가시킵니다. target보다 먼저 ancestor나 Provider가 실패한
경우에는 더 바깥 export/root boundary가 대신 격리합니다.

Console registry는 동일한 연속 오류를 횟수로 합치고 최신 250건만 preview tab 메모리에 유지합니다. level/text
filter 설정은 Inspector 설정과 함께 복원되지만 실제 log와 application object는 webview state에 저장하지
않습니다. `Clear`는 Inspector 사본만 지우며 프로젝트의 원래 `console.*` 호출과 개발자 console 출력은 바꾸지
않습니다.

highlight, 선택 항목과 props/payload JSON override, Auto payload 설정은 각 Inspector 탭에 따로 저장되고
source/ancestor/entry-chain dependency hot
reload 뒤 다시 적용됩니다. 다만 hot reload는 프로젝트 React root를 다시 마운트하므로 일반 hook state는
보존하지 않습니다. Inspector는 app entry, route table, backend나 개발 서버를 추가로 실행하지 않고
웹뷰 CSP도 모든 외부 연결을 계속 차단합니다.

초기 preview와 Inspector 준비 화면은 `resolving target → analyzing project → discovering components →
preparing runtime → bundling → publishing → loading` 순서의 실제 경계를 표시합니다. 준비가 끝난 기존 탭의
hot reload에서는 작성된 화면을 가리지 않는 작은 Shadow DOM 상태 패널을 사용합니다. 연속 편집으로 새
revision이 예약되면 extension host와 browser runtime이 모두 revision을 비교해 이전 분석·번들의 늦은
진행 메시지나 완료 신호가 최신 상태를 지우지 못하게 합니다. React commit sentinel이 실제 host commit
후에만 준비 완료를 알리고, 정적 ESM load/parse/evaluate 단계에서 entry 자체가 실행되지 않는 경우에는
문서별 token/revision 확인과 30초 watchdog이 영구 loading 대신 오류 상태를 표시합니다. Export Gallery의
fast pass 실패 뒤 같은 revision에서 full pass로 전환해도 이전 단계로 진행 표시를 되돌리지 않으며, Page
Inspector는 처음부터 full page context를 준비합니다. 다음 빌드나 preload가 실패하면 이미 마운트된 마지막
정상 화면을 유지합니다.

## setup 계약

setup 모듈은 아래 named export를 필요한 만큼만 제공할 수 있습니다.

| export                 | 실행 시점               | 역할                                                  |
| ---------------------- | ----------------------- | ----------------------------------------------------- |
| `initializePreview`    | 대상 모듈 import 전     | 전역 객체, 날짜/숫자 유틸리티와 mock service 초기화   |
| `PreviewProviders`     | React render 시         | Theme, Router, GraphQL, Redux 등의 Provider 조립      |
| `previewProps`         | 대상 element 생성 전    | 모든 export에 전달할 공통 정적 props 객체             |
| `createPreviewProps`   | 대상 element 생성 전    | 파일 이름에 따라 공통 props를 만드는 동기/비동기 함수 |
| `previewPropsByExport` | export element 생성 전  | export 이름별로 공통 props를 덮어쓰는 정적 객체       |
| `apolloPreview`        | Apollo client 생성 시   | 자동 정적 응답을 조정하거나 `false`로 비활성화        |
| `themePreview`         | ThemeProvider 생성 시   | exact theme을 지정하거나 `false`로 비활성화           |
| `reduxPreview`         | Redux Provider 생성 시  | exact static state를 지정하거나 `false`로 비활성화    |
| `formikPreview`        | Formik Provider 생성 시 | 정적 initial values를 지정하거나 `false`로 비활성화   |
| `routerPreview`        | MemoryRouter 생성 시    | 정적 location을 지정하거나 `false`로 비활성화         |

`initializePreview`와 `createPreviewProps`에는 `{ documentName, setupKind }`가 전달됩니다.
`PreviewProviders`도 같은 값과 `children`을 받습니다. setup 파일과 도달 가능한 import는 일반 대상
의존성과 똑같이 번들링·감시되므로, 저장 전 편집 내용과 자동 갱신 규칙도 동일합니다.

setup 모듈의 정적 import는 JavaScript 규칙상 `initializePreview`보다 먼저 평가됩니다. 초기화할 전역을
import 시점에 읽는 앱 barrel이나 GraphQL 모듈은 setup에서 직접 import하지 말고, 부작용 없는 Provider와
theme leaf module만 사용하세요. 꼭 필요한 초기화 의존성은 `initializePreview` 안에서 동적으로 import할
수 있지만 실제 API client나 인증 bootstrap을 불러오지 말고 메모리 mock으로 대체해야 합니다.

## 일반 예시

다음 파일을 대상 package의 `.react-preview/setup.tsx`에 둡니다. import 경로와 mock 상태는 각
프로젝트의 실제 Provider 계약에 맞게 조정해야 합니다.

```tsx
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';

import { theme } from '../src/theme/theme';
import type { PropsWithChildren } from 'react';

export async function initializePreview() {
  const previewGlobal = globalThis as typeof globalThis & {
    APP_CONFIG?: Record<string, unknown>;
  };
  previewGlobal.APP_CONFIG ??= {};
}

export function PreviewProviders({ children }: PropsWithChildren) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

// PreviewProviders가 Router를 직접 소유하므로 자동 outer Router는 사용하지 않습니다.
export const routerPreview = false;

export function createPreviewProps({ documentName }: { documentName: string }) {
  return documentName.endsWith('/UserCard.tsx') ? { name: 'Preview user', role: 'Developer' } : {};
}

export const previewPropsByExport = {
  CompactUserCard: { compact: true },
  default: { featured: true },
};
```

setup은 웹뷰 안에서 실행되며 extension host에서는 import되지 않습니다. 그래도 대상 코드와 동일한
신뢰 경계이므로 네트워크 client, 분석 SDK, 실제 인증값 대신 메모리 mock을 사용해야 합니다.

## Apollo 정적 프리뷰

대상 package에서 `@apollo/client`를 찾으면 확장은 그 프로젝트의 복사본으로 `ApolloProvider`를
자동 생성합니다. 내부 link는 `HttpLink`, URI, `fetch`를 만들거나 다음 link로 operation을 전달하지
않습니다. 쿼리의 alias, 중첩 selection과 fragment를 최대 깊이 20·필드 512개까지 따라가며 빈 문자열,
`"0"`, `0`, `false`, 빈 배열과 중첩 객체로 구성된 truthy data root를 즉시 반환합니다. 웹뷰 CSP의
`connect-src 'none'`도 그대로 유지됩니다.

화면 의미상 정확한 값이 필요하면 setup에서 operation별 메모리 결과를 반환합니다. plain object는
`data`로 감싸지고 `{ data, errors, extensions }` 형태도 그대로 사용할 수 있습니다.

```tsx
export const apolloPreview = {
  resolveOperation({ operationName }: { operationName: string }) {
    if (operationName === 'CurrentCompany') {
      return { company: { id: 'preview-company', name: 'Preview company' } };
    }
    return undefined; // 다른 operation은 자동 selection-shaped 결과를 사용합니다.
  },
};
```

`resolveOperation`에는 `operationName`, `variables`, `query`, `documentName`, `setupKind`가 전달됩니다.
함수는 여러 번 호출될 수 있으므로 외부 요청이나 지속되는 부작용 없이 결정적인 메모리 값만 반환해야
합니다. `initialState` 객체를 함께 지정하면 `InMemoryCache.restore()`의 초기값으로 사용됩니다.
프로젝트의 `PreviewProviders`가 자체 Apollo client를 제공한다면 그 Provider가 자동 outer Provider보다
가까워 정상적으로 우선합니다. 자동 계층이 필요 없으면 `export const apolloPreview = false`로 끕니다.

## styled-components theme 프리뷰

대상 package에서 `styled-components`를 찾으면 확장은 같은 package 인스턴스의 `ThemeProvider`를
자동 사용합니다. 활성 파일뿐 아니라 활성 export에서 정적으로 도달한 자식·손자 소스가
styled-components를 값으로 사용하면서 `theme` named value/type import(로컬 alias 허용) 또는
`theme`이라는 이름의 default import를 명시하면 후보로 수집합니다. 상대 경로와 tsconfig alias는
esbuild가 해석한 실제 파일 identity로 합치고, value 근거를 우선한 유일한 후보만 지연 import합니다.
서로 다른 최상위 후보가 동점이면 임의 선택하지 않습니다. 앱 entry나 Provider graph를 검색하지
않으므로 범용성과 부작용 없는 번들링 경계는 유지됩니다.

발견한 theme의 실제 primitive, CSS array와 정상 helper 결과는 그대로 보존합니다. 없는 token은 값
없는 구조 token으로 보완하고, 프로젝트 전역이 없어 실패한 numeric helper가 자체 `.unit`을 제공하면
그 단위로 `rem` 값을 계산합니다. exact color/font token과 정적 body typography가 있으면 웹뷰의 기본
배경·본문색·font family·root font-size에도 적용합니다. 자동 theme을 찾지 못하면 모든 token/helper를
빈 CSS 또는 `0`으로 축약하는 구조적 fallback을 사용합니다.

정확한 theme이 부작용 없는 leaf module에 있다면 setup에서 그대로 전달할 수 있습니다.

```tsx
import { theme } from '../src/theme/theme';

export const themePreview = { theme };
```

setup의 값은 자동 발견 theme보다 우선하며 clone하거나 token을 병합하지 않고 그대로 전달됩니다.
`PreviewProviders`나
Storybook decorator 안의 실제 ThemeProvider는 target에 더 가까우므로 자동 outer Provider보다
우선합니다. styled-components를 쓰지만 자동 경계가 필요 없으면 `export const themePreview = false`로
끕니다.

## React Redux 정적 프리뷰

대상 package에서 `react-redux`를 찾으면 확장은 같은 package 인스턴스의 `Provider`와 inert static
store를 제공합니다. target-reachable source의 `useSelector` 계열 callback과 그 결과를 받은 local
alias에서 이어지는 비옵셔널 property dereference를 구문 분석해, 접근에 필요한 객체 container path만
plain object state skeleton으로 만듭니다. 예를 들어 아래 selector와 접근에는
`{ ui: { panel: { layout: {} } } }` 구조까지만 생성됩니다.

```tsx
const panel = useAppSelector((state) => state.ui.panel);
const mode = panel.layout.mode;
```

생성된 skeleton은 deep freeze되며 같은 store snapshot으로 안정적으로 제공됩니다. `mode` 같은 leaf 값,
enum, boolean, 배열 내용이나 업무상 의미는 추측하지 않으므로 위 예시의 `mode`는 `undefined`입니다.
optional chain, computed key, 동적으로 구성한 selector, 안전성을 증명할 수 없는 alias와 정해진 한도를
넘는 경로도 fail closed합니다. 이 분석은 프로젝트 reducer, middleware, store module, app bootstrap,
API client나 backend를 import·실행하지 않습니다. store의 `dispatch`는 action을 그대로 반환하고 thunk나
listener도 실행하지 않습니다.

정확한 분기나 표시 값이 필요한 selector에는 화면에 필요한 최소 상태를 명시합니다.

```tsx
export const reduxPreview = {
  state: {
    user: { id: 'preview-user', isStaffMode: false },
    items: [],
  },
};
```

setup의 `reduxPreview.state`가 있으면 자동 skeleton을 병합하거나 clone하지 않고 그 exact reference를
최우선으로 사용합니다. 확장은 state를 deep Proxy로 만들거나 slice 이름·권한 값을 추측하지 않습니다.
따라서 계산형 접근, selector가 숨긴 helper 로직이나 의미 있는 leaf 값이 필요하면 위와 같이 setup에서
명시해야 합니다. 정확한 store 동작이 필요하면 `PreviewProviders`에서 프로젝트의 네트워크 없는 store를
직접 제공하세요. 내부 Provider가 자동 outer Provider보다 우선하며, 자동 경계만 끄려면
`export const reduxPreview = false`를 사용합니다.

## Formik 정적 프리뷰

target-rooted graph의 workspace source가 Formik의 `useField`, `useFormikContext`, `Field`, `FieldArray`,
`Form` 같은 Context consumer를 실제로 사용하고 graph 안에 `Formik`, `FormikProvider`, `withFormik` 같은
Provider 근거가 없으면 자동 정적 form boundary를 구성합니다. Formik은 대상 package에서 정상적으로
해석되는 프로젝트 복사본을 사용하므로 hoist된 설치와 모노레포 package도 같은 Context identity를
공유합니다. 부모 화면의 `<Form>`이나 app bootstrap은 역방향으로 검색하거나 실행하지 않습니다.

기본 `initialValues`는 stable frozen 빈 객체이며 `onSubmit`은 아무 동작도 하지 않습니다. 자동 경계는
blur/change/mount validation을 끄고 backend, API client, 프로젝트 validator를 직접 실행하지 않습니다.
정확한 필드 구조가 필요하면 JSON-like plain object만 setup에 제공합니다.

```tsx
export const formikPreview = {
  initialValues: {
    acquisitionPeriod: 24,
    exercisePeriod: 60,
  },
};
```

설정값은 depth·entry·key·array 한도 안에서 prototype-safe plain container로 복사해 deep freeze합니다.
함수, class instance, cycle, accessor와 prototype-sensitive key가 있으면 전체 설정을 거부하고 빈 값으로
돌아갑니다. 실제 내부 Formik Provider가 있으면 React의 nearest-context 규칙으로 우선하며, 자동 경계를
의도적으로 끄려면 `export const formikPreview = false`를 사용합니다.

## React Router 정적 프리뷰

확장은 편집 중인 파일 하나가 아니라 실제 target-rooted esbuild graph에서 요청된 workspace module
전체를 분석합니다. 활성 파일이나 도달 가능한 자식·손자가 `react-router-dom` 또는 `react-router`의 `useParams`,
`useLocation`, `Link`, `NavLink` 같은 location consumer를 import하고 graph 어디에도 `BrowserRouter`,
`MemoryRouter`, `RouterProvider` 같은 provider 근거가 없으면, 최대 한 번 adaptive rebuild해 대상
프로젝트가 설치한 같은 package 인스턴스의 `MemoryRouter`를 제공합니다. 기본 history는 `['/']`이며 앱
route module, browser history, loader/action이나 서버를 불러오지 않습니다.

custom setup이나 Storybook preview가 존재한다는 이유만으로 자동 Router를 끄지는 않습니다. 실제 setup
graph의 Provider/decorator import가 확인되면 nested Router를 피하고, provider 근거 없이 정적 location만
조정하려면 다음처럼 `routerPreview`를 지정합니다.

Page Inspector는 전체 Inspector shell을 Router로 감싸지 않습니다. 애플리케이션 Router보다 안쪽의 page/component 후보를 선택하면 전체 graph에 Router
근거가 있더라도 그 후보는 독립적인 React root branch로 마운트될 수 있습니다. 확장은 후보 아래의 실제
target-facing render path를 별도로 검사하고, render 시점에 상위 Router context가 없을 때만 후보 지역
`MemoryRouter`를 보충합니다. `AppRouter`나 `RouterProvider`를 포함한 후보 및 `PreviewProviders`가 이미
제공한 Router에는 추가 경계를 중첩하지 않습니다. custom wrapper 때문에 provider ownership을 정적으로 찾지
못했더라도 nested Router invariant가 발생하면 후보 지역 MemoryRouter만 제거하고 같은 page를 다시 렌더링합니다.

```tsx
export const routerPreview = {
  initialEntries: ['/companies/preview/contracts/upload?mode=static'],
  initialIndex: 0,
};
```

`initialEntries`는 1~32개의 비어 있지 않은 문자열이며 각 항목은 최대 2,048자입니다. location object와
state는 받지 않고 유효 범위의 정수 `initialIndex`만 전달합니다. 실제 route table과 의미 있는 params가
필요하면 `PreviewProviders`나 harness에서 프로젝트 Router를 직접 구성하고
`export const routerPreview = false`를 사용하세요.

## React Context 구조 보완

workspace의 TypeScript 소스가 React에서 import한
`createContext<{ ... }>(undefined as any)` 또는 명시적인 `null`/`void 0` default를 사용하면, 확장은
인라인 타입에서 완전히 표현할 수 있는 string·number·boolean·배열·함수·중첩 객체를 bounded neutral
값으로 합성합니다. 같은 파일에 선언된 유일한 non-generic interface/type alias도 순환 없이 모든
구조를 합성할 수 있을 때 지원합니다.

imported type, generic declaration, recursive reference, interface `extends`, declaration merging은 가벼운
구문 분석만으로 정확한 의미를 증명할 수 없으므로 변환하지 않습니다. `.js`, declaration,
`node_modules`, workspace 밖 파일, 실제 default 값이나 실행되는 표현식에도 적용하지 않는 fail-closed
기능입니다. 실제 Provider가 있으면 React의 가까운 Provider 값이 자동 default보다 그대로 우선합니다.

별도로, workspace runtime source가 정적으로 import한 `use*Context` hook의 반환값을 직접 destructure하거나
비옵셔널 property로 읽으면 호출부의 실제 사용 형태도 bounded하게 분석합니다. 필요한 plain object
container와 호출되는 leaf의 frozen no-op 함수만 module-level stable fallback으로 만들고 원래 호출을
`hookCall ?? fallback`으로 보완합니다. nested `const` alias·closure와 같은 파일 helper의
`Object.keys/values/entries` 요구는 따라갑니다. optional receiver를 없는 값으로 유지할 수 있으면 short
circuit을 보존하고 필수 root fallback은 유지하지만, fallback이 receiver를 구체화해 의미가 바뀌는 경우는
건너뜁니다. leaf string/number/boolean, computed key, array binding, write, callable/object 충돌,
prototype-sensitive path도 만들지 않습니다. 실제 hook 반환값이 있으면 그대로 우선합니다.

같은 module에서 React import가 증명하는 `use*Context → useContext(LocalContext)` 관계가 있으면 호출부 shape를
그 정확한 raw Context에 등록해 정적 outer Provider도 구성합니다. 여러 consumer의 container/callable 요구는
병합하고 충돌한 Context만 제외하며, lazy module의 늦은 등록도 subscription boundary가 반영합니다. 이름이
`*Provider`인 application component, app bootstrap, query/store/effect는 실행하지 않습니다. 실제 tree나
`PreviewProviders`의 더 가까운 Provider는 자동 값보다 우선합니다. hook이 값을 반환하기 전에 자체 오류를
던지거나 의미 있는 상태가 필요한 경우에는 `PreviewProviders`나 작은 harness가 값을 공급해야 합니다.

이 기능은 Context 존재 때문에 첫 정적 DOM조차 만들지 못하는 경우를 위한 구조 보완입니다. 인증,
선택된 회사, 권한처럼 화면 의미를 결정하는 Context state는 추측하지 않으므로 setup의
`PreviewProviders`나 작은 harness에서 명시해야 합니다.

## 복잡한 페이지와 preview harness

이 확장은 특정 저장소 이름, Redux slice, route, theme token 또는 업무 상태를 내장하지 않습니다.
Apollo operation은 문서 selection 구조만, styled-components는 도달한 파일이 명시적으로 참조한 theme만,
Redux는 selector 접근에 필요한 plain object container만, Formik은 빈 form state만, Router는 정적
location context만 자동 제공합니다. Redux/Formik/custom Context leaf의 상태 의미, route table과 URL
parameter 의미, 권한, locale과 필수 props는 같은
이름이어도 프로젝트마다 다르므로 추측값을 넣지 않습니다. 그런 값은
오류를 숨기면서 잘못된 화면 분기나 부작용을 만들 수 있습니다.

앱 루트에 강하게 결합된 페이지는 작은 `*.preview.tsx` harness를 소스 옆이나 별도 preview 폴더에 두는
방법이 가장 명확합니다. harness는 실제 API client나 앱 bootstrap 대신 메모리 store, 정적 route,
프로젝트 theme와 의미 있는 props만 조립한 뒤 대상 컴포넌트를 default export합니다.

```tsx
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';

import { ComponentUnderPreview } from './component-under-preview';
import { previewStore } from '../preview/preview-store';
import { theme } from '../theme/theme';

export default function ComponentUnderPreviewHarness() {
  return (
    <Provider store={previewStore}>
      <MemoryRouter initialEntries={['/preview']}>
        <ThemeProvider theme={theme}>
          <ComponentUnderPreview title="Static preview" items={[]} />
        </ThemeProvider>
      </MemoryRouter>
    </Provider>
  );
}
```

여러 컴포넌트가 같은 root context를 공유하면 `.react-preview/setup.tsx`의 `PreviewProviders`로 올리고,
화면마다 달라지는 state·route·props는 harness가 소유하게 하세요. 플러그인은 두 방식 모두 일반 React
파일처럼 번들링하며 프로젝트 코드를 extension host에서 실행하지 않습니다.

## 전역 namespace 발견

setup import 전에 `public/index.html`, package `index.html`, `.storybook/main.*`의 최대 1MiB prefix를
문자열로만 읽습니다. `window.NAME = window.NAME || {}`와 같은 빈 객체 초기화에서 안전한 namespace
이름만 추출해 빈 객체를 만듭니다. 파일을 실행하거나 property 값, template placeholder, `.env`, API
키와 라이선스를 복사하지 않습니다. 실제 값이 필요하면 `initializePreview`에서 비밀이 아닌 mock을
명시하세요.

Browserify가 자유 `process`를 주입한다고 가정하는 package는 별도 setup 없이도 bounded browser process
object를 먼저 받습니다. 기존 `globalThis.process`는 덮어쓰지 않으며 fallback은 `platform`, `env`, `cwd`,
`nextTick`과 inert event method만 제공합니다. Node filesystem, network, native binding이나 process 제어는
제공하지 않습니다. application entry에 `window.process = window.process || importedProcess`처럼 동일 global을
확인한 뒤 imported binding을 쓰는 구문이 있으면 entry를 실행하지 않고 정확한 import를 lexical bridge
근거로도 사용합니다. 업무적으로 다른 process 값이 필요할 때만 setup에서 명시적으로 교체하세요.

## export 갤러리

현재 편집기 AST에서 활성 파일의 runtime default와 모든 직접 PascalCase named export를 statement 및
export clause 순서대로 수집해 한 탭에 순차 렌더링합니다. bare `export *`는 그 소스 위치에서 runtime
namespace의 PascalCase 이름을 안정적인 이름 순서로 확장합니다. type/interface/`declare`, type-only와
lowercase helper는 제외됩니다.

각 export에는 작은 이름표와 별도 error boundary가 있으므로 한 컴포넌트가 필수 props나 context 때문에
실패해도 뒤의 export는 계속 표시됩니다. 실패 위치에는 작은 정적 preview placeholder를 남기고 전체
stack은 console warning으로 보존합니다. 공통 props 위에 `previewPropsByExport[exportName]`을 병합하며
default export의 key는 `"default"`입니다. PascalCase 상수가 실제 React component가 아니면 해당
export 위치에만 진단을 표시합니다.

## runtime 오류 보고서 읽기

번들은 성공했지만 React render, lifecycle, setup 또는 비동기 effect에서 실패하면 보고서가 원래 오류의
direct headline을 가장 먼저 표시합니다. 그 아래에서 실패 phase, target/export/setup/classification과
Globals·Apollo·Context·Formik·Redux·Router·Theme 자동 경계의 최종 상태를 확인할 수 있습니다. Globals에는
lexical package bridge와 bounded browser process의 설치/보존 상태가 함께 표시됩니다. `process is not defined`는
Node 실행을 요구하는 오류가 아니라 process compatibility boundary가 설치되지 못한 경우로 별도 분류됩니다.
그 밖의 `name is not defined`는
`missing-runtime-global`로 분류되며, Globals 상태에서 project bootstrap/ambient wrapper 또는 exact
installed-package lexical bridge가 선택되었는지 확인할 수 있습니다. React component stack은 논리적
컴포넌트 경로를, JavaScript stack은 실제 실행 위치를 보여주며 `cause`, `AggregateError.errors`와 오류
객체의 primitive own field도 정해진 깊이·길이 안에서 보존됩니다. React 19 root callback과 JSX
development source metadata가 제공되면 같은 보고서에 더 정확한 component/source 위치를 연결합니다.

Apollo 오류 URL에 압축된 payload가 있으면 client version, invariant message code와 arguments를 로컬에서
decode합니다. 의미를 알아내기 위해 문서 사이트, backend 또는 프로젝트 API에 요청하지 않습니다.
진단 element는 전용 root selector와 CSS reset으로 일반적인 프로젝트 전역 스타일에서 격리되므로
보고서가 앱의 `pre`, 색상 또는 layout 규칙 때문에 사라지는 일을 막습니다. 자동 경계 상태가
`disabled`, `unavailable`, `not requested`, `active`처럼 표시되면 headline과 component stack에 나온 첫
소비자를 함께 확인한 뒤 이 문서의 해당 setup 계약이나 작은 harness를 선택하세요.
