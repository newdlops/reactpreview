# Deferred UI 범위 분석 재사용과 바인딩 구분 — 0.1.1712

## 변경 이유

`previous-directors-panel.tsx`가 도달하는 모듈의 프로파일에서 JSX 이벤트마다 전체 lexical
statement list의 재대입 여부를 다시 탐색하는 비용을 확인했습니다. 상태 전환 fallback은
같은 이벤트에서 이 탐색을 두 번 수행했습니다. 40개 이벤트 회귀 fixture에서는 무관한 함수
본문의 statement list를 82번 읽었습니다.

기존 분석은 JSX 위치에서 모은 하나의 이름 표로 다른 함수 내부의 참조까지 해석했습니다.
같은 이름의 매개변수나 지원하지 않는 지역 선언을 건너뛰면 바깥 함수의 증명을 빌려 오고,
바깥 함수가 실제로 참조하는 선언을 내부 이름으로 덮으면 정상 핸들러도 놓칠 수 있었습니다.

## 구현과 유지하는 계약

- esbuild adapter의 `previewDeferredUiHandlerScope.ts`가 구문 범위의 선언과 전체 대입 사실을
  private AST 노드별 WeakMap으로 공유합니다. 소스 경로나 문자열만으로 다른 revision의
  결과를 재사용하지 않으며, 런타임 데이터·활성화 판단은 캐시하지 않습니다.
- 실제 참조 위치에서 가까운 바인딩을 찾습니다. 매개변수·구조 분해·mutable/opaque 선언·
  반복문·catch·switch·namespace·클래스 정적 블록도 바깥 이름을 가립니다. 함수와 namespace의
  `var` 호이스팅은 서로 다른 함수·클래스·namespace를 넘지 않습니다.
- 초기화 순서에 따른 증명 허용 여부와 바인딩의 정체성을 분리합니다. JSX 위치로 추출하는
  상태 전환은 setter와 식별자 인수가 원래 호출의 바인딩과 같을 때만 등록합니다.
- 기존 별칭 깊이 4, 모듈당 등록 64개, 소스 순서, 중첩 재대입의 보수적 거절, 원본 핸들러의
  한 번 평가와 함수 객체 동일성, 명시적 사용자 활성화를 유지합니다.
- 추가 의존성·원본 프로젝트 수정·프로젝트 설정 실행·상주 작업·시스템 정책 변경은 없습니다.

## 검증

검증 산출물은 `.tmp/preview-analysis-1712-20261101/`에 보관합니다. 초기 이름 가림·선언 범위·
반복 스캔 실패 17건과 상태 재생·타입 wrapper 실패 3건을 먼저 재현했습니다. 별도 코드
검토에서 찾은 늦은 바인딩·namespace·정적 블록 사례도 실패를 확인한 뒤 보강했습니다.

동일한 구문 fixture의 6회 측정 중앙값에서 이벤트 40개의 분석은 9.63ms에서 1.28ms,
100개는 28.94ms에서 1.67ms로 줄었습니다. 등록 내용은 동일하며 100개 입력에서도 기존
64개 등록 상한을 유지합니다. 이 수치는 해당 변환의 국소 측정이며 전체 프리뷰 시간과
동일하지 않습니다.

## 환경 제한

PortManager의 전용 주소는 `127.1.0.1`이지만 현재 `lo0`에 그 주소가 없습니다. 일반 TCP
브라우저 검사는 `EADDRNOTAVAIL`로 실패할 수 있습니다. 주소·정책을 바꾸지 않고 자체 산출물을
CDP pipe와 메모리 응답으로 전달하는 별도 진단으로 실제 렌더링을 검사합니다. 이 진단용
전송 변경은 임시 하네스에만 있으며 배포 런타임에 포함하지 않습니다. 실제 VS Code 작업창의
재로드·화면 검증을 수행한 것으로 간주하지 않습니다.

<!-- final-validation:start -->

## 최종 검사와 실제 출력

- 관련 회귀 검사: 7개 파일, 91개 테스트 통과.
- `npm run check`: 줄 수·strict typecheck·ESLint·Prettier 통과. 전체 테스트의 기존 전용
  루프백 실패 12건은 0.1.1711과 이름까지 동일합니다. 전체 검사를 통과로 기록하지 않습니다.
