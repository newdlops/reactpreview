# 타입 기반 자동 복구

Page Inspector는 페이지의 진입점(`main.tsx`)이나 백엔드를 실행하지 않습니다. 그래서 Provider가 없는
hook, 비어 있는 서버 데이터, 닫혀 있는 모달 상태 같은 빈자리가 생기고, 그 자리를 무엇으로 채울지가
프리뷰의 성공률을 결정합니다. 이 문서는 그 값을 **프로젝트 코드에 이미 선언된 TypeScript 타입**에서
얻는 방식을 설명합니다.

## 왜 타입인가

기존 자동 값은 구문 휴리스틱(필드 이름, 비교 리터럴, 구조 분해)으로 만들어졌고, 말단 값을 알 수 없을
때 `{}`를 넣었습니다. `{}`는 숫자·문자열·enum·날짜가 필요한 자리에서 `Objects are not valid as a React
child`, `Cannot read properties of undefined`, `Invalid time value` 같은 크래시가 됩니다. 새 라이브러리나
새 데이터 형태가 나올 때마다 휴리스틱을 추가해야 했고, 로컬 신경망은 이미 만들어진 후보의 순서만 정하므로
올바른 값을 새로 만들어 내지 못합니다. 반면 `useQuery`의 결과 타입, `useState<FormState>`의 상태 타입,
props 타입은 프로젝트가 이미 선언해 둔 사실이므로 라이브러리마다 규칙을 추가하지 않아도 됩니다.

## 구성

| 구성          | 파일                                                                      | 역할                                                               |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 분석 프로그램 | `typeOracle/previewTypeProgram.ts`                                        | 예산 안에서 TypeScript 프로그램을 만들고 빌드 사이에 재사용        |
| 타입 → 값     | `typeOracle/previewTypeValueSynthesizer.ts`                               | 선언 타입을 결정적인 값 기술자(JSON)로 변환                        |
| 빌드별 질의   | `typeOracle/previewTypeOracle.ts`                                         | hook 호출·가드 식의 타입을 텍스트와 순번으로 찾아 응답             |
| hook 대체값   | `staticResources/previewRuntimeHookTypedFallback.ts`                      | 계측된 hook 메타데이터에 타입 값을 싣고 타입 전용 사이트를 만듦    |
| 런타임 병합   | `pageInspector/previewInspectorRuntimeFallbackTypedValueRuntimeSource.ts` | 구문 근거와 타입 값을 병합                                         |
| 가드 재바인딩 | `staticResources/previewTypedGuardReplacements.ts`                        | 강제로 열린 null 가드 분기 안에서 가드 변수를 타입 값으로 대체     |
| 응답 형태     | `typeOracle/previewTypedPayloadShape.ts`                                  | 선언된 응답 타입을 Virtual Backend payload 형태로 변환             |
| 문서 수집     | `typeOracle/previewTypedDocumentShapes.ts`                                | 모듈이 선언·사용하는 타입 GraphQL 문서와 결과 형태를 찾음          |
| 문서 등록     | `staticResources/previewTypedDocumentRegistrations.ts`                    | 문서와 형태를 모듈 끝에서 전역 큐에 등록                           |
| 형태 병합     | `previewTypedGraphqlShapeRuntimeSource.ts`                                | Apollo 응답과 hook 복구 데이터에 선언 형태를 덮어씀                |
| REST 등록     | `staticResources/previewTypedRestEndpointRegistrations.ts`                | 타입 있는 요청 호출의 응답 형태를 메서드·경로 패턴으로 등록        |
| 반환 타입     | `typeOracle/previewReturnedPayloadType.ts`                                | 타입 없는 요청 본문을 그 본문을 반환하는 함수의 선언 타입으로 보완 |
| REST 조회     | `pageInspector/previewInspectorTypedRestRuntimeSource.ts`                 | XHR로 도착한 요청의 경로로 등록된 응답 형태를 찾음                 |
| 대상 props    | `typeOracle/previewTypedComponentProps.ts`                                | 대상 내보내기의 필수 스칼라 props를 선언 타입으로 합성             |
| 힙 게이트     | `typeOracle/previewTypeHeap.ts`                                           | 워커가 종료되지 않도록 예산을 줄이는 안전장치                      |

