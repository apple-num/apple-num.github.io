# 애플넘 (apple-num.github.io)

사과 숫자를 드래그로 묶어 합 10을 만들면 사라지는 웹 퍼즐. 지인용, 비영리.

- 판 16×10(사과 160개), 제한 시간 2분, 지운 사과 1개당 1점
- 세로 화면에서는 판을 10×16으로 돌려서 배치 (모바일 웹 대응)
- 랭킹: 영문 이니셜 3글자, 이번 주(월요일 0시 KST 초기화) / 전체, 이니셜별 최고 기록만 표시

## 구조

```
index.html, css/, js/      프론트엔드 (GitHub Pages, 빌드 없음)
shared/game.js             판 생성·이동 검증 로직 (프론트와 워커가 같이 사용)
worker/                    랭킹 API (Cloudflare Workers + D1)
.github/workflows/         worker/ 또는 shared/ 변경 시 워커 자동 배포
```

### 조작 방지
1. 시작할 때 서버가 `gameId`와 판 시드를 발급합니다.
2. 클라이언트는 같은 시드로 판을 만들고, 지운 사각형과 시각을 기록합니다.
3. 제출 시 서버가 이동 기록을 다시 재생해 점수를 계산합니다. 클라이언트가 보낸 점수는 쓰지 않습니다.
4. 게임당 1회만 등록, 시작 후 2분 30초가 지나면 등록할 수 없습니다.

## 배포

### 1. 프론트엔드
저장소 Settings → Pages → Source를 `main` 브랜치 `/ (root)`로 설정하면 https://apple-num.github.io 로 열립니다.
`js/config.js`의 `API_BASE`가 비어 있으면 랭킹 없이 연습 모드로 동작합니다.

### 2. 랭킹 서버 (처음 한 번)
```bash
cd worker
npx wrangler login
npx wrangler d1 create apple-num-db      # 출력된 database_id를 wrangler.toml에 입력
```

저장소 Settings → Secrets and variables → Actions에 아래 두 개를 등록합니다.
- `CLOUDFLARE_API_TOKEN` (Workers 편집 + D1 편집 권한)
- `CLOUDFLARE_ACCOUNT_ID`

이후 `worker/` 변경을 push하면 GitHub Actions가 마이그레이션과 배포를 실행합니다.
(Actions 탭에서 "Deploy ranking worker"를 수동 실행해도 됩니다.)

### 3. 연결
배포된 워커 주소(`https://apple-num-api.<서브도메인>.workers.dev`)를 `js/config.js`의 `API_BASE`에 넣고 push합니다.

## 로컬 실행
```bash
python3 -m http.server 8080              # 프론트: http://localhost:8080
cd worker && npx wrangler d1 migrations apply apple-num-db --local && npx wrangler dev
```
로컬 테스트 때는 `API_BASE`를 `http://localhost:8787`로 바꿉니다. (localhost 출처는 CORS 허용됨)
