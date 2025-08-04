require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendHoldEmail = async ({
  to,
  parentName = "Parent",
  studentNames = [], // expects an array of names
  method = "your selected method",
}) => {
  if (process.env.EMAIL_SENDING_ENABLED !== "true") {
    console.log(
      "🚫 Email sending is disabled (test mode). Skipping email to:",
      to
    );
    return;
  }
  if (!to || !process.env.BREVO_USER || !process.env.BREVO_PASS) {
    console.error("❌ Missing email credentials or recipient address");
    return;
  }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const studentList =
    Array.isArray(studentNames) && studentNames.length > 0
      ? studentNames.join(", ")
      : "your child";

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
      "🕒 Temporary Enrollment Confirmed – Action Required Within 7 Days",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>We’ve noted your preference to pay the admission and first month’s fee via <strong>${method}</strong>. As a result, the following student(s) have been placed on <strong>temporary enrollment</strong> at Alyaqeen:</p>
      <p><strong>${studentList}</strong></p>
      <p>You may allow your child(ren) to begin attending classes immediately. However, please note that official enrollment will only be confirmed once the admission and first month’s fee is received.</p>
      <p><strong>Kindly ensure the payment is completed within 7 days to avoid any interruption in class access.</strong></p>
      <p>If you have already initiated the transfer, please share the payment receipt or reference number with us by replying to this email.</p>
      <p>If you have any questions or need banking details again, feel free to contact us.</p>
      <br />
      <p>Warm regards,<br />The Alyaqeen Team</p>
    `,
  };

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Hold email sent successfully via Brevo API");
  } catch (error) {
    console.error(
      "❌ Failed to send hold email via Brevo API:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendHoldEmail;
