# Nhật ký thay đổi

Mỗi phiên bản liệt kê những gì thay đổi. Dòng bắt đầu bằng **Mới:**, **Cải tiến:** hoặc **Sửa lỗi:** để app hiện nhãn tương ứng trong hộp thoại Cập nhật. Khi ra bản mới, thêm mục `## [x.y.z]` ở đầu danh sách, GitHub Actions lấy đúng mục đó làm nội dung Release.

## [0.7.1] - 2026-10-01

- Mới: Pipeline chuẩn (Plan → Review plan → Code → Test → Review code) thay cho pipeline cũ; mỗi bước nói rõ làm gì, dựa trên gì, phải trả về gì và thế nào là xong
- Mới: Sơ đồ Flow dạng cây: mỗi bước tỏa ra các mục nó làm ra (phần của plan, tiêu chí đạt, loại test, tiêu chí soát), mỗi mục tách tiếp thành các ý con, rồi hội tụ vào bước sau
- Mới: Bước kiểm tra chấm từng mục; mục chưa đạt có dây đỏ chỉ về, bước trước chỉ sửa đúng mục đó và lần sau chỉ chấm lại mục đó
- Mới: 15 loại test (lint, build, unit, tích hợp, giao diện, hồi quy, bảo mật…), mỗi loại chạy khi phần thay đổi khớp, bật tắt được từng loại
- Mới: Tự sửa được mục, ý con, hướng dẫn và quy tắc của từng bước trong khung cấu hình
- Mới: Nút "Chạy lại từ đầu" bỏ kết quả lần chạy và chạy lại task từ bước đầu tiên
- Cải tiến: Mọi bước của Pipeline chuẩn dừng chờ bạn duyệt, đạt hay chưa đạt
- Cải tiến: Sidebar hiện sẵn agent và model của từng bước pipeline, kể cả bước chưa chạy
- Cải tiến: Chạy từ mã nguồn (`npm run dev`) tự khởi động lại server khi code đổi

## [0.7.0] - 2026-10-01

- Mới: Bảng Tasks dạng Kanban (mục Tasks ở sidebar): Việc cần làm, Đang chạy, Chờ duyệt, Lỗi / tạm dừng, Xong; mỗi thẻ cho thấy giai đoạn (Plan, Review, bước 2/4…), agent, model và việc đang làm
- Mới: Ghi task trước rồi kéo sang Đang chạy để giao cho một vai trò hoặc pipeline; kéo sang Xong để cất đi (thẻ cũ hơn 3 ngày tự ẩn)
- Sửa lỗi: Dừng pipeline lúc đang chờ duyệt không còn để bước đó ở trạng thái "Chờ bạn duyệt"

## [0.6.7] - 2026-10-01

- Cải tiến: Pipeline đỡ tốn quota: bước review nêu đủ mọi lỗi chặn ngay lần đầu, lần chấm lại chỉ kiểm tra các ý cũ hoặc phần mới đổi; sau 2 vòng sửa chưa đạt (hoặc lỗi cũ lặp lại) pipeline tạm dừng hỏi bạn thay vì chạy tiếp
- Sửa lỗi: Danh sách chọn model, effort… mở lần đầu không còn bị tụt xuống đè lên nút

## [0.6.6] - 2026-10-01

- Mới: Đổi model, effort hay agent lúc agent đang chạy thì app tự dừng lượt đó và làm tiếp trong cùng session với cấu hình mới (đếm ngược vài giây, có thể chọn để lượt sau)
- Sửa lỗi: Đổi model, effort… khi đang chọn một vai trò (Plan, Code…) giờ được lưu vào vai trò đó, không bị trả về mặc định
- Cải tiến: Usage hiện phần quota còn lại giống CLI: 100% sau khi reset, giảm dần khi dùng

## [0.6.5] - 2026-10-01

- Sửa lỗi: Nút "Dùng lượt reset" của Codex bấm không được (hộp xác nhận tự đóng trước khi nhận cú bấm)

## [0.6.4] - 2026-10-01