### 분석 프로그램

- 루트: 편집 중인 문서, 선택된 대상, 페이지 루트.
- 예산 단위: 힙 사용량은 파싱한 텍스트 양에 비례합니다(측정값: 텍스트 1바이트당 힙 26–34바이트). 그래서
  파일 개수가 아니라 프로젝트·선언·TypeScript lib 파일을 모두 합한 **텍스트 바이트**로 제한합니다.
- 모듈 허용: 루트에서 가까운 순서(BFS)로 파일당 16 MiB, 전체 32 MiB까지 허용합니다. 8 MB짜리 GraphQL codegen
  모듈처럼 서버 데이터 형태를 담은 생성 파일도 들어옵니다. barrel re-export가 앱 전체를 끌어오지 않도록
  프로젝트 파일은 최대 400개입니다. 예산에 맞지 않는 모듈은 해석하지 않으므로 해당 타입은 `any`가 되고, 그
  자리는 기존 구문 휴리스틱으로 돌아갑니다. Apollo·MUI 기반 페이지에서 16 MiB, 힙 약 600 MiB, 파싱 결과를
  재사용하는 재빌드 약 0.6초를 측정했습니다.
- 파일 제공: 컴파일러 호스트는 허용된 모듈과 lib 파일만 제공합니다. 선언 파일의 `/// <reference path|types>`
  가 예산 밖 파일(예: `@types/node`)을 끌어오지 못하고, `node_modules`의 JavaScript도 읽지 않습니다.
- 해석: 프로젝트에서 찾지 못한 패키지는 esbuild 그래프와 같은 관리 의존성 레이어에서 찾습니다. 편집기의
  저장 전 내용이 저장된 파일보다 우선합니다.
- lib: DOM lib는 메모리 사용이 크고 데이터 형태를 설명하지 않으므로 제외하고 `lib.es2022.d.ts` 체인(57개,
  약 0.45 MiB)만 씁니다. 워커는 TypeScript를 번들하므로 빌드가 `dist/typescript-lib/`에 lib 파일을 복사합니다.
- 비용: tsconfig는 옵션만 읽고 `include` 목록을 펼치지 않습니다. 허용 단계에서 읽은 텍스트를 그대로 파싱하고,
  너무 큰 파일은 크기만 확인합니다. 바뀌지 않은 파일의 파싱 결과와 import 해석 결과는 워커가 살아 있는 동안
  다음 빌드에서 재사용합니다. 현재 프로그램에 없는 파일의 파싱 결과는 버리고, 프로그램과 checker는 번들링이
  끝나면 해제합니다. 해석하지 못한 import도 기억하므로, 새로 만든 파일은 워커가 다시 시작된 뒤 타입에 반영됩니다.

### 힙 게이트

확장이 쓰는 대화형 컴파일러 워커는 개발자의 로컬 머신에서만 실행되므로 old generation 4 GiB를 씁니다.
렌더 품질이 작은 힙보다 중요하기 때문입니다. 검증 캠페인 워커는 기록된 격리 정책대로 384 MiB를 유지합니다.
힙이 넘치면 예외가 아니라 워커 종료로 끝나므로, 게이트는 품질 예산이 아니라 종료를 막는 안전장치입니다.

- 예산 = (힙 한도 × 0.8 − 실제 사용량 − 나머지 빌드용 120 MiB) ÷ 40. 512 KiB 단위로 내리고 기본 예산을 넘지
  않습니다. 캐시에 남은 파싱 결과는 재사용되므로 그 몫(텍스트 1바이트당 12바이트)을 돌려받습니다.
- 실제 사용량은 가장 최근 major GC 직후의 힙입니다. GC 사이의 원시 사용량에는 곧 회수될 가비지가 섞여 있어
  측정한 워커에서 60–100 MiB를 부풀렸습니다.
