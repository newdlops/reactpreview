# 보안 정책

React File Preview는 워크스페이스 코드를 브라우저 번들로 만들어 VS Code 웹뷰에서 실행합니다.
프로젝트는 이 경계를 보안에 민감한 기능으로 취급합니다.

## 지원 버전

Preview 기간에는 Marketplace에 공개된 최신 버전에만 보안 수정이 제공됩니다. 보안 수정이
배포되면 CHANGELOG에 영향받는 버전과 갱신 방법을 기록합니다.

## 취약점 제보

취약점 세부사항을 공개 GitHub Issue, Discussion, 로그 또는 pull request에 올리지 마세요.
[GitHub Private Vulnerability Reporting](https://github.com/newdlops/reactpreview/security/advisories/new)을
사용해 다음 정보를 전달합니다.

- 영향받는 extension과 VS Code 버전
- 로컬 또는 Remote 실행 환경과 운영체제·CPU
- 재현에 필요한 최소 단계와 입력
- 예상되는 보안 영향과 공격 전제조건
- 알려진 완화 방법

Private Vulnerability Reporting 페이지가 아직 활성화되지 않았다면 공개 이슈에는 세부사항을
기록하지 말고, 최소한의 제목으로 비공개 연락 경로를 요청해 주세요. 유지관리자는 공개 배포 전에
GitHub repository 설정에서 이 기능을 활성화해야 합니다.

## 중요한 보안 불변식

- 신뢰되지 않은 워크스페이스에서는 확장을 실행하지 않습니다.
- 사용자 워크스페이스에 생성물을 쓰거나 package script와 개발 서버를 실행하지 않습니다.
- 전역 dependency store는 versioned extension React seed, 성공한 browser bundle에 도달한 package, 또는
  지원되는 npm/Yarn lock evidence가 exact dependency closure를 증명한 public package만 content-hashed immutable
  layer로 저장합니다. project-local/PnP resolution, lock-proven layer, compatible seed 순서를 지키고 재사용 전
  package bytes를 다시 검증합니다.
- React seed catalog는 VSIX에 포함된 exact React/ReactDOM/Scheduler 18/19 tuple만 사용합니다. local runtime의
  절반이라도 있거나 lock-proven core runtime이 있으면 seed를 섞지 않고, manifest range가 호환되는 경우에만
  extension byte를 global storage에 복사합니다. 이 경로는 workspace를 수정하거나 lock 없는 임의 package를
  network에서 획득하지 않습니다.
- 설치 없는 획득은 npm `package-lock.json` v2/v3, Yarn v1의 exact SHA-512 lock entry, 또는 Yarn Berry의 exact
  `npm:` resolution과 public registry exact-version metadata로 제한합니다. Berry cache checksum을 tarball
  integrity로 사용하지 않습니다. 따라서 Berry 경로는 lock 시점 tar bytes가 아니라 획득 시점의 public npm
  registry metadata를 신뢰하며, exact name/version 고정과 전송 중 변조 검증만 제공합니다. Package manager와 install/lifecycle script를 실행하지 않고 tar path
  traversal, link와 특수 entry를 거부합니다. 모든 archive가 closure 공용 40,000-entry/256-MiB payload
  preflight를 통과하기 전에는 하나도 추출하지 않으며 workspace에는 쓰지 않습니다. pnpm lock, private/custom registry,
  git/file/link/workspace package와 SHA-512 근거가 없는 package는 fail closed합니다.
- 웹뷰의 로컬 리소스 범위는 현재 session artifact directory로 제한합니다.
- CSP는 네트워크, worker, frame, form, inline script와 `unsafe-eval`을 차단합니다.
- 확장은 텔레메트리, workspace source, preview payload나 credential을 외부로 보내지 않습니다. 위 조건을
  만족하는 missing package가 있을 때 extension worker가 public tarball과 Berry의 exact-version metadata만
  요청하며, registry에는 통상적인 IP·HTTP metadata와 요청 package가 보일 수 있습니다. 웹뷰의 network
  차단은 유지됩니다.
- 종료 시 workspace source를 포함할 수 있는 session artifact 삭제를 기다립니다. Source를 포함하지 않는
  immutable dependency environment만 별도 quota/LRU 저장소에 유지합니다.

Lockfile integrity는 받은 bytes가 lockfile과 같은지를 증명하지만 package 코드가 안전하다는 뜻은 아닙니다.
프리뷰에 도달한 dependency는 프로젝트 source와 함께 웹뷰에서 실행되므로 Workspace Trust와 원래 프로젝트의
supply-chain 검토를 대체하지 않습니다. 의심되는 lockfile이나 dependency가 있는 workspace에서는 프리뷰를
실행하지 마세요.

이 불변식을 약화하는 변경은 보안 검토와 해당 경계의 회귀 테스트가 필요합니다.
