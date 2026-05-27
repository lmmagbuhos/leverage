import path from "path";
import fs from "fs";
import OpenAI from "openai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TurnRecord {
  role: "agent" | "bato";
  text: string;
  emotion?: string;
  stage: number;
}

export interface StageResult {
  stage: number;
  score: number;
  advanced: boolean;
  turnsUsed: number;
  failReason?: string;
}

export interface StageScore {
  stage: number;
  score: number;
  positives: string[];
  negatives: string[];
  narrative: string;
}

export interface EvaluationResult {
  stages: StageScore[];
  totalScore: number;
  overallAssessment: string;
  keyImprovementAreas: string[];
}

export interface BenchmarkSession {
  sessionId: string;
  agentLabel: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  currentStage: number;
  stageTurnCount: number;
  history: TurnRecord[];
  stageResults: StageResult[];
  evaluation?: EvaluationResult;
}

export interface TurnResponse {
  agentMove: string;
  batoReply: string;
  emotion: string;
  result: "advanced" | "held" | "failed";
  reason: string;
  newStage: number;
  sessionStatus: "running" | "failed" | "completed";
}

// ─── Session store ────────────────────────────────────────────────────────────

const sessions = new Map<string, BenchmarkSession>();

export function createSession(agentLabel = "Test Agent"): BenchmarkSession {
  const sessionId = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const session: BenchmarkSession = {
    sessionId,
    agentLabel,
    status: "idle",
    currentStage: 1,
    stageTurnCount: 0,
    history: [],
    stageResults: [],
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): BenchmarkSession | undefined {
  return sessions.get(sessionId);
}

// ─── File loaders ─────────────────────────────────────────────────────────────

const BATO_DIR = path.resolve(__dirname, "..", "bato-files-with-objectives", "bato");

function readBatoFile(relPath: string): string {
  return fs.readFileSync(path.join(BATO_DIR, relPath), "utf-8");
}

const STAGE_SLUG: Record<number, string> = {
  1: "stage-1-active-listening",
  2: "stage-2-empathy",
  3: "stage-3-rapport",
  4: "stage-4-influence",
  5: "stage-5-behavioral-change",
};

interface StageFiles {
  context: string;
  agenda: string;
  playerObjective: string;
}

function loadStageFiles(stage: number): StageFiles {
  const slug = STAGE_SLUG[stage];
  return {
    context: readBatoFile(`stages/${slug}.md`),
    agenda: readBatoFile(`stages/${slug}.bato-agenda.md`),
    playerObjective: readBatoFile(`stages/${slug}.player-objective.md`),
  };
}

const CHARACTER_PROFILE = readBatoFile("bato-character-profile.md");
const SCORING_OVERVIEW = readBatoFile("scoring-overview.md");

// ─── Stage criteria ───────────────────────────────────────────────────────────

const MAX_TURNS_PER_STAGE = 6;

const STAGE_CRITERIA: Record<number, { advance: string; fail: string }> = {
  1: {
    advance:
      "Bato acknowledges the negotiator positively, his tone softens, he begins using first-person emotional language, or his responses become noticeably longer and less defensive.",
    fail:
      "The negotiator reveals knowledge of Bato's location or contacts, explicitly attacks the drug war, demands immediate surrender, or uses condescending or shaming language.",
  },
  2: {
    advance:
      "Bato voluntarily discloses a specific emotion (fear, exhaustion, loneliness, shame) without being asked, or asks why the negotiator is helping from genuine curiosity rather than suspicion.",
    fail:
      "The negotiator pivots to giving advice or solutions before Bato feels understood, reveals contact with Bato's inner circle, or makes an obviously unkeepable promise.",
  },
  3: {
    advance:
      "Bato asks a 'what if' or 'what would happen if' question about a possible path forward, signaling active evaluation of options rather than pure survival mode.",
    fail:
      "The negotiator dismisses ally protection as a concern, pushes a single outcome without alternatives, or references new arrest pressure.",
  },
  4: {
    advance:
      "Bato uses future-oriented language such as 'when I surrender' or 'when I do this', or asks concrete logistical questions about how the surrender process would work.",
    fail:
      "The negotiator changes terms after Bato agreed in principle, makes guarantees that are obviously impossible to keep, or uses pressure tactics such as artificial urgency.",
  },
  5: {
    advance:
      "Bato explicitly confirms readiness to proceed, asks for next-step logistics, or frames his decision as principled and asks for confirmation that deal terms hold.",
    fail:
      "The negotiator cannot confirm ally protection or family access, breaks agreed deal terms, or appears unreachable during the final phase.",
  },
};

// ─── Agent prompt ─────────────────────────────────────────────────────────────

export async function generateAgentMove(
  openai: OpenAI,
  session: BenchmarkSession
): Promise<string> {
  const stage = session.currentStage;
  const { playerObjective } = loadStageFiles(stage);
  const stageName = STAGE_SLUG[stage].replace(/-/g, " ").replace("stage ", "Stage ");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a skilled crisis negotiator being evaluated on BCSM (Behavioral Change Stairway Model).
You are currently in ${stageName}. Your objective for this stage:

${playerObjective}

Rules:
- Speak naturally as if on a real call with Bato dela Rosa
- 2–4 sentences only — never monologue
- Stay calm, professional, and genuine — not theatrical
- Do NOT explain your reasoning or break character
- Output ONLY what you would say directly to Bato`,
    },
    ...session.history.map(
      (t): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: t.role === "agent" ? "user" : "assistant",
        content: t.text,
      })
    ),
    {
      role: "user",
      content:
        session.history.length === 0
          ? "Begin the negotiation. Make your opening move to Bato."
          : "Continue with your next negotiation move.",
    },
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 200,
    temperature: 0.8,
  });

  return (
    res.choices[0].message.content?.trim() ??
    "I'm here to help you find a way through this."
  );
}

// ─── Bato prompt ──────────────────────────────────────────────────────────────

export async function generateBatoReply(
  openai: OpenAI,
  session: BenchmarkSession,
  agentMove: string
): Promise<{ reply: string; emotion: string }> {
  const stage = session.currentStage;
  const { context, agenda } = loadStageFiles(stage);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are Bato dela Rosa in a crisis negotiation training simulation.

CHARACTER PROFILE:
${CHARACTER_PROFILE}

CURRENT STAGE CONTEXT:
${context}

YOUR AGENDA THIS STAGE:
${agenda}

Rules:
- Stay fully in character as Bato — never break character
- 2–4 sentences; terse and guarded early, more open as trust builds
- End your reply with ONLY this JSON tag on its own line: {"emotion":"<word>"}
- Allowed emotions: guarded, suspicious, angry, exhausted, sad, open, fearful, hopeful, resolved
- Output your reply text, then the emotion JSON tag — nothing else`,
    },
    ...session.history.map(
      (t): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: t.role === "agent" ? "user" : "assistant",
        content: t.text,
      })
    ),
    { role: "user", content: agentMove },
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 300,
    temperature: 0.85,
  });

  const raw = res.choices[0].message.content ?? "";
  const emotionMatch = raw.match(/\{"emotion"\s*:\s*"([^"]+)"\}/);
  const emotion = emotionMatch?.[1] ?? "guarded";
  const reply = raw.replace(/\{"emotion"\s*:\s*"[^"]+"\}\s*$/, "").trim();

  return { reply, emotion };
}

