const HOST_NAME = "com.corsiri.browser_bridge";
const LEGACY_HOST_NAME = "com.cursivis.browser_bridge";
const REQUEST_TIMEOUT_MS = 30000;
const DIRECT_BRIDGE_URL = "http://127.0.0.1:48830";
const HTTP_RECONNECT_DELAY_MS = 3000;

let nativePort = null;
let reconnectTimer = null;
let connectedAtUtc = null;
let lastNativeError = null;
let bridgeTransport = "none";
let httpBridgeLoopStarted = false;
let httpBridgeAvailable = false;

bootstrap();

chrome.runtime.onInstalled.addListener(() => {
  bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap();
});


async function bootstrap() {
  await ensureBridgeConnection();
}

async function ensureBridgeConnection() {
  if (bridgeTransport === "http" && httpBridgeLoopStarted) {
    return null;
  }

  if (await isDirectBridgeAvailable()) {
    httpBridgeAvailable = true;
    bridgeTransport = "http";
    connectedAtUtc = connectedAtUtc || new Date().toISOString();
    lastNativeError = null;
    startHttpBridgeLoop();
    return null;
  }

  httpBridgeAvailable = false;
  return connectNativeHost();
}

function connectNativeHost() {
  if (bridgeTransport === "http") {
    return null;
  }

  if (nativePort) {
    return nativePort;
  }

  try {
    try {
      nativePort = chrome.runtime.connectNative(HOST_NAME);
    } catch {
      nativePort = chrome.runtime.connectNative(LEGACY_HOST_NAME);
    }
    connectedAtUtc = new Date().toISOString();
    lastNativeError = null;
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const runtimeError = chrome.runtime.lastError;
      lastNativeError = runtimeError?.message || "Native host disconnected.";
      nativePort = null;
      connectedAtUtc = null;
      bridgeTransport = "none";
      scheduleReconnect();
    });
    bridgeTransport = "native";

    postNativeMessage({
      type: "hello",
      browserName: detectBrowserName(),
      extensionId: chrome.runtime.id,
      connectedAtUtc,
      capabilities: [
        "get_active_tab_context",
        "execute_plan",
        "open_new_tab",
        "switch_tab",
        "scroll",
        "extract_dom"
      ]
    });
  } catch (error) {
    lastNativeError = error instanceof Error ? error.message : String(error);
    bridgeTransport = "none";
    scheduleReconnect();
  }

  return nativePort;
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await ensureBridgeConnection();
  }, 3000);
}

function postNativeMessage(message) {
  if (!nativePort) {
    return;
  }

  try {
    nativePort.postMessage(message);
  } catch (error) {
    lastNativeError = error instanceof Error ? error.message : String(error);
  }
}

