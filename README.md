<p align="center"><img src="docs/logo.svg" width="96" alt="AgentDesk"></p>

# AgentDesk (claude-codex)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

App chạy local để **giao việc cho Claude Code và Codex trong cùng một chỗ**. Ví dụ: Claude Opus lập plan, Codex review, Claude Sonnet viết code. Lúc nào cũng thấy rõ bước nào đang dùng model gì của hãng nào, tốn bao nhiêu token, và còn bao nhiêu quota.

> *A local desktop-style app that orchestrates the Claude Code CLI and the Codex CLI: chat with either agent, hand work from one to the other, and run approval-gated multi-agent pipelines (plan → review → code → test) in an n8n-style flow editor.*

Giao diện gồm ba cột:
- **Bên trái (giống Claude):** chọn project, danh sách session, usage.
- **Ở giữa:** chat và sơ đồ pipeline.
- **Bên phải (giống VS Code):** cây file.

---

## Tính năng

- **Chat với Claude hoặc Codex.** Chọn Agent, Model, Effort và Quyền ngay dưới ô nhập, không cần gõ `/command`. Có thể đổi agent giữa chừng: agent sau tự nhận phần ngữ cảnh mà nó chưa thấy.
- **Vai trò có sẵn.** Plan, Review, Code, Test, Debug, Ask, mỗi vai trò gắn sẵn model, effort, quyền và prompt mẫu. Sửa được hoặc thêm vai trò mới.
- **Pipeline dạng node (giống n8n).**
  - Kéo thả các bước, nối dây, lưu thành template.
  - Bước nào cũng có thể bật **dừng chờ duyệt**. Bước review/test có thể chấm **pass/fail** để rẽ nhánh (ví dụ fail thì quay lại Code).
  - Có giới hạn số vòng lặp để không đốt quota.
  - Sơ đồ cập nhật trực tiếp khi pipeline chạy.
- **Đọc lại session cũ.** Hiện cả session tạo bằng Claude Code hay Codex ngoài app (đọc từ `~/.claude` và `~/.codex`), mở ra xem và chat tiếp được.
- **Explorer giống VS Code.** Màu git (M/U/D), file bị `.gitignore` hiện mờ, file agent vừa sửa có chấm cam. Mở file bằng Monaco (editor của VS Code), xem diff với HEAD, sửa và lưu bằng ⌘S.
- **Usage và quota.** Xem % đã dùng theo 5 giờ và theo tuần của cả Claude lẫn Codex, giờ reset, và dùng **lượt reset trong bank của Codex** ngay trong app.
- **Terminal có sẵn** (giống VS Code): shell thật trong thư mục project, gõ lệnh tay, mở nhiều terminal. Chạy `npm run dev` xong có tab **Preview** xem trang web ngay trong app.
- **Source Control (git)** giống VS Code: đổi/tạo nhánh, stage, commit, push/pull, xem diff, lịch sử commit, AI viết commit message.
- **Theme** sáng / tối / theo hệ thống.
- **Chạy bằng một lệnh.** Trên macOS app mở thành cửa sổ native riêng. Đóng cửa sổ là app tắt.

## Yêu cầu

| Cần có | Ghi chú |
|---|---|
| **Node.js ≥ 23.6** | Server chạy file `.ts` trực tiếp, không cần build. Kiểm tra: `node -v` |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code`, rồi chạy `claude` một lần để đăng nhập |
| **Codex CLI** | `npm i -g @openai/codex`, rồi `codex login`. Nên dùng bản mới để có đủ model |
| macOS (khuyến nghị) | Có Xcode Command Line Tools (`xcode-select --install`) thì app mở thành cửa sổ native |
| Python 3 (macOS/Linux) | Dùng cho Terminal (tạo PTY, không cần cài module native). macOS đã có sẵn |

Chỉ cần một CLI là dùng được. Có từ hai CLI trở lên thì mới giao việc qua lại được.

**Tuỳ chọn: Antigravity CLI (`agy`) của Google.** Cài theo [hướng dẫn chính thức](https://antigravity.google/docs/cli/headless/) (`curl -fsSL https://antigravity.google/cli/install.sh | bash`), rồi chạy `agy` một lần để đăng nhập Google. Khi máy có `agy`, AgentDesk tự thêm **Antigravity** làm agent thứ ba: chat, pipeline, usage (Gemini và Claude/GPT, mỗi nhóm có quota 5 giờ và tuần). Không cài thì app ẩn đi.

