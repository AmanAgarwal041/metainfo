// Optional LLM help for AEO, with Claude: judging how an answer describes each brand, and explaining why the
// cited pages won a prompt. Only used when ANTHROPIC_API_KEY is set; everything else works without it.

import Anthropic from "@anthropic-ai/sdk";
import type { Brand, BrandResult, PageScore, Sentiment } from "@/lib/aeo";

const MODEL = process.env.AEO_MODEL || "claude-opus-5-5";

export const llmConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 }));

/** One JSON reply, constrained to `schema`. Falls back to another model if the request is declined. */
async function json<T>(system: string, user: string, schema: Record<string, unknown>, maxTokens = 16000): Promise<T> {
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The model's reply was cut off.");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

// ------------------------------------------------------------------ judge

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brands"],
  properties: {
    brands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["domain", "mentioned", "sentiment", "quote"],
        properties: {
          domain: { type: "string" },
          mentioned: { type: "boolean" },
          sentiment: { type: "string", enum: ["positive", "neutral", "mixed", "negative", "none"] },
          quote: { type: "string" },
        },
      },
    },
  },
};

/**
 * Confirms which brands an AI answer really talks about and how it describes them. Positions and citations stay
 * as matched in code: they're facts of the text, not judgments.
 */
export async function judgeAnswer(text: string, brands: Brand[], code: BrandResult[]): Promise<BrandResult[]> {
  const list = brands.map((b) => `- ${b.domain}: ${[b.name, ...(b.aliases ?? [])].join(", ")}`).join("\n");
  const out = await json<{ brands: { domain: string; mentioned: boolean; sentiment: Sentiment | "none"; quote: string }[] }>(
    "You audit AI assistant answers for a brand-visibility report. Judge only from the answer text you're given. A brand counts as mentioned when the answer refers to that company or product, not when the same word is used in another sense. Sentiment is how the answer presents the brand to someone choosing a product: positive (recommended or praised), neutral (listed or described without judgment), mixed (praise with clear caveats), negative (criticised or advised against), none (not mentioned). The quote is the single sentence from the answer that best supports your judgment, copied exactly, or an empty string.",
    `Brands (domain: names):\n${list}\n\nAnswer:\n"""\n${text.slice(0, 12000)}\n"""\n\nReturn one entry per brand, in the order listed.`,
    JUDGE_SCHEMA,
    8000,
  );
  return code.map((c) => {
    const j = out.brands.find((b) => b.domain === c.domain);
    if (!j) return c;
    const mentioned = j.mentioned || c.cited;
    return {
      ...c,
      mentioned,
      position: mentioned ? c.position : null,
      sentiment: mentioned && j.sentiment !== "none" ? j.sentiment : null,
      quote: j.quote || c.quote,
      judgedBy: "llm",
    };
  });
}

// ------------------------------------------------------------ why they won

const WHY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "whyTheyWon", "changes", "suggestedAnswer"],
  properties: {
    verdict: { type: "string" },
    whyTheyWon: { type: "array", items: { type: "string" } },
    changes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["what", "why"], properties: { what: { type: "string" }, why: { type: "string" } } },
    },
    suggestedAnswer: { type: "string" },
  },
};

const pageBlock = (label: string, p: PageScore, text: string) =>
  `## ${label}: ${p.url}\nTitle: ${p.title}\nHTTP ${p.status}${p.blockedByRobots ? " (blocked by robots.txt for this crawler)" : ""}, ${p.words} words, updated ${p.updated ?? "unknown"}, schema: ${p.schemaTypes.join(", ") || "none"}\nFactor scores: ${Object.entries(p.factors)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}\nContent (as the crawler sees it, truncated):\n${text}`;

export async function explainWin(input: {
  prompt: string;
  engine: string;
  brand: string;
  you: { score: PageScore; text: string } | null;
  cited: { score: PageScore; text: string }[];
}): Promise<{ verdict: string; whyTheyWon: string[]; changes: { what: string; why: string }[]; suggestedAnswer: string }> {
  const pages = [
    input.you ? pageBlock(`${input.brand}'s page`, input.you.score, input.you.text.slice(0, 6000)) : `## ${input.brand}'s page\nNo relevant page found on the site.`,
    ...input.cited.map((c, i) => pageBlock(`Cited page ${i + 1}`, c.score, c.text.slice(0, 3500))),
  ].join("\n\n");
  return json(
    "You are an answer-engine optimisation (AEO) analyst. Given a prompt someone asked an AI assistant, the pages the assistant cited, and the brand's own page, explain concretely why the cited pages were chosen over the brand's page and what the brand should change. Base every point on the page content and scores provided; don't invent facts about the brand. Keep it practical: name sections, headings, tables, numbers or schema to add. The suggested answer is a 60-120 word paragraph the brand could place near the top of its page so an engine can quote it; use only claims supported by the brand's page, and write [fill in] where a fact is needed but missing.",
    `Prompt: "${input.prompt}"\nEngine: ${input.engine}\nBrand: ${input.brand}\n\n${pages}\n\nReturn: verdict (one sentence), whyTheyWon (3-5 points), changes (3-6, most impactful first), suggestedAnswer.`,
    WHY_SCHEMA,
  );
}
