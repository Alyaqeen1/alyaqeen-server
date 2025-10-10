require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const { MongoClient, ObjectId } = require("mongodb");

const MONGO_URI = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.ts2xohe.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const DB_NAME = "alyaqeenDb";

// Real payment check logic
// Check payment status per STUDENT, not per family
// Check payment status per STUDENT, not per family
// Get ALL students from family collection and check their payment status
const checkPaymentStatus = async (familyEmail, currentMonth, currentYear) => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const feesCollection = db.collection("fees");
    const familiesCollection = db.collection("families");
    const studentsCollection = db.collection("students");

    // Get the family to find ALL children
    const family = await familiesCollection.findOne({ email: familyEmail });
    if (!family) {
      console.log(`❌ No family found for: ${familyEmail}`);
      return { allPaid: false, unpaidStudents: [] };
    }

    // Get ALL students for this family
    const studentUids = family.children;
    const students = await studentsCollection
      .find({
        uid: { $in: studentUids },
      })
      .toArray();

    console.log(
      `👨‍👩‍👧‍👦 Family ${familyEmail} has ${students.length} students:`,
      students.map((s) => s.name).join(", ")
    );

    // Get ALL fee records for this family (there might be multiple)
    const feeRecords = await feesCollection
      .find({ familyId: family._id.toString() })
      .toArray();
    console.log(`📊 Found ${feeRecords.length} fee records for this family`);

    // Check EACH student's payment status
    const studentPaymentStatus = await Promise.all(
      students.map(async (student) => {
        let hasPaymentRecord = false;
        let isFullyPaid = false;
        let isPartiallyPaid = false;
        let paidAmount = 0;
        let monthlyFee = student.monthly_fee || 50;
        let paymentType = "unknown";

        // Check ALL fee records for this student
        for (const feeRecord of feeRecords) {
          // Try to match by student name
          const studentFeeRecord = feeRecord.students.find(
            (s) => s.name === student.name
          );

          if (studentFeeRecord) {
            console.log(`🔍 Found ${student.name} in fee record:`, {
              paymentType: feeRecord.paymentType,
              hasMonthsPaid: !!studentFeeRecord.monthsPaid,
              hasPayments: !!studentFeeRecord.payments,
            });

            // Handle MONTHLY payments (has monthsPaid array)
            if (
              studentFeeRecord.monthsPaid &&
              studentFeeRecord.monthsPaid.length > 0
            ) {
              const currentMonthPayment = studentFeeRecord.monthsPaid.find(
                (monthPaid) =>
                  monthPaid.month === currentMonth &&
                  monthPaid.year === currentYear
              );

              if (currentMonthPayment) {
                hasPaymentRecord = true;
                paymentType = "monthly";
                paidAmount = currentMonthPayment.paid || 0;
                monthlyFee =
                  currentMonthPayment.monthlyFee || student.monthly_fee || 50;
                isFullyPaid = paidAmount >= monthlyFee;
                isPartiallyPaid = paidAmount > 0 && paidAmount < monthlyFee;
                break; // Found payment, stop searching
              }
            }

            // Handle ADMISSION payments (has payments array)
            if (
              studentFeeRecord.payments &&
              studentFeeRecord.payments.length > 0
            ) {
              // For admission payments, check if they paid the admission fee
              const totalPaid = studentFeeRecord.payments.reduce(
                (sum, payment) => sum + payment.amount,
                0
              );
              const expectedTotal =
                studentFeeRecord.admissionFee ||
                studentFeeRecord.monthlyFee ||
                50;

              if (totalPaid > 0) {
                hasPaymentRecord = true;
                paymentType = "admission";
                paidAmount = totalPaid;
                monthlyFee = expectedTotal;
                isFullyPaid = paidAmount >= monthlyFee;
                isPartiallyPaid = paidAmount > 0 && paidAmount < monthlyFee;
                break; // Found payment, stop searching
              }
            }
          }
        }

        console.log(
          `💰 ${student.name}: ${
            hasPaymentRecord
              ? `PAID (${paymentType}) ${paidAmount}/${monthlyFee}`
              : "NOT PAID"
          }`
        );

        const hasNotPaid = !hasPaymentRecord;

        return {
          studentId: student.uid,
          name: student.name,
          hasPaymentRecord: hasPaymentRecord,
          isFullyPaid: isFullyPaid,
          isPartiallyPaid: isPartiallyPaid,
          hasNotPaid: hasNotPaid,
          paidAmount: paidAmount,
          monthlyFee: monthlyFee,
          paymentType: paymentType,
        };
      })
    );

    const allStudentsPaid = studentPaymentStatus.every(
      (student) => student.isFullyPaid
    );
    const unpaidStudents = studentPaymentStatus.filter(
      (student) => student.hasNotPaid
    );
    const partiallyPaidStudents = studentPaymentStatus.filter(
      (student) => student.isPartiallyPaid
    );
    const fullyPaidStudents = studentPaymentStatus.filter(
      (student) => student.isFullyPaid
    );

    console.log(
      `💰 ${familyEmail}: ${
        allStudentsPaid ? "ALL PAID" : "SOME UNPAID"
      } for ${currentMonth}/${currentYear}`
    );
    console.log(
      `   Fully paid: ${
        fullyPaidStudents
          .map((s) => `${s.name} (${s.paymentType})`)
          .join(", ") || "None"
      }`
    );
    console.log(
      `   Partially paid: ${
        partiallyPaidStudents
          .map((s) => `${s.name} (${s.paidAmount}/${s.monthlyFee})`)
          .join(", ") || "None"
      }`
    );
    console.log(
      `   Not paid: ${unpaidStudents.map((s) => s.name).join(", ") || "None"}`
    );

    return {
      allPaid: allStudentsPaid,
      unpaidStudents: unpaidStudents,
      partiallyPaidStudents: partiallyPaidStudents,
    };
  } catch (error) {
    console.error("❌ Error checking payment status:", error);
    return { allPaid: false, unpaidStudents: [], partiallyPaidStudents: [] };
  } finally {
    await client.close();
  }
};
// Get all families who need reminders
const getFamilies = async () => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const familiesCollection = db.collection("families");

    // Get ONLY the test family by email
    const families = await familiesCollection.find({}).toArray();

    console.log(`🧪 TEST MODE - Found ${families.length} test families`);

    return families.map((family) => ({
      to: family.email,
      name: family.name || family.fatherName,
      studentName: "your child(ren)",
    }));
  } catch (error) {
    console.error("❌ Error fetching families:", error);
    return [];
  } finally {
    await client.close();
  }
};

