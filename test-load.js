// Gửi 200 yêu cầu, tối đa 10 yêu cầu đồng thời, mỗi yêu cầu 1.000đ.
const FEE_URL = process.env.FEE_URL || "http://localhost:4001";
const BANK_URL = process.env.BANK_URL || "http://localhost:4002";
const TOTAL = 200;
// const TOTAL = 60;
const CONCURRENCY = 10;

async function getStats() {
  const response = await fetch(`${BANK_URL}/stats`);
  return response.json();
}

async function main() {
  const before = await getStats();
  let next = 0;
  let success = 0;
  let failed = 0;
  const start = Date.now();

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= TOTAL) return;
      try {
        const response = await fetch(`${FEE_URL}/students/1/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: 1000 })
        });
        if (response.status === 201) success++;
        else {
          failed++;
          const body = await response.json().catch(() => ({}));
          console.log(`Request ${index + 1}: HTTP ${response.status}`, body);
        }
      } catch (error) {
        failed++;
        console.log(`Request ${index + 1} failed: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsed = Date.now() - start;
  const after = await getStats();

  console.log("\n===== LOAD TEST RESULT =====");
  console.log({ total: TOTAL, concurrency: CONCURRENCY, success, failed, elapsedMs: elapsed });
  console.log("Bank stats before:", before);
  console.log("Bank stats after:", after);
  console.log("New TCP connections:", after.connections - before.connections);
  console.log("New bank requests:", after.requests - before.requests);
  console.log("New charges:", after.charges - before.charges);
  console.log("New duplicates:", after.duplicates - before.duplicates);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
