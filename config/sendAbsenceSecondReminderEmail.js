require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendAbsenceSecondReminderEmail = async ({
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
      "❌ Absence – Second Reminder (Repeated Absences – Kindly Update Us)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>We understand that situations like illness or travel may prevent <strong>${studentName}</strong> from attending. However, according to our policy, it is essential that you notify us if your child will be absent for a week or more.</p>
      <p>Without this communication, we will need to mark your child as unauthorised absent in our register, which may affect their record.</p>
      <p>Regular attendance plays a key role in your child’s development in Qur’ān, Islamic knowledge, and character-building. Your timely update will help us maintain a clear and supportive record for your child.</p>
      <p>May Allah bless your efforts and guide our children on the straight path.</p>
      <p>JazakumAllahu khayran.</p>
      <br />
      <p>Warm regards,<br />The Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Absence second reminder email sent successfully");
  } catch (error) {
    console.error(
      "❌ Failed to send absence second reminder email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendAbsenceSecondReminderEmail;
