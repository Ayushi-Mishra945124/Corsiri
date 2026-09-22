import { detectBrowserTaskPack } from "./browserTaskPacks.js";

const ALLOWED_TOOLS = new Set([
  "navigate",
  "click_role",
  "click_text",
  "fill_label",
  "fill_name",
  "fill_placeholder",
  "type_active",
  "select_option",
  "check_radio",
  "check_checkbox",
  "open_new_tab",
  "switch_tab",
  "press_key",
  "scroll",
  "extract_dom",
  "wait_for_text",
  "wait_ms",
  "apply_answer_key"
]);

const MAX_ANSWER_KEY_ENTRIES = 32;

function parseJsonObject(rawText) {
  if (!rawText || !rawText.trim()) {
    return null;
  }

  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const startIndex = candidate.indexOf("{");
    const endIndex = candidate.lastIndexOf("}");
    if (startIndex < 0 || endIndex <= startIndex) {
      return null;
    }

    try {
      return JSON.parse(candidate.slice(startIndex, endIndex + 1));
    } catch {
      return null;
    }
  }
}

function normalizeStep(step) {
  if (!step || typeof step !== "object") {
    return null;
  }

  const tool = typeof step.tool === "string" ? step.tool.trim().toLowerCase() : "";
  if (!ALLOWED_TOOLS.has(tool)) {
    return null;
  }

  const normalized = { tool };
  for (const key of [
    "role",
    "name",
    "text",
    "label",
    "nameAttribute",
    "placeholder",
    "question",
    "option",
    "url",
    "key"
  ]) {
    if (typeof step[key] === "string" && step[key].trim()) {
      normalized[key] = step[key].trim();
    }
  }

  if (Array.isArray(step.answers)) {
    const answers = step.answers
      .map((answer) => ({
        question: typeof answer?.question === "string" && answer.question.trim() ? answer.question.trim() : undefined,
        option: typeof answer?.option === "string" ? sanitizeAnswerOption(answer.option) : ""
      }))
      .filter((answer) => answer.option)
      .slice(0, MAX_ANSWER_KEY_ENTRIES);

    if (answers.length > 0) {
      normalized.answers = answers;
    }
  }

  if (typeof step.advancePages === "boolean") {
    normalized.advancePages = step.advancePages;
  }

  if (Number.isFinite(step.waitMs) && step.waitMs > 0) {
    normalized.waitMs = Math.min(5000, Math.round(step.waitMs));
  }

  return normalized;
}

function sanitizePlan(plan) {
  const parsedSteps = Array.isArray(plan?.steps)
    ? plan.steps.map(normalizeStep).filter(Boolean).slice(0, 16)
    : [];

  return {
    goal: typeof plan?.goal === "string" && plan.goal.trim()
      ? plan.goal.trim()
      : "browser_action",
    summary: typeof plan?.summary === "string" && plan.summary.trim()
      ? plan.summary.trim()
      : "Apply the generated result to the current browser page.",
    requiresConfirmation: Boolean(plan?.requiresConfirmation),
    steps: parsedSteps
  };
}

