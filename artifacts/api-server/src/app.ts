import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const startTime = Date.now();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Status page ───────────────────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  const uptimeMs = Date.now() - startTime;
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const uptime = `${h}h ${m}m ${s}s`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Discord Ticket Bot</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:40px 48px;max-width:520px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}
    .avatar{width:90px;height:90px;border-radius:50%;background:linear-gradient(135deg,#5865f2,#eb459e);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:40px}
    h1{font-size:1.7rem;font-weight:700;margin-bottom:6px;color:#fff}
    .tag{color:#8b949e;font-size:.95rem;margin-bottom:28px}
    .badge{display:inline-flex;align-items:center;gap:8px;background:#1f3a2a;color:#3fb950;border:1px solid #2ea043;border-radius:20px;padding:6px 18px;font-size:.9rem;font-weight:600;margin-bottom:28px}
    .badge span{width:8px;height:8px;border-radius:50%;background:#3fb950;animation:pulse 1.5s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px}
    .stat{background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:14px}
    .stat-label{font-size:.75rem;color:#8b949e;margin-bottom:4px}
    .stat-value{font-size:1.1rem;font-weight:700;color:#e6edf3}
    .footer{font-size:.8rem;color:#484f58;border-top:1px solid #21262d;padding-top:16px}
  </style>
</head>
<body>
  <div class="card">
    <div class="avatar">🎫</div>
    <h1>Discord Ticket Bot</h1>
    <p class="tag">بوت تذاكر الدعم — Arabic Tickets System</p>
    <div class="badge"><span></span> Online &amp; Running</div>
    <div class="grid">
      <div class="stat">
        <div class="stat-label">⏱️ وقت التشغيل</div>
        <div class="stat-value">${uptime}</div>
      </div>
      <div class="stat">
        <div class="stat-label">🌍 البيئة</div>
        <div class="stat-value">${process.env["NODE_ENV"] ?? "development"}</div>
      </div>
      <div class="stat">
        <div class="stat-label">🤖 مكتبة البوت</div>
        <div class="stat-value">Discord.js v14</div>
      </div>
      <div class="stat">
        <div class="stat-label">🗄️ قاعدة البيانات</div>
        <div class="stat-value">MongoDB</div>
      </div>
    </div>
    <div class="footer">🔒 جميع الأوامر باللغة العربية · Powered by Discord.js &amp; Express</div>
  </div>
</body>
</html>`);
});

app.use("/api", router);

export default app;
