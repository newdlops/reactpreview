# React File Preview 상세 사용자 가이드

이 문서는 React File Preview의 두 렌더링 모드와 Page Inspector를 실제 작업에서 사용하는 방법을
설명합니다. 프로젝트별 Provider와 정확한 업무 상태를 구성해야 한다면
[프로젝트 setup 가이드](project-setup.md)를 함께 참고하세요.

## 동작 모델

React File Preview는 전체 애플리케이션이나 개발 서버를 시작하지 않습니다. 현재 파일에서 출발해 실제
JSX 사용처와 import 경로를 분석하고, 선택한 컴포넌트에 도달하는 Page, Layout 또는 App 문맥만 브라우저용
번들로 만듭니다.

프리뷰마다 다음 상태가 독립적으로 유지됩니다.

- 고정된 대상 파일과 선택한 export
- 선택한 페이지 경로와 Inspector 보기
- 수동 props, condition과 payload override
- 마지막으로 성공한 화면과 해당 화면의 의존 파일 목록

다른 프리뷰 탭으로 이동해도 대상 파일이 바뀌지 않습니다. 대상이나 실제 번들 의존 파일을 편집하면
연결된 탭만 다시 빌드됩니다.

## 설치와 첫 프리뷰

VS Code Extensions에서 `React File Preview`를 설치하거나 다음 명령을 사용합니다.

```bash
code --install-extension newdlops.react-file-preview
```

설치 후 다음 순서로 첫 프리뷰를 엽니다.

1. Workspace Trust가 허용된 React 프로젝트를 엽니다.
2. 확인할 `.tsx`, `.jsx`, `.ts` 또는 `.js` 파일을 엽니다.
3. 에디터를 우클릭하고 `Open Current React File in Page Context`를 선택합니다.
4. 프리뷰와 별도로 열린 `Inspector · 파일명` 탭을 나란히 배치합니다.
5. Inspector 상단의 페이지 경로와 현재 파일 상태를 확인합니다.

현재 파일이 독립 컴포넌트 모음이라면 `Open Current File Export Gallery`를 사용할 수 있습니다.

## 프리뷰 모드 선택

### Page Context

`Open Current React File in Page Context`는 기본 모드입니다. 현재 파일을 실제로 import해 렌더링하는
사용처를 거슬러 올라가 가장 가까운 렌더 가능한 페이지 후보를 선택합니다.

다음 항목을 함께 확인할 때 적합합니다.

- Header, Sidebar, Form, Table 같은 부모와 형제 UI
- route, layout과 조건부 렌더링 안의 실제 배치
- 프로젝트 CSS와 styled-components theme가 적용된 결과
- Context, Router, Redux, Formik, Apollo 같은 런타임 경계
- 현재 파일이 페이지 흐름에 실제로 포함되는지 여부

여러 페이지가 같은 컴포넌트를 사용하면 `PAGE PATH`에서 후보를 바꿀 수 있습니다. 선택한 경로 하나만
실행되며 다른 페이지 후보를 한 화면에 쌓지 않습니다.

### Export Gallery

`Open Current File Export Gallery`는 현재 파일의 runtime default export와 PascalCase named export를
각각 격리해서 보여줍니다.

다음 상황에 적합합니다.

- 디자인 시스템 primitive나 self-contained 컴포넌트 비교
- 한 파일의 여러 상태형 export 확인
- 페이지 경로 문제와 컴포넌트 자체 문제 분리
- 실제 페이지가 아직 현재 export를 사용하지 않는 경우의 빠른 확인

Gallery는 작성된 Page/Layout 문맥을 재현하는 모드가 아닙니다. 페이지 정확도가 중요하면 Page Context를
우선 사용하세요.

## Page Inspector 읽기

Inspector는 프로젝트 React를 다시 실행하는 별도 프리뷰가 아니라, 현재 프리뷰의 읽기 전용 상태와 제어를
보여주는 VS Code 탭입니다.

### 주요 상태

