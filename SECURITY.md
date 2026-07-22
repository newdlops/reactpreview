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
- 전역 dependency store는 성공한 browser bundle에 도달하고 bounded lock evidence가 있는 public package만
  content-hashed immutable layer로 저장합니다. 재사용 전 package bytes를 검증하고 registry 요청이나 install
  script를 실행하지 않으며, local project resolution을 항상 우선합니다.
- 웹뷰의 로컬 리소스 범위는 현재 session artifact directory로 제한합니다.
- CSP는 네트워크, worker, frame, form, inline script와 `unsafe-eval`을 차단합니다.
- 확장은 텔레메트리나 외부 데이터 전송 기능을 포함하지 않습니다.
- 종료 시 workspace source를 포함할 수 있는 session artifact 삭제를 기다립니다. Source를 포함하지 않는
  immutable dependency environment만 별도 quota/LRU 저장소에 유지합니다.

이 불변식을 약화하는 변경은 보안 검토와 해당 경계의 회귀 테스트가 필요합니다.
