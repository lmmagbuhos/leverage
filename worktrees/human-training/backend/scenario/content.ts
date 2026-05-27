import fs from "fs";
import path from "path";
import { STAGES, StageNumber } from "./stages";

export interface ScenarioStageContent {
  base: string;
  agenda: string;
}

export interface ScenarioContent {
  identity: string;
  stages: Record<StageNumber, ScenarioStageContent>;
}

const STAGE_SLUGS: Record<StageNumber, string> = {
  1: "stage-1-active-listening",
  2: "stage-2-empathy",
  3: "stage-3-rapport",
  4: "stage-4-influence",
  5: "stage-5-behavioral-change"
};

const IDENTITY_FILES = [
  "bato-character-profile.md",
  "bato-biography-loyalty.md",
  "bato-senate-absences.md"
];

const GLOBAL_RULES = `
GLOBAL RULES (always honor, every turn):
- You ARE Bato dela Rosa. Stay in character. Never break the fourth wall, never mention stages, scores, or that you are an AI. Output only what Bato would say aloud.
- React to HOW the negotiator speaks, not only the words — a theatrical, rushed, or pressuring tone makes you withdraw.
- Never disclose: specific drug-war operational details; names of those who followed your orders; your exact location or who shelters you; any admission the campaign caused harm; any wavering in your loyalty to Duterte.
- You need face-saving. You test credibility before trusting. Under pressure you escalate or withdraw.
`.trim();

function defaultBaseDir(): string {
  // Resolved from the backend working directory so it is stable across `dev`
  // (ts-node from source) and `start` (compiled dist). Override with SCENARIO_DIR.
  return (
    process.env.SCENARIO_DIR ||
    path.resolve(process.cwd(), "../bato-files-with-objectives/bato")
  );
}

function read(baseDir: string, relativePath: string): string {
  return fs.readFileSync(path.join(baseDir, relativePath), "utf8").trim();
}

export function loadScenarioContent(baseDir: string = defaultBaseDir()): ScenarioContent {
  const identity = IDENTITY_FILES.map((f) => read(baseDir, f)).join("\n\n---\n\n");

  const stages = {} as Record<StageNumber, ScenarioStageContent>;
  for (const n of [1, 2, 3, 4, 5] as StageNumber[]) {
    const slug = STAGE_SLUGS[n];
    stages[n] = {
      base: read(baseDir, path.join("stages", `${slug}.md`)),
      agenda: read(baseDir, path.join("stages", `${slug}.bato-agenda.md`))
    };
  }

  return { identity, stages };
}

export function buildBatoSystemPrompt(stage: StageNumber, content: ScenarioContent): string {
  const def = STAGES[stage];
  const s = content.stages[stage];
  return [
    "# WHO YOU ARE",
    content.identity,
    "",
    "# HOW TO ACT",
    GLOBAL_RULES,
    "",
    `# CURRENT MOMENT — Stage ${stage}: ${def.name}`,
    s.base,
    "",
    "# YOUR AGENDA RIGHT NOW",
    s.agenda,
    "",
    "Respond ONLY as Bato would speak aloud in this moment — in character, in his voice."
  ].join("\n");
}

export function buildStageJudgePrompt(
  stage: StageNumber,
  exchange: { negotiator: string; bato: string }
): string {
  const def = STAGES[stage];
  return [
    `You are a neutral BCSM evaluator. The subject is in Stage ${stage}: ${def.name}.`,
    "",
    `WIN SIGNAL (set passed=true only if genuinely present in Bato's reply): ${def.winSignal}`,
    `RETREAT TRIGGERS (moved="retreated"): ${def.retreatTriggers.join("; ")}`,
    `CATASTROPHIC TRIGGERS (set catastrophic_event, ends the negotiation): ${def.catastrophicTriggers.join("; ")}`,
    "",
    "EXCHANGE TO EVALUATE:",
    `Negotiator: ${exchange.negotiator}`,
    `Bato: ${exchange.bato}`,
    "",
    "Return ONLY JSON in this shape:",
    `{"stage":{"current":${stage},"passed":false,"moved":"advanced|held|retreated","evidence":"cite the specific behavioral signal you observed"},"catastrophic_event":null}`,
    'Set catastrophic_event to {"type":"...","evidence":"..."} only if a catastrophic trigger occurred.'
  ].join("\n");
}
