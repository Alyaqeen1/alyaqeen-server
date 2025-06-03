const feeStructure = {
  admissionFee: 20,
  discountOnAdmission: {
    threshold: 2, // 3rd child onwards
    percentage: 10,
  },
  monthlyFees: {
    "Qaidah, Quran & Islamic Studies": {
      weekdays: 50,
      weekends: 50,
    },
    "Primary Maths & English Tuition": {
      weekdays: 100,
      weekends: 80,
    },
    "GCSE Maths English & Science Tuition": {
      weekdays: 120,
      weekends: 100,
    },
    "Hifz Memorisation": {
      weekdays: 90,
      weekends: 60,
    },
    "Arabic Language": {
      weekdays: 60,
      weekends: 50,
    },
  },
};

module.exports = feeStructure;