Không có Xcode Command Line Tools thì app mở bằng Chrome/Edge/Brave ở chế độ `--app` (cửa sổ riêng, không thanh địa chỉ). Không có các trình duyệt đó thì mở bằng trình duyệt mặc định.

**Windows / Linux:**
- Chạy được, app mở bằng **Microsoft Edge** (Windows có sẵn) hoặc Chrome ở chế độ `--app`.
- Cài Claude Code / Codex bằng npm hay bằng bộ cài `.exe` đều được.
- Trên Windows, **Mở thư mục** dùng trình chọn thư mục có sẵn trong app (danh sách ổ đĩa C:, D:… và thư mục). Trên Linux dùng hộp thoại `zenity`, không có thì tự chuyển sang trình chọn trong app.
- Terminal trên Windows chạy PowerShell ở **chế độ cơ bản**: gõ lệnh rồi Enter, Ctrl+C sẽ khởi động lại shell. Các chương trình toàn màn hình như `vim` không chạy được trong chế độ này.

## Cài đặt

```bash
git clone https://github.com/ThinhTP204/claude-codex.git
cd claude-codex
npm install
npm run build
npm link          # tạo lệnh `agentdesk` dùng ở mọi nơi
```

## Chạy

```bash
agentdesk
```

Mở lên rồi chọn project ở sidebar trái. Lần sau app tự mở lại project và cuộc trò chuyện dùng gần nhất.

| Lệnh | Ý nghĩa |
|---|---|
| `agentdesk ~/code/my-app` | Mở thẳng một project |
| `agentdesk --browser` | Mở bằng Chrome/Edge thay vì cửa sổ native |
| `agentdesk --no-open` | Không mở cửa sổ, chỉ in URL (kèm token) để tự mở |
| `agentdesk --port 5000` | Đổi port (mặc định 4545, bận thì tự chọn port khác) |
| `agentdesk --keep` | Không tự tắt khi đóng cửa sổ trình duyệt |

Không muốn `npm link` thì chạy `npm start` trong thư mục repo.

### Cập nhật bản mới

Khi GitHub có bản mới, sidebar trái hiện nút **"Có bản cập nhật"** (app tự kiểm tra lúc mở và mỗi 6 giờ). Muốn kiểm tra ngay: bấm vào chữ **AgentDesk** ở góc trên → **Kiểm tra lại**.

Bấm **Cập nhật & khởi động lại**, app tự làm: `git pull` → `npm install` (chỉ khi thư viện thay đổi) → build giao diện → khởi động lại, cửa sổ đang mở tự tải lại. Nếu build lỗi, app giữ nguyên bản cũ.

- Chỉ dùng được khi cài bằng `git clone`.
- Nên đợi agent chạy xong; terminal đang mở trong app sẽ bị đóng khi khởi động lại.
- Nếu đã tự sửa code trong thư mục AgentDesk, `git pull` sẽ dừng lại và báo; chạy `git status` để xem.

---

## Hướng dẫn sử dụng

### 1. Chọn project