async function handleNativeMessage(message) {
  if (!message || message.type !== "request" || !message.requestId || !message.action) {
    return;
  }

  try {
    await ensureNativeConnection();
    const payload = await processRequest(message.action, message.payload || {});
    postNativeMessage({
      type: "response",
      requestId: message.requestId,
      ok: true,
      payload
    });
  } catch (error) {
    postNativeMessage({
      type: "response",
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function startHttpBridgeLoop() {
  if (httpBridgeLoopStarted) {
    return;
  }

  httpBridgeLoopStarted = true;
  void pollDirectBridge();
}

async function pollDirectBridge() {
  while (bridgeTransport === "http") {
    try {
      const response = await fetch(`${DIRECT_BRIDGE_URL}/extension/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildHelloPayload())
      });

      if (!response.ok) {
        throw new Error(`HTTP bridge returned ${response.status}.`);
      }

      const message = await response.json();
      if (message?.requestId && message?.action) {
        await processDirectBridgeRequest(message);
      }
    } catch (error) {
      lastNativeError = error instanceof Error ? error.message : String(error);
      bridgeTransport = "none";
      httpBridgeAvailable = false;
      httpBridgeLoopStarted = false;
      setTimeout(() => {
        void ensureBridgeConnection();
      }, HTTP_RECONNECT_DELAY_MS);
      return;
    }
  }

  httpBridgeLoopStarted = false;
}

async function processDirectBridgeRequest(message) {
  try {
    const payload = await processRequest(message.action, message.payload || {});
    await fetch(`${DIRECT_BRIDGE_URL}/extension/response`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...buildHelloPayload(),
        requestId: message.requestId,
        ok: true,
        payload
      })
    });
  } catch (error) {
    await fetch(`${DIRECT_BRIDGE_URL}/extension/response`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...buildHelloPayload(),
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    });
  }
}

function buildHelloPayload() {
  return {
    browserName: detectBrowserName(),
    extensionId: chrome.runtime.id,
    connectedAtUtc: connectedAtUtc || new Date().toISOString(),
    capabilities: [
      "get_active_tab_context",
      "execute_plan",
      "open_new_tab",
      "switch_tab",
      "scroll",
      "extract_dom"
    ]
  };
}

async function isDirectBridgeAvailable() {
  try {
    const response = await fetch(`${DIRECT_BRIDGE_URL}/health`, {
      method: "GET"
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function processRequest(action, payload) {
  switch (String(action || "").trim().toLowerCase()) {
    case "ping":
      return {
        ok: true,
        browserName: detectBrowserName(),
        extensionId: chrome.runtime.id,
        connectedAtUtc,
        lastNativeError
      };
    case "get_active_tab_context":
      return await getActiveTabContext();
    case "execute_plan":
      return await executePlan(payload);
    default:
      throw new Error(`Unsupported native request: ${action}`);
  }
}

async function getActiveTabContext() {
  const tab = await getActiveTab();
  const pageContext = await collectContextFromTab(tab.id);

  return {
    ok: true,
    browserName: detectBrowserName(),
    extensionId: chrome.runtime.id,
    tabId: tab.id,
    pageContext
  };
}

async function executePlan(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  let tab = await getActiveTab();
  const logs = [];
  let executedSteps = 0;

  for (const step of steps) {
    const normalized = normalizeStep(step);
    if (!normalized) {
      continue;
    }

    logs.push(normalized.tool);
    tab = await executeStep(tab, normalized);
    executedSteps += 1;
  }

  const pageContext = await collectContextFromTab(tab.id);
  return {
    ok: true,
    success: true,
    executedSteps,
    message: executedSteps > 0
      ? "Applied in the current logged-in browser tab."
      : "No browser actions were executed.",
    logs,
    pageContext
  };
}

async function executeStep(tab, step) {
  switch (step.tool) {
    case "navigate":
      if (!step.url) {
        throw new Error("navigate step requires url.");
      }

      return await updateTabUrl(tab.id, step.url);
    case "open_new_tab":
      return await createTab(step.url || "about:blank");
    case "switch_tab":
      return await activateMatchingTab(step);
    case "wait_ms":
      await delay(step.waitMs || 250);
      return await getTab(tab.id);
    default:
      await ensureContentScript(tab.id);
      return await executeStepInTab(tab.id, step);
  }
}

async function executeStepInTab(tabId, step) {
  const frameContexts = await getFrameContexts(tabId);
  const frameIds = rankFramesForStep(step, frameContexts);
  let lastError = null;

  for (const frameId of frameIds) {
    try {
      const response = await sendMessageWithTimeout(tabId, {
        type: "execute_step",
        step
      }, REQUEST_TIMEOUT_MS, { frameId });

      if (!response?.ok) {
        lastError = response?.error || `Step failed in frame ${frameId}: ${step.tool}`;
        continue;
      }

      if (response?.requiresReloadWait) {
        await waitForTabComplete(tabId, REQUEST_TIMEOUT_MS);
      }

      return await getTab(tabId);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || `Step failed: ${step.tool}`);
}

async function collectContextFromTab(tabId) {
  await ensureContentScript(tabId);
  const frameContexts = await getFrameContexts(tabId);
  if (frameContexts.length === 0) {
    throw new Error("Could not collect active tab context.");
  }

  const primary = frameContexts.find((item) => item.frameId === 0)?.payload || frameContexts[0].payload;
  const visibleParts = [];
  const seenVisible = new Set();
  const interactiveElements = [];

  for (const frameContext of frameContexts) {
    const visible = String(frameContext.payload?.visibleText || "").trim();
    if (visible && !seenVisible.has(visible)) {
      seenVisible.add(visible);
      visibleParts.push(visible);
    }

    for (const element of frameContext.payload?.interactiveElements || []) {
      interactiveElements.push(element);
    }
  }

  return {
    ...primary,
    visibleText: visibleParts.join(" ").slice(0, 4000),
    interactiveElements: interactiveElements.slice(0, 160)
  };
}

async function ensureContentScript(tabId) {
  const frameIds = await getFrameIds(tabId);
  for (const frameId of frameIds) {
    try {
      await sendMessageWithTimeout(tabId, { type: "ping" }, 1200, { frameId });
      return;
    } catch {
      // Try another frame or inject below.
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  });
  await delay(120);
}

async function sendMessageWithTimeout(tabId, message, timeoutMs = REQUEST_TIMEOUT_MS, options = undefined) {
  return await Promise.race([
    chrome.tabs.sendMessage(tabId, message, options),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for tab ${tabId} response.`)), timeoutMs);
    })
  ]);
}

