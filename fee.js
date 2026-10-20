require("dotenv").config();
const express = require("express");
const http = require("http");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = Number(process.env.FEE_PORT || 4001);
const BANK_URL = (process.env.BANK_URL || "http://localhost:4002").replace(/\/+$/, "");
const TIMEOUT_MS = 4000;
const MAX_RETRIES = 3;

// HTTP keep-alive: tái sử dụng socket; tối đa 10 socket đồng thời.
const bankAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 10,
  timeout: 6000
});
const bankClient = axios.create({
  baseURL: BANK_URL,
  timeout: TIMEOUT_MS,
  httpAgent: bankAgent,
  headers: { "Content-Type": "application/json" },
  validateStatus: () => true
});

// Dữ liệu giả lập trong bộ nhớ theo yêu cầu đề bài.
const balances = new Map([
  ["1", 50000000],
  ["2", 0],
  ["3", 3200000]
]);
const payments = new Map();
let nextPayment = 1;

function money(value) {
  return `${value.toLocaleString("vi-VN")}đ`;
}

app.get("/students/:id/fees", (req, res) => {
  const id = req.params.id;
  if (!balances.has(id)) return res.status(404).json({ error: "Không tìm thấy sinh viên" });
  // Endpoint chỉ đọc bộ nhớ, không gọi ngân hàng nên vẫn phản hồi nhanh khi ngân hàng lỗi.
  return res.json({ studentId: id, outstanding: balances.get(id) });
});

app.get("/payments/:paymentId", (req, res) => {
  const payment = payments.get(req.params.paymentId);
  if (!payment) return res.status(404).json({ error: "Không tìm thấy payment" });
  return res.json(payment);
});

app.post("/students/:id/payments", async (req, res) => {
  const studentId = req.params.id;
  const amount = req.body && req.body.amount;

  if (!balances.has(studentId)) return res.status(404).json({ error: "Không tìm thấy sinh viên" });
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount phải là số nguyên dương" });
  }
  if (amount > balances.get(studentId)) {
    return res.status(400).json({ error: "Số tiền thanh toán vượt công nợ", outstanding: balances.get(studentId) });
  }

  const paymentId = `P${nextPayment++}`;
  const idempotencyKey = crypto.randomUUID();
  const payment = {
    paymentId, studentId, amount, status: "PROCESSING",
    createdAt: new Date().toISOString()
  };
  payments.set(paymentId, payment);

  // Một payment chỉ được giảm công nợ tối đa một lần.
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await bankClient.post("/charges", {
        reference: paymentId,
        amount
      }, { headers: { "Idempotency-Key": idempotencyKey } });

      if (response.status === 201) {
        if (payment.status !== "PAID") {
          balances.set(studentId, balances.get(studentId) - amount);
          payment.status = "PAID";
          payment.chargeId = response.data.chargeId;
          payment.paidAt = new Date().toISOString();
        }
        return res.status(201).json(payment);
      }

      // Từ chối rõ ràng: không retry, giữ nguyên mã HTTP ngân hàng.
      if (response.status === 400 || response.status === 402 || response.status === 409) {
        payment.status = "FAILED";
        payment.error = response.data.error || "Ngân hàng từ chối giao dịch";
        return res.status(response.status).json({
          error: payment.error, paymentId, status: "FAILED"
        });
      }

      // 500 được định nghĩa trong lab là lỗi trước khi trừ tiền, nên retry cùng key.
      if (response.status >= 500 && attempt < MAX_RETRIES) continue;
      if (response.status >= 500) {
        payment.status = "FAILED";
        payment.error = "Ngân hàng tạm thời không xử lý được giao dịch";
        return res.status(503).json({ error: payment.error, paymentId, status: "FAILED" });
      }

      payment.status = "FAILED";
      payment.error = `Phản hồi không mong đợi từ ngân hàng: ${response.status}`;
      return res.status(502).json({ error: payment.error, paymentId, status: "FAILED" });
    } catch (error) {
      lastError = error;
      const code = error.code;
      const timedOut = code === "ECONNABORTED" || code === "ETIMEDOUT";
      const refused = code === "ECONNREFUSED" || code === "ENOTFOUND";
      const connectionLost = ["ECONNRESET", "EPIPE", "ERR_SOCKET_CLOSED"].includes(code);

      // Không có kết nối TCP ngay từ đầu: chắc chắn chưa gửi giao dịch.
      if (refused) {
        payment.status = "FAILED";
        payment.error = "Không kết nối được tới ngân hàng";
        return res.status(503).json({ error: payment.error, paymentId, status: "FAILED" });
      }

      // Kết nối đứt giữa chừng: thử lại cùng idempotency key để tra lại kết quả cũ.
      if (connectionLost && attempt < MAX_RETRIES) continue;

      // Timeout/đứt kết nối có thể xảy ra sau khi ngân hàng đã trừ tiền.
      if (timedOut || connectionLost) {
        payment.status = "PENDING";
        payment.error = "Chưa xác định ngân hàng đã trừ tiền hay chưa";
        return res.status(504).json({ error: payment.error, paymentId, status: "PENDING" });
      }

      payment.status = "FAILED";
      payment.error = lastError.message || "Lỗi khi gọi ngân hàng";
      return res.status(503).json({ error: payment.error, paymentId, status: "FAILED" });
    }
  }

  payment.status = "FAILED";
  return res.status(503).json({
    error: "Không thể xử lý thanh toán",
    paymentId,
    status: "FAILED"
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Fee Service listening on http://localhost:${PORT}`);
  console.log(`BANK_URL=${BANK_URL}`);
});
