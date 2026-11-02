# 변경 기록 보관 3

0.1.1564부터 0.1.1507까지의 기록입니다. [최근 변경 기록](../CHANGELOG.md)으로 돌아갑니다.

## 0.1.1564 - 2026-10-05

- 프로젝트에서 찾을 수 없는 생성 모듈(proto 등)의 중립 값을 JSX 자식으로 그리면(`{driver.phone}`) React가 "Functions are not valid as a React child" 경고를 남기던 문제. 중립 값은 어떤 속성을 읽거나 호출해도 안전하도록 함수로 만들어져 있어 React가 그릴 수 없는 자식으로 봤음. 이제 중립 값을 전역 등록부에 기록하고, Page Inspector의 JSX 변환 어댑터가 자식으로 들어온 등록된 중립 값(단일 값과 배열 항목)을 빈 값(`null`)으로 바꿈. 중립 값은 그대로 호출할 수 있어 `x.map()`·`msg.getName()` 같은 호출은 이전처럼 동작하고, 프로젝트가 직접 넘긴 함수 자식은 건드리지 않음. classic `React.createElement` 호출에는 적용되지 않음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1563 워커와 페이지별 교대 실행): 132쌍 판정 동일, 퇴행 0, 화면 텍스트 차이 0쌍, 함수 자식 경고는 tada-web rider-guest-ride 메인에서 1건→0건. 측정 중 다른 작업으로 부하가 매우 높아져(load 약 370) 두 버전 모두 payroll 7쌍이 컴파일 정지 시간을 넘기고 spa 측정 실행기가 15분 제한으로 멈춰, 부하가 내려간 뒤 그 쌍과 남은 spa 16쌍을 다시 측정함. 전체 테스트는 기존 실패 52개 외에 시간에 민감한 컴파일러·헤드리스 테스트 13개가 부하로 시간 초과됐으나 부하가 내려간 뒤 다시 돌려 통과
- 이 작업 전 "불필요하게 열린 모달"을 닫으려고 도달 후 자동 강제 분기를 한 번 풀어 보는 방식을 시도했으나, 대상이 페이지인 화면에서 강제로 연 대화상자·단계·탭(=페이지 내용)까지 닫히고(spa InvoiceDialogPage 53→12자, hospitalrun EditPatient 1042→183자 등) 확인 시간이 늘어 5초 측정 창을 넘는 페이지가 크게 늘어(InventoryTimeline ready→partial-blocked) 되돌렸고 배포하지 않음

## 0.1.1563 - 2026-10-05

- aristell StatusChip(Chip)이 재고 보충 표의 행 안에 그려지지 않고 페이지 옆 대체 표시로만 보이던 문제. 목록이 아직 비어 있는 동안 대상 경로 탐색이 `phase !== 'idle' ? <스켈레톤> : (isError ? <ErrorRetry/> : <표>)`를 스켈레톤 쪽으로 열었고, 데이터가 들어온 뒤에도 그 선택이 남아 표가 가려졌음. 라벨로 어느 쪽이 대상에 이어지는지 알 수 없을 때는 대체(로딩·오류·빈 상태) 분기의 반대쪽을 고르는데, (1) 여러 결과를 가진 분기는 하나만 대체 이름(`ErrorRetry`)이어도 전체를 대체 분기로 봤고, (2) 라벨이 얕아 `<div>`·감싸는 컴포넌트 안의 컴포넌트(`<TableShell><SkeletonTable/></TableShell>`)가 드러나지 않았음
- 이제 여러 결과를 가진 분기는 모든 결과가 대체 형태일 때만 대체 분기로 보고, 분기 라벨에 host 요소와 감싸는 컴포넌트 안의 컴포넌트 이름도 넣음(`<Fragment: div, SkeletonTable>`, `<TableShell: SkeletonTable>`). 그 결과 StatusChip은 page-authentic으로 표 행 안의 상태 칩까지 그려지고(이전과 같이 발주 요청 모달은 열린 상태), TrendBars 화면에서는 데이터가 이미 그려진 표 위에 함께 나오던 "불러오는 중…" 문구가 사라짐. 조건 식별자는 라벨을 포함해 만들어지므로 라벨이 바뀐 조건에 사용자가 직접 바꿔 둔 조건 선택은 초기화될 수 있음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1562 워커와 비교): 132쌍 판정 동일, 퇴행 0, 화면 텍스트 차이는 Chip(표 행 표시)과 TrendBars(로딩 문구 사라짐) 2쌍. 첫 측정에서 (1)만 고친 규칙이 Skeleton.tsx(대상 SkeletonTable)를 대상 단독 실행·빈 텍스트로 만들어(이전에는 잘못된 분류가 우연히 로딩 분기를 열어 주던 경우) (2)를 함께 고치고 새 버전 쪽만 다시 측정함. 전체 테스트 실패 52개는 모두 이전부터 있던 실패. 0.1.1122–0.1.1123 항목을 `docs/changelog-archive-2.md`로 옮김

## 0.1.1562 - 2026-10-05

- UDT-fe 피드백·추천·탐색 목록이 "저장된 콘텐츠가 없습니다"·"검색 결과가 없습니다"로만 그려지던 문제. 대상에 도달하면 선언된 REST 목록을 샘플 행으로 채우는 단계는 이 요청들에도 적용됐지만, 목록이 다시 요청되지 않아 빈 응답이 그대로 보였음. 이 프로젝트는 `app/providers.tsx`에서 직접 `QueryClientProvider`를 렌더하고 그 client를 모듈 단위로 하나만 만들며 `staleTime`이 60초라서, 쿼리는 확장이 만든 client가 아니라 프로젝트 client에 붙고 확장은 데이터가 바뀌어도 자기 client만 무효화했음. 이제 프로젝트 Query package의 `QueryClient`가 Provider로 마운트될 때 그 client를 기록하고, Inspector 데이터가 바뀌면 함께 무효화함(확장 client는 제외, 최대 16개). 프로젝트 client의 재시도·polling 설정은 바꾸지 않음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1561 워커와 페이지별 교대 실행): 132쌍 판정 동일, 퇴행 0. 화면 텍스트가 바뀐 3쌍은 UDT-fe 피드백·추천·탐색 페이지로 빈 목록 대신 샘플 행 3개가 그려짐. 전체 테스트 실패 52개는 모두 이전부터 있던 실패(0.1.1561에서 부하로 시간 초과된 테스트 1개도 이번에는 통과)

## 0.1.1561 - 2026-10-05

- tada-web rider-guest-ride 메인 화면에 내부 이름 `ReactPreviewGeneratedContractNeutral`이 글자로 보이던 문제. 프로젝트에서 찾을 수 없는 생성 모듈(proto 등)은 어떤 속성을 읽거나 호출해도 안전한 중립 값으로 대체되는데, 이 값은 이름 붙은 함수를 감싼 Proxy라서 `driver.name`이나 `${typeDescription.name}`처럼 `name`을 읽으면 함수 자신의 이름이 나왔음. 이제 `name`은 빈 문자열을 돌려줌. 다른 속성처럼 중립 값을 돌려주면 이름은 사라지지만 React가 함수를 화면에 그릴 수 없다는 경고를 하나 더 남겨, 텍스트 필드에 맞는 빈 문자열을 택함
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1560 워커와 페이지별 교대 실행): 132쌍 판정 동일, 퇴행 0, 화면 텍스트 차이는 rider-guest-ride 메인 1쌍(내부 이름이 사라짐)뿐이고 새 버전 결과 어디에도 이 이름이 없음. 전체 테스트는 기존 실패 52개 외에 컴파일러 테스트 1개가 부하(load 16)로 시간 초과됐으나 단독 재실행에서 통과. 0.1.1120–0.1.1121 항목을 `docs/changelog-archive-2.md`로 옮김

## 0.1.1560 - 2026-10-05

- 0.1.1559 이후 tada-web front-office 페이지에 원래 닫혀 있는 전역 팝업("다시 호출할까요?", 날짜가 `NaN`인 호출 정보)이 함께 보이던 문제. hook이 준 Boolean이 `if (!isShowPopUp) return null` 같은 조기 반환을 막으면 자동값이 통과하는 값으로 바꾸는데, 이 규칙이 대상과 상관없는 형제 컴포넌트(앱 셸이 모든 페이지에 붙이는 GlobalUI 안의 팝업)에도 적용됐음. 이제 이 통과는 대상 모듈과, 선택된 페이지 후보에서 대상까지 이어지는 경로의 컴포넌트에서만 함. 경로 밖에서는 hook이 실제로 준 값(`false`, 숫자, 문자열)을 그대로 두고, 정적 store bridge가 아직 모르는 경로에 넣은 자리표시(호출 가능한 빈 값 등)는 실제 값이 아니므로 이전처럼 바꿈. 경로 근거를 구할 수 없으면 이전 동작을 유지함
- 보이는 화면이 바뀌는 곳: front-office dev/login·callTada·history는 0.1.1558과 같은 화면으로 돌아감. tada driver-web 운행 현황(driveStatus)은 "이번 달 피크 시간 보기" 버튼이 사라짐. 이 버튼은 `if (!isIndividualBusiness) return …` 뒤에 있고 store가 실제로 `false`(법인 기사)를 주는데, 이전에는 자동값이 `true`로 바꿔 보여 줬음. 경로 밖 조건은 Inspector의 조건 전환으로 계속 열 수 있음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1559 워커와 비교): 132쌍 판정 동일, 퇴행 0, 화면 텍스트 차이는 위 front-office dev/login과 driveStatus 2쌍. 첫 측정에서 경로 밖 통과를 모두 끄는 규칙이 tada 콜 정지(callBlock) 화면의 안내 문구를 숨겨(store bridge의 호출 가능한 자리표시가 참으로 평가됨) 위처럼 자리표시는 계속 바꾸도록 좁히고 새 버전 쪽만 다시 측정함. aristell SkuFormModal 1쌍의 차이는 이전 측정 11번이 모두 같은 화면인 가운데 이번 이전 버전 쪽 한 번만 모달이 하나 더 열린 실행 간 흔들림. 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1559 - 2026-10-05

- Next.js의 `next/dynamic`으로 불러오는 컴포넌트를 렌더 경로에서 인식하지 못하던 문제. tada-web rider-guest-ride 메인 페이지는 `const MainImpl = dynamic(() => import('@pagesImpl/main/mainImpl'), { ssr: false })` 하나만 그리는데, 페이지 실행용으로 모듈을 고르는 단계가 `React.lazy`만 lazy 경계로 알아 MainImpl을 페이지와 무관한 분기로 보고 빈 자리표시로 바꿨음. 그래서 대상은 마운트되지만 아무것도 그리지 않아 "보이는 요소 없음"으로 끝났음. 이제 `next/dynamic`의 기본 가져오기를 `React.lazy`와 같은 lazy 경계로 인식함. 그 결과 이 페이지는 지도·호출 정보·기사 정보가 그려짐. 다만 생성된 값의 내부 이름(`ReactPreviewGeneratedContractNeutral`)이 화면 텍스트로 보이는 별도 문제가 남음
- 함께 드러난 문제(이번에는 고치지 않음): tada-web front-office의 `_app`이 모든 페이지에 `next/dynamic`으로 붙이는 전역 UI(GlobalUI)도 이제 실제 앱처럼 마운트되는데, 그 안의 팝업들(`if (!isShowPopUp) return null`, jotai 기본값 false)을 기존 hook 대체값 규칙이 연다. 이 규칙은 hook이 준 불리언이 조기 반환을 막으면 통과하도록 바꾸는데, 대상 경로와 상관없는 형제 컴포넌트에도 적용됨. 그래서 front-office 페이지(dev/login, callTada, history 확인)에 실제로는 닫혀 있는 "다시 호출할까요?"·호출 정보(`NaN` 날짜) 팝업 문구가 함께 보임. 이전에는 GlobalUI 자체가 빈 자리표시라 보이지 않았음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1558 워커와 페이지별 교대 실행): tada rider-guest-ride 메인 partial-blocked→ready(page-authentic), 나머지 판정 동일, 퇴행 0. 화면 텍스트가 바뀐 다른 쌍은 front-office dev/login 1쌍뿐이며(위 팝업 문구, 측정 집합의 유일한 front-office 페이지) callTada·history도 따로 실행해 같은 팝업 문구가 더해짐을 확인. payroll 1쌍은 부하(load 약 9.7)로 두 버전 모두 45초 정지 시간을 넘겨, 단독 재실행에서 두 버전 모두 약 17.6초에 ready. 전체 테스트 실패 52개는 모두 이전부터 있던 실패. 0.1.1118–0.1.1119 항목을 `docs/changelog-archive-2.md`로 옮김

## 0.1.1558 - 2026-10-05

- 같은 버전으로 다시 열어도 aristell 일부 페이지가 실행마다 다른 화면으로 끝나던 문제(SKU 관리의 상품/BOM 탭, SkuFilter의 발주 요청 모달·FileDropZone의 입고 수정 모달이 열리거나 닫힘, 입고 화면의 선택 모드, MultiplierCell의 SKU 1개/3개). 대상이 이미 보이면 신경망이 학습용으로 다른 분기를 탐색한 뒤 확인된 경로 중 가장 좋은 것으로 되돌아가는데, (1) 탐색이 현재 경로의 성공 확인(약 1초)이 끝나기 전에 화면을 바꿔 현재 경로가 후보에 들지 못했고, (2) 후보 순위에서 강제한 JSX 분기 하나는 10점, 만들어 넣은 값의 크기는 최대 10,000점이라 그때까지 도착한 응답 크기에 따라 순위가 바뀌었고, (3) 목록 샘플 행 채우기가 탐색 중인 다른 상태에서 시작되면 복원된 경로의 요청을 다시 채우지 않았음
- 이제 자동 탐색은 현재 경로를 먼저 성공으로 확인한 뒤 시작하고, 복원할 경로는 출력 등급(페이지 문맥 완성, 직접 출력)이 같으면 강제 분기가 적은 쪽을 먼저 고르며, 목록 채우기는 첫 경로가 확인된 뒤 다른 경로를 확인하는 동안·다음 탐색 직전·복원 중에는 기다림. 그 결과 대상이 기본 화면에서 이미 보이는 페이지는 강제로 연 분기 대신 기본 상태로 끝남: aristell BrandSelector는 드롭다운이 닫힌 상태(이전에는 브랜드 목록이 열린 상태), spa 예제 PermissionGatePage는 "접근 권한 없음", SyncStatusPage는 "첫 동기화 대기" 화면(이전에는 청구 정보·동기화 완료 분기). 분기는 Inspector의 조건 전환으로 계속 열 수 있음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1557 워커와 비교): 흔들리던 5개 페이지를 두 측정을 동시에 돌리며 버전마다 4번씩 실행해 서로 다른 화면 수를 세면 이전 버전은 FileDropZone·SkuFilter·MultiplierCell이 2가지, 새 버전은 5개 모두 1가지(Button·ViewToggle은 이번 표본에서는 두 버전 모두 1가지였고 이전 측정들에서 바뀌었음). 전체 132쌍 판정 동일, 퇴행 0, 화면 텍스트 차이는 위 기본 상태 3쌍과 MultiplierCell(3개 SKU로 고정)·NumberInput(기본 상품 탭) 2쌍뿐. 첫 측정에서 목록 채우기를 첫 경로 확인 중에도 미루는 규칙이 ReplenishmentPage·InventoryTimeline의 목록 행을 측정 시점 뒤로 밀어 0건으로 보이게 해, 위처럼 좁히고 새 버전 쪽만 다시 측정함. 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1557 - 2026-10-05