async function getFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const ids = frames
      .map((frame) => frame.frameId)
      .filter((frameId) => Number.isInteger(frameId));
    return ids.length > 0 ? [...new Set(ids)] : [0];
  } catch {
    return [0];
  }
}

async function getFrameContexts(tabId) {
  const frameIds = await getFrameIds(tabId);
  const contexts = [];

  for (const frameId of frameIds) {
    try {
      const response = await sendMessageWithTimeout(tabId, {
        type: "collect_context"
      }, 2000, { frameId });

      if (response?.ok && response?.payload) {
        contexts.push({
          frameId,
          payload: response.payload
        });
      }
    } catch {
      // Ignore inaccessible frames and continue.
    }
  }

  return contexts;
}

function rankFramesForStep(step, frameContexts) {
  if (frameContexts.length === 0) {
    return [0];
  }

  const queryParts = [step.question, step.option, step.text, step.name, step.label, step.placeholder]
    .map((value) => String(value || "").toLowerCase().trim())
    .filter(Boolean);

  const scored = frameContexts.map((frameContext) => {
    const haystack = `${frameContext.payload?.title || ""} ${frameContext.payload?.visibleText || ""}`.toLowerCase();
    let score = frameContext.frameId === 0 ? 2 : 0;

    for (const query of queryParts) {
      if (haystack.includes(query)) {
        score += 10;
      }
    }

    score += Math.min((frameContext.payload?.interactiveElements || []).length, 40);

    return {
      frameId: frameContext.frameId,
      score
    };
  });

  return scored
    .sort((left, right) => right.score - left.score)
    .map((item) => item.frameId);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  const tab = tabs[0];
  if (!tab?.id) {
    throw new Error("No active browser tab is available.");
  }

  if (isRestrictedUrl(tab.url)) {
    throw new Error("The current tab cannot be automated from the browser extension.");
  }

  return tab;
}

async function getTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.id) {
    throw new Error("The target tab is no longer available.");
  }

  return tab;
}

async function updateTabUrl(tabId, url) {
  await chrome.tabs.update(tabId, {
    url,
    active: true
  });
  await waitForTabComplete(tabId, REQUEST_TIMEOUT_MS);
  return await getTab(tabId);
}

async function createTab(url) {
  const tab = await chrome.tabs.create({
    url,
    active: true
  });
  if (!tab?.id) {
    throw new Error("Could not open a new browser tab.");
  }

  await waitForTabComplete(tab.id, REQUEST_TIMEOUT_MS);
  return await getTab(tab.id);
}

async function activateMatchingTab(step) {
  const query = String(step.name || step.text || step.url || "").trim().toLowerCase();
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  if (!query) {
    const currentTab = await getActiveTab();
    const currentIndex = typeof currentTab.index === "number" ? currentTab.index : 0;
    const nextTab = tabs[(currentIndex + 1) % Math.max(tabs.length, 1)];
    if (!nextTab?.id) {
      throw new Error("Could not find another tab to switch to.");
    }

    await chrome.tabs.update(nextTab.id, { active: true });
    return await getTab(nextTab.id);
  }

  const match = tabs.find((tab) => {
    const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  if (!match?.id) {
    throw new Error(`Could not find a matching browser tab for '${query}'.`);
  }

  await chrome.tabs.update(match.id, { active: true });
  return await getTab(match.id);
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }

      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve();
    };

    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete" || done) {
        return;
      }

      finish();
    };

    chrome.tabs.get(tabId, (tab) => {
      if (done) {
        return;
      }

      if (!chrome.runtime.lastError && tab?.status === "complete") {
        finish();
      }
    });

    const timer = setTimeout(() => {
      if (done) {
        return;
      }

      done = true;
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error("Timed out waiting for the browser tab to finish loading."));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

function normalizeStep(step) {
  if (!step || typeof step !== "object" || typeof step.tool !== "string") {
    return null;
  }

  const normalized = {
    tool: step.tool.trim().toLowerCase()
  };

  for (const key of ["role", "name", "text", "label", "nameAttribute", "placeholder", "question", "option", "url", "key"]) {
    if (typeof step[key] === "string" && step[key].trim()) {
      normalized[key] = step[key].trim();
    }
  }

  if (Array.isArray(step.answers)) {
    const answers = step.answers
      .map((answer) => ({
        question: typeof answer?.question === "string" && answer.question.trim() ? answer.question.trim() : undefined,
        option: typeof answer?.option === "string" ? answer.option.trim() : ""
      }))
      .filter((answer) => answer.option)
      .slice(0, 20);

    if (answers.length > 0) {
      normalized.answers = answers;
    }
  }

  if (typeof step.advancePages === "boolean") {
    normalized.advancePages = step.advancePages;
  }

  if (Number.isFinite(step.waitMs) && step.waitMs > 0) {
    normalized.waitMs = Math.min(10000, Math.round(step.waitMs));
  }

  return normalized;
}

function isRestrictedUrl(url) {
  const value = String(url || "");
  return value.startsWith("chrome://") ||
    value.startsWith("edge://") ||
    value.startsWith("brave://") ||
    value.startsWith("vivaldi://") ||
    value.startsWith("opera://") ||
    value.startsWith("about:") ||
    value.startsWith("chrome-extension://");
}

function detectBrowserName() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) {
    return "edge";
  }

  if (ua.includes("brave")) {
    return "brave";
  }

  if (ua.includes("vivaldi")) {
    return "vivaldi";
  }

  if (ua.includes("opr/") || ua.includes("opera")) {
    return "opera";
  }

  if (ua.includes("arc")) {
    return "arc";
  }

  return "chrome";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── CORSIRI GROQ AI & EXTENSION EXTENSIONS ────────────────────────────────────

