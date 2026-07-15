<p align="center">
  <img src="assets/icon.png" alt="React File Preview 아이콘" width="128" height="128">
</p>

# React File Preview

현재 편집 중인 React 파일을 VS Code 웹뷰에서 바로 렌더링하는 경량 확장입니다. 별도 백엔드,
프론트엔드 개발 서버, HTTP 포트, 프로젝트 빌드 명령 없이 저장 전 편집 내용까지 미리 봅니다.

> 현재 `0.1.x`는 Preview 릴리스입니다. 기본 내보내기 컴포넌트를 빠르게 확인하는 범위에
> 집중하며, 프레임워크 전체 실행 환경을 재현하지 않습니다.

## 설치

Marketplace 공개 후 VS Code의 Extensions 화면에서 `React File Preview`를 검색하거나 다음 명령을
사용합니다.

```bash
code --install-extension newdlops.react-file-preview
```

검토용 플랫폼별 VSIX가 있다면 Extensions 화면의 `Install from VSIX...` 또는 다음 명령으로
설치할 수 있습니다.

```bash
code --install-extension react-file-preview-0.1.0-<platform>.vsix
```

## 사용 방법

1. React 18 이상이 설치된 신뢰할 수 있는 워크스페이스를 엽니다.
2. 기본 내보내기를 제공하는 `.tsx`, `.jsx`, `.ts`, `.js` 파일을 엽니다.
3. 명령 팔레트에서 `React Preview: Open Current React File`을 실행합니다.
4. 코드를 편집하면 설정된 지연 시간 뒤 프리뷰가 자동으로 갱신됩니다.

패널이 열린 상태에서 `React Preview: Refresh`를 실행하면 즉시 다시 빌드합니다. 저장하지 않은
현재 파일의 내용이 디스크에 저장된 내용보다 우선합니다.

## 요구사항

- VS Code 1.96 이상
- React 18 이상과 `react-dom/client`가 설치된 대상 프로젝트
- React 컴포넌트 또는 React 엘리먼트인 기본 내보내기
- 로컬 파일 워크스페이스 또는 VS Code Remote의 workspace extension host
- Workspace Trust가 허용된 워크스페이스

가상 워크스페이스와 VS Code for Web은 지원하지 않습니다. Remote SSH, Dev Container,
Codespaces에서는 확장이 원격 호스트에 설치되므로 해당 운영체제·CPU용 패키지가 필요합니다.

## 동작 방식

```text
활성 TextDocument 스냅샷
  → application/BuildPreview
  → adapters/esbuild (브라우저 번들, write:false)
  → adapters/vscode (globalStorageUri의 해시 캐시)
  → presentation/webview (asWebviewUri + 제한된 CSP)
```

- esbuild의 `serve()`나 다른 서버 API를 호출하지 않습니다.
- 현재 파일과 도달 가능한 dirty 참조 파일의 저장 전 내용은 esbuild overlay가 우선 사용합니다.
- default-only bridge가 렌더 대상과 무관한 named export graph를 결과에서 제거합니다.
- React와 ReactDOM은 대상 프로젝트에 설치된 하나의 복사본을 번들링합니다.
- 생성된 JS/CSS는 인라인 코드나 `eval`이 아니라 외부 로컬 리소스로 로드합니다.
- revision 번호가 늦게 끝난 과거 빌드의 화면 반영을 막습니다.
- 마지막 성공 빌드의 의존 파일이 저장되면 프리뷰를 다시 만듭니다.

자세한 책임과 의존 방향은 [아키텍처 문서](docs/architecture.md)를 참고하세요.

## 지원 범위

지원하는 항목:

- `.tsx`, `.jsx`, `.ts`, `.js` 기본 내보내기 컴포넌트
- 현재 파일과 import된 `.js` 컴포넌트의 JSX 문법
- 일반 CSS와 CSS Modules
- import된 일반 이미지·폰트·오디오·비디오·PDF asset의 제한된 data URL
- SVG URL, `<img>` 기반 `{ ReactComponent }`/`?react`와 UTF-8 `?raw` import
- 현재 파일과 열려 있는 참조 컴포넌트의 저장 전 편집 내용
- 표준 tsconfig alias와 명시적으로 선택한 tsconfig/jsconfig
- symlink 경로, 확장자 없는 순환 import와 의존 파일 저장 감지
- 컴파일 오류, 모듈 해석 오류, React 렌더 오류 표시

초기 버전에서 의도적으로 지원하지 않는 항목:

- Next.js SSR/RSC와 서버 전용 모듈
- Vite, Webpack, Babel 플러그인이나 프로젝트 빌드 명령 재사용
- Sass, Less, Tailwind 전처리와 SVGR 고급 변환 옵션·인라인 SVG DOM 조작
- `/public/...` 절대경로와 자동 라우터·context·props 모킹
- Node 내장 모듈, Web Worker, 외부 API 요청
- 기본 내보내기가 없는 파일