- 측정용 spa 예제(`previewNeuralPretrainingArchetypeCatalog.ts`가 만드는 합성 페이지) 중 크래시하던 2개 수정. AccountSwrPage는 `useSWR<User>(…)`의 `data!.name`을 첫 렌더에서 읽음(실제 브라우저에서도 응답 전에는 실패하는 코드). hook 대체값은 이 호출을 계측하고 `data.name` 등이 필요하다고 알고 있었지만, 값 보완이 getter 속성은 실행하지 않고 건너뛰었고 SWR 2는 `data`·`isLoading`을 구독용 getter로 노출해 로딩 중인 `undefined`가 그대로 남았음. 이제 컴포넌트가 읽는다고 증명된 경로의 getter만 한 번 읽고, 읽은 값이 비어 있을(null·undefined) 때만 채움. 이 읽기가 SWR 구독도 등록하므로 실제 응답이 오면 다음 렌더에서 응답 값으로 바뀜. 값이 객체인 getter(react-hook-form의 빈 `errors`)는 실제 상태라 안쪽을 채우지 않음
- SessionPage는 `JSON.parse(localStorage.getItem('session') ?? 'null') as StoredSession`이 빈 preview origin에서 `null`이 되어 `session.user`에서 실패함. 이제 컴포넌트·hook 안에서 `localStorage`·`sessionStorage`의 `getItem`을 `JSON.parse`하는 호출은 hook 결과처럼 다룸: 저장 값이 있으면 그대로 쓰고, `null`이면 뒤따르는 읽기(`session.user.name` 등)로 만든 값을 씀. 키마다 따로 기록하고 자동값을 끄면 원래 `null`로 돌아감
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1556 워커와 비교): spa 예제 AccountSwrPage·SessionPage가 post-commit-failed→ready로 spa 30쌍이 모두 ready, 나머지 aristell 62쌍·payroll·tada-web·UDT-fe·hospitalrun 40쌍 판정 동일, 퇴행 0. 첫 측정에서 getter 안쪽까지 채우는 규칙이 SignupFormPage에 가짜 검증 메시지를, tada-web 주행연구소 화면에 `[object Object]회`·`NaN분` 같은 값을 만들어 규칙을 위처럼 좁히고 새 버전 쪽을 다시 측정했고, 두 화면 모두 이전과 같아짐. 남은 화면 텍스트 차이 3쌍(aristell 탭·선택 상태)은 이전 측정들에서도 바뀌던 실행 간 흔들림이며, NumberInput은 새 버전 단독 재실행 2회에서 이전과 같은 탭이 나옴. 컴파일 시간은 페이지별 교대로 잰 첫 측정에서 중앙값 차이 −0.03–+0.08초. 두 보관 문서가 1,000줄에 가까워 0.1.1116–0.1.1117 항목을 새 `docs/changelog-archive-2.md`로 옮김

## 0.1.1556 - 2026-10-05

- UDT-fe 프로필 화면 3개(피드백·추천 목록의 MovieCard `Cannot read properties of undefined (reading 'join')`, ProfilePage `… (reading 'map')`)가 실패하던 문제. 이 프로젝트의 API 함수는 HTTP 클라이언트를 타입 인자 없이 호출하고(`axiosInstance.get(url)`, 응답 본문이 `any`) 데이터 형태는 감싼 함수에만 선언함(`async (id): Promise<StoredContentDetail> => { const { data } = await axiosInstance.get(…); return data; }`). 그래서 응답 형태 등록이 아무 형태도 얻지 못했고, 요청에는 이름으로 추측한 기본 객체(`{ active, description, id, name }`)가 응답되어 `genres`·`platforms` 같은 배열 필드가 비어 있었음
- 이제 호출 자체의 응답 본문이 `any`이면, 그 본문을 그대로 반환하는 함수의 반환 타입 선언(`Promise<T>`의 `T`)을 응답 형태로 씀. `data` 구조 분해, `response.data`, `(await 호출).data`, `호출.then((response) => response.data)`만 인정하고, 본문의 일부 필드만 반환하거나 반환 타입을 선언하지 않은 함수는 기존 이름 추론을 따름
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1555 워커와 페이지별 교대 실행): UDT-fe 3쌍이 post-commit-failed→ready, 나머지 UDT-fe 7쌍·aristell 62쌍·payroll·tada-web·hospitalrun·spa 예제 30쌍 판정 동일, 퇴행 0, 컴파일 시간 중앙값 차이 −0.2–+0.04초. 같은 형태의 API 함수가 있는 aristell은 화면 텍스트가 3쌍에서 달랐지만, 같은 0.1.1555 워커끼리 측정해도 그 세 페이지에서 같은 차이가 나는 실행 간 흔들림임

## 0.1.1555 - 2026-10-04

- aristell `Chip.tsx`의 StatusChip처럼 필수 prop이 다른 모듈의 닫힌 키 집합(`status: keyof typeof STATUS`)인 컴포넌트가 `Cannot read properties of undefined (reading 'bg')`로 실패하던 문제. 0.1.1554 기록에는 생성된 상태 문자열이 상태표에 없는 오류라고 적었지만 실제 원인은 달랐음: 페이지(ReplenishmentPage의 주문 표)가 행을 그리지 못해 대상을 페이지 옆에 따로 마운트할 때 대체 표시가 props 없이 만들어져 `status`가 `undefined`였음. 정적 추론은 사용처의 리터럴 속성만 모으므로 `status={row.status}`처럼 값으로 넘기는 prop은 비어 있었음
- 이제 Page Inspector 빌드는 타입 검사기로 대상 내보내기의 props 타입을 읽어, 사용처 리터럴이 채우지 못한 필수 스칼라 prop에 선언 타입에 맞는 값(리터럴 union의 첫 값, 숫자, 불리언, 텍스트)을 만들고, 페이지 옆 대체 표시를 사용처 리터럴과 이 값으로 마운트함. 객체·함수·`children`은 기존 대체값에 맡기고, 사용처 리터럴과 사용자가 고친 props가 항상 우선함. 대상만 단독으로 실행하는 경로(target-only)는 실행 props를 페이지 루트의 props로 채우므로 이번에는 바뀌지 않음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1554 워커와 비교): aristell Chip(StatusChip)이 post-commit-failed→ready(페이지 옆 대체 표시에 '품절' 칩이 그려짐), 나머지 aristell 61쌍·payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 판정 동일, 퇴행 0. 처음 측정에서 이전 버전 워커를 `node_modules` 없이 풀어 132쌍이 모두 시작하지 못해, 이전 버전 쪽만 다시 측정함. 두 측정의 부하가 달라 빌드 시간을 비교할 수 없어 시간이 가장 많이 늘어 보인 8쌍을 두 버전 교대로 2회 다시 재었고, 컴파일 시간 차이는 중앙값 −0.1초로 늘지 않음. 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1554 - 2026-10-04

- Vite React 템플릿의 진입점 형태(`import ReactDOM from 'react-dom/client'` 뒤 `ReactDOM.createRoot(…).render(…)`)를 진입점으로 인식하지 못하던 문제. 진입점 근거는 `react-dom/client`의 이름 가져오기(`import { createRoot }`)와 이름공간 가져오기(`import * as …`), `react-dom`의 기본 가져오기만 인정하고 `react-dom/client`의 기본 가져오기는 빠져 있었음. 그래서 aristell처럼 이 형태를 쓰는 프로젝트는 대상에서 위로 올라가는 경로가 앱 진입점에 닿지 못했고, 앱 셸 안에 있는 컴포넌트(Sidebar의 BrandSelector 등)는 셸 컴포넌트를 루트로 한 미완성 후보만 얻어 페이지 문맥 미완성으로 끝났음(라우트 페이지 대상은 다른 경로로 합성되어 영향이 적었음). 이제 기본 가져오기도 `react-dom/client` 이름공간으로 인식함
- "aristell 남은 partial-blocked 4건" 점검 결과: (1) BrandSelector는 위 원인으로, 이번에 ready가 됨. (2) Toast(ToastHost)는 알림이 뜨기 전에는 아무것도 그리지 않는 컴포넌트라 "보이는 요소 없음"이 정상. (3) App.tsx를 대상으로 고르면 Router·QueryClient를 넣는 진입점을 실행해야 하는데, 진입점은 근거로만 쓰고 실행하지 않는 설계라 대상만 그려지는 상태가 정상(이번 수정으로 후보는 진입점까지 이어지지만 판정은 같음). (4) GroupHeader는 `focusSku` 선택(사용자 상태)이 있어야 보이는 조건이라 0.1.1549의 동작대로 값이 필요한 조건으로 남음. a2 구간의 LoadingOverlay·NumberInput도 같은 진입점 문제로 막혀 있었고 이번에 ready가 됨. Chip(StatusChip)의 `Cannot read properties of undefined (reading 'bg')`는 생성된 상태 문자열이 컴포넌트의 상태표에 없는 별도 오류
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1553 워커와 페이지별 교대 실행): aristell BrandSelector·LoadingOverlay·NumberInput 3쌍이 partial-blocked→ready, 나머지 aristell 59쌍·payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 판정 동일, 퇴행 0. 측정 중 이 기기의 다른 작업으로 부하가 높아(load 35–60) 두 버전 모두 payroll·tada·spa 34쌍에서 컴파일이 시간 초과로 멈춰, 그 쌍만 부하가 내려간 뒤 동시 실행 없이 다시 측정함(새 버전 34/34 정상, 이전 버전 1쌍만 다시 시간 초과). 진입점이 이어지면서 aristell 라우트 페이지(DashboardPage 등)의 후보가 App 루트·진입점까지 완성된 후보로 바뀌었지만 판정은 같음. 전체 테스트 실패 52개는 모두 이전부터 있던 실패(부하가 높을 때 함께 실패한 컴파일러 테스트들은 부하가 내려간 뒤 다시 돌려 통과)

## 0.1.1553 - 2026-10-04

- 행 안에만 있는 대상(aristell 재고 표의 TrendBars)이 페이지 안에서 그려지지 않고 페이지 옆 대체 표시로만 끝나던 문제. 자동 탐색이 대상과 같은 식을 쓰는 표 머리글 조건(SKUTable의 `{hasTrend && <th>5주 출고</th>}`)을 강제로 열었다가 대상이 나타나지 않아 거절하면, 런타임은 "대상을 그리는 분기를 이미 열어 봤으니 값을 더 채워도 소용없다"고 보고 필요값 탐색을 끝낸 뒤 대상을 페이지 옆에 따로 마운트했음. 그 머리글은 대상을 그리지 않는 형제 분기라 이 판단의 전제가 틀렸고, 실제 대상은 행 `map` 안의 셀(`{hasTrend && (<td><TrendBars …/></td>)}`)이라 목록 데이터가 있어야 나타남. 이제 거절된 조건 중 어느 분기가 대상을 그린다고 증명된 경우(분기 레이블에 대상 이름이 있거나 컴파일러가 대상 분기로 증명한 조기 반환)에만 이 지름길을 쓰고, 그 밖에는 필요값 탐색을 이어 감. TrendBars는 두 번째 회차에서 재고 목록(`replenishment-view/list`)을 채워 페이지 안의 표 행에서 도달함
- 0.1.1552의 원인 설명 정정: "페이지 후보 미완성(진입점 미연결, 페이지 루트 이름 없음)"이라고 적었던 것은 틀렸음. 그 관찰은 강제로 채운 값으로 다시 마운트하지 않은 채 페이지 옆 대체 표시 쪽 TrendBars를 본 것이었고, 같은 값은 정상 도달하는 MultiplierCell에서도 똑같이 나옴. 다시 마운트해 확인하면 목록이 채워지는 즉시 페이지 문맥이 완성됨(`contextComplete: true`, page-authentic). 요청 순서(먼저 `promotions`를 고르는 것)도 문제가 아니었음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1552 워커와 페이지별 교대 실행): aristell TrendBars가 insufficient-evidence→ready(page-authentic 후보, 재고 표 3행마다 막대 5개), 나머지 aristell 61쌍·payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 동일, 퇴행 0. 페이지당 실행 시간 중앙값도 차이 없음(지름길이 늦게 쓰여 탐색 회차가 늘 수 있는 페이지에서도). 원인은 하네스 probe로 대체 표시 요청 호출 지점과 거절된 조건 기록을 추적해 확인. 전체 테스트 실패 52개는 모두 이전부터 있던 실패. CHANGELOG 1000줄 제한으로 0.1.1113–0.1.1114 항목을 `docs/changelog-archive.md`로 옮김

## 0.1.1552 - 2026-10-04

- 선언 응답 타입에서 키가 정해지지 않은 `Record<string, number>` 필드(aristell 재고 목록의 `outbound_trend?: Record<string, number>`)를 필드 없는 빈 객체로만 만들어, 그 필드를 고정 키로 읽는 코드가 값 없음으로 처리하던 문제. aristell은 `buildTrend5`가 `['w-5', 'w-4', 'w-3', 'w-2', 'w-1'].map((k) => trend[k])`로 5주 출고를 읽는데 생성 값이 `{}`라 늘 1점이 되고, 5주 출고 열(TrendBars)이 숨겨졌음. 이제 그런 필드는 프로젝트가 그 필드에서 실제로 읽는 리터럴 키로 채움: 직접 접근(`row.trend['w-1']`), 그 필드를 인자로 받은 프로젝트 함수의 매개변수 접근 한 단계, 리터럴 배열의 `map`·`forEach` 등 콜백 키와 `for…of` 키(`as const` 상수 배열 포함). 같은 `Record<string, number>` 타입을 쓰는 다른 필드끼리 키를 섞지 않도록 타입이 아니라 필드 선언 기준으로 모으고, 읽는 키가 없으면 이전처럼 빈 객체. 새 모듈 `typeOracle/previewRecordKeyInference.ts`(필드 이름이 들어 있는 프로젝트 파일만 보고, 파일·노드·키 수 상한, 실패하면 키 없음)
- TrendBars는 아직 그려지지 않음. 목록 요청에 Smart 값이 들어가면 `outbound_trend`에 다섯 키가 생겨 페이지 안의 TrendBars가 그려지지만, 필요값 탐색이 첫 회차에 `promotions`를 고른 뒤 페이지 옆 대체 표시로 넘어가 목록을 시도하지 않음(0.1.1553에서 수정, 원인 설명도 0.1.1553 항목 참고)
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1551 워커와 페이지별 교대 실행): aristell 62쌍·payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 판정 모두 동일(퇴행 0). 화면은 aristell 4페이지에서 좋아짐: DashboardPage·SKUTable·KPIRow·SkuDetailModal 미리보기의 재고 표에 "5주 출고" 열이 새로 보이고 각 행에 TrendBars 막대 5개(`5주 전 · 출고 1개 … 최근 1주 · 출고 1개`)가 그려짐(이전 버전은 열 자체가 숨겨짐). 컴파일 시간 중앙값은 차이 없음(aristell 4.0→4.3초·4.2→4.1초, 다른 구간은 오히려 짧음). 전체 테스트 실패 52개는 모두 이전부터 있던 실패(전체 실행 때 함께 실패한 컴파일러 테스트 1개는 측정과 동시에 돈 부하성 시간 초과로, 단독 재실행 2회 통과)

