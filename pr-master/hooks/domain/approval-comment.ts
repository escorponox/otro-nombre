/**
 * The comments an approval carries, one picked at random. Their sarcasm aims at the reviewer,
 * the process and CI, never at the author: everyone on the pull request reads them.
 */
export const APPROVAL_COMMENTS: readonly string[] = [
  'Approved, after a thorough review of every line, including the ones GitHub kindly collapsed.',
  'Approved. Reviewed line by line, twice, with the attention usually reserved for contracts.',
  'Approved. I went through every file with a care bordering on the unreasonable.',
  'Approved, following a meticulous review that I will happily describe to anyone who asks.',
  'Approved. Every change examined, every edge case considered, every coffee consumed.',
  'Approved. I read it all, slowly, the way one reads a will.',
  'Approved, after the kind of thorough review that leaves no line unread and no doubt unvoiced.',
  'Approved. Reviewed in full; I would expect nothing less of myself, and neither should you.',
  'Approved. A complete and diligent review, conducted with the seriousness of a museum curator.',
  'Approved. I examined every line with the patience of someone with nowhere else to be.',
  'Approved, after reading the whole diff with a rigour I rarely admit to in public.',
  'Approved. Thoroughly reviewed, down to the last semicolon and the occasional missing one.',
]

/** One of `APPROVAL_COMMENTS`, chosen by `random`, a number in [0, 1) as `Math.random` gives. */
export function approvalComment(random: () => number = Math.random): string {
  return APPROVAL_COMMENTS[Math.floor(random() * APPROVAL_COMMENTS.length)] ?? APPROVAL_COMMENTS[0]!
}
