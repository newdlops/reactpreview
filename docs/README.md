# React File Preview 문서

Marketplace의 제품 소개에서 다루지 않는 상세 사용법, 프로젝트별 설정, 호환 범위와 유지관리 문서를
이곳에서 관리합니다.

## 처음 사용하는 경우

1. [상세 사용자 가이드](user-guide.md)에서 두 프리뷰 모드와 Page Inspector의 기본 흐름을 확인합니다.
2. 대상 프로젝트에 특별한 Provider, route, theme 또는 업무 데이터가 필요하면
   [프로젝트 setup 가이드](project-setup.md)를 확인합니다.
3. 지원되는 파일·스타일·런타임과 의도적인 제한은 [호환성과 제한](compatibility.md)에서 확인합니다.
4. 오류가 계속되면 [지원 정책과 문제 해결](../SUPPORT.md)에 따라 진단 정보를 수집합니다.

## 사용자 문서

| 문서                                      | 내용                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| [상세 사용자 가이드](user-guide.md)       | 설치, 프리뷰 모드, Inspector, 데이터와 갱신 흐름          |
| [호환성과 제한](compatibility.md)         | React 버전, 파일·스타일·자산·프레임워크 지원 범위         |
| [프로젝트 setup 가이드](project-setup.md) | Provider, props, route, theme, Redux, Formik, Apollo 구성 |
| [지원 정책](../SUPPORT.md)                | 문제 해결 순서, 이슈에 포함할 진단 정보                   |
| [변경 기록](../CHANGELOG.md)              | 릴리스별 사용자 영향과 수정 사항                          |
| [보안 정책](../SECURITY.md)               | 지원 버전, 비공개 취약점 제보와 보안 불변식               |

## 상황별 빠른 연결

- 페이지가 열렸지만 현재 파일이 보이지 않음:
  [페이지 경로와 현재 파일 찾기](user-guide.md#페이지-경로와-현재-파일-찾기)
- props, Context 또는 hook 때문에 렌더링이 중단됨:
  [블로커 해결](user-guide.md#블로커-해결)
- API나 GraphQL 데이터가 필요함:
  [Payload와 Virtual Backend](user-guide.md#payload와-virtual-backend)
- 실제 업무 상태와 Provider를 고정해야 함:
  [프로젝트 setup 계약](project-setup.md#setup-계약)
- 스타일 또는 정적 자산이 다르게 보임:
  [스타일과 자산](compatibility.md#스타일과-자산)
- 빌드·런타임 오류를 제보하려 함:
  [지원 정책](../SUPPORT.md#함께-제공할-정보)

## 유지관리자 문서

| 문서                                   | 내용                                         |
| -------------------------------------- | -------------------------------------------- |
| [아키텍처](architecture.md)            | 계층, 빌드 흐름, 런타임 경계와 보안 불변식   |
| [기여 지침](../CONTRIBUTING.md)        | 코드 기준, 변경 절차와 완료 조건             |
| [Marketplace 배포](publishing.md)      | 문서 경계, 플랫폼별 VSIX, 게시와 사후 확인   |
| [이전 변경 기록](changelog-archive.md) | 루트 변경 기록에서 분리된 오래된 릴리스 이력 |

## 문서 배치 원칙

- 루트 `README.md`는 Marketplace에서 바로 읽을 수 있는 특징과 사용법만 담습니다.
- 사용자에게 필요한 상세 설명은 `docs/`, `SUPPORT.md`, `SECURITY.md`와 `CHANGELOG.md`에서 관리합니다.
- 내부 구현과 배포 절차는 Marketplace README에 복사하지 않고 GitHub 문서로 연결합니다.
- 동작이나 지원 범위가 바뀌면 코드, 사용자 문서와 변경 기록을 같은 릴리스에서 함께 갱신합니다.
