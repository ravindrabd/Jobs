// Skills-only match scorer. No title / seniority / domain / location scoring.
//
//   match % = matched_skills.length / total_skills_found_in_JD * 100
//
// Hide threshold (≥ 2 matched) is enforced by the API filter, not here.

function scoreOne(jobParsed, resumeParsed /*, jobMeta — unused */) {
  const jdSkills = jobParsed.skills || [];
  const rsSkills = resumeParsed.skills || [];
  const rsLower = new Set(rsSkills.map(s => String(s).toLowerCase()));

  const matched = jdSkills.filter(s => rsLower.has(s.toLowerCase()));
  const missing = jdSkills.filter(s => !rsLower.has(s.toLowerCase()));

  const score = jdSkills.length
    ? Math.round((matched.length / jdSkills.length) * 100)
    : 0;

  let label;
  if (score >= 80)              label = 'Strong match';
  else if (score >= 50)         label = 'Good match';
  else if (score >= 20)         label = 'Partial match';
  else if (matched.length >= 2) label = 'Skill overlap';
  else                          label = 'Low match';

  return {
    score,
    label,
    breakdown: {
      skills: { earned: score, max: 100, matched: matched.length, total: jdSkills.length },
    },
    matched_skills: matched,
    missing_skills: missing,
  };
}

module.exports = { scoreOne };
