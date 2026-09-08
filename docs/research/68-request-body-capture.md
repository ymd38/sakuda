# 調査: 探索時のリクエスト body 形状捕捉と、非 GET 注入点の自動診断（Issue #68）

> 種別: 調査ドキュメント（実装は後続 Issue）
> 実測日: 2026-09-08 / 対象: ローカル OWASP Juice Shop 20.1.1（`127.0.0.1:4001`）
> 関連: Epic #41（Decision A = body を捏造しない）、#44（生成 OpenAPI・query 面のみ）、#46（ZAP requestor の method 化）、#47（能動的探索）、#67（ZAP ルール供給）

## 0. 結論（先に）

- **推奨案: 「探索が観測した body の _形状_ だけを保存し、生成 OpenAPI の `requestBody` として nuclei DAST と zap-api に渡す」。** 値は保存も送信もせず、fuzz の seed は合成値（`"test"` / `1` / `true`）にする。
- Decision A（存在しない body を捏造しない）とは矛盾しない。捏造が禁じられたのは「探索が見ていない body を推測で作ること」であり、観測済みの形状は捏造ではない。値を合成することは Epic #41 の「合成 body のみ」と同じ扱い。
- PoC: 手書き OpenAPI 無しで、探索 dump → 形状 → 生成 OpenAPI → zap-api の 1 パスで `POST /rest/user/login` の SQLi（ZAP 40018、`email`）が検出された（§5）。
- フォーム送信由来の非 GET（login / register）を観測できたのは **ZAP Client Spider（`client` アドオン、AF `spiderClient`）だけ**。Ajax spider は条件を変えた 3 回すべてで 0 件、伝統的 spider は `postForm: true` でも SPA では 0 件、katana は `-aff` + body 保持でも 0 件（§1）。sakuda の discovery に `spiderClient` を足すことが前提条件になる。
- 引き渡し先は **zap-api が本命**。同じ生成 doc で nuclei DAST は 0 件（§5）。ZAP requestor に body を載せる案（§3 の (b)）は採らない。
- 後続 Issue は 4 本に分割する（§7）: A0 Client Spider の追加 / A 形状の捕捉 / B 承認と保存 / C 生成 OpenAPI の requestBody と zap-api 投入。

## 1. 各探索ソースが body をどこまで観測できるか（実測）

### 1.1 既存 discovery 30 件の dump（ベースライン）

現行の dump（`siteTreeDump.ts`）は method / url / type / status しか書かないが、method 別の集計はできる。ローカルの `/data/discoveries/*/site-tree.jsonl` 30 件を集計した。

| 対象                                                   | dump 数 | 非 GET が出た dump | 非 GET の内訳（重複除去）                                                                                                                               |
| ------------------------------------------------------ | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Juice Shop（seed `/#/`、うち 2 件は `postForm: true`） | 6       | 2                  | `POST /socket.io/?…` のみ（Ajax spider 由来、socket.io polling）                                                                                        |
| 別のローカル SPA（seed `/talent/` 等）                 | 24      | 8                  | `PUT /api/talent/me`、`POST /auth/refresh`、`POST /auth/logout`、`POST /api/talent/announcements/{id}/read`（すべて type 10 = Ajax spider、status 403） |
| katana `urls.jsonl`（全 dump）                         | 30      | 0                  | —                                                                                                                                                       |

読み取れること:

- 非 GET を出しているのは **例外なく Ajax spider（history type 10）**。伝統的 spider（type 2）は `postForm: true` を付けた 2 件でも非 GET を 1 件も出していない。Juice Shop の login / register / contact フォームは Angular が描画するので、HTML パーサである伝統的 spider には `<form>` が見えない。
- 別 SPA の `PUT /api/talent/me` は「ログイン済みの SPA が起動時・操作時に自発的に送った XHR」で、まさに本 Issue が狙う「認証付き非 GET」の観測例。ただし現行 dump では body の有無すら分からない。

### 1.2 ZAP: 形状付き dump の実測（PoC スクリプト）

`siteTreeDump.ts` のスクリプトを拡張し、各ノードの `HistoryReference.getHttpMessage()` から `Content-Type`・`Authorization`/`Cookie` の有無・body の形状（JSON はキー名と JSON 型、form-urlencoded はフィールド名。**値は書かない**）を書き出す版を scratchpad に置き、sakuda の discover プラン相当（伝統的 spider `postForm: true` 2 分 + Ajax spider 3 seed: `/#/`, `/#/login`, `/#/contact`、ブラウザストレージにローカル test アカウントの JWT、replacer で `Authorization` / `Cookie`）を `docker exec sakuda /zap/zap.sh -cmd -autorun` で手動実行した。加えて history テーブル全体も歩き、同一ノードへ複数回送られた非 GET を数えた。

