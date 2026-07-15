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

## 계층과 의존 방향

| 계층               | 책임                                                    | 허용된 주요 의존성                           |
| ------------------ | ------------------------------------------------------- | -------------------------------------------- |
| `domain`           | 요청, 번들, 진단, 저장 위치, 대상 파일 규칙             | 표준 TypeScript/JavaScript                   |
| `application`      | 컴파일 후 게시하는 유스케이스와 port                    | `domain`                                     |
| `adapters/esbuild` | 가상 엔트리, AST 리소스 분석, overlay, 브라우저 번들    | `application`, `domain`, esbuild, TypeScript |
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
   하나의 경계를 고르고 HTML/config 문자열에서 빈 전역 namespace 이름만 제한적으로 발견합니다.
4. export selector가 editor AST에서 runtime default, 파일명 일치 named, 유일한 PascalCase named
   순으로 하나를 선택합니다. bridge는 그 export만 default로 노출해 나머지 graph를 tree-shake합니다.
5. 가상 엔트리는 빈 전역 namespace → setup initialize → target import → props/Provider/decorator 순서를
   보존합니다. 깨진 자동 Storybook setup은 추적된 setup graph에 모든 오류가 속할 때만 격리된 새
   build에서 setup 없이 한 번 재시도하므로 target 자체 오류의 빌드 비용을 두 배로 만들지 않습니다.
6. workspace source plugin은 실제로 도달한 dirty 파일을 overlay하고 `.js`/`.ts` 계열 프로젝트와
   dependency source를 정적 리소스 transformer에 전달합니다. symlink·alias·순환 import로 다시
   유입되는 동일 파일은 canonical path로 비교해 하나의 모듈로 합칩니다.
7. transformer가 TS/TSX AST로 Vite `import.meta.glob`/`globEager`, Webpack `require.context`, 상대
   template·문자열 연결식 dynamic import/require와 정적 `new URL(..., import.meta.url)`을 유한한
   명시적 import/loader map으로 바꿉니다.
8. asset plugin이 `?raw`, `?url`, SVG component convention과 가장 가까운 package의 `public` root
   asset 및 root-relative CSS `url()`/`@import`를 framework
   config 실행 없이 JavaScript module 또는 data URL로 변환합니다. resolver는 읽기 전에 일반
   파일 여부와 파일당 5 MiB·합계 20 MiB 제한을 검증합니다.
9. esbuild가 `platform: browser`, `format: esm`, `write: false`로 단일 JS와 선택적 CSS를 만듭니다.
10. application 유스케이스가 성공한 번들만 artifact store에 넘깁니다.
11. store가 내용 해시 디렉터리에 파일을 모두 쓴 뒤 opaque URI와 한 개의 ownership reference를
    반환합니다.
12. 요청한 세션만 최신 revision의 HTML과 의존 그래프를 반영하고, 교체된 생성물 lease를 반환합니다.

store는 publish, release, shutdown을 하나의 직렬 Promise queue에서 처리합니다. 같은 내용 해시를
여러 패널이 공유할 때 reference count가 마지막 owner의 release까지 디렉터리 삭제를 막습니다.
확장 종료 시에는 controller가 모든 session lease를 반환하고, queue가 끝난 다음 세션 디렉터리
삭제를 기다립니다.

## 패널 세션과 이벤트 라우팅

`PreviewController`는 확장 창 하나의 manager이고 `PreviewPanelSession`은 패널 하나의 고정 URI,
revision, debounce timer, 의존 파일·탐색 디렉터리와 artifact lease를 소유합니다. Open 명령은 항상
새 session을 만들므로 같은 파일도 여러 탭에서 열 수 있습니다. `onDidChangeActiveTextEditor`는 구독하지
않으며 `onDidChangeViewState`는 마지막 포커스 session만 기록합니다.

문서 편집·저장 이벤트는 모든 session에 전달되지만 각 session은 자신의 대상, 마지막 의존 그래프,
정적 패턴 watch directory에 포함된 경우만 rebuild를 예약합니다. Refresh는 포커스된 프리뷰를 먼저,
그다음 활성 source와 같은 대상의 가장 최근 session을 선택하며, 일치하는 session이 없으면 새 탭을
엽니다. 어떤 경우에도 기존 session을 다른 URI로 retarget하지 않습니다.

## 정적 리소스 발견 경계