Bấm ô **PROJECT → Đổi** ở góc trên sidebar trái, hoặc nhấn **⌘O**, hoặc vào menu **File → Mở project…**. Có ba cách chọn:
- **Mở thư mục khác…** mở hộp thoại chọn thư mục (trên Windows là trình chọn thư mục trong app).
- **Duyệt thư mục trong app…** duyệt ổ đĩa và thư mục ngay trong AgentDesk, chạy giống nhau trên mọi máy.
- **Nhập đường dẫn…** để gõ hoặc dán đường dẫn.
- **Gần đây** là danh sách project đã mở. Di chuột vào một project rồi bấm × để bỏ khỏi danh sách.

### 2. Chat và giao việc

1. Chọn một **vai trò** (chip Plan / Review / Code…), hoặc tự chọn ở thanh dưới ô nhập:
   - **Claude / Codex:** agent nào làm.
   - **Model:** ví dụ Opus 5, Sonnet 5, GPT-6-Sol… Danh sách model Codex được đọc từ máy.
   - **Effort:** mức suy nghĩ. App chỉ hiện các mức mà model đó hỗ trợ.
   - **Quyền:** Chỉ đọc / Sửa file / Sửa + chạy lệnh / Toàn quyền (xem bảng bên dưới).
   - **⚙ Nâng cao:** fast mode (Codex), model dự phòng, giới hạn chi phí mỗi lượt, system prompt, thư mục bổ sung, bật/tắt MCP.
2. Gõ yêu cầu rồi nhấn **Enter**. **Shift+Enter** để xuống dòng.
   - **Đính kèm file:** kéo file từ Finder/Explorer của máy vào khung chat, dán ảnh bằng **⌘V** (ảnh chụp màn hình), bấm nút 📎, hoặc kéo file từ Explorer bên phải vào. Agent tự mở file theo đường dẫn; Codex nhận ảnh trực tiếp. File tải lên được lưu trong `~/.agentdesk/attachments`.
3. Mỗi câu trả lời có header ghi rõ `Claude · Sonnet 5 · Medium · Code`, kèm các tool call (bấm để xem input/output), phần suy nghĩ, thời gian và số token.
4. **Đổi agent giữa chừng:** ví dụ hỏi Claude trước rồi chuyển sang Codex. Codex tự nhận những gì Claude đã làm.

### 3. Chạy pipeline

**Cách nhanh:** gõ task vào ô chat rồi bấm **Pipeline → chọn template**.

**Thiết kế pipeline riêng (tab Flow → Thiết kế):**
- **+ Thêm bước:** thêm một vai trò hoặc node kết thúc. Kéo từ chấm bên phải node này sang node kia để nối dây.
- **Bấm vào node** để chỉnh vai trò, agent, model, effort, quyền và prompt. Trong prompt dùng được các biến:
  - `{{task}}`: task gốc anh nhập.
  - `{{prev}}`: kết quả của bước ngay trước.
  - `{{Tên bước}}`: kết quả của một bước cụ thể, ví dụ `{{Plan}}`.
- **Dừng chờ duyệt sau bước này:** pipeline dừng lại cho anh xem trước khi chạy tiếp.
- **Chấm đạt/chưa đạt:** node có hai nhánh `pass` (xanh) và `fail` (đỏ). Agent phải kết thúc câu trả lời bằng `VERDICT: PASS` hoặc `VERDICT: FAIL`. Nếu nó quên, app hỏi anh.
- **Số lần chạy tối đa:** chặn vòng lặp fail → làm lại vô hạn.
- **Lưu / Lưu thành bản mới**, rồi bấm **Chạy** và nhập task.

**Khi pipeline dừng chờ duyệt** (thẻ vàng trong chat, hoặc bấm vào node trên sơ đồ):
- **Duyệt và chạy tiếp**, hoặc với bước chấm điểm: **Đạt → nhánh Pass** / **Chưa đạt → nhánh Fail**.
- **Sửa kết quả:** chỉnh output trước khi đưa sang bước sau.
- **Chạy lại…:** chạy lại bước này, có thể đổi model/effort và kèm góp ý.
- **Ghi chú:** gửi thêm chỉ dẫn cho bước tiếp theo.
- **Dừng pipeline.**