**Run 1（sakuda の discover プラン相当）**

| 項目                       | 結果                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| site tree ノード           | 192（うち Ajax spider 由来 17）                                                                                        |
| 非 GET ノード              | **0**                                                                                                                  |
| history テーブルの非 GET   | **0**                                                                                                                  |
| Ajax spider の所要         | 20〜40 秒 / seed（2〜3 分の上限に届かず、状態を使い切って終了）                                                        |
| Ajax spider が到達した API | `/rest/user/whoami`、`/rest/products/search?q=`、`/rest/basket/NaN`、`/rest/captcha/`、`/api/Quantitys/` など GET のみ |

`/rest/basket/NaN` は SPA が `sessionStorage.bid` を持たないまま起動した痕跡で、ログイン状態自体は成立している（`whoami` が呼ばれている）が、Ajax spider はログインフォームも「カートに入れる」も押していない。Juice Shop は初回表示で歓迎ダイアログと cookie 同意バナーを出し、ログインボタンはメール形式が妥当になるまで `disabled` なので、Crawljax の既定のランダム入力ではフォーム送信に到達できない。

**Run 2（Ajax spider の条件を整える）**

歓迎ダイアログ・cookie 同意を消す cookie（`welcomebanner_status` / `cookieconsent_status`）と `sessionStorage.bid` をブラウザストレージに追加し、`randomInputs: false` にして Form Handler アドオン（画像同梱、6.8.0）に `email` / `password` / `passwordRepeat` の既定値を `-config formhandler.fields(N).*` で与え、seed を `/#/login`, `/#/search`, `/#/contact`, `/#/register` の 4 本にした。

| 項目                             | 結果                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| site tree ノード                 | 44                                                                                                                    |
| 非 GET ノード / history の非 GET | **0 / 0**                                                                                                             |
| Ajax spider が到達した API       | `/rest/basket/7`（bid が効いた）、`/api/SecurityQuestions/`（register 画面まで到達）、`/rest/captcha/` — いずれも GET |

ログイン画面・登録画面は開いているのに、Ajax spider（Crawljax）は送信ボタンを押さない。Angular の reactive form は入力が妥当になるまで submit を `disabled` にし、Crawljax は disabled 要素を候補にしないため、Form Handler の値を与えても送信に至らない。

**Run 3（ZAP Client Spider）**

ZAP 2.17 の画像には Ajax spider とは別の **Client Spider**（`client` アドオン 0.30.0、AF job `spiderClient`）が入っている。ブラウザ内の ZAP 拡張が DOM を直接操作し、Form Handler の値でフォームを埋めて送信する設計。Run 2 と同じブラウザストレージ・Form Handler 設定で `spiderClient` を `/#/login` と `/#/search` に 2 分ずつ、比較用に Ajax spider（`clickElemsOnce: false`, `eventWait: 2000`）を `/#/login` に 2 分走らせた。

| 項目                          | 結果                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| site tree ノード              | 339（うち Client Spider 由来 = history type 24）                                                                                                                                                                                                                     |
| 非 GET ノード（対象オリジン） | **`POST /rest/user/login`**（`application/json`、`{email: string, password: string}`、401）、**`POST /api/Users/`**（`application/json`、`{email, password, passwordRepeat, securityAnswer}`（すべて string）、400）、`POST /socket.io/?…`（`text/plain`、除外対象） |
| history の非 GET              | login 4 回・Users 6 回（形状はすべて同一 = site tree の 1 件と一致）                                                                                                                                                                                                 |
| 由来                          | **すべて Client Spider（type 24）。** 同時に走らせた Ajax spider（type 10）は 57 URL を見つけたが非 GET は 0                                                                                                                                                         |
| ZAP がノード名に付ける情報    | `POST:login()({email,password})` — ZAP 自身が JSON body のキー名を site tree ノード名に既に持っている                                                                                                                                                                |
| 副作用                        | Client Spider はコンテキスト外の `https://collector.github.com/...` へも POST した（フッターの GitHub リンクを踏んだ）。sakuda 側では `sameOriginOnly` で落ちるが、ZAP のコンテキスト include を守っていない点は実装時に要確認（`spiderClient` の scope 設定）       |