transformer는 프로젝트 JavaScript/TypeScript를 실행하지 않고 TypeScript의 TSX-aware parser로
구문만 해석합니다. JSX text, regex 리터럴, nested template과 Unicode escape 식별자를 정확히
구분하며 syntax recovery가 필요한 파일은 esbuild native glob으로 넘기지 않고 진단합니다.
`import.meta.glob`은 상대 문자열 또는 문자열 배열, `!` 제외 패턴과 정적인 `eager`, `import`,
`query`/`as` 옵션을 지원합니다. `require.context`는 상대 디렉터리, boolean 재귀 플래그와 최대
200자의 선형 안전 부분집합 정규식 리터럴만 받습니다. 상대 template과 문자열 연결식 dynamic
import/require는 runtime expression을 한 경로 segment의 `*`로 확장하고 정규화된 finite loader
map으로 제한합니다. `new URL`은 정적 로컬 경로와 정확한 `import.meta.url` 조합만 `?url` import로
바꿉니다.

한 번의 확장은 128개의 512자 이하 패턴, 최대 256개 match, 4,096개 조회, 20단계 깊이로
제한됩니다. 빌드 전체에도 확장 128회, 참조 1,024개, 조회 16,384개, watch directory 128개의
합산 한도가 있습니다. 패턴은 `./` 또는 `../`로 시작하고 정규화된 경로와 따라가는 symlink 대상이
현재 workspace 안에 남아야 하며 `.git`, `.hg`, `.svn`과 중첩 `node_modules`는 순회하지 않습니다.
디렉터리는 streaming iterator로 읽고 exact path 조회도 같은 budget에 포함합니다. Vite/Webpack
설정과 `.env`는 읽거나 실행하지 않으며 `import.meta.env`에는 `BASE_URL`, `MODE`, `DEV`, `PROD`,
`SSR` 고정값만 주입합니다.

컴파일러 port는 stateless `compile(request)`로 시작합니다. 향후 성능 측정 결과가 필요하면 같은
port 뒤에서 esbuild `context.rebuild()` 세션을 캐시할 수 있으며 application과 UI는 바뀌지
않습니다.

## 프로젝트 런타임 경계

`previewRuntimeEnvironment`는 setup 후보를 extension host에서 import하지 않고 regular file과
canonical workspace 경계만 검사합니다. `public/index.html`, package `index.html`, Storybook main은
파일별 최대 1MiB만 읽고 `window.X = window.X || {}` 이름만 반환합니다. property 값, `.env`, API key,
template placeholder는 번들에 넣지 않습니다.

`previewSetupBridgePlugin`은 선택된 setup module namespace를 웹뷰 bundle에 연결합니다. generated
entry는 `initializePreview`, `PreviewProviders`, `previewProps`, `createPreviewProps`를 optional 계약으로
읽습니다. Storybook 모드에서는 named export 또는 default config의 global decorator와 parameters를
적용하고, Apollo parameter가 직접 제공한 `MockedProvider`도 재사용합니다. main/addon/server 코드는
로드하지 않습니다. setup과 그 의존성도 workspace source plugin을 지나므로 dirty overlay, static
resource 변환과 dependency watcher가 동일하게 적용됩니다.

`previewApolloBridgePlugin`은 target package 기준으로 `@apollo/client`와 분리된 React entry를 optional
resolve합니다. 패키지가 없으면 identity wrapper만 만들고, 있으면 프로젝트 package의
`ApolloClient`, `InMemoryCache`, `ApolloLink`, `Observable`, `ApolloProvider`로 outer boundary를 만듭니다.
terminating link는 네트워크 transport를 포함하지 않고 bounded GraphQL selection tree로 정적 결과를
생성합니다. setup의 `apolloPreview.resolveOperation`과 `initialState`는 데이터만 바꿀 수 있으며 URI,
link 또는 client를 주입할 수 없으므로 자동 경로의 no-network 보장은 유지됩니다.

