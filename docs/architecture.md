# 아키텍처

## 목표와 불변식

React File Preview는 “현재 파일을 서버 없이 즉시 확인한다”는 한 가지 흐름에 집중합니다.
모든 구현은 다음 불변식을 지켜야 합니다.

- 사용자 워크스페이스에 생성물을 쓰지 않는다.
- HTTP 서버, 포트, 하위 프로세스 기반 개발 서버를 시작하지 않는다.
- 저장하지 않은 현재 문서가 저장된 파일보다 우선한다.
- 워크스페이스 코드는 신뢰 확인 뒤 격리된 웹뷰에서만 실행한다.
- 컴파일 실패가 마지막 성공 생성물을 부분적으로 덮어쓰지 않는다.
- 비동기 빌드 결과는 최신 revision일 때만 화면에 반영한다.
- 프리뷰 패널은 생성 시 선택한 문서 URI를 닫힐 때까지 바꾸지 않는다.
- 패널 포커스와 활성 editor 변경만으로는 빌드하거나 대상을 다시 선택하지 않는다.
- 동적 리소스 정적 발견은 유한한 상대 경로와 명시적인 탐색 한도 안에서만 수행한다.
- 활성 export와 구문으로 증명된 parent render slice에서 도달 가능한 정적 import graph만
  컴포넌트·스타일·asset 수집의 기준으로 사용한다.
- 보조 component-gallery mode의 parent slice는 target까지의 JSX 한 갈래만 합성하며 parent owner 함수와 sibling
  JSX는 실행하지 않는다.
- 기본 Page Inspector는 workspace-bounded syntax/module resolution으로 증명된 actual ancestor export를
  root로 실행한다. 실제 app entry와 구조 경로는 정적으로 찾되 entry 자체나 업무 route loader는 실행하지
  않으며, 모드를 해당 패널에 고정한다.
- 작성자가 둔 dynamic import 경계는 full context의 local ESM chunk로 보존하고, 모든 mode의 cold fast
  pass는 publication 왕복을 줄이기 위해 단일 ESM entry로 합친다. 정적 import 의미는 바꾸지 않는다.
- 활성 파일의 component-shaped direct export는 소스 순서를 보존해 각각 독립적으로 렌더링한다.
- 자동 Provider와 Context default는 프로젝트 package identity와 bounded syntax로 증명되는 최소 구조만
  사용하고 앱 route·state 의미는 만들지 않는다.
- runtime 진단은 backend나 문서 조회 없이 원래 오류와 경계 결정을 보존하고 프로젝트 CSS로부터
  읽을 수 있는 표시를 격리한다.

## 계층과 의존 방향

| 계층               | 책임                                                    | 허용된 주요 의존성                           |
| ------------------ | ------------------------------------------------------- | -------------------------------------------- |
| `domain`           | 요청, 번들, 진단, 저장 위치, 대상 파일 규칙             | 표준 TypeScript/JavaScript                   |
| `application`      | 컴파일 후 게시하는 유스케이스와 port                    | `domain`                                     |
| `adapters/esbuild` | 가상 엔트리, AST 리소스 분석, overlay, 브라우저 번들    | `application`, `domain`, esbuild, TypeScript |
| `adapters/worker`  | background compiler protocol, queue, cancel, byte 이동  | `application`, `domain`, Node worker threads |
| `adapters/vscode`  | global storage 게시와 세션 캐시 정리                    | `application`, `domain`, VS Code             |
| `presentation`     | 패널 manager/session, event routing, revision, CSP HTML | `application`, `domain`, VS Code             |
| `shared`           | 경로 정규화처럼 외부 계층이 함께 쓰는 순수 도구         | Node 표준 라이브러리                         |
| `types`            | asset import용 compile-time ambient 선언                | 런타임 의존성 없음                           |
| `extension.ts`     | 객체 생성, 의존성 연결, 명령 등록                       | 모든 외부 계층                               |

의존성은 안쪽을 향합니다. `shared`는 어떤 계층도 알지 못하는 최소 기술 도구이고, `domain`과
`application`은 VS Code와 esbuild를 알지 못합니다. `presentation`도 구체 adapter를 직접 만들지
않으며 `extension.ts`에서 주입받습니다. ESLint의 `no-restricted-imports` 규칙이 주요 역방향
import를 차단합니다. `types`는 import를 실행하지 않는 ambient 선언만 둡니다.

## 빌드 흐름

1. 컨트롤러가 워크스페이스 신뢰, URI scheme, 확장자와 활성 source editor를 검증하고 새 패널을
   생성합니다. 이 시점에 선택한 문서 URI는 해당 패널 세션의 불변 대상이 됩니다.
2. 세션이 고정 URI를 다시 열어 대상 문서와 같은 workspace의 dirty source 문서를 불변 snapshot으로
   캡처합니다. 포커스 이벤트는 manager bookkeeping만 바꾸며 이 흐름을 시작하지 않습니다.
3. runtime environment resolver가 명시적 setup, `.react-preview/setup.*`, Storybook preview 순으로
   하나의 경계를 고르고 HTML/config 문자열에서 빈 전역 namespace 이름만 제한적으로 발견합니다. Export
   모든 mode의 cold fast pass는 custom setup만 유지하고 자동 Storybook 선택을 full 보강까지 미룹니다.
   같은 package source inventory의 ambient `typeof import()` 선언과 import-backed global assignment는
   별도 evidence cache가 구문만 읽어 정확한 module/export identity로 해석합니다. runtime assignment가
   ambient보다 우선하며 충돌·미해석·budget 초과는 package fallback으로 내려가지 않고 fail closed합니다.
4. export inventory가 editor AST에서 runtime default와 PascalCase named value를 소스 순서대로
   수집합니다. ordered bridge는 explicit export를 정적으로 import하고 bare `export *` 위치만 runtime
   namespace로 확장해 gallery descriptor를 만듭니다. type과 lowercase helper graph는 tree-shake됩니다.
   동시에 package 단위 정적 인덱스가 실제 JSX import 사용의 primitive literal props와 target까지의
   wrapper branch를 찾습니다. props는 descriptor의 가장 낮은 우선순위 값으로 전달하고, setup이 없을 때만
   wrapper branch를 export별 가상 render-slice module로 연결합니다. Page Inspector 요청이면 먼저 모든
   explicit export가 공유하는 entry/render graph를 만들고, default 또는 첫 explicit export에서 시작해 실제
   importable owner를 별도 reverse plan으로 찾습니다.
5. 가상 엔트리는 빈 전역 namespace → setup initialize → target import → 공통/내보내기별 props →
   Provider/decorator 순서를 보존합니다. gallery는 export별 error boundary를 두어 한 렌더 실패가 뒤의
   컴포넌트를 제거하지 않습니다. 깨진 자동 Storybook setup은 추적된 setup graph 오류가 하나라도 있으면
   격리된 새 build에서 setup 없이 한 번 재시도합니다. 동시에 발생한 target 오류는 두 번째 build에서도
   그대로 실패하므로 숨겨지지 않습니다. render slice module은 target props를 원래
   target에 전달하고 선택된 wrapper만 inner-to-outer `React.createElement`로 합성합니다. Inspector mode는
   대신 실제 ancestor export 하나를 descriptor root로 import하고 선택 target import만 facade로 바꿔
   작성된 sibling, 조건식, hook과 event handler를 브라우저 React tree 안에서 그대로 실행합니다.
6. 일반 JS/TS import, package export, tsconfig alias와 symlink는 esbuild의 기본 resolver가 처리합니다.
   workspace source plugin은 `file` namespace의 실제 도달 파일을 `onLoad`에서만 받아 dirty snapshot을
   overlay하고 프로젝트 source를 정적 리소스 transformer에 전달합니다. 가상 bridge·asset·bounded
   macro처럼 프리뷰 전용 요청만 별도 plugin이 해석하므로 일반 graph에 중복 수동 resolver 비용을
   추가하지 않습니다. 같은 파일 identity는 esbuild graph와 canonical snapshot map에서 재사용됩니다.
7. transformer가 TS/TSX AST로 Vite `import.meta.glob`/`globEager`, Webpack `require.context`, 상대
   template·문자열 연결식 dynamic import/require와 정적 `new URL(..., import.meta.url)`을 유한한
   명시적 import/loader map으로 바꿉니다. workspace TypeScript의 React
   `createContext<구조 타입>(undefined/null)`은 inline 구조 또는 같은 파일의 안전한 type 선언에서 완전한
   neutral value를 bounded하게 만들 수 있을 때만 argument를 보완합니다. 같은 단계의 style inventory는
   도달한 styled-components 소스의 정확한 `theme` value/type import를, Router inventory는 consumer와
   provider 근거를 각각 수집합니다. Redux inventory는 `useSelector` 계열 callback과 이후의 안전한
   property alias/dereference에서 객체 container path만 수집해 runtime bridge에 등록합니다. Formik
   inventory는 reached source의 consumer/provider 근거를 독립적으로 등록하고, imported `use*Context`
   analyzer는 실제 호출부의 필수 container/callable 요구와 안전하게 absent로 유지되는 optional receiver를
   구분해 stable fallback 및 exact Context identity 등록으로 변환합니다.
   Page Inspector에서는 같은 transform 경계가 global `fetch`와 정확한 `axios` import의 HTTP method call만
   no-network adapter로 바꿉니다. local TypeScript interface/type alias와 REST generic/JSON assertion은 bounded
   payload shape가 되고, 임의의 project `get()` method나 shadowed `fetch`는 바꾸지 않습니다.
   candidate resolver는 theme의 tsconfig alias와 상대 요청을 esbuild가 해석한 실제 파일 identity로 합칩니다.
   동시에 exact dependency 후보 토큰이 있는 reached module만 one-file lexical binder로 검사합니다. import,
   local/shadow/type/property/JSX intrinsic/`typeof` probe는 제외하고 실제 자유 식별자만 package fallback 근거가 됩니다.
8. asset plugin이 `?raw`, `?url`, SVG component convention과 가장 가까운 package의 `public` root
   asset 및 root-relative CSS `url()`/`@import`를 framework
   config 실행 없이 JavaScript module 또는 data URL로 변환합니다. resolver는 읽기 전에 일반
   파일 여부와 파일당 5 MiB·합계 20 MiB 제한을 검증합니다. 별도 Sass plugin은 가장 가까운 package가
   선언한 `sass`만 사용해 SCSS/Sass를 CSS로 만들고 loaded partial을 dependency로 보존합니다. compiler 부재나
   style 오류는 빈 CSS와 warning으로 낮춰 React module build를 계속합니다.
9. 첫 graph가 Router consumer는 포함하지만 provider는 포함하지 않았거나 exact installed-package 전역의
   자유 참조를 증명하면 컴파일러가 같은 target root로 최대 한 번 adaptive rebuild합니다. 두 요구가 함께
   발견되어도 rebuild는 한 번으로 합칩니다. project runtime/ambient wrapper bridge는 첫 build부터 적용되고
   bare package보다 우선합니다. esbuild inject가 lexical scope를 판정하므로 local binding은 바뀌지 않으며,
   미사용/broken dependency 후보는 graph에 등록하지 않습니다.
