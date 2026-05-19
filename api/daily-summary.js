const { randomUUID } = require("crypto");

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const GEMINI_TIMEOUT_MS = 25000;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://spuqofvejpbktfuwiwsy.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_BxzvNWXpNDLkPiYpRNtvNQ_4Pd83yqi";
const SUMMARY_DISCLAIMER =
  "Educational trading journal summary only; not financial advice or a guarantee of future results.";

const SUMMARY_SCHEMA = {
  type: "object",
  required: [
    "summaryDate",
    "headline",
    "totalTrades",
    "totalProfitLoss",
    "winRate",
    "bestTrade",
    "worstTrade",
    "mostRepeatedMistake",
    "emotionalPattern",
    "riskManagementQuality",
    "topImprovementsForTomorrow",
    "mentorNote",
    "disclaimer"
  ],
  properties: {
    summaryDate: { type: "string" },
    headline: { type: "string" },
    totalTrades: { type: "integer" },
    totalProfitLoss: { type: "number" },
    winRate: { type: "number" },
    bestTrade: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        profitLoss: { type: "number" },
        note: { type: "string" }
      }
    },
    worstTrade: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        profitLoss: { type: "number" },
        note: { type: "string" }
      }
    },
    mostRepeatedMistake: { type: "string" },
    emotionalPattern: { type: "string" },
    riskManagementQuality: { type: "string" },
    topImprovementsForTomorrow: {
      type: "array",
      items: { type: "string" }
    },
    mentorNote: { type: "string" },
    disclaimer: { type: "string" }
  }
};