const sendReminderEmail = async ({ to, name, studentName }, reminderType) => {
  // Check if Brevo credentials are available
  if (!process.env.BREVO_PASS || !process.env.BREVO_USER) {
    console.log("❌ Brevo credentials missing. Would send to:", to);
    return;
  }

  //   if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //     console.log("🚫 Email sending disabled. Would send to:", to);
  //     return;
  //   }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const emailTemplates = {
    10: {
      subject: "🔔 Fee Reminder – Alyaqeen Academy",
      content: `
        <p>Dear <strong>${name}</strong>,</p>
        <p>We hope you are well. This month’s fee is still outstanding.</p>
        <p>Fees should be paid within the first seven working days of each month.</p>
        <p>Please use the link below to make the payment, or contact the Academy</p>
        <p>👉 <strong>https://alyaqeen.vercel.app/login</strong></p>
        <p>If you have already made the payment, please ignore this message.</p>
        <p>Jazakallahu khairan</p>
        <br/>
        <p>Best regards,<br/>Alyaqeen Team</p>
      `,
    },
    20: {
      subject: "⚠️ Important: Monthly Fee Payment Overdue",
      content: `
        <p>Dear <strong>${name}</strong>,</p>
        <p>We notice that the monthly fee for ${studentName} is now overdue.</p>
        <p>Please make the payment as soon as possible: <strong>https://alyaqeen.vercel.app/login</strong></p>
        <p>If you've already paid, please disregard this message.</p>
        <br/>
        <p>Best regards,<br/>Alyaqeen Team</p>
      `,
    },
    29: {
      subject: "🚨 Final Notice: Urgent Payment Required",
      content: `
        <p>Dear <strong>${name}</strong>,</p>
        <p>This is our final reminder regarding the overdue payment for ${studentName}.</p>
        <p>Please settle the amount immediately to avoid any disruption: <strong>https://alyaqeen.vercel.app/login</strong></p>
        <p>If payment is not received, we may need to suspend services.</p>
        <br/>
        <p>Best regards,<br/>Alyaqeen Team</p>
      `,
    },
  };

  const template = emailTemplates[reminderType];

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER,
    },
    to: [{ email: to, name }],
    subject: template.subject,
    htmlContent: template.content,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`✅ Sent ${reminderType}th day reminder to: ${to}`);
  } catch (error) {
    console.error(
      `❌ Failed to send email to ${to}:`,
      error.response?.body || error.message
    );
  }
};

const sendMonthlyReminders = async (dayOfMonth) => {
  console.log(`📧 Processing ${dayOfMonth}th day reminders...`);

  try {
    const families = await getFamilies();
    const currentDate = new Date();
    const currentMonth = (currentDate.getMonth() + 1)
      .toString()
      .padStart(2, "0"); // "09", "10"
    const currentYear = currentDate.getFullYear();

    console.log(
      `📅 Checking payments for month: ${currentMonth}, year: ${currentYear}`
    );
    console.log(`👨‍👩‍👧‍👦 Total families to check: ${families.length}`);

    for (const family of families) {
      const paymentStatus = await checkPaymentStatus(
        family.to,
        currentMonth,
        currentYear
      );

      // Only send reminder if there are students with NO payment record
      if (paymentStatus.unpaidStudents.length > 0) {
        console.log(
          `📧 Sending reminder to: ${family.to} (${paymentStatus.unpaidStudents.length} students with no payment)`
        );

        const unpaidStudentNames = paymentStatus.unpaidStudents
          .map((s) => s.name)
          .join(", ");
        await sendReminderEmail(
          {
            to: family.to,
            name: family.name,
            studentName: unpaidStudentNames,
          },
          dayOfMonth
        );
      } else if (paymentStatus.partiallyPaidStudents.length > 0) {
        console.log(
          `⚠️ ${family.to} has partially paid students but no reminder sent`
        );
      } else {
        console.log(
          `✅ ${family.to} has all students paid for ${currentMonth}/${currentYear}`
        );
      }
    }
  } catch (error) {
    console.error("❌ Error processing reminders:", error);
  }
};
module.exports = { sendMonthlyReminders };
