const { randomUUID } = require("crypto");

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const GEMINI_TIMEOUT_MS = 25000;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://spuqofvejpbktfuwiwsy.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_BxzvNWXpNDLkPiYpRNtvNQ_4Pd83yqi";
const REVIEW_DISCLAIMER =
  "Educational review only; not financial advice or a guarantee of future results.";

const REVIEW_SCHEMA = {
  type: "object",
  required: [
    "summary",
    "assessments",
    "scores",
    "possibleMistakes",
    "improvementSuggestion",
    "disclaimer"
  ],
  properties: {
    summary: { type: "string" },
    assessments: {
      type: "object",
      required: [
        "entryQuality",
        "exitQuality",
        "riskManagement",
        "emotionalDiscipline",
        "rewardRiskRatio"
      ],
      properties: {
        entryQuality: { type: "string" },
        exitQuality: { type: "string" },
        riskManagement: { type: "string" },
        emotionalDiscipline: { type: "string" },
        rewardRiskRatio: { type: "string" }
      }
    },
    scores: {
      type: "object",
      required: [
        "entryQuality",
        "exitQuality",
        "riskManagement",
        "emotionalDiscipline",
        "rewardRiskRatio"
      ],
      properties: {
        entryQuality: { type: "integer" },
        exitQuality: { type: "integer" },
        riskManagement: { type: "integer" },
        emotionalDiscipline: { type: "integer" },
        rewardRiskRatio: { type: "integer" }
      }
    },
    possibleMistakes: {
      type: "array",
      items: { type: "string" }
    },
    improvementSuggestion: { type: "string" },
    disclaimer: { type: "string" }
  }
};

const REVIEW_INSTRUCTIONS = [
  "You are a professional trading mentor reviewing a completed crypto trade.",
  "Keep the review concise, practical, beginner-friendly, and trader-focused.",
  "Analyze entry quality, exit quality, risk management, emotional discipline, reward-to-risk ratio, and possible mistakes.",
  "Do not promise profit, predict future price, or give financial guarantees.",
  "Focus on discipline, process, journaling quality, and repeatable execution.",
  "If a field is missing, say what cannot be judged and give a practical logging improvement.",
  "Use scores from 1 to 5, where 5 means strong process and 1 means weak or missing process.",
  "Return only valid JSON matching the schema."
].join(" ");

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function logReviewEvent(level, message, details = {}) {
  const safeDetails = {
    requestId: details.requestId,
    status: details.status,
    model: details.model,
    schemaMode: details.schemaMode,
    candidateCount: details.candidateCount,
    finishReason: details.finishReason,
    promptBlockReason: details.promptBlockReason,
    hasOutputText: details.hasOutputText,
    usage: details.usage,
    error: details.error,
    fallback: details.fallback
  };

  console[level](`[ai-review] ${message}`, safeDetails);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return request.body ? JSON.parse(request.body) : {};
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTradePayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const symbol = String(value.symbol || "").trim().toUpperCase().slice(0, 40);
  const type = value.type === "short" ? "short" : value.type === "long" ? "long" : "";

  if (!symbol || !type) {
    return null;
  }

  return {
    symbol,
    type,
    date: String(value.date || "").slice(0, 20),
    entryPrice: parseNumber(value.entryPrice),
    exitPrice: parseNumber(value.exitPrice),
    positionSize: parseNumber(value.positionSize),
    stopLossPrice: parseNumber(value.stopLossPrice),
    takeProfitPrice: parseNumber(value.takeProfitPrice),
    accountBalanceBefore: parseNumber(value.accountBalanceBefore),
    riskAmount: parseNumber(value.riskAmount),
    riskPercent: parseNumber(value.riskPercent),
    rewardRiskRatio: parseNumber(value.rewardRiskRatio),
    profitLoss: parseNumber(value.profitLoss),
    profitLossPercent: parseNumber(value.profitLossPercent),
    riskWarningLevelPercent: parseNumber(value.riskWarningLevelPercent),
    isHighRisk: Boolean(value.isHighRisk),
    emotion: String(value.emotion || "Not provided").trim().slice(0, 240),
    notes: String(value.notes || "Not provided").trim().slice(0, 1200)
  };
}