| 표시                  | 의미                                                        |
| --------------------- | ----------------------------------------------------------- |
| `PAGE READY`          | 작성된 페이지와 현재 파일의 출력이 함께 확인됨              |
| `NOT ON THIS PATH`    | 페이지는 렌더됐지만 선택한 경로가 현재 파일을 사용하지 않음 |
| `STANDALONE`          | 신뢰할 수 있는 페이지 소유자를 찾지 못해 파일만 렌더링함    |
| `PREVIEW VALUE`       | 확장이 렌더링을 위해 추가한 명시적인 프리뷰 전용 값         |
| `BLOCKER`             | 현재 페이지 또는 대상 출력을 실제로 중단하는 조건           |
| `output not observed` | 작성된 JSX 근거는 있지만 현재 React 출력에서 확인되지 않음  |

`PREVIEW VALUE`는 오류가 아닙니다. 실제 해결이 필요한 항목만 `BLOCKER`로 표시됩니다.

### 컴포넌트 트리

Components 트리는 HTML tag보다 source-backed React 컴포넌트를 중심으로 표시합니다.

- `CURRENT FILE`: 현재 편집 파일에서 나온 컴포넌트
- `PAGE PATH`: 정적으로 확인된 다른 페이지 후보
- `CONDITION`: JSX 논리곱, 삼항식 또는 overlay 가시성 조건
- `wrapper`: host DOM 없이 children을 전달하는 Provider나 wrapper
- `OverlayPortal`: 프로젝트가 Portal로 렌더링한 top-level overlay

행을 선택하면 Props, State, Source, Payload와 Console에서 해당 컴포넌트 범위를 확인할 수 있습니다.

### 화면과 소스 연결

- `Highlight`는 선택 컴포넌트의 top-level DOM 범위와 이미 열린 source editor의 대응 위치를 표시합니다.
- `Pick on page`는 화면 요소에서 가장 가까운 React 컴포넌트를 찾아 트리에서 선택합니다.
- `Wireframe`은 페이지 frame, 컴포넌트 영역과 렌더되지 못한 대상 위치를 겹쳐 보여줍니다.
- `Open source`는 마지막 정상 번들에 포함됐다고 확인된 workspace source만 엽니다.

## 페이지 경로와 현재 파일 찾기

페이지는 정상적으로 보이지만 현재 파일이 없다는 메시지가 나오면 다음 순서로 확인합니다.

1. `PAGE PATH`에 다른 Page/Layout/App 후보가 있는지 확인합니다.
2. Components 트리의 `CURRENT FILE` 또는 `Current file` 동작으로 대상 위치를 다시 찾습니다.
3. 로그인, 권한, 로딩 또는 빈 데이터 조건이 현재 경로를 숨기는지 `CONDITION` 행을 확인합니다.
4. `Auto-find missing values`가 제공되면 현재 경로에 필요한 최소 hook/payload 값을 다시 탐색합니다.
5. 페이지 경로와 무관한 컴포넌트인지 확인하려면 `Show file by itself` 또는 Export Gallery를 사용합니다.

`Show file by itself` 결과는 페이지 성공으로 계산되지 않습니다. `Return to page`로 원래 작성 문맥에
돌아갈 수 있습니다.

## 블로커 해결

블로커를 선택하면 원인과 소유 컴포넌트, 필요한 property, source 위치와 사용 가능한 해결 방법이 표시됩니다.

일반적인 해결 순서는 다음과 같습니다.

1. `Auto pass`로 현재 사용처에서 확인된 안전한 구조를 적용합니다.
2. 더 작은 값만 필요하면 `Smart fill minimum`을 사용합니다.
3. 업무 enum, route parameter 또는 인증 상태처럼 추측할 수 없는 값은 JSON으로 직접 입력합니다.
4. JSX 표시 조건이면 `CONDITION` 행에서 필요한 branch를 선택합니다.
5. 오류를 수정한 뒤 `Retry`, `Remount` 또는 `Refresh Focused Preview`를 실행합니다.

수동 JSON은 자동값보다 우선합니다. callback은 JSON에서 `[Preview no-op function]`으로 표시되며 렌더 경계에서만
부작용 없는 함수로 복원됩니다.

