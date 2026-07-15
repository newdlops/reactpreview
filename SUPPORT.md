# 지원 정책

React File Preview는 현재 Preview 단계입니다. 일반 사용 문의, 재현 가능한 오류와 기능 제안은
[GitHub Issues](https://github.com/newdlops/reactpreview/issues)에서 관리합니다.

## 이슈를 만들기 전에

1. README의 요구사항, 지원 범위와 문제 해결 표를 확인합니다.
2. 최신 공개 버전에서도 같은 문제가 발생하는지 확인합니다.
3. 가능하면 작은 React 18 프로젝트나 공개 가능한 최소 컴포넌트로 재현합니다.
4. `React Preview` Output Channel의 진단에서 경로와 비밀값을 제거합니다.
5. alias 오류라면 표준 tsconfig가 아닌지 확인하고 `reactPreview.tsconfig`를 지정해 봅니다.

## 함께 제공할 정보

- React File Preview 버전
- VS Code 버전
- 로컬 또는 Remote 환경 여부
- 운영체제, CPU architecture와 Linux인 경우 glibc 또는 musl 여부
- React와 ReactDOM major version
- 대상 파일 확장자와 최소 재현 코드
- 실제 결과, 기대 결과와 재현 순서
- 민감 정보를 제거한 `React Preview` 진단

비공개 소스 전체, `.env`, 인증 토큰, 내부 경로, 고객 데이터는 첨부하지 않습니다. 보안 취약점은
공개 이슈에 작성하지 말고 [보안 정책](SECURITY.md)의 비공개 제보 절차를 사용합니다.

## 지원 범위 밖의 요청

Next.js SSR/RSC, 프레임워크 개발 서버, Vite/Webpack/Babel 플러그인 재사용, 서버 모듈 실행과
자동 props·router·context 모킹은 현재 지원 범위가 아닙니다. 이러한 기능은 구체적인 사용 사례와
보안 영향을 설명한 제안으로 논의할 수 있지만 구현 일정은 보장하지 않습니다.
