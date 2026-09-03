const ACTION_COPY = {
  authentication: "Reconnect the publish channel, then run the agent again.",
  configuration: "Review the agent settings, correct the issue, then run it again.",
  source_access: "Refresh the source collection and confirm its videos are still accessible.",
  source_exhausted: "Add or refresh source videos, then run the agent again.",
  media: "AutoYT will try a fresh media download on the next run.",
  platform_limit: "Wait for the platform limit to reset. AutoYT will use the next available run.",
  publishing: "Check the publish connection and retry the run.",
  transient: "AutoYT will retry after a short backoff.",
  unknown: "Open the run details, review the failure, and retry when ready.",
};

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanText(value = "", fallback = "—") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function readableLabel(value = "") {
  return cleanText(value, "Run").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formattedDate(value, timezone = "Africa/Nairobi") {
  const date = new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(safeDate);
  } catch {
    return safeDate.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }
}

export function buildAutomationFailureEmail(input = {}) {
  const agentName = cleanText(input.agentName, "Automation agent");
  const channelTitle = cleanText(input.channelTitle, "Publish channel");
  const category = cleanText(input.category, "unknown").toLowerCase();
  const phase = readableLabel(input.phase || "automation run");
  const error = cleanText(input.error, "The automation run ended before a video was posted.");
  const action = cleanText(input.actionText, ACTION_COPY[category] || ACTION_COPY.unknown);
  const timezone = cleanText(input.timezone, "Africa/Nairobi");
  const failedAt = formattedDate(input.failedAt, timezone);
  const retryAt = input.retryAt ? formattedDate(input.retryAt, timezone) : "No automatic retry scheduled";
  const runUrl = cleanText(input.runUrl, "https://autoyt.cc/automation");
  const runId = cleanText(input.runId, "Unavailable");
  const retryLabel = input.retryScheduled ? "Automatic retry" : "Next step";
  const subject = `[AutoYT] ${agentName} could not post`;
  const preheader = `${agentName} stopped during ${phase.toLowerCase()}. ${action}`;
  const safe = Object.fromEntries(Object.entries({ agentName, channelTitle, phase, category: readableLabel(category), error, action, failedAt, retryAt, runUrl, runId, retryLabel, preheader }).map(([key, value]) => [key, escapeHtml(value)]));

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin: 0; padding: 0; background: #f5f2e9; color: #1a1a1a; font-family: "Avenir Next", Avenir, "Segoe UI", Arial, sans-serif; }
    .preheader { display: none !important; max-height: 0; max-width: 0; overflow: hidden; opacity: 0; color: transparent; }
    .shell { width: 100%; background: #f5f2e9; }
    .card { width: 100%; max-width: 640px; background: #fffef8; border: 1px solid #ded9c9; border-radius: 20px; overflow: hidden; }
    .ink { color: #1a1a1a; }
    .muted { color: #625f55; }
    .panel { background: #f2efe5; border: 1px solid #ded9c9; }
    .button { background: #f9dc0b; color: #1a1a1a !important; border: 1px solid #d8bf00; text-decoration: none; }
    .wordmark { color: #1a1a1a; }
    @media (prefers-color-scheme: dark) {
      body, .shell { background: #10130f !important; color: #f8f5e8 !important; }
      .card { background: #191d18 !important; border-color: #34392f !important; }
      .ink, .wordmark { color: #f8f5e8 !important; }
      .muted { color: #b9b7aa !important; }
      .panel { background: #22271f !important; border-color: #3a4035 !important; }
      .button { background: #f9dc0b !important; color: #1a1a1a !important; border-color: #f9dc0b !important; }
    }
    @media only screen and (max-width: 680px) {
      .outer { padding: 16px 10px !important; }
      .content { padding: 26px 22px 24px !important; }
      .title { font-size: 27px !important; line-height: 32px !important; }
      .detail-cell { display: block !important; width: auto !important; padding: 0 0 16px !important; }
    }
  </style>
</head>
<body>
  <div class="preheader">${safe.preheader}</div>
  <table role="presentation" class="shell" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr><td class="outer" align="center" style="padding:32px 16px;">
      <table role="presentation" class="card" width="640" cellspacing="0" cellpadding="0" border="0">
        <tr><td style="height:8px;background:#f9dc0b;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td class="content" style="padding:34px 40px 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td valign="middle"><span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:9px;background:#f9dc0b;color:#1a1a1a;text-align:center;font-size:14px;font-weight:900;">A</span><span class="wordmark" style="display:inline-block;margin-left:9px;vertical-align:9px;font-size:18px;font-weight:900;letter-spacing:-0.4px;">AutoYT</span></td>
              <td align="right" valign="middle"><span style="display:inline-block;border-radius:999px;background:#fff0ec;color:#9b2c20;padding:7px 10px;font-size:12px;font-weight:800;">Run failed</span></td>
            </tr>
          </table>
          <h1 class="ink title" style="margin:32px 0 10px;font-family:Georgia,serif;font-size:34px;line-height:40px;letter-spacing:-0.8px;">${safe.agentName} could not post</h1>
          <p class="muted" style="margin:0 0 26px;font-size:15px;line-height:23px;overflow-wrap:anywhere;">${safe.channelTitle} · ${safe.failedAt}</p>
          <table role="presentation" class="panel" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:14px;">
            <tr><td style="padding:20px 20px 8px;"><div class="muted" style="font-size:11px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">Issue</div><div class="ink" style="margin-top:7px;font-size:15px;line-height:23px;font-weight:700;overflow-wrap:anywhere;">${safe.error}</div></td></tr>
            <tr><td style="padding:12px 20px 20px;"><div class="muted" style="font-size:11px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">Recovery</div><div class="ink" style="margin-top:7px;font-size:15px;line-height:23px;overflow-wrap:anywhere;">${safe.action}</div></td></tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;"><tr>
            <td class="detail-cell" width="50%" valign="top" style="padding-right:12px;"><div class="muted" style="font-size:11px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">Stopped at</div><div class="ink" style="margin-top:6px;font-size:14px;line-height:20px;font-weight:700;">${safe.phase}</div></td>
            <td class="detail-cell" width="50%" valign="top" style="padding-left:12px;"><div class="muted" style="font-size:11px;font-weight:800;letter-spacing:0.9px;text-transform:uppercase;">${safe.retryLabel}</div><div class="ink" style="margin-top:6px;font-size:14px;line-height:20px;font-weight:700;">${safe.retryAt}</div></td>
          </tr></table>
          <div style="margin-top:28px;"><a class="button" href="${safe.runUrl}" style="display:inline-block;border-radius:11px;padding:13px 18px;font-size:14px;font-weight:900;">Open run details</a></div>
          <p class="muted" style="margin:28px 0 0;font-size:11px;line-height:18px;overflow-wrap:anywhere;">Run ID: ${safe.runId}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    "AutoYT — Run failed",
    "",
    `${agentName} could not post to ${channelTitle}.`,
    `Failed: ${failedAt}`,
    `Stopped at: ${phase}`,
    `Issue: ${error}`,
    `Recovery: ${action}`,
    `${retryLabel}: ${retryAt}`,
    `Run details: ${runUrl}`,
    `Run ID: ${runId}`,
  ].join("\n");

  return { subject, html, text };
}

export async function sendAutomationFailureEmail(message, options = {}) {
  const configuredKey = Object.prototype.hasOwnProperty.call(options, "apiKey")
    ? options.apiKey
    : process.env.RESEND_API_KEY || process.env.AUTOMATION_ALERT_RESEND_API_KEY || "";
  const apiKey = String(configuredKey || "").trim();
  if (!apiKey) return { sent: false, retryable: true, reason: "email_provider_not_configured" };
  const to = String(message.to || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) return { sent: false, retryable: false, reason: "recipient_email_invalid" };
  const from = String(options.from || process.env.AUTOMATION_ALERT_FROM || "AutoYT <alerts@autoyt.cc>").trim();
  const replyTo = String(options.replyTo || process.env.AUTOMATION_ALERT_REPLY_TO || "").trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(Number(options.timeoutMs) || 15000, 1000));
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: message.subject, html: message.html, text: message.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { sent: false, retryable: response.status === 429 || response.status >= 500, reason: String(data?.message || data?.error || `email_provider_${response.status}`).slice(0, 500) };
    return { sent: true, retryable: false, provider: "resend", id: String(data?.id || "") };
  } catch (error) {
    return { sent: false, retryable: true, reason: error instanceof Error ? error.message : "email_delivery_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
