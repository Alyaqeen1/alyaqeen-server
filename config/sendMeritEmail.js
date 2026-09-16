require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendMeritEmail = async ({
  to,
  parentName,
  studentName,
  type, // "merit" or "demerit"
  milestone, // 50, 100, -25, -50
  points, // actual current total (for reference)
}) => {
  // ===== VALIDATE INPUTS =====
  if (!to) {
    console.error("sendMeritEmail: Missing recipient email");
    return;
  }

  if (type !== "merit" && type !== "demerit") {
    console.error("sendMeritEmail: Unknown type:", type);
    return;
  }

  if (!process.env.BREVO_PASS || !process.env.BREVO_USER) {
    console.error("sendMeritEmail: Missing BREVO_PASS or BREVO_USER");
    return;
  }

  // ===== INIT BREVO CLIENT =====
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  defaultClient.authentications["api-key"].apiKey = process.env.BREVO_PASS;
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  // ===== BUILD SUBJECT + BODY =====
  let subject = "";
  let htmlContent = "";

  if (type === "merit") {
    subject = `🎉 ${milestone} Merits Reached - ${studentName}`;
    htmlContent = `
      <p>Dear Parent/Guardian,</p>
      <p>
        We are pleased to inform you that, MashaAllah,
        <strong>${studentName}</strong> has reached
        <strong>${milestone} Merit Points</strong>!
      </p>
      <p>
        Please log in to your Parent Account to see the details of the merits,
        including when and why they were awarded.
      </p>
      <p>JazakAllahu Khairan for your cooperation.</p>
      <br />
      <p>
        Warm regards,<br />
        Alyaqeen Academy
      </p>
    `;
  } else if (type === "demerit") {
    const displayValue = Math.abs(milestone);
    subject = `De-Merit Notification - ${studentName}`;
    htmlContent = `
      <p>Dear Parent/Guardian,</p>
      <p>
        We would like to inform you that
        <strong>${studentName}</strong> has reached
        <strong>${displayValue} De-Merit Points</strong>.
      </p>
      <p>
        Please log in to your Parent Account to review the dates and reasons
        for the de-merits and support your child in improving their progress.
      </p>
      <p>JazakAllahu Khairan for your cooperation.</p>
      <br />
      <p>
        Warm regards,<br />
        Alyaqeen Academy
      </p>
    `;
  }

  // ===== SEND EMAIL =====
  const sendSmtpEmail = {
    sender: { name: "Alyaqeen", email: process.env.BREVO_USER },
    to: [{ email: to, name: parentName || "Parent" }],
    subject,
    htmlContent,
  };

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return data;
  } catch (error) {
    console.error(
      "sendMeritEmail failed:",
      error.response?.body || error.message,
    );
  }
};

module.exports = sendMeritEmail;
