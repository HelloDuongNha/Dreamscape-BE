export const POST_DREAM_CONTINUATION_RULES = `
The creative continuation is an alternative part 2 of the original dream.
- Begin at the final unresolved moment inside DREAM_NARRATIVE, before the narrator woke up.
- Branch only from DREAM_NARRATIVE. Never continue, combine, or treat an earlier generated continuation as canon.
- Keep the narrator's point of view and preserve the established setting, people, objects, emotional tension, and dream logic.
- Develop or resolve one unresolved element already present in the dream.
- Add at most one new element, and only when an existing detail naturally causes or introduces it.
- Do not jump to an unrelated location, character, memory, or symbolic object merely to make the version different.
- Make the events vivid and surprising through a different choice or consequence within the same story world.
- End with the narrator waking again. State one specific feeling caused by this new ending, and do not copy the original waking reaction verbatim.
- Keep psychological analysis, advice, prediction, and symbolic explanation outside the fictional passage.
`.trim();

interface ContinuationPromptInput {
  narrative: string;
  previousContinuations: string[];
}

// Builds an alternative part 2 while treating older versions only as text to avoid copying.
export function buildDreamContinuationPrompt(input: ContinuationPromptInput): string {
  const previous = input.previousContinuations.length
    ? input.previousContinuations
      .map((continuation, index) => `Alternative ${index + 1}: ${continuation}`)
      .join('\n')
    : 'None';

  return `
Write one fictional dream continuation in natural Vietnamese.

${POST_DREAM_CONTINUATION_RULES}

Older alternatives are shown only to prevent repetition. Do not continue their
events and do not borrow an element that is absent from DREAM_NARRATIVE.
A new version should differ through the narrator's decision, the consequence,
or the way an existing unresolved detail develops.

Return JSON only:
{
  "title": "a short title grounded in this dream",
  "continuation": "120-220 Vietnamese words, including the final waking sentence",
  "connectionToCurrentDream": "one concise sentence naming the original unresolved detail being continued",
  "sourceAnchors": ["two to four exact short excerpts copied from DREAM_NARRATIVE"],
  "endingWakeReaction": "the exact final sentence of continuation"
}

[DREAM_NARRATIVE]
${input.narrative}
[/DREAM_NARRATIVE]

[OLDER_ALTERNATIVES_DO_NOT_CONTINUE]
${previous}
[/OLDER_ALTERNATIVES_DO_NOT_CONTINUE]
`;
}
