# Cinema Notify - 알려진 이슈 및 향후 고려사항

## 해결된 이슈
1. **CGV 날짜 버튼 매칭 실패**: 정규식 → span[class*="dayScroll_number"] 직접 타겟팅으로 해결
2. **startup 시 중복 알림**: skipNotify 옵션 추가로 재기동 시 새 상영 알림 억제
3. **startup 상세 embed 불필요**: notifyStartup에서 요약만 발송하도록 변경
4. **SchedulerRegistry 중복 등록**: doesExist 체크 후 deleteInterval로 해결
5. **Docker pnpm 버전 불일치**: latest → 8.15.9 고정
6. **Docker 이미지 크기**: playwright 공식 이미지(2GB+) → node:22-slim + playwright install(경량)
7. **Health check 포트 충돌**: EADDRINUSE 에러 핸들링 추가

## 잠재적 이슈
1. **Render 512MB RAM**: Chromium 메모리 사용량이 높아 OOM 가능성 있음
   - 대안: 브라우저 사용 후 즉시 dispose, 또는 더 큰 인스턴스
2. **CGV IP 차단**: 동일 IP에서 반복 접속 시 차단 가능
   - 현재 대응: stealth + UA 로테이션 + 간격 지터
   - 추가 대응 필요 시: 프록시 로테이션
3. **CGV DOM 구조 변경**: React SPA이므로 클래스명/구조 변경 가능
   - API 응답 가로채기 패턴이라 DOM 의존성은 날짜 버튼 클릭 부분만
4. **Render Free tier 제한**: 90일 비활성 시 중단, 월 750시간 제한

## 확장 시 고려사항
- 롯데시네마/메가박스 추가: CinemaProvider 인터페이스 구현 + cinema.module.ts 등록
- 다중 극장 모니터링: config.json targets 배열에 추가
- 상태 저장소: 현재 JSON 파일로 충분, 규모 커지면 SQLite 고려
