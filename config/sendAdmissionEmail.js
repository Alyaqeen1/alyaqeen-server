require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const sessionMap = require("./sessionMap");
const { isValid } = require("date-fns");
const DISABLED_FAMILY_EMAILS = [
  "vezzaa786@hotmail.co.uk", // Amjad family
];
const sendEmailViaAPI = async ({
  to,
  parentName,
  students,
  totalAmount,
  method = "Selected Method",
  paymentDate = null,
  studentBreakdown = [],
  isEnrollmentConfirmed = true,
}) => {
  if (DISABLED_FAMILY_EMAILS.includes(to)) {
    console.log(`🚫 EMAIL BLOCKED: ${parentName} <${to}>`);
    return; // Exit without sending
  }
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const studentsForEmail =
    studentBreakdown.length > 0 ? studentBreakdown : students;

  // Helper function to format session time
  const formatSessionTime = (time) => {
    switch (time) {
      case "S1":
        return "Weekdays Early (4:30 PM – 6:00 PM)";
      case "S2":
        return "Weekdays Late (5:45 PM – 7:15 PM)";
      case "WM":
        return "Weekend Morning (10:00 AM – 12:30 PM)";
      case "WA":
        return "Weekend Afternoon (12:30 PM – 2:30 PM)";
      default:
        return time || "Not assigned";
    }
  };

  const studentDetailsHtml = studentsForEmail
    .map((student, index) => {
      const { name, startingDate, academic = {}, subtotal = 0 } = student;

      const formattedStartDate =
        startingDate && !isNaN(new Date(startingDate))
          ? new Date(startingDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "To be confirmed";

      // Handle both old and new academic structures
      let enrollments = [];

      if (academic.enrollments && Array.isArray(academic.enrollments)) {
        // NEW STRUCTURE: Multiple enrollments
        enrollments = academic.enrollments;
      } else if (academic.dept_id || academic.session) {
        // OLD STRUCTURE: Single enrollment - convert to array format
        enrollments = [
          {
            dept_id: academic.dept_id,
            class_id: academic.class_id,
            session: academic.session,
            session_time: academic.time || academic.session_time,
            department: academic.department,
            class: academic.class,
          },
        ];
      }

      // Generate enrollment details HTML
      const enrollmentDetailsHtml = enrollments
        .map((enrollment, enrollIndex) => {
          const {
            department = "-",
            session = "-",
            class: className = "-",
            session_time,
          } = enrollment;

          return `
          <div style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px;">
            <p style="margin: 0 0 5px 0; font-size: 14px;">
              <strong>Enrollment ${enrollIndex + 1}:</strong>
            </p>
            <ul style="margin: 0; padding-left: 15px; font-size: 13px;">
              <li><strong>Department:</strong> ${department}</li>
              <li><strong>Class:</strong> ${className}</li>
              <li><strong>Session:</strong> ${session}</li>
              <li><strong>Time:</strong> ${formatSessionTime(session_time)}</li>
            </ul>
          </div>
        `;
        })
        .join("");

      return `
      <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #2c5aa0;">
          <strong>${index + 1}. ${name}</strong>
        </p>
        <p style="margin: 10px 0 5px 0;"><strong>Admission Details:</strong></p>
        ${enrollmentDetailsHtml}
        <p style="margin: 10px 0 5px 0;"><strong>Starting Date:</strong> ${formattedStartDate}</p>
        <p style="margin: 10px 0 5px 0;"><strong>Payment Summary:</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          <li><strong>Amount Paid:</strong> £${subtotal.toFixed(2)}</li>
          <li><strong>Status:</strong> ✅ Enrollment Confirmed</li>
        </ul>
      </div>
    `;
    })
    .join("");

  // Calculate total number of enrollments across all students
  const totalEnrollments = studentsForEmail.reduce((total, student) => {
    if (student.academic?.enrollments) {
      return total + student.academic.enrollments.length;
    } else if (student.academic?.dept_id) {
      return total + 1; // Old structure - single enrollment
    }
    return total;
  }, 0);

  const paymentDateText = paymentDate
    ? new Date(paymentDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "recently";

  // Enhanced message that mentions multiple enrollments if applicable
  const enrollmentCountText =
    totalEnrollments > 1 ? `across ${totalEnrollments} course enrollments` : "";

  const messageIntro = `
    <p>We have successfully received your <strong>admission payment of £${totalAmount.toFixed(
      2,
    )}</strong> ${enrollmentCountText} via <strong>${method}</strong> on <strong>${paymentDateText}</strong>.</p>
    <p>Your student(s) have been <strong>successfully enrolled</strong> at Alyaqeen!</p>
  `;

  const paymentSummary = `
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
      <p style="margin: 0 0 10px 0; font-size: 16px; color: #2c5aa0;">
        <strong>Payment Confirmation</strong>
      </p>
      <p style="margin: 5px 0;"><strong>Total Amount Paid:</strong> £${totalAmount.toFixed(
        2,
      )}</p>
      <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${method}</p>
      <p style="margin: 5px 0;"><strong>Payment Date:</strong> ${paymentDateText}</p>
      ${
        totalEnrollments > 1
          ? `<p style="margin: 5px 0;"><strong>Total Enrollments:</strong> ${totalEnrollments} courses</p>`
          : ""
      }
    </div>
  `;

  const enrollmentSection = `
    <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; margin: 15px 0;">
      <p style="margin: 0; color: #155724; font-weight: bold;">
        ✅ Enrollment Successfully Completed
      </p>
      <p style="margin: 10px 0 0 0; color: #155724;">
        Your student(s) are now officially enrolled in all selected courses and can start attending classes according to their schedules.
      </p>
    </div>
  `;

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
      totalEnrollments > 1
        ? `✅ ${totalEnrollments} Course Enrollments Confirmed - Alyaqeen`
        : "✅ Enrollment Confirmed - Alyaqeen",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>Dear <strong>${parentName}</strong>,</p>
        
        ${messageIntro}
        
        ${enrollmentSection}
        
        <p><strong>Student Enrollment Details:</strong></p>
        ${studentDetailsHtml}
        
        ${paymentSummary}
        
        <p>Your student(s) are now ready to begin their educational journey with us. 
           Welcome to the Alyaqeen family!</p>
           
        <p>If you have any questions about the class schedules or need further assistance, 
           please don't hesitate to contact us.</p>
           
        <br/>
        <p>Thank you for choosing Alyaqeen.</p>
        <p>JazakumAllahu khayran for your trust and support.</p>
        <p>Warm regards,<br />
           <strong>Alyaqeen Team</strong></p>
      </div>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Enrollment confirmation email sent successfully to:", to);
  } catch (error) {
    console.error(
      "❌ Failed to send email via Brevo API:",
      error.response?.body || error.message,
    );
  }
};

module.exports = sendEmailViaAPI;