async function verifySupabaseUser(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authorizationHeader
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

function getGeminiGenerateUrl(model) {
  const normalizedModel = String(model || DEFAULT_MODEL).replace(/^models\//, "");
  return `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

function getModelCandidates() {
  const configuredModel = String(process.env.GEMINI_MODEL || "").trim();

  if (configuredModel) {
    return [configuredModel];
  }

  return [DEFAULT_MODEL, ...FALLBACK_MODELS];
}

function buildReviewPrompt(trade) {
  return [
    REVIEW_INSTRUCTIONS,
    "",
    "Return a JSON object with this exact shape:",
    JSON.stringify({
      summary: "short summary",
      assessments: {
        entryQuality: "entry review",
        exitQuality: "exit review",
        riskManagement: "risk review",
        emotionalDiscipline: "emotion review",
        rewardRiskRatio: "R:R review"
      },
      scores: {
        entryQuality: 3,
        exitQuality: 3,
        riskManagement: 3,
        emotionalDiscipline: 3,
        rewardRiskRatio: 3
      },
      possibleMistakes: ["mistake 1"],
      improvementSuggestion: "one next action",
      disclaimer: REVIEW_DISCLAIMER
    }, null, 2),
    "",
    "Review this completed trade:",
    JSON.stringify(trade, null, 2)
  ].join("\n");
}

function createGeminiRequestBody(trade, schemaMode) {
  const generationConfig = {
    temperature: 0.25,
    maxOutputTokens: 700
  };

  if (schemaMode === "response_format") {
    generationConfig.responseFormat = {
      text: {
        mimeType: "application/json",
        schema: REVIEW_SCHEMA
      }
    };
  } else {
    generationConfig.responseMimeType = "application/json";
  }

  if (schemaMode === "legacy_schema") {
    generationConfig.responseJsonSchema = REVIEW_SCHEMA;
  }

  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildReviewPrompt(trade)
          }
        ]
      }
    ],
    generationConfig
  };
}

function extractGeminiResponseText(responseData) {
  if (!Array.isArray(responseData.candidates)) {
    return "";
  }

  return responseData.candidates
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text)
    .filter((text) => typeof text === "string")
    .join("\n")
    .trim();
}

function getGeminiBlockMessage(responseData) {
  const promptBlock = responseData.promptFeedback?.blockReason;

  if (promptBlock) {
    return `Gemini blocked the review request: ${promptBlock}.`;
  }

  const finishReason = responseData.candidates?.[0]?.finishReason;

  if (finishReason && finishReason !== "STOP") {
    return `Gemini stopped before completing the review: ${finishReason}.`;
  }

  return "";
}

function getGeminiErrorMessage(statusCode, responseData) {
  const providerMessage = responseData?.error?.message;

  if (providerMessage) {
    return providerMessage;
  }

  if (statusCode === 400) {
    return "Gemini rejected the review request. Check the model name or response schema.";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "Gemini API key was rejected. Check GEMINI_API_KEY in Vercel.";
  }

  if (statusCode === 429) {
    return "Gemini rate limit reached. Please wait and try again.";
  }

  return "Gemini could not generate the review.";
}

function summarizeGeminiData(responseData) {
  const firstCandidate = responseData.candidates?.[0] || {};

  return {
    candidateCount: Array.isArray(responseData.candidates) ? responseData.candidates.length : 0,
    finishReason: firstCandidate.finishReason,
    promptBlockReason: responseData.promptFeedback?.blockReason,
    hasOutputText: Boolean(extractGeminiResponseText(responseData)),
    usage: responseData.usageMetadata
      ? {
          promptTokenCount: responseData.usageMetadata.promptTokenCount || 0,
          candidatesTokenCount: responseData.usageMetadata.candidatesTokenCount || 0,
          totalTokenCount: responseData.usageMetadata.totalTokenCount || 0
        }
      : null
  };
}

function parseReviewJson(outputText) {
  const trimmedText = String(outputText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmedText);
  } catch (error) {
    const firstBrace = trimmedText.indexOf("{");
    const lastBrace = trimmedText.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmedText.slice(firstBrace, lastBrace + 1));
    }

    throw error;
  }
}

async function fetchGeminiReview(model, trade, requestId, schemaMode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    logReviewEvent("info", "Calling Gemini", { requestId, model, schemaMode });

    const response = await fetch(getGeminiGenerateUrl(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": String(process.env.GEMINI_API_KEY || "").trim()
      },
      body: JSON.stringify(createGeminiRequestBody(trade, schemaMode)),
      signal: controller.signal
    });
    const responseData = await response.json().catch(() => ({}));
    const summary = summarizeGeminiData(responseData);

    logReviewEvent(response.ok ? "info" : "warn", "Gemini response received", {
      requestId,
      model,
      schemaMode,
      status: response.status,
      ...summary,
      error: response.ok ? undefined : getGeminiErrorMessage(response.status, responseData)
    });

    if (!response.ok) {
      throw createHttpError(502, getGeminiErrorMessage(response.status, responseData));
    }

    const blockMessage = getGeminiBlockMessage(responseData);
    if (blockMessage) {
      throw createHttpError(502, blockMessage);
    }

    const outputText = extractGeminiResponseText(responseData);

    if (!outputText) {
      throw createHttpError(502, "Gemini returned an empty review.");
    }

    const parsedReview = parseReviewJson(outputText);
    const review = normalizeReview(
      parsedReview,
      responseData.modelVersion || model,
      responseData.usageMetadata
    );

    if (!review.summary || !review.improvementSuggestion) {
      throw createHttpError(502, "Gemini returned an incomplete review.");
    }

    return review;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createHttpError(504, "Gemini review request timed out. Please try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateReviewWithFallbacks(trade, requestId) {
  let lastError = null;
  const models = getModelCandidates();

  for (const model of models) {
    for (const schemaMode of ["response_format", "legacy_schema", "json_mode"]) {
      try {
        return await fetchGeminiReview(model, trade, requestId, schemaMode);
      } catch (error) {
        lastError = error;
        logReviewEvent("warn", "Gemini attempt failed", {
          requestId,
          model,
          schemaMode,
          error: error.message,
          fallback: true
        });
      }
    }
  }

  throw lastError || createHttpError(502, "Gemini could not generate the review.");
}

function clampScore(value) {
  const score = Number(value);

  if (!Number.isFinite(score)) {
    return 3;
  }

  return Math.min(5, Math.max(1, Math.round(score)));
}

function normalizeReview(review, model, usageMetadata) {
  const assessments = review.assessments || {};
  const scores = review.scores || {};

  return {
    summary: String(review.summary || "").trim(),
    assessments: {
      entryQuality: String(assessments.entryQuality || "").trim(),
      exitQuality: String(assessments.exitQuality || "").trim(),
      riskManagement: String(assessments.riskManagement || "").trim(),
      emotionalDiscipline: String(assessments.emotionalDiscipline || "").trim(),
      rewardRiskRatio: String(assessments.rewardRiskRatio || "").trim()
    },
    scores: {
      entryQuality: clampScore(scores.entryQuality),
      exitQuality: clampScore(scores.exitQuality),
      riskManagement: clampScore(scores.riskManagement),
      emotionalDiscipline: clampScore(scores.emotionalDiscipline),
      rewardRiskRatio: clampScore(scores.rewardRiskRatio)
    },
    possibleMistakes: Array.isArray(review.possibleMistakes)
      ? review.possibleMistakes.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3)
      : [],
    improvementSuggestion: String(review.improvementSuggestion || "").trim(),
    disclaimer: REVIEW_DISCLAIMER,
    generatedAt: new Date().toISOString(),
    model,
    usage: usageMetadata
      ? {
          inputTokens: usageMetadata.promptTokenCount || 0,
          outputTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0
        }
      : null
  };
}

module.exports = async function handler(request, response) {
  const requestId = String(request.headers["x-review-request-id"] || "").trim() || randomUUID();

  if (request.method === "OPTIONS") {
    return sendJson(response, 204, {});
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Use POST to generate an AI review." });
  }

  if (!String(process.env.GEMINI_API_KEY || "").trim()) {
    logReviewEvent("error", "Missing Gemini API key", { requestId });
    return sendJson(response, 500, {
      error: "GEMINI_API_KEY is not configured on the server.",
      requestId
    });
  }

  try {
    logReviewEvent("info", "Review request received", {
      requestId,
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL
    });

    const user = await verifySupabaseUser(request.headers.authorization || "");

    if (!user?.id) {
      logReviewEvent("warn", "Supabase auth failed", { requestId });
      return sendJson(response, 401, {
        error: "Log in before generating AI reviews. Supabase auth token was missing or invalid.",
        requestId
      });
    }

    const body = await readJsonBody(request);
    const trade = normalizeTradePayload(body.trade);

    if (!trade) {
      return sendJson(response, 400, {
        error: "Trade data is missing or invalid.",
        requestId
      });
    }

    const review = await generateReviewWithFallbacks(trade, requestId);

    logReviewEvent("info", "Review generated", {
      requestId,
      model: review.model,
      usage: review.usage
    });

    return sendJson(response, 200, { review, requestId });
  } catch (error) {
    const isJsonError = error instanceof SyntaxError;
    const statusCode = error.statusCode || (isJsonError ? 400 : 500);
    const message = isJsonError
      ? "Invalid JSON request or Gemini response."
      : error.message || "AI review generation failed.";

    logReviewEvent("error", "Review request failed", {
      requestId,
      status: statusCode,
      error: message
    });

    return sendJson(response, statusCode, {
      error: message,
      requestId
    });
  }
};
