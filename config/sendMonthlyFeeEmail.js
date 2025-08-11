require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const getMonthName = (num) =>
  new Date(2000, Number(num) - 1).toLocaleString("en-US", { month: "long" });

const sendMonthlyFeeEmail = async ({
  to,
  parentName,
  students,
  totalAmount,
  method = "Selected Method",
  date = new Date(),
  isOnHold = false,
}) => {
  // if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //   console.log(
  //     "🚫 Email sending is disabled (test mode). Skipping email to:",
  //     to
  //   );
  //   return;
  // }
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const studentDetailsHtml = students
    .map((student, index) => {
      const { name, monthsPaid = [] } = student;

      const monthsHtml = monthsPaid
        .map(
          (m) =>
            `<li>${getMonthName(m.month)} ${m.year}: £${m.discountedFee.toFixed(
              2
            )} (Original: £${m.monthlyFee.toFixed(2)})</li>`
        )
        .join("");

      return `
        <p><strong>${index + 1}. ${name}</strong></p>
        <ul>${monthsHtml}</ul>
        <br/>
      `;
    })
    .join("");

  const formattedDate = new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const messageIntro = isOnHold
    ? `<p>We have <strong>recorded</strong> your payment of <strong>£${totalAmount.toFixed(
        2
      )}</strong> via <strong>${method}</strong> on ${formattedDate}.</p>
       <p><em>Your payment is currently under review and will be confirmed by our administration shortly.</em></p>`
    : `<p>We have <strong>received</strong> your monthly fee payment of <strong>£${totalAmount.toFixed(
        2
      )}</strong> via <strong>${method}</strong> on ${formattedDate}.</p>`;

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
    subject: isOnHold
      ? "🕒 Payment Acknowledged - Awaiting Confirmation"
      : "📅 Monthly Fee Payment Confirmation - Alyaqeen",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      ${messageIntro}
      <br/>
      <p><strong>Payment Breakdown:</strong></p>
      ${studentDetailsHtml}
      <p><strong>Total Amount:</strong> £${totalAmount.toFixed(2)}</p>
      <br/>
      <p>Thank you for supporting your child’s education. If you have any questions, feel free to reply to this email.</p>
      <p>JazakumAllahu khayran for your support.</p>
      <p>Warm regards,<br/>Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
  } catch (error) {
    console.error(
      "❌ Failed to send monthly fee email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendMonthlyFeeEmail;