// ─── Stage evaluator ──────────────────────────────────────────────────────────

export async function evaluateStage(
  openai: OpenAI,
  stage: number,
  agentMove: string,
  batoReply: string,
  turnsUsed: number
): Promise<{ result: "advanced" | "held" | "failed"; reason: string }> {
  if (turnsUsed >= MAX_TURNS_PER_STAGE) {
    return {
      result: "advanced",
      reason: `Max turns (${MAX_TURNS_PER_STAGE}) reached — advancing with partial score.`,
    };
  }

  const crit = STAGE_CRITERIA[stage];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `BCSM Stage ${stage} evaluator. Assess this single exchange.

ADVANCE CRITERIA (result = "advanced"):
${crit.advance}

FAIL CRITERIA (result = "failed"):
${crit.fail}

If neither criterion is met: result = "held".

NEGOTIATOR SAID: "${agentMove}"
BATO REPLIED: "${batoReply}"

Respond ONLY with valid JSON, no other text:
{"result":"advanced","reason":"one sentence"} or {"result":"held","reason":"one sentence"} or {"result":"failed","reason":"one sentence"}`,
      },
    ],
    max_tokens: 120,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as {
      result: "advanced" | "held" | "failed";
      reason: string;
    };
    if (!["advanced", "held", "failed"].includes(parsed.result)) {
      return { result: "held", reason: "Invalid evaluator result — held by default" };
    }
    return parsed;
  } catch {
    return { result: "held", reason: "Evaluator parse error — held by default" };
  }
}