function containsAny(text = "", values = []) {
  const normalized = String(text).toLowerCase();
  return values.some((value) => normalized.includes(String(value).toLowerCase()));
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function textMatches(left = "", right = "") {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function isMailLike({ taskPack, contentType, action, voiceCommand }) {
  return (
    taskPack?.id === "mail_compose" ||
    String(contentType).toLowerCase() === "email" ||
    containsAny(`${action} ${voiceCommand}`, ["email", "mail", "compose", "send", "schedule"])
  );
}

function isFormsLike({ taskPack, contentType, voiceCommand }) {
  const normalizedType = String(contentType).toLowerCase();
  return (
    taskPack?.id === "google_forms" ||
    taskPack?.id === "qa_form" ||
    normalizedType === "mcq" ||
    (normalizedType === "question" && containsAny(voiceCommand, ["fill", "autofill", "check", "tick", "mark", "select"]))
  );
}

function isDiscordLike({ taskPack, voiceCommand, browserContext }) {
  return (
    taskPack?.id === "discord" ||
    containsAny(`${voiceCommand} ${browserContext?.url} ${browserContext?.title}`, ["discord", "dm", "direct message", "channel"])
  );
}

function isShoppingLike({ taskPack, contentType, voiceCommand, browserContext }) {
  return (
    taskPack?.id === "shopping" ||
    String(contentType).toLowerCase() === "product" ||
    containsAny(`${voiceCommand} ${browserContext?.url} ${browserContext?.title}`, ["amazon", "flipkart", "walmart", "cart", "buy", "purchase"])
  );
}

function isRiskyBrowserAction(voiceCommand = "") {
  return containsAny(voiceCommand, ["send", "schedule", "submit", "delete", "purchase", "buy", "checkout"]);
}

function extractEmailAddress(...values) {
  for (const value of values) {
    const match = String(value || "").match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function extractSubject(originalText = "", resultText = "") {
  for (const source of [originalText, resultText]) {
    const match = String(source).match(/^\s*subject:\s*(.+)$/im);
    if (match?.[1]) {
      return match[1].trim().slice(0, 140);
    }
  }

  const firstLine = String(originalText).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) {
    return "";
  }

  return firstLine.length <= 120 ? firstLine : firstLine.slice(0, 117).trimEnd() + "...";
}

function stripEmailBody(resultText = "") {
  return String(resultText)
    .replace(/^\s*subject:\s*.+$/im, "")
    .trim();
}

function extractSearchQuery(originalText = "", resultText = "", voiceCommand = "") {
  for (const candidate of [voiceCommand, originalText, resultText]) {
    const trimmed = String(candidate || "").trim();
    if (!trimmed) {
      continue;
    }

    const cleaned = trimmed
      .replace(/\b(open|new tab|search|find|add to cart|buy|purchase|amazon|flipkart|walmart|for me)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) {
      return cleaned.slice(0, 120);
    }
  }

  return "";
}

function parseAnswerKey(resultText = "") {
  const answers = [];
  const lines = String(resultText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parsedEntry = parseAnswerKeyLine(line);
    if (parsedEntry) {
      answers.push(parsedEntry);
      continue;
    }

    const answerMatch = line.match(/^(?:answer|best answer|correct answer)\s*[:.-]\s*(.+?)(?:\s+-\s+.+)?$/i);
    if (answerMatch) {
      const option = sanitizeAnswerOption(answerMatch[1]);
      if (option) {
        answers.push({
          question: "",
          option
        });
      }
    }
  }

  return answers.slice(0, MAX_ANSWER_KEY_ENTRIES);
}

function parseAnswerKeyLine(line = "") {
  const bracketedMatch = line.match(/^(?:q(?:uestion)?\s*)?(\d+)?\s*(?:\[(.+?)\])\s*:\s*(.+?)(?:\s+-\s+.+)?$/i);
  if (bracketedMatch) {
    const question = (bracketedMatch[2] || "").trim();
    const option = sanitizeAnswerOption(bracketedMatch[3]);
    if (option) {
      return {
        question: question || (bracketedMatch[1] ? `Question ${bracketedMatch[1]}` : ""),
        option
      };
    }
  }

  const numberedQuestionMatch = line.match(/^(?:q(?:uestion)?\s*)?(\d+)\s+(.+?)\s*:\s*(.+?)(?:\s+-\s+.+)?$/i);
  if (numberedQuestionMatch) {
    const question = (numberedQuestionMatch[2] || "").trim();
    const option = sanitizeAnswerOption(numberedQuestionMatch[3]);
    if (option) {
      return {
        question: question || `Question ${numberedQuestionMatch[1]}`,
        option
      };
    }
  }

  const simpleQuestionMatch = line.match(/^(.+?)\s*:\s*(.+?)(?:\s+-\s+.+)?$/);
  if (simpleQuestionMatch && /\b(q(?:uestion)?\s*\d+|find|term|difference|sequence|value|next term|common difference|negative term|sum)\b/i.test(simpleQuestionMatch[1])) {
    const question = (simpleQuestionMatch[1] || "").trim();
    const option = sanitizeAnswerOption(simpleQuestionMatch[2]);
    if (option) {
      return { question, option };
    }
  }

  return null;
}

function sanitizeAnswerOption(value = "") {
  const cleaned = String(value)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/^(option|answer)\s+/i, "")
    .trim();

  if (
    !cleaned ||
    /^(needs user input|user input required|not applicable|n\/a|skip|cannot infer)$/i.test(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

function extractQuestionLabel(sourceText = "") {
  const lines = String(sourceText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^(?:[a-d]|\d+)[\).:-]\s+/i.test(line)) {
      break;
    }

    if (line.length > 6) {
      return line;
    }
  }

  return "";
}

function extractOptionTexts(sourceText = "") {
  return String(sourceText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(?:[a-d]|\d+)[\).:-]\s+(.+)$/i);
      return match?.[1]?.trim() || "";
    })
    .filter(Boolean)
    .slice(0, 12);
}