10. generated entry는 모든 setup/bridge/target dynamic import 전에 기존 `globalThis.process`를 보존하거나
    Browserify 호환 package에 필요한 bounded browser metadata, `cwd`와 microtask scheduler만 설치합니다.
    symbol state를 통해 hot entry가 같은 fallback을 재사용하며 Node I/O나 native API는 추가하지 않습니다.
    reached package의 `fs` 같은 Node built-in은 callable neutral CommonJS proxy로 연결되어 resolution만
    만족하고 모든 호출은 `undefined`를 반환하므로 host capability를 노출하지 않습니다.
11. esbuild가 `platform: browser`, `format: esm`, `write: false`, `jsxDev: true`로 Export Gallery fast pass는
    `splitting: false` 단일 entry를, Page Inspector를 포함한 full pass는 `splitting: true`로 원래 dynamic
    import 경계의 `chunks/[hash].js`와 선택적 집계 CSS를 메모리에 만듭니다. 동일 target/runtime plan은 native
    `context.rebuild()`가 parsed graph를
    재사용하고 editor snapshot과
    compilation-local transformer만 명시적 mutable boundary로 교체합니다. nested lazy tree는 export별
    Suspense 아래에서 실행되며 정적 자식 import를 임의로 lazy component로 바꾸지 않습니다.
12. application 유스케이스가 성공한 번들만 artifact store에 넘깁니다.
13. store가 private session root에 content-addressed entry/CSS와 검증된 상대경로 chunk를 쓴 뒤 opaque
    entry URI와 한 개의 bundle ownership reference를 반환합니다. 서로 다른 revision이나 탭이 같은 파일을
    사용하면 별도 shared-file reference가 마지막 owner까지 안정된 URI를 보존합니다. 마지막 owner가 파일을
    지운 뒤에도 path/digest tombstone은 session 동안 남아 브라우저가 본 URL을 다른 byte로 다시 쓰지 않습니다.
14. 첫 성공은 전체 HTML을 설정하고, 이후 성공은 cache-busted entry ESM·선택적 CSS URI와 revision token을
    기존 웹뷰에 보냅니다. 웹뷰는 새 stylesheet/ESM과 setup 이후 bridge·props·target graph를 기존 tree 뒤에서
    준비하고 모두 성공한 뒤에만 root를 unmount·교체해 revision/applied/retained 확인을 반환합니다. 준비 실패는
    현재 tree와 lease를 유지하고, 교체 뒤 오류·메시지 전달 실패·30초 timeout은 전체 HTML로 복구합니다. 다음
    compile 자체가 실패해도 현재 정상 문서를 파괴하지 않습니다. 이 경로는 서버 없는 rebuild/remount이며
    React Fast Refresh state 보존을 제공하지 않습니다.

store는 bundle/shared-file reference mutation을 하나의 Promise queue에서 직렬화하되 독립적인 directory,
write, delete는 최대 16개 비동기 filesystem operation으로 처리합니다. portable path와 full byte digest가 다르면 과거 URL까지
overwrite를 거부하고, 부분 write 실패는 시작된 worker가 모두 끝난 뒤 이번 publish가 새로 만든 파일만
rollback합니다. 같은 bundle lease와 서로 다른 bundle이 공유하는 entry/CSS/chunk reference를 구분하며,
확장 종료 시에는 controller가 모든 session lease를 반환하고 queue가 끝난 다음 private session root 삭제를
기다립니다.

## 패널 세션과 이벤트 라우팅

`PreviewController`는 확장 창 하나의 manager이고 `PreviewPanelSession`은 패널 하나의 고정 URI와
`component`/`page-inspector` render mode, revision, debounce timer, 의존 파일·탐색 디렉터리와 artifact
lease를 소유합니다. Open 명령은 항상
새 session을 만들므로 같은 파일도 여러 탭에서 열 수 있습니다. `onDidChangeActiveTextEditor`는 구독하지
않으며 `onDidChangeViewState`는 마지막 포커스 session만 기록합니다. 에디터 탭 제목은 고정 URI의
basename만 사용하지만 진단과 내부 document identity는 workspace-relative path를 계속 보존합니다.

`page-inspector` session은 renderer panel 옆에 `PreviewInspectorCompanionPanel`을 하나 더 만들지만 project
bundle은 renderer에서만 평가합니다. renderer의 isolated Shadow DOM workbench는 화면에서 숨긴 채 inert
HTML/CSS snapshot만 companion으로 전달하고, companion은 opaque control ID를 가진 click/input/change/keyboard
action만 원래 renderer로 돌려보냅니다. renderer를 닫으면 companion도 폐기하지만 companion만 닫으면 preview,
artifact lease와 hot reload session은 계속 유지됩니다.

문서 편집·저장 이벤트는 모든 session에 전달되지만 각 session은 자신의 대상, 마지막 의존 그래프,
정적 패턴 watch directory에 포함된 경우만 rebuild를 예약합니다. Refresh는 포커스된 프리뷰를 먼저,
그다음 활성 source와 같은 대상의 가장 최근 session을 선택하며, 일치하는 session이 없으면 새 탭을
엽니다. 어떤 경우에도 기존 session을 다른 URI로 retarget하지 않습니다.

Page Inspector와 Export Gallery cold session은 reverse package/workspace 분석을 생략한 `fast` request로
target-reachable graph를 먼저 게시하며, runtime settlement 뒤 `full` request가 authored ancestor,
setup/props/global 문맥을 보강합니다. Inspector는 이 첫 artifact를 direct target 상태로 명시하고 full 결과가
도착하면 같은 webview에서 실제 page tree로 교체합니다. 한 번 full context가 성공한 session은 이후 revision에서
증분 full request 하나만 실행합니다.
새 revision은 이전 resolve/compile/publish의 `AbortSignal`을 즉시 중단하고, native context에는 `cancel()`을
전달하며 debounce timer에는 최신 revision 하나만 남깁니다.

full build는 기본적으로 ESM splitting으로 실제 dynamic import 경계를 유지합니다. 최종 split 결과가 2,048개
local output file을 넘으면 planner에 전달하기 전에 다른 native context key로 `splitting: false` 재빌드를
수행합니다. esbuild가 dynamic module을 `Promise` 기반 lazy initializer로 남기므로 module 실행 시점은 loader
호출 전까지 지연되지만, byte-level artifact는 entry에 coalesce되어 수천 개 파일 I/O를 피합니다. 이 결정은
target/runtime identity별 bounded LRU cache에 저장해 hot reload가 과도한 split attempt를 반복하지 않으며,
일반 graph와 새 compiler session은 계속 file-level splitting을 우선합니다.

## 패키지 단위 초기 정적 환경 인덱스

`findPreviewProjectRoot`는 대상 파일에서 workspace root까지만 위로 이동해 가장 가까운 `package.json`을
package 경계로 선택합니다. package manifest가 없으면 workspace 자체를 사용합니다. 따라서 모노레포의
leaf package 프리뷰는 먼저 자기 source index만 역방향 탐색합니다. actual owner가 없고 workspace manifest가
sibling package 가능성을 증명할 때만 workspace index로 한 번 확장하며, 단 하나의 nested app만 선언된
workspace는 전체 repository scan을 생략합니다. workspace는 계속 신뢰·파일 접근의 상위 보안 경계입니다.

`PreviewProjectUsageCache`는 최초 full 요청에서 package 안의 authored JS/TS source 경로를 구문 분석용 정적
환경 인덱스로 열거하고, 같은 `(workspaceRoot, projectRoot)`의 여러 탭과 hot rebuild가 그 Promise를
공유합니다. 인덱스는 최대 16,384개 파일, 파일당 4 MiB, 합계 128 MiB와 동시 read 16개로 제한하며
`.git`, 생성 output, `public`, `node_modules`, symlink를 순회하지 않습니다. 이 단계가 보존하는 것은 inert path,
primitive JSX prop, parent-slice frame과 file metadata뿐이며 application module, app entry, 인증
bootstrap이나 API client를 import하거나 실행하지 않습니다. 실제 target/선택 wrapper의 자식
component·CSS·asset·library graph는 이후 esbuild가 forward graph로 결정합니다.
`PreviewProjectFileAnalysisCache`는 disk path+mtime+size 또는 dirty snapshot SHA-256을 identity로 source text,
module/entry fact와 literal import fact를 파일별 재사용합니다. Page Inspector에서는 EntryPoint/render graph가
이 source budget을 가장 먼저 사용하고 props·ancestor 분석이 같은 cache를 재사용합니다. 읽기·edge·depth·path
한도로 파일이나 후보가 누락될 수 있으면 결과를 일반 orphan으로 단정하지 않고
`truncated`/`graph-limit`으로 보존합니다.

`PreviewImplicitGlobalEvidenceCache`는 이 경로 목록에서 runtime assignment와 ambient import type만 bounded하게
읽고 선택된 declaration/wrapper metadata와 editor overlay가 유지되는 동안 package 16개까지 재사용합니다.
개별 read 16 MiB, 합계 128 MiB, source 16,384개, 동시 read 8개와 후보 512개 제한을 적용합니다. 선택된
wrapper module은 일반 workspace source plugin을 거쳐 HMR dependency가 되지만 app entry 자체는 import하지 않습니다.

target/export별 reverse usage 결과는 보수적으로 해석 가능한 import와 JSX의 boolean·number·string·null
literal만 자동 props로 사용합니다. 별도의 `reactExportPropInference`는 직접 export function parameter의
same-file required type과 비옵셔널 receiver/call/iteration 경로만 bounded shape IR로 만듭니다. identifier
parameter, local intersection/heritage, React FC annotation과 styled inline function을 해석하되 parameter
default는 materialize하지 않습니다. unknown leaf와 optional receiver는 만들지 않고 prototype key, depth 10,
node 192, export 32 한도로 닫습니다. generated
entry의 `previewAutomaticPropsRuntimeSource`가 이를 neutral value로 materialize하고 실제 usage/setup/Inspector
값을 깊이별로 overlay합니다. `parentSlice/previewParentSlice`는 target occurrence에서 owner boundary까지
JSX ancestor를 안쪽부터 수집하고 `previewParentSlicePlan`은 같은 파일의 private owner 사용을 최대 8단계
따라갑니다. intrinsic/imported wrapper와 일반/render-function children만 허용하며 전체 frame은 32개로
제한합니다. imported wrapper에 dynamic prop·spread가 있거나 local/member wrapper를 정적으로 재현할 수
없으면 그 지점에서 fail closed하고 이미 증명한 inner partial path만 유지합니다.

