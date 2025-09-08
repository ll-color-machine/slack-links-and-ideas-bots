const llog = require("learninglab-log");

function normalizeTopic(topic) {
  const valid = [
    "Learning outcomes",
    "Tool development",
    "Professional practice",
    "Student perspectives",
    "User experience and interaction",
    "Theoretical background",
    "AI literacy",
    "Other",
  ];
  if (!topic) return "Other";
  if (valid.includes(topic)) return topic;
  const t = String(topic).toLowerCase();
  const match = valid.find((v) => v.toLowerCase() === t);
  if (!match) {
    llog.yellow(`⚠️ Unknown topic '${topic}', defaulting to 'Other'`);
    return "Other";
  }
  return match;
}

function normalizeStudyType(studyType) {
  const valid = ["Review", "Experimental", "Quantitative", "Qualitative", "Mixed-methods", "Observational"];
  if (!studyType) return "Review";
  if (valid.includes(studyType)) return studyType;
  const t = String(studyType).toLowerCase();
  const match = valid.find((v) => v.toLowerCase() === t);
  if (!match) {
    llog.yellow(`⚠️ Unknown study type '${studyType}', defaulting to 'Review'`);
    return "Review";
  }
  return match;
}

module.exports = { normalizeTopic, normalizeStudyType };

