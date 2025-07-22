require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendLateSecondReminderEmail = async ({
  to,
  parentName = "Parent",
  studentName = "your child",
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
      "✅ Lateness – Second Reminder (Continued Lateness – Your Attention is Appreciated)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>We truly value your partnership in your child’s tarbiyah (development). If <strong>${studentName}</strong> is late due to a genuine reason like traffic or late arrival from school, please inform us so we may adjust records and avoid unnecessary messages.</p>
      <p>Frequent lateness affects learning rhythm and class progress — we seek your cooperation in nurturing punctuality.</p>
      <p>May Allah reward your efforts abundantly.</p>
      <br />
      <p>Warm regards,<br />The Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Lateness second reminder email sent successfully");
  } catch (error) {
    console.error(
      "❌ Failed to send lateness second reminder email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendLateSecondReminderEmail;
