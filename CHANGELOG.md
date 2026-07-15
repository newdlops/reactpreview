# 변경 기록

이 프로젝트는 사용자에게 영향을 주는 변경을 이 문서에 기록합니다.

## 0.1.0 - 2026-07-15

- 서버 없이 현재 React 파일을 번들링하는 VS Code 확장 초기 구조 추가
- 저장 전 문서 overlay, React 기본 내보내기 mount, CSS·기본 asset 처리 추가
- Workspace Trust, 제한된 local resource root, 네트워크 차단 CSP 적용
- debounce, stale revision 방지, 의존 파일 저장 시 갱신 추가
- 직렬 artifact queue, 안전한 revision 정리, 종료 시 비동기 캐시 삭제 추가
- symlink 문서 overlay와 CSS Modules local class 처리 추가
- 현재 호스트 target이 표시된 플랫폼별 VSIX 패키징 추가
- strict TypeScript, ESLint 계층 규칙, Prettier, 1,000줄 검사 구성
- domain, application, 실제 esbuild, CSP/escape 테스트 추가