- 예산이 1 MiB보다 작으면 그 빌드는 타입 분석을 건너뛰고 남은 파싱 결과도 해제합니다.

### 값 합성 규칙

- 원시 타입은 선언된 종류 안에서만 이름 기반 샘플을 고릅니다(`total` → 0, `email` → 예시 주소).
- 유한 리터럴 union(`'S' | 'A' | 'B' | 'C'`)은 허용값 중 하나를 쓰고 허용 집합을 함께 기록합니다.
- 객체 union은 코드가 실제로 읽는 경로를 가장 많이 만족하는 멤버를 고르고, 쿼리 결과처럼 `status`가 있는
  경우 성공 상태를 우선합니다. 판별 union(`{ mode: 'create' } | { mode: 'edit'; rows: Row[] }`)도 같은
  방식으로 선택됩니다.
- 배열은 항목 하나, 함수는 반환 타입 값을 돌려주는 함수, `Date`·`Map`·`Set`·`Promise`는 실제 런타임 값이
  됩니다. 오류·children 같은 nullable 슬롯은 `null`로 둡니다.
- 이름이 `…At`·`…_at`·`…Time`·`…Timestamp`인 `string`은 ISO 날짜시각, `…date`·`…Day`·`…Week`·`…Month`·
  `ymd`인 `string`은 `YYYY-MM-DD`로 채워 날짜 포맷터가 `Invalid time value`로 실패하지 않게 합니다.
- 선택 필드는 코드가 읽을 때만 채웁니다. 결과는 결정적이며 깊이·노드 수 한도(1,200)를 넘지 않습니다.
- 코드가 읽는 속성을 먼저 합성하므로 Apollo `QueryResult`의 `client` 같은 큰 형제 속성이 한도를 먼저 쓰지
  못합니다. hook 메타데이터가 16 KiB를 넘으면 버리지 않고 코드가 읽는 경로의 하위 트리와 그 리터럴만 남깁니다.

### 병합 정책

- 구문 분석이 찾은 구체 값(가드 통과용 비교 리터럴 등)은 유지합니다.
- `{}` 자리표시자는 선언된 원시 값으로, 빠진 필드는 타입 값으로 채웁니다.
- 선언 타입과 종류가 다른 값, 리터럴 허용 집합 밖의 값은 타입 값으로 바꿉니다.
- 구문 근거가 없는 hook은 **타입 전용 사이트**가 됩니다. 성공한 hook 결과는 절대 바꾸지 않고, hook이
  throw할 때(예: Provider 없음)만 선언 타입 값으로 대체합니다. 따라서 전용 브리지가 없는 라이브러리도
  선언 타입만 있으면 렌더링을 이어갈 수 있습니다.

### 서버 응답 타입

GraphQL 응답은 원래 선택 필드와 필드 이름으로 추측했습니다. `status`는 `'ACTIVE'`, 목록처럼 보이는 이름은
배열이 되었고, 선언된 status union을 `switch`로 검사하는 컴포넌트는 알 수 없는 값에서 `assertNever`로 throw했습니다.
이제 선언된 결과 타입이 응답을 결정합니다.

- 수집: 모듈이 선언하거나(``const Q: typeof Q_DOCUMENT = gql`…` ``) query helper에 넘기는(`useQuery(Q)`,
  `createQueryRenderer(Q)`, `{ query: Q }`) 모듈 범위 바인딩 중 선언 타입이 `TypedDocumentNode`인 것을 찾습니다.
  라이브러리 이름이 아니라 codegen preset·typed-document-node·Apollo가 공유하는 `__apiType` 구조로 판별합니다.
- 등록: 변환 결과의 모듈 끝에서 `[문서, 결과 형태]`를 전역 큐에 넣습니다. Inspector 런타임보다 먼저 평가되는
  모듈도 등록할 수 있고, 작업 이름은 런타임에 문서에서 읽습니다. 문서가 32개를 넘는 생성 스키마 모듈은
  등록하지 않습니다.
