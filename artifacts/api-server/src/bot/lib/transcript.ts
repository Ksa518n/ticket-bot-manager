import { Message, Collection, Snowflake } from "discord.js";

interface TranscriptMessage {
  author: string;
  authorId: string;
  avatarUrl: string;
  content: string;
  timestamp: string;
  attachments: string[];
  embeds: number;
  isBot: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

export function generateTranscript(
  messages: Collection<Snowflake, Message>,
  ticketNumber: number,
  category: string,
  openerTag: string,
  guildName: string
): Buffer {
  const msgs: TranscriptMessage[] = messages
    .filter((m) => !m.system)
    .map((m) => ({
      author: m.author.tag,
      authorId: m.author.id,
      avatarUrl: m.author.displayAvatarURL({ size: 32 }),
      content: m.content,
      timestamp: new Date(m.createdTimestamp).toLocaleString("ar-SA", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      }),
      attachments: m.attachments.map((a) => a.url),
      embeds: m.embeds.length,
      isBot: m.author.bot,
    }));

  const messageRows = msgs
    .map((m) => {
      const attachmentHtml = m.attachments
        .map((url) =>
          /\.(png|jpg|jpeg|gif|webp)$/i.test(url)
            ? `<img src="${url}" class="attach-img" alt="attachment" />`
            : `<a href="${url}" class="attach-link" target="_blank">📎 مرفق</a>`
        )
        .join("");

      const embedHint = m.embeds > 0 ? `<span class="embed-hint">[${m.embeds} embed]</span>` : "";
      const contentHtml = m.content ? `<div class="msg-content">${escapeHtml(m.content)}</div>` : "";
      const botBadge = m.isBot ? `<span class="bot-badge">BOT</span>` : "";

      return `
        <div class="msg-row">
          <img src="${m.avatarUrl}" class="avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
          <div class="msg-body">
            <div class="msg-header">
              <span class="author">${escapeHtml(m.author)}</span>
              ${botBadge}
              <span class="timestamp">${m.timestamp}</span>
            </div>
            ${contentHtml}
            ${embedHint}
            ${attachmentHtml}
          </div>
        </div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transcript - Ticket #${ticketNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #313338;
      color: #dcddde;
      font-family: "Whitney", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 15px;
      direction: rtl;
    }
    .header {
      background: #1e1f22;
      padding: 20px 30px;
      border-bottom: 2px solid #e67e22;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .header-icon { font-size: 32px; }
    .header-info h1 { font-size: 20px; color: #fff; }
    .header-info p { color: #96989d; font-size: 13px; margin-top: 3px; }
    .meta-bar {
      background: #2b2d31;
      padding: 12px 30px;
      display: flex;
      gap: 30px;
      flex-wrap: wrap;
      border-bottom: 1px solid #3f4147;
    }
    .meta-item { font-size: 13px; color: #96989d; }
    .meta-item span { color: #dcddde; font-weight: 600; }
    .messages { padding: 20px 30px; max-width: 900px; margin: 0 auto; }
    .msg-row {
      display: flex;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid #3f414740;
    }
    .msg-row:hover { background: #2e3035; border-radius: 4px; padding: 8px 6px; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
    .msg-body { flex: 1; }
    .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
    .author { font-weight: 600; color: #fff; }
    .bot-badge {
      background: #5865f2;
      color: #fff;
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 4px;
      font-weight: 700;
    }
    .timestamp { font-size: 12px; color: #72767d; }
    .msg-content { line-height: 1.5; word-break: break-word; }
    .embed-hint { color: #72767d; font-style: italic; font-size: 13px; }
    .attach-img { max-width: 300px; border-radius: 6px; margin-top: 6px; display: block; }
    .attach-link { color: #00aff4; text-decoration: none; }
    .attach-link:hover { text-decoration: underline; }
    .footer {
      text-align: center;
      padding: 20px;
      color: #72767d;
      font-size: 12px;
      border-top: 1px solid #3f4147;
      margin-top: 20px;
    }
    @media (max-width: 600px) {
      .header { padding: 15px; }
      .messages { padding: 10px 15px; }
      .meta-bar { padding: 10px 15px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-icon">🎫</div>
    <div class="header-info">
      <h1>سجل التذكرة #${ticketNumber}</h1>
      <p>${guildName} — ${category}</p>
    </div>
  </div>
  <div class="meta-bar">
    <div class="meta-item">📂 القسم: <span>${category}</span></div>
    <div class="meta-item">👤 الفاتح: <span>${escapeHtml(openerTag)}</span></div>
    <div class="meta-item">💬 عدد الرسائل: <span>${msgs.length}</span></div>
    <div class="meta-item">📅 التصدير: <span>${new Date().toLocaleString("ar-SA")}</span></div>
  </div>
  <div class="messages">
    ${messageRows || '<p style="color:#72767d;text-align:center;padding:40px">لا توجد رسائل</p>'}
  </div>
  <div class="footer">
    تم إنشاء هذا السجل تلقائياً عند إغلاق التذكرة • ${guildName}
  </div>
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}