Tab **Flow → Lần chạy** hiện sơ đồ trực tiếp: node đang chạy nhấp nháy cam, chờ duyệt viền vàng, xong có dấu ✓, lỗi viền đỏ. Kèm số token và thời gian của từng bước.

### 4. Usage và bank reset

Góc dưới sidebar trái là bảng **Usage**. Mỗi agent có hai thanh (5 giờ và Tuần) đổi màu xanh → vàng → đỏ khi gần chạm giới hạn. Bấm vào để xem chi tiết:
- % đã dùng, giờ reset, thời gian còn lại, trạng thái đăng nhập, nút **Test** (gửi thử "pong").
- **Codex: Bank reset.** Danh sách các lượt reset miễn phí đang có. Bấm **Dùng** để đưa giới hạn 5 giờ và tuần của Codex về 0%. App hỏi xác nhận và cảnh báo nếu usage còn thấp. **Dùng rồi không hoàn tác được.**
- **Claude:** mục "Điều gì đang ăn quota?" hiện phân tích từ `/usage`.

Số liệu tự làm mới khi mở app, mỗi 5 phút, và sau mỗi lượt chạy xong. Việc đọc số liệu **không tốn token**:
- Claude dùng lệnh `claude -p /usage`.
- Codex dùng API `account/rateLimits/read` của Codex CLI.

### 5. Terminal và Preview

- Mở/đóng panel Terminal: **⌃`** hoặc **⌘J**, hoặc nút terminal ở góc phải thanh tab. Kéo mép trên để đổi chiều cao.
- Mỗi terminal là một shell thật (zsh/bash của anh, có đủ PATH, nvm, alias…) mở sẵn trong thư mục project. Gõ gì cũng được: `npm run dev`, `git status`, `vim`, `htop`. **Ctrl+C** để dừng lệnh.
- **+** để mở thêm terminal. Tải lại cửa sổ thì terminal vẫn còn, lịch sử được hiện lại. Đóng app thì mọi terminal và dev server trong đó tắt theo, không chiếm port.
- Chạy dev server xong, app tự nhận ra địa chỉ kiểu `http://localhost:3000` và thêm tab **Preview** để xem trang ngay trong app. Bấm link localhost trong terminal cũng mở Preview.
- **Gửi cho agent:** gửi đoạn anh đang bôi đen (hoặc 60 dòng cuối) vào ô chat, rồi hỏi Claude/Codex vì sao lỗi.

### 6. Git (Source Control)

Sidebar phải có hai tab: **Explorer** và **Source Control**. Badge trên tab là số file đang thay đổi. Bấm tên nhánh ở Explorer cũng mở tab này.

- **Nhánh:** bấm tên nhánh để đổi nhánh, hoặc gõ tên mới rồi Enter để **tạo nhánh mới** từ nhánh hiện tại. Nhánh chỉ có trên remote thì bấm để kéo về máy. Cạnh tên nhánh có ↑ (commit chưa push) và ↓ (commit mới trên remote).
- **Stage:** di chuột vào file rồi bấm **+** / **−**, hoặc stage / bỏ stage cả nhóm. Nút ↺ huỷ thay đổi của file (có hỏi lại, không hoàn tác được).
- **Xem diff:** bấm vào file để mở editor ở chế độ so sánh với HEAD.
- **Commit:** nhập message rồi bấm **Commit** (⌘Enter). Chưa stage file nào thì app commit **tất cả** thay đổi. Mũi tên cạnh nút có **Commit & Push** (⇧⌘Enter) và **Sửa commit gần nhất** (amend).
- **Viết bằng AI:** nhờ Claude Haiku (hoặc Codex, theo agent đang chọn ở ô chat) đọc diff và viết commit message. Tốn khoảng 20–30k token.
- **Push / Pull / Fetch.** Nhánh mới chưa có trên remote thì nút là **Publish nhánh** (tự `push -u`).
- Push cần git đã đăng nhập remote (SSH key, `gh auth login` hoặc credential manager). Nếu chưa, app báo lỗi rõ ràng thay vì treo chờ mật khẩu.

