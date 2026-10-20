require("dotenv").config();
const express = require("express");
const http = require("http");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = Number(process.env.BANK_PORT || 4002);
const DELAY_MS = Math.max(0, Number(process.env.DELAY_MS || 0));
const FAIL_RATE = Math.min(1, Math.max(0, Number(process.env.FAIL_RATE || 0)));
const DROP_RATE = Math.min(1, Math.max(0, Number(process.env.DROP_RATE || 0)));

const chargesByKey = new Map();
let requests = 0;
let charges = 0;
let duplicates = 0;
let connections = 0;

const server = http.createServer(app);
server.on("connection", (socket) => {
  connections += 1;
  console.log(`[TCP] connection #${connections} from ${socket.remoteAddress}:${socket.remotePort}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post("/charges", async (req, res) => {
  requests += 1;
  const { reference, amount } = req.body || {};
  const key = req.get("Idempotency-Key");

  if (!reference || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return res.status(400).json({ error: "reference và amount nguyên dương là bắt buộc" });
  }
  if (!key) {
    return res.status(400).json({ error: "Thiếu header Idempotency-Key" });
  }

  // Cùng khóa đã được xử lý: trả lại giao dịch cũ, tuyệt đối không trừ lần nữa.
  if (chargesByKey.has(key)) {
    const oldCharge = chargesByKey.get(key);
    if (oldCharge.reference !== reference || oldCharge.amount !== amount) {
      return res.status(409).json({ error: "Idempotency-Key đã dùng cho nội dung khác" });
    }
    return res.status(201).json({ ...oldCharge, duplicateRequest: true });
  }

  if (DELAY_MS) await sleep(DELAY_MS);

  // Lỗi 500 xảy ra trước khi ngân hàng trừ tiền.
  if (Math.random() < FAIL_RATE) {
    return res.status(500).json({ error: "Lỗi tạm thời từ ngân hàng" });
  }

  if (amount > 20000000) {
    return res.status(402).json({ error: "Vượt hạn mức giao dịch 20.000.000đ" });
  }

  const charge = {
    chargeId: `CH-${crypto.randomUUID()}`,
    reference,
    amount,
    createdAt: new Date().toISOString()
  };
  chargesByKey.set(key, charge);
  charges += 1;

  // Ngân hàng đã trừ tiền nhưng cắt kết nối trước khi trả lời.
  if (Math.random() < DROP_RATE) {
    req.socket.destroy();
    return;
  }

  return res.status(201).json(charge);
});

app.get("/stats", (req, res) => {
  res.json({ connections, requests, charges, duplicates });
});

server.listen(PORT, () => {
  console.log(`Bank Service listening on http://localhost:${PORT}`);
  console.log(`DELAY_MS=${DELAY_MS}, FAIL_RATE=${FAIL_RATE}, DROP_RATE=${DROP_RATE}`);
});
