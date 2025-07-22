require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendLateFirstReminderEmail = async ({
  to,
  parentName = "Parent",
  studentName = "your child", // single student name string
}) => {
  if (!to || !process.env.BREVO_USER || !process.env.BREVO_PASS) {
    console.error("❌ Missing email credentials or recipient address");
    return;
  }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER,
    },
    to: [
      {
        email: to,
        name: parentName,
      },
    ],
    subject:
      "✅ Lateness – First Reminder (Encouragement for Punctual Attendance)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>Arriving on time builds discipline and respect for time — qualities cherished in both Islamic teachings and academic life. We’ve noticed repeated lateness this week for <strong>${studentName}</strong>.</p>
      <p>Let’s help your child develop the habit of punctuality, in shā’ Allāh.</p>
      <p>JazakumAllahu khayran for your support.</p>
      <br />
      <p>Warm regards,<br />The Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Lateness first reminder email sent successfully");
  } catch (error) {
    console.error(
      "❌ Failed to send lateness first reminder email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendLateFirstReminderEmail;
