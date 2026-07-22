# 변경 기록 보관

현재 `CHANGELOG.md`의 1,000줄 제한을 지키기 위해 오래된 변경 기록을 이 문서에 보관합니다.

## 0.1.1016 - 2026-07-16

- 실제 JSX target 사용을 역추적해 sibling과 parent owner를 실행하지 않고 intrinsic/imported wrapper 한 갈래만 export별 Virtual DOM recipe로 합성하는 pinpoint parent render slice 추가
- 같은 파일의 private `Body` 사용과 render-function children을 bounded하게 따라가고, dynamic prop·spread가 필요한 imported Form/Provider에서는 검증된 inner partial path만 유지하는 fail-closed 경계 추가
- 선택된 wrapper와 target만 가상 ESM이 import하도록 분리해 wrapper의 styled-components/CSS/자식 graph는 esbuild의 정방향 해석을 재사용하고 unrelated parent/sibling export는 tree-shake
- parent slice consumer를 dependency cache와 hot reload graph에 포함하고 runtime 오류에 wrapper 수와 complete/partial 상태를 표시; 명시적 setup과 Storybook composition은 자동 slice보다 우선

## 0.1.1013 - 2026-07-16

- target-rooted graph에서 Formik consumer/provider 근거를 수집하고, 부모 `<Form>` 없이 직접 연 leaf 컴포넌트에는 프로젝트가 설치한 동일 Formik 인스턴스로 backend 없는 정적 Provider를 자동 구성
- import된 `use*Context` 호출이 실제로 역참조하는 객체 container와 호출 메서드만 bounded하게 수집해, 실제 Provider 값은 보존하면서 missing custom Context에 stable·deeply frozen fallback을 제공
- `Object.keys/values/entries`를 사용하는 같은 파일의 bounded helper까지 객체 요구를 전파하고 leaf 값, computed/optional/unsafe 경로와 프로젝트 업무 상태는 추측하지 않는 fail-closed 경계 유지
- 모노레포의 nested package에서 workspace root에 hoist된 package와 package-export `.mjs`/`.cjs` entry를 기본 resolver로 해석하는 독립 회귀 테스트 추가

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