login の 401 / Users の 400 は Form Handler の合成値（`foo-bar@example.com` 等）が本物の資格情報ではないため。**形状の観測には成功・失敗は関係ない**。

### 1.3 katana: `-aff` + body 保持の実測

sakuda の引数（`-jc -kf all -d 3 -fs fqdn -aff -ct 3m -jsonl`）から `-eof` の `body` を外して（`-eof raw,headers`）、同じ JWT ヘッダ付きで実行した。

| 項目                    | 結果                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| 出力行                  | 213                                                                                        |
| method 内訳             | GET 213 / 非 GET 0                                                                         |
| `request.body` を持つ行 | 0                                                                                          |
| 出力サイズ              | 3.8 MB（レスポンス body を保持したため。sakuda の既定 `-eof raw,body,headers` では 56 KB） |

katana の `-aff` は HTML 上の `<form>` を対象にするが、SPA のフォームは JS が描画するので静的クロールには存在しない。JS バンドル解析（`-jc`）が拾うのはエンドポイント文字列だけで、body の形状は分からない。**katana は本 Issue の供給源にならない**（headless モードは Epic #41 の「触らない範囲」で既定にしないと決めている）。

### 1.4 観測に関する結論

- body 形状を観測できるソースは 2 つ。(1) **SPA が自発的に送る XHR**（ログイン済み SPA の起動時・画面遷移時の `PUT /api/talent/me` 類。Ajax spider でも拾える。§1.1 の別 SPA）、(2) **フォーム送信で発生する非 GET**（login / register / feedback）。(2) は **ZAP Client Spider でしか観測できなかった**。Ajax spider は 3 条件（既定 / バナー解除 + Form Handler / 要素クリック緩和）すべてで 0 件。
- したがって sakuda の discovery プランに `spiderClient` job を足すことが、この Issue の前提条件になる。Form Handler の既定値（`email` → `foo-bar@example.com` 等）は ZAP 同梱の既定で足りるが、対象固有のフィールド名は将来 site 設定として与える余地がある（値は秘密ではない）。
- 伝統的 spider の `postForm` は SSR/MPA のフォームにしか効かない（Juice Shop では 0 件）。無害だがこの Issue の役には立たない。katana は静的クロールのため供給源にならない。
- ブラウザストレージ注入で SPA をログイン状態にすることは、(1) の観測に必須で、(2) には不要（既存 #6 の仕組みがそのまま効く）。
- 形状は `HistoryReference.getHttpMessage()` から取れる。site tree は 1 ノード 1 HistoryReference なので、同じ `POST /x` に異なる形状で複数回送られた場合は最初の 1 件しか見えない。history テーブルを歩けば全件見えるが、Run 3 では 10 回の送信すべてが同一形状だった。実装では site tree 走査で十分で、history 走査は不要。
- replacer でヘッダを注入している間は全リクエストに `Authorization` が付くので、「認証付きかどうか」を観測から判定することはできない（Run 3 では socket.io にも付いた）。認証の有無はヘッダを登録した site の探索結果であること自体で表す。

## 2. 捕捉した body の保存方式の比較

前提: `sites.nucleiPaths` は `toSitePublic` 経由で API に平文で露出し、nuclei の `targets.txt` は平文でディスクに書かれる。Issue の「触らない範囲」により、**値を平文で保存する案は最初から除外**。

| 案                        | 保存する内容                                                                | 露出面ごとのリスク                                                                                                                                                                                                                                                                                                         | 診断への効き                                                                                                                                                                                                              | 実装コスト                                                                                   |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **A. 保存しない**         | なし（現状）                                                                | なし                                                                                                                                                                                                                                                                                                                       | 非 GET body 注入点は手書き OpenAPI 無しでは検査不能（現状の穴）                                                                                                                                                           | 0                                                                                            |
| **B. 形状のみ**（推奨）   | content-type、フィールド名、JSON 型（ネスト含む）                           | フィールド名は API 契約であり秘密ではない（`email`, `password` という _名前_ は OpenAPI にも載る）。値を持たないので、API レスポンス・ログ・レポート・生成 OpenAPI ファイル（既に 0600 + 実行後削除）のどこに出ても秘匿情報は漏れない                                                                                      | 生成 OpenAPI の `requestBody` にそのまま変換できる。fuzz の seed は合成値なので、値がなくても ZAP / nuclei DAST は全フィールドに注入できる（§5 で実証）                                                                   | 小: dump スクリプト拡張 + `DiscoveredUrl` に `bodyShape` + 保存列 1 本 + `openapiGen` の拡張 |
| **C. 値も保存（暗号化）** | B + 観測値を `createSecretCipher`（purpose `requestBodies`）で AES-GCM 封緘 | 保存時は安全だが、**使う時に必ず復号して平文にする**: 生成 OpenAPI ファイル・nuclei/ZAP のリクエストログ・ZAP の findings `evidence`・Markdown レポートに観測値（= 実パスワード等）が流れる。ヘッダ値と同じ「レポートに出さない」規律を body 値にも広げる必要があり、findings の `param`/`evidence` マスキングまで波及する | B に対する上積みは「実値のほうが認証・バリデーションを通りやすい」こと。しかし注入検査は各フィールドにペイロードを差し替えるので、他フィールドが合成値でも通ることが多い（login SQLi は `password: "test"` で検出できた） | 大: 暗号化列・復号経路・全出力のマスキング・承認 UI での値の扱い                             |