- Cải tiến: Sidebar giống Orca: dòng ngoài là tên session và nhánh; bên trong mục Agent mỗi agent một dòng với icon AI, model, trạng thái, thời gian và việc đang làm hoặc câu trả lời gần nhất

## [0.6.3] - 2026-10-01

- Sửa lỗi: Session đang chạy hiện ngay agent, model và việc đang làm (vd "Claude · Haiku 4.5 · Đang chạy npm test"), không còn chỉ có vòng xoay
- Cải tiến: Bỏ dòng lọc Tất cả / AgentDesk / Claude / Codex; nút chuông và làm mới nằm cạnh ô tìm session

## [0.6.2] - 2026-10-01

- Sửa lỗi: Thông báo của macOS hiện tiếng Việt bị lỗi font (chữ có dấu thành ký tự lạ)

## [0.6.1] - 2026-10-01

- Sửa lỗi: Model mới của Codex (GPT-6.1-Sol, GPT-6-Astra…) hiện ngay khi CLI cập nhật danh sách, không cần tải lại cửa sổ

## [0.6.0] - 2026-10-01

- Mới: Chạy song song: giao cùng task cho 2–5 agent, mỗi agent làm trên một git worktree riêng; so sánh thay đổi từng file rồi chọn một bản đưa vào project
- Mới: Danh sách session giống Orca: session đang chạy lên đầu, có nhánh git, agent đang làm gì và chạy bao lâu; pipeline và các agent song song mở ra thành từng dòng
- Mới: Thông báo của hệ điều hành khi agent xong, gặp lỗi hoặc chờ duyệt (lúc anh đang ở cửa sổ khác), kèm chấm báo session có kết quả chưa xem; tắt bật bằng nút chuông
- Mới: ⌘P mở nhanh file và session; gõ > để chạy lệnh, / để chọn skill, # để đổi nhánh git
- Mới: Nhận xét từng dòng code trong diff hoặc editor, rồi gửi tất cả cho agent trong một tin nhắn
- Cải tiến: Icon Claude, Codex (OpenAI) và Antigravity dùng logo chính thức

## [0.5.0] - 2026-10-01

- Mới: Terminal giống VS Code: chia đôi, chọn shell (zsh, bash, fish…), chạy script trong package.json, phóng to panel, đổi tên terminal
- Mới: Mỗi lệnh trong terminal có chấm xanh (xong) hoặc đỏ (lỗi); bấm vào để chạy lại, copy output hoặc gửi lệnh kèm output cho agent; ⌘↑/⌘↓ nhảy giữa các lệnh
- Mới: Tìm trong terminal (⌘F), bấm đường dẫn file như src/a.ts:12 để mở trong editor, chuột phải để copy/dán
- Mới: Tab Ports: các cổng dev server đang mở, xem trong Preview, mở trình duyệt hoặc dừng process
- Mới: Windows có terminal thật (ConPTY): cls, Tab, màu, vim đều chạy; chọn PowerShell, PowerShell 7, Command Prompt, Git Bash hoặc WSL
- Mới: Gõ /tên-skill trong task khi chạy pipeline: bước nào cũng dùng đúng skill đó, với cả Claude, Codex và Antigravity
- Sửa lỗi: Claude CLI cài qua npm không chạy được trên Windows (bản mới dùng claude.exe)
- Sửa lỗi: Icon app trên Windows không hiện ở shortcut, Start menu và thanh taskbar

## [0.4.4] - 2026-10-01

- Mới: Kéo file hoặc thư mục trong Explorer thả vào thư mục khác để chuyển chỗ, giống VS Code (rê lên thư mục đóng để mở ra, thả vào chỗ trống để đưa ra thư mục gốc)
- Sửa lỗi: Thẻ duyệt bước pipeline và ô chat không còn tràn đè lên terminal khi khung chat thấp; thẻ duyệt tự cuộn
- Sửa lỗi: File đính kèm khi chạy pipeline hiện thành ảnh hoặc thẻ file, không còn chỉ là danh sách đường dẫn

## [0.4.3] - 2026-10-01

- Sửa lỗi: Kiểm tra cập nhật không còn báo "GitHub trả lỗi 403" khi GitHub giới hạn lượt gọi; app tự chuyển sang đường dự phòng và vẫn tìm được bản mới