프로젝트 Provider의 실제 동작이 필요하거나 여러 컴포넌트가 같은 업무 상태를 공유해야 하면 자동값을 늘리기보다
[setup 또는 작은 preview harness](project-setup.md#복잡한-페이지와-preview-harness)에 계약을 명시하세요.

## Payload와 Virtual Backend

Page Inspector는 외부 backend를 호출하지 않고 도달한 GraphQL, Fetch, Axios와 XHR 요청을 프리뷰 탭의
payload registry에 기록할 수 있습니다.

`Payload`에서 다음 작업을 할 수 있습니다.

- 타입과 GraphQL selection을 기반으로 한 `Auto` 데이터 사용
- 같은 구조를 유지하는 Lorem 데이터 생성
- 배열과 scalar를 포함한 JSON 직접 적용
- `Success`, `Empty data`, `HTTP error` 응답 선택
- 응답 지연 설정
- 같은 REST resource에 대한 프리뷰 내부 CRUD 상태 초기화

자동 생성 배열은 UI가 목록 상태를 확인할 수 있도록 기본적으로 복수의 샘플 항목을 사용합니다. 실제 업무 관계,
권한, enum과 route 의미가 중요하면 JSON 또는 setup 값을 사용하세요.

Payload와 응답 scenario는 해당 프리뷰 탭에만 저장되고 외부 서버로 전송되지 않습니다.

## Props와 조건 조정

선택한 target 또는 ancestor root의 직렬화 가능한 props를 JSON으로 바꿀 수 있습니다. boolean, number, string,
array와 plain object만 보존되며 함수, symbol과 순환 객체는 편집 대상으로 저장하지 않습니다.

`CONDITION`은 작성된 값을 기본으로 사용합니다. 사용자가 branch를 강제한 경우에만 JSX 조건을 바꾸며,
`Use authored value`로 원래 동작을 복원할 수 있습니다.

## 갱신과 마지막 정상 화면

- 대상 또는 마지막 정상 번들의 의존 파일이 바뀌면 설정된 지연 시간 뒤 해당 탭만 갱신됩니다.
- 저장하지 않은 editor 내용은 디스크보다 우선합니다.
- 새 빌드가 실패하면 가능한 경우 마지막 정상 화면을 유지하면서 오류를 표시합니다.
- 새 ESM과 CSS를 준비한 뒤 성공했을 때만 React root를 교체합니다.
- 프리뷰 root는 다시 마운트되므로 일반 React Fast Refresh처럼 local hook state를 보존하지 않습니다.

수동 갱신은 `React Preview: Refresh Focused Preview`를 사용합니다.

## 설정

| 설정                               | 기본값 | 설명                                                       |
| ---------------------------------- | ------ | ---------------------------------------------------------- |
| `reactPreview.updateDelay`         | `300`  | 편집 후 자동 갱신까지 기다릴 밀리초                        |
| `reactPreview.maxOutputSizeMiB`    | `128`  | 프리뷰 한 건의 JS, CSS와 encoded asset 출력 상한           |
| `reactPreview.tsconfig`            | `""`   | 비표준 alias에 사용할 workspace-relative tsconfig/jsconfig |
| `reactPreview.setupFile`           | `""`   | 자동 setup보다 우선하는 명시적 프로젝트 setup 모듈         |
| `reactPreview.useStorybookPreview` | `true` | setup이 없을 때 가까운 Storybook preview decorator 재사용  |

Provider별 설정과 setup export 형식은 [프로젝트 setup 가이드](project-setup.md)를 참고하세요.

## 신뢰와 개인정보

프리뷰는 프로젝트 source와 도달한 package를 브라우저 코드로 실행하므로 Workspace Trust가 필요합니다.
웹뷰는 외부 네트워크, frame, worker, form, inline script와 `eval`을 차단합니다. 확장은 텔레메트리와 workspace
source 또는 preview payload를 전송하지 않습니다.

지원되는 lockfile이 정확한 public package와 integrity를 증명하고 local package가 없을 때는 확장 worker가
해당 public package를 관리 저장소에 준비할 수 있습니다. 자세한 경계와 취약점 제보 방법은
[보안 정책](../SECURITY.md)을 확인하세요.

## 다음 문서

- [호환성과 제한](compatibility.md)
- [프로젝트 setup 가이드](project-setup.md)
- [문제 해결과 지원 정책](../SUPPORT.md)
- [변경 기록](../CHANGELOG.md)
