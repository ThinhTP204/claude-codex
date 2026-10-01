# Nhật ký thay đổi

Mỗi phiên bản liệt kê những gì thay đổi. Dòng bắt đầu bằng **Mới:**, **Cải tiến:** hoặc **Sửa lỗi:** để app hiện nhãn tương ứng trong hộp thoại Cập nhật. Khi ra bản mới, thêm mục `## [x.y.z]` ở đầu danh sách, GitHub Actions lấy đúng mục đó làm nội dung Release.

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