`previewParentSliceSource`는 이 inert IR을 target과 선택 wrapper import만 가진 ESM component로 만들고,
`previewParentSlicePlugin`이 export별 가상 모듈을 제공합니다. parent owner와 sibling source는 import하지
않으므로 route gate, effect와 modal open state를 실행하지 않습니다. wrapper import가 도달한 CSS-in-JS와
CSS graph는 일반 esbuild forward traversal을 그대로 사용합니다. custom/Storybook setup이 있으면 명시적
composition이 우선하므로 자동 parent slice를 비활성화합니다.

선택된 consumer path는 session dependency에 합쳐 hot reload를 유발합니다. positive 결과는 관련 file fact가
유효한 동안 재사용하지만 해당 dirty editor snapshot이 있으면 SHA-256 identity로 즉시 다시 분석합니다.
5초 뒤에는 package 경로 inventory fingerprint를 다시 확인해 생성·삭제를 반영하고, 경로 집합이 같으면
positive/partial-positive usage와 render graph를 유지합니다. negative 결과는 새 usage를 받도록 만료됩니다. cache는
compiler당 package 16개와 target 256개로 제한하고 shutdown에서 비웁니다. setup의 공통 props와 export별
props는 자동 근거보다 항상 우선합니다.

`previewInspectorSmartPropsRuntimeSource`는 이 prop shape/provenance를 selected page candidate descriptor의
target/root metadata, 부모 JSX literal, 마지막으로 commit된 base props와 JSON override에 결합합니다. contained
render error의 짧은 property는 provenance path의 exact suffix와 일치할 때만 full path로 확장하고, 일치하지 않는
field는 top-level 요구로 유지해 임의의 business object 계층을 만들지 않습니다. 함수 leaf는 JSON-safe sentinel로
보존하며 `PreviewPageInspectorRootRenderer`와 `PreviewInspectorTargetRenderer`가 project render 직전에만 no-op
callback으로 materialize합니다. 따라서 첫 target commit 전 실패와 callback-only props도 `{}`로 축소되지 않습니다.

## Page Inspector 실제 문맥 경계

Page Inspector는 기본 명령의 composition 정책이며 component gallery의 parent slice를 확장하는 flag가
아닙니다. 이전 `reactPreview.openPageInspector` command id는 호환 alias로 유지하고, 독립 export 렌더링은
`reactPreview.openComponentGallery`가 명시적으로 선택합니다.
`PreviewRenderMode`는 command가 panel session을 만들 때 선택하고, session이 고정 URI를 다시 해석하는 모든
수동·자동 rebuild request에 같은 값을 복사합니다. 따라서 같은 파일의 component gallery와 Inspector를
동시에 열어도 한 패널의 refresh가 다른 패널의 root 선택이나 상태를 바꾸지 않습니다.

브라우저 runtime의 page corridor는 selected candidate subtree를 host element 없는 commit boundary로 감싸고,
별도의 target facade boundary와 함께 상태를 기록합니다. 성공은 두 boundary가 direct-target 전환 없이 같은
candidate render에서 살아 있을 때만 성립합니다. bounded gate DFS가 소진되어도 candidate root는 유지되며,
target-only module은 명시적 진단 선택에만 지연 로드되고 blocker resolution에는 포함되지 않습니다.

렌더 관점은 project 의미를 추측하지 않는 두 개의 명시적 scenario로 나뉩니다. 기본 `authored-page`는 선택한
candidate가 만든 fallback/error/empty UI까지 변경 없이 유지하고, 화면 문자열이나 component 이름을 분류 근거로
사용하지 않습니다. `file-components`는 `renderChainsByExport`로 증명된 현재 파일 export마다 tree-shakeable direct
specifier를 등록하되 사용자가 view를 선택하기 전에는 평가하지 않습니다. 선택 뒤에도 export별 dynamic import,
Suspense와 error boundary를 사용해 한 module/render 실패가 sibling export overview를 제거하지 않습니다.
page root만 commit되고 target이 없는 상태는 application error가 아니라 `TARGET ABSENT` flow outcome으로 표시하며,
실제 exception/value blocker 판정과 분리합니다.

Inspector presentation은 pseudo-node의 존재와 실제 blocking 상태를 분리합니다. condition은 항상 branch control,
manual/Auto hook fallback과 유효 payload는 assisted preview value, unresolved seed·contained render error·소진된
target reachability만 active blocker입니다. 상단 status와 tree role label은 같은 판정 함수를 사용하므로 범례,
component tree, blocker editor가 서로 다른 성공 의미를 표시하지 않습니다.
blocker Smart fill은 required-path evidence가 있는 hook에서는 빈 호환 root에 demanded leaf만 만들고, descriptor로
확인한 scalar/callable 타입과 array item 한 개만 유지합니다. backend request는 normalized selection/type shape의
필드와 list 한 항목만 생성합니다. manual hook/payload가 있으면 non-null user leaf를 우선하고 누락 shape만 합칩니다.
page-path batch는 같은 reachability key의 hook/data record만 바꾸고 이미 증명된
target-guided condition override를 지우지 않으며 revision과 remount를 한 번으로 합칩니다.

`inspector/previewInspectorAncestorPlan`은 default export를 우선하고 없으면 첫 explicit export를 target
frontier로 사용합니다. Inspector 전용 bounded workspace inventory에서 실제 JSX import 사용을 구문으로
찾고, named/`export *` barrel과 consumer별 tsconfig/jsconfig alias를 통과합니다. 같은 파일 private owner를
최대 12단계 통과하면서 importable owner export를 project level 최대 8단계까지 역추적합니다. 결과 edge는
source path, export, occurrence와 literal prop 근거만 보존합니다.
`previewStaticModuleResolver`는 consumer의 nearest tsconfig/jsconfig를 source glob 확장 없이 읽고 TypeScript
module resolution cache로 alias identity만 증명합니다. facade build 단계는 guarded `build.resolve`로 같은
canonical target을 다시 확인하므로 정적 계획과 실제 esbuild graph가 다른 모듈을 계측하지 않습니다.
더 바깥쪽 사용이 없으면 complete root이고, private terminal·cycle·depth limit에서는 이미 증명된 root와
명시적 stop reason을 가진 partial plan으로 닫힙니다. render graph의 ranked path별로 같은 reverse traversal을
수행해 mount 결과가 다른 `pageCandidates`를 최대 6개 보존하며, source inventory와 frontier별 JSX 후보 점수는
한 planner call에서 공유해 대안 수만큼 저장소를 다시 읽거나 AST를 다시 만들지 않습니다. 기존 `root`와
`edges` 필드는 첫 후보를 가리키는 호환 view이고 hot-reload dependency는 모든 후보의 합집합입니다.
JSX를 포함한 route 배열/router 객체는 mount root로
승격하지 않으며 page/layout/route/App 관례, 테스트·story 경로 감점과 local owner 깊이로 후보를 결정적으로
정렬합니다. 업무 route 의미는 추론하지 않고 workspace 밖 app shell은 검색하지 않습니다.
styled-components import identity가 증명된 `styled(component)\`...\`` tagged template은 inline component가
target occurrence를 소유할 때만 owner로 승격하고, 다른 tagged template factory는 mount root로 쓰지 않습니다.

`renderGraph`는 위 실행 root 계획과 독립된 application structure 계획입니다.
`previewRenderEntrySourceSelection`은 `index`/`main`/`entry` 계열 filename을 검사 우선순위로만 사용하고,
아래 semantic ReactDOM evidence가 증명한 entry에서 target까지 exact resolver로 literal import를 정방향
탐색합니다. 연결된 작은 source slice만 먼저 full AST graph로 만들며 import reachability가 실제 render
reachability가 아니면 `previewRenderSourceSelection`으로 전환합니다. 이 fallback은 모든 literal import를
한 번만 읽어 relative dependency reverse index와 alias basename 후보 bucket을 만들고, alias 후보는 exact
resolver 결과를 memoize하므로 반복적인 workspace 전수 비교 없이 target consumer closure를 계산합니다.
nearest tsconfig/package에서 먼저 시도하고 entry가 없을 때에만 전체 bounded workspace로 다시 넓힙니다.
`previewEntryPointEvidence`는 `react-dom/client`/`react-dom` import identity와 lexical shadow를 확인해
`createRoot().render`, const root render, `hydrateRoot`와 legacy mount만 entry로 인정합니다.
`previewRenderModuleFacts`는 ESM/CommonJS default와 named export/local binding, re-export, `React.lazy`,
JSX/createElement, route element와 top-level page map/router 값 흐름을 inert fact로 만듭니다.
`previewRenderChainPlanner`는 한 module index를 모든 direct export가 공유하게 하고 export별로 target에서
entry까지 최대 32단계·8개 후보를 탐색합니다. route/layout/guard wrapper source와 모든 export의 선택
경로는 dependency가 되며,
복수 app entry는 `ambiguous`, 사용처가 없는 export는 `entry-unreachable`, 한도 초과는 `truncated`로
분리합니다. 이 계획은 entry 실행 권한을 주지 않고 실제 ancestor 후보 점수와 toolbar 설명만 보강합니다.

`previewInspectorRootPlugin`은 후보 메타데이터와 후보별 dynamic import loader를 기존 target descriptor 계약에
연결합니다. browser session의 `selectedPageCandidateId`가 선택한 loader만 실행하고, 다른 후보 module은 사용자가
`PAGE PATH`를 바꾸기 전까지 평가하지 않습니다. esbuild는 build-time에 유한 후보 graph를 모두 검증하므로
선택 시 별도 서버나 두 번째 compiler process가 필요하지 않습니다.
`previewInspectorModuleFrontiers`는 ESM barrel뿐 아니라 literal `React.lazy` default/named 재노출을 투명
frontier로 확장합니다. `previewInspectorRenderPathRoots`는 render graph의 helper/route/value 노드 중 실제
component-shaped public export만 Page/Form/Layout/App 체크포인트로 바꾸고, 다음 path caller의 literal props와
root-local inference를 후보 descriptor에 결합합니다. 대형 inventory에서는 direct JSX ancestry를 두 owner로
제한한 뒤 이 graph 체크포인트를 사용하며, unrelated lazy registry는 lexical prefilter와 file-fact cache로
재분석하지 않습니다.
`previewInspectorTargetPlugin`은 그 root의 forward graph에서 원래 target module로 향하는 exact import만
facade로 바꾸고, 선택된 component export를 public props를 전달하는 wrapper로 계측합니다. 원본 module의
나머지 export 의미를 보존하며 extension host에서 component를 import하거나 실행하지 않습니다. 실제 root가
import한 children, sibling, dynamic branch, hook/effect, CSS와 library는 ordinary esbuild graph가 결정하고
사용하지 않은 target sibling export는 tree-shake됩니다. setup, 자동 Provider, CSP와 asset policy는 일반
preview와 같은 바깥 경계를 계속 사용합니다.