// ─── BCSM final evaluation ────────────────────────────────────────────────────

export async function runBcsmEvaluation(
  openai: OpenAI,
  session: BenchmarkSession
): Promise<EvaluationResult> {
  const transcript = session.history
    .map((t) => `[${t.role.toUpperCase()} — Stage ${t.stage}]: ${t.text}`)
    .join("\n\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: `You are a BCSM evaluator. Score this negotiation transcript.

SCORING RUBRIC:
${SCORING_OVERVIEW}

TRANSCRIPT:
${transcript}

Return ONLY valid JSON in this exact structure (all 5 stages must appear):
{
  "stages":[
    {"stage":1,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":2,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":3,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":4,"score":0,"positives":[],"negatives":[],"narrative":""},
    {"stage":5,"score":0,"positives":[],"negatives":[],"narrative":""}
  ],
  "totalScore":0,
  "overallAssessment":"",
  "keyImprovementAreas":[]
}

Score each stage 0–3. Stages not reached score 0 with narrative "Stage not reached."`,
      },
    ],
    max_tokens: 1500,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  try {
    return JSON.parse(res.choices[0].message.content ?? "{}") as EvaluationResult;
  } catch {
    return {
      stages: [1, 2, 3, 4, 5].map((s) => ({
        stage: s,
        score: 0,
        positives: [],
        negatives: ["Evaluation failed"],
        narrative: "Unable to evaluate.",
      })),
      totalScore: 0,
      overallAssessment: "Evaluation could not be completed.",
      keyImprovementAreas: [],
    };
  }
}

// ─── Turn orchestrator ────────────────────────────────────────────────────────

export async function processTurn(
  openai: OpenAI,
  session: BenchmarkSession
): Promise<TurnResponse> {
  session.status = "running";

  const agentMove = await generateAgentMove(openai, session);
  session.history.push({ role: "agent", text: agentMove, stage: session.currentStage });

  const { reply, emotion } = await generateBatoReply(openai, session, agentMove);
  session.history.push({ role: "bato", text: reply, emotion, stage: session.currentStage });

  session.stageTurnCount++;
  const { result, reason } = await evaluateStage(
    openai,
    session.currentStage,
    agentMove,
    reply,
    session.stageTurnCount
  );

  let newStage = session.currentStage;
  let sessionStatus: "running" | "failed" | "completed" = "running";

  if (result === "failed") {
    session.stageResults.push({
      stage: session.currentStage,
      score: 0,
      advanced: false,
      turnsUsed: session.stageTurnCount,
      failReason: reason,
    });
    session.status = "failed";
    sessionStatus = "failed";
  } else if (result === "advanced") {
    session.stageResults.push({
      stage: session.currentStage,
      score: 0,
      advanced: true,
      turnsUsed: session.stageTurnCount,
    });
    if (session.currentStage < 5) {
      session.currentStage++;
      session.stageTurnCount = 0;
      newStage = session.currentStage;
    } else {
      session.status = "completed";
      sessionStatus = "completed";
    }
  }

  return { agentMove, batoReply: reply, emotion, result, reason, newStage, sessionStatus };
}
