# Project instructions

Read `CONTRIBUTING.md` before changing this repository.

## 작업 종료 시 버전업 및 로컬 재설치

- 사용자의 기본 요청: 이 프로젝트에서 코드 변경 작업을 마칠 때마다 별도 요청을 기다리지
  않고 버전업과 로컬 VS Code 확장 재설치를 완료한다. 분석·질문 응답만 하고 확장 변경이
  없는 작업에는 불필요한 버전업을 하지 않는다. 사용자의 최신 지시가 우선한다.
- 여기서 세션 종료는 변경 작업을 검증하고 최종 결과를 전달하는 시점이다. 앱 종료나 연결
  중단을 감지하는 백그라운드 자동화가 설치되어 있다고 가정하지 않는다.
- 해당 작업에서 이미 버전을 올렸다면 중복으로 올리지 않는다. 그렇지 않으면 `package.json`의
  현재 버전에서 patch를 1 올리고 `CHANGELOG.md`에 실제 변경 내용을 반영한다. 모든 텍스트
  파일은 1,000줄 이내로 유지한다. 버전업만을 위해 git commit이나 tag를 만들지 않는다.
- `npm run check`와 변경 범위의 회귀 검증을 수행한다. 기존의 무관한 실패는 새 실패와 구분해
  알리고, 해당 검사가 통과했다고 표현하지 않는다. 현재 변경의 검증이나 production build가
  실패하면 설치를 강행하지 않고 원인을 해결하거나 미완료 상태를 보고한다.
- `scripts/package-vsix.mjs`로 현재 플랫폼용 VSIX를 만든다. 이 스크립트의 prepublish 단계에서
  production build가 실행된다. 산출물은 고유한 `.tmp/` 하위 디렉터리에 보관하고
  `VSIX_OUTPUT_DIR`로 출력 위치를 지정할 수 있다.
- VSIX의 버전, 플랫폼, 런타임 번들 및 네이티브 의존성을 확인하고, 프로젝트 지침·로컬 설정·
  임시 파일이 패키지에 포함되지 않았는지 확인한다. 검증한 정확한 VSIX 경로로
  `code --install-extension <VSIX의 절대 경로> --force`를 실행한다. 필요한 실행 권한 승인은
  정상적으로 요청하며, 이 기본 요청을 권한 승인 절차를 우회하는 근거로 삼지 않는다.
- 설치 후 확장 버전과 설치된 런타임 번들이 검증한 패키지와 일치하는지 확인한다. 기존 확장의
  설정과 학습 기록은 보존하며, 재설치를 위해 저장 상태를 초기화하거나 기존 확장을 먼저
  삭제하지 않는다.
- 최종 응답에 설치 버전과 검증 결과를 짧게 알리고, 필요하면 `Developer: Reload Window`를
  안내한다. 실제로 확인하지 않은 창 재로드나 화면 검증을 완료했다고 표현하지 않는다.
- 이 절차는 로컬 버전업·패키징·재설치 요청이다. Marketplace 게시, git commit, tag, push는
  사용자가 별도로 요청한 경우에만 수행한다.

<!-- codex-ui-global:start -->

## User-visible UI and frontend work

- When a task creates or changes a user-visible interface, use `$ui-design-workflow` before implementation. Skip it only for a pure copy edit that cannot affect layout.
- Read all applicable project instructions and inspect the existing design system, shared components, tokens, and adjacent screens before changing UI code.
- For substantial new UI or redesign work, establish an explicit design direction and acceptance checks before broad implementation.
- Preserve an existing product's visual language. Reuse its components and tokens instead of introducing a parallel design system.
- Implement relevant loading, empty, error, success, disabled, focus, hover, selected, long-text, dense-data, and overflow states.
- Treat functional QA and visual QA as separate requirements. A successful build, lint, typecheck, or unit test is not visual verification.
- When browser tooling is available, inspect the actual rendered route at representative mobile, tablet, and desktop sizes, exercise normal user interactions, and fix visible defects before completion.
- Use the smallest useful specialist set: `$ui-ux-pro-max` for design direction, `$impeccable` for critique and polish, `$web-design-guidelines` for web UX/accessibility audit, and `$vercel-react-best-practices` only for React/Next.js work.
- Do not claim a browser, viewport, interaction, test, or audit was checked unless it was actually performed. State unavailable tooling and remaining limitations explicitly.

<!-- codex-ui-global:end -->