`staticResources/reactConditionalRendering`은 Page Inspector full build에서 esbuild가 실제 요청한 workspace
module만 TypeScript syntax tree로 읽습니다. 오른쪽 operand가 직접 JSX인 logical-and와 JSX branch를 가진
conditional expression의 condition operand만 전역 Inspector API resolver로 감싸며 expression을 한 번만
평가합니다. override가 없으면 원래 primitive/object를 그대로 돌려주고 forced false/true에서만 boolean을
반환합니다. module당 128개, session당 512개로 제한하고 parser recovery나 겹치는 range는 fail closed합니다.
같은 transform은 exact `react-dom` import의 `createPortal` branch, Modal/Dialog/Drawer/Popover 등 overlay-shaped
JSX tag의 bounded visibility prop과 overlay-named 또는 portal-owning 함수의 단일 early `return null` guard도
수집합니다. `hidden`과 null guard는 resolver 바깥에서 반전해 UI의 true가 항상 visible을 뜻하게 하면서
override가 없을 때 authored branch 의미를 유지합니다. 일반 component의 같은 이름 prop과 임의 함수의 null
guard는 계측하지 않습니다.
`previewInspectorConditionRuntimeSource`는 compiler-issued hash ID의 authored/effective/override 상태와 자동 prop
값 허용 여부를 pinned hot session에 유지합니다. target-guided override는 webview state에 저장하지 않는 별도
ephemeral map에 두고 명시적인 사용자 override보다 낮은 우선순위로 적용합니다. 변경 시 shared revision key로
authored root를 remount합니다. commit-producing 자동 condition은 blocker trace identity와 연결된 작은 transaction으로
등록합니다. 다음 fatal boundary/preview runtime 오류가 같은 attempt에 귀속되면 자동 override만 제거하고 해당
reachability key의 rejected set에 넣으며 shared condition revision으로 바깥 export 오류 경계까지 remount합니다.
따라서 authored branch가 latched placeholder 뒤에 남지 않습니다. persisted user override는 rollback 대상이 아니며
candidate/export/hot graph reset이 rejected set을 폐기합니다.
`previewInspectorConditionUiRuntimeSource`는 JSX-dev source path/line이 같은 가장 가까운 component에 condition
pseudo node를 붙이고, 소유자를 증명하지 못하면 `Render conditions` root에 둡니다. Fiber 자체는 수정하지 않습니다.

`previewInspectorTargetReachabilityRuntimeSource`는 선택 page candidate의 정상 commit과 target facade boundary의
실제 mount를 별도로 비교합니다. target이 없으면 render-chain/ancestor source에 속한 condition만 대상으로
`targetBranch`, fallback의 반대 branch, target 이름과 일치하는 logical-and를 discovery 순서대로 하나 선택합니다.
반복되는 `Modal`/`Page`/`Layout` 같은 shared owner는 이름/label 점수나 runtime-only owner 관찰만으로 corridor에
들어오지 않습니다. compiler가 direct target에서 발급한 condition ID, 선택 export identity 또는 정규화된
render-path source가 일치해야 합니다.
한 번의 commit에는 gate 하나만 바꾸고 remount 뒤 새로 도달한 hook/API consumer를 다시 관찰하므로 탐색은
root에서 target 방향의 bounded DFS처럼 진행됩니다. 최대 16단계와 두 번의 quiet pass 뒤에도 target이 없으면
command-selected export의 per-export virtual dynamic entry를 로드합니다. 직접 entry는 target facade의 정확한
named/default binding만 정적으로 import하므로 다른 file export와 그 dependency graph는 tree-shake됩니다.
hook fallback과 data request에는 traversal key를 붙여 같은 경로에서 발견한 required property만 `Path blocker`
payload inventory에 합칩니다. 이 상태와 자동 condition 결정은 hot descriptor/page/export 변경 시 폐기됩니다.

`previewInspectorRenderTreeUiRuntimeSource`는 collector snapshot 위에 data-only `Workspace React render root`를
두고, 선택 export의 inert render-chain에서 entry/lazy/route/wrapper prefix를 읽어 실제 mounted page Fiber와
연결합니다. application entry module이나 route loader를 실행하지 않으므로 인증/bootstrap side effect는 다시
도입하지 않습니다. target facade가 등록한 같은 파일의 모든 live boundary는 한 application slice로 합치고 각
노드에 current-file export identity를 부여합니다. 현재 page candidate에서 실행되지 않은 direct component
export는 `Unmounted current-file exports` branch로 보존해 정적 경로와 live 위치의 차이를 숨기지 않습니다.

`previewInspectorBlockerUiRuntimeSource`는 condition에 더해 target 미도달 path blocker, render-only hook fallback,
no-network data request와 target-local contained error를 compiler가 기록한 owner name, source path/line,
React component stack 순서로
가장 정확한 mounted component 아래에 붙입니다. 실패로 해당 Fiber가 이미 제거되었으면 가장 가까운 surviving
ancestor 아래에 data-only blocked-owner component를 합성해 blocker를 원래 tree 계층에 보존하며, 공용 unlocated
그룹으로 blocker를 모으지 않습니다. Context용 inert route node는 owner 후보에서 제외하므로 blocker가 정적 경로
설명에 잘못 매달리지 않습니다. hook blocker의
compiler-generated 값과 사용자가 입력한 bounded JSON override는 각각 `auto`/`manual`로 구분하며, explicit
override는 전역 Auto values가 꺼져 있어도 해당 compiler-issued hook ID에서만 우선합니다. Auto pass는 override를
지우고 현재 required-path overlay로 compiler 값을 다시 보완합니다. override는 prototype key와 64 KiB 상한을 적용해 webview state에
저장되며 backend나 extension host의 project runtime으로 전송하지 않습니다.
`previewInspectorFailureEvidenceRuntimeSource`는 boundary error의 immediate missing property와 innermost-first React
component stack을 bounded data로 바꾸고 inline placeholder와 tree가 같은 culprit를 사용하게 합니다.
`previewInspectorBlockerValueRuntimeSource`는 compiler fallback의 function/undefined를 JSON-visible template으로
복사하고 dotted/index/array-item required path를 물질화합니다. property semantic으로 boolean polarity, number,
ID/email/date/URL/status, callable과 collection을 구분하며 collection item 경로는 최소 한 개의 합성 record로
확장합니다. 이 template은 editor 전용 복사본에 그치지 않고 `previewInspectorGeneratedValueRuntimeSource`의
descriptor-safe overlay를 통해 실제 Auto hook value에도 적용됩니다. 따라서 실제 non-null sibling/function/class
identity는 이기고 missing plain leaf만 추가됩니다. 명시적인 no-op sentinel은 project hook에 값을 돌려주는
순간에만 inert function으로 변환되므로 editor payload가 빈 `{}`로 축약되지 않으면서 persisted state는 계속 JSON-only입니다.
`previewInspectorGeneratedValueRuntimeSource`는 required path의 array item, numeric item 또는 allowlisted collection
method call을 exact container의 강한 구조 증거로 사용합니다. 이때만 non-array plain placeholder를 generated
Array로 교체하며 authored sibling, class/React element, 단순 semantic-name object와 기존 Array는 그대로 둡니다.
`previewInspectorRuntimeFallbackScopeRuntimeSource`는 entry revision, render scenario, candidate ID, 선택 export와
direct/page perspective로 compiler-owned fallback/effect 상태를 분리합니다. scope 전환 시 user JSON override는
보존하되 inferred value/completion과 effect execution/isolation을 폐기합니다. 새 artifact는 준비 시 descriptor를
revision-local로만 보관하고 실제 activation의 root render 직전에 shared scope를 교체합니다. effect invocation도
scope key를 캡처해 이전 후보의 늦은 Promise rejection/cleanup이 새 후보 상태를 다시 오염하지 않습니다.
모든 project/setup/자동 Provider 바깥의 extension-owned keyed Fragment는 candidate/export/scenario identity가
바뀔 때 provider subtree 전체를 remount하므로 이미 소비된 이전 fallback 값도 새 corridor에 남지 않습니다.
외곽 경계와 내부 loader는 authored-page 안의 명시적 target-only 상태까지 포함한 하나의 direct/page 판정 helper를
공유하므로 page/direct scope가 서로를 반복 덮어쓰지 않습니다.
application root가 Router를 소유하면 성공한 `react-router(-dom)` hook 결과를 exact identity로 반환해 direct
artifact에서 생성한 location/params가 page Router 결과를 보완하지 않게 합니다.

`previewInspectorBlockerFlowUiRuntimeSource`는 enriched component tree에서 blocker owner ID/name 경로를 읽어
bounded DAG를 만듭니다. strict ancestor owner의 terminal phase는 descendant blocker의 proven predecessor가 되고,
같은 owner에서는 target reachability→condition→runtime hook→data request→target error phase만 권장 edge로
연결합니다. 같은 phase와 sibling owner는 dependency를 추측하지 않아 동일 level의 병렬 stage로 남습니다.
직접 predecessor뿐 아니라 transitive predecessor가 모두 resolved일 때만 ready가 되며 첫 ready/running step 하나를
active로 권장합니다. current tree에서 사라진 step은 해결된 것으로 표시하되
entry revision/render scenario/page candidate/export/direct-page scope별 96개, session당 8개 scope의 비영속 Map에만
남습니다. Flow UI는 기존 blocker detail을 재사용하고 resolution 변화 뒤 다음
ready step을 선택하므로 condition/payload/fallback/retry mutation 의미를 중복 구현하지 않습니다.

`previewInspectorRenderFlowUiRuntimeSource`는 이 actionable blocker DAG를 설명용 JSX render DAG와 결합합니다.
workspace root에서 선택 current-file export까지 증명된 owner corridor의 실제 component마다 function-entry node,
직접 소유한 condition/runtime requirement, 선택된 return-output node를 만들고 return 이후 mounted child 호출은
depth 4·전체 128 step 안에서 병렬 확장합니다. compiler condition의 effective branch label만 return 설명에 쓰며
project 함수를 다시 호출하거나 Virtual DOM을 추측하지 않습니다. 실행하지 않은 entry/route/wrapper와 unmounted
inventory 같은 `contextOnly` 증거는 return을 만들지 않아 정적 경로를 실제 commit으로 오인하지 않습니다. blocker
progress/resolution은 계속 원래 blocker DAG 하나에서만 계산하고 render context node는 완료율에 포함하지 않습니다.

`previewInspectorBlockerTraceRuntimeSource`는 enriched tree의 blocker record를 Fiber reference 없이 bounded plain
data로 복사하고, fingerprint가 달라질 때만 discovery/update/remount diff를 발생시킵니다. hook fallback, data payload,
target-guided condition, 최소 requirement DFS와 target Smart props의 mutation boundary는 적용 직전에
`auto-selection`을 기록하고 320ms 안정화, 최대 960ms 관찰 창으로 하나의 commit 결과를 확정합니다. target gate는
짧은 late-error grace 동안 다음 gate를 시작하지 않으며, 새 fatal signature만 rollback합니다. 직전 committed
target-error snapshot에 남은 기존 오류는 baseline으로 취급하고 정상 snapshot 뒤 재발한 동일 오류는 새 오류로
판정합니다. 같은 tree의 `render-result`와 Console/React boundary 오류는 동일 trace ID를 사용하므로 어떤 자동값이
다음 blocker나 오류를 열었는지 시간순으로 재구성할 수 있습니다. 브라우저 recorder는 source 본문을 읽지 않고
`react-preview-blocker-trace` plain-data message만 전송합니다.

