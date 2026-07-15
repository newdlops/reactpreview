# Marketplace 배포 가이드

이 문서는 `newdlops.react-file-preview`를 Visual Studio Marketplace에 배포하는 유지관리자 절차를
정의합니다. 런타임 esbuild가 네이티브 바이너리를 사용하므로 범용 VSIX 하나를 만들지 않고
운영체제·CPU·Linux libc별 VSIX를 각각 게시합니다.

## 변경할 수 없는 식별자 확인

Marketplace publisher ID는 GitHub 또는 Microsoft 계정 이름과 별개의 식별자입니다. 배포 전에
[Publisher 관리 페이지](https://marketplace.visualstudio.com/manage/publishers/)에서 다음을 직접
확인합니다.

- Publisher ID가 정확히 `newdlops`이고 현재 Microsoft 계정이 Owner 또는 Contributor입니다.
- `react-file-preview` extension name과 `React File Preview` display name을 사용할 수 있습니다.
- manifest의 최종 extension ID가 `newdlops.react-file-preview`입니다.

Publisher ID는 생성 뒤 변경할 수 없고 삭제한 extension name도 다시 사용할 수 없으므로 최초
업로드 전에 철자와 소유권을 확인합니다. 저장소의 `package.json.publisher`는 `newdlops`로
고정되어 있습니다.

공식 절차는 [Create a publisher](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#create-a-publisher)를
참고합니다.

## 배포 전 사용자 문서

Marketplace 상세 페이지는 저장소 루트의 `README.md`를 사용합니다. 릴리스마다 다음 문서가 실제
동작과 일치하는지 확인합니다.

- `README.md`: 설치, 사용법, 요구사항, 지원 범위, 보안과 개인정보
- `CHANGELOG.md`: 사용자에게 영향을 주는 현재 버전의 변경사항
- `SUPPORT.md`: 일반 문제와 기능 요청 경로
- `SECURITY.md`: 취약점 비공개 제보 경로와 지원 버전
- `LICENSE`: 배포물의 MIT 라이선스

README나 CHANGELOG에 이미지를 추가한다면 HTTPS URL 또는 공개 GitHub 저장소에서 변환 가능한
상대경로를 사용합니다. Marketplace는 사용자 제공 SVG icon을 거부하므로 manifest icon은
`assets/icon.png`인 256×256 PNG입니다. 요구사항은 [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)와
[Marketplace integration](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#marketplace-integration)을
기준으로 합니다.

## 버전 준비

1. `package.json.version`을 SemVer `major.minor.patch` 형식으로 명시적으로 수정합니다.
2. 같은 버전 제목을 `CHANGELOG.md`에 추가하고 릴리스 날짜를 기록합니다.
3. 지원 범위, 설정, 보안 설명이 현재 코드와 일치하는지 확인합니다.
4. 깨끗한 checkout에서 의존성을 설치하고 전체 검사를 실행합니다.

```bash
nvm use
npm install
npm run check
```

이 저장소는 1,000줄 제한을 생성 텍스트에도 적용하므로 npm lockfile을 만들지 않습니다. 직접
의존성 버전은 `package.json`에 정확히 고정되어 있지만, 릴리스 후보는 반드시 깨끗한 환경에서
재설치하고 테스트해야 합니다.

`vsce publish patch|minor|major`는 package.json 수정뿐 아니라 git commit과 tag를 자동으로 만들
수 있습니다. 이 프로젝트에서는 버전 변경과 검토를 분리하기 위해 자동 증가 명령을 사용하지
않고 준비된 VSIX를 `--packagePath`로 게시합니다.

## 플랫폼별 VSIX 생성

`scripts/package-vsix.mjs`는 현재 호스트와 설치된 esbuild 네이티브 패키지를 감지합니다. 요청한
target이 현재 호스트와 다르면 패키징을 중단하므로 각 target과 일치하는 runner 또는 컨테이너에서
다음 명령을 실행합니다.

```bash
npm install
npm run package:vsix
```

생성 파일은 `react-file-preview-<version>-<target>.vsix`입니다.

| Target         | 필요한 빌드 환경           | 주요 사용처                       |
| -------------- | -------------------------- | --------------------------------- |
| `darwin-x64`   | Intel macOS                | Intel Mac 로컬 extension host     |
| `darwin-arm64` | Apple Silicon macOS        | Apple Silicon 로컬 extension host |
| `win32-x64`    | x64 Windows                | 일반 Windows 로컬 extension host  |
| `win32-arm64`  | ARM64 Windows              | ARM Windows 로컬 extension host   |
| `linux-x64`    | glibc x64 Linux            | Linux, Remote SSH, Dev Container  |
| `linux-arm64`  | glibc ARM64 Linux          | ARM 서버와 Remote 환경            |
| `linux-armhf`  | glibc ARM hard-float Linux | 32-bit ARM 원격 환경              |
| `alpine-x64`   | musl x64 Linux             | x64 Alpine Dev Container          |
| `alpine-arm64` | musl ARM64 Linux           | ARM64 Alpine Dev Container        |

`web` target은 Node와 네이티브 esbuild를 사용할 수 없고 이 확장도 가상 워크스페이스를 지원하지
않으므로 게시하지 않습니다. 모든 target을 한 호스트에서 `vsce publish --target ...`으로 만들면
현재 호스트의 네이티브 바이너리가 잘못 포함될 수 있으므로 사용하지 않습니다.

최초 Preview 배포에서 지원할 target을 줄이려면 실제로 빌드·설치 검증한 target만 게시하고,
README에 지원 플랫폼을 명시합니다. `extensionKind: ["workspace"]`이므로 Remote 사용자를
지원하려면 최소한 주요 Linux target도 별도로 게시해야 합니다.

공식 target 목록과 동작은 [Platform-specific extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions)를
참고합니다.

## 패키지 검수

각 VSIX에서 다음을 확인합니다.

```bash
unzip -l react-file-preview-<version>-<target>.vsix
unzip -p react-file-preview-<version>-<target>.vsix extension.vsixmanifest
code --install-extension react-file-preview-<version>-<target>.vsix --force
```

검수 기준:

- manifest의 `Publisher`가 `newdlops`, `TargetPlatform`이 파일명의 target과 같습니다.
- `assets/icon.png`, README, CHANGELOG, LICENSE, SUPPORT, SECURITY가 포함됩니다.
- `src`, `test`, `scripts`, source map, `.git`, `.github`, `.lh`, 로컬 상태 파일은 없습니다.
- `node_modules/@esbuild/<target>`에는 target과 일치하는 네이티브 실행 파일 하나만 있습니다.
- 설치한 Extension Development Host 또는 별도 VS Code 프로필에서 예제 TSX가 렌더링됩니다.
- 네트워크 listener나 개발 서버 프로세스가 생기지 않습니다.

## 최초 수동 인증과 게시

### 2026년 12월 1일 이전의 전환용 PAT

2026년 7월 현재 PAT를 통한 수동 게시가 가능하지만 Azure DevOps Global PAT는 2026년 12월 1일
종료됩니다. 신규 자동화에는 PAT를 사용하지 말고 다음 절의 Microsoft Entra ID 방식을 준비합니다.

전환 기간에 최초 수동 게시를 해야 한다면 Azure DevOps에서 다음 최소 범위로 PAT를 만듭니다.

- Organization: `All accessible organizations`
- Scopes: `Custom defined` → `Show all scopes` → `Marketplace (Manage)`
- Expiration: 최초 게시에 필요한 가장 짧은 기간

PAT를 명령 인자, shell history, 저장소, 이슈, 로그 또는 문서에 기록하지 않습니다. 로컬 credential
store에서 다음 명령으로 확인하고 프롬프트에만 입력합니다.

```bash
npm exec -- vsce login newdlops
```

검수한 각 VSIX를 같은 버전으로 순서대로 게시합니다.

```bash
npm exec -- vsce publish --packagePath react-file-preview-<version>-<target>.vsix
```

또는 Publisher 관리 페이지에서 VSIX를 수동 업로드할 수 있습니다. 일부 target 게시가 실패하면
성공한 패키지를 삭제하지 말고 원인을 수정한 뒤 누락된 같은 버전·target만 다시 게시합니다.

공식 PAT 설정은 [Get a Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)을
따릅니다.

### 장기 자동 배포: Microsoft Entra ID

Microsoft는 workload identity federation과 managed identity를 이용한 secret 없는 자동 배포를
권장합니다. Azure DevOps 서비스 연결과 user-assigned managed identity를 연동하고, Publisher
관리 페이지에서 해당 identity를 `newdlops` publisher의 Contributor로 추가합니다. Pipeline은
Azure CLI로 Entra access token을 얻은 뒤 다음 명령을 실행합니다.

```bash
npm exec -- vsce publish --azure-credential --packagePath <verified-vsix>
```

Tenant, subscription, managed identity resource ID와 서비스 연결 이름은 계정별 값이므로 저장소에
예시 secret을 커밋하지 않습니다. 실제 설정은 [Secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)을
그대로 따릅니다.

## 게시 후 확인

1. Marketplace에서 publisher, 아이콘, Preview 표시, README, 라이선스와 지원 링크를 확인합니다.
2. 각 target의 VS Code에서 `newdlops.react-file-preview`를 새로 설치합니다.
3. `examples/HelloPreview.tsx`와 별도 React 18 프로젝트에서 열기·편집·오류·새로고침을 확인합니다.
4. Remote 지원 target은 실제 Remote SSH 또는 Dev Container extension host에서 확인합니다.
5. Git tag와 GitHub Release를 같은 버전으로 만들고 검수된 VSIX와 변경 기록을 첨부합니다.
6. Publisher 보고서에서 설치 실패나 특정 target 누락을 관찰합니다.

## 실패와 롤백

- 잘못된 target만 누락됐다면 해당 target의 같은 버전을 올바른 호스트에서 다시 패키징해 게시합니다.
- 심각한 결함은 수정 버전을 올려 배포하고 CHANGELOG에 영향과 해결을 기록합니다.
- 노출을 중단해야 하면 Publisher 관리 페이지에서 `Unpublish`를 우선 사용합니다.
- `Remove`는 통계와 버전을 영구 삭제하며 extension name을 다시 사용할 수 없으므로 일반 롤백에
  사용하지 않습니다.
- PAT나 다른 secret이 노출되면 즉시 폐기하고 git history와 CI log의 노출 범위를 조사합니다.

## 릴리스 체크리스트

- [ ] `newdlops` Publisher 소유권과 extension name을 확인했다.
- [ ] package version과 CHANGELOG 날짜가 일치한다.
- [ ] README, SUPPORT, SECURITY, LICENSE가 현재 동작과 일치한다.
- [ ] `npm run check`가 깨끗한 설치에서 통과한다.
- [ ] 게시할 모든 target의 VSIX를 해당 환경에서 생성했다.
- [ ] 각 VSIX의 target, 파일 목록, esbuild binary와 icon을 확인했다.
- [ ] 각 VSIX 설치 후 React 프리뷰 smoke test를 통과했다.
- [ ] secret을 저장소, 명령 인자와 log에 남기지 않았다.
- [ ] 같은 version의 모든 target을 게시했다.
- [ ] Marketplace 표시와 신규 설치를 다시 확인했다.