## [0.4.2] - 2026-10-01

- Mới: Logo mới: ngôi sao AI bốn cánh mang màu của Claude, Codex và Antigravity (icon app trên Mac, Windows, trong app và trang tải)

## [0.4.1] - 2026-10-01

- Cải tiến: Windows cũng được giữ không ngủ trong lúc chờ tự tiếp tục (trước chỉ có Mac)
- Cải tiến: Chữ trong bảng Tự tiếp tục ngắn gọn, dễ hiểu hơn
- Sửa lỗi: Thanh công cụ dưới ô chat không còn rớt dòng khi khung chat hẹp; nút tự rút gọn chỉ còn icon

## [0.4.0] - 2026-10-01

- Mới: Tự tiếp tục: khi agent hoặc pipeline dừng vì hết quota (hay lỗi mạng, máy chủ quá tải), app chờ đúng lúc quota hồi rồi tự gửi continue (pipeline thì chạy tiếp từ bước đang dở); bật ở nút ⟳ cạnh ô chat
- Mới: Kiểm tra theo giờ (vd 05:00, 10:00…): đến mốc, việc còn dở thì chạy tiếp, xong rồi thì bỏ qua; tuỳ chọn mồi quota để chu kỳ 5 giờ bắt đầu sớm
- Mới: Dải thông báo "Tự tiếp tục lúc …" với nút Chạy ngay / Huỷ, nhật ký các lần tự chạy, giới hạn số lần mỗi việc; Mac được giữ thức trong lúc chờ
- Cải tiến: Tự gửi tin nhắn hoặc bấm Dừng sẽ huỷ lịch tự tiếp tục đang chờ

## [0.3.0] - 2026-09-30

- Mới: Cập nhật ngay trong app cài đặt (.dmg / .exe): bấm Cập nhật là tải bản mới và khởi động lại, không cần tải lại bộ cài, không phải bấm "Vẫn mở" lại trên macOS
- Mới: Hộp thoại Cập nhật ghi rõ từng thay đổi của bản mới (lấy từ nhật ký này)
- Sửa lỗi: Kéo đổi độ rộng sidebar trái, sidebar phải và panel Terminal giờ kéo mượt, kéo qua editor hay Preview không bị mất; bấm đúp vào thanh kéo để về mặc định
- Sửa lỗi: Nếu cửa sổ app bị tắt bất thường, server chạy ngầm tự tắt theo thay vì còn sót lại

## [0.2.0] - 2026-09-30

- Mới: Bản cài cho macOS (.dmg) và Windows (bộ cài .exe / .zip), đã có sẵn Node, trang tải tại thinhtp204.github.io/claude-codex
- Mới: Báo lỗi code (Problems) từ TypeScript, ESLint, Biome, Ruff; file lỗi tô đỏ, editor gạch chân, một nút gửi cho agent sửa
- Mới: Chuột phải trong Explorer để tạo, đổi tên, xoá (vào Thùng rác) file và thư mục
- Mới: Gõ / trong ô chat để chọn lệnh và skill của Claude, Codex, Antigravity
- Mới: Mở thư mục cha là tự tìm các repo con (Explorer, Source Control, skill của từng repo)
- Mới: Đính kèm file, dán ảnh chụp màn hình vào chat; xem ảnh và PDF trong editor
- Mới: Pipeline có mục Cần sửa, VERDICT: ASK để hỏi người dùng, chấm lại chỉ kiểm tra ý cũ
- Mới: Model Claude mới (Fable 5.1, Opus 5.5, Sonnet 5.5), workspace nhiều repo, logo mới
- Cải tiến: Thanh tiến trình pipeline gọn hơn, sơ đồ Flow có nút Sắp xếp, ít tốn CPU khi để app mở lâu
- Sửa lỗi: Terminal trên Windows có dấu nhắc PowerShell, ↑↓ gọi lại lệnh cũ, không còn in ra "[A"
- Sửa lỗi: Xoá session gốc của Claude/Codex không còn hiện lại