확장 호스트의 `previewBlockerTraceProtocol`은 event identity, source coordinate, 문자열/list/JSON의 depth·node·64 KiB
예산을 먼저 검증합니다. `previewBlockerTraceLogger`는 source path가 해당 panel의 마지막 committed dependency set에
lexical/canonical identity로 모두 포함될 때만 pinned URI scheme으로 문서를 읽고 focus 줄 전후 4줄을 보완합니다.
모든 tab의 trace 출력은 하나의 Promise lane에서 receive 순서대로 `React Preview` LogOutputChannel에 pretty JSON으로
기록되므로 remote provider I/O가 webview callback이나 renderer main thread를 막지 않습니다. source graph 밖 요청도
event metadata는 남기되 `outside-committed-graph`로 표시하고 파일은 열지 않습니다.

`pageInspector/previewInspectorFiberRuntimeSource`와 component-tree adapter는 boundary class의 React 16-19
Fiber 포인터를 버전 격리된 경계에서 읽기만 합니다. boundary에서 HostRoot까지 올라간 뒤 최대 4,096 Fiber와
512개의 표시 component만 순회해 실제 부모·형제·자식 관계를 만듭니다. host DOM tag와 Inspector 자체 portal
branch는 제외하지만 project Portal은 `OverlayPortal`로 보존합니다. `props.children` React element identity가
hostless Context/Fragment 경로의 실제 child Fiber와 일치하면 transparent wrapper로, portal 또는 overlay-shaped
component 이름은 mounted/dormant overlay로 data-only 분류합니다. 선택 component별 top-level connected host DOM을 별도 비열거 인덱스로
보관해 tree highlight와 element-picker 역매핑에 사용합니다. Fiber, hook, update queue나 project props는
수정하지 않습니다.

`previewInspectorElementVisibilityRuntimeSource`는 picker가 고른 exact host와 가장 가까운 component ID를
hot-session 안에서만 연결합니다. 숨김은 DOM 제거나 Fiber write 대신 extension 전용 attribute와 document rule로
layout만 바꾸며, 원래 attribute를 보존해 최근/전체 복원 시 정확히 되돌립니다. component host index와 bounded
element-child path, tag 및 강한 authored attribute가 모두 일치할 때만 hot remount 뒤 marker를 다시 연결하고,
모호한 locator는 다른 sibling을 추측해 숨기지 않습니다. toolbar와 tree에는 DOM reference가 아닌 bounded summary와
component별 count만 전달됩니다.

`previewInspectorWireframeUiRuntimeSource`는 이 비열거 host index를 UI용 tree copy에도 runtime-only property로
보존하고 각 component의 connected host root를 viewport rectangle 하나로 합칩니다. mounted component는 실제
좌표에 outline을 그리며, host를 commit하기 전에 실패한 blocked-owner와 unmounted current-file export는 가장
가까운 측정 가능 parent 안에 bounded synthetic slot을 만듭니다. blocker는 이 slot 또는 실제 owner rectangle에
anchor되고 wireframe에는 pointer input을 받는 원형 `!` marker만 둡니다. marker 선택은 같은 blocker ID의
Render-flow card를 선택하고 별도 companion reveal message로 Inspector tab을 포커스하지만 Components tree의
선택·검색·scroll은 바꾸지 않습니다. 사용자가 card의 `Reveal in Components`를 눌렀을 때만 owner row를 펼쳐
이동합니다. detail revision은 같은 marker를 재선택해도 inline editor를 다시 동기화합니다. DOM/Fiber
reference는 React state나 webview persistence에 들어가지 않습니다. 한 refresh는
component box 160개와 tree visit 768개로 제한되고 scroll/resize는 animation frame 하나로 합칩니다.

collector 입력은 legacy boundary뿐 아니라 `{ boundary, exportName }` record를 받습니다. 동일한 authored page
slice에 현재 파일 export boundary가 여러 개 있으면 Fiber forest는 한 번만 만들고 각 boundary 아래 첫 표시
component에 독립 export identity를 매핑합니다. 실패 fallback이 host marker만 만든 경우에는 그 marker를 target
pseudo component로 승격해 target-local blocker와 Reveal UI가 사라지지 않게 합니다.

`previewInspectorRefreshRuntimeSource`는 highlight와 component-tree 갱신을 서로 다른 scheduling lane으로
분리합니다. outline reconciliation은 animation frame당 한 번 수행하되 마지막 host index를 재사용하고,
React commit 또는 mount subtree의 `childList` mutation만 Fiber snapshot을 dirty로 표시합니다. attribute,
character data, scroll, resize는 DOM outline이 자체적으로 따라가므로 관찰하지 않습니다. dirty tree는 250ms
간격과 `requestIdleCallback`으로 coalesce하고 hidden renderer document에서는 timer를 만들지 않습니다.
Console·data request discovery·condition·runtime fallback
registry는 같은 Inspector-only lane을 사용해 project target이 구독하는 semantic store를 갱신하지 않습니다.

props와 hook/class state는 own data descriptor만 제한된 깊이·key·array/string budget으로 복사하므로 getter나
project code를 실행하지 않습니다. JSX development `_debugSource`가 있으면 authored line/column을 쓰고,
없으면 inspector ancestry/render-chain의 source path와 occurrence를 사용합니다. Fiber를 읽지 못하는 초기 또는
오류 상태에서도 정적 EntryPoint→target 경로는 fallback component tree로 남습니다.

DevTools UI source는 main runtime과 분리된 `previewInspectorDevtoolsUiRuntimeSource`에서 생성합니다.
`previewInspectorCompanionRuntimeSource`는 isolated Shadow DOM workbench의 form property를 inert clone에
동기화하고 최대 8 MiB snapshot과 interactive element별 opaque ID를 extension host로 보냅니다. host의
`PreviewInspectorCompanionPanel`은 script/resource/event attribute를 제거하는 별도 CSP document에 snapshot을
표시하며, 별도 project entry를 import하지 않습니다. renderer의 zero-payload reveal request는 snapshot/action과
분리해 검증한 뒤 이미 생성된 companion panel만 focus합니다. `previewInspectorLayoutRuntimeSource`는 preview에 남는
page wireframe style과 companion에서 재사용할 navigation/details workbench CSS를 소유합니다. 내부 workbench의
왼쪽은 mounted 상태를 유지하는 `Components`/`Blockers` 1차 탭이고 오른쪽은 선택 component debugger와 Console로
나뉩니다. `previewInspectorNavigationUiRuntimeSource`는 inactive panel을 data attribute로만 숨겨 tree expansion과
각 named scroll viewport를 보존합니다. `previewInspectorComponentDebuggerUiRuntimeSource`는 `Props`, `State`,
`Source`, `Payload`를 선택 component에 귀속시키며 direct blocker assignment 또는 exact normalized owner name과
모순되지 않는 source path가 있는 request/fallback만 편집 범위에 포함합니다. State는 compiler-proven render
condition과 exact picked-host visibility만 바꿀 수 있고 임의 hook/class slot은 bounded read-only snapshot입니다.
`previewInspectorRenderFlowUiRuntimeSource`는 선택 export까지의 owner corridor를 function entry, render logic,
selected return JSX와 child call DAG로 변환합니다. 현재 파일 직접 blocker 강조는 선택 경로에서 가장 안쪽의
mounted `currentFileExport` node가 선택 export와 일치하고 blocker step의 최종 owner ID와 source path가 정확히
대응하며, 현재 unresolved/actionable 상태일 때만 부여합니다. 따라서 target-only 여부, 정적 inventory, component
이름 또는 ancestor의 간접 blocker는 현재 파일 blocker로 승격되지 않습니다. `previewInspectorBlockerFlowUiRuntimeSource`는 이 표식을
텍스트 배지, 접근 가능한 이름과 상태 색을 보존하는 inline-start accent로 렌더링합니다.
target/root 선택, highlight, picker, remount와 plain JSON props override도 이 경계에서 노출합니다. page-context 행은
실제 mounted ancestor root와 선택 render-chain을 이름만으로 합쳐
`PAGE COMPONENT`/`PAGE ROOT`/`STANDALONE`을 구분하며 filesystem 경로는 노출하지 않습니다.
일반 component 행 선택은 picker candidate보다 우선하는 authoritative tree selection입니다. 선택 시 picker를
종료하고 연결된 Fiber host root가 있으면 highlight를 자동 활성화합니다. export 선택으로 구조 ID가 바뀌었을
때는 전달된 export identity가 최신 snapshot에서 유일한 경우에만 다시 연결하며, hostless context/blocker 행은
outline을 만들지 않습니다. highlight 해제 시에는 덮어쓰기 전 inline outline 값과 priority를 그대로 복원합니다.
`previewInspectorCompanionPaneResizeScript`는 sanitized snapshot이 교체될 때 Components/Details 사이에 local
separator를 다시 삽입합니다. 760px breakpoint 전후의 column/row ratio를 별도 webview state로 유지하고 CSS grid
custom property만 갱신하므로 pointer drag가 companion protocol이나 project runtime으로 전달되지 않습니다. live
workbench 크기에서 양쪽 pane minimum을 다시 계산하고 ResizeObserver, keyboard ARIA value와 double-click reset을
같은 bounded ratio 함수로 통합합니다.
workbench shell 자체가 named inline-size container이고 toolbar, status, candidate selector, tree row, tabs, JSON과
console control은 `min-width:0`/bounded wrapping을 공유합니다. container 폭이 760px 아래면 tree/detail이 1열로,
460px 아래면 context/action/control이 단일 행 단위로 재배치되므로 companion을 좁은 editor group으로 옮겨도
viewport 밖 요소를 만들지 않습니다.
같은 행의 `PAGE PATH` 선택기는 mount-distinct caller 후보를 entry→root→target breadcrumb로 표시하고, 변경 시
선택 root의 props/error boundary/component tree key를 함께 교체합니다.
JSON의 prototype-sensitive key를 제거하고 함수·symbol·순환 reference를 편집 계약에서 제외합니다. boolean
조건 prop은 override로 바꾸고, 계측된 JSX condition은 authored/forced branch를 tree에서 선택하며,
`Auto values`는 inference/usage-derived prop layer만 제외하고 실제 parent/setup props는 보존합니다.
일반 Props 및 `Fix blocker` detail은 공통 `previewInspectorPropsUiRuntimeSource`를 사용합니다. 이 editor는 Smart
draft의 generated path와 no-op sentinel을 명시하고 `Smart fill props` 적용 시 현재 export revision만 remount합니다.
`previewInspectorSmartPropsRuntimeSource`는 provenance 표시 상한과 별도로 descriptor의 전체 inferred shape를
256 node 안에서 data-descriptor로 평탄화합니다. 짧은 missing field와 `props`/`this.props` receiver를 이 경로에
정렬하고 container match는 가장 깊은 증명 leaf로 확장합니다. 관찰된 null container/scalar가 실제 오류 경로를
막았을 때만 `replaceNullScalars` completion을 사용하므로 일반 hook fallback의 authored null branch는 유지됩니다.
current-file export row는 별도 `Reveal` action으로 selection, ancestor expansion, scroll 및 host highlight를 한 번에
요청합니다. blocker row 선택은 렌더 의미를 즉시 바꾸지 않고 blocker detail을 열며 condition branch, hook JSON,
data payload 또는 retry 값을 사용자가 명시적으로 적용할 때만 selected page revision을 remount합니다.
같은 blocker가 page wireframe에서 선택되면 primary `Blockers` tab과 해당 flow card를 선택해 companion을 focus하고,
graph card 선택은 component `selectedTreeNodeId`와 분리됩니다. 선택 blocker가 resolved/disappeared 상태로 바뀌면
다음 predecessor-ready card와 editor로 자동 전진합니다. Components와 Blockers viewport는 각각 stable scroll key를
가지며 sanitized companion snapshot 교체 전후에 가로·세로 좌표를 독립 복원합니다.
event-driven state는 실제 page UI로 조작하지만 임의 hook/local state slot은 수정하지 않습니다.
source-open browser message는 extension host의 committed dependency allowlist를 통과한 JS/TS 파일만 현재
local/remote workspace editor에서 열 수 있습니다. preview-local source button은 기존처럼 실제 click의
경로·좌표·nonce를 target별 HMAC으로 서명하고 host가 nonce를 한 번만 소비합니다. companion source button은
project script가 없는 extension-owned document의 실제 click만 별도 protocol로 보내고, 같은 session dependency
allowlist를 통과시킨 뒤 엽니다. 두 경로 모두 lexical dependency identity를 먼저 확인하므로 임의 path의
realpath조차 수행하지 않습니다.

