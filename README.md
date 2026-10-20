# LAB 3 — Kết nối và duy trì kết nối giữa các service

## 1. Yêu cầu
- Node.js >= 18
- Postman (không bắt buộc nếu dùng curl)
- Hai service: Fee Service :4001, Bank Service :4002

## 2. Cài đặt
Mở terminal trong thư mục `lab3-payment`:

```bash
npm install
```

## 3. Khởi động
Mở **terminal 1**:
```bash
npm run bank
```

Mở **terminal 2**:
```bash
npm run fee
```

## 4. API
### Xem công nợ
`GET http://localhost:4001/students/1/fees`

### Thanh toán
`POST http://localhost:4001/students/1/payments`
Header: `Content-Type: application/json`
Body:
```json
{ "amount": 100000 }
```

### Xem trạng thái payment
`GET http://localhost:4001/payments/P1`

### Thống kê ngân hàng
`GET http://localhost:4002/stats`

## 5. Tình huống 1 — Ngân hàng tắt rồi bật lại
1. Chạy Fee Service nhưng không chạy Bank Service.
2. Gửi `POST /students/1/payments` với `{ "amount": 100000 }`.
3. Kỳ vọng: HTTP 503, JSON có `error`, `paymentId`, `status: "FAILED"`.
4. Gọi `GET /students/1/fees`: vẫn HTTP 200.
5. Khởi động Bank Service, không khởi động lại Fee Service.
6. Gửi một payment mới: kỳ vọng HTTP 201.
7. Đổi `.env` `BANK_URL=http://localhost:4999`, khởi động lại Fee Service và kiểm tra vẫn trả lỗi nhanh; khôi phục URL sau khi test.

## 6. Tình huống 2 — Ngân hàng chậm
1. Trong `.env`, đặt `DELAY_MS=5000`, `FAIL_RATE=0`, `DROP_RATE=0`.
2. Khởi động lại Bank Service.
3. Gửi thanh toán: kỳ vọng Fee Service timeout khoảng 4 giây, HTTP 504 và `status: "PENDING"`.
4. Gọi `GET /students/1/fees` trong khi payment chờ: endpoint đọc bộ nhớ độc lập với ngân hàng.
5. Đề yêu cầu tổng thời gian <= 4,5 giây và GET fees < 300ms. Ghi lại số đo thực tế của máy.

## 7. Tình huống 3 — Keep-alive
1. Đặt `DELAY_MS=0`, `FAIL_RATE=0`, `DROP_RATE=0`; khởi động lại Bank Service.
2. Chạy `npm run load`.
3. Ghi lại `elapsedMs`, số kết nối TCP mới, số charge và duplicates.
4. Mục tiêu: 200/200 thành công, TCP mới <= 20, duplicates = 0.
5. Chờ 6 giây rồi chạy lại `npm run load`; các request tiếp theo phải thành công dù bank đã đóng socket idle.

## 8. Tình huống 4 — Lỗi giữa chừng, 500 và từ chối
### (a) Đã trừ tiền nhưng rớt kết nối
- Đặt `DROP_RATE=0.3`, `FAIL_RATE=0`, `DELAY_MS=0`, khởi động lại bank.
- Gửi 60 payments, mỗi lần 1.000đ (hoặc dùng script mở rộng).
- Khi kết nối bị reset, Fee Service thử lại với cùng `Idempotency-Key`. Nếu nhận được phản hồi cũ, payment thành PAID mà không charge thêm. Nếu vẫn không rõ kết quả sau số lần thử, trả 504 PENDING.
- Đối chiếu `charges`, số payment PAID và `duplicates`.

### (b) Lỗi 500 trước khi trừ tiền
- Đặt `FAIL_RATE=0.3`, `DROP_RATE=0`, khởi động lại bank.
- Fee Service retry tối đa 3 lần với cùng key khi nhận 500.
- Đối chiếu số thanh toán thành công và charges.

### (c) Vượt hạn mức
- Đặt `FAIL_RATE=0`, `DROP_RATE=0`, khởi động lại bank.
- Gửi `{ "amount": 25000000 }` từ sinh viên 1.
- Kỳ vọng HTTP 402, status FAILED và bank chỉ nhận một yêu cầu cho payment đó; không retry lỗi từ chối.

## 9. Mã HTTP
| Trường hợp | HTTP | status |
|---|---:|---|
| Ngân hàng xác nhận trừ tiền | 201 | PAID |
| Ngân hàng từ chối rõ ràng | Giữ mã bank, ví dụ 402 | FAILED |
| Không kết nối được | 503 | FAILED |
| Timeout/đứt kết nối chưa rõ kết quả | 504 | PENDING |

## 10. Lưu ý khi báo cáo
- Dữ liệu chỉ lưu trong RAM; restart service sẽ reset công nợ, payments và stats.
- Số liệu đo phải lấy từ lần chạy thực tế, không tự điền số giả.
- Đây là mô hình lab. Hệ thống thực tế cần lưu idempotency/payment bền vững trong DB và có quy trình đối soát PENDING.
