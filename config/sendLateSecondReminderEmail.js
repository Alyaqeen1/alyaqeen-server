require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendLateSecondReminderEmail = async ({
  to,
  parentName = "Parent",
  studentName = "your child",
}) => {
  // if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //   console.log(
  //     "🚫 Email sending is disabled (test mode). Skipping email to:",
  //     to
  //   );
  //   return;
  // }
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
      <p>Assalāmu ‘alaykum,</p>
      <p>We truly appreciate your partnership in your child’s tarbiyah. If <strong>${studentName}</strong> is arriving late due to a genuine reason (such as traffic or school timings), please do inform us so we may note it accordingly.</p>
      <pRegular lateness can affect focus and class flow, and we seek your kind cooperation in encouraging punctuality.</p>
      <p>May Allah place barakah in your efforts.</p>
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