### 7. Làm việc với file

- Bấm file trong Explorer để mở bằng editor Monaco. **⌘S** để lưu.
- File đã thay đổi so với git có nút **Diff** để so với HEAD.
- File bị agent sửa trong 5 phút gần nhất có chấm cam. Nếu anh không đang sửa dở, file đang mở tự tải lại nội dung mới.

**Nhiều repo cùng lúc (giống workspace của VS Code):** bấm nút 📁+ trên thanh Explorer để thêm một thư mục khác vào workspace của project đang mở.
- Explorer hiện mỗi thư mục thành một nhánh riêng, có tên nhánh git và màu thay đổi. Di chuột vào tên thư mục rồi bấm × để bỏ khỏi workspace (file không bị xoá).
- Source Control có danh sách **Repositories**. Chọn repo nào thì commit, push, đổi nhánh trên repo đó.
- Agent (Claude, Codex) tự được cấp quyền đọc và sửa các thư mục trong workspace, nên có thể giao việc liên quan tới cả hai repo trong cùng một cuộc chat.
- Workspace được nhớ theo project, lần sau mở lại vẫn còn.

### Phím tắt

| Phím | Tác dụng |
|---|---|
| ⌘N | Cuộc trò chuyện mới |
| ⌘O | Mở project |
| ⌘B | Ẩn/hiện sidebar trái |
| ⇧⌘E | Ẩn/hiện Explorer |
| ⌘S | Lưu file đang mở |
| ⌃` hoặc ⌘J | Ẩn/hiện Terminal |
| Enter / Shift+Enter | Gửi / xuống dòng |
| ⌘Enter | Chạy pipeline (trong hộp nhập task) |
| ⌘R | Tải lại cửa sổ (app native) |

---

## Quyền của agent

| Mức | Claude Code | Codex |
|---|---|---|
| **Chỉ đọc** | chỉ cho Read / Grep / Glob / Web | `sandbox_mode=read-only` |
| **Sửa file** | `acceptEdits`, chặn Bash | `workspace-write` |
| **Sửa + chạy lệnh** | `acceptEdits` + Bash | `workspace-write` |
| **Toàn quyền** | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |

Antigravity (`agy`): **Chỉ đọc** không tự duyệt tool. **Sửa file / Sửa + chạy lệnh** dùng `--dangerously-skip-permissions --sandbox`. **Toàn quyền** dùng `--dangerously-skip-permissions`, không kèm sandbox.

App chạy CLI ở chế độ không tương tác, nên không có bước hỏi quyền giữa chừng. Hãy chọn mức quyền phù hợp **trước khi** gửi. Bước plan và review nên để **Chỉ đọc**.

## Chi phí và quota

- Mỗi lần gọi CLI đều tốn một phần cố định (Codex khoảng 17k token, Claude khoảng 24k token vào). Phần lớn được cache nên rẻ hơn con số này.
- App **tiếp tục session cũ** (`--resume`) khi cùng một agent làm tiếp, để tận dụng cache.
- Pipeline mẫu dùng model mạnh (Opus, GPT-6-Sol xhigh…). Muốn tiết kiệm thì đổi các bước sang Haiku / Sonnet / GPT-5.5 với effort thấp.
- Theo dõi quota ở bảng **Usage**.

## Dữ liệu và bảo mật

- Server chỉ lắng nghe ở `127.0.0.1`. Mỗi lần khởi động tạo một **token ngẫu nhiên**, mọi API và WebSocket đều kiểm tra token, Host và Origin, nên trang web khác không gọi được vào app.
- App **không đọc** mật khẩu hay token đăng nhập của Claude/Codex. Mọi thứ đi qua CLI chính chủ của từng hãng.
- Dữ liệu của app nằm trong `~/.agentdesk/` (đổi được bằng biến môi trường `AGENTDESK_HOME`):
  - `conversations/`: cuộc trò chuyện và trạng thái pipeline.
  - `roles.json`, `pipelines.json`: vai trò và template.
  - `recent.json`: project gần đây.
  - `bin/AgentDesk`: cửa sổ native, tự biên dịch từ `native/AgentDeskWindow.swift`.
- Session gốc của Claude/Codex **chỉ được đọc**. App không sửa hay xoá chúng. Xoá một cuộc trò chuyện trong app chỉ xoá bản lưu của app.

## Khắc phục sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `AgentDesk cần Node >= 23.6` | Cập nhật Node (`nvm install 24`) |
| Chấm đỏ cạnh Claude/Codex ở bảng Usage | CLI chưa cài hoặc chưa đăng nhập. Chạy `claude` / `codex login` trong terminal |
| Codex báo model *not supported* | Cập nhật CLI: `npm i -g @openai/codex@latest` |
| Codex báo `'max' is not supported` | Model đó không hỗ trợ effort đang chọn, hạ effort xuống |
| Cửa sổ không mở | Chạy `agentdesk --no-open` rồi mở URL được in ra, hoặc thử `agentdesk --browser` |
| Port 4545 bị chiếm | App tự chọn port khác, hoặc dùng `--port` |
| Sửa code UI mà không thấy thay đổi | Chạy `npm run build` rồi mở lại app |

## Phát triển

```bash
npm run dev        # server :3001 + Vite hot reload :5173
# mở http://localhost:5173/?token=dev
npm run typecheck
npm run build
```

```
bin/agentdesk.js        lệnh khởi động: build UI lần đầu, mở cửa sổ native / Chrome --app
native/                 cửa sổ macOS (Swift + WKWebView)
server/                 Node, chạy .ts trực tiếp
  runner.ts             gọi claude / codex, chuẩn hoá stream JSON của hai CLI
  conversations.ts      lượt chat, chuyển ngữ cảnh giữa hai agent
  pipeline.ts           chạy pipeline: duyệt, pass/fail, vòng lặp
  sessions.ts           đọc session gốc trong ~/.claude và ~/.codex
  usage.ts              usage 5h/tuần, bank reset của Codex
  projects.ts           cây file, git status, theo dõi thay đổi file
  terminals.ts          terminal tương tác (qua pty_host.py)
  git.ts                Source Control: status, nhánh, stage, commit, push/pull
  roles.ts              vai trò và pipeline mặc định
