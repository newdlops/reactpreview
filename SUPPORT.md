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
7. Theme 스타일이 비어 있으면 자동 구조적 theme 대신 `themePreview.theme`이나 실제 ThemeProvider를
   사용하고, Redux selector가 nested state에서 실패하면 `reduxPreview.state`에 최소 정적 값을 둡니다.
8. Apollo query 화면이라면 자동 정적 결과로 충분한지 확인하고, 정확한 값은 setup의
   `apolloPreview.resolveOperation`에서 메모리 object로 반환합니다.
9. Storybook setup 경고라면 `.storybook/preview.*`가 현재 코드에서 독립적으로 번들링되는지
   확인하거나 전용 setup을 사용합니다.

Runtime 화면의 `provider required` 또는 `project runtime setup required` 안내는 번들링 실패가
아닙니다. 자동 구조적 theme과 빈 Redux store로 표현할 수 없는 state, route, 정확한 디자인 값 또는
props가 필요하다는 뜻입니다. 플러그인은 특정 프로젝트 의미를 추측하지 않으므로
`.react-preview/setup.tsx`나 작은 `*.preview.tsx` harness에서 네트워크 없는 정적 계약을 제공하세요.

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
- 실제 결과, 기대 결과와 재현 순서
- 민감 정보를 제거한 `React Preview` 진단

비공개 소스 전체, `.env`, 인증 토큰, 내부 경로, 고객 데이터는 첨부하지 않습니다. 보안 취약점은
공개 이슈에 작성하지 말고 [보안 정책](SECURITY.md)의 비공개 제보 절차를 사용합니다.

## 지원 범위 밖의 요청

Next.js SSR/RSC, 프레임워크 개발 서버, Vite/Webpack/Babel 플러그인 재사용, `.env` 사용자 변수,
서버 모듈 실행, 런타임에만 결정되는 무제한 import와 프로젝트 의미를 추측하는 자동
props·router·deep state 모킹은 현재 지원 범위가 아닙니다. 명시적 setup module의 Provider와 props를
지원하며 자동 계층은 Apollo selection-shaped 결과, 값 없는 styled-components theme과 빈 Redux
state처럼 부작용 없는 최소 구조로 제한합니다.
`import.meta.glob`/`require.context` 호환 계층도 리터럴 상대 경로와 안전한 옵션
일부만 지원하며 매크로당 128개 패턴·256개 파일·4,096개 조회·20단계 깊이와 빌드 합산 한도를
넘으면 진단과 함께 중단합니다.
이러한 범위 확장은 구체적인 사용 사례와 보안 영향을 설명한 제안으로 논의할 수 있지만 구현 일정은
보장하지 않습니다.
