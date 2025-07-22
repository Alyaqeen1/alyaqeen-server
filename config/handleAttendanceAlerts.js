const { ObjectId } = require("mongodb");
const sendAbsenceFirstReminderEmail = require("./sendAbsenceFirstReminderEmail");
const sendLateFirstReminderEmail = require("./sendLateFirstReminderEmail");
const sendAbsenceSecondReminderEmail = require("./sendAbsenceSecondReminderEmail");
const sendLateSecondReminderEmail = require("./sendLateSecondReminderEmail");

const handleAttendanceAlerts = async (
  attendance,
  notificationsLogCollection,
  studentsCollection
) => {
  if (!attendance || !attendance.student_id) {
    return;
  }

  try {
    // Get student details
    const student = await studentsCollection.findOne({
      _id: new ObjectId(attendance.student_id),
    });

    if (!student) {
      return;
    }

    const groupType = student?.academic?.session; // "weekdays" or "weekend"
    const statusType = attendance.status; // "present", "late", or "absent"

    // CONFIGURATION - CLEARLY DEFINED THRESHOLDS
    const thresholds = {
      absent: {
        first: groupType === "weekdays" ? 3 : 2,
        second: groupType === "weekdays" ? 5 : 4,
      },
      late: {
        first: groupType === "weekdays" ? 3 : 2,
        second: groupType === "weekdays" ? 5 : 4,
      },
    };

    // Get or initialize the counter document
    let counterDoc = await notificationsLogCollection.findOne({
      student_id: attendance.student_id,
      type: "AttendanceCounter",
    });

    // Initialize counter if doesn't exist
    if (!counterDoc) {
      counterDoc = {
        student_id: attendance.student_id,
        type: "AttendanceCounter",
        absentCount: 0,
        lateCount: 0,
        hasAbsentFirstAlert: false,
        hasAbsentSecondAlert: false,
        hasLateFirstAlert: false,
        hasLateSecondAlert: false,
        date: new Date().toISOString().split("T")[0],
        createdAt: new Date(),
        lastReset: null,
        groupType,
      };
      await notificationsLogCollection.insertOne(counterDoc);
    }

    // Reset logic - any status change interrupts the counters
    const currentStatus = statusType;
    const previousStatus = counterDoc.lastStatus;

    // Reset conditions:
    // 1. Current status is present (resets both)
    // 2. Status changed between absent/late (resets the opposite counter)
    if (currentStatus === "present") {
      // Reset both counters for present status
      await notificationsLogCollection.updateOne(
        { _id: counterDoc._id },
        {
          $set: {
            absentCount: 0,
            lateCount: 0,
            lastReset: new Date(),
            hasAbsentFirstAlert: false,
            hasAbsentSecondAlert: false,
            hasLateFirstAlert: false,
            hasLateSecondAlert: false,
            lastStatus: currentStatus,
          },
        }
      );
      // `🔄 Reset all counters for ${student.name} (present)`
    } else if (previousStatus && previousStatus !== currentStatus) {
      // Status changed between absent/late - reset the opposite counter
      const resetField =
        currentStatus === "absent" ? "lateCount" : "absentCount";
      const resetFlags =
        currentStatus === "absent"
          ? { hasLateFirstAlert: false, hasLateSecondAlert: false }
          : { hasAbsentFirstAlert: false, hasAbsentSecondAlert: false };

      await notificationsLogCollection.updateOne(
        { _id: counterDoc._id },
        {
          $set: {
            [resetField]: 0,
            ...resetFlags,
            lastStatus: currentStatus,
          },
        }
      );
      //   `🔄 Reset ${resetField} for ${student.name} (status changed from ${previousStatus} to ${currentStatus})`
    } else {
      // No status change - just update lastStatus
      await notificationsLogCollection.updateOne(
        { _id: counterDoc._id },
        { $set: { lastStatus: currentStatus } }
      );
    }

    // Only process alerts for late or absent status
    if (statusType === "absent" || statusType === "late") {
      const counterField =
        statusType === "absent" ? "absentCount" : "lateCount";
      const alertPrefix = statusType === "absent" ? "Absent" : "Late";
      const emailFunctions = {
        first:
          statusType === "absent"
            ? sendAbsenceFirstReminderEmail
            : sendLateFirstReminderEmail,
        second:
          statusType === "absent"
            ? sendAbsenceSecondReminderEmail
            : sendLateSecondReminderEmail,
      };

      // Get updated counter doc
      counterDoc = await notificationsLogCollection.findOne({
        _id: counterDoc._id,
      });

      // Increment the appropriate counter
      const newCount = counterDoc[counterField] + 1;
      await notificationsLogCollection.updateOne(
        { _id: counterDoc._id },
        { $set: { [counterField]: newCount } }
      );
      `📊 ${student.name} ${statusType} count: ${newCount}`;

      // Determine which alert to send
      let alertType = null;
      let emailFunction = null;
      const now = new Date();

      const hasFirstAlert = counterDoc[`has${alertPrefix}FirstAlert`];
      const hasSecondAlert = counterDoc[`has${alertPrefix}SecondAlert`];

      if (!hasFirstAlert && newCount >= thresholds[statusType].first) {
        alertType = `${alertPrefix}1`;
        emailFunction = emailFunctions.first;
        // `⚠️ First ${statusType} threshold reached (${thresholds[statusType].first})`
      } else if (
        hasFirstAlert &&
        !hasSecondAlert &&
        newCount >= thresholds[statusType].second
      ) {
        alertType = `${alertPrefix}2`;
        emailFunction = emailFunctions.second;
        // `⚠️ Second ${statusType} threshold reached (${thresholds[statusType].second})`
      }

      // Send notification if needed
      if (alertType && emailFunction) {
        await emailFunction({
          to: student.parent_email,
          parentName: student.family_name,
          studentName: student.name,
        });

        // Record the notification
        await notificationsLogCollection.insertOne({
          student_id: attendance.student_id,
          type: alertType,
          date: now.toISOString().split("T")[0],
          createdAt: now,
          groupType,
          notificationFor: statusType,
          count: newCount,
          thresholdReached: alertType.endsWith("1")
            ? thresholds[statusType].first
            : thresholds[statusType].second,
        });

        // Update the counter flags
        const updateField = alertType.endsWith("1")
          ? `has${alertPrefix}FirstAlert`
          : `has${alertPrefix}SecondAlert`;

        await notificationsLogCollection.updateOne(
          { _id: counterDoc._id },
          { $set: { [updateField]: true } }
        );
        // `✅ Sent ${alertType} notification for ${student.name}`
        `   Current ${statusType} count: ${newCount}`;

        // `   Threshold: ${
        //   alertType.endsWith("1")
        //     ? thresholds[statusType].first
        //     : thresholds[statusType].second
        // }`
      } else {
        // `No ${statusType} alert sent for ${student.name}`
      }
    }
  } catch (error) {}
};

module.exports = handleAttendanceAlerts;