`previewInspectorTargetBoundaryRuntimeSource`는 facade가 감싼 정확한 target invocation 아래의 render/lifecycle
오류를 잡습니다. 정상 경로에는 host DOM을 추가하지 않고 실패 경로에만 compact custom-element와 Retry를
만들어 실제 ancestor와 target 바깥 sibling을 보존합니다. placeholder는 component stack의 innermost authored
component와 오류에서 추출한 missing property를 직접 표시합니다. 전체 bounded report는 Inspector Console과 원래
`console.warn`에 남기고 captured-error registry에 기록해 global browser listener가 전체 preview root를
교체하지 않게 합니다.

`previewInspectorConsoleRuntimeSource`는 project `console.log/info/warn/error/debug`의 native method를 hot
runtime에 한 번 보관한 뒤 투명 wrapper로 미러링합니다. React target/root boundary와 unhandled runtime failure는
같은 registry에 export, phase, component stack을 구조화해 기록합니다. argument formatter는 own data descriptor만
읽고 getter·function·cycle·깊은 object를 명시적 label로 바꾸며 message/details와 전체 entry 수를 제한합니다.
연속 fingerprint가 같은 로그는 count를 올리고 최신 250건만 메모리에 남깁니다. 원래 console 호출은 같은
argument로 계속 실행됩니다. `previewInspectorConsoleUiRuntimeSource`는 level/text filter, chronological rows,
접을 수 있는 stack과 Clear를 제공하며 filter만 webview state에 저장하고 로그 payload는 저장하지 않습니다.

직접 export 이름이 없는 wildcard-only 파일은 ordinary target bridge가 발견한 runtime export를
`DirectPreviewTarget` 경계로 렌더링합니다. 이 fallback도 highlight/props는 동작하지만 ancestor plan이 없음을
warning으로 명시하고 parent/sibling 문맥을 주장하지 않습니다.

Inspector session은 선택 항목과 page candidate id, highlight/Wireframe 표시와 serializable override를
`previewHotRuntime` 및 VS Code webview state에 preview/companion 쌍별로 보관합니다. cache-busted module 교체와 전체 HTML
fallback 뒤에도 이를 복원하지만 기존
hot reload가 React root를 unmount하므로 프로젝트 hook state 자체는 유지하지 않습니다. reverse plan의
target·ancestor path, 모든 direct export의 entry/lazy/route evidence와 forward graph input을 dependency에
합쳐 어느 선택 파일을 편집해도 해당 Inspector 패널만 rebuild하고 override를 새 root에 다시 적용합니다.

## 정적 리소스 발견 경계

transformer는 프로젝트 JavaScript/TypeScript를 실행하지 않고 TypeScript의 TSX-aware parser로
구문만 해석합니다. JSX text, regex 리터럴, nested template과 Unicode escape 식별자를 정확히
구분하며 syntax recovery가 필요한 파일은 esbuild native glob으로 넘기지 않고 진단합니다.
`import.meta.glob`은 상대 문자열이나 nearest package root 기준 `/...` 문자열 또는 문자열 배열,
`!` 제외 패턴과 정적인 `eager`, `import`, `query`/`as` 옵션을 지원합니다. root pattern은 탐색용
importer-relative specifier와 앱에 노출할 `/...` object key를 분리합니다. `require.context`는 상대
디렉터리, boolean 재귀 플래그와 최대 200자의 선형 안전 부분집합 정규식 리터럴만 받습니다. 상대
template과 문자열 연결식 dynamic import/require는 runtime expression을 한 경로 segment의 `*`로
확장하고 정규화된 finite loader map으로 제한합니다. `new URL`은 정적 로컬 경로와 정확한
`import.meta.url` 조합만 `?url` import로 바꿉니다.

한 번의 확장은 128개의 512자 이하 패턴, 기본 최대 256개 match, 4,096개 조회, 20단계 깊이로
제한되며 Vite glob만 generated registry를 위해 빌드 전체 참조 한도와 같은 최대 1,024개 match를
허용합니다. 빌드 전체에도 확장 128회, 참조 1,024개, 조회 16,384개, watch directory 128개의 합산
한도가 있습니다. 상대 패턴은 `./` 또는 `../`로 시작해 workspace 안에 남고 `/...` Vite 패턴은
nearest package root 안에 남아야 하며, 따라가는 symlink에도 같은 canonical boundary를 적용합니다.
`.git`, `.hg`, `.svn`과 중첩 `node_modules`는 순회하지 않습니다. 디렉터리는 streaming iterator로
읽고 exact path 조회도 같은 budget에 포함합니다. Vite/Webpack 설정과 `.env`는 읽거나 실행하지 않으며
`import.meta.env`에는 `BASE_URL`, `MODE`, `DEV`, `PROD`, `SSR` 고정값만 주입합니다.

`PreviewCompiler.compile(request, context)` port는 요청 단위 계약을 유지하지만 실제 adapter와 위의 inert
package/usage cache, 최대 256개 adaptive Router/global plan 및 최대 12개 native build context는 전용 Node
worker thread가 소유합니다. 여러 탭의 compile은 peak graph memory를 제한하기 위해 하나씩 실행하고, queued
`fast` first paint를 `full` enrichment보다 우선합니다. context key에는 target, render/setup/runtime plan과 생성
virtual module 근거가 포함되고 source text는 포함하지 않습니다. Storybook fallback observer처럼 attempt-local
trace가 필요한 build는 fresh build로 격리합니다. shutdown은 cached context를 dispose한 뒤 esbuild service와
worker를 순서대로 종료합니다.

worker는 entry/CSS/chunk의 content digest와 bundle identity를 계산한 뒤 `ArrayBuffer` transfer list로 byte
ownership을 extension host에 넘깁니다. 따라서 큰 bundle을 structured clone으로 복사하거나 host event loop에서
다시 동기 hashing하지 않습니다. host의 artifact store는 검증된 path/digest layout과 최대 16개 비동기 VS Code
filesystem operation만 담당합니다.

workspace source transformer의 Context/default, general hook, glob/dynamic import/new URL 분석은 모두 원본 source
offset을 기준으로 replacement를 만듭니다. 독립 분석이 같은 range를 선택하면 등록 순서상 전용 Context/default가
일반 hook fallback보다 우선하고, 한 range가 다른 range를 포함하면 더 좁은 resource expression을 보존합니다.
따라서 `useContext(...)` 이중 계측이나 hook argument 안의 dynamic import가 전체 build를 중단하지 않으며,
충돌한 넓은 optional 계측만 해당 호출에서 빠집니다. low-level apply 함수는 여전히 overlap을 오류로 처리해 개별
analyzer 테스트에서 잘못된 range 생성이 숨겨지지 않도록 production reconciliation과 분리합니다.

## 프로젝트 런타임 경계

`previewRuntimeEnvironment`는 setup 후보를 extension host에서 import하지 않고 regular file과
canonical workspace 경계만 검사합니다. `public/index.html`, package `index.html`, Storybook main은
파일별 최대 1MiB만 읽고 `window.X = window.X || {}` 이름만 반환합니다. property 값, `.env`, API key,
template placeholder는 번들에 넣지 않습니다.

`previewSetupBridgePlugin`은 선택된 setup module namespace를 웹뷰 bundle에 연결합니다. generated
entry는 `initializePreview`, `PreviewProviders`, `previewProps`, `createPreviewProps`,
`previewPropsByExport`를 optional 계약으로 읽습니다. Storybook 모드에서는 named export 또는 default
config의 global decorator와 parameters를 각 export에 적용하고, Apollo parameter가 직접 제공한
`MockedProvider`도 재사용합니다. main/addon/server 코드는 로드하지 않습니다. setup과 그 의존성도
workspace source plugin을 지나므로 dirty overlay, static resource 변환과 dependency watcher가 동일하게
적용됩니다.

`previewApolloBridgePlugin`은 target package 기준으로 `@apollo/client`와 분리된 React entry를 optional
resolve합니다. 패키지가 없으면 identity wrapper만 만들고, 있으면 프로젝트 package의
`ApolloClient`, `InMemoryCache`, `ApolloLink`, `Observable`, `ApolloProvider`로 outer boundary를 만듭니다.
terminating link는 네트워크 transport를 포함하지 않고 bounded GraphQL selection tree로 정적 결과를
생성합니다. setup의 `apolloPreview.resolveOperation`과 `initialState`는 데이터만 바꿀 수 있으며 URI,
link 또는 client를 주입할 수 없으므로 자동 경로의 no-network 보장은 유지됩니다.