**判断: B。** C の上積み（実値のほうがサーバのバリデーションを通る）は、必要になったフィールドだけを後から「合成値の上書き（ユーザ入力、暗号化保存）」として足せばよく、観測値の自動保存は不要。SPEC §7.1 の「findings は攻撃手順そのもの」という機密度に、さらに実パスワードを載せる理由がない。

B でも守ること:

- 形状は `nucleiPaths` の行には入れない（行文法 `METHOD [api:]path` は不変）。別の構造化列（例: `sites.requestShapes`、JSON、`targetLineKey` をキーにした map）に持つ。
- フィールド名は秘密ではないが、**サイトの API 構造そのもの**ではあるので、ログには件数だけ（既存の `skippedMethods` と同じ規律）。
- 承認ゲートは崩さない: 形状は discovery 結果（`discoveries.urls[].bodyShape`）として UI に出し、ユーザが承認した行の形状だけ site に保存する。

## 3. 診断への引き渡し方式の比較

| 案                                                      | 仕組み                                                                                                                                                                                                                   | 検出力                                                                                                                                                                                                            | ゲート整合                                                                                                                                      | 判断                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **(a) 生成 OpenAPI の `requestBody` 拡張**（推奨）      | `buildNonGetOpenApiDocs` が形状を `requestBody.content[<ct>].schema` に変換し、`example` に合成値を置く。同じ doc を nuclei `-im openapi -dast`（既存 #44 の経路）と zap-api の `openapi` job（`apiFile`）の両方に渡せる | zap-api: 手書き OpenAPI と同等（§5 で 40018 検出、34 秒）。nuclei DAST: body のファジング自体は動く（§5 で 54 テンプレ・500 リクエスト）が login SQLi は 0 件                                                     | 既存 #44 と同じく `isActiveScanEnabled` 下でのみ doc を生成。query が無い非 GET は今まで `skippedNoFuzzSeed` だったが、形状があれば seed になる | **採用**                                                                                            |
| **(b) ZAP requestor に `data` + `Content-Type` ヘッダ** | AF `requestor` job の `requests[].data` / `headers` で body 付きリクエストを site tree に載せ、後続の activeScan に攻撃させる                                                                                            | zap-fe の activeScan は FE コンテキスト（front origin）限定。`api:` 行は zap-api の領分で requestor が無い。JSON body は activeScan が注入対象にするが、requestor は 1 回送るだけで、送信自体が mutating（gated） | requestor は「サイトツリーに載せる」目的であり、mutating な実送信を伴う。(a) は生成 doc を渡すだけで、実送信はエンジン側のゲート内              | **見送り**（(a) で両エンジンに届く。requestor は GET/HEAD/OPTIONS のまま）                          |
| (c) `sites.openapiJson` にマージ                        | ユーザの手書き doc と生成 doc を合成                                                                                                                                                                                     | (a) と同じ                                                                                                                                                                                                        | ユーザ doc を上書きしない設計が要る                                                                                                             | (a) の内側で「zap-api に生成 doc を渡す」形にすれば不要。ユーザ doc がある場合は両方を別 job で流す |

(a) の補足:

