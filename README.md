# React File Preview

현재 편집 중인 React 파일을 VS Code 웹뷰에서 바로 렌더링하는 경량 확장입니다. 별도 백엔드,
프론트엔드 개발 서버, HTTP 포트, 프로젝트 빌드 명령을 사용하지 않습니다. 확장 호스트에서
현재 문서를 브라우저 번들로 변환하고, VS Code가 관리하는 로컬 저장소의 결과만 격리된
웹뷰가 읽습니다.

현재 저장소는 실행 가능한 초기 MVP 골격입니다. `.tsx`, `.jsx`, `.ts`, `.js` 파일의 기본
내보내기(default export)가 React 컴포넌트이거나 React 엘리먼트라고 가정합니다.

## 빠른 시작

필요한 개발 환경은 Node.js 22.13 이상과 VS Code 1.96 이상입니다.

```bash
nvm use
npm install
npm run check
```

VS Code에서 `F5`를 누르면 Extension Development Host가 열립니다. 개발 호스트에서 React
프로젝트의 컴포넌트를 열거나 이 저장소의 `examples/HelloPreview.tsx`를 연 뒤 명령 팔레트에서
`React Preview: Open Current React File`을 실행합니다. 열린 프리뷰는 활성 파일과 저장 전
편집 내용을 따라갑니다.

## 동작 방식

```text
활성 TextDocument 스냅샷
  → application/BuildPreview
  → adapters/esbuild (브라우저 번들, write:false)
  → adapters/vscode (globalStorageUri의 해시 캐시)
  → presentation/webview (asWebviewUri + 제한된 CSP)
```

- esbuild의 `serve()`나 다른 서버 API는 호출하지 않습니다.
- 현재 파일의 저장 전 내용은 esbuild `onLoad` 오버레이가 디스크보다 우선 사용합니다.
- React와 ReactDOM은 대상 프로젝트에 설치된 하나의 복사본을 번들링합니다.
- 생성된 JS/CSS는 인라인 코드나 `eval`이 아니라 외부 로컬 리소스로 로드합니다.
- 새 편집이 이전 빌드보다 먼저 끝나더라도 revision 번호가 오래된 결과 반영을 막습니다.
- 마지막 성공 빌드의 의존 파일이 저장되면 프리뷰를 다시 만듭니다.

자세한 책임과 의존 방향은 [아키텍처 문서](docs/architecture.md)를 참고하세요.

## 현재 지원 범위

지원하는 항목:

- React 18 이상과 `react-dom/client`
- `.tsx`, `.jsx`, `.ts`, `.js` 기본 내보내기 컴포넌트
- 현재 `.js` 문서 안의 JSX 문법
- 일반 CSS와 CSS Modules
- import된 PNG, JPEG, GIF, SVG, WebP, AVIF 및 기본 웹 폰트
- 현재 파일의 저장 전 편집 내용
- symlink 경로로 연 현재 파일과 의존 파일 저장 감지
- 컴파일 오류, 모듈 해석 오류, React 렌더 오류 표시
- 로컬 워크스페이스와 VS Code Remote의 workspace 확장 호스트

초기 버전에서 의도적으로 지원하지 않는 항목:

- Next.js SSR/RSC와 서버 전용 모듈
- Vite, Webpack, Babel 플러그인이나 프로젝트 빌드 명령 재사용
- Sass, Less, Tailwind 전처리와 SVGR 전용 import 문법
- `/public/...` 절대경로와 자동 라우터·context·props 모킹
- Node 내장 모듈, Web Worker, 외부 API 요청
- 기본 내보내기가 없는 파일
- 가상 워크스페이스와 VS Code for Web

## 보안 모델

이 확장은 프로젝트 소스와 `node_modules`를 실제 브라우저 코드로 실행하므로 신뢰된
워크스페이스에서만 활성화됩니다. 웹뷰의 로컬 접근 범위는 현재 세션의 생성물 디렉터리로
제한됩니다. CSP는 네트워크 연결, 프레임, 워커, 폼, 인라인 스크립트, `unsafe-eval`을 막습니다.
React의 `style` 속성과 CSS-in-JS 호환성을 위해 스타일에만 `unsafe-inline`을 허용합니다.

대상 프로젝트의 Vite/Next/Webpack 설정, package script, `.env` 파일은 실행하거나 읽지
않습니다. 사용자 프로젝트 안에도 결과 파일을 쓰지 않습니다.

## 개발 명령

| 명령                   | 역할                                                   |
| ---------------------- | ------------------------------------------------------ |
| `npm run build`        | 확장 호스트 코드를 개발용으로 번들링                   |
| `npm run watch`        | 타입 검사와 확장 번들을 동시에 감시                    |
| `npm run typecheck`    | strict TypeScript 검사                                 |
| `npm run lint`         | 문서화, 가독성, 1,000줄 제한, 계층 규칙 검사           |
| `npm run format`       | Prettier로 유지보수 대상 파일 정리                     |
| `npm test`             | 순수 로직과 실제 esbuild 컴파일 테스트                 |
| `npm run check`        | 줄 수, 타입, 린트, 포맷, 테스트, 빌드를 한 번에 검증   |
| `npm run package:vsix` | 검증 후 현재 호스트와 일치하는 target 태그의 VSIX 생성 |

런타임 esbuild에는 플랫폼별 네이티브 바이너리가 포함됩니다. 패키징 스크립트는 현재 호스트와
다른 target을 거부해 잘못된 범용 VSIX 생성을 막습니다. 마켓플레이스 배포 단계에서는 Windows,
macOS, Linux runner가 각각 `npm install && npm run package:vsix`를 실행해야 합니다.

## 프로젝트 규칙

모든 사람이 유지할 수 있는 구조를 위해 다음을 자동 검사와 리뷰 기준으로 사용합니다.

1. 사람이 관리하는 파일은 주석과 빈 줄을 포함해 1,000줄을 넘지 않습니다.
2. 폴더는 domain → application → adapter/presentation의 책임으로 나눕니다.
3. 안쪽 계층은 바깥 계층이나 VS Code/esbuild 구현을 import하지 않습니다.
4. 축약보다 의도를 드러내는 이름과 작은 단위의 코드를 사용합니다.
5. 컴파일러와 저장소처럼 실제로 교체 가능한 경계에 인터페이스를 둡니다.
6. 새 파일 형식, 컴파일러, 저장소, UI 상태를 기존 핵심 규칙 수정 없이 추가할 수 있게 합니다.
7. 소스 파일 상단과 모든 함수·클래스에는 책임, 입력, 출력, 오류, 부작용을 설명합니다.

세부 기여 기준과 완료 조건은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.