const DEFAULT_CONFIG = {
  groqApiKey: "",
  groqModel: "openai/gpt-oss-120b",
  fallbackModel: "openai/gpt-oss-20b",
  showFloatingTrigger: true
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_INSTRUCTION = [
  "You are Corsiri, a high-clarity AI study assistant designed to provide direct solutions and concise explanations.",
  "Formatting and Content Rules:",
  "1. DIRECT ANSWERS FIRST: When provided with questions, assignments, algorithms, or problems (e.g. '1. Implementation of Fractional Knapsack using Greedy Approach', '2. Task-scheduling problem'), immediately provide the direct answers, implementations, algorithms, or solutions FIRST for each numbered item. Do NOT give generic academic fluff or platform definitions.",
  "2. KEEP IT SIMPLE & USER-FRIENDLY: Explain concepts and code in plain, direct language. Avoid unnecessary theoretical bloat or heavy calculus.",
  "3. STRICTLY NO LATEX CODE: NEVER output LaTeX math delimiters or tags like \\(, \\), \\[, \\], \\frac, \\displaystyle, \\int, \\Delta, \\sqrt, etc. Write formulas in clean, plain readable text with standard Unicode symbols (e.g. 'd = v × t', 'Δx = x_final - x_initial', 'a = Δv / Δt', 'E = mc²').",
  "4. ESSENTIAL FORMULAS & CODE ONLY: List only the most practical formulas and clean concise algorithms.",
  "5. STRUCTURE:",
  "   - Direct Solution / Answers for each question (e.g. '### 1. Fractional Knapsack Solution', '### 2. Task-Scheduling Solution').",
  "   - Clear concise algorithm or step-by-step approach.",
  "   - Key Formulas or Time Complexity (e.g. 'O(n log n)').",
  "   - One bold '**Key Takeaway:**' at the end.",
  "6. Avoid raw markdown ASCII pipe tables with '|---|---|'. Use clean bullet cards instead."
].join("\n");

async function getConfig() {
  const data = await chrome.storage.local.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...data };
}

async function callGroqChat({ messages, modelOverride = null, temperature = 0.7, maxTokens = 2048 }) {
  const config = await getConfig();
  const apiKey = config.groqApiKey || DEFAULT_CONFIG.groqApiKey;

  if (!apiKey || !apiKey.startsWith("gsk_")) {
    throw new Error("Invalid or missing Groq API Key. Please configure it in extension options.");
  }

  async function sendReq(model, retryCount = 0) {
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    };

    let res;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), modelOverride ? 25000 : 16000);

    try {
      res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutTimer);
    } catch (err) {
      clearTimeout(timeoutTimer);
      if (retryCount < 1 && err.name !== "AbortError") {
        await delay(500);
        return sendReq(model, retryCount + 1);
      }
      throw new Error(err.name === "AbortError" ? "Groq API request timed out." : (err.message || "Network error connecting to Groq"));
    }

    let data;
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      const errMsg = data?.error?.message || "";
      if ((data?.error?.code === "model_not_found" || errMsg.includes("does not exist") || errMsg.includes("not found")) && model !== config.fallbackModel) {
        return sendReq(config.fallbackModel);
      }
      throw new Error(errMsg || `Groq HTTP ${res.status}`);
    }

    const text = data.choices?.[0]?.message?.content || "";
    return {
      text,
      model: data.model || model
    };
  }

  return sendReq(modelOverride || config.groqModel);
}