- **zap-api への投入が本命。** login SQLi を実際に検出した検出器は ZAP 40018（zap-api）であり、nuclei DAST は同じ doc で 0 件だった（§5）。現状 zap-api は `openapiUrl|openapiJson` が無いと起動すらしないが、生成 doc があれば「ユーザ doc 無しでも zap-api が走る」ようになる。nuclei 側は既存 #44 の経路に requestBody を足すだけなので、コストは小さく併用してよい。
- 1 ドキュメント = 1 オリジン、(path, method) 衝突は shard、という #44 の構造はそのまま。形状が複数観測された同一 (path, method) は shard に分ける。
- Content-Type は観測値をそのまま使う（`application/json` / `application/x-www-form-urlencoded`）。multipart は初版では対象外（ファイル本体を捏造する必要があるため）。

## 4. Decision A との整合

Epic #41 の Decision A は「探索が body 形状を捕捉していないので、非 GET に **body を捏造しない**」だった。本調査の線引きは:

| 状況                                               | 扱い                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 探索が観測していない非 GET（手書き行、query 無し） | 従来どおり `skippedNoFuzzSeed`。捏造しない（Decision A 維持）                               |
| 探索が観測した非 GET の **形状**                   | 捏造ではない。保存し、生成 OpenAPI の `requestBody` にする                                  |
| 形状のフィールドに入れる **値**                    | 合成値（`"test"` / `1` / `true`）。観測値はコピーしない（Epic #41「合成 body のみ」と同じ） |

したがって Decision A の再評価は不要で、「捕捉していない」という前提条件のほうを解消する。

## 5. PoC: 手書き OpenAPI 無しで `POST /rest/user/login` を診断対象にする

1 パスの構成（ユーザの手書き OpenAPI は一切使わない）:

```
Run 3 の形状付き dump（site-tree-shapes-3.jsonl）
  → gen-openapi.py: 対象オリジンの非 GET ノードのうち body 形状（json/form）を持つものを
    requestBody.schema に変換、値は合成（string→"test"）、socket.io と他オリジンは除外
  → openapi.json（2 op: POST /api/Users/, POST /rest/user/login）
  → zap-api 相当の AF プラン（buildZapApiPlan と同構成: openapi job apiFile → activeScan（40026 Off）→ report）
  → report.json
```

同じ `openapi.json` を nuclei の OpenAPI フェーズ（`buildNucleiOpenapiArgs` と同じ引数: `-im openapi -t dast -dast`）にも渡した。

| エンジン    | 所要                      | 結果                                                                                                                                                                                                                                                                          |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **zap-api** | 34 秒（activeScan 19 秒） | **40018 SQL Injection（High）: `POST /rest/user/login` param `email`、attack `'`** — 手書き OpenAPI のときと同じ検出。ほかに 10098 Cross-Domain Misconfiguration（両 op）、10106 HTTP Only Site、10111/10112（認証リクエスト・セッション応答の識別）、10104 User Agent Fuzzer |
| nuclei DAST | 15 秒                     | 54 テンプレ・500 リクエスト・**0 件**。`-im openapi` は requestBody を読んで JSON body をファジングしたが、DAST の sqli テンプレ（error-based）は Juice Shop の login 応答（SQLITE_ERROR を含む JSON）にマッチしなかった                                                      |

完了条件 3（Juice Shop の非 GET 注入点 1 つが手書き OpenAPI 無しで診断対象になることを 1 パスで示す）は **zap-api で達成**。nuclei DAST は body をファジングする経路としては動くが、検出器としては zap-api に劣る。§3 の判断（zap-api への投入が本命）は実測どおり。

副次的な観測: 生成 doc の `POST /api/Users/` にも activeScan が走った。登録 API は 400 を返し続けた（合成値がバリデーションを通らない）ため副作用は無かったが、**ユーザ登録・投稿系の非 GET は成功すればデータを作る**。生成 doc を渡す経路が `isActiveScanEnabled` 下に限定されていることが、この PoC でも実際に意味を持つ。

## 6. 推奨案

0. **探索エンジンの追加**: discovery の AF プランに **Client Spider（`spiderClient`）** を足す（seed ごと、既存の spider / Ajax spider と同じ時間上限、`isActiveScanEnabled` 下のみ = フォーム送信は mutating）。Form Handler は ZAP 同梱の既定値を使う。これが無いと Juice Shop 型の SPA ではフォーム由来の非 GET を観測できない（§1.2 Run 3）。
1. **探索**: ZAP の site tree dump に `contentType` と `bodyShape`（値なし）を追加し、`DiscoveredUrl` に載せる。`source` に `client`（history type 24）を追加。katana は変更なし。
2. **承認・保存**: 承認画面で非 GET 行に「body: json {email, password}」のような形状バッジを出し、承認した行の形状を `sites` の構造化列に保存する（`nucleiPaths` の行文法は不変、キーは `targetLineKey`）。
3. **診断**: `buildNonGetOpenApiDocs` が形状を `requestBody` に変換（合成値）し、nuclei DAST（既存経路）と **zap-api**（新経路: ユーザ doc が無くても生成 doc で起動）に渡す。すべて `isActiveScanEnabled` 下。
4. **やらないこと**: 観測値の保存、ZAP requestor への body 搭載、multipart、伝統的 spider の `postForm` 依存。