- 적용: Apollo 브리지가 Virtual Backend에 작업을 설명할 때와, 래핑된 `useQuery`의 첫 로딩 렌더를 hook 복구가 채울
  때 모두 같은 병합을 씁니다. 응답 키(별칭 포함)는 선택 필드가 정하고, 목록 여부·숫자·불리언·닫힌 리터럴은
  선언 타입이 정합니다. 선언이 그냥 `string`이면 "텍스트"라는 정보뿐이므로 이름 기반 추론(숫자 문자열인
  Decimal, 날짜)을 유지합니다. 어떤 생성기가 목록 행을 채웠든 마지막에 선언 리터럴을 다시 적용합니다.
- Context hook: `createContext` 기반 query renderer처럼 데이터를 Context로 전달하는 경우를 위해 Context hook
  대체값에도 선언 타입 값과 허용 리터럴을 싣습니다.
- REST: `apiClient.get<T>('/path')`처럼 다른 모듈의 HTTP client 인스턴스를 쓰는 호출은 base URL과 interceptor를
  지키기 위해 바꾸지 않고, Promise를 돌려주는 호출의 응답 본문 타입(`Promise`와 `data`·`status`·`headers` 응답
  래퍼를 벗긴 타입)을 `(메서드, 경로 패턴)`으로 모듈 끝에 등록합니다. 템플릿의 식은 `*` 세그먼트가 되고,
  XMLHttpRequest로 도착한 요청은 경로 끝부분이 일치하는 가장 긴 패턴의 형태를 씁니다. 계측 없이 그대로 통과하는
  API 모듈도 등록문만 덧붙입니다. `axios`를 직접 import한 호출은 기존처럼 바꾸되 가져온 응답 타입도 해석합니다.
- 타입 인자 없는 호출: `const { data } = await apiClient.get(url); return data;`처럼 호출 자체의 응답 본문이 `any`이면,
  그 본문을 그대로 반환하는 함수의 반환 타입 선언(`Promise<T>`의 `T`)을 응답 형태로 씁니다. `data` 구조 분해,
  `response.data`, `(await 호출).data`, `호출.then((response) => response.data)`만 인정하고, 본문의 일부 필드만
  반환하거나 반환 타입을 선언하지 않은 함수는 기존 이름 추론을 따릅니다.

### null 가드 재바인딩

`{form && <FormModal mode={form.mode} />}`처럼 nullable 상태가 분기를 가리면, Inspector가 분기를 강제로 열어도
`form`은 여전히 `null`입니다. 가드가 단순 식별자이고 선언 타입이 nullable이면 분기 안의 값 읽기를
`(form || 타입값)`으로 바꿉니다. 실제 값이 있으면 그대로 쓰고, JSX 구조는 바뀌지 않으므로 조건 계측과
수동 조건 전환도 그대로 동작합니다. 분기 안에서 같은 이름을 다시 선언하거나 대입하면 건너뜁니다.

`if (!row) return null;`처럼 else 없는 단일 return 가드를 Inspector가 우회할 때도 같습니다. 같은 블록에서
뒤따르는 문장(클로저 포함)의 `row` 읽기를 `(row || 타입값)`으로 바꿔 `row.status` 같은 읽기가 null에서
실패하지 않게 합니다.

### 대상 컴포넌트의 필수 props

페이지가 대상을 그리지 못하면 Inspector는 대상을 페이지 옆에 따로 마운트합니다. 이때는 props를 넘겨 줄 owner가
없으므로 사용처의 리터럴 속성만 있고, `status={row.status}`처럼 값으로 넘기는 필수 prop은 비어 있습니다. 그러면
`STATUS[status].bg` 같은 조회가 `undefined`에서 실패합니다. 이제 빌드는 대상 내보내기의 첫 매개변수 타입에서
선택적이지 않은 prop(`children`·`key`·`ref` 제외, 최대 32개)을 읽고, 스칼라 값(리터럴 union의 첫 값, 숫자,
불리언, 텍스트)만 합성해 빈 키에 넣습니다. 사용처 리터럴과 사용자가 고친 props가 항상 우선하고, 객체·함수 prop은
기존 대체값에 맡깁니다. 대상만 단독으로 실행하는 경로는 실행 props를 페이지 루트의 props로 채우므로 아직 이 값을
쓰지 않습니다.

