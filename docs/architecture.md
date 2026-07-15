# 아키텍처

## 목표와 불변식

React File Preview는 “현재 파일을 서버 없이 즉시 확인한다”는 한 가지 흐름에 집중합니다.
모든 구현은 다음 불변식을 지켜야 합니다.

- 사용자 워크스페이스에 생성물을 쓰지 않는다.
- HTTP 서버, 포트, 하위 프로세스 기반 개발 서버를 시작하지 않는다.
- 저장하지 않은 현재 문서가 저장된 파일보다 우선한다.
- 워크스페이스 코드는 신뢰 확인 뒤 격리된 웹뷰에서만 실행한다.
- 컴파일 실패가 마지막 성공 생성물을 부분적으로 덮어쓰지 않는다.
- 비동기 빌드 결과는 최신 revision일 때만 화면에 반영한다.

## 계층과 의존 방향

| 계층               | 책임                                             | 허용된 주요 의존성               |
| ------------------ | ------------------------------------------------ | -------------------------------- |
| `domain`           | 요청, 번들, 진단, 저장 위치, 대상 파일 규칙      | 표준 TypeScript/JavaScript       |
| `application`      | 컴파일 후 게시하는 유스케이스와 port             | `domain`                         |
| `adapters/esbuild` | 가상 엔트리, 미저장 문서 overlay, 브라우저 번들  | `application`, `domain`, esbuild |
| `adapters/vscode`  | global storage 게시와 세션 캐시 정리             | `application`, `domain`, VS Code |
| `presentation`     | 패널, editor event, debounce, revision, CSP HTML | `application`, `domain`, VS Code |
| `shared`           | 경로 정규화처럼 외부 계층이 함께 쓰는 순수 도구  | Node 표준 라이브러리             |
| `types`            | asset import용 compile-time ambient 선언         | 런타임 의존성 없음               |
| `extension.ts`     | 객체 생성, 의존성 연결, 명령 등록                | 모든 외부 계층                   |

의존성은 안쪽을 향합니다. `shared`는 어떤 계층도 알지 못하는 최소 기술 도구이고, `domain`과
`application`은 VS Code와 esbuild를 알지 못합니다. `presentation`도 구체 adapter를 직접 만들지
않으며 `extension.ts`에서 주입받습니다. ESLint의 `no-restricted-imports` 규칙이 주요 역방향
import를 차단합니다. `types`는 import를 실행하지 않는 ambient 선언만 둡니다.

## 빌드 흐름

1. 컨트롤러가 워크스페이스 신뢰, URI scheme, 확장자, 활성 editor를 검증합니다.
2. `TextDocument.getText()`로 불변 `PreviewBuildRequest`를 만듭니다.
3. 가상 엔트리가 현재 파일의 기본 내보내기와 프로젝트의 React/ReactDOM을 가져옵니다.
4. open-document plugin이 전용 namespace에서 저장 전 텍스트를 반환하고, symlink·확장자 생략·
   순환 import로 다시 유입되는 동일 파일도 canonical path로 비교해 하나의 모듈로 합칩니다.
5. esbuild가 `platform: browser`, `format: esm`, `write: false`로 단일 JS와 선택적 CSS를 만듭니다.
6. application 유스케이스가 성공한 번들만 artifact store에 넘깁니다.
7. store가 다른 revision을 삭제하지 않고 내용 해시 디렉터리에 파일을 모두 쓴 뒤 opaque URI를 반환합니다.
8. 컨트롤러가 URI를 `asWebviewUri`로 바꾸고 최신 revision인지 확인합니다.
9. HTML factory가 외부 JS/CSS와 제한된 CSP를 포함한 완전한 문서를 만듭니다.
10. 최신 HTML을 반영한 뒤에만 store가 현재 해시를 제외한 이전 생성물을 정리합니다.

store는 publish, prune, shutdown을 하나의 직렬 Promise queue에서 처리합니다. 각 publish에는
호출 순서가 기록되므로 오래된 revision의 prune은 그 뒤에 게시된 디렉터리를 삭제하지 않습니다.
확장 종료 시에는 controller를 먼저 중지하고 queue가 끝난 다음 세션 디렉터리 삭제를 기다립니다.

컴파일러 port는 stateless `compile(request)`로 시작합니다. 향후 성능 측정 결과가 필요하면 같은
port 뒤에서 esbuild `context.rebuild()` 세션을 캐시할 수 있으며 application과 UI는 바뀌지
않습니다.

## 보안 경계

확장 manifest와 명령 handler가 모두 Workspace Trust를 검사합니다. `localResourceRoots`는 전역
저장소 전체가 아닌 현재 확장 창의 UUID 세션 디렉터리만 허용합니다. 생성된 스크립트는 외부
ES module로 로드하며 inline script, nonce 우회, `eval`, `unsafe-eval`을 사용하지 않습니다.

웹뷰 CSP는 다음을 기본 차단합니다.

- `connect-src 'none'`: fetch, WebSocket 등 외부 연결
- `worker-src 'none'`: worker 실행
- `frame-src 'none'`: iframe 삽입
- `base-uri 'none'`: 상대 URL 기준 변경
- `form-action 'none'`: 폼 제출

진단, 경로, 파일 이름, URI는 HTML text/attribute 문맥에서 escape합니다. 현재 웹뷰는 extension에
메시지를 보내지 않으므로 사용자 번들이 명령이나 파일 작업을 요청할 통로도 없습니다.
`deactivate()`는 번들된 워크스페이스 소스가 global storage에 남지 않도록 세션 삭제를 await합니다.

## 확장 지점

- 새 컴파일러: `PreviewCompiler` 구현 추가
- 새 artifact 저장 방식: `PreviewArtifactStore` 구현 추가
- 새 파일 형식: `previewTarget` 매핑과 compiler loader를 함께 확장
- props/context 공급: 가상 엔트리 생성 전략을 별도 port로 추출
- 증분 빌드: compiler 내부 session/context 구현 추가
- 런타임 이벤트: 검증 가능한 discriminated-union 메시지 protocol을 domain에 추가

추상화는 미리 모든 가능성을 일반화하지 않습니다. 두 구현이 필요하거나 외부 시스템이 바뀌는
지점이 확인될 때 port를 확장합니다.

## 테스트 경계

- `test/domain`: 파일 정책 같은 순수 규칙
- `test/application`: in-memory port를 이용한 side-effect 순서
- `test/adapters/esbuild`: 실제 React/TSX/CSS 번들과 미저장 overlay
- `test/presentation`: CSP와 동적 HTML escape
- `test/fixtures`: 실제 컴파일 입력이며 배포물에는 포함하지 않음

Extension Host 통합 테스트는 패널을 관찰할 안정적인 test seam을 추가할 때 별도 suite로 둡니다.
현재 빠른 suite는 서버 없는 컴파일 경로와 가장 중요한 보안 문자열을 직접 검증합니다.

## 배포 제약

확장 자체는 Node 20 호환 CommonJS로 번들링하지만 `vscode`와 런타임 `esbuild`는 external로
남깁니다. esbuild 네이티브 바이너리 때문에 공개 배포에서는 VS Code가 지원하는 target별 VSIX를
생성해야 합니다. `esbuild-wasm`은 단일 패키지 대안이지만 초기 목표인 빠른 편집 피드백에는
사용하지 않습니다. `package-vsix.mjs`는 현재 호스트의 target을 manifest에 기록하고, 설치된
네이티브 바이너리와 다른 플랫폼으로의 교차 패키징을 거부합니다.
