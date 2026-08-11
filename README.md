<p align="center">
  <img src="assets/icon.png" alt="React File Preview 아이콘" width="128" height="128">
</p>

# React File Preview

React 컴포넌트가 실제 페이지 안에서 어떻게 보이는지 VS Code에서 바로 확인하세요.
개발 서버나 별도 HTTP 포트 없이 현재 파일과 저장 전 변경사항을 격리된 프리뷰 탭에 렌더링합니다.

> 현재 `0.1.x`는 Preview 릴리스입니다. 전체 애플리케이션을 실행하는 대신 선택한 파일에 도달하는
> 페이지 문맥과 브라우저에서 안전하게 재현할 수 있는 프로젝트 런타임만 구성합니다.

## 주요 특징

- **실제 페이지 문맥**: 선택한 컴포넌트의 사용처를 따라가 가장 가까운 Page, Layout 또는 App 안에서
  부모·형제·조건부 UI와 함께 렌더링합니다.
- **파일별 독립 프리뷰**: 여러 React 파일을 각각 고정된 탭으로 열고, 대상 또는 의존 파일이 바뀐
  프리뷰만 자동 갱신합니다.
- **React Page Inspector**: 컴포넌트 트리, 현재 파일 위치, Wireframe, 요소 선택, 강조 표시와 소스 이동을
  한 화면에서 사용할 수 있습니다.
- **블로커와 데이터 제어**: 숨겨진 JSX 분기, 필요한 props와 hook 값, GraphQL/REST payload를 확인하고
  Auto·Smart·JSON 값으로 프리뷰 상태를 조정할 수 있습니다.
- **스타일과 자산 재사용**: 프로젝트의 CSS, CSS Modules, Sass, Tailwind, styled-components theme,
  이미지·폰트와 public asset을 가능한 범위에서 그대로 사용합니다.
- **서버 없는 격리 실행**: 앱의 백엔드나 개발 서버를 시작하지 않고, 외부 네트워크가 차단된 VS Code
  웹뷰에서 번들을 실행합니다.

## 설치

VS Code Extensions에서 `React File Preview`를 검색하거나 다음 명령을 실행합니다.

```bash
code --install-extension newdlops.react-file-preview
```

검토용 VSIX는 Extensions 화면의 `Install from VSIX...`로 설치할 수 있습니다.

## 빠른 시작

1. 신뢰할 수 있는 React 워크스페이스에서 `.tsx`, `.jsx`, `.ts` 또는 `.js` 파일을 엽니다.
2. 에디터를 우클릭하고 **Open Current React File in Page Context**를 선택합니다.
3. 프리뷰 옆에 열린 Inspector에서 현재 파일의 페이지 경로와 렌더 위치를 확인합니다.
4. 필요한 경우 `PAGE PATH`, JSX 조건, props 또는 Payload 값을 조정합니다.
5. 파일을 편집하면 연결된 프리뷰가 자동으로 갱신됩니다.

명령 팔레트에서도 `React Preview`를 검색해 같은 명령을 실행할 수 있습니다.

## 프리뷰 모드

| 모드                                      | 언제 사용하나요?                                                |
| ----------------------------------------- | --------------------------------------------------------------- |
| `Open Current React File in Page Context` | 실제 Page/Layout/App 안에서 현재 파일의 위치와 동작을 확인할 때 |
| `Open Current File Export Gallery`        | 현재 파일의 컴포넌트 export를 서로 격리해 빠르게 비교할 때      |
| `Refresh Focused Preview`                 | 자동 갱신을 기다리지 않고 현재 프리뷰를 즉시 다시 빌드할 때     |

Page Context가 정확한 사용처를 찾지 못하면 프리뷰에 `STANDALONE`으로 표시됩니다. 이 경우 다른
`PAGE PATH`를 선택하거나 Export Gallery에서 파일 자체를 확인할 수 있습니다.

## Inspector 사용법

- 컴포넌트 트리에서 **CURRENT FILE**을 찾아 실제 페이지 계층을 확인합니다.
- **Pick on page**로 화면의 요소를 선택하거나 **Highlight**로 선택 컴포넌트의 DOM 범위를 표시합니다.
- **Wireframe**으로 페이지와 컴포넌트가 차지하는 영역을 비교합니다.
- `CONDITION` 행에서 JSX의 표시 분기를 전환합니다.
- `PREVIEW VALUE` 또는 `BLOCKER`에서 필요한 props, hook 값과 API payload를 검토합니다.
- 정확한 업무 데이터가 필요하면 JSON을 직접 적용하고, 원래 코드 상태로 돌아가려면 override를
  초기화합니다.

자동 생성된 값은 프리뷰 전용이며 실제 애플리케이션 데이터로 취급되지 않습니다.

## 요구사항

- VS Code 1.100 이상
- React 16.8 이상 프로젝트
- 로컬 파일 또는 VS Code Remote 워크스페이스
- Workspace Trust가 허용된 워크스페이스

VS Code for Web과 가상 워크스페이스는 지원하지 않습니다. Remote SSH, Dev Container와 Codespaces는
원격 운영체제에 맞는 확장 패키지가 필요합니다.

## 자세한 문서

상세 설정, 호환 범위, 문제 해결과 구현 문서는 GitHub에서 관리합니다.

- [문서 전체 보기](https://github.com/newdlops/reactpreview/blob/main/docs/README.md)
- [상세 사용자 가이드](https://github.com/newdlops/reactpreview/blob/main/docs/user-guide.md)
- [호환성과 제한](https://github.com/newdlops/reactpreview/blob/main/docs/compatibility.md)
- [프로젝트 setup과 Provider 구성](https://github.com/newdlops/reactpreview/blob/main/docs/project-setup.md)
- [문제 해결과 지원 정책](https://github.com/newdlops/reactpreview/blob/main/SUPPORT.md)
- [변경 기록](https://github.com/newdlops/reactpreview/blob/main/CHANGELOG.md)

버그와 기능 요청은 [GitHub Issues](https://github.com/newdlops/reactpreview/issues)에 등록해 주세요.
보안 문제는 공개 이슈 대신
[보안 정책](https://github.com/newdlops/reactpreview/blob/main/SECURITY.md)의 비공개 제보 경로를 사용해 주세요.

## 라이선스

[MIT License](https://github.com/newdlops/reactpreview/blob/main/LICENSE) · Publisher: `newdlops`