// ── Context Menus ─────────────────────────────────────────────────────────────

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "corsiri_explain",
      title: "✨ Explain with Corsiri",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "corsiri_solve",
      title: "⚡ Solve & Formulas (Corsiri)",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "corsiri_summarize",
      title: "📝 Summarize Selection",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "corsiri_chat",
      title: "💬 Chat in Corsiri Window",
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !info.selectionText) return;
  const action = info.menuItemId.replace("corsiri_", "");
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "corsiri_open_popup",
      action,
      selectedText: info.selectionText
    });
  } catch (err) {
    console.warn("Could not send message to tab:", err);
  }
});

// ── Global Chrome Hotkey Command (Ctrl+Shift+Space) ───────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "activate_corsiri") {
    await handleActivateCorsiriCommand();
  }
});

async function handleActivateCorsiriCommand() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0] || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) return;

    if (isRestrictedUrl(tab.url)) {
      console.warn("Corsiri cannot run on restricted browser pages:", tab.url);
      return;
    }

    // 1. Inspect all frames in active tab for user-selected text
    let selectedText = "";
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => window.getSelection()?.toString() || ""
      });
      if (Array.isArray(results)) {
        for (const r of results) {
          const txt = (r.result || "").trim();
          if (txt) {
            selectedText = txt;
            break;
          }
        }
      }
    } catch (err) {
      console.warn("Could not inspect frames via executeScript:", err);
    }

    // 2. Open console in top-level frame (frameId: 0)
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "corsiri_open_popup",
        selectedText: selectedText || "",
        autoRun: Boolean(selectedText)
      }, { frameId: 0 });
    } catch (sendErr) {
      // Content script may not be injected yet (e.g. tab opened before extension installed/updated)
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ["content.js"]
        });
        await delay(120);
        await chrome.tabs.sendMessage(tab.id, {
          type: "corsiri_open_popup",
          selectedText: selectedText || "",
          autoRun: Boolean(selectedText)
        }, { frameId: 0 });
      } catch (injectErr) {
        console.warn("Could not inject content script on command trigger:", injectErr);
      }
    }
  } catch (err) {
    console.warn("Error in handleActivateCorsiriCommand:", err);
  }
}