## 0.1.1551 - 2026-10-04

- 신경망 성공 경로 수집 중, 새 조합(예: aristell SimulationPage의 `rows.length > 0` 분기를 연 조합)이 대상을 그려 임시 성공으로 기록되고 안정성 확인을 기다리는 동안 신경망 요청 마무리가 "가장 좋은 저장 경로로 복원"을 먼저 실행하던 문제. 복원이 조건 선택을 이전 경로로 바꾸자 대기 중이던 확인이 바뀐 상태를 재서 실제로 그려진 조합을 "보이지 않음"으로 거부했고, 그 순간 대상 출력 판정을 끄고 회귀로 표시했으며(0.1.1550에서 고친 오래된 판정 문제의 원인), 경우에 따라 이미 확정된 성공 경로까지 잃었음. 마무리 코드는 확인 대기 중이면 탐색을 계속하지 않도록 이미 막고 있었지만 복원 호출 조건에서만 이 조건이 빠져 있었음. 이제 확인 대기 중에는 복원하지 않고, 확인이 끝나(승격 또는 거부) 수집이 이어질 때 복원함. 자동 탐색 이어하기도 확인 대기 중에는 멈춤(확인 결과가 다시 이어 줌). 신경망 테스트 fixture는 공용 모듈로 분리해 1000줄 제한 안에서 재현 테스트를 추가
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소): MultiplierCell 2회씩 잠정 성공 처리를 추적하면 0.1.1550은 매번 승격 1·거절 1(실제로 그려진 두 번째 조합을 거절), 0.1.1551은 승격 2·거절 0. 수정 전 코드로 되돌린 재현 테스트에서는 두 번째 조합 확인 중에 첫 경로로 복원되고, 끝에는 확정된 성공 경로까지 0개가 됨을 확인. 조합을 하나만 시도하는 aristell 다른 페이지 8개는 두 버전 모두 거절 0(경합 없음). 0.1.1550 워커와 페이지별 교대 실행한 전체 측정에서 aristell 62쌍·spa 예제 30쌍·payroll·tada-web·hospitalrun과 UDT-fe 39쌍 동일. UDT-fe `recommend/page.tsx` 1쌍은 다른 측정과 동시에 돌던 중 새 워커 컴파일이 부하로 45초 감시 시간을 넘긴 것으로, 단독 재실행에서 새 버전 2/2·이전 버전 1/1 ready. 판정이 바뀐 페이지는 없음(이번 변경은 학습 순서만 바꿈). 전체 테스트 실패 52개는 모두 이전부터 있던 실패. CHANGELOG가 1000줄을 넘어 0.1.1111–0.1.1112 항목을 `docs/changelog-archive.md`로 옮김

## 0.1.1550 - 2026-10-04

- 화면에는 대상이 그려져 있는데 마지막 페이지 구성 기록이 "대상 출력 없음"(target-mounted-no-output, 활성 블로커 8개)으로 남아, 같은 페이지가 실행마다 ready와 partial-blocked 사이를 오가던 문제(aristell MultiplierCell). 런타임 상태 메시지는 한 번이라도 보낸 내용과 같으면 다시 보내지 않는데, 페이지 구성 스냅샷은 "현재 상태"라서 상태가 A(대상 출력)→B(출력 없음)→A로 돌아오면 마지막 A가 중복으로 버려지고 호스트의 최신 기록이 B로 남았음. MultiplierCell에서는 대상에 도달한 뒤 성공 경로 복원 검증이 한 번 실패하며 출력 판정이 잠깐 false가 됐다가(약 3.6초) 다음 커밋에서 바로 true로 돌아왔는데, 그 돌아온 스냅샷이 버려졌음. 이제 페이지 구성 스냅샷은 같은 종류의 직전 스냅샷과 같을 때만 생략하고, 이전 상태로 돌아오면 다시 보냄(다른 상태 메시지는 그대로). 헤드리스 판정(`latestComposition`)과 VS Code 상태 로그가 마지막 실제 상태를 받음. VS Code의 검증된 대상 출력 처리(선택 작업 취소)는 같은 메시지를 다시 받아도 결과가 같음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소): MultiplierCell 단독 반복 4회씩 0.1.1549는 4/4 partial-blocked, 0.1.1550은 4/4 ready(마지막 화면 텍스트는 두 버전이 같음). 0.1.1549 워커와 페이지별 교대 실행한 전체 측정에서 aristell 62쌍 중 ReviewSheet partial-blocked→ready 1쌍(이전부터 실행마다 결과가 갈리던 페이지), 나머지 61쌍·payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 동일, 퇴행 0. 원인은 하네스 probe로 조건·도달 상태와 페이지 구성 스냅샷을 시간순으로 추적해 확인. 전체 테스트 실패 52개는 모두 이전부터 있던 실패. 남은 것: 성공 경로 복원 검증이 실제로는 보이는 대상을 한 번 "보이지 않음"으로 판정하는 이유는 아직 고치지 않음(이제 판정에는 영향이 없지만 Inspector의 학습 상태에 `verified-path-restoration-failed`가 남을 수 있음)

## 0.1.1549 - 2026-10-04

- REST 데이터가 들어온 aristell UpliftInsights가 `TypeError: Cannot read properties of undefined (reading 'date')`로 post-commit-failed가 되던 문제(0.1.1547·0.1.1548 측정에서 "이전부터 있던 실패"로 적은 것). 선택한 프로모션의 uplift 추출 결과가 비어 있어 페이지가 "표시할 uplift 데이터가 없습니다"를 보여 주는 상태에서, 대상에 닿으려고 자동 탐색이 `productSeries.length === 0`을 false로 강제하면 형제 컴포넌트 UpliftGapChart가 빈 `points`로 렌더됨. 페이지 실행이 실행 표면의 선택적 시각 자손을 VirtualPage 소스로 등록하고 있어, 페이지 셸 부트스트랩이 이 차트의 `if (points.length === 0) return …` 가드까지 처음 렌더에서 열었고, 그 뒤 `points[0].date`에서 오류가 남. 이 열림은 자동 탐색 기록에 남지 않아 되돌려지지 않았고, 탐색이 다시 시도할 때마다 같은 오류가 반복됨. 이제 컴파일러가 이런 빈 컬렉션 가드(`X.length === 0`·`!X.length`·`X.length < 1` 등)를 뒤에서 `X[i].prop`·`X.at(i).prop`처럼 원소를 비옵셔널로 읽을 때 기존 null 가드(`if (!user) return …` 뒤 `user.name`)와 같이 "authored 상태가 필요한 조건"으로 표시해, 자동 탐색·부트스트랩이 열지 않음(Inspector에는 스위치가 아니라 값이 필요한 조건으로 보임). `map`·`filter`만 하거나 `X[0]?.prop`처럼 옵셔널로 읽는 본문은 이전처럼 열 수 있음. 판별은 새 모듈 `reactEmptyCollectionGuard.ts`. 차트에 데이터를 만들어 주는 변경이 아니라, 데이터가 없는데 있는 것처럼 진행하지 않게 하는 변경
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, axios가 있는 의존성 저장소, 0.1.1548 워커와 페이지별 교대 실행): aristell UpliftInsights가 post-commit-failed→ready(오류 0, 자동 조건 되돌림 0). 차트는 빈 상태로 그리고 그 아래 UpliftInsights가 보임. 나머지 aristell 61쌍 중 60쌍 동일, MultiplierCell ready→partial-blocked 1쌍은 이번 변경과 무관한 JSX 조건 `rows.length === 0`(조기 반환이 아님)이 남은 것으로, 이전 버전에서도 반복 실행마다 같은 블로커로 오락가락하던 페이지. payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 동일(퇴행 0). 원인 확인은 하네스 probe로 조건 상태를 추적함(`productSeries.length === 0` 자동 강제 직후 차트 가드가 페이지 셸 부트스트랩으로 열림). 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1548 - 2026-10-04

- `process.env`를 읽기만 해도 서버 코드로 보아, CRA·Next 클라이언트 코드처럼 공개 build-time 값만 읽는 파일(`axios.create({ baseURL: process.env.NEXT_PUBLIC_API_BASE_URL })`, `process.env.NODE_ENV`로 개발 도구를 켜는 store)이 import한 패키지를 lockfile로 받을 수 있는데도 받지 않고 곧바로 중립 대체물로 바꾸던 문제(0.1.1547의 경로 판정과 같은 문제). 측정 코퍼스에서 이렇게 판정되는 파일은 UDT-fe `axiosInstance.ts`(→axios), hospitalrun `pouchdb.ts`(`NODE_ENV`·`REACT_APP_*`→pouchdb), tada-web-main의 store 8개(`NODE_ENV`→redux-saga)로 모두 브라우저 라이브러리였고, 비공개 값을 읽는 파일은 서버 코드인 UDT-fe `middleware.ts`(`JWT_SECRET`→jose)뿐이었음(server·scripts·test 폴더를 뺀 정적 스캔 기준). 이제 읽는 이름이 모두 공개 값(`NODE_ENV`, `REACT_APP_*`·`NEXT_PUBLIC_*`·`VITE_*`·`EXPO_PUBLIC_*`·`GATSBY_*`·`PUBLIC_*`·`STORYBOOK_*`)이면 약한 근거로 보아 먼저 받고, 받지 못했을 때만 대체물을 씀. 비공개 이름, `process.env[key]` 같은 계산된 key, `const { … } = process.env` 같은 객체 전체 읽기, Node 내장 모듈 import는 이전처럼 강한 서버 근거. 판별은 새 모듈 `previewProcessEnvironmentEvidence.ts`
- 헤드리스 측정(측정 직전 일반 Node 요청이 레지스트리 인증서 검증에 실패하는 상태): 위 세 프로젝트는 node_modules나 Yarn PnP(tada-web-main)로 패키지를 해석해 관리 저장소를 쓰지 않으므로, scratchpad fixture 두 개(aristell의 package.json·lockfile, axios 레이어를 지운 의존성 저장소 사본, 진입점→App→페이지→패널→axios 클라이언트)로 0.1.1547 워커와 비교함. 클라이언트가 `process.env.REACT_APP_API_URL`을 읽으면 0.1.1547은 axios 중립 대체물, 0.1.1548은 원래와 같은 axios 레이어(`fe145f9a…`)를 다시 받아 진짜 axios를 씀. `process.env.API_TOKEN`을 읽으면 두 버전 모두 대체물(변화 없음). spa 예제 30쌍 동일(퇴행 0). 전체 테스트 실패 52개는 모두 이전부터 있던 실패(전체 실행 때 함께 실패한 컴파일러 테스트 4개는 측정과 동시에 돌아 생긴 부하성 시간 초과로, 단독 재실행에서 통과)

## 0.1.1547 - 2026-10-04

- `src/api/client.ts`·`src/services/format.ts`처럼 폴더 이름만 서버 모듈처럼 보이는 UI가 아닌 파일이 import한 패키지를, lockfile로 받을 수 있는데도 받지 않고 곧바로 중립 대체물(neutral browser contract)로 바꾸던 문제. 이런 폴더에는 보통 axios·lodash·qs 같은 브라우저 라이브러리가 있어(측정 코퍼스 6개 프로젝트에서 경로만으로 서버 판정을 받는 import는 모두 브라우저 라이브러리), 의존성 저장소에서 레이어가 지워지면 aristell처럼 axios 요청이 사라져 REST 데이터가 하나도 없었음(lodash 같은 계산 라이브러리도 같은 경로로 중립 값이 될 수 있었음). 이제 경로만이 근거이고 받을 수 있는 패키지는 먼저 받고, 받지 못했을 때만 대체물을 씀(첫 빌드 전 사전 점검은 이 예비 대체물을 적용하지 않음, 정상 해석이 항상 먼저라 받은 진짜 패키지가 이김). 알려진 서버 패키지, `server-only`·`'use server'` 표식, Node 내장 모듈이나 `process.env`를 쓰는 importer, lockfile로 받을 수 없는 패키지는 이전과 같음
- 패키지를 받은 뒤 다시 빌드할 때 사전 점검을 건너뛰어, 첫 빌드에서 적용한 대체물 계약이 빠지던 문제. 다른 패키지를 받으면서 재빌드하면 대체물로 덮었던 import가 `Could not resolve "axios"`처럼 빌드 실패로 바뀌었음(aristell ExcelUploadModal에서 xlsx를 받을 때). 재빌드는 이미 적용한 계약을 이어받음
- 헤드리스 측정(측정 직전 일반 Node 요청이 레지스트리 인증서 검증에 실패하는 상태): aristell 62쌍을 axios 레이어만 지운 의존성 저장소 사본(버전·구간마다 따로)으로 0.1.1546 워커와 페이지별 교대 실행. 0.1.1546은 55페이지에서 axios 중립 대체물을 쓰고 REST 데이터가 없음(회사 이름이 보이는 페이지 0). 0.1.1547은 첫 빌드에서 원래와 같은 axios 레이어(`fe145f9a…`)를 다시 받아 대체물 0, 회사 이름이 보이는 페이지 42이고, 62페이지 판정이 axios가 있던 저장소로 잰 0.1.1545 재측정과 모두 같음. 판정이 바뀐 3쌍 중 ReviewSheet·MultiplierCell 개선 2쌍은 실행마다 갈리는 페이지이고, UpliftInsights ready→post-commit-failed는 데이터가 들어오면 드러나는 기존 오류(UpliftGapChart가 `undefined.date`를 읽음, axios가 있던 0.1.1542·0.1.1545 재측정에서도 같은 실패)라 이번 변경의 퇴행이 아님. 받기 때문에 첫 빌드가 한 번 느려짐(App 컴파일 8.5초→12.1초). 재빌드 계약은 scratchpad fixture(aristell의 package.json·lockfile, `process.env`를 쓰는 axios 클라이언트와 xlsx 파서를 쓰는 패널, 두 레이어 모두 삭제)로 확인: 0.1.1546은 xlsx를 받은 뒤 `Could not resolve "axios"`로 실패, 0.1.1547은 xlsx를 받고 axios 계약을 유지해 ready. 레이어가 모두 있는 spa 예제 30쌍은 동일(퇴행 0). 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1546 - 2026-10-04

