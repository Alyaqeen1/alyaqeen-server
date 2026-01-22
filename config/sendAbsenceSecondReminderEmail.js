require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendAbsenceSecondReminderEmail = async ({
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
    subject: "❌ Absence – (Repeated Absences – Kindly Update Us)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>Assalāmu ‘alaykum,</p>
      <p>We understand that genuine reasons such as illness or travel may cause absence. We kindly request that you inform us if <strong>${studentName}</strong> will be absent for a week or longer, as per our centre policy without prior notice, we are required to record the absence as unauthorised, which may affect the student’s record.</p>
      <p>Regular attendance plays an important role in progress, tarbiyah, and character development.</p>
      <p>May Allah guide us all to what is best for our children.</p>
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
      error.response?.body || error.message,
    );
  }
};

module.exports = sendAbsenceSecondReminderEmail;
