export const POST_DREAM_CONTINUATION_RULES = `
The creative continuation is an alternative part 2 of the original dream.
- The narrator has already woken and recorded the original dream. Begin with one or two natural sentences in which they close their eyes, drift back to sleep, or deliberately try to return to the unfinished dream. Vary this transition; never reuse a fixed template.
- Return to the final unresolved moment inside DREAM_NARRATIVE.
- Branch only from DREAM_NARRATIVE. Never continue, combine, or treat an earlier generated continuation as canon.
- Keep the narrator's point of view and preserve the established setting, people, objects, emotional tension, and dream logic.
- Develop or resolve one unresolved element already present in the dream.
- Add at most one new element, and only when an existing detail naturally causes or introduces it.
- Do not jump to an unrelated location, character, memory, or symbolic object merely to make the version different.
- Make the events vivid and surprising through a different choice or consequence within the same story world.
- Write 4-7 cohesive paragraphs with concrete sensory detail, meaningful action, and natural transitions. Every paragraph must advance the scene instead of explaining its symbolism.
- Build toward an earned awakening instead of attaching "I woke up" after a settled action. The final three to five sentences must form one continuous chain: an event changes, the narrator senses or realizes that change, the experience reaches an emotional, bodily, sensory, or reality-breaking threshold, and only then does the narrator wake.
- The awakening trigger must grow from the preceding scene. Do not insert a random alarm, noise, character, or shock solely to end the passage.
- After waking, state one immediate and specific feeling caused by the final dream event. It may be mixed or subtle; do not copy the original waking reaction verbatim.
- Keep psychological analysis, advice, prediction, and symbolic explanation outside the fictional passage.
`.trim();

interface ContinuationPromptInput {
  narrative: string;
  previousContinuations: string[];
}

export type DreamContinuationLanguage = 'Vietnamese' | 'English';

export function dreamContinuationLanguage(narrative: string): DreamContinuationLanguage {
  return /[ăâđêôơưà-ỹ]/iu.test(narrative) ? 'Vietnamese' : 'English';
}

// Keeps generation focused on the last part of long narratives without naming any fixed motif.
export function selectFinalDreamScene(narrative: string): string {
  const compact = narrative.replace(/\s+/gu, ' ').trim();
  const sentences = compact.match(/[^.!?…]+(?:[.!?…]+|$)/gu) || [compact];
  const finalSentences = sentences.slice(-3).join(' ').trim();
  return finalSentences.length <= 900 ? finalSentences : finalSentences.slice(-900).trim();
}

// Builds an alternative part 2 while treating older versions only as text to avoid copying.
export function buildDreamContinuationPrompt(input: ContinuationPromptInput): string {
  const finalScene = selectFinalDreamScene(input.narrative);
  const language = dreamContinuationLanguage(input.narrative);
  const previous = input.previousContinuations.length
    ? input.previousContinuations
      .map((continuation, index) => `Alternative ${index + 1}: ${continuation}`)
      .join('\n')
    : 'None';

  return `
Write one fictional dream continuation entirely in natural ${language}.
Do not insert untranslated words or characters from another language.

${POST_DREAM_CONTINUATION_RULES}

Older alternatives are shown only to prevent repetition. Do not continue their
events and do not borrow an element that is absent from DREAM_NARRATIVE.
A new version should differ through the narrator's decision, the consequence,
or the way an existing unresolved detail develops.

Return JSON only:
{
  "title": "a short title grounded in this dream",
  "continuation": "280-450 ${language} words in 4-7 paragraphs, including the return-to-sleep opening and final waking sentence",
  "connectionToCurrentDream": "one concise sentence naming the original unresolved detail being continued",
  "sourceAnchors": ["two to four exact short excerpts copied from DREAM_NARRATIVE"],
  "startingAnchor": "one exact excerpt copied from FINAL_SCENE that identifies the unresolved moment where this version begins",
  "awakeningBridge": "the exact two to four sentence sequence in continuation that makes the transition from the dream event to waking feel earned",
  "endingWakeReaction": "the exact final sentence of continuation"
}

[DREAM_NARRATIVE]
${input.narrative}
[/DREAM_NARRATIVE]

[FINAL_SCENE]
${finalScene}
[/FINAL_SCENE]

[OLDER_ALTERNATIVES_DO_NOT_CONTINUE]
${previous}
[/OLDER_ALTERNATIVES_DO_NOT_CONTINUE]
`;
}