자동 Storybook 첫 시도의 resolver trace는 최대 4,096개 setup 경로와 64개 누락 상대 import만
보존합니다. setup-free 폴백 뒤에도 오류 importer, 확장자·index 후보와 충분히 좁은 workspace 내부
디렉터리를 감시하므로 누락 파일이 새로 생기면 고정된 패널이 자동으로 원래 setup을 재시도합니다.
package root나 첫 단계 source 폴더 전체에는 재귀 watcher를 만들지 않으며, 누락 bare package/alias는
안전한 로컬 후보를 만들 수 없으므로 수정 또는 설치 뒤 사용자가 Refresh를 실행하도록 경고합니다.
첫 빌드가 이미 완료된 뒤 적용하는 출력 크기와 watch-directory 합산 한도는 setup 기여도를 정확히
분리할 수 없어 자동 폴백하지 않습니다. 이 경우 전용 setup을 쓰거나 Storybook 재사용을 끕니다.

Apollo처럼 의미 없는 구조적 기본값이 안전한 library context만 자동 제공하며 Router, Theme, Redux
state나 props는 이름만 보고 추측하지 않습니다. 프로젝트 의미가 필요한 값은 setup이 소유하며,
계약과 예시는 [프로젝트 setup 가이드](project-setup.md)에 둡니다.

## 보안 경계

확장 manifest와 명령 handler가 모두 Workspace Trust를 검사합니다. `localResourceRoots`는 전역
저장소 전체가 아닌 현재 확장 창의 UUID 세션 디렉터리만 허용합니다. 생성된 스크립트는 외부
ES module로 로드하며 inline script, nonce 우회, `eval`, `unsafe-eval`을 사용하지 않습니다.

웹뷰 CSP는 다음을 기본 차단합니다.

- `connect-src 'none'`: fetch, WebSocket 등 외부 연결
- `worker-src 'none'`: worker 실행
- `frame-src 'none'`: iframe 삽입
- `base-uri 'none'`: 상대 URL 기준 변경
- `form-action 'none'`: 폼 제출

진단, 경로, 파일 이름, URI는 HTML text/attribute 문맥에서 escape합니다. 현재 웹뷰는 extension에
메시지를 보내지 않으므로 사용자 번들이 명령이나 파일 작업을 요청할 통로도 없습니다.
`deactivate()`는 번들된 워크스페이스 소스가 global storage에 남지 않도록 세션 삭제를 await합니다.

## 확장 지점

- 새 컴파일러: `PreviewCompiler` 구현 추가
- 새 artifact 저장 방식: `PreviewArtifactStore` 구현 추가
- 새 파일 형식: `previewTarget` 매핑과 compiler loader를 함께 확장
- 새 정적 resource convention: transformer의 리터럴 parser와 bounded pattern policy를 함께 확장
- 새 asset convention: asset plugin의 명시적 mode와 loader policy를 함께 확장
- 새 setup convention: runtime environment resolver의 bounded 후보 정책과 bridge 계약을 함께 확장
- 새 GraphQL client: Apollo bridge와 분리된 runtime-source adapter를 추가하고 transport 차단을 검증
- 증분 빌드: compiler 내부 session/context 구현 추가
- 런타임 이벤트: 검증 가능한 discriminated-union 메시지 protocol을 domain에 추가

추상화는 미리 모든 가능성을 일반화하지 않습니다. 두 구현이 필요하거나 외부 시스템이 바뀌는
지점이 확인될 때 port를 확장합니다.

## 테스트 경계

- `test/domain`: 파일 정책 같은 순수 규칙
- `test/application`: in-memory port를 이용한 side-effect 순서
- `test/adapters/esbuild`: 실제 React/TSX/CSS 번들, 미저장 overlay와 정적 resource macro
- `test/presentation`: 다중 고정 panel event routing, CSP와 동적 HTML escape
- `test/fixtures`: 실제 컴파일 입력이며 배포물에는 포함하지 않음

Extension Host 통합 테스트는 패널을 관찰할 안정적인 test seam을 추가할 때 별도 suite로 둡니다.
현재 빠른 suite는 서버 없는 컴파일 경로와 가장 중요한 보안 문자열을 직접 검증합니다.

## 배포 제약

확장 자체는 Node 20 호환 CommonJS로 번들링하지만 `vscode`와 런타임 `esbuild`는 external로
남깁니다. esbuild 네이티브 바이너리 때문에 공개 배포에서는 VS Code가 지원하는 target별 VSIX를
생성해야 합니다. `esbuild-wasm`은 단일 패키지 대안이지만 초기 목표인 빠른 편집 피드백에는
사용하지 않습니다. `package-vsix.mjs`는 현재 호스트의 target을 manifest에 기록하고, 설치된
네이티브 바이너리와 다른 플랫폼으로의 교차 패키징을 거부합니다.