- 수정 전후 payroll·VCM은 동일한 DOM 텍스트·라우트·실행 후보에서 페이지 안의 대상 출력,
  마운트 1회, blocker 0, CDP 예외·window error 0을 확인했습니다. 두 프로젝트의 의존성 순서,
  CSS, 문맥 coverage, 진단, 번들 크기도 유지됩니다.
- 1440px payroll·VCM과 390px payroll 화면을 확인했습니다. 임원 탭을 각각 클릭한 뒤에도
  Inspector가 고정한 과거 임원 대상이 유지됐고, 명시적 props 표본으로 임원 2행을 확인했습니다.
  탭 클릭 후 `현재 임원` 선택이 유지되는 동작까지 통과했다고 주장하지 않습니다.
- 390px 화면의 대상 패널은 표시되지만 상단 개발 환경 배너는 겹칩니다. 이번 변경에서 그
  원본 셸과 표본 문구를 수정하지 않았습니다.
- production build·darwin-arm64 VSIX·네이티브 esbuild를 검증하고 **0.1.1712를 로컬 설치**했습니다.
  설치 payload 2465개와 패키지가 일치하며 설치된 워커의 실제 페이지 렌더도 확인했습니다.
- 설정·학습 모델·최근 import·기존 작업 계획과 0.1.1710/1711 구현을 보존했습니다. 설치된
  확장의 상태를 초기화하거나 기존 확장 디렉터리를 수동 삭제하지 않았습니다.

각 버전의 새 워커 첫 실행 2회와 같은 워커 재실행 2회를 교대로 측정한 중앙값입니다.
컨텍스트 구간의 차이는 관찰값이며 이 변경의 직접 효과로 단정하지 않습니다. VCM 번들링은
소폭 변동해 속도 향상으로 평가하지 않습니다.

| 대상    | 컨텍스트 전→후 | 번들링 전→후  | 전체 전→후    |
| ------- | -------------- | ------------- | ------------- |
| payroll | 1.073→0.997초  | 5.048→4.872초 | 7.247→6.995초 |
| vcm     | 0.413→0.403초  | 3.004→3.021초 | 3.769→3.827초 |

일반 TCP 검사에서 남은 실패 이름은 다음과 같습니다.

- `test/presentation/previewPageColorCascade.test.ts > preview page color cascade > preserves layered page tokens through light, dark, host-theme, and light-return states`
- `test/presentation/previewPageColorCascade.test.ts > preview page color cascade > keeps a readable bare page while allowing unlayered app colors to take precedence`
- `test/adapters/node/previewColdStartupRuntime.test.ts > cold preview startup in Chromium > renders and reports actual startup failures in component mode`
- `test/adapters/node/previewColdStartupRuntime.test.ts > cold preview startup in Chromium > renders and reports actual startup failures in page-inspector mode`
- `test/adapters/node/previewHeadlessDocumentGuards.test.ts > headless preview document guards > declines confirm and alert dialogs instead of freezing the page`
- `test/adapters/node/previewHeadlessDocumentGuards.test.ts > headless preview document guards > keeps the preview document when the page steps back or assigns another URL`
- `test/adapters/node/previewHeadlessRenderer.test.ts > preview headless renderer > cleans every owned resource after invalid launch, early exit, and forced timeout`
- `test/adapters/node/previewHeadlessRenderer.test.ts > preview headless renderer > sanitizes the explicit Chromium spawn environment without mutating its source`
- `test/adapters/node/previewHeadlessRenderer.test.ts > preview headless renderer > renders committed DOM and reports a provider Router invariant from Chromium`
- `test/adapters/node/previewPageFrameRuntime.test.ts > authored page frame in Chromium > renders the page without inactive routes or missing shell props (dense: false)`
- `test/adapters/node/previewPageFrameRuntime.test.ts > authored page frame in Chromium > renders the page without inactive routes or missing shell props (dense: true)`
- `test/adapters/esbuild/previewLazyStyleCachedImportBrowser.test.ts > restores a canceled module CSS on the old cached import without evaluating it twice`