function pickBestMatchingOption(answerText = "", candidateOptions = []) {
  const cleanedAnswer = sanitizeAnswerOption(answerText);
  if (!cleanedAnswer || candidateOptions.length === 0) {
    return "";
  }

  const normalizedAnswer = normalizeText(cleanedAnswer);
  const letterMatch = normalizedAnswer.match(/^[a-d]$/i);
  if (letterMatch) {
    const index = letterMatch[0].toLowerCase().charCodeAt(0) - 97;
    return candidateOptions[index] || "";
  }

  const directMatch = candidateOptions.find((option) => textMatches(cleanedAnswer, option));
  if (directMatch) {
    return directMatch;
  }

  const answerTokens = normalizedAnswer.split(" ").filter(Boolean);
  let bestMatch = "";
  let bestScore = 0;

  for (const option of candidateOptions) {
    const normalizedOption = normalizeText(option);
    const score = answerTokens.filter((token) => normalizedOption.includes(token)).length;
    if (score > bestScore) {
      bestMatch = option;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestMatch : "";
}

function inferAnswersFromSelection({ originalText = "", resultText = "" }) {
  const parsedAnswers = parseAnswerKey(resultText);
  const candidateOptions = extractOptionTexts(originalText);
  const defaultQuestion = extractQuestionLabel(originalText);

  if (parsedAnswers.length > 0) {
    return parsedAnswers
      .map((answer) => ({
        question: answer.question || defaultQuestion,
        option: pickBestMatchingOption(answer.option, candidateOptions) || answer.option
      }))
      .filter((answer) => sanitizeAnswerOption(answer.option))
      .slice(0, MAX_ANSWER_KEY_ENTRIES);
  }

  if (candidateOptions.length > 0) {
    const matchedOption = pickBestMatchingOption(resultText, candidateOptions);
    if (matchedOption) {
      return [
        {
          question: defaultQuestion,
          option: matchedOption
        }
      ];
    }
  }

  return [];
}

function shouldAdvanceQuiz({ voiceCommand = "", browserContext }) {
  const browserText = `${browserContext?.title || ""} ${browserContext?.visibleText || ""}`;
  if (containsAny(voiceCommand, ["next", "continue", "attempt all", "all questions", "autofill all", "entire quiz"])) {
    return true;
  }

  return /\b\d+\s*\/\s*\d+\b/.test(browserText);
}

function buildNextQuizSteps({ browserContext }) {
  const browserText = `${browserContext?.title || ""} ${browserContext?.visibleText || ""}`;
  if (!containsAny(browserText, ["next", "continue"]) && !/\b\d+\s*\/\s*\d+\b/.test(browserText)) {
    return [];
  }

  return [
    {
      tool: "click_role",
      role: "button",
      name: "Next"
    },
    {
      tool: "wait_ms",
      waitMs: 900
    }
  ];
}

function buildExpectedQuizOptions({ originalText = "", resultText = "" }) {
  return inferAnswersFromSelection({ originalText, resultText })
    .map((answer) => normalizeText(answer.option))
    .filter(Boolean);
}

function isQuizPlanPlausible({ plan, originalText, resultText }) {
  const expectedOptions = buildExpectedQuizOptions({ originalText, resultText });
  if (expectedOptions.length === 0) {
    return plan.steps.length > 0;
  }

  const answerKeyStep = plan.steps.find((step) => step.tool === "apply_answer_key" && Array.isArray(step.answers));
  if (answerKeyStep) {
    const options = answerKeyStep.answers
      .map((answer) => normalizeText(answer.option))
      .filter(Boolean);

    if (options.length === 0) {
      return false;
    }

    return options.every((candidate) => expectedOptions.some((expected) => textMatches(expected, candidate)));
  }

  const choiceSteps = plan.steps.filter((step) => ["check_radio", "check_checkbox", "select_option", "click_text"].includes(step.tool));
  if (choiceSteps.length === 0) {
    return false;
  }

  return choiceSteps.every((step) => {
    const candidate = normalizeText(step.option || step.text || step.name || "");
    return candidate && expectedOptions.some((expected) => textMatches(expected, candidate));
  });
}

function buildMailFallbackPlan({ browserContext, originalText, resultText, voiceCommand }) {
  const recipient = extractEmailAddress(voiceCommand, originalText, resultText);
  const subject = extractSubject(originalText, resultText);
  const body = stripEmailBody(resultText);
  const browserText = `${browserContext?.url} ${browserContext?.title} ${browserContext?.visibleText}`;
  const onMailPage = containsAny(browserText, [
    "mail.google.com",
    "outlook.office.com",
    "outlook.live.com",
    "compose",
    "inbox"
  ]);
  const shouldReply = containsAny(voiceCommand, ["reply", "respond"]) || containsAny(`${originalText} ${resultText}`, ["re:", "reply"]);
  const replyVisible = containsAny(browserText, ["reply", "reply all", "send"]);

  const steps = [];
  if (shouldReply && onMailPage && replyVisible) {
    steps.push({
      tool: "click_role",
      role: "button",
      name: "Reply"
    });
    steps.push({
      tool: "wait_ms",
      waitMs: 900
    });
  } else if (!onMailPage) {
    steps.push({
      tool: "open_new_tab",
      url: "https://mail.google.com/mail/u/0/#inbox?compose=new"
    });
    steps.push({
      tool: "wait_ms",
      waitMs: 1800
    });
  } else if (containsAny(browserContext?.visibleText, ["compose", "new message"]) && !containsAny(browserContext?.visibleText, ["message body", "subject"])) {
    steps.push({
      tool: "click_role",
      role: "button",
      name: "Compose"
    });
    steps.push({
      tool: "wait_ms",
      waitMs: 900
    });
  }

  if (recipient && !shouldReply) {
    steps.push({
      tool: "fill_label",
      label: "To recipients",
      text: recipient
    });
  }

  if (subject) {
    steps.push({
      tool: "fill_label",
      label: "Subject",
      text: subject
    });
  }

  if (body) {
    steps.push(
      shouldReply
        ? {
            tool: "type_active",
            text: body
          }
        : {
            tool: "fill_label",
            label: "Message Body",
            text: body
          }
    );
  }

  if (containsAny(voiceCommand, ["schedule"])) {
    steps.push({
      tool: "click_role",
      role: "button",
      name: "More send options"
    });
  } else if (containsAny(voiceCommand, ["send"])) {
    steps.push({
      tool: "click_role",
      role: "button",
      name: "Send"
    });
  }

  return {
    goal: shouldReply ? "reply_to_email" : "apply_email_result",
    summary: recipient
      ? `Open compose and draft the email for ${recipient}.`
      : shouldReply
        ? "Open the reply composer and insert the generated response."
        : "Open compose and draft the generated email body.",
    requiresConfirmation: isRiskyBrowserAction(voiceCommand),
    steps: steps.slice(0, 16)
  };
}

function buildFormsFallbackPlan({ originalText, resultText, voiceCommand, browserContext }) {
  const answers = inferAnswersFromSelection({ originalText, resultText });
  if (answers.length === 0) {
    return null;
  }

  const advancePages = shouldAdvanceQuiz({ voiceCommand, browserContext });

  return {
    goal: "fill_form_answers",
    summary: advancePages
      ? "Apply the answer key across the visible quiz and continue page-by-page when needed."
      : "Apply the answer key to the visible form questions.",
    requiresConfirmation: false,
    steps: [
      {
        tool: "apply_answer_key",
        answers: answers.slice(0, MAX_ANSWER_KEY_ENTRIES),
        advancePages
      }
    ]
  };
}

function buildDiscordFallbackPlan({ resultText, voiceCommand, browserContext }) {
  const body = String(resultText || "").trim();
  if (!body) {
    return null;
  }

  const onDiscordPage = containsAny(`${browserContext?.url} ${browserContext?.title}`, ["discord.com", "discord"]);
  return {
    goal: "draft_or_send_discord_message",
    summary: containsAny(voiceCommand, ["send"])
      ? "Fill the Discord composer with the generated message and send it after confirmation."
      : "Fill the Discord composer with the generated message.",
    requiresConfirmation: isRiskyBrowserAction(voiceCommand),
    steps: [
      !onDiscordPage
        ? {
            tool: "open_new_tab",
            url: "https://discord.com/channels/@me"
          }
        : null,
      !onDiscordPage
        ? {
            tool: "wait_ms",
            waitMs: 1800
          }
        : null,
      {
        tool: "fill_label",
        label: "Message",
        text: body
      },
      containsAny(voiceCommand, ["send"])
        ? {
            tool: "press_key",
            key: "Enter"
          }
        : null
    ].filter(Boolean)
  };
}

function buildShoppingFallbackPlan({ originalText, resultText, voiceCommand }) {
  const query = extractSearchQuery(originalText, resultText, voiceCommand);
  if (!query) {
    return null;
  }

  const shouldAddToCart = containsAny(voiceCommand, ["add to cart", "cart"]);
  const shouldOpenAmazon = containsAny(voiceCommand, ["amazon"]) || shouldAddToCart;
  const searchUrl = shouldOpenAmazon
    ? `https://www.amazon.in/s?k=${encodeURIComponent(query)}`
    : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  return {
    goal: shouldAddToCart ? "search_product_and_add_to_cart" : "search_product",
    summary: shouldAddToCart
      ? `Open a new tab, search for ${query}, and continue toward add-to-cart flow with confirmation.`
      : `Open a new tab and search for ${query}.`,
    requiresConfirmation: shouldAddToCart,
    steps: [
      {
        tool: "open_new_tab",
        url: searchUrl
      },
      {
        tool: "wait_ms",
        waitMs: 1800
      },
      shouldAddToCart
        ? {
            tool: "click_role",
            role: "button",
            name: "Add to Cart"
          }
        : null
    ].filter(Boolean)
  };
}

function buildFallbackPlan({ taskPack, originalText, resultText, action, voiceCommand, contentType, browserContext }) {
  if (isMailLike({ taskPack, contentType, action, voiceCommand })) {
    return buildMailFallbackPlan({ browserContext, originalText, resultText, voiceCommand });
  }

  if (isFormsLike({ taskPack, contentType, voiceCommand })) {
    return buildFormsFallbackPlan({ originalText, resultText, voiceCommand, browserContext });
  }

  if (isDiscordLike({ taskPack, voiceCommand, browserContext })) {
    return buildDiscordFallbackPlan({ resultText, voiceCommand, browserContext });
  }

  if (isShoppingLike({ taskPack, contentType, voiceCommand, browserContext })) {
    return buildShoppingFallbackPlan({ originalText, resultText, voiceCommand });
  }

  return null;
}

function buildBrowserActionPrompt({
  originalText,
  resultText,
  action,
  voiceCommand,
  contentType,
  browserContext,
  taskPack
}) {
  return [
    "You are the Corsiri browser action planner.",
    "Convert the user's intent plus the current browser page context into a safe executable action plan.",
    "Return strict JSON only. No markdown.",
    JSON.stringify(
      {
        goal: "short_snake_case_goal",
        summary: "one concise sentence describing what will happen",
        requiresConfirmation: true,
        steps: [
          {
            tool:
              "navigate|open_new_tab|switch_tab|click_role|click_text|fill_label|fill_name|fill_placeholder|type_active|select_option|check_radio|check_checkbox|press_key|scroll|extract_dom|wait_for_text|wait_ms|apply_answer_key",
            role: "optional aria role like button/link/textbox",
            name: "optional accessible name",
            label: "optional field label",
            text: "optional text to type or click",
            question: "optional question/group name for radio buttons",
            option: "optional option text",
            answers: [{ question: "optional visible question", option: "required visible answer label" }],
            advancePages: true,
            url: "optional url",
            key: "optional keyboard key",
            waitMs: 250
          }
        ]
      },
      null,
      2
    ),
    "Rules:",
    "- Use only the listed tools.",
    "- Prefer fill_label, click_role, select_option, and check_radio over brittle generic clicks.",
    "- Use open_new_tab only when the command explicitly implies a new tab or when the destination is clearly different from the current page.",
    "- Use switch_tab when the instruction refers to a tab by site, title, or purpose.",
    "- Use scroll when content must be brought into view before acting.",
    "- Use extract_dom when you need one explicit re-check of the current page before deciding later steps.",
    "- Use the browser page context exactly as provided. Do not invent elements that are not present.",
    "- For MCQ or form filling, map answer choices to visible radio/select controls.",
    "- For MCQs, treat the original selected text plus generated result as the answer source, then match those answers to visible question groups and option labels on the page.",
    "- For MCQs, never treat quiz counters or page numbers like '2/11' or '12' as answer options.",
    "- For MCQs, prefer the exact visible answer label text such as 'February 29' instead of a numeric index.",
    "- For email workflows, fill recipient, subject, and body fields only when those fields are visible or clearly labeled in the page context.",
    "- For email workflows, use the generated result as the body content when appropriate.",
    "- If navigation is needed, only navigate when the destination is explicit from the command or current page flow.",
    "- If the request is risky (send, submit, schedule, delete, purchase), set requiresConfirmation to true.",
    "- For risky flows, do not skip the final button press, but make sure confirmation is required first.",
    "- If there is not enough page context to act safely, return an empty steps array and explain why in summary.",
    "- Keep plans short and practical.",
    taskPack ? `Detected task pack: ${taskPack.label}. ${taskPack.guidance}` : "Detected task pack: none",
    `Executed content action: ${action || "unknown"}`,
    `Selection content type: ${contentType || "general_text"}`,
    `Voice command: ${voiceCommand || "none"}`,
    "Original selected text:",
    originalText || "(none)",
    "Generated result to apply:",
    resultText || "(none)",
    "Browser page context:",
    JSON.stringify(browserContext, null, 2)
  ].join("\n\n");
}

export function createBrowserActionPlanner({ generateText }) {
  return async ({
    originalText,
    resultText,
    action,
    voiceCommand,
    contentType,
    browserContext
  }) => {
    const taskPack = detectBrowserTaskPack({
      browserContext,
      contentType,
      action,
      voiceCommand
    });

    const prompt = buildBrowserActionPrompt({
      originalText,
      resultText,
      action,
      voiceCommand,
      contentType,
      browserContext,
      taskPack
    });

    const generated = await generateText({
      prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.15
      }
    });

    const parsed = parseJsonObject(generated.text);
    const sanitized = sanitizePlan(parsed);
    if (
      sanitized.steps.length > 0 &&
      (!isFormsLike({ taskPack, contentType, voiceCommand }) ||
        isQuizPlanPlausible({
          plan: sanitized,
          originalText,
          resultText
        }))
    ) {
      if (isFormsLike({ taskPack, contentType, voiceCommand }) && shouldAdvanceQuiz({ voiceCommand, browserContext })) {
        const hasNextStep = sanitized.steps.some((step) => step.tool === "click_role" && normalizeText(step.name) === "next");
        if (!hasNextStep) {
          sanitized.steps.push(...buildNextQuizSteps({ browserContext }));
          sanitized.steps = sanitized.steps.slice(0, 16);
        }
      }

      return sanitized;
    }

    return buildFallbackPlan({
      taskPack,
      originalText,
      resultText,
      action,
      voiceCommand,
      contentType,
      browserContext
    }) ?? sanitized;
  };
}