## 7. 後続 Issue の分割案

| #   | 内容                                                                                                                                                                                                                                              | 依存 | 影響範囲                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| A0  | discovery プランに Client Spider（`spiderClient`）job を追加する。`isActiveScanEnabled` 下のみ（フォーム送信 = mutating）。コンテキスト外への送信（§1.2 Run 3 の github.com）を抑える scope 設定を確認。`DiscoveredUrl.source` に `client` を追加 | なし | `plan.ts`、`zapDiscover.ts`、`siteTreeDump.ts`（type 24）、`shared/types/api.ts`、`DiscoveryPanel` の source 表示 |
| A   | dump スクリプトに `contentType` / `bodyShape` を追加し、`DiscoveredUrl.bodyShape` として discovery 結果に保存する（値は書かない。ログは件数のみ）                                                                                                 | なし | `siteTreeDump.ts`、`zapDiscover.ts`、`shared/types/api.ts`、`crawledUrls` の dedupe キーは変えない                |
| B   | 承認 UI に形状を表示し、承認した非 GET 行の形状を `sites.requestShapes`（新列、JSON）に保存する。`toSitePublic` は形状を返してよい（値を含まない）                                                                                                | A    | `DiscoveryPanel`、`targets.post.ts`、`siteService`、schema/migration                                              |
| C   | `buildNonGetOpenApiDocs` に `requestBody`（合成値）を追加し、生成 doc を nuclei DAST に加えて zap-api にも渡す（ユーザ doc 無しでも zap-api が走る）。`skippedNoFuzzSeed` は「形状も query も無い」場合だけに縮む                                 | B    | `openapiGen.ts`、`nuclei/index.ts`、`zapApi.ts`、`plan.ts`                                                        |

A0 と A は独立（A0 は非 GET の _観測量_ を増やし、A は観測した非 GET の _形状_ を残す）。B は A に、C は B に依存する。A 単体でも「探索結果で body の有無が見える」価値があり、A0 単体でも Juice Shop で `POST /rest/user/login` が承認候補に並ぶようになる（現状は method 付きで保存されても `skippedNoFuzzSeed` で止まる）。

## 付録: PoC の再現手順（ローカル限定）

PoC 用のスクリプト・プラン（形状付き dump スクリプト、discover プラン ×3、`gen-openapi.py`、zap-api プラン）は scratchpad に置き、本リポジトリには入れていない。手順の骨子:

1. ローカル Juice Shop に使い捨てユーザを `POST /api/Users` で作り、`POST /rest/user/login` で JWT を得る（値はドキュメントに載せない。ユーザは Juice Shop コンテナの再作成で消える）。
2. sakuda コンテナ内 `/data/poc-68/zap/` に、browser-storage スクリプト（localStorage `token` + cookie `token` + バナー解除 cookie + `sessionStorage.bid`、0600）、replacer.conf（`Authorization` / `Cookie`、0600）、形状付き dump スクリプト、プランを置き、`zap.sh -dir … -cmd -config selenium.firefoxPrefs.pref(0).* -config formhandler.fields(N).* -configfile replacer.conf -autorun plan.yaml` を実行する。Run 3 のプランは `spiderClient` ×2 + `spiderAjax` ×1 + dump。
3. `site-tree-shapes-3.jsonl` の非 GET ノードから `gen-openapi.py` で `openapi.json` を生成する（形状 → `requestBody`、値は合成、対象オリジンのみ）。
4. zap-api プラン（sakuda の `buildZapApiPlan` と同じ構成、activeScan 10 分上限、40026 Off）で実行し、`report.json` の pluginid 40018 を確認する。nuclei は `-l openapi.json -im openapi -t /opt/nuclei-templates/dast -dast …` で同じ doc を流す。
5. 終了後、コンテナ内の `/data/poc-68/` と scratchpad の秘密ファイル（JWT、browser-storage、replacer）を削除する（本調査でも削除済み）。