## 측정

아래 수치는 헤드리스 Chromium에서 대상 파일마다 한 번씩 Page Inspector 빌드와 렌더를 실행한 결과입니다.
실제 VS Code 창에서 확인한 값이 아니며, 사용자 조작이나 재시도는 포함하지 않습니다.

| 프로젝트                               | 파일 | 0.1.1524 | 0.1.1525 | 0.1.1526 | 0.1.1527             |
| -------------------------------------- | ---- | -------- | -------- | -------- | -------------------- |
| aristell (React Query, zustand, axios) | 62   | 정상 21  | 정상 41  | 정상 46  | 측정 가능 57개 중 45 |
| payroll (Apollo, MUI, GraphQL codegen) | 12   | 크래시 4 | 크래시 4 | 크래시 4 | 크래시 0             |

- payroll의 크래시 4개는 모두 `Unexpected value: ACTIVE`였습니다. codegen 결과 타입의 status union을 응답이 따르면서
  사라졌고, 12개는 partial 8개·판정 보류 4개가 되었습니다. 타입 분석 프로그램은 힙 약 600 MiB, GC 직후 워커 힙은
  최대 약 1 GiB였습니다(4 GiB 한도).
- aristell의 xlsx를 쓰는 5개는 측정용 의존성 저장소에 xlsx 레이어가 없어 0.1.1526 워커로도 빌드할 수 없었습니다.
  나머지 57개는 0.1.1526과 같고 2개만 바뀌었습니다. LoadingOverlay는 크래시에서 partial이 되었고, UpliftGapChart는
  판정 보류에서 크래시(`Invalid time value`)가 되었습니다. 타입이 생긴 업리프트 추출 응답이 더 깊은 계산 경로를
  열었는데, 그 경로가 쓰는 프로모션 목록은 제네릭 헬퍼(`fetchAllPages<T>(url)`)를 거쳐 아직 타입이 없기 때문입니다.
- aristell에서 0.1.1525의 정상 렌더 중 1개(ReviewSheet)는 같은 화면을 그리지만 `isPending` JSX 분기가 blocker로
  남아 partial로 집계됩니다.
- 시간: 0.1.1526 워커(6회)와 0.1.1527 워커(4회)를 번갈아 잰 대상별 최솟값 기준으로 payroll 빌드가 0.6–1.6초
  늘었습니다(8.4–14.2초 → 9.5–14.8초). 측정 기기의 부하가 커서 중앙값은 흔들렸고, 최솟값으로 부하 영향을 줄였습니다.

## 한계

- 타입이 없는 JavaScript 프로젝트나 `any`로 선언된 값에는 효과가 없습니다.
- 타입은 형태만 알려 줍니다. 조회 테이블의 키, 권한 enum 같은 의미 제약은 이름 기반 샘플과 기존 휴리스틱에
  의존합니다.
- fetch 기반 GraphQL, fragment masking 문서, 경로 전체가 변수인 요청(`client.get(url)`, 제네릭 페이지 수집
  헬퍼 내부 호출 등)은 기존 이름 추론을 따릅니다.
- 서버 타입이 그냥 `string`이고 유효한 값이 받는 쪽 prop 타입(`keyof typeof STATUS_TABLE`)에만 있으면 아직
  보정하지 않습니다. 조회 표에 없는 이름 기반 값이 들어가 `undefined.bg` 같은 크래시가 남을 수 있습니다.
- 이미 저장된 Auto 응답은 타입 형태가 바뀌어도 그대로 유지되므로, 새 형태는 새로 만든 요청부터 적용됩니다.
- 400개를 넘는 프로젝트 파일이나 32 MiB를 넘는 텍스트는 들어오지 않아 먼 모듈의 타입은 `any`가 됩니다.