`pageInspector/previewInspectorDataRuntimeSource`는 Apollo fallback과 REST instrumentation이 공유하는 탭별
request registry입니다. GraphQL selection/alias/fragment/list shape, REST TypeScript shape, seed 값과 필드명
semantic을 하나의 JSON-safe descriptor로 정규화하고 결정적인 Auto/Lorem 값을 생성합니다. compiler가 증명한
fetch/axios 호출, ambient HTTP(S)·상대 backend 후보 fetch와 imported instance가 사용하는 XMLHttpRequest는
메모리 Response/AxiosResponse로 종료하며 상대 JSON/TXT/CSV fetch fixture는 captured native fetch로
전달합니다. `previewInspectorVirtualBackendRuntimeSource`는 이 transport 뒤에서 method·resource URL과 redacted
body/query fingerprint를 결합하고, REST GET의 canonical resource 및 POST/PATCH/PUT/DELETE 변경을 탭 메모리에
유지합니다. GraphQL은 operation과 variables별 fixture를 격리합니다. 요청별 success/empty/error/status/latency
scenario만 webview state에 저장하고 canonical resource 값은 전체 reload 시 폐기합니다. request discovery는 React render 중 state를
바꾸지 않도록 microtask로 coalesce하고, payload 변경은 data revision을 올려 page export를 remount합니다.
UI·generation·source instrumentation은 각각 별도 파일이며 사용자 override, Auto 설정과 response scenario만 webview state에
저장합니다. endpoint query value와 credential은 registry metadata에 보존하지 않고 fingerprint 계산 중 민감한
property 값을 redaction합니다.

`previewThemeBridgePlugin`은 target package의 `styled-components`를 optional resolve하고 같은 package
인스턴스의 ThemeProvider를 outer boundary로 사용합니다. `previewStyleInventory`는 활성 export graph에서
실제로 도달한 styled-components 소스가 직접 import한 named/default `theme` value와 named type-only
근거만 bounded하게 기록합니다. `previewThemeCandidatePlugin`은 각 요청을 프로젝트 resolver에 다시
통과시켜 alias와 상대 경로가 같은 파일을 가리키면 하나로 합칩니다. value 근거가 type-only보다
우선하고 서로 다른 최상위 후보가 동점이면 선택하지 않습니다. 유일한 후보 theme만 local dynamic
chunk로 평가합니다. 발견 theme은 실제 primitive/CSS array/helper를 보존하는 Proxy overlay를 사용하고
누락 token이나 `.unit`이 있는 실패 helper만 구조적으로 보완합니다. exact document token과 정적 body
typography는 웹뷰 기본 스타일과 root rem 기준에도 반영합니다. setup의 `themePreview.theme`과 활성
파일의 직접 theme은 자동 graph 후보보다 우선하며, 자동 발견이 없을 때만 값 없는 구조 theme을
사용합니다. 앱 entry, Provider graph나 이름이 다른 theme export를 검색하지 않습니다.

`previewThemeHelperInstrumentation`은 reached styled-components tagged template 내부에서 실제로 호출되는
`props.theme.<path>(...)` callee만 원본 offset 기준으로 표시합니다. 브라우저 resolver는 현재 nested provider의
호출 가능한 helper를 먼저 사용하고, 값이 함수가 아니거나 호출이 실패할 때만 앞에서 선택한 exact root theme의
동일 path를 조회합니다. 양쪽 모두 사용할 수 없으면 helper의 유한 `.unit`과 숫자 인자로 CSS 값을 만들거나 빈
token을 반환해 해당 interpolation만 격리합니다. business logic의 같은 이름 property, optional chain, computed
path와 styled template 밖의 호출은 수정하지 않으며 복구 path 수는 Theme runtime status에 bounded하게 남깁니다.

`previewReduxBridgePlugin`은 target package의 `react-redux`만 optional resolve합니다. reducer, middleware,
프로젝트 store module, app bootstrap이나 `redux` package를 불러오지 않고 최소 store를 같은 package의
outer Provider에 전달합니다. target-reachable source transformer는 `useSelector` 계열 callback의 state
path와 결과 local alias에서 이어지는 비옵셔널 property dereference를 bounded하게 수집합니다. bridge는
등록된 경로의 객체 container만 plain object로 만들고 deep freeze하며, leaf 값·enum·boolean은 생성하지
않습니다. optional chain, computed key, unsafe segment, 모호한 alias와 depth/count 한도를 넘는 근거는
fail closed합니다. dispatch는 action을 실행하지 않고 그대로 반환하며 state와 listener를 바꾸지
않습니다. setup의 `reduxPreview.state`는 자동 skeleton을 병합하거나 clone하지 않은 exact reference로
최우선 사용되고, 내부 실제 Provider가 있으면 자동 경계보다 우선합니다.

`previewFormikBridgePlugin`은 target package에서 정상적으로 해석되는 동일 `formik` package를 optional
resolve합니다. reached workspace source는 `useField`, `useFormikContext`, `Field` 계열 consumer와 `Formik`,
`FormikProvider`, `withFormik` provider 근거를 monotonic하게 등록합니다. consumer가 있고 provider 근거가
없을 때만 `useFormik`/`FormikProvider` 또는 호환 render-prop API로 outer boundary를 만들며 기본값은
frozen `{}`와 no-op submit입니다. project form component, validator, app entry와 backend는 실행하지
않습니다. setup의 `formikPreview.initialValues`는 bounded JSON-like plain data만 복사·freeze하며 실제
내부 Provider는 nearest-context 규칙으로 우선합니다.

`previewRouterBridgePlugin`의 활성 여부는 편집 중인 한 파일이 아니라 첫 target-rooted esbuild build에서
실제로 요청된 workspace module 전체의 `react-router-dom`/`react-router` value import inventory로 결정합니다. named
alias와 namespace property access에서 location consumer와 application Router provider를 별도로 기록하고,
consumer가 있으면서 provider가 없을 때만 최대 한 번 다시 빌드해 target package의 `MemoryRouter`를
optional resolve합니다. 기본 `['/']` history를 제공하며 앱 route module, browser history, loader/action은
import하지 않습니다. custom/Storybook setup이 있다는 사실만으로 자동 계층을 억제하지 않고 실제 setup
graph의 provider 근거가 있으면 nested Router를 만들지 않습니다. setup은 bounded string entries·index를
지정하거나 `false`로 명시적으로 끌 수 있습니다.

Page Inspector의 selectable root는 전체 target graph와 같은 Provider 계층을 반드시 포함하지 않습니다.
따라서 ancestor planner는 후보 root 아래의 target-facing render-path module만 다시 검사해
`rootOwnsRouter`를 descriptor에 기록합니다. Page Inspector 전역에는 별도 Router를 합성하지 않습니다.
브라우저의 후보 loader는 실제 React render 시점에
`useInRouterContext`(v5는 legacy context)를 확인하고, 상위 context가 없으며 후보도 Router를 소유하지
않을 때만 대상 프로젝트 package 인스턴스의 후보 지역 `MemoryRouter`를 합성합니다. 이 경계는 setup
Provider를 그대로 상속하고 AppRouter/RouterProvider 후보 안에는 중첩되지 않습니다. custom wrapper나 re-export로
ownership을 정적으로 놓친 경우 nested Router invariant만 지역 error boundary가 포착해 추론 MemoryRouter 없이
같은 candidate를 재시도하며, 다른 application error는 기존 preview boundary로 그대로 전달합니다.

`reactContextFallback`은 workspace 안의 TypeScript에만 적용되며 React import identity와 explicit missing
default를 확인합니다. inline structural type뿐 아니라 같은 module의 유일한 non-generic·acyclic
interface/type alias를 제한적으로 확장하고 primitive, array, function과 중첩 object를 depth 8, property
64개, expression 4,096자, module당 64개 안에서만 생성합니다. imported type, generic, recursive reference,
interface `extends`, merged declaration, JavaScript, declaration, `node_modules`, workspace 밖 source, 실제
initializer와 side effect expression은 semantic resolver 없이 안전성을 증명할 수 없으므로 fail closed로
유지합니다. 정상 Provider가 존재하면 React의 nearest-context 규칙으로 합성 default보다 우선합니다.

`reactContextHookFallback`은 workspace runtime source의 정적으로 import된 `use*Context` 호출을 별도로
분석합니다. direct/nested object destructuring, `const` alias, closure, non-optional property dereference와
호출되는 leaf만 따라가 plain object container 및 frozen no-op 함수를 module-level stable declaration으로
직렬화합니다. 같은 파일의 bounded helper가 `Object.keys/values/entries`로 인자를 검사하는 요구도 제한적으로
전파합니다. replacement는 항상 `(originalHookCall ?? fallback)`이므로 실제 Provider 값을 변경하지
않습니다. optional chain의 receiver를 fallback에서 만들지 않아 원래 short circuit을 유지할 수 있으면
이미 증명된 root/container를 보존하고, fallback 때문에 optional receiver가 구체화되는 충돌에서는 해당
후보를 fail closed합니다. computed/array/write/conflict/shadow/prototype path와 한도 초과도 변환하지 않으며
leaf 값이나 app 의미를 생성하지 않습니다.

`previewRuntimeHookInstrumentation`은 Page Inspector full build에서 reached workspace의 same-module hook과 모든
정적 imported `useX` hook을 package 이름과 무관하게 분석합니다. destructuring, tuple, compared literal,
required property/call/조건 path 또는 bounded semantic name으로 fallback expression을 증명한 호출만 global
Inspector resolver로 감쌉니다. array method가 보이면 callback의 첫 parameter binding과 그 scope의 property
read를 다시 분석해 사용 field만 가진 frozen one-item collection과 `[].field` required path를 만듭니다.
React built-in은 직접 `useContext`만 포함하고 나머지는 제외하며, exact
`use*Context` hook은 별도 Context transform이 같은 resolver protocol을 사용합니다. resolver는 원본 hook을
정확히 한 번 호출하고 완전한 값은 identity까지 그대로 반환합니다. non-thenable 예외·필수 nullish root 또는
plain object/array의 누락 nullish leaf는 `Auto values`가 켜진 경우에만 per-source stable fallback으로
복구합니다. completion은 own descriptor만 읽고 실제 sibling/callback을 보존하며 getter, class, React element,
unsafe key와 incompatible container는 fail closed합니다. Suspense thenable과 boundary를 끈 경우는 원래
예외/값을 보존합니다. 우회 record는 source·원본 headline·근거·생성 path/value와 함께 ephemeral `Fallbacks`
registry와 Console warning에 남으며 backend/application truth로 취급되지 않습니다.

`previewContextBridgePlugin`은 reached source가 정적으로 증명한 top-level
`use*Context → useContext(LocalContext)` identity와 호출부 fallback shape를 연결합니다. project root에서
해석한 동일 React instance의 raw React 18/19 Context Provider token만 사용하고 이름이 비슷한 application
Provider component는 import·실행하지 않습니다. 같은 Context의 여러 shape는 object container와 inert
callable leaf만 병합하고 충돌한 Context만 제외합니다. setup 또는 실제 authored tree 안의 Provider가 더
가까우므로 자동 값보다 우선하며, `useSyncExternalStore` subscription boundary가 lazy chunk의 늦은 등록도
다음 render에서 반영합니다.