const SUMMARY_INSTRUCTIONS = [
  "You are a professional trading mentor reviewing one completed trading day.",
  "Keep the response concise, practical, beginner-friendly, and trader-focused.",
  "Use the provided daily metrics as the source of truth for totals.",
  "Identify the most repeated mistake from trade notes, emotions, AI reviews, and risk fields.",
  "Do not promise profit, predict future price, or give financial guarantees.",
  "Focus on discipline, process, risk control, journaling quality, and tomorrow's execution.",
  "Return only valid JSON matching the requested shape."
].join(" ");

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function logSummaryEvent(level, message, details = {}) {
  console[level]("[daily-summary] " + message, {
    requestId: details.requestId,
    status: details.status,
    model: details.model,
    schemaMode: details.schemaMode,
    summaryDate: details.summaryDate,
    tradeCount: details.tradeCount,
    candidateCount: details.candidateCount,
    finishReason: details.finishReason,
    promptBlockReason: details.promptBlockReason,
    hasOutputText: details.hasOutputText,
    usage: details.usage,
    error: details.error,
    fallback: details.fallback
  });
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

async function saveDailySummary(authorizationHeader, userId, summary) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/daily_ai_summaries?on_conflict=user_id,summary_date`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: authorizationHeader,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({
        user_id: userId,
        summary_date: summary.summaryDate,
        summary_json: summary,
        created_at: summary.generatedAt || new Date().toISOString()
      })
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || data?.error || "Could not save daily summary to Supabase.";
    throw createHttpError(
      502,
      `${message} Run the daily_ai_summaries SQL migration and confirm RLS policies are enabled.`
    );
  }

  return Array.isArray(data) ? data[0] : data;
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function normalizeTrade(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const symbol = normalizeText(value.symbol).toUpperCase().slice(0, 40);

  if (!symbol) {
    return null;
  }

  return {
    symbol,
    type: value.type === "short" ? "short" : "long",
    profitLoss: parseNumber(value.profitLoss),
    profitLossPercent: parseNumber(value.profitLossPercent),
    riskPercent: parseNumber(value.riskPercent),
    rewardRiskRatio: parseNumber(value.rewardRiskRatio),
    emotion: normalizeText(value.emotion, "Not provided").slice(0, 160),
    notes: normalizeText(value.notes, "Not provided").slice(0, 800),
    aiReviewSummary: normalizeText(value.aiReviewSummary).slice(0, 700),
    aiReviewMistakes: Array.isArray(value.aiReviewMistakes)
      ? value.aiReviewMistakes.map((item) => normalizeText(item)).filter(Boolean).slice(0, 3)
      : []
  };
}

function normalizeDailySummaryPayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const summaryDate = normalizeText(value.summaryDate);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(summaryDate)) {
    return null;
  }

  const trades = Array.isArray(value.trades)
    ? value.trades.map(normalizeTrade).filter(Boolean).slice(0, 80)
    : [];

  if (trades.length === 0) {
    return null;
  }

  const metrics = value.metrics && typeof value.metrics === "object" ? value.metrics : {};

  return {
    summaryDate,
    metrics: {
      totalTrades: Math.max(0, Math.round(parseNumber(metrics.totalTrades || trades.length))),
      totalProfitLoss: parseNumber(metrics.totalProfitLoss),
      winRate: parseNumber(metrics.winRate),
      averageRiskPercent: parseNumber(metrics.averageRiskPercent),
      highRiskTrades: Math.max(0, Math.round(parseNumber(metrics.highRiskTrades))),
      bestTrade: metrics.bestTrade || null,
      worstTrade: metrics.worstTrade || null
    },
    trades
  };
}

function getGeminiGenerateUrl(model) {
  const normalizedModel = String(model || DEFAULT_MODEL).replace(/^models\//, "");
  return `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

function getModelCandidates() {
  const configuredModel = String(process.env.GEMINI_MODEL || "").trim();
  return configuredModel ? [configuredModel] : [DEFAULT_MODEL, ...FALLBACK_MODELS];
}

function buildSummaryPrompt(payload) {
  return [
    SUMMARY_INSTRUCTIONS,
    "",
    "Return this JSON shape:",
    JSON.stringify({
      summaryDate: payload.summaryDate,
      headline: "One sentence day summary.",
      totalTrades: payload.metrics.totalTrades,
      totalProfitLoss: payload.metrics.totalProfitLoss,
      winRate: payload.metrics.winRate,
      bestTrade: { symbol: "BTCUSDT", profitLoss: 0, note: "Why it was best." },
      worstTrade: { symbol: "ETHUSDT", profitLoss: 0, note: "Why it was worst." },
      mostRepeatedMistake: "Most repeated process mistake.",
      emotionalPattern: "Main emotional pattern.",
      riskManagementQuality: "Risk quality assessment.",
      topImprovementsForTomorrow: [
        "Improvement 1",
        "Improvement 2",
        "Improvement 3"
      ],
      mentorNote: "Short mentor note.",
      disclaimer: SUMMARY_DISCLAIMER
    }, null, 2),
    "",
    "Daily trading data:",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function createGeminiRequestBody(payload, schemaMode) {
  const generationConfig = {
    temperature: 0.25,
    maxOutputTokens: 900
  };

  if (schemaMode === "response_format") {
    generationConfig.responseFormat = {
      text: {
        mimeType: "application/json",
        schema: SUMMARY_SCHEMA
      }
    };
  } else {
    generationConfig.responseMimeType = "application/json";
  }

  if (schemaMode === "legacy_schema") {
    generationConfig.responseJsonSchema = SUMMARY_SCHEMA;
  }

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: buildSummaryPrompt(payload) }]
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

function parseSummaryJson(outputText) {
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

function getGeminiBlockMessage(responseData) {
  const promptBlock = responseData.promptFeedback?.blockReason;

  if (promptBlock) {
    return `Gemini blocked the daily summary request: ${promptBlock}.`;
  }

  const finishReason = responseData.candidates?.[0]?.finishReason;

  if (finishReason && finishReason !== "STOP") {
    return `Gemini stopped before completing the daily summary: ${finishReason}.`;
  }

  return "";
}

function getGeminiErrorMessage(statusCode, responseData) {
  const providerMessage = responseData?.error?.message;

  if (providerMessage) {
    return providerMessage;
  }

  if (statusCode === 400) {
    return "Gemini rejected the daily summary request. Check the model name or response schema.";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "Gemini API key was rejected. Check GEMINI_API_KEY in Vercel.";
  }

  if (statusCode === 429) {
    return "Gemini rate limit reached. Please wait and try again.";
  }

  return "Gemini could not generate the daily summary.";
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

function normalizeTradeRef(value) {
  if (!value || typeof value !== "object") {
    return {
      symbol: "",
      profitLoss: 0,
      note: "No trade available."
    };
  }

  return {
    symbol: normalizeText(value.symbol).toUpperCase(),
    profitLoss: parseNumber(value.profitLoss),
    note: normalizeText(value.note, "No extra note.")
  };
}

function normalizeImprovements(value) {
  const improvements = Array.isArray(value) ? value : [value];
  return improvements
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeSummary(summary, payload, model, usageMetadata) {
  return {
    summaryDate: normalizeText(summary.summaryDate, payload.summaryDate),
    headline: normalizeText(summary.headline, "Daily trading summary generated."),
    totalTrades: Math.max(0, Math.round(parseNumber(summary.totalTrades || payload.metrics.totalTrades))),
    totalProfitLoss: parseNumber(summary.totalProfitLoss ?? payload.metrics.totalProfitLoss),
    winRate: parseNumber(summary.winRate ?? payload.metrics.winRate),
    bestTrade: normalizeTradeRef(summary.bestTrade || payload.metrics.bestTrade),
    worstTrade: normalizeTradeRef(summary.worstTrade || payload.metrics.worstTrade),
    mostRepeatedMistake: normalizeText(summary.mostRepeatedMistake, "No repeated mistake was clear from today's logs."),
    emotionalPattern: normalizeText(summary.emotionalPattern, "No strong emotional pattern was logged."),
    riskManagementQuality: normalizeText(summary.riskManagementQuality, "Risk quality was unclear from today's logs."),
    topImprovementsForTomorrow: normalizeImprovements(summary.topImprovementsForTomorrow),
    mentorNote: normalizeText(summary.mentorNote, "Review the plan before the next session."),
    disclaimer: normalizeText(summary.disclaimer, SUMMARY_DISCLAIMER),
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

async function fetchGeminiSummary(model, payload, requestId, schemaMode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    logSummaryEvent("info", "Calling Gemini", {
      requestId,
      model,
      schemaMode,
      summaryDate: payload.summaryDate,
      tradeCount: payload.trades.length
    });

    const response = await fetch(getGeminiGenerateUrl(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": String(process.env.GEMINI_API_KEY || "").trim()
      },
      body: JSON.stringify(createGeminiRequestBody(payload, schemaMode)),
      signal: controller.signal
    });
    const responseData = await response.json().catch(() => ({}));
    const responseSummary = summarizeGeminiData(responseData);

    logSummaryEvent(response.ok ? "info" : "warn", "Gemini response received", {
      requestId,
      model,
      schemaMode,
      summaryDate: payload.summaryDate,
      status: response.status,
      ...responseSummary,
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
      throw createHttpError(502, "Gemini returned an empty daily summary.");
    }

    const parsedSummary = parseSummaryJson(outputText);
    const summary = normalizeSummary(
      parsedSummary,
      payload,
      responseData.modelVersion || model,
      responseData.usageMetadata
    );

    if (!summary.headline || summary.topImprovementsForTomorrow.length === 0) {
      throw createHttpError(502, "Gemini returned an incomplete daily summary.");
    }

    return summary;
  } catch (error) {
    if (error.name === "AbortError") {
      throw createHttpError(504, "Gemini daily summary request timed out. Please try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateSummaryWithFallbacks(payload, requestId) {
  let lastError = null;
  const models = getModelCandidates();

  for (const model of models) {
    for (const schemaMode of ["response_format", "legacy_schema", "json_mode"]) {
      try {
        return await fetchGeminiSummary(model, payload, requestId, schemaMode);
      } catch (error) {
        lastError = error;
        logSummaryEvent("warn", "Gemini attempt failed", {
          requestId,
          model,
          schemaMode,
          summaryDate: payload.summaryDate,
          tradeCount: payload.trades.length,
          error: error.message,
          fallback: true
        });
      }
    }
  }

  throw lastError || createHttpError(502, "Gemini could not generate the daily summary.");
}

module.exports = async function handler(request, response) {
  const requestId = String(request.headers["x-summary-request-id"] || "").trim() || randomUUID();

  if (request.method === "OPTIONS") {
    return sendJson(response, 204, {});
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Use POST to generate a daily AI summary." });
  }

  if (!String(process.env.GEMINI_API_KEY || "").trim()) {
    logSummaryEvent("error", "Missing Gemini API key", { requestId });
    return sendJson(response, 500, {
      error: "GEMINI_API_KEY is not configured on the server.",
      requestId
    });
  }

  try {
    const user = await verifySupabaseUser(request.headers.authorization || "");

    if (!user?.id) {
      logSummaryEvent("warn", "Supabase auth failed", { requestId });
      return sendJson(response, 401, {
        error: "Log in before generating daily summaries. Supabase auth token was missing or invalid.",
        requestId
      });
    }

    const body = await readJsonBody(request);
    const payload = normalizeDailySummaryPayload(body.dailySummary);

    if (!payload) {
      return sendJson(response, 400, {
        error: "Daily summary data is missing or invalid.",
        requestId
      });
    }

    const summary = await generateSummaryWithFallbacks(payload, requestId);
    const savedSummary = await saveDailySummary(request.headers.authorization || "", user.id, summary);

    logSummaryEvent("info", "Daily summary generated", {
      requestId,
      model: summary.model,
      summaryDate: summary.summaryDate,
      tradeCount: payload.trades.length,
      usage: summary.usage
    });

    return sendJson(response, 200, { summary, savedSummary, requestId });
  } catch (error) {
    const isJsonError = error instanceof SyntaxError;
    const statusCode = error.statusCode || (isJsonError ? 400 : 500);
    const message = isJsonError
      ? "Invalid JSON request or Gemini response."
      : error.message || "Daily AI summary generation failed.";

    logSummaryEvent("error", "Daily summary request failed", {
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
