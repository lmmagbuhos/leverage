import { buildStageJudgePrompt } from "../scenario/content";
import { parseStageVerdict, StageNumber, StageVerdict } from "../scenario/stages";
import { LlmProvider } from "./provider";

/** Call B — neutral Stage Judge. Builds the prompt, asks the LLM, parses to a safe verdict. */
export async function runStageJudge(
  provider: LlmProvider,
  stage: StageNumber,
  exchange: { negotiator: string; bato: string }
): Promise<StageVerdict> {
  const prompt = buildStageJudgePrompt(stage, exchange);
  const raw = await provider.complete([{ role: "user", content: prompt }], { temperature: 0 });
  return parseStageVerdict(raw, stage);
}

export { buildStageJudgePrompt };