- 빠진 패키지를 lockfile로 받는 다운로드는 컴파일러 워커 스레드에서 돌고, VS Code의 `http.systemCertificates` 처리는 이 스레드에 적용되지 않아 Node 내장 루트 인증서로만 TLS를 검증하던 문제. 회사 프록시나 TLS 검사 장비처럼 운영체제 인증서 저장소에만 있는 루트를 쓰는 환경(이 기기 포함)에서는 다운로드가 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`로 실패해, 받을 수 있는 패키지도 `Could not resolve "xlsx"` 같은 빌드 실패로 남았음. 이제 워커가 첫 요청 전에 자기 스레드의 기본 루트에 운영체제 루트를 더함(Node 22.19+/24.5+의 `tls.setDefaultCACertificates`, Node 기본 루트와 `NODE_EXTRA_CA_CERTS`는 유지, TLS 검증은 끄지 않음, 확장 호스트 메인 스레드는 바꾸지 않음). `http.systemCertificates`를 끄면 이전처럼 Node 기본 루트만 씀(창을 다시 불러온 뒤 적용). VS Code와 같은 Electron(Node 24.21) 워커 스레드에서 확인: 기본 상태는 npm 레지스트리 요청이 실패하고, 운영체제 루트를 더하면 200
- 헤드리스 측정(측정 직전 일반 Node 요청이 레지스트리 인증서 검증에 실패함을 확인, `--use-system-ca` 없이 실행): xlsx 레이어만 지운 의존성 저장소 사본 두 벌로 aristell 입고 엑셀 업로드 모달(ExcelUploadModal)을 빌드하면 0.1.1545 워커는 `Could not resolve "xlsx"`로 빌드 실패, 0.1.1546 워커는 xlsx 레이어(9개 패키지)를 다시 받아 ready. 이미 받은 패키지만으로 빌드되는 페이지는 바뀌지 않음(spa 예제 30쌍 동일, 퇴행 0). 전체 테스트 실패 52개는 모두 이전부터 있던 실패(전체 실행 때 함께 실패한 Chromium 페이지 프레임 테스트 1개는 측정과 동시에 돌아 생긴 부하성 실패로, 단독 재실행 2회 통과). 남은 한계: `src/api/client.ts`처럼 경로에 `api`·`service` 등이 들어간 비UI 모듈이 import한 패키지(aristell의 axios)는 다운로드 전에 서버 패키지 중립 계약으로 분류되어 받기를 시도하지 않으므로, 이 수정만으로는 저장소에서 지워진 axios가 돌아오지 않음

## 0.1.1545 - 2026-10-04

- 대상이 닫힌 모달 안에 있어 진짜 페이지 옆에 따로 마운트되는 경우(`overlay-sibling`·`deferred-sibling` 배치, 예: aristell 입고 엑셀 업로드 모달 안의 ColumnMappingTable·FileDropZone·PreviewTable과 공용 Modal)에 페이지 문맥 확인이 "페이지 루트가 대상의 조상"만 인정해, 어떤 전체 페이지 실행 후보로 다시 빌드해도 성공할 수 없는 복구를 반복하고 "페이지 소유자 없음"으로 끝나던 문제. 이런 배치에서는 소유자가 대상의 형제이므로, 표식을 단 같은 Page Execution 안에서 실행 루트 브리지(자식이 커밋된 것)와 그 아래 등록된 소유자 컴포넌트를 찾아 확인함(컴파일러 후보가 증명한 분리 배치이고 전체 페이지 실행 후보일 때만, 그 밖에는 이전처럼 조상만 인정). 페이지가 대상을 렌더하지 못해 런타임이 대상을 대체로 페이지 옆에 마운트할 때 상태에 남기는 배치는 증명으로 쓰지 않음. 소유자 증명 코드는 별도 런타임 조각으로 분리함
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1544 워커와 페이지별 교대 실행): payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 동일, 퇴행 0. aristell은 처음 측정에서 하네스의 의존성 저장소에 axios가 빠져(저장소 정리로 지워진 뒤 이 기기의 Node가 npm 레지스트리 인증서를 검증하지 못해 다시 받지 못함) REST 요청 없이 돌았기에, 저장소를 복구해 0.1.1542 워커와 다시 비교함(0.1.1543–0.1.1545의 변화를 한 번에 확인): ColumnMappingTable·FileDropZone·PreviewTable·Modal 4쌍이 partial-blocked→ready로, 재빌드 요청 없이 도달하고 남아 있던 조건 blocker(`focusSku`·`subtitle`·`footer`)가 사라지며 InventoryPage의 REST 행 채우기가 시작됨(오류 없음). 복구 중 강제로 열려 함께 보이던 무관한 "입고 수정" 편집 모달과 `선택 0건 수정` 버튼은 더 이상 열리지 않음. ReviewSheet 1쌍 개선은 실행마다 결과가 갈리는 페이지이고, MultiplierCell 1쌍 ready→partial-blocked은 반복 실행에서 두 버전 모두 오락가락하는 행 채우기 재마운트 시점 문제(5초 캡처 0.1.1542 2/6·0.1.1545 0/6 ready, 판정 창을 늘리면 1/3·2/3)로 이번 변경과 무관. 나머지 56쌍 동일. 바뀐 4페이지는 VS Code가 이어서 보여 주는 문맥 보강 빌드에서도 같음. 중간 빌드는 런타임 대체 배치도 증명으로 받아들여 행 안에만 있는 TrendBars·MultiplierCell이 페이지 없이 대상만 그리는 실행으로 넘어갔기에 컴파일러 배치로 좁힘. 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1544 - 2026-10-04

- 0.1.1543의 보완: 실행 루트가 아닌 페이지 프레임(레이아웃 등)이 styled-components나 HOC로 만들어져 있으면(`InvestmentAssociationLayout = styled((props) => …)`, fiber 이름 `Styled(Component)`) 여전히 "페이지 소유자 없음"으로 판정해, payroll 투자 이력 수정 폼이 대상에 도달하지 못하고 페이지 제목의 조건 blocker가 남던 문제. 생성 실행 소스가 import한 소유 표면 컴포넌트(실행 대상 제외)를 소스·export와 함께 전역 심볼 목록에 등록하고, 런타임은 대상 위 fiber의 `type`·`elementType`이 그 컴포넌트와 같으면 페이지 루트·실행 루트·페이지 프레임을 이름과 관계없이 마운트된 것으로 봄(전체 페이지 실행 후보에서만, 프로젝트 객체는 수정하지 않음)
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1543 워커와 페이지별 교대 실행): payroll 투자 이력 수정 폼이 partial-blocked→ready(화면 텍스트 동일, VS Code가 이어서 보여 주는 문맥 보강 빌드에서도 도달·ready), 나머지 payroll·tada-web·UDT-fe·hospitalrun 39쌍·aristell 62쌍·spa 예제 30쌍 동일, 퇴행 0(이 aristell 측정은 하네스 저장소에 axios가 빠져 REST 데이터 없이 돌았음, 0.1.1545 항목의 재측정 참고). 전체 테스트 실패 52개는 모두 이전부터 있던 실패

## 0.1.1543 - 2026-10-04

- 페이지 소유자가 팩토리나 HOC로 만들어진 앱(예: recompose `withProps(...)(익명 컴포넌트)`를 돌려주는 `createAppModule`)에서, 소유자가 실제로 마운트되어 있는데도 Page Inspector가 "페이지 소유자 없음"으로 판정해 대상 도달(`reached`)로 넘어가지 못하던 문제(payroll의 `InvestmentAssociationIdApp`). React가 마운트한 컴포넌트 이름은 `withProps(Component)`라 export 이름과 맞지 않았고, 같은 이름의 하위 모듈이 대상 가까이에 있으면 이름 중복 제거로 바깥쪽 소유자가 아예 빠졌음. 실행 루트를 직접 렌더하는 생성 브리지에 심볼 표식을 달고, 그 브리지가 대상의 fiber 조상이면 실행 루트와, 그와 같은 소스·export인 페이지 루트·페이지 프레임을 마운트된 것으로 봄(전체 페이지 실행 후보에서만, 다른 루트는 이전처럼 이름으로 확인)
- payroll 페이지가 대상에 도달하면서 행 채우기가 처음으로 동작: 투자 이력 페이지의 주식 내역 표와 추가 투자 목록이 훅 단계 GraphQL 값의 한 행에서 `name 2`·`name 3`을 포함한 3행으로 늘고(0.1.1540의 GraphQL 훅 행 채우기) 유지로 판정됨. 대상에 도달하지 못해 함께 열려 있던 단계형 폼의 다음 단계("2. 투자계약 정보 입력")는 첫 단계 대상 페이지에서 더 이상 강제로 열리지 않음
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하는 하네스, 0.1.1542 워커와 페이지별 교대 실행, 이번 측정용으로 다시 구성한 페이지 목록): payroll 12쌍 중 8쌍이 partial-blocked→ready, 퇴행 0. tada-web·UDT-fe·hospitalrun 28쌍·spa 예제 30쌍 동일. aristell 62쌍도 동일했지만 이 측정은 하네스 저장소에 axios가 빠져 REST 데이터 없이 돌았음(Modal 개선 1은 이전 쪽 `axios` 해석 실패, 0.1.1545 항목의 재측정 참고). 바뀐 payroll 8페이지는 VS Code가 이어서 보여 주는 문맥 보강(corridor) 빌드로 렌더해도 모두 도달·ready, 텍스트 동일. 전체 테스트 실패 54개는 모두 이전부터 있던 실패

## 0.1.1542 - 2026-10-03

- Next.js 페이지가 렌더된 뒤에도 Page Inspector가 "페이지 소유자 없음"으로 잘못 판정해 페이지 문맥 복구를 시작하고 대상 도달(`reached`)로 넘어가지 못하던 문제. default export인 레이아웃·`_app`을 파일 이름(`layout`, `_app`)으로만 기대했는데, React가 마운트한 실제 컴포넌트는 `RootLayout`·`MyApp`·`AppShell`처럼 선언 이름이라 서로 맞지 않았음. 이제 컴파일러가 default export의 선언 이름(같은 파일의 함수·클래스, `wrapper.withRedux(MyApp)` 같은 감싸기 호출 안의 컴포넌트, 이름 붙은 const)을 읽어 실행 후보 정보에 넣고, 런타임은 이 이름을 파일 이름 별칭보다 먼저 페이지 루트·실행 루트로 확인함(이름을 증명하지 못한 루트는 이전처럼 파일 이름만 사용). 실행 후보 요약 생성은 별도 모듈로 옮김
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하고 실패한 빌드에는 실패 상태로 답하는 하네스, 0.1.1541 워커와 페이지별 교대 실행): tada-web·UDT-fe 페이지 16쌍이 좋아짐(partial-blocked→ready 13, 이전에 page-blocked 상태에서 크래시로 분류되던 3쌍→ready, 같은 window 오류는 두 쪽 모두 있음), 퇴행 0. 바뀐 16쌍 중 15쌍은 화면 텍스트가 같고, UDT 추천 페이지는 대상에 도달하지 못해 함께 열려 있던 서로 배타적인 빈 상태·재시도 문구가 사라짐. aristell 62쌍·spa 예제 30쌍 동일. payroll 페이지 대상은 소유자가 실제로 마운트되지 않아 그대로 `page-context-incomplete`
- 대상에 도달하면서 이 페이지들에서도 행 채우기가 시작됨(UDT 탐색 페이지는 REST 목록을 채워 약 3초 뒤 유지로 판정됐지만 화면 목록은 다른 데이터 경로라 그대로). VS Code는 컴파일러 후보가 완전(`complete`)할 때만 문맥 보강(corridor) 빌드를 취소하는데, 이 Next 후보들은 경로 체크포인트에서 멈춘 후보라 보강 빌드가 그대로 진행되어 그 화면으로 바뀜(바뀐 16페이지를 corridor 빌드로 렌더해도 모두 도달·ready, 텍스트 동일). app router의 중첩 레이아웃은 프레임워크 표면으로 조합되어 이름 판정 대상이 아니며(가장 바깥 루트 레이아웃만 실행 루트로 확인), zuzu-roundup의 중첩 레이아웃 페이지 2개도 재빌드 없이 바로 도달. 성공 경로 기록이 이 페이지들에서도 일어나 neural 학습 라벨이 늘어날 수 있음. 전체 테스트 실패는 기준선과 같고, 새로 보인 2건(대문자 `.TSX` 번들 시간 초과, Chromium 네트워크 서비스 크래시)은 단독 실행에서 통과

## 0.1.1541 - 2026-10-03

- Page Inspector가 페이지 문맥을 복구하려고 다시 빌드할 때, 대상이 페이지 파일 자체인 경우(Next.js app router의 `page.tsx`, pages router의 페이지, 라우트의 페이지 컴포넌트) 고르는 page-sliced·route-page-sliced 실행 후보가 항상 빌드에 실패하던 문제(`Selected-context React preview compilation produced authored inputs outside its verified module frontier`, 증거 `missing-execution-surface` / `selected-export-slice`). 이 변형은 페이지 export를 같은 파일의 virtual slice로 바꾸는데, 페이지가 곧 대상이면 그 slice가 런타임 대상 역할을 맡고, 런타임 대상은 항상 target facade로 실제 모듈을 불러오므로 slice가 graph에 들어가지 않아 frontier 검증이 빌드를 버렸음. 이제 런타임 대상 역할이 slice인 실행 후보는 만들지 않음(대상이 페이지 안 컴포넌트인 경우의 sliced 변형은 그대로)
- VS Code에서는 이런 페이지를 열 때마다 실패하는 corridor 빌드 1회와 출력 로그의 "React preview build failed; retaining the last good preview"가 생겼고, 이 재빌드 요청이 진행 중이던 문맥 보강(corridor) 빌드를 취소해 첫 화면(fast)이 그대로 남았음. 이제 실패하는 빌드와 로그가 없고, 남은 전체 페이지 실행 후보가 없다는 판단("전체 페이지 문맥을 복구하지 못함" 경고와 대상 도달 blocker)이 로딩 중에 바로 드러남. 이전에도 같은 판단(후보 소진)에 이르렀지만 그 상태가 드러나려면 다음 커밋이 필요했음. 재빌드 요청이 없으므로 문맥 보강 빌드가 끝까지 진행되어 이 페이지들은 corridor 빌드 화면으로 바뀜
- 헤드리스 측정(재빌드 요청에 VS Code처럼 응답하고 실패한 빌드에는 실패 상태로 답하는 하네스, 0.1.1540 워커와 페이지별 교대 실행): aristell 62쌍·spa 예제 30쌍 동일(aristell의 복구 페이지는 대상이 페이지 안 컴포넌트라 sliced 후보가 그대로). payroll·tada-web·UDT-fe·hospitalrun 40쌍 중 대상이 페이지 자체인 19페이지에서 재빌드 요청이 사라졌고, 그중 9쌍이 ready에서 partial-blocked로 바뀜. 화면 텍스트는 같고 후보 소진 판단이 캡처 전에 드러난 것으로, 0.1.1540 쪽도 같은 시점에 복구 기록이 이미 `exhausted`였음을 확인. 개선 1(UDT survey)은 이전 쪽의 부하 중 45초 컴파일 정지. 이 19페이지를 문맥 보강(corridor) 빌드로 렌더해도 결과와 텍스트가 fast 빌드와 모두 같음
- 남은 문제(미수정): 이 복구는 Next.js 페이지에서 페이지 소유자를 파일 이름(`layout`, `_app`)으로 기대하는데 실제 컴포넌트 이름이 `RootLayout`·`MyApp`이라 "소유자 없음"으로 잘못 판정해 시작됨. payroll 페이지 대상의 소유자(`InvestmentAssociationIdApp`)는 실제로 마운트되지 않는 다른 경우

## 0.1.1540 - 2026-10-03

- Apollo `useQuery` 같은 GraphQL 훅의 데이터를 페이지가 직접 `map`하지 않고 자식 컴포넌트에 props로 넘기면 목록이 한 행만 보이던 문제. 응답이 아직 없거나 선택한 필드가 비어 있을 때 쓰는 훅 단계 GraphQL 값은 목록마다 최소 한 행(Smart)이고, 행 수는 같은 컴포넌트에서 `map`하는 목록만 컴파일러 렌더 근거로 정했음. 이제 대상에 도달한 뒤 REST 행 채우기와 같은 라운드·검증으로 그런 목록을 목록 샘플 수(기본 3행)까지 늘려 제공. 그 훅의 최근 대체 기록이 페이지가 그 목록을 훅 값에서 받았다고 보여 줄 때(목록이나 그 상위 값을 훅 값으로 채웠거나, 응답의 빈 목록에 훅 값의 행을 통째로 채운 경우 — 자식에게 넘긴 목록은 컴파일러가 최소 한 행을 요구해 응답의 빈 목록에 훅 값의 첫 행이 채워짐)만 늘리고(응답이 행을 가진 목록은 그대로), 첫 행은 두고 같은 selection의 행을 덧붙이며(`name 2`, `name 3`), 덧붙인 행이나 그 안 객체(GraphQL edge의 `node`)의 id·key 같은 식별 값이 겹치면 늘리지 않음. 캐시된 훅 값은 바꾸지 않고 옆에서 제공하므로 neural 성공 지문과 Fallbacks 창은 원래 값 그대로이고, 대상 오류·새 치명적 오류·검증 실패면 한 행으로 돌아감. 요청 단위 GraphQL 응답(빈 목록)과 직접 `map`하는 목록의 렌더 근거 행 수, 사용자 값·Smart 값·data-flow 추천 값은 바꾸지 않음
- 예제 페이지(spa 예제 복사본에 추가한 Apollo 페이지, 0.1.1539 워커와 교대 실행): 목록을 자식에게 props로 넘기는 두 페이지(connection 필드 `projects { edges { node } }`, 일반 목록 필드 `items { id name status }`)가 0.1.1539에서 1행, 0.1.1540에서 3행(`name · ACTIVE`, `name 2 · ACTIVE`, `name 3 · ACTIVE`)으로 바뀜(ProjectsChild 4회·ItemsChild 2회 모두). 안정화 창을 늘린 하네스에서 약 4.1초 뒤 유지로 판정(되돌림 0). 같은 컴포넌트에서 직접 `map`하는 ProjectsApollo(렌더 근거 3행)와 늦은 패널·이른 패널 REST 예제는 그대로
- 실제 프로젝트에서는 아직 화면 변화가 없음: GraphQL을 쓰는 payroll 페이지는 대상에 도달(`reached`)하지 못하고 페이지 문맥 복구 단계에서 끝나(헤드리스 캡처에서는 `recovering-page-context`, VS Code처럼 재빌드 요청에 응답하게 한 측정에서는 `page-context-incomplete`) REST·GraphQL 행 채우기가 모두 시작되지 않음(0.1.1539와 같음). 훅 근거 등록은 동작해 `IaInvestmentHistory` 같은 쿼리의 한 행 목록이 후보로 잡힘
- 조사 중 발견(미수정): Apollo 메모리 클라이언트가 응답 모양을 만들 때 `pageInfo`가 없는 connection 필드(`projects { edges { node } }`)를 이름이 복수형이라는 이유로 목록으로 추측해 빈 배열을 응답함(훅 단계 추론은 객체로 봄)
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1539 워커와 페이지별 교대 실행): payroll·tada-web·UDT-fe·hospitalrun 40쌍·spa 예제 30쌍 동일(최종 빌드, 훅 채우기 시작 0). aristell 62쌍(GraphQL 훅이 없어 새 경로가 동작하지 않음, 판정 확장 전 빌드)의 퇴행 1은 ReviewSheet로, 두 워커가 같은 REST 채우기를 했고 새 쪽이 일찍 시작해 5초 캡처가 재마운트 로딩(`isPending`)에 걸린 경우. 4쌍 반복에서 0.1.1539 2/4·0.1.1540 3/4 정상이라 실행마다 결과가 갈리는 페이지. 전체 테스트 실패 55개 항목 중 54개는 0.1.1539와 같고, 바뀐 1쌍(헤드리스 렌더러 자원 정리·스냅샷 경로 거부)은 단독 실행에서 통과하는 시간 의존 테스트

## 0.1.1539 - 2026-10-03

- 페이지가 대상에 도달한 직후(약 2초 안) 새 요청을 등록하면 neural 성공 체크포인트 검증이 그 성공을 거부하고 대상 출력 표시를 꺼, 멀쩡히 보이는 페이지가 판정 보류(insufficient-evidence)로 끝나거나 REST 행 채우기가 대상 출력 상실로 보고 채운 행을 거두던 문제. 체크포인트 지문이 요청·훅 ID 목록 전체를 담아, 늦게 열린 패널의 요청 하나로도 달라졌음. 이제 체크포인트가 가진 요청·훅 ID와 값, 덮어쓰기, 그때 이미 있던 조건의 분기가 그대로면 뒤에 마운트된 컴포넌트가 더한 요청·훅·자기 조건 선택은 같은 상태로 인정하고, 체크포인트 이후 생긴 훅의 로딩 상태만 terminal을 transient로 바꿀 수 있음(체크포인트 값의 변경·삭제, 기존 요청에 새 덮어쓰기, 기존 조건의 새 분기는 여전히 거부). 임시 성공 확인과 저장된 경로 복원 확인이 같은 판정을 쓰므로 neural 학습이 성공을 받아들이는 기준이 바뀜(늦은 요청이 있는 페이지의 성공이 더 이상 거부되지 않음)
- 0.1.1538의 늦은 라운드 보완: 늦은 요청이 앞 라운드의 판정을 기다리는 동안 등록되면, 앞 라운드가 유지로 판정된 뒤 페이지가 조용해 다음 스냅샷이 오지 않아 다음 라운드가 시작되지 않았음. 유지 판정 직후 한 번 다음 라운드를 확인함
- 예제 페이지(먼저 보이는 목록 + 1.5초 뒤 열리는 패널, 각 10회): 0.1.1538은 10회 모두 검증이 출력 표시를 끄고 행 채우기가 거둬져 "No customers."로 남았고, 0.1.1539는 표시가 한 번도 꺼지지 않고 채운 행을 모두 유지(5회 재측정에서는 1.5초 뒤 패널도 두 번째 라운드로 3행)
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1538 워커와 페이지별 교대 실행): neural 검증은 모든 페이지에 적용되므로 aristell 62쌍·spa 예제 30쌍·payroll/tada-web/UDT-fe/hospitalrun 40쌍을 모두 돌려 퇴행 0(개선 1은 실행마다 결과가 갈리는 MultiplierCell). 같은 실행에서 neural 학습 갱신·결과 수는 153·142회에서 154·143회로 거의 같음. 전체 테스트 실패 53개는 모두 이전 기준선에 있던 실패

## 0.1.1538 - 2026-10-02

- 행 채우기가 유지로 판정된 뒤에 등록되는 요청(늦게 열리는 패널·탭·모달, 지연 조회)의 빈 목록도 같은 검증으로 채움. 유지된 라운드가 있으면 그 라운드가 시작된 뒤 새로 등록된 선언 타입 REST 요청만 다음 라운드로 받고(이미 있던 요청·되돌린 라운드는 다시 시도하지 않음), 리비전·대상 경로당 최대 3라운드. 새 라운드가 오류나 검증 실패로 되돌려져도 앞서 유지된 행은 계속 제공하고, 늦은 라운드의 오류는 그 세션의 이후 늦은 라운드만 막아 다음 리비전의 첫 라운드는 그대로 채움. 0.1.1537에서는 리비전당 한 번만 채워 먼저 보인 목록 뒤에 열린 패널이 빈 상태("No recent orders.")로 남았음(예제 페이지에서 0.1.1537은 빈 상태, 0.1.1538은 두 번째 라운드가 행 3개를 채워 유지)
- GraphQL 목록 확인(코드 변경 없음): 렌더 근거로 채우는 GraphQL 목록과 훅 단계 GraphQL 복구로 그리는 표는 이미 여러 행이 보임(payroll 주식 내역·추가 투자 목록 3행, spa ProjectsApollo 3행). Apollo 데이터를 받은 페이지가 목록을 자식 컴포넌트에 props로만 넘기는 직접 만든 예제에서만 한 행으로 남았고, 요청 단계 행 채우기에 GraphQL을 넣어 봤지만 화면 데이터가 훅 단계 값이라 효과가 없고 렌더 근거 행 수를 잃을 수 있어 넣지 않음
- 측정(목록이 있는 22페이지, 배포 빌드): 목록별 0행·1행·2행 이상이 0.1.1537과 같은 10·0·37개. 헤드리스 측정은 클릭·탭 전환 없이 몇 초 안에 끝나 늦은 라운드가 한 번도 일어나지 않았고, 늦은 라운드는 직접 만든 예제 페이지에서만 확인
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1537 워커와 페이지별 교대 실행): aristell 62쌍 퇴행 0(개선 1은 실행마다 결과가 갈리는 ReviewSheet)·채우기 적용 46페이지, spa 예제 30쌍 동일·채우기 적용 6페이지. payroll·tada-web·UDT-fe·hospitalrun은 유지된 라운드가 없어 새 경로가 동작하지 않으므로 다시 돌리지 않음. 전체 테스트 실패 53개는 모두 이전 기준선에 있던 실패

## 0.1.1537 - 2026-10-02

- 목록에 가짜 행이 여러 개 보이도록, 대상 도달 전 자동 요구 탐색(또는 자동 neural 보조)이 넣은 최소 한 행(자동 Smart)을 대상에 도달한 뒤 REST 행 채우기와 같은 검증으로 목록 샘플 수(기본 3행)까지 늘려 제공. 첫 행은 탐색이 고른 값을 그대로 두고 같은 타입의 행을 덧붙임. Smart 덮어쓰기 자체는 바꾸지 않고 검증 중인 리비전에서만 늘린 행을 제공하므로, 철회하거나 파일을 저장해 리비전이 바뀌면 한 행으로 돌아갔다가 다시 검증 뒤 늘어남(neural 성공 지문도 바뀌지 않음). 자동으로 쓴 Smart 값은 덮어쓰기 안에 `automatic` 표시를 남겨(웹뷰 상태에 함께 저장) 사용자가 넣은 JSON·Smart 버튼·Lorem 값과 구분하고, 그런 값은 늘리지 않음. 덧붙인 행의 id·key 같은 식별 값이 겹치면 늘리지 않음
- 채워 넣은 행의 일반 문자열 값이 행마다 같아(`name`, `name`, `name`) 같은 행이 반복돼 보이고 이름을 key로 쓰는 목록에서 key가 겹치던 문제. 행 채우기가 만드는 행에서만 두 번째 행부터 `name 2`, `name 3`처럼 순번을 붙임(갤러리 Auto·Lorem 등 다른 생성 목록의 값은 그대로)
- 측정(목록이 있는 22페이지, 배포 빌드, 목록별 행 수): 0행·1행·2행 이상이 0.1.1536의 10·3·34개에서 10·0·37개로 바뀜. 한 행이던 MetricsChart·ActivityFeed·EventSchedule이 3행(`name 2: 0`, `actor 2 verb 2` 등)이 되고, OrderList·PaymentsTable도 구별되는 3행(`customer 2 · 2.00`)으로 보임. 남은 0행 중 8개는 회사 ID가 정해지기 전에 한 번 나간 옛 요청 기록이라 화면에 그려지는 목록이 아님. 안정화 창을 늘린 하네스에서 이 다섯 페이지는 모두 유지로 판정(오류 0)
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1536 워커와 페이지별 교대 실행): aristell 62쌍 퇴행 0(개선 1은 실행마다 결과가 갈리는 MultiplierCell)·채우기 적용 46페이지(0.1.1536 45), spa 예제 30쌍 동일·채우기 적용 6페이지(0.1.1536 3). payroll·tada-web·UDT-fe·hospitalrun 40쌍은 채우기가 한 번도 시작되지 않아 바뀐 경로가 동작하지 않음(중간 빌드에서 동일). 모든 채우기를 neural 임시 검증 뒤로 미룬 중간 빌드는 aristell 채우기 적용이 29페이지로 줄어 되돌렸고, 늘린 Smart 행을 덮어쓰기에 직접 쓴 중간 빌드는 저장·재시작 뒤에도 검증 없이 남아 리비전별 제공으로 바꿈. 전체 테스트 실패 55개는 모두 이전 기준선(0.1.1534–0.1.1536)에 있던 실패

## 0.1.1536 - 2026-10-02

- 채운 행이 보이도록, 목록이 대상 자신의 본문인 페이지가 대상 도달 전에 빈 화면으로 멈추던 두 경로를 수정. 0.1.1535에서 OrderList·MetricsChart 같은 페이지는 자주 페이지 실행 재시도(`retrying-page-execution`)로 빠져 행을 채울 기회가 없었음
- OrderList(`if (orders.length === 0) return <p>No orders yet.</p>`): 대상이 이미 빈 상태를 출력하는 동안 neural 보조가 이 가드를 비어 있지 않은 쪽으로 강제해 빈 `<ul>`로 출력을 잃고 멈추던 문제. 대상 자신의 소스에 있는 목록 비어 있음 가드(`x.length === 0`, `!x.length`, `x?.length > 0`, `x.length` 등 조건 전체가 그 형태일 때)를 대상이 출력을 보이는 동안에는 비어 있지 않은 쪽으로 넘기지 않음(neural 보조·대상 경로 탐색·페이지 생성이 같은 판정 사용). 대상에 도달한 뒤 REST 채우기로 행이 들어옴
- MetricsChart(`if (!data) return Loading…; return <figure>{data.series.map(…)}</figure>`): 대상이 "Loading…"에서 빈 `<figure>`로 바뀐 뒤 결정적 요구 탐색이 GraphQL selection만 근거로 삼아 아무것도 하지 않고 2회 만에 페이지 실행 재시도로 넘어가던 문제. 선언되거나 컴파일러가 추론한 REST 응답 타입(endpoint 이름 추측 제외)도 GraphQL처럼 최소 한 행의 근거로 사용. 이 경로의 행은 Smart 최소값이라 한 행만 보이며, 이후 REST 채우기는 Smart 값을 바꾸지 않음
- 반복 측정(배포 빌드, 각 10회): OrderList 10/10 ready(행 3개 표시), MetricsChart 10/10 ready(행 1개 표시). 안정화 창을 9초로 늘린 하네스에서 OrderList 3회 모두 채운 행이 약 4.3초 뒤 유지로 판정되고, 거부된 가드 강제는 실행당 1회뿐(반복 시도 없음). 같은 하네스의 0.1.1535 빌드는 OrderList 10회 중 3회, MetricsChart 13회 중 8회 ready
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1535 워커와 페이지별 교대 실행): aristell 62쌍 퇴행 0(개선 1은 실행마다 결과가 갈리는 ReviewSheet), spa 예제 30쌍 개선 1(OrderList)·퇴행 0, payroll·tada-web·UDT-fe·hospitalrun 40쌍 동일. 전체 테스트 실패 54개는 0.1.1534·0.1.1535 기준선에 있던 실패뿐

## 0.1.1535 - 2026-10-02

- Page Inspector가 페이지를 찾는 동안 빈 배열로 응답하던 REST 목록을, 대상이 렌더된 뒤 샘플 행으로 한 번 채우고 검증. 선언된 TypeScript 응답 타입이나 컴파일러가 추론한 응답 shape에서 객체 행을 가진 바깥 목록만 채우고(행 안의 목록은 비워 둠), endpoint 이름 추측·사용자 payload·성공이 아닌 시나리오는 제외. 열린 렌더 시도·요구 탐색·페이지 실행 준비·neural 보조 요청·neural 성공 경로 복원이 끝난 뒤 시작(복원 검증은 요청 목록 지문을 비교하므로 도중에 행이 들어가면 대상을 잃은 것으로 판정하던 문제). 채운 뒤 다시 마운트하고, 대상 오류나 채우기 전에 없던 치명적 오류가 나면 즉시, 그 밖에는 페이지가 2초 동안 조용해졌을 때(또는 10초 시한에) 대상 출력이 없거나 blocker가 늘었으면 그 리비전에서 되돌림. 다시 마운트하는 동안의 로딩 상태(`isPending`)만으로는 되돌리지 않음. 리비전·대상 경로당 한 번이며 추가 마운트 1회(되돌리면 2회). GraphQL은 기존 컴파일러 렌더 근거 경로를 그대로 사용
- 오류로 되돌린 경로는 그 세션 동안 다시 채우지 않아 파일을 저장할 때마다 같은 크래시가 반복되지 않음. 다만 아래 방지로 막지 못한 행 크래시가 나면 행은 거두지만, React Query가 캐시한 행 때문에 오류 placeholder는 다음 마운트(파일 저장, 페이지·export 전환)까지 남음
- 행을 채운 동안에는 VirtualPage 부트스트랩이 처음 보는 조기 반환 가드를 열지 않음. 페이지 본문의 모든 컴포넌트 가드를 여는 이 정책이 행 안의 `if (!grade || !(grade in GRADE_COLOR)) return '—'`까지 열어, 생성된 값으로 `GRADE_COLOR[grade].bg`가 터지던 문제(aristell PageHeader·SegmentedControl 대상). 행을 채우기 전에 열린 가드는 그대로 유지
- 측정(목록이 있는 22페이지, 배포 빌드): 구조가 있는 REST 목록 중 빈 채로 응답된 것 43→12개, 채워진 것 3→35개. aristell 8페이지는 페이지당 3–6개 목록이 채워진 채 ready 유지, 합성 PaymentsTable에 행 표시(ActivityFeed·EventSchedule은 이전부터 채워져 있음). 헤드리스 캡처(약 5초)는 판정 전에 끝나므로, 안정화 창을 9초로 늘린 하네스로 채우기가 적용되는 10페이지(aristell 8개 페이지·PageHeader·PaymentsTable)를 돌려 모두 약 4.3초 뒤 유지로 판정됨을 확인(되돌림 0, 모두 ready). OrderList·MetricsChart는 대상 도달 전에 페이지 실행 재시도(`retrying-page-execution`)로 빠지는 기존 불안정이 남아 있어(MetricsChart 3회 재실행에서 0.1.1534 워커와 새 워커 모두 1회만 ready, 채우기는 시작되지 않음) 도달한 경우에만 행이 보임
- 행 안에만 있어 대상에 도달하지 못하는 컴포넌트(aristell TrendBars 등)는 이 기능의 범위가 아니며 대상 탐색의 별도 작업으로 남음
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1534 워커와 페이지별 교대 실행): aristell 62쌍 퇴행 0(개선 1은 이전 워커 쪽 컴파일 정지), 채우기가 적용된 페이지 45개. 중간 빌드의 같은 검사에서 PageHeader·SegmentedControl 크래시(위 가드 문제)와 PromotionList 판정 보류(neural 복원 중 시작)를 찾아 고쳤고, 두 페이지는 고친 빌드로 4회·PromotionList·ReviewSheet·MultiplierCell은 6회 모두 정상. payroll·tada-web·UDT-fe·hospitalrun 40쌍(중간 빌드)에서는 채우기가 한 번도 시작되지 않아 바뀐 경로가 동작하지 않으며, 퇴행으로 잡힌 payroll 2쌍은 부하 중 컴파일 단계 45초 정지였고 재실행에서 이전 워커와 같음. 전체 테스트 실패 57개는 0.1.1534 기준선과 같은 수(이름이 바뀐 3쌍은 단독 실행에서 통과하는 시간 의존 테스트)

## 0.1.1534 - 2026-10-02

- 사전학습 도구(`scripts/pretrain-page-inspector-neural.mjs`)가 학습 중 기기를 독점하지 않게 자원을 스스로 조절. 시작 시 프로세스 우선순위를 낮추고(`--nice`, 기본 10, Chromium이 상속), 페이지마다 1분 load average가 논리 CPU 수(`--max-load` 배율, 기본 1, 0이면 끔)를 넘으면 그 0.75배 아래로 내려올 때까지 기다리며 macOS 메모리 압력이 critical이면 멈춤. 컴파일러 워커(최대 4 GiB 힙)는 한 번에 하나만 유지해, 프로젝트 N개를 돌면 워커 N개가 실행 끝까지 남던 구조를 없앰. 같은 16페이지 측정에서 렌더 결과·학습 라벨은 그대로이고 부하가 16.7로 오른 때 147초 일시정지. 레인 하나는 조절 여부와 관계없이 약 1코어·2 GB 미만을 쓰므로, 효과는 여러 레인이나 바쁜 기기에서 페이지 시작을 늦추고 우선순위를 낮추는 데 있음
- 기기 부족으로 난 실패(Chromium 응답 시간 초과, 컴파일러 watchdog·queue·memory stall)를 완료로 기록하지 않고 다른 페이지 뒤에 한 번 더 시도해, 바쁜 순간 때문에 학습 페이지가 영구 누락되지 않게 함
- Page Inspector: 선택 경로 밖의 동적 import를 생략할 때 대상 모듈이 하나로 정해지면, 생략 모듈이 그 모듈의 이름 export를 같은 빈 컴포넌트로 모두 내보냄. `dynamic(import('./Picker').then((mod) => mod.Picker))`처럼 이름 export를 고르는 코드가 `undefined`를 받아 Next `dynamic`이 페이지 평가 중 예외를 던지던 문제. 같은 원인을 가진 tada rider-web 8개 페이지 중 확인한 3개에서 2개가 본문까지 렌더되고 1개(invitation)는 effect 안의 외부 SDK 전역 문제로 남음. 여러 동적 import를 가진 route 레지스트리는 기존처럼 공유 모듈 하나를 씀
- 0.1.1533 렌더링 수정으로 이전에 학습 신호를 내지 못하던 페이지만 골라 다시 학습. 이전·새 워커의 페이지별 학습 라벨을 비교해(captain 판정 보류 페이지는 라벨이 같아 제외) zuzu-roundup 122·이전 타임아웃 48·zuzu-ats 빌드 실패 10페이지를 조절기를 켠 도구로 학습한 결과 라벨 164개(이전 약 0개, ready 51·partial 109). 약 70분 동안 프로세스 트리 CPU 평균 111%(p95 194%)·RSS 평균 1.2 GB(p95 2.2 GB)·시스템 부하 평균 10(p95 14)이었고, 부하로 3회 총 190초 멈췄으며 기기 부족 실패 2페이지를 재시도. 학습하지 않은 20페이지 A/B에서 기존 모델 대비 개선·퇴행 0. 가져오기 파일 `pretrain-fbcc195ce779`(4,994→5,158회)를 global storage에 두어 창을 다시 로드한 뒤 첫 Page Inspector 동기화에서 적용
- 테스트 실행 위생: 전체 테스트가 실행마다 시스템 임시 디렉터리에 workspace를 남기던 문제(누적 383개·516 MB)를 vitest globalSetup의 실행 전용 임시 루트로 해결하고, DOM ownership 테스트가 응답 없는 headless Chromium을 SIGTERM으로만 종료하려다 고아로 남기던 문제(누적 13개 프로세스 그룹·약 3.9 GB)를 SIGKILL과 더 긴 테스트 제한 시간으로 해결. 남아 있던 프로세스와 임시 디렉터리는 정리함

## 0.1.1533 - 2026-10-02

- REST 응답의 선언 타입을 범용 fetch helper(`fetchJson<Settings>('/api/settings')`, 요청처럼 보이는 이름의 helper)와 SWR(`useSWR<User>('/api/me', …)`) 호출에서도 등록하고, 컴파일러가 응답 형태를 `unknown`으로만 알 때(helper 안의 `as T`)도 등록된 선언 타입을 우선 사용. 복수형 endpoint 이름(`/api/settings`)을 목록으로 추측해 객체 응답 페이지가 크래시하던 문제를 해결하고, `router.push()` 같은 boolean 결과와 원시 `fetch`는 등록하지 않음. 합성 유형 8개 A/B(중간 빌드)에서 ThemeSettings·ActivityFeed·EventSchedule·MetricsChart·Subscription이 크래시→정상(퇴행 0개). OrderList는 선언 타입 `{items: Order[]}`를 쓰지만 초기 페이지 탐색에서 목록을 비워 두는 설계라 빈 상태가 표시되고, AccountSwr(SWR 첫 렌더의 `data!`)·Session(localStorage 세션)은 실제 앱에서도 첫 렌더에 실패하는 패턴이라 그대로 남음
- Next.js Pages Router: `next.config.*`의 리터럴 `i18n`(`defaultLocale`·`locales`)을 실행하지 않고 읽어 정적 `next/router`의 `locale`·`defaultLocale`·`locales`로 제공. 생성값이 locale 자리에 들어가 i18next가 `codes.forEach`로 실패하던 tada-web 페이지가 렌더됨(중간 빌드로 측정한 tada-web 70쌍 A/B 개선 18·퇴행 0, 정상 18→32)
- Next.js 모듈: 설치된 Next를 해석할 수 없을 때 `next/navigation`(이전에는 해석 실패를 오류로 유지)·`next/dynamic`·`next/server`·`next/link`는 브라우저 facade를 쓰고, 서버 전용 API `next/headers`(빈 cookies·headers)·`next/cache`(revalidate 무시, `unstable_cache` 통과)는 항상 inert facade 사용. `next/navigation.js` 같은 `.js` subpath도 같은 경로. 중간 빌드 측정에서 zuzu-ats의 `next/*` 해석 실패 8개 중 6개가 빌드(3개 정상)
- 서버 코드가 공유 모듈로 들어온 페이지: Node `os`(중립 host 값)·`module`(`createRequire`는 브라우저 내장 facade만 제공)·`process`(프리뷰의 bounded `process`) facade를 추가해 Prisma 등이 모듈 평가 중 `os.hostname().length`·`process.env.DEBUG.split()`에서 실패하던 문제를 해결. `server-only`·`'use server'` 모듈이 `fs`·`child_process` 같은 host I/O 내장 모듈을 import하면 첫 빌드부터 render-only 실행 계약으로 바꿔, 그 모듈이 쓰는 문서 파서(kordoc)가 브라우저에서 `Buffer`·`createRequire(…)("cfb")`로 실패하던 문제를 차단(Buffer shim은 다음 서버 내부로 실패를 옮길 뿐이라 넣지 않음). zuzu-roundup 표본 8개 A/B에서 모듈 평가 크래시 8→0개(본문까지 렌더 1개, 나머지는 async 서버 페이지 placeholder·`redirect()` 안내·관리자 경로 대상 미도달·비동기 gate 대기). vendor cache schema가 9로 바뀌어 프로젝트별 첫 빌드는 vendor를 다시 만듦
- Page Inspector: 페이지 실행 준비가 대상 출력 이후 멈추면(호스트가 재빌드 요청에 응답하지 않는 경우 등) 최소 요구 탐색을 `settled`로 마감해 `searching`에 머물지 않게 함
- 프리뷰 문서: 페이지가 렌더 중 `navigate(-1)`·`history.back()`·`location.assign()`을 호출해도 프리뷰 문서를 벗어나지 않게, 같은 문서 안의 기록 이동만 허용하고 다른 문서로의 push/replace 이동은 경고와 함께 취소(reload는 그대로). 헤드리스 Chromium에서 문서가 about:blank로 바뀌던 captain 페이지로 확인했고 VS Code 창에서는 확인하지 않음(VS Code 웹뷰는 콘텐츠를 갱신할 때마다 새 frame을 만들므로 가드가 그 갱신을 막지 않음)
- 헤드리스 측정(제품 동작과 별개): 렌더 시도의 진행 여부를 시도의 시작·정착 이벤트로 판정(스냅샷 사본은 digest가 바뀔 때만 다시 게시되고, 데이터·neural 시도는 corridor resume 플래그를 설정하지 않아 끝까지 대기하던 문제)하고, JS 대화상자를 `allow-modals`가 없는 VS Code 웹뷰처럼 거절. 같은 하네스·같은 소스의 중간 빌드로 captain insufficient-evidence 10쌍은 이전 워커 10개 모두 판정 보류·새 워커 10개 모두 정상(본문 확인). 학습 중 멈추던 captain·payroll 페이지 27개 재측정(중간 빌드)에서 26개가 종료 신호에 도달(정상 15)했고, 남은 1개는 렌더 중 같은 문서의 로그인 경로로 반복 이동하는 루프. 판정 방식이 바뀌어 0.1.1528 기준선과 직접 비교할 수 없음
- 회귀 검사(배포 빌드, 같은 하네스에서 0.1.1532 워커와 페이지별 교대 실행): aristell 62개 개선 1(UpliftGapChart 크래시→정상)·퇴행 0, payroll 12개 개선 4(판정 보류→정상, 본문 확인)·퇴행 0, Next 기반 tada-web·UDT-fe·hospitalrun 28개 개선 5·퇴행 0

## 0.1.1532 - 2026-10-02

- 사전학습 도구의 합성 페이지 유형을 35개로 확장. SPA 30개(인증·권한 gate, feature flag, 탭, wizard, react-hook-form, lazy route, 여러 export, 페이지네이션, 무한 스크롤, 날짜, localStorage 세션, 검색 파라미터, Provider 없는 context, SWR, 차트, 중첩 gate, 역할 switch, Apollo·Redux·Zustand, 빈 상태 등)와 Next.js 5개(async 서버 페이지와 `notFound()`, 검색 파라미터 client 페이지, `getServerSideProps`·`getStaticProps`). 같은 시작 모델에서 여러 프로세스가 나눠 학습한 결과를 합치는 `--merge`를 추가
- 10개 프로젝트의 페이지 1,461개(captain 902개 전부, vcm 162, zuzu-ats 106, zuzu-roundup 122, tada-web 70, hospitalrun 34, aristell 10, UDT-fe 10, shadcn/ui 22, 소규모 앱 23)와 합성 35개로 학습해 헤드 갱신 4,287→4,990회(data-collection 14→153, render-state 6→37, rendered-empty 90→184). 같은 저장소의 다른 worktree는 같은 페이지라 제외. 학습 결과를 적용한 모델은 40개 페이지 A/B에서 개선·퇴행 0개(기준 모델끼리 차이 0개)
- 학습하지 못한 페이지: 헤드리스에서 프리뷰 문서가 바뀌거나 부팅 신호가 오지 않는 captain·vcm 페이지 약 47개(제한 시간을 110초로 늘려도 동일). 8개는 페이지 폴더에서 `navigate(-1)`·`location.assign()` 호출을 확인했고, 나머지는 문서 이동을 막으면 메인 스레드가 멈춰 공통 코드의 이동 시도로 추정(미확인). 이 밖에 빌드 실패(zuzu-ats `next/headers`·`next/navigation` 등 해석 실패 8개, ir-insight-bot 외부 asset 4개, zuzu-roundup `@react-email/render` 4개, shadcn/ui 경로 별칭 3개). 의존성 획득 전에 실패한 zuzu-ats 페이지는 다시 학습

## 0.1.1531 - 2026-10-01

- Page Inspector 신경망을 프로젝트 페이지로 사전학습하는 도구(`scripts/pretrain-page-inspector-neural.mjs`)를 추가. 헤드리스 Chrome에서 실제 Inspector로 페이지를 열 때 웹뷰 상태에 프로필 모델 사본만 복원하고 페이지가 마지막으로 동기화한 모델을 다음 페이지로 넘기며, 프로젝트별로 번갈아 방문하고 중단 지점부터 이어감. 합성 페이지 유형 8개(`--write-archetypes`)도 생성
- global storage의 `neural-model-import.json`을 첫 Page Inspector 동기화에서 한 번만 가져와 사전학습의 변화량(가중치·갱신·근거)만 현재 프로필 모델에 더함. 기존 학습과 후보 기록 192개는 유지하고 새 기록은 빈 자리에만 넣으며, 적용 전 모델을 백업하고 저장에 성공한 뒤에만 적용 완료로 표시. 다른 VS Code 창이 저장한 학습도 쓰기 전에 합쳐 창끼리 덮어쓰지 않음
- 실행 결과: captain·zuzu-roundup·hospitalrun·tada-web·UDT-fe 페이지 275개와 합성 유형 8개로 헤드 갱신 135회(기존 4,152회). 헤드리스 실행은 페이지당 학습 신호가 1회 안팎이라, 학습 전후를 같은 빌드에서 번갈아 렌더한 미학습 페이지 29개의 결과는 퇴행·개선 모두 0개(기준 모델끼리 차이도 0개)
- 서버 전용 package가 공유 모듈로 페이지 그래프에 들어와도 빌드·로드가 실패하지 않게 함. `.node` native addon(onnxruntime 등)은 중립 모듈로 바꾸고, `__dirname`·`__filename`은 webpack처럼 `"/"`·`"/index.js"`로 정의하며, Node `url`은 브라우저 URL 기반 `fileURLToPath`·`pathToFileURL`을 제공. vendor cache schema가 8로 바뀌어 업데이트 후 프로젝트별 첫 빌드는 vendor를 다시 만듦. zuzu-roundup 페이지는 빌드 실패를 지나 렌더까지 진행하지만, 114개 중 110개는 렌더 중 `undefined.length`로, 4개는 `@react-email/render`를 찾지 못해 여전히 실패. aristell 62개·payroll 12개와 Next 기반 tada·UDT-fe·hospitalrun 28개는 0.1.1530 워커와 결과·오류 종류가 같음

## 0.1.1530 - 2026-10-01

- Tailwind compile 전략을 미리 학습한 시드를 포함. Tailwind 1.9.6–4.3.3의 대표 릴리스 25개를 실제 preview Tailwind 파이프라인(설정 token, `@apply`, 원격 폰트 `@import`, 편집 중 class)으로 측정하는 도구(`scripts/pretrain-tailwind-strategies.mjs`)를 추가하고, 기기와 무관한 결과만 읽기 전용 시드로 넣어 해당 버전은 첫 빌드부터 자가 시험을 생략. 사용자 기기의 학습 기록은 시드 위의 잔차로 쌓이고 시드는 저장소에 쓰지 않음
- 측정으로 찾은 버그 수정: Tailwind 4.0.x에서 편집 중 class를 `@source inline(...)`(4.1부터 지원)으로 넘겨 compile이 실패하고, 관리 저장소 환경에서는 남은 `@import "tailwindcss"` 때문에 빌드 전체가 실패하던 문제. 4.0은 파일 scan 전략(`v4-postcss-scan`)으로 compile하고(빠른 프리뷰의 `source(none)` 제한도 적용하지 않음), compile이 실패해도 해석할 수 없는 Tailwind import만 빼서 나머지 CSS로 빌드를 이어감. 3.0.0에서 자가 시험이 존재하지 않는 입력 파일을 `stat`해 실패하던 probe도 수정
- 미래 릴리스 장애 시나리오(새 버전의 adapter 고장, `default`로만 내보낸 plugin, 모든 전략 실패)를 가짜 패키지로 재현하는 테스트와 4.0 회귀 테스트를 추가. 측정 결과 1.9.6–3.4.19와 4.1.0–4.3.3은 일반·빠른(bounded) 모드 모두 전체 파이프라인 정상, 4.0.x는 저장하지 않은 편집의 새 class만 저장 후 반영

## 0.1.1529 - 2026-10-01

- 웹 폰트를 실제로 로드. 사용자 승인에 따라 웹뷰 CSP `style-src`에 HTTPS를 허용하고(`reactPreview.remoteStylesheets`, 기본 켜짐, 끄면 이전 정책), `index.html`의 HTTPS stylesheet와 렌더 경로의 앱 셸 wrapper(react-helmet을 쓰는 ThemeProvider 등)에 정적으로 쓰인 `<link>`를 프리뷰 문서에 연결. Tailwind CSS 파일 맨 위의 원격 `@import url(https://…)` 때문에 Tailwind compile 전체를 건너뛰던 문제도 수정
- 로그인 화면처럼 `if (!token) return …` early return 안에서만 렌더되는 페이지를 앱 셸 없이 그 분기로 표시. 컴파일러가 확인한 대상 위치로 분기를 정하고, 분기를 지나치게 만들던 생성값(`token=true`)과 선언 타입 값의 덮어쓰기를 막음
- Tailwind compile 전략(v4 PostCSS adapter, v2/v3 plugin의 `content`/`purge`)을 설치 버전별로 학습. 버전 규칙이 고른 전략을 작은 자가 시험(첫 빌드 약 0.05–0.1초, 버전당 한 번)으로 검증해 전역 저장소에 기억하고, 실패하면 학습한 순서로 다른 전략을 사용. 기존 전략 중에서만 고름
- 헤드리스 Chrome 재현에서 aristell LoginPage·ResetPasswordPage가 셸 아래 별도 mount 대신 실제 분기로 대상에 도달하고, Hanken Grotesk·IBM Plex(aristell)와 Pretendard(payroll) 폰트 face가 로드됨. aristell 62개·payroll 12개 회귀 검사 결과 분포는 기준선과 동일하고, Tailwind v4 프로젝트(UDT-fe)의 compile 결과 CSS는 0.1.1528과 byte 단위로 같음

## 0.1.1528 - 2026-10-01

- Vite/CRA 진입 파일(`index.html`의 module script, `src/main.*`, `src/index.*`)이 page root를 직접 import하면 그 파일의 전역 CSS(Tailwind layer·CSS 변수·body 배경과 폰트)를 실행 없이 포함. entry를 실행하지 않아 Tailwind 페이지가 스타일 없이 보이던 문제를 해결
- Tailwind v2/v3 프로젝트에 설치본이 없으면 lockfile 근거와 선언 범위로 `tailwindcss`를 관리 저장소에 받음. `tailwind.config.*`는 실행하지 않고 데이터로만 읽어 theme(색·폰트·radius·shadow)·darkMode·prefix·safelist와 지역 데이터 preset을 반영하고, 함수 값·package plugin과 workspace 밖 token 모듈은 건너뛰고 warning으로 알림. Tailwind가 만들 수 없는 `@apply` class는 그 class만 빼고 나머지 stylesheet를 compile
- 실제 CSS로 앱 셸이 화면을 채워 현재 파일이 화면 밖에 렌더되면, 사용자가 스크롤하지 않았을 때 한 번 대상 위치로 스크롤
- aristell 헤드리스 재현에서 측정한 6개 화면의 Tailwind utility 적용률 18–47%→100%, 배경·폰트 지정 반영. 62개 회귀 검사는 기존 정상 45개 유지·퇴행 없음, payroll 12개 결과 동일. `index.html`의 Google Fonts `<link>`는 프리뷰 문서로 옮기지 않고(웹뷰 CSP의 `style-src`도 외부 stylesheet를 차단) 대체 폰트로 표시

## 0.1.1527 - 2026-10-01

- 로컬 전용 실행을 전제로 확장의 컴파일러 워커 힙 상한을 4 GiB로 올리고(검증 캠페인 워커는 기록된 384 MiB 유지) 타입 분석 예산을 파일당 16 MiB·전체 32 MiB·프로젝트 파일 400개로 확대. 8 MB GraphQL codegen 스키마도 분석에 포함하며 힙 게이트는 워커 종료를 막는 안전장치로만 동작. import 해석을 워커 수명 동안 재사용하며 Apollo·MUI 규모 페이지의 빌드는 약 0.6–1.6초 늘어남
- 서버 응답을 선언 타입으로 생성. 페이지가 쓰는 `TypedDocumentNode`의 결과 타입과 import한 HTTP client 인스턴스 호출(`apiClient.get<T>('/path')`)의 응답 본문 타입을 모듈 끝에서 등록하고, Apollo 응답·래핑된 `useQuery`의 첫 로딩 렌더·XHR 요청 payload가 목록 여부·숫자·닫힌 리터럴을 선언대로 따름. 선언이 `string`뿐이면 이름 기반 추론을 유지하고 날짜 이름은 달력 형식을 고정. Context로 데이터를 전달하는 query renderer의 대체값에도 선언 값과 허용 리터럴을 실음
- payroll 12개 헤드리스 재현에서 크래시(`Unexpected value: ACTIVE`) 4→0개. aristell은 측정 가능한 57개가 0.1.1526과 같고 LoadingOverlay 크래시 해소, UpliftGapChart는 새로 타입이 생긴 응답이 연 경로에서 타입 없는 프로모션 목록 때문에 크래시(판정 보류→크래시). xlsx를 쓰는 5개는 측정용 저장소에 레이어가 없어 두 버전 모두 빌드 불가

## 0.1.1526 - 2026-10-01

- 프로젝트에 선언된 TypeScript 타입으로 hook 결과와 상태의 대체값을 합성. 구문 추측이 `{}`를 넣던 자리를 숫자·문자열·리터럴 union·날짜·배열·함수로 선언대로 채우고, 코드가 읽는 경로와 성공 상태로 union 멤버를 고름. 구문 근거가 없는 hook도 선언 타입이 있으면 throw할 때(Provider 없음 등)만 타입 값으로 대체해, 전용 브리지가 없는 라이브러리에서도 렌더를 이어감
- Inspector가 강제로 여는 `form && <Modal …/>` 분기와 우회하는 `if (!row) return null` 뒤에서 nullable 변수 읽기를 `(row || 타입값)`으로 바꿔 null 크래시를 차단. 실제 값이 있으면 그대로 쓰고 JSX 구조와 조건 계측은 유지. `…At`·`…Date` 이름의 문자열은 ISO 날짜로 채워 `Invalid time value`를 방지
- 분석 프로그램을 lib 포함 텍스트 바이트 예산(파일당 512 KiB, 최대 4 MiB) 안에서만 만들고, 최근 major GC 이후 실제 힙 여유가 부족한 빌드는 건너뜀. 허용한 파일만 제공하고 번들링 후 해제해 워커 메모리 초과를 방지. aristell 62개 헤드리스 재현에서 정상 렌더 41→46개(0.1.1524 대비 21→46개), 크래시 14→3개. 기존 정상 1개(ReviewSheet)는 같은 화면이지만 `isPending` 분기 blocker로 partial 집계. payroll 12개는 결과 동일·워커 오류 0개이며, 서버 타입이 8 MB codegen 파일에 있어 타입 이득은 없음

## 0.1.1525 - 2026-09-30

- TanStack/React Query(v3–v5) 프로젝트에 프로젝트 package의 `QueryClient`·`QueryClientProvider`로 메모리 전용 경계를 자동 구성. entry(`main.tsx`)를 실행하지 않아 `useQuery`가 "No QueryClient set"으로 실패하고 타입 없는 합성값(`{}`)이 렌더를 깨뜨리던 문제를 해결. 재시도·polling·focus 재요청을 끄고, payload 편집 시 쿼리를 무효화하며 `reactQueryPreview = false`로 끌 수 있음
- 정상 동작한 Query hook 결과(로딩·오류·데이터 수명주기)를 "필드 누락"으로 보고 생성값을 채우던 보완을 중단. Provider가 없어 hook이 throw하는 경우의 기존 복구 경로는 유지
- 이벤트 핸들러·effect·HTTP 인터셉터 안의 `useXStore.getState()` 같은 멤버 호출이 계측된 뒤 React hook을 호출해 "Invalid hook call"로 모든 요청을 실패시키던 문제를 수정. aristell 62개 파일 헤드리스 재현에서 정상 렌더 21→41개(미완료 41→21, 크래시(post-commit-failed) 37→14, 기존 성공 퇴행 없음), Apollo·Redux 기반 payroll 프로젝트 파일 12개는 전후 동일. 남은 크래시는 대부분 null state 모달 조건 강제 계열이며 데이터는 중립 placeholder

## 0.1.1524 - 2026-09-10

- import map 변경으로 웹뷰가 교체될 때 자동 페이지 실행의 실패 이력이 사라져 같은 후보를 반복 빌드하던 루프를 차단. 확장 호스트가 페이지·실행별 시도를 보존하고 새 후보도 입력 갱신 전 최대 12회로 제한
- 실패한 빌드·웹뷰 교체·페이지 후보 변경이 재시도 예산을 초기화하지 않도록 수정. 소스·설정 변경, 명시적 새로고침과 경로 확정 후에는 재시도를 허용하고 수동 페이지 선택은 유지
- 반복 차단을 렌더 성공이나 신경망 학습 결과로 간주하지 않고 기존 미해결 상태를 유지. 완전한 웹뷰 교체·핫 리로드·빌드 실패·새로고침 재개에 대한 호스트 회귀 테스트 추가

## 0.1.1523 - 2026-09-09

- 비슷한 이름의 다른 페이지·로딩·오류 화면을 같은 페이지 owner로 인정하지 않도록 문맥 검증 강화. 명시적인 memo·forwardRef·HOC 이름은 보존하고 실제 조상 신원을 한 번 색인해 반복 비교 비용을 제한
- 페이지 학습 결과를 현재 descriptor·실행 후보·목표 소스·활성 상태·리비전에 연결해 이전 실행의 성공·실패가 새 페이지에 섞이지 않도록 차단. 일시정지와 교체된 provisional 결과도 보존 없이 중단
- 미해결 블로커·목표 오류·분리된 DOM을 성공으로 학습하지 않고, 복구 중 오류와 관찰 불가 결과는 판단 보류. 확정된 출력 퇴행은 일부 DOM이 남아도 실패로 반영하며 학습 가중치·저장 기록·유한 재시도 경계 유지

## 0.1.1522 - 2026-09-09

- 권한 enum·설정 값이 페이지 주변 컴포넌트로 렌더링되던 회귀를 차단. 실제 JSX·컴포넌트 슬롯 근거만 허용하고 React Router의 다른 경로에 속한 화면을 분리하며, 데이터로도 쓰이는 의존성은 화면에 추가하지 않고 보존
- 반복 탭으로 분석 한도에 도달하는 경우와 최상위 Fragment의 헤더·푸터 누락을 보완. 분리해서 그리는 주변 컴포넌트의 필수 props를 기존 타입·사용 근거로 생성하고 수동 값·fallback 끄기·실제 목표 출력 검증을 유지
- 실패했던 CareGoalTable·CarePlanTable을 격리 Chromium으로 재검증하고 조밀한 라우트·권한 값·중첩 props 회귀 테스트 추가. 학습 모델·성공 기준을 완화하지 않고 잘못된 입력 구성 원인을 수정

## 0.1.1521 - 2026-09-09

- 페이지 내부 실행 재빌드의 실패 응답을 요청 ID·빌드 리비전과 연결해 무한 복구 대기를 해소. 응답 누락은 접수 5초·처리 150초 한도로 정리하고 진행 메시지가 대기 한도를 계속 늘리지 않도록 수정
- 빌드 실패·사용 불가 후보는 렌더 실패로 학습하지 않고 미시도 전체 페이지 실행으로 진행. 같은 리비전 준비 실패 3회·후보 소진·취소·시간 초과에는 자동 반복과 무관한 조건 탐색을 중단
- 실행 교체 중 수동 페이지 선택을 보존하고 호스트 완료 후 우선 적용. 오래된 응답·타이머·대상 변경을 검증하며 실제 실행 반영과 페이지 출력 검증 없이 성공 판정을 만들지 않음

## 0.1.1520 - 2026-09-09

- 생성 라우터만 제공하는 페이지에서도 정적으로 확인된 헤더·푸터·주변 영역을 보존. 실제 상위 route owner가 그리는 영역만 중복 제외하고 기존 순서·실행 허용 경계를 유지
- 실행 페이지와 안쪽 컴포넌트의 이름을 혼용해 페이지 성공으로 인정하던 경로를 차단하고, 유지해야 하는 페이지 owner·layout의 실제 React 조상 확인을 성공 기준에 포함
- 컴포넌트 출력과 오래된 완료 상태만으로 자동 복구를 멈추지 않도록 수정. 수동 컴포넌트 모드·일시정지·유한 재시도·기존 학습 기록을 보존하고 페이지 실행 계획을 책임별로 분리

## 0.1.1519 - 2026-09-09

- 전체 호환성 변환이 필요한 모듈의 중복 사전 검사를 생략하고, 정확히 같은 경로·소스의 런타임 검사 결과를 최대 128개·문자열 1MiB 한도에서 재사용. 편집·파서 오류·효과 격리·조건 계측은 그대로 검증
- 자동 페이지 선택의 빌드 실패와 사용 불가 응답을 렌더 실패 학습과 분리하고, 현재 리비전에서 해당 후보를 제외해 다음 허용 후보로 진행. 준비 실패 3회·취소·시간 초과에는 자동 반복하지 않고 새 리비전·수동 선택은 재시도 허용
- 호스트 응답의 후보와 요청 ID를 함께 검증하고, 수동 선택·일시정지·소스/대상 변경 후 오래된 자동 재시도를 차단. 성공 판정·사전학습 가중치·기존 설정과 학습 기록 유지

## 0.1.1518 - 2026-09-08

- 실제 빌드로 확인된 라우터 소유권을 넓은 초기 경로 추정과 분리해, 재준비할 때 같은 자동 라우터 보정 빌드를 반복하는 문제를 수정. 현재 편집 내용과 최종 모듈 그래프의 재검증은 유지
- 동일 파서 트리의 로컬 helper 색인을 약한 참조로 재사용하고, 컴파일 요청 안의 정확한 import 경로 조회를 제한된 캐시에 보관. 새 요청·다른 importer·편집된 소스의 분석을 분리
- 일반 패키지 import에서 불필요한 Yarn PnP companion 경로 조회를 생략. 실제 프로젝트의 컴파일 프로파일과 재준비 회귀로 병목을 검증하고 분석 깊이·실행 경계·기존 학습 기록을 보존

## 0.1.1517 - 2026-09-08

- 확장 소유 TypeScript 기본 import의 CommonJS 변환을 공통 경로로 모아 워커 시작 시 반복되는 API 열거·복사를 제거. 실제 TypeScript API, 외부 패키지와 프로젝트 모듈의 로딩 경계는 유지
- 프리뷰와 공유 패키지 산출물의 공백만 축소하고 함수명·개발 진단·JSX 소스 위치·setup 초기화 순서·기존 신경망 학습 기록을 보존. 이전 vendor 캐시와 구분하도록 빌드 스키마 갱신
- 배포용 워커와 격리 Chromium을 사용하는 재현 벤치마크 추가. 자체 페이지 7회 중앙값에서 첫 준비 1.78→1.00초, 편집 후 준비 494→384ms, 첫 DOM 반영 346→295ms; 실제 프로젝트 전체 완료 시간과 구분해 측정 범위와 제한을 기록

## 0.1.1516 - 2026-09-07

- 사전학습 v2에 수신 타입 요구·라우터 구조·검증된 실패 이력을 분리 입력하고, 실패 후보를 제외한 미시도 대안의 학습 순위를 유지. 기존 버전 4 저장 기록·성공 판정·수동 제어는 보존
- 격리된 Chromium의 비동기 효과·Lazy/Suspense·출력 재발 사례와 재시도 상태를 포함해 재학습. 비용 가중 학습·후보 간 비교·제한된 구조 비용을 적용하고 53,633개 파라미터 모델을 검증 성적으로 채택
- 동일한 저장소 소유 평가 상태 10,737개에서 v1 대비 콜드 첫 시도 성공 9,745→10,212건. 실제 프로젝트 해결률이나 전체 렌더 시간 개선을 뜻하지 않으며 상세 수치·제한은 사전학습 v2 문서에 기록

## 0.1.1515 - 2026-09-07

- 예외·컬렉션·참조값·페이지 경로·페이지 실행·UI 상태 전환에 131,841개 파라미터의 사전학습 복구 모델을 추가. 허용된 후보의 시도 순서만 조정하고 실제 성공 판정·수동 제어·기존 버전 4 학습 기록을 보존
- 저장소 소유 실행 사례 36,000건의 후보 결과 111,313개로 3개 용량을 비교 학습. 분리된 합성 SSR 평가 9,000건에서 첫 시도 성공 84.0%→93.3%; 실제 프로젝트 해결률과 구분해 학습·검증 절차와 한계를 문서화
- 가중치를 int8로 양자화하고 지연 로딩·64개 익명 벡터 캐시·학습 범위 밖 판단 보류를 적용. 동일 문맥의 검증 결과를 우선하고 외부 모델 서버나 새 런타임 의존성 없이 실행

## 0.1.1514 - 2026-09-07

- 경로 탐색기에서 `/`를 눌러도 하위 폴더가 남던 문제를 수정. 같은 라우터와 중첩 라우터에서 모두 최상위 경로 목록으로 복귀
- 탐색 버튼을 `/ All routes`로 명시해 실제 `/` 페이지 선택과 구분. 목록 복귀만으로 페이지를 변경하지 않고 기존 선택·준비 중·실패 재시도 상태를 보존

## 0.1.1513 - 2026-09-07

- `Review choice` 대신 실제 선택 대상과 옵션 이름·남은 옵션 수를 표시. 선택지가 없는 경우는 상세 검사, 페이지 경로 선택은 경로 비교로 구분
- 선택지 열기는 값을 고르거나 적용하지 않고 옵션 목록으로 이동. 별도 Inspector 탭에도 동일한 포커스·스크롤 동작을 전달하고 기존 수동 선택과 추천 배지를 유지

## 0.1.1512 - 2026-09-07

- 실제 신경망 추천 경로와 일치하는 옵션에 `Neural choice` 배지·테두리·배경 강조를 추가. 원래 페이지 옵션의 출처와 직접 선택·적용·출력 검증 상태는 별도로 유지
- 추천이 없거나 문맥·후보가 바뀌고 실패·한도 초과로 근거가 사라지면 추천 표시를 보류. 별도 추론·학습·페이지 변경 없이 기존 추천 결과만 표시

## 0.1.1511 - 2026-09-07

- Choice의 각 옵션에 원래 페이지 컨트롤·코드 정의 값/분기·Inspector 복구/초기화·출처 미확인을 표시. Inspector가 조합한 다음 단계는 원래 페이지 옵션과 별도로 안내
- 현재 페이지/프리뷰 값과 Inspector에서 고른 값을 함께 유지하고 출처를 접근성 이름에도 반영. 선택만으로 적용하지 않는 기존 동작과 페이지 컨트롤 재검증·수동 제어·학습 기록을 보존

## 0.1.1510 - 2026-09-07

- 목표가 보이지 않을 때 페이지 경로 근거와 실행된 렌더 조건을 분리 표시. 현재 목표를 막는 관찰된 조건에는 현재 값·목표 분기·소스 위치와 해당 조건으로 이동하는 버튼을 제공
- 컴포넌트만 복원된 문맥·미호출 콜백·빈 출력·렌더 오류를 구분하고, 근거가 부족하면 경로 오예측으로 단정하지 않음. 오래된 경로의 조건 안내를 차단하며 기존 수동 값·복구 정책·학습 기록을 유지

## 0.1.1509 - 2026-09-07

- 일부 화면 출력이 있어도 필수 선택·데이터·오류가 남으면 미해결 상태로 표시하고 성공 체크포인트·성공 학습·자동 복구 종료를 보류. 남은 항목이 해소되면 기존 연속 출력 검증을 다시 수행
- 일반 조건 분기는 `◇`, 필수 선택은 `?`로 구분하고 출력이 보이는 미해결 화면에서도 선택 컨트롤을 유지. 모델 갱신 횟수를 페이지 완성으로 오해하지 않도록 상태 안내를 일치시킴

## 0.1.1508 - 2026-09-07

- Inspector 선택 항목에 대상 필드·컴포넌트·변경 효과와 구체적인 적용 버튼을 표시하고 첫 수동 선택을 펼쳐 노출. 후보가 없는 상태에는 상세 확인·조건 검사·페이지 경로 이동을 남기며 페이지 경로의 중첩 접기도 함께 해제
- 조건의 WAIT/Waiting은 미실행 원인, QUEUED ON/OFF는 선택 값과 미적용 이유로 구분. 페이지 경로 예약도 현재 빌드 완료 후 적용됨을 설명하고 기존 수동 제어·검증·학습 갱신 분리는 유지

## 0.1.1507 - 2026-09-07

- 첫 신경망 점수 조회는 미학습 헤드의 불필요한 투영을 생략하고 학습된 추론은 고정 가중치를 지연 재사용. 기존 점수·SGD·저장 모델의 수치와 검증 경계를 유지하며 렌더 대기 프레임의 전체 블로커 재분석을 제거
- 반복 실패한 후보는 과거 성공 점수가 높아도 덜 실패한 허용 후보 뒤로 배치. 복구 준비·적용 사이의 페이지·대상·수동 제어·오류 필드·유한 선택 도메인 변경을 재확인하고, 오래된 전략 대신 기존 예산 안에서 새 근거로 재계획