// ── Message Routing ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "corsiri_activate_hotkey") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "corsiri_open_popup",
        selectedText: message.selectedText || "",
        autoRun: Boolean(message.selectedText)
      }, { frameId: 0 }).catch(() => { });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "corsiri_get_config") {
    getConfig().then(cfg => sendResponse({ ok: true, config: cfg })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "corsiri_save_config") {
    chrome.storage.local.set(message.config || {}).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "corsiri_start_snip_from_subframe") {
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, { type: "corsiri_start_snip" }, { frameId: 0 });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "corsiri_open_mic_permission") {
    chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
    sendResponse({ ok: true });
    return true;
  }

  function determineFixType(rawText) {
    if (!rawText || typeof rawText !== "string") return "writing";
    const text = rawText.trim();

    // 1. Email / Communication
    const emailHeaderRegex = /^(from:|to:|subject:|date:|cc:|bcc:)/im;
    const salutationRegex = /^(hi|hello|hey|dear|good morning|good afternoon|good evening|greetings)\b/i;
    const signoffRegex = /\b(best regards|regards|sincerely|thanks|thank you|cheers|yours truly|best|warm regards|talk soon|let me know|looking forward)[,\s.!]/i;
    const isEmail = emailHeaderRegex.test(text) || salutationRegex.test(text) || (signoffRegex.test(text) && text.length > 20);
    if (isEmail) return "email";

    // 2. LaTeX Math specifically (avoid curly braces in \frac{}{} triggering code)
    const latexMath = /\\(frac|sqrt|sum|int|cdot|times|div|pm|alpha|beta|gamma|theta|pi)\b/;
    if (latexMath.test(text)) return "math";

    // 3. Code detection
    const codeKeywords = ["function", "const ", "let ", "var ", "def ", "import ", "from ", "export ", "class ", "return ", "public static", "console.log", "if (", "for (", "while (", "SELECT ", "fn "];
    let kwCount = 0;
    for (const kw of codeKeywords) {
      if (text.includes(kw)) kwCount++;
    }
    const isCode = kwCount >= 2 ||
      /^\s*def\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/m.test(text) ||
      /^\s*class\s+[a-zA-Z0-9_]+(\(.*?\))?\s*:/m.test(text) ||
      ((text.includes("{") && text.includes("}")) || (text.includes(";") && text.includes("(")));
    if (isCode) return "code";

    // 4. Arithmetic / formula math detection
    const arithmeticExpr = /^\s*(\-?\d+(\.\d+)?\s*[+\-*/^%]\s*)+(\-?\d+(\.\d+)?)\s*(=.*)?$/;
    const hasEqualAndMath = text.includes("=") && /[0-9+\-*/^()]/.test(text) && text.length < 160 && !text.includes("\n");
    const mathKeywords = /\b(derivative|integral|equation|calculate|solve for|sqrt|sin|cos|tan)\b/i;
    if (arithmeticExpr.test(text) || hasEqualAndMath || mathKeywords.test(text)) {
      return "math";
    }

    return "writing";
  }

  if (message.type === "corsiri_query_action") {
    const {
      action,
      text,
      imageUrl,
      question,
      activeUrl,
      pageTitle,
      voiceInstruction,
      targetLanguage,
      tone,
      instruction,
      multiCopyItems,
      contentType
    } = message;

    // Vision Query: If image region was captured, send directly to multimodal vision model
    if (imageUrl) {
      let visionPrompt = "";
      const writtenCmd = (text && text.trim() && text.trim() !== "Analyze, extract formulas/text, and directly solve this captured screen region.")
        ? text.trim()
        : (question && !question.startsWith("Provide the direct") && !question.startsWith("Analyze, extract") ? question.trim() : "");
      const voiceCmd = (voiceInstruction || (action === "voice_command" ? question : "") || "").trim();

      if (writtenCmd && voiceCmd && writtenCmd.toLowerCase() !== voiceCmd.toLowerCase()) {
        visionPrompt = `USER'S WRITTEN INSTRUCTION FOR THIS CAPTURED IMAGE:\n"${writtenCmd}"\n\nUSER'S SPOKEN VOICE INSTRUCTION FOR THIS IMAGE:\n"${voiceCmd}"\n\nTASK:\nInspect all text, code, formulas, diagrams, and questions visible in this image. Directly execute BOTH the user's written instruction and spoken voice instruction on this image. Provide the complete direct answer, code implementation, or solution (NO LaTeX code).`;
      } else if (voiceCmd) {
        visionPrompt = `USER'S SPOKEN VOICE INSTRUCTION FOR THIS CAPTURED IMAGE:\n"${voiceCmd}"\n\nTASK:\nInspect all text, code, formulas, diagrams, and questions visible in this image. Directly execute the user's spoken voice instruction on this image. Provide the complete direct solution, code implementation, or explanation (NO LaTeX code).`;
      } else if (writtenCmd) {
        visionPrompt = `USER'S WRITTEN QUESTION / COMMAND FOR THIS CAPTURED IMAGE:\n"${writtenCmd}"\n\nTASK:\nInspect all text, code, formulas, diagrams, and questions visible in this image. Directly answer, solve, or execute the user's written command on this image. Provide the complete direct solution, code implementation, or explanation (NO LaTeX code).`;
      } else {
        switch (action) {
          case "describe_image":
            visionPrompt = "Provide a rich, precise description of this captured screen image. Describe visual layout, key components, text labels, charts/diagrams, and overall context clearly.";
            break;
          case "extract_text":
            visionPrompt = "Extract all text, code, formulas, and labels visible in this image verbatim. Format with code blocks where appropriate and do not alter words.";
            break;
          case "explain_image":
          case "explain":
            visionPrompt = "Read all text, diagrams, formulas, or questions visible in this captured screen image. Provide a simple, clear, user-friendly explanation of the concepts, formulas, and key takeaways (NO LaTeX code).";
            break;
          case "translate_image_text":
            visionPrompt = `Extract any text visible in this image and translate it accurately into ${targetLanguage || "English"}. Provide the translated text clearly.`;
            break;
          case "solve":
            visionPrompt = "Read all formulas, mathematics, or questions in this image. Provide a step-by-step mathematical or computational solution with clear derivation and plain formula text (NO LaTeX code).";
            break;
          case "summarize":
            visionPrompt = "Read this captured image. Summarize the text, diagrams, and key points simply and directly in 3-4 clean, high-yield bullet points.";
            break;
          default: // "answer"
            visionPrompt = "DIRECT ANSWERS & COMPLETE SOLUTIONS FIRST:\nRead all questions, assignment problems, algorithms, or formulas visible in this captured screen image.\nDirectly solve, answer, and provide the complete solution or code/algorithm implementation for each question visible in the image first. Avoid generic definitions or LaTeX code.";
            break;
        }
      }

      const visionMessages = [
        { role: "system", content: SYSTEM_INSTRUCTION },
        {
          role: "user",
          content: [
            { type: "text", text: visionPrompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ];

      callGroqChat({ messages: visionMessages, modelOverride: "qwen/qwen3.8-27b", maxTokens: 2048 })
        .then(res => sendResponse({ ok: true, result: res.text, model: res.model }))
        .catch(err => sendResponse({ ok: false, error: err.message }));

      return true;
    }

    let userPrompt = "";

    switch (action) {
      case "fix_it": {
        let fixType = contentType || "auto";
        if (fixType === "auto" || !fixType || fixType === "normal" || fixType === "unknown") {
          fixType = determineFixType(text);
        }

        if (fixType === "code") {
          userPrompt = `TASK: FIX THE BUG IN THIS CODE.\n1. Identify the bug, runtime error, logic flaw, or syntax issue.\n2. Explain what was wrong concisely in 1-2 bullet points.\n3. Provide the complete corrected code in a clean code block.\n\nCODE:\n\`\`\`\n${text}\n\`\`\``;
        } else if (fixType === "math") {
          userPrompt = `TASK: FIX THE CALCULATION & SOLVE.\n1. Verify every step, equation, formula, and arithmetic calculation.\n2. Point out any calculation mistake, arithmetic slip, or false algebraic step in the original expression.\n3. Provide the exact correct calculation with clear, step-by-step working (NO LaTeX code).\n\nMATH / CALCULATION:\n"${text}"`;
        } else if (fixType === "email") {
          userPrompt = `TASK: FIX THE TONE OF THIS EMAIL / MESSAGE.\n1. Fix awkward, overly blunt, aggressive, timid, or unprofessional phrasing.\n2. Improve clarity, politeness, and impact while strictly preserving the author's original intent.\n3. Output the polished, ready-to-send version.\n\nEMAIL / MESSAGE:\n"""\n${text}\n"""`;
        } else {
          // Writing / prose / grammar
          userPrompt = `TASK: FIX GRAMMAR, SPELLING & SYNTAX.\n1. Correct all grammatical errors, typos, punctuation slips, and awkward sentence structures.\n2. Provide the clean, polished text directly.\n3. Briefly list the specific corrections made.\n\nORIGINAL TEXT:\n"${text}"`;
        }
        break;
      }
      case "voice_command":
        if (text && text.trim() && text.trim().toLowerCase() !== (voiceInstruction || question || "").trim().toLowerCase()) {
          userPrompt = `TEXT / QUESTION INPUT:\n"${text}"\n\nUSER'S SPOKEN VOICE INSTRUCTION:\n"${voiceInstruction || question}"\n\nTASK:\nDirectly apply and execute the user's voice instruction on the text/question input above. Provide the complete direct answer, solution, code implementation, or breakdown as requested by the voice command. Do NOT output LaTeX code.`;
        } else {
          userPrompt = `USER'S SPOKEN VOICE QUERY:\n"${voiceInstruction || question || text}"\n\nTASK:\nDirectly solve, answer, or explain this voice query with clear, concise, and complete information (NO LaTeX code).`;
        }
        break;
      case "answer":
        userPrompt = `DIRECT ANSWERS & COMPLETE SOLUTIONS FIRST:\nDirectly solve, answer, and provide the complete solution or code/algorithm implementation for each numbered question or problem in this text first:\n\n"${text}"`;
        break;
      case "explain":
        userPrompt = `Provide a simple, clear, user-friendly explanation of this concept with intuitive bullet points, essential takeaways, and plain language. Do NOT use LaTeX code:\n\n"${text}"`;
        break;
      case "translate":
        userPrompt = `TASK: Translate the following text accurately into ${targetLanguage || "English"}. Maintain original tone, formatting, and technical meaning. Provide only the clean, direct translation without conversational commentary or preamble.\n\n"${text}"`;
        break;
      case "summarize":
        userPrompt = `Summarize this simply and directly into 3-4 clean, high-yield bullet points. Avoid unnecessary metadata:\n\n"${text}"`;
        break;
      case "explain_code":
        userPrompt = `TASK: Explain how this code works clearly and concisely.\nInclude:\n1. Purpose & high-level overview\n2. Key functions, variables, and logic flow\n3. Input/output or return values\n4. Important caveats or edge cases\n\nCODE:\n\`\`\`\n${text}\n\`\`\``;
        break;
      case "debug_code":
        userPrompt = `TASK: Analyze this code to identify bugs, syntax errors, edge-case vulnerabilities, or performance bottlenecks.\nExplain the problem clearly and provide the corrected code in a code block.\n\nCODE:\n\`\`\`\n${text}\n\`\`\``;
        break;
      case "improve_code":
        userPrompt = `TASK: Refactor and improve this code for optimal readability, performance, modern conventions, and best practices.\nProvide the improved code along with a brief bulleted summary of improvements.\n\nCODE:\n\`\`\`\n${text}\n\`\`\``;
        break;
      case "generate_reply": {
        const extraContext = (multiCopyItems && multiCopyItems.length > 0)
          ? `\nADDITIONAL MULTI-COPY CONTEXT:\n${multiCopyItems.map((c, i) => `[Context ${i + 1}]: ${c}`).join("\n\n")}\n`
          : "";
        userPrompt = `TASK: Generate a well-crafted reply to the following message or email.\nREQUESTED TONE: ${tone || "Professional"}\n${instruction ? `USER INSTRUCTION: ${instruction}\n` : ""}${extraContext}\nORIGINAL MESSAGE:\n"""\n${text}\n"""\n\nProvide only the drafted reply, ready to copy and send. Do not include meta-chatter.`;
        break;
      }
      case "explain_page":
        userPrompt = `TASK: Explain what this URL / web page is, what service or entity it represents, and its primary purpose based on the URL and available page information:\nURL: ${text || activeUrl || ""}\n${pageTitle ? `PAGE TITLE: ${pageTitle}\n` : ""}\nProvide a concise 2-3 sentence overview.`;
        break;
      case "multi_copy_prompt": {
        const items = (multiCopyItems && multiCopyItems.length > 0) ? multiCopyItems : [text];
        userPrompt = `USER PROMPT:\n"${question || "Analyze, synthesize, and explain the following collected selections together in simple language:"}"\n\nCOLLECTED MULTI-COPY SELECTIONS (${items.length} items):\n${items.map((it, idx) => `--- Item ${idx + 1} ---\n${it}`).join("\n\n")}\n\nTASK: Directly answer the user prompt using all collected selections above.`;
        break;
      }
      case "solve":
        userPrompt = `Provide a simple, clear breakdown with the essential formulas, variables, and step-by-step mathematical/computational derivations. NO LaTeX code:\n\n"${text}"`;
        break;
      case "key_points":
        userPrompt = `Extract the most critical, easy-to-remember rules, definitions, and exam takeaways from this text:\n\n"${text}"`;
        break;
      case "rewrite":
        userPrompt = `Rewrite and polish this text for maximum clarity, simplicity, and readability:\n\n"${text}"`;
        break;
      case "custom":
        userPrompt = `Reference text:\n"${text}"\n\nQuestion:\n${question || "Answer this directly."}`;
        break;
      default:
        userPrompt = `DIRECT ANSWERS FIRST:\nDirectly solve, answer, or explain these questions with clear steps (NO LaTeX code):\n\n"${text}"`;
        break;
    }

    const messages = [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: userPrompt }
    ];

    callGroqChat({ messages })
      .then(res => sendResponse({ ok: true, result: res.text, model: res.model }))
      .catch(err => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  if (message.type === "corsiri_capture_screenshot") {
    chrome.tabs.captureVisibleTab(null, { format: "png" })
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "corsiri_chat_query") {
    const { messages = [], contextText, imageUrl } = message;

    let sys = SYSTEM_INSTRUCTION;
    if (contextText && contextText.trim()) {
      sys += `\n\nCURRENT ACTIVE TOPIC CONTEXT (Current Focus):\n"""\n${contextText.trim()}\n"""\nCRITICAL INSTRUCTION FOR CHATBOT: The user is asking about the CURRENT ACTIVE TOPIC CONTEXT above. If the user asks for "answer", "solve", "explanation", "details", or follow-up questions, answer the questions/topics in this CURRENT ACTIVE TOPIC CONTEXT directly and first! Do not confuse this with earlier conversation history.`;
    }

    const hasImage = Boolean(imageUrl);

    const groqMessages = [
      { role: "system", content: sys },
      ...messages.map((m, idx) => {
        const isLastUser = (idx === messages.length - 1 && m.role === "user");
        const textContent = typeof m.content === "string" ? m.content : String(m.content || "");
        if (isLastUser && hasImage) {
          return {
            role: "user",
            content: [
              { type: "text", text: textContent || "Analyze, solve, and explain this image." },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          };
        }
        return {
          role: m.role === "assistant" ? "assistant" : "user",
          content: textContent
        };
      })
    ];

    const callOpts = { messages: groqMessages };
    if (hasImage) {
      callOpts.modelOverride = "qwen/qwen3.8-27b";
    }

    callGroqChat(callOpts)
      .then(res => sendResponse({ ok: true, reply: res.text, model: res.model }))
      .catch(err => sendResponse({ ok: false, error: err.message }));

    return true;
  }

  return false;
});