shared/types.ts         kiểu dữ liệu dùng chung server ↔ UI
ui/                     React + Vite + Tailwind + React Flow + Monaco
```

Cách hoạt động: mỗi lượt chat, server chạy
- `claude -p --output-format stream-json`, hoặc
- `codex exec --json`

trong thư mục project, đọc kết quả stream từng dòng, chuẩn hoá thành các khối (text / suy nghĩ / tool / lỗi) rồi đẩy qua WebSocket lên giao diện.

---

## Giấy phép

Mã nguồn mở theo giấy phép **[MIT](LICENSE)**. © 2026 ThinhTP204.

- **Được:** dùng miễn phí (kể cả thương mại), sửa, phân phối lại, gộp vào dự án khác.
- **Điều kiện:** giữ nguyên dòng bản quyền và nội dung giấy phép trong mọi bản sao hoặc bản sửa đổi.
- **Không bảo hành:** phần mềm cung cấp "nguyên trạng"; tác giả không chịu trách nhiệm cho thiệt hại khi sử dụng.

AgentDesk chỉ gọi các CLI `claude`, `codex`, `agy` đã cài trên máy bạn. Các CLI đó và dịch vụ phía sau thuộc Anthropic, OpenAI, Google, theo điều khoản riêng của từng hãng, không nằm trong giấy phép này.