자동 Storybook 첫 시도의 resolver trace는 최대 4,096개 setup 경로와 64개 누락 상대 import만
보존합니다. setup-free 폴백 뒤에도 오류 importer, 확장자·index 후보와 충분히 좁은 workspace 내부
디렉터리를 감시하므로 누락 파일이 새로 생기면 고정된 패널이 자동으로 원래 setup을 재시도합니다.
추적 가능한 실패는 setup/config/후보 파일의 존재·mtime·size와 dirty snapshot hash가 그대로인 동안
compiler worker의 bounded cache에서 setup-free plan을 재사용하므로 hot reload마다 실패 graph를 번들링하지
않습니다. 증거가 바뀌면 cache를 폐기하고 원래 Storybook setup을 다시 시도합니다.
package root나 첫 단계 source 폴더 전체에는 재귀 watcher를 만들지 않으며, 누락 bare package/alias는
안전한 로컬 후보를 만들 수 없으므로 수정 또는 설치 뒤 사용자가 Refresh를 실행하도록 경고합니다. setup과
target 오류가 함께 발생하면 setup-free build를 한 번 수행하고, target 오류가 남을 때 그 결과를 표시합니다.
첫 빌드가 이미 완료된 뒤 적용하는 출력 크기와 watch-directory 합산 한도는 setup 기여도를 정확히
분리할 수 없어 자동 폴백하지 않습니다. 이 경우 전용 setup을 쓰거나 Storybook 재사용을 끕니다.
출력 크기 정책은 resource-scoped `reactPreview.maxOutputSizeMiB`를 request에 snapshot하고 기본 128 MiB,
사용자 범위 32–512 MiB로 정규화합니다. esbuild 결과의 JavaScript, CSS와 encoded asset byte를 합산해
global storage 게시 전에 검사하며, 512 MiB 절대 상한과 2,048개 output file 한도는 별도로 유지합니다.

자동 계층은 Apollo selection-shaped data, 파일이 명시적으로 import한 styled-components theme,
누락 token fallback, selector에서 증명된 객체 container만 가진 Redux state skeleton, no-submit Formik
boundary, root MemoryRouter와 bounded Context default/hook fallback처럼 의미를 추측하지 않아도 되는 최소
구조만 제공합니다. 일반 prop/Provider 경계도 same-file type과 실제 receiver가 증명한 neutral container까지만
만들며 앱 route graph와 Redux/Formik/Context의 업무 state를 복제하지 않습니다. 별도의 Page Inspector
render-only hook circuit은 렌더 중단을 피하기 위해 사용처와 semantic name에서 primitive를 만들 수 있지만,
이를 `GENERATED RENDER VALUE`로 명시하고 사용자가 끌 수 있으며 실제 application state로 전달하지 않습니다.
프로젝트 의미가 필요한 값은 setup이
소유하며, 계약과 예시는 [프로젝트 setup 가이드](project-setup.md)에 둡니다.

별도의 browser process boundary는 application state를 추측하는 Provider가 아닙니다. Browserify 시대의
`path`, `util` 같은 browser package가 module 평가 중 읽는 `process.platform`, `env`, `cwd`와 scheduler만
중립적으로 제공합니다. package source에 Node filesystem/native capability 요구가 있으면 그대로 unsupported
오류가 되며, 기존 host/project process object는 수정하지 않습니다. package bootstrap의
`window.name = window.name || importedBinding` 형태는 동일 좌변임이 증명될 때만 정확한 import bridge 근거로
수집합니다.

generated entry의 runtime report는 direct error headline을 먼저 두고 현재 bootstrap/render phase,
target/export/setup/classification, 적용된 parent slice의 wrapper 수·complete/partial 상태와
Globals의 lexical bridge/browser process 상태 및 Apollo·Context·Formik·Redux·Router·Theme bridge가 실제로
선택한 경계 상태를 함께 표시합니다. React error
boundary의 component stack과 JavaScript stack을 보존하며 cross-realm thrown
value의 bounded cause chain, `AggregateError.errors`, primitive own field도 getter 실패를 보고서 실패로
전파하거나 프로젝트 serializer를 호출하지 않고 수집합니다. Apollo compact invariant URL은 version,
message code와 arguments만 로컬에서 decode하고 backend나 문서 서비스에 요청하지 않습니다. 분류는
root/cause/aggregate의 직접 message만
사용하며 stack path나 프로젝트 이름을 규칙 입력으로 사용하지 않습니다.

React 19의 `onUncaughtError`, `onCaughtError`, `onRecoverableError` root callback은 전역 event와 export별
error boundary가 같은 오류를 덮어쓰지 않도록 조정하고, React 18에서는 기존 boundary와 browser event
경로가 그대로 동작합니다. `jsxDev` source metadata는 component stack의 원본 위치를 개선합니다. 진단
element는 `#react-preview-root` 아래 전용 class, `all: initial`과 필요한 `!important` 속성으로 표시해
프로젝트의 전역 CSS가 글자색·layout·가시성을 깨뜨리지 못하게 합니다. 정확한 theme 값, props와 unknown
context state는 계속 일반적인 project runtime setup 또는 작은 harness가 소유합니다.

## 보안 경계

확장 manifest는 Restricted Mode에서 명령 등록과 신뢰 안내만 허용하고, 명령 handler는 신뢰가 확인되기
전까지 compiler·cache·panel을 생성하지 않습니다. `localResourceRoots`는 전역 저장소 전체가 아닌 현재
확장 창의 UUID 세션 디렉터리만 허용합니다. 생성된 스크립트는 외부 ES module로 로드하며 inline script,
nonce 우회, `eval`, `unsafe-eval`을 사용하지 않습니다.

웹뷰 CSP는 다음을 기본 차단합니다.

- `connect-src 'none'`: fetch, WebSocket 등 외부 연결
- `worker-src 'none'`: worker 실행
- `frame-src 'none'`: iframe 삽입
- `base-uri 'none'`: 상대 URL 기준 변경
- `form-action 'none'`: 폼 제출

Page Inspector는 명시적으로 선택한 실제 ancestor의 render, hook, effect와 event handler를 웹뷰에서
실행하므로 기본 component slice보다 실행 범위가 넓습니다. 그러나 reverse traversal은 workspace 안의
증명된 import owner와 고정 budget으로 제한되고 CSP, Workspace Trust, no-server 정책은 완전히 동일합니다. Inspector
toolbar는 파일 쓰기나 extension command protocol을 노출하지 않으며 직렬화 가능한 props override와
panel-local webview state만 다룹니다.

진단, 경로, 파일 이름, URI는 HTML text/attribute 문맥에서 escape합니다. 웹뷰가 extension으로 보내는
메시지는 extension이 먼저 발급한 hot-reload token에 대한 ready/failed 확인으로 제한되며, 사용자
번들이 임의 명령이나 파일 작업을 요청하는 protocol은 없습니다.
extension이 웹뷰로 보내는 준비 상태는 고정된 단계 문구, bounded step metadata와 session revision만
포함합니다. 최초 빌드는 script 없는 loading HTML을 단계별로 교체하고, 준비된 웹뷰는 project root의
sibling인 declarative Shadow DOM status panel을 사용합니다. generated runtime은 메시지 형태와 revision
단조성을 다시 검증하고 `textContent`로만 갱신하므로 project CSS나 오래된 hot import가 최신 상태를
덮지 못합니다. 완료 revision은 terminal 상태로 기록되고, provider-wrapped tree 안의 commit sentinel이
mount된 뒤에만 `aria-busy`를 해제합니다. 전체 문서는 session token/revision이 일치하는 runtime
ready/failed 확인을 보내며, entry가 실행 전 실패하면 30초 watchdog이 오류 문서로 회수하고 artifact
lease를 반환합니다. 진행 bar는 indeterminate이며 실제 경계를 시간 퍼센트로 오인시키지 않습니다.
`deactivate()`는 번들된 워크스페이스 소스가 global storage에 남지 않도록 세션 삭제를 await합니다.

## 확장 지점

- 새 컴파일러: `PreviewCompiler` 구현 추가
- 새 artifact 저장 방식: `PreviewArtifactStore` 구현 추가
- 새 파일 형식: `previewTarget` 매핑과 compiler loader를 함께 확장
- 새 정적 resource convention: transformer의 리터럴 parser와 bounded pattern policy를 함께 확장
- 새 asset convention: asset plugin의 명시적 mode와 loader policy를 함께 확장
- 새 setup convention: runtime environment resolver의 bounded 후보 정책과 bridge 계약을 함께 확장
- 새 GraphQL client: Apollo bridge와 분리된 runtime-source adapter를 추가하고 transport 차단을 검증
- 새 증분 계획: `PreviewBuildPlanIdentity`에 immutable plugin/virtual-module 근거를 추가하고 mutable source
  state는 `MutableWorkspaceSourceState` 경계를 통해서만 갱신
- 런타임 이벤트: 검증 가능한 discriminated-union 메시지 protocol을 domain에 추가

추상화는 미리 모든 가능성을 일반화하지 않습니다. 두 구현이 필요하거나 외부 시스템이 바뀌는
지점이 확인될 때 port를 확장합니다. 범용 분석 규칙에는 저장소 이름·업무 token·route를 넣지 않으며,
새 파일과 모든 함수·클래스 주석은 책임, 입력, 출력, 오류와 부작용을 사람이 추적할 수 있게 설명합니다.

## 테스트 경계

- `test/domain`: 파일 정책 같은 순수 규칙
- `test/application`: in-memory port를 이용한 side-effect 순서
- `test/adapters/esbuild`: 실제 React/TSX/CSS 번들, 미저장 overlay와 정적 resource macro
- `test/adapters/esbuild/inspector`: bounded 실제 ancestor 선택, target facade와 root bridge
- `test/adapters/esbuild/pageInspector`: read-only host lookup, Shadow DOM, highlight와 props control runtime source
- `test/presentation`: 다중 고정 panel event routing, CSP와 동적 HTML escape
- `test/fixtures`: 실제 컴파일 입력이며 배포물에는 포함하지 않음

Extension Host 통합 테스트는 패널을 관찰할 안정적인 test seam을 추가할 때 별도 suite로 둡니다.
현재 빠른 suite는 서버 없는 컴파일 경로와 가장 중요한 보안 문자열을 직접 검증합니다.

## 배포 제약

확장 호스트는 VS Code 1.100 이상에서 지원하는 Node 20 호환 ESM으로 번들링해 workspace가 주입한
CommonJS resolver와 활성화 경계를 분리합니다. compiler는 전용 CommonJS Worker에 남기며 `vscode`와
런타임 `esbuild`는 external입니다. esbuild 네이티브 바이너리 때문에 공개 배포에서는 VS Code가 지원하는
target별 VSIX를 생성해야 합니다. `esbuild-wasm`은 단일 패키지 대안이지만 초기 목표인 빠른 편집
피드백에는 사용하지 않습니다. `package-vsix.mjs`는 현재 호스트의 target을 manifest에 기록하고,
설치된 네이티브 바이너리와 다른 플랫폼으로의 교차 패키징을 거부합니다.