서버 없이 메모리에서만 처리하는 경량 프리뷰이므로 인라인 asset은 파일당 5 MiB, 한 빌드에서
합계 20 MiB까지 허용하며 최종 JS/CSS 출력은 32 MiB로 제한합니다. 더 큰 미디어는 실제 앱의
정적 파일 제공 경로에서 확인해 주세요.

## 설정

| 설정                       | 기본값 | 범위         | 설명                                         |
| -------------------------- | ------ | ------------ | -------------------------------------------- |
| `reactPreview.updateDelay` | `300`  | `100`–`2000` | 편집 후 자동 갱신까지 기다릴 밀리초입니다.   |
| `reactPreview.tsconfig`    | `""`   | 상대경로     | 비표준 alias용 tsconfig/jsconfig 경로입니다. |

## 보안과 개인정보

이 확장은 대상 프로젝트의 소스와 `node_modules`를 실제 브라우저 코드로 실행하므로 신뢰된
워크스페이스에서만 활성화됩니다. 웹뷰의 로컬 접근 범위는 현재 세션 생성물로 제한되며 CSP가
네트워크 연결, 프레임, 워커, 폼, 인라인 스크립트와 `unsafe-eval`을 차단합니다. React의 `style`
속성과 CSS-in-JS 호환성을 위해 스타일에만 `unsafe-inline`을 허용합니다.

확장은 텔레메트리를 수집하거나 외부 서버로 데이터를 보내지 않습니다. Vite/Next/Webpack 설정,
package script와 `.env` 파일을 실행하거나 읽지 않으며 사용자 프로젝트에도 결과 파일을 쓰지
않습니다. 생성된 번들은 VS Code global storage의 세션 디렉터리에만 저장되고 확장 종료 시
삭제합니다. 보안 문제는 [보안 정책](SECURITY.md)에 따라 공개 이슈가 아닌 비공개 경로로
제보해 주세요.

## 문제 해결

| 증상                              | 확인할 내용                                                          |
| --------------------------------- | -------------------------------------------------------------------- |
| React 모듈을 찾지 못함            | 대상 워크스페이스에 React 18 이상과 ReactDOM이 설치됐는지 확인       |
| 기본 내보내기 오류                | 현재 파일이 컴포넌트 또는 React 엘리먼트를 default export하는지 확인 |
| 프레임워크 전용 import 오류       | 현재 지원 범위에 없는 Vite/Next/Webpack 플러그인 문법인지 확인       |
| Restricted Mode에서 실행되지 않음 | 워크스페이스 내용을 검토한 뒤 신뢰 여부를 직접 결정                  |
| Remote 환경에서 설치할 수 없음    | 원격 운영체제와 CPU용 Marketplace 패키지가 게시됐는지 확인           |

재현 가능한 일반 오류와 기능 요청은 [GitHub Issues](https://github.com/newdlops/reactpreview/issues)에
등록해 주세요. 로그에 프로젝트 비밀값이나 전체 비공개 소스를 첨부하지 마세요. 자세한 정보는
[지원 정책](SUPPORT.md)에 있습니다.

## 개발

필요한 개발 환경은 Node.js 22.13 이상과 VS Code 1.96 이상입니다.

```bash
nvm use
npm install
npm run check
```

VS Code에서 `F5`를 누른 뒤 개발 호스트에서 `examples/HelloPreview.tsx`를 열어 프리뷰 명령을
실행합니다. 개발 명령, 계층 선택과 완료 조건은 [기여 지침](CONTRIBUTING.md)에 있습니다.

배포 담당자는 [Marketplace 배포 가이드](docs/publishing.md)의 publisher 생성, 플랫폼별 VSIX,
인증 전환과 검증 절차를 따라야 합니다.

## 프로젝트 규칙

1. 사람이 관리하는 파일은 주석과 빈 줄을 포함해 1,000줄을 넘지 않습니다.
2. 폴더는 domain → application → adapter/presentation의 책임으로 나눕니다.
3. 안쪽 계층은 바깥 계층이나 VS Code/esbuild 구현을 import하지 않습니다.
4. 축약보다 의도를 드러내는 이름과 작은 단위의 코드를 사용합니다.
5. 컴파일러와 저장소처럼 실제로 교체 가능한 경계에 인터페이스를 둡니다.
6. 새 파일 형식, 컴파일러, 저장소, UI 상태를 기존 핵심 규칙 수정 없이 추가할 수 있게 합니다.
7. 소스 파일 상단과 모든 함수·클래스에는 책임, 입력, 출력, 오류, 부작용을 설명합니다.

## 라이선스

[MIT License](LICENSE) · Publisher: `newdlops`
