# RTCC 검증 입력 재생성

과거 `.plan` 실행 파일과 프로파일 원본이 없어도 현재 저장소의 회귀 검증을 실행할 수 있도록
검증 입력을 재작성했습니다. 재생성 자료는 단위 테스트 입력이며 과거 실행·성능·브라우저
검증을 증명하지 않습니다.

## 관리되는 입력과 계약

- `test/support/rtccReconstructedAuthority.ts`는 기존 한 라우트 fixture에서 1,530개 기록과
  681개 runnable, 47개 duplicate, 18개 unresolved 항목을 메모리에서 생성합니다. 음성 입력의
  UUID 오류 31개와 수정 후에도 남는 blocker 18개를 실제 검증기로 확인합니다.
- V3/V4 테스트의 scoped mock은 재생성한 바이트의 실제 SHA-256을 사용합니다. 해시 함수나
  검증 함수를 mock하지 않습니다. 누락·변조·순서 변경·중복 실행·배타적 쓰기 검사는 유지합니다.
- `scripts/rtcc-v4-executor-contract.mjs`는 사라진 실행기의 읽기 전용 증거 계약을 관리 소스로
  재구현합니다. import와 계약 검증은 프로세스를 실행하거나 파일·서비스를 만들지 않습니다.
  알 수 없는 과거 해시는 `null`로 두고 검증 진입을 거부합니다.
- `scripts/rtcc-v4-module-policy.mjs`의 과거 고정 해시는 그대로 보존합니다. 재생성 단위
  테스트만 현재 입력의 실제 해시를 주입하며, 별도 검사가 mock하지 않은 과거 상수를 확인합니다.
- `test/fixtures/rtcc-reconstructed/`의 V2 자료는 명시적인 재생성 fixture입니다. 새 manifest의
  실제 해시와 원본 정책의 고정 해시를 각각 검증합니다. 새 자료는 공식 원본 검증을 통과시키지
  않으며, V1 코드·테스트의 고정 해시와 V2 공식 identity gate도 유지합니다.

## 실행과 임시 데이터

```sh
npm test -- test/scripts/validateRtccPreviewCompleteRouteProfileV2.test.ts \
  test/scripts/validateRtccPreviewCompleteRouteProfileV3 \
  test/scripts/validateRtccPreviewCompleteRouteProfileV4.test.ts \
  test/scripts/rtccV4ExecutorContract.test.ts \
  test/support/rtccReconstructedAuthority.test.ts --maxWorkers=1
npm run check
```

대용량 재생성 프로파일은 디스크에 저장하지 않습니다. 쓰기 계약을 확인하는 테스트만
실행별 임시 디렉터리에 출력하며, 테스트 정리와 전역 teardown이 이를 삭제합니다.
예약 실행이나 상주 서비스는 사용하지 않습니다.

실제 새 측정은 기존 `scripts/profile-preview-complete-route-inventory.mjs`를 프로젝트 안에서
명시적으로 실행해 생성해야 합니다. 과거 공식 CLI의 고정 identity gate는 재생성 단위
테스트와 별개이며, 원본 누락을 성공으로 바꾸지 않습니다.
