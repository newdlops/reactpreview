# 지원 정책

React File Preview는 현재 Preview 단계입니다. 일반 사용 문의, 재현 가능한 오류와 기능 제안은
[GitHub Issues](https://github.com/newdlops/reactpreview/issues)에서 관리합니다.

## 이슈를 만들기 전에

1. README의 요구사항, 지원 범위와 문제 해결 표를 확인합니다.
2. 최신 공개 버전에서도 같은 문제가 발생하는지 확인합니다.
3. 가능하면 작은 React 18 프로젝트나 공개 가능한 최소 컴포넌트로 재현합니다.
4. `React Preview` Output Channel의 진단에서 경로와 비밀값을 제거합니다.
5. alias 오류라면 표준 tsconfig가 아닌지 확인하고 `reactPreview.tsconfig`를 지정해 봅니다.
6. 동적 리소스 오류라면 패턴이 `./` 또는 `../`로 시작하는 리터럴인지, 탐색 범위가 README의
   안전 한도 안인지 확인합니다.
7. Theme 스타일이 비어 있으면 활성 파일이나 도달한 styled-components 자식이 `theme` named/type
   import를 명시하는지, 서로 다른 후보가 동점인지 확인합니다. 모호하면 `themePreview.theme`이나 실제
   ThemeProvider를 사용합니다. Redux selector의 객체 경로는 도달 가능한 소스의 `useSelector` 계열
   callback과 이후 비옵셔널 property 접근에서 자동 수집됩니다. 계산형·동적 접근이나 leaf 값이 필요하면
   `reduxPreview.state`에 정확한 정적 값을 둡니다.
8. Apollo query 화면이라면 자동 정적 결과로 충분한지 확인하고, 정확한 값은 setup의
   `apolloPreview.resolveOperation`에서 메모리 object로 반환합니다.
9. route 경로나 parameter가 필요하면 `routerPreview.initialEntries`를 지정합니다. 자동 분석은 실제
   target-rooted graph의 자식·손자까지 consumer/provider 근거를 수집하고 provider를 발견하면 nested
   Router를 만들지 않습니다. 의도적으로 자동 경계를 끄려는 경우에만 `routerPreview = false`를
   명시합니다.
10. custom Context 오류라면 inline 타입 또는 같은 파일의 유일한 non-generic·acyclic interface/type
    alias로 neutral fallback을 완전히 만들 수 있는지 확인합니다. imported/generic/recursive/extends/
    merged 타입은 호출부의 정적 `use*Context` 사용 형태에서 plain container/no-op method만 보완될 수
    있지만 의미 있는 leaf state나 hook 내부 throw는 setup이나 작은 harness의 실제 Provider로 공급합니다.
11. Formik context 오류라면 runtime 보고서의 Formik 상태를 확인합니다. 자동 경계가 active인데 정확한
    field 값이 필요하면 `formikPreview.initialValues`에 최소 plain data를 두고, 실제 Form 동작은 harness로
    제공합니다.
12. Storybook setup 경고라면 `.storybook/preview.*`가 현재 코드에서 독립적으로 번들링되는지
    확인하거나 전용 setup을 사용합니다.
13. 자동 props가 보이지 않으면 사용 파일이 대상과 같은 가장 가까운 package 안에서 component를
    import하고 literal JSX attribute를 전달하는지 확인합니다. 새로 만든 사용 파일은 5초 뒤 Refresh하면
    정적 source 인덱스에 들어오며, 의미 있는 값은 setup이나 harness에 명시합니다.
14. wrapper 스타일이나 DOM 구조가 빠졌다면 runtime 보고서의 `Parent render slice`를 확인합니다. 자동
    slice는 실제 JSX 사용에서 target까지의 한 branch만 유지하고 sibling/parent owner를 실행하지 않습니다.
    imported Form/Provider의 dynamic prop·spread에서는 safe partial path로 멈추므로 그 바깥 Provider가 꼭
    필요하면 `.react-preview/setup.tsx`나 `*.preview.tsx` harness에 정적 계약을 명시합니다.
15. Page Inspector가 다른 화면을 열면 workspace 안에서 해당 export/barrel을 실제로 import한 사용처가
    여러 개인지 확인합니다. Inspector는 page/layout/App 관례를 우선하지만 업무 route 의미는 추측하지
    않습니다. toolbar ancestry가 `partial`이면 non-component route config, private terminal, cycle 또는
    8단계 한도에서 멈춘 것이며 원하는 scenario는
    harness로 명시합니다. target이 보이지 않으면 Root/Target props를 확인하고 portal DOM은
    `Pick element`로 선택합니다.
16. wildcard-only barrel에서 Inspector warning이 나오면 direct-root 조작은 계속 사용할 수 있지만
    parent/sibling ancestry는 증명되지 않은 상태입니다. 가능한 경우 실제 component 파일 또는 이름이 있는
    re-export를 열어 Inspector를 실행합니다.

Runtime 화면의 `provider required` 또는 `project runtime setup required` 안내는 번들링 실패가
아닙니다. 보고서 첫 부분의 direct headline과 실패 phase, target/export/setup/classification을 먼저
확인하고, 이어지는 parent render slice 상태, Apollo·Formik·Redux·Router·Theme 자동 경계 상태, React
component stack, JavaScript stack, cause/AggregateError와 primitive own field를 함께 비교하세요. Apollo
compact invariant URL은 version,
message code와 arguments만 로컬에서 decode하며 문서 사이트나 backend에 요청하지 않습니다. 진단 패널
스타일은 프로젝트 CSS에서 격리되므로 앱의 전역 `pre` 규칙 때문에 정보가 숨지 않습니다.

자동 발견 theme, selector-derived Redux state skeleton, static Formik boundary, root MemoryRouter와 bounded Context neutral
default로 표현할 수 없는 state, 실제 route table 또는 props가 필요하다는 뜻이라면
`.react-preview/setup.tsx`나 작은
`*.preview.tsx` harness에서 네트워크 없는 정적 계약을 제공하세요. 플러그인은 특정 프로젝트 의미를
추측하지 않습니다.

## 함께 제공할 정보

- React File Preview 버전
- VS Code 버전
- 로컬 또는 Remote 환경 여부
- 운영체제, CPU architecture와 Linux인 경우 glibc 또는 musl 여부
- React와 ReactDOM major version
- 대상 파일 확장자와 최소 재현 코드
- 문제가 된 `import.meta.glob`, `require.context`, template/연결식 import·require 또는 `new URL`
  형태와 파일 구조
- 여러 프리뷰 탭 문제라면 각 탭의 고정 대상, 포커스 여부와 Refresh 실행 순서
- 모노레포 정적 분석 문제라면 대상에서 가장 가까운 `package.json` 경계와 사용 파일의 package
- parent slice 문제라면 실제 JSX target 사용, 같은 파일 private owner, target까지의 wrapper 순서와
  처음 만나는 dynamic prop/spread Form·Provider 위치
- Page Inspector 문제라면 선택된 Target/Root, toolbar ancestry와 partial reason, 실제로 선택된 JSX
  사용처, highlight/picker 상태와 민감값을 제거한 props JSON
- export 갤러리 문제라면 각 export의 이름·선언 순서와 default/PascalCase 여부
- 실제 결과, 기대 결과와 재현 순서
- 민감 정보를 제거한 `React Preview` 진단

비공개 소스 전체, `.env`, 인증 토큰, 내부 경로, 고객 데이터는 첨부하지 않습니다. 보안 취약점은
공개 이슈에 작성하지 말고 [보안 정책](SECURITY.md)의 비공개 제보 절차를 사용합니다.

## 지원 범위 밖의 요청

Next.js SSR/RSC, 프레임워크 개발 서버, Vite/Webpack/Babel 플러그인 재사용, `.env` 사용자 변수,
전체 app entry·인증 bootstrap·API client·서버 모듈 실행, 런타임에만 결정되는 무제한 import와 프로젝트
의미를 추측하는 자동 props·route graph·deep state 모킹은 현재 지원 범위가 아닙니다. 명시적 setup
module의 Provider와 props를 지원하며 자동 계층은 Apollo selection-shaped 결과, 도달한 styled 소스가
명시한 resolved theme과
누락 token fallback, selector에서 증명된 객체 container만 가진 Redux state skeleton, no-submit Formik
boundary, root MemoryRouter와 안전한 구조 선언/호출부 사용 형태에서 만든 Context fallback처럼 부작용
없는 최소 구조로 제한합니다. Redux/Formik/Context의 leaf 값·enum·boolean은 추측하지 않고 reducer, store module,
bootstrap과 backend를 실행하지 않습니다. optional·computed·unsafe 또는 한도를 넘는 selector 경로는
fail closed하며, 이때 필요한 값은 setup이 소유합니다.
Page Inspector도 workspace 안에서 구문과 module resolution으로 증명된 실제 ancestor export만 opt-in으로
실행합니다. 이는 React DevTools의 전체 tree 편집, 임의 Fiber/hook/local state slot 수정, 여러 사용처 중
업무 route 자동 선택, workspace 밖 app shell 또는 backend 실행을 제공한다는 뜻이 아닙니다. 직렬화 가능한 target/root props와
실제 페이지 event UI만 조작할 수 있고 source hot reload 뒤 프로젝트 hook state는 초기화됩니다.
`import.meta.glob`/`require.context` 호환 계층도 리터럴 상대 경로와 안전한 옵션
일부만 지원하며 매크로당 128개 패턴·256개 파일·4,096개 조회·20단계 깊이와 빌드 합산 한도를
넘으면 진단과 함께 중단합니다.
이러한 범위 확장은 구체적인 사용 사례와 보안 영향을 설명한 제안으로 논의할 수 있지만 구현 일정은
보장하지 않습니다.
