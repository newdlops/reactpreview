# 변경 기록 보관

현재 `CHANGELOG.md`의 1,000줄 제한을 지키기 위해 오래된 변경 기록을 이 문서에 보관합니다.

## 0.1.1012 - 2026-07-16

- 파일 고정 다중 탭, 명시적 refresh와 서버 없는 ESM/CSS hot reload, revision·artifact lease를 추가
- esbuild 기본 resolver와 package별 source cache, dynamic import·glob·require context·public asset을 포함하는 bounded graph 분석을 도입
- export gallery, setup/Storybook fallback과 Apollo·Redux·Router·Theme·Context의 네트워크 없는 정적 runtime 경계를 추가
- React component/JS stack과 자동 runtime 경계 상태를 보존하는 bounded 오류 보고서 및 격리된 진단 UI를 추가
- 프로젝트 업무 의미를 내장하지 않는 범용 setup/harness 복구 원칙과 정적 리소스 안전 한도를 확립

## 0.1.0 - 2026-07-15

- 서버 없이 현재 React 파일과 도달 가능한 import graph를 번들링하는 VS Code 확장 초기 구조 추가
- 저장 전 문서/dependency overlay, JSX/CSS Modules/asset/SVG/query import와 alias 처리 추가
- Workspace Trust, 제한된 local resource root, 네트워크 차단 CSP와 대용량 asset 사전 차단 적용
- stale revision 방지, dependency hot rebuild, artifact queue/lease/cleanup 및 플랫폼별 VSIX 추가
- `newdlops` 배포 메타데이터와 strict TypeScript, 계층 lint, formatter, 1,000줄 및 통합 테스트 구성
