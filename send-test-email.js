require("dotenv").config();
const { sendOne, getConfig } = require("./lib/mailer");
const { assertCanSend, recordSend, getQuota } = require("./lib/rate-limit");

async function sendTestEmail() {
  const to = process.env.SMTP_TO || "yahyamahdi4242@gmail.com";

  if (!process.env.SMTP_PASS) {
    console.error("Error: SMTP_PASS environment variable is required.");
    process.exit(1);
  }

  try {
    const cfg = getConfig();
    const quota = getQuota();
    console.log(`Quota: ${quota.remaining}/${quota.maxPerHour} emails remaining this hour`);

    assertCanSend(1);
    console.log("SMTP authentication OK for:", cfg.authUser);

    const info = await sendOne({
      to,
      subject: "Test Email",
      message: "This is a test email from ERA Formation (acci-dz.com).",
    });

    recordSend(1);

    console.log("Email sent:", info.messageId);
    console.log("Response:", info.response);
    console.log(`Quota after send: ${getQuota().remaining}/${getQuota().maxPerHour} remaining`);
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) console.error("SMTP response:", error.response);
    process.exit(1);
  }
}

sendTestEmail();
