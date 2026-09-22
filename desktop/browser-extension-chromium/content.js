(function () {
  if (window.__corsiriBridgeLoaded || window.__cursivisBridgeLoaded) {
    return;
  }

  window.__corsiriBridgeLoaded = true;
  window.__cursivisBridgeLoaded = true;

  // Inject Stealth & Anti-Tab-Detection Engine into page context as early as possible
  try {
    const stealthScript = document.createElement("script");
    stealthScript.src = chrome.runtime.getURL("stealth.js");
    stealthScript.async = false;
    (document.head || document.documentElement || document.body).appendChild(stealthScript);
    stealthScript.onload = () => stealthScript.remove();
  } catch {}

  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== "undefined" && chrome?.runtime && chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case "ping":
        return { ok: true };
      case "corsiri_open_popup":
      case "corsiri_activate_hotkey":
        return { ok: true };
      case "collect_context":
        return {
          ok: true,
          payload: collectContext()
        };
      case "execute_step":
        return await executeStep(message.step || {});
      default:
        return {
          ok: false,
          error: `Unsupported content-script message: ${message?.type || "unknown"}`
        };
    }
  }

  function collectContext() {
    return {
      url: window.location.href,
      title: document.title || "",
      visibleText: normalize(document.body?.innerText || "").slice(0, 4000),
      interactiveElements: collectInteractiveElements()
    };
  }

  function collectInteractiveElements() {
    const candidates = Array.from(document.querySelectorAll("button, a, input, textarea, select, [role], label, [contenteditable='true']"));
    const elements = [];

    for (const element of candidates) {
      if (!isVisible(element)) {
        continue;
      }

      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute("role") || (element.hasAttribute("contenteditable") ? "textbox" : tagName);
      const label =
        normalize(element.getAttribute("aria-label")) ||
        normalize(element.getAttribute("title")) ||
        normalize(element.getAttribute("placeholder")) ||
        normalize(element.innerText) ||
        normalize(element.textContent);

      if (!label && !["input", "textarea", "select"].includes(tagName)) {
        continue;
      }

      const options = tagName === "select"
        ? Array.from(element.querySelectorAll("option")).map((option) => normalize(option.textContent)).filter(Boolean).slice(0, 10)
        : [];

      elements.push({
        role,
        label,
        nameAttribute: normalize(element.getAttribute("name")),
        type: normalize(element.getAttribute("type")) || tagName,
        options
      });

      if (elements.length >= 120) {
        break;
      }
    }

    return elements;
  }

  async function executeStep(step) {
    const normalized = normalizeStep(step);
    if (!normalized) {
      throw new Error("Invalid DOM action step.");
    }

    switch (normalized.tool) {
      case "click_role":
        clickElement(findByRole(normalized.role, normalized.name || normalized.text));
        return { ok: true };
      case "click_text":
        clickElement(findByText(normalized.text || normalized.name));
        return { ok: true };
      case "fill_label":
        fillField(findFieldByLabel(normalized.label || normalized.name), normalized.text || "");
        return { ok: true };
      case "fill_name":
        fillField(findFieldByName(normalized.nameAttribute || normalized.name), normalized.text || "");
        return { ok: true };
      case "fill_placeholder":
        fillField(findFieldByPlaceholder(normalized.placeholder || normalized.label || normalized.name), normalized.text || "");
        return { ok: true };
      case "type_active":
        typeIntoActiveElement(normalized.text || "");
        return { ok: true };
      case "select_option":
        selectOption(normalized);
        return { ok: true };
      case "check_radio":
        setChoice("radio", normalized);
        return { ok: true };
      case "check_checkbox":
        setChoice("checkbox", normalized);
        return { ok: true };
      case "apply_answer_key":
        await applyAnswerKey(normalized);
        return { ok: true };
      case "press_key":
        pressKey(normalized.key || "Enter");
        return { ok: true };
      case "wait_for_text":
        await waitForText(normalized.text || normalized.name || "", 5000);
        return { ok: true };
      case "wait_ms":
        await delay(normalized.waitMs || 250);
        return { ok: true };
      case "scroll":
        scrollPage(normalized);
        return { ok: true };
      case "extract_dom":
        return {
          ok: true,
          payload: collectContext()
        };
      default:
        throw new Error(`Unsupported DOM tool: ${normalized.tool}`);
    }
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

    if (Number.isFinite(step.waitMs) && step.waitMs > 0) {
      normalized.waitMs = Math.min(10000, Math.round(step.waitMs));
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

    return normalized;
  }

  function findByRole(role, name) {
    const tagMatches = roleToTagList(role);
    const candidates = Array.from(document.querySelectorAll(tagMatches.join(","))).filter(isVisible);
    const aliases = expandRoleNames(role, name);
    const match = candidates.find((element) => aliases.some((value) => textMatches(elementLabel(element), value)));
    if (!match && normalize(role) === "button" && aliases.some((value) => /next|continue|submit|finish|done/i.test(value))) {
      const fallback = findLikelyNavigationElement(aliases);
      if (fallback) {
        return fallback;
      }
    }

    if (!match) {
      throw new Error(`Could not find ${role || "element"} '${name || ""}'.`);
    }

    return match;
  }

  function findByText(text) {
    const query = String(text || "").trim();
    if (!query) {
      throw new Error("click_text requires text.");
    }

    const candidates = Array.from(document.querySelectorAll("button, a, span, div, label, [role], [contenteditable='true']")).filter(isVisible);
    const match = candidates.find((element) => textMatches(elementLabel(element), query));
    if (!match) {
      throw new Error(`Could not find visible text '${query}'.`);
    }

    return match;
  }

  function findFieldByLabel(label) {
    const queries = expandFieldQueries(label);
    for (const query of queries) {
      const byDirectLabel = findFieldUsingLabelTag(query);
      if (byDirectLabel) {
        return byDirectLabel;
      }

      const candidates = getFieldCandidates();
      const match = candidates.find((element) => {
        const combined = `${elementLabel(element)} ${closestContainerText(element)}`;
        return textMatches(combined, query);
      });

      if (match) {
        return match;
      }
    }

    throw new Error(`Could not find field '${label || ""}'.`);
  }

  function findFieldUsingLabelTag(label) {
    const labelElements = Array.from(document.querySelectorAll("label")).filter(isVisible);
    for (const labelElement of labelElements) {
      if (!textMatches(normalize(labelElement.innerText || labelElement.textContent), label)) {
        continue;
      }

      const forId = labelElement.getAttribute("for");
      if (forId) {
        const field = document.getElementById(forId);
        if (field && isEditable(field)) {
          return field;
        }
      }

      const nestedField = labelElement.querySelector("input, textarea, select, [contenteditable='true']");
      if (nestedField && isEditable(nestedField)) {
        return nestedField;
      }
    }

    return null;
  }

  function findFieldByName(name) {
    const query = String(name || "").trim();
    if (!query) {
      throw new Error("Field name is required.");
    }

    const field = document.querySelector(`[name="${cssEscape(query)}"]`);
    if (!field || !isEditable(field)) {
      throw new Error(`Could not find field named '${query}'.`);
    }

    return field;
  }

  function findFieldByPlaceholder(placeholder) {
    const query = String(placeholder || "").trim();
    if (!query) {
      throw new Error("Field placeholder is required.");
    }

    const candidates = getFieldCandidates();
    const match = candidates.find((element) => textMatches(element.getAttribute("placeholder"), query) || textMatches(elementLabel(element), query));
    if (!match) {
      throw new Error(`Could not find field placeholder '${query}'.`);
    }

    return match;
  }

  function getFieldCandidates() {
    return Array.from(document.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox']")).filter(
      (element) => isVisible(element) && isEditable(element)
    );
  }

  function fillField(element, text) {
    focusElement(element);

    if (isContentEditable(element)) {
      element.innerHTML = "";
      element.textContent = text;
      dispatchInputEvents(element);
      verifyTextValue(element, text);
      return;
    }

    if ("value" in element) {
      element.value = text;
      dispatchInputEvents(element);
      verifyTextValue(element, text);
      return;
    }

    throw new Error("The matched element is not fillable.");
  }

  function typeIntoActiveElement(text) {
    const activeElement = document.activeElement;
    if (!activeElement || !isEditable(activeElement)) {
      throw new Error("No editable active element is focused.");
    }

    if (isContentEditable(activeElement)) {
      activeElement.textContent = `${activeElement.textContent || ""}${text}`;
      dispatchInputEvents(activeElement);
      return;
    }

    const currentValue = "value" in activeElement ? String(activeElement.value || "") : "";
    activeElement.value = `${currentValue}${text}`;
    dispatchInputEvents(activeElement);
  }

  function selectOption(step) {
    const optionText = String(step.option || step.text || "").trim();
    if (!optionText) {
      throw new Error("select_option requires option text.");
    }

    const field = step.label || step.name
      ? findFieldByLabel(step.label || step.name)
      : getFieldCandidates().find((element) => element.tagName.toLowerCase() === "select");

    if (!field) {
      throw new Error("Could not find a select field.");
    }

    if (field.tagName.toLowerCase() === "select") {
      const option = Array.from(field.options).find((item) => textMatches(item.textContent, optionText));
      if (!option) {
        throw new Error(`Could not find option '${optionText}'.`);
      }

      field.value = option.value;
      dispatchInputEvents(field);
      return;
    }

    clickElement(field);
    const optionElement = findByText(optionText);
    clickElement(optionElement);
  }

  function setChoice(type, step) {
    const optionText = String(step.option || step.label || step.name || "").trim();
    if (!optionText) {
      throw new Error(`${type} option is required.`);
    }

    const selector = type === "radio"
      ? "input[type='radio'], [role='radio']"
      : "input[type='checkbox'], [role='checkbox']";

    const candidates = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    const questionText = normalize(step.question);
    let match = candidates.find((element) => {
      const combined = `${elementLabel(element)} ${closestContainerText(element)}`;
      return textMatches(combined, optionText) &&
        (!questionText || textMatches(combined, questionText) || textMatches(closestContainerText(element), questionText));
    });

    if (!match) {
      const labels = Array.from(document.querySelectorAll("label")).filter(isVisible);
      const labelMatch = labels.find((label) => {
        const combined = `${normalize(label.innerText || label.textContent)} ${closestContainerText(label)}`;
        return textMatches(combined, optionText) &&
          (!questionText || textMatches(combined, questionText) || textMatches(closestContainerText(label), questionText));
      });

      if (labelMatch) {
        const forId = labelMatch.getAttribute("for");
        if (forId) {
          const input = document.getElementById(forId);
          if (input) {
            match = input;
          }
        } else {
          match = labelMatch.querySelector(selector);
        }
      }
    }

    if (!match) {
      match = findChoiceLikeElement(optionText, questionText, type);
    }

    if (!match) {
      throw new Error(`Could not find ${type} option '${optionText}'.`);
    }

    focusElement(match);
    if ("checked" in match) {
      match.checked = true;
      dispatchInputEvents(match);
    } else {
      match.setAttribute("aria-checked", "true");
    }

    clickElement(match);
    if ("checked" in match && !match.checked) {
      throw new Error(`The ${type} option '${optionText}' did not stay selected.`);
    }
  }

  function clickElement(element) {
    focusElement(element);
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    const target = element.closest("label") && element.tagName.toLowerCase() === "input"
      ? element.closest("label")
      : element.closest("button, a, label, [role='button'], [role='radio'], [role='checkbox']") || element;

    if (typeof target.click === "function") {
      target.click();
      return;
    }

    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }

  function pressKey(key) {
    const activeElement = document.activeElement || document.body;
    const normalized = String(key || "Enter").trim();
    const event = new KeyboardEvent("keydown", {
      key: normalized.includes("+") ? normalized.split("+").at(-1) : normalized,
      ctrlKey: normalized.toLowerCase().includes("control+") || normalized.toLowerCase().includes("ctrl+"),
      bubbles: true,
      cancelable: true
    });

    activeElement.dispatchEvent(event);
    if (normalized.toLowerCase() === "enter" && typeof activeElement.click === "function" && activeElement.matches("button, [role='button']")) {
      activeElement.click();
    }
  }

  async function waitForText(text, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const query = normalize(text);
    while (Date.now() < deadline) {
      if (normalize(document.body?.innerText || "").includes(query)) {
        return;
      }

      await delay(140);
    }

    throw new Error(`Timed out waiting for text '${text}'.`);
  }

  function scrollPage(step) {
    const mode = normalize(step.text || step.name || "down");
    if (mode.includes("top")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (mode.includes("bottom")) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }

    const delta = mode.includes("up") ? -window.innerHeight * 0.8 : window.innerHeight * 0.8;
    window.scrollBy({ top: delta, behavior: "smooth" });
  }

  function roleToTagList(role) {
    switch (normalize(role)) {
      case "button":
        return ["button", "input[type='button']", "input[type='submit']", "[role='button']", "[aria-label]"];
      case "link":
        return ["a", "[role='link']"];
      case "textbox":
        return ["input", "textarea", "[role='textbox']", "[contenteditable='true']"];
      case "radio":
        return ["input[type='radio']", "[role='radio']"];
      case "checkbox":
        return ["input[type='checkbox']", "[role='checkbox']"];
      case "combobox":
        return ["select", "[role='combobox']"];
      default:
        return ["button", "a", "input", "textarea", "select", "[role]", "[contenteditable='true']"];
    }
  }

  function expandRoleNames(role, name) {
    const values = [];
    if (name) {
      values.push(name);
    }

    const normalizedName = normalize(name);
    if (normalize(role) === "button") {
    if (normalizedName.includes("compose")) {
      pushUnique(values, "Compose");
      pushUnique(values, "New message");
      pushUnique(values, "New mail");
    } else if (normalizedName.includes("reply")) {
      pushUnique(values, "Reply");
      pushUnique(values, "Reply all");
      pushUnique(values, "Send reply");
    } else if (normalizedName.includes("next") || normalizedName.includes("continue")) {
      pushUnique(values, "Next");
      pushUnique(values, "Continue");
        pushUnique(values, "Next question");
        pushUnique(values, "Go to next");
      } else if (normalizedName === "send" || normalizedName.includes("send")) {
        pushUnique(values, "Send");
        pushUnique(values, "Send now");
        pushUnique(values, "Schedule send");
      } else if (normalizedName.includes("submit")) {
        pushUnique(values, "Submit");
        pushUnique(values, "Finish");
        pushUnique(values, "Done");
      } else if (normalizedName.includes("schedule")) {
        pushUnique(values, "Schedule send");
        pushUnique(values, "More send options");
      }
    }

    return values.length > 0 ? values : [""];
  }

  function expandFieldQueries(label) {
    const values = [];
    if (label) {
      values.push(label);
    }

    const normalized = normalize(label);
    if (normalized.includes("to")) {
      pushUnique(values, "To");
      pushUnique(values, "Recipients");
      pushUnique(values, "To recipients");
    } else if (normalized.includes("subject")) {
      pushUnique(values, "Subject");
      pushUnique(values, "Add a subject");
    } else if (normalized.includes("message") || normalized.includes("body") || normalized.includes("compose")) {
      pushUnique(values, "Message Body");
      pushUnique(values, "Message");
      pushUnique(values, "Compose email");
    }

    return values;
  }

  function closestContainerText(element) {
    let current = element;
    let depth = 0;
    const parts = [];
    while (current && depth < 4) {
      const text = normalize(current.innerText || current.textContent);
      if (text) {
        parts.push(text);
      }
      current = current.parentElement;
      depth += 1;
    }

    return parts.join(" ");
  }

  function elementLabel(element) {
    if (!element) {
      return "";
    }

    return normalize(
      element.getAttribute?.("aria-label") ||
      element.getAttribute?.("title") ||
      element.getAttribute?.("placeholder") ||
      element.innerText ||
      element.textContent ||
      element.value ||
      ""
    );
  }

  function textMatches(candidate, query) {
    const normalizedCandidate = normalize(candidate);
    const normalizedQuery = normalize(query);
    if (!normalizedCandidate || !normalizedQuery) {
      return false;
    }

    return normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate);
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function isLikelyClickable(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element.matches("button, a, input, label, [role='button'], [role='radio'], [role='checkbox'], [onclick]")) {
      return true;
    }

    const tabindex = element.getAttribute("tabindex");
    if (tabindex && tabindex !== "-1") {
      return true;
    }

    return window.getComputedStyle(element).cursor === "pointer";
  }

  function findChoiceLikeElement(optionText, questionText, type) {
    const candidates = Array.from(
      document.querySelectorAll("label, button, [role], [tabindex], [onclick], div, li, span")
    ).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const label = elementLabel(element);
      const context = closestContainerText(element);
      if (!textMatches(`${label} ${context}`, optionText)) {
        return false;
      }

      if (questionText && !textMatches(context, questionText) && !textMatches(label, questionText)) {
        return false;
      }

      return isLikelyClickable(element) || textMatches(label, optionText);
    });

    return candidates
      .sort((left, right) => scoreChoiceCandidate(right, optionText, questionText, type) - scoreChoiceCandidate(left, optionText, questionText, type))
      .at(0) || null;
  }

  function scoreChoiceCandidate(element, optionText, questionText, type) {
    const label = elementLabel(element);
    const context = closestContainerText(element);
    const rect = element.getBoundingClientRect();
    let score = 0;

    if (textMatches(label, optionText)) {
      score += 25;
    }

    if (textMatches(context, optionText)) {
      score += 12;
    }

    if (questionText && textMatches(context, questionText)) {
      score += 18;
    }

    if (element.matches(`input[type='${type}'], [role='${type}']`)) {
      score += 30;
    }

    if (isLikelyClickable(element)) {
      score += 10;
    }

    score -= Math.min((rect.width * rect.height) / 1200, 18);
    return score;
  }

  function findLikelyNavigationElement(aliases) {
    const candidates = Array.from(
      document.querySelectorAll("button, a, [role='button'], [tabindex], [onclick], div, span")
    ).filter((element) => isVisible(element) && isLikelyClickable(element));

    const direct = candidates.find((element) => aliases.some((alias) => textMatches(elementLabel(element), alias) || textMatches(closestContainerText(element), alias)));
    if (direct) {
      return direct;
    }

    const ranked = candidates
      .map((element) => ({ element, score: scoreNavigationCandidate(element) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    return ranked[0]?.element || null;
  }

  function scoreNavigationCandidate(element) {
    const rect = element.getBoundingClientRect();
    const label = `${elementLabel(element)} ${closestContainerText(element)}`.toLowerCase();
    let score = 0;

    if (/(next|continue|submit|finish|done)/.test(label)) {
      score += 50;
    }

    if (/(arrow|chevron|next)/.test((element.className || "").toString().toLowerCase())) {
      score += 20;
    }

    if (element.querySelector("svg, path")) {
      score += 10;
    }

    if (rect.left > window.innerWidth * 0.55) {
      score += 12;
    }

    if (rect.top > window.innerHeight * 0.45) {
      score += 12;
    }

    return score;
  }

  function isEditable(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    return tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      isContentEditable(element) ||
      element.getAttribute("role") === "textbox";
  }

  function isContentEditable(element) {
    return element instanceof HTMLElement && element.isContentEditable;
  }

  function focusElement(element) {
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: false });
    }
  }

  function verifyTextValue(element, text) {
    const actual = isContentEditable(element)
      ? normalize(element.textContent)
      : normalize("value" in element ? element.value : element.textContent);
    if (!actual.includes(normalize(text))) {
      throw new Error("Field value did not update as expected.");
    }
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function cssEscape(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function pushUnique(values, nextValue) {
    if (!values.some((value) => normalize(value) === normalize(nextValue))) {
      values.push(nextValue);
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function applyAnswerKey(step) {
    const answers = Array.isArray(step.answers) ? step.answers.filter((answer) => answer?.option) : [];
    if (answers.length === 0) {
      throw new Error("apply_answer_key requires answers.");
    }

    const pending = [...answers];
    const maxPages = Math.min(Math.max(pending.length + 1, 2), 12);
    let applied = 0;

    for (let pageIndex = 0; pageIndex < maxPages && pending.length > 0; pageIndex += 1) {
      let appliedThisPage = 0;

      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const answer = pending[index];
        const questionText = normalize(answer.question);
        const match = findChoiceLikeElement(answer.option, questionText, "radio") ||
          findChoiceLikeElement(answer.option, questionText, "checkbox");
        if (match) {
          clickElement(match);
          await delay(140);
          pending.splice(index, 1);
          applied += 1;
          appliedThisPage += 1;
          continue;
        }

        const textField = findTextResponseField(questionText, answer.option);
        if (!textField) {
          continue;
        }

        fillField(textField, answer.option);
        await delay(140);
        pending.splice(index, 1);
        applied += 1;
        appliedThisPage += 1;
      }

      if (pending.length === 0) {
        break;
      }

      if (!step.advancePages) {
        break;
      }

      const nextElement = findLikelyNavigationElement(["Next", "Continue", "Go to next", "Done", "Submit"]);
      if (!nextElement) {
        break;
      }

      clickElement(nextElement);
      await delay(appliedThisPage > 0 ? 950 : 700);
    }

    if (applied === 0) {
      throw new Error("Could not match the answer key to responsive quiz options in this tab.");
    }

    if (pending.length > 0) {
      throw new Error(`Applied ${applied} answer(s), but ${pending.length} question(s) could not be matched yet.`);
    }
  }

  function findTextResponseField(questionText, answerText) {
    const fields = getFieldCandidates().filter((element) => {
      const tagName = element.tagName.toLowerCase();
      const type = normalize(element.getAttribute("type"));
      return tagName === "textarea" ||
        tagName === "select" ||
        tagName === "input" && !["radio", "checkbox", "button", "submit", "reset", "file", "hidden"].includes(type) ||
        isContentEditable(element);
    });

    const best = fields
      .map((element) => ({
        element,
        score: scoreTextFieldCandidate(element, questionText, answerText)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .at(0);

    return best?.element || null;
  }

  function scoreTextFieldCandidate(element, questionText, answerText) {
    const label = elementLabel(element);
    const context = closestContainerText(element);
    const placeholder = normalize(element.getAttribute("placeholder"));
    const type = normalize(element.getAttribute("type"));
    let score = 0;

    if (questionText && textMatches(context, questionText)) {
      score += 35;
    }

    if (questionText && textMatches(label, questionText)) {
      score += 28;
    }

    if (textMatches(`${label} ${placeholder}`, "answer") || textMatches(context, "answer")) {
      score += 12;
    }

    if (textMatches(`${label} ${placeholder}`, "response") || textMatches(context, "response")) {
      score += 12;
    }

    if (type === "email" && /@/.test(answerText || "")) {
      score += 18;
    }

    if (element.tagName.toLowerCase() === "textarea" || isContentEditable(element)) {
      score += 10;
    }

    return score;
  }

  // ── CORSIRI IN-PAGE FLOATING UI & SELECTION TOOLS ─────────────────────────────

  // ── MX CREATIVE CONSOLE IN-PAGE EXTENSION ──────────────────────────────────

  if (window.self !== window.top) {
    initSubframeListeners();
  } else {
    initMxCreativeConsole();
  }

  function initSubframeListeners() {
    // In subframes (e.g. iframes in Google Classroom / Google Drive / PDF preview),
    // inject a lightweight selection trigger pill and forward selection/hotkeys to top frame.
    let shadowHost = document.getElementById("corsiri-subframe-host");
    if (!shadowHost) {
      shadowHost = document.createElement("div");
      shadowHost.id = "corsiri-subframe-host";
      shadowHost.style.position = "absolute";
      shadowHost.style.top = "0";
      shadowHost.style.left = "0";
      shadowHost.style.width = "0";
      shadowHost.style.height = "0";
      shadowHost.style.zIndex = "2147483647";
      shadowHost.style.pointerEvents = "none";
      (document.body || document.documentElement).appendChild(shadowHost);
    }

    const shadowRoot = shadowHost.shadowRoot || shadowHost.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      .corsiri-trigger {
        position: fixed;
        display: none;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, #112233 0%, #081019 100%);
        color: #5EEBFF;
        border: 1px solid rgba(94, 235, 255, 0.45);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 12px rgba(94, 235, 255, 0.25);
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        z-index: 2147483647;
        pointer-events: auto;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        animation: corsiri-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .corsiri-trigger:hover {
        transform: translateY(-2px) scale(1.04);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6), 0 0 16px rgba(94, 235, 255, 0.45);
        border-color: #5EEBFF;
      }
      .corsiri-trigger-icon {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: radial-gradient(circle, #5EEBFF 30%, #0099FF 100%);
        display: inline-block;
        box-shadow: 0 0 8px #5EEBFF;
      }
      @keyframes corsiri-pop {
        0% { transform: scale(0.6); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
    `;
    shadowRoot.appendChild(styleEl);

    const triggerEl = document.createElement("div");
    triggerEl.className = "corsiri-trigger";
    triggerEl.innerHTML = `<span class="corsiri-trigger-icon"></span><span>✨ Corsiri AI</span>`;
    shadowRoot.appendChild(triggerEl);

    // Forward selection to top frame via background
    function forwardSelectionToTop(selText) {
      if (isExtensionValid()) {
        chrome.runtime.sendMessage({
          type: "corsiri_activate_hotkey",
          selectedText: selText || ""
        }).catch(() => {});
      }
    }

    // Click trigger pill inside subframe -> forward
    triggerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerEl.style.display = "none";
      const selText = window.getSelection()?.toString().trim() || "";
      forwardSelectionToTop(selText);
    });

    // Subframe Hotkey listener (Ctrl+Shift+Space or Alt+C)
    document.addEventListener("keydown", (e) => {
      const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar" || e.keyCode === 32;
      const isActivateCombo = ((e.ctrlKey || e.metaKey) && e.shiftKey && isSpace) || (e.altKey && (e.key === "c" || e.key === "C"));

      if (isActivateCombo) {
        e.preventDefault();
        e.stopPropagation();
        triggerEl.style.display = "none";
        const selText = window.getSelection()?.toString().trim() || "";
        forwardSelectionToTop(selText);
      } else if (e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        e.stopPropagation();
        triggerEl.style.display = "none";
        if (isExtensionValid()) {
          chrome.runtime.sendMessage({ type: "corsiri_start_snip_from_subframe" }).catch(() => {});
        }
      } else if (e.key === "Escape") {
        triggerEl.style.display = "none";
      }
    }, true);

    // Subframe copy operates natively without auto-opening Cursiv

    // Subframe Mouseup selection
    document.addEventListener("mouseup", (e) => {
      if (e.composedPath().includes(shadowHost)) return;

      setTimeout(async () => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();

        if (text && text.length >= 2 && sel.rangeCount > 0) {
          try {
            if (isExtensionValid()) {
              const prefs = await chrome.storage?.local?.get(["enableFloatingTrigger", "showFloatingTrigger"]);
              if (prefs?.enableFloatingTrigger === false || prefs?.showFloatingTrigger === false) {
                triggerEl.style.display = "none";
                return;
              }
            }
          } catch {}

          try {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const top = Math.max(10, rect.top - 38);
            const left = Math.min(window.innerWidth - 170, Math.max(10, rect.left + rect.width / 2 - 60));

            triggerEl.style.top = `${top}px`;
            triggerEl.style.left = `${left}px`;
            triggerEl.style.display = "flex";
          } catch {}
        } else {
          triggerEl.style.display = "none";
        }
      }, 10);
    });
  }

  function initMxCreativeConsole() {
    let shadowHost = document.getElementById("corsiri-shadow-host");
    if (!shadowHost) {
      shadowHost = document.createElement("div");
      shadowHost.id = "corsiri-shadow-host";
      shadowHost.style.position = "absolute";
      shadowHost.style.top = "0";
      shadowHost.style.left = "0";
      shadowHost.style.width = "0";
      shadowHost.style.height = "0";
      shadowHost.style.zIndex = "2147483647";
      shadowHost.style.pointerEvents = "none";
      document.documentElement.appendChild(shadowHost);
    }

    const shadowRoot = shadowHost.shadowRoot || shadowHost.attachShadow({ mode: "open" });

    // Styles for MX Creative Console
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      /* Floating Trigger Pill on text selection */
      .corsiri-trigger {
        position: fixed;
        display: none;
        align-items: center;
        gap: 6px;
        background: linear-gradient(135deg, #112233 0%, #081019 100%);
        color: #5EEBFF;
        border: 1px solid rgba(94, 235, 255, 0.45);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 12px rgba(94, 235, 255, 0.25);
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        z-index: 2147483647;
        pointer-events: auto;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        animation: corsiri-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .corsiri-trigger:hover {
        transform: translateY(-2px) scale(1.04);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6), 0 0 16px rgba(94, 235, 255, 0.45);
        border-color: #5EEBFF;
      }
      .corsiri-trigger-icon {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: radial-gradient(circle, #5EEBFF 30%, #0099FF 100%);
        display: inline-block;
        box-shadow: 0 0 8px #5EEBFF;
      }

      /* MX Creative Console Main Window */
      .mx-console {
        position: fixed;
        display: none;
        flex-direction: column;
        width: 440px;
        min-width: 360px;
        max-width: 720px;
        min-height: 280px;
        max-height: 88vh;
        background: rgba(8, 17, 26, 0.96);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 24px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 30px rgba(94, 235, 255, 0.15);
        color: #F0F6FC;
        z-index: 2147483647;
        pointer-events: auto;
        overflow-y: auto;
        resize: both;
        padding: 16px;
        gap: 12px;
        animation: corsiri-fade-in 0.2s ease-out;
      }
      .mx-console.maximized {
        max-width: calc(100vw - 32px);
      }

      /* Popup Size Variants */
      .mx-console.mx-size-compact { width: 350px !important; min-width: 320px !important; max-width: 380px !important; }
      .mx-console.mx-size-standard { width: 440px !important; min-width: 360px !important; max-width: 520px !important; }
      .mx-console.mx-size-large { width: 580px !important; min-width: 480px !important; max-width: 650px !important; }
      .mx-console.mx-size-expanded { width: 760px !important; min-width: 620px !important; max-width: 820px !important; }

      /* Light Theme Variant */
      .mx-console.mx-theme-light {
        background: rgba(248, 250, 252, 0.96) !important;
        border: 1px solid rgba(0, 150, 199, 0.35) !important;
        color: #1e293b !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18), 0 0 24px rgba(0, 150, 199, 0.12) !important;
      }
      .mx-console.mx-theme-light .mx-card,
      .mx-console.mx-theme-light .mx-header-card,
      .mx-console.mx-theme-light .mx-context-card,
      .mx-console.mx-theme-light .mx-take-action-card,
      .mx-console.mx-theme-light .mx-status-card {
        background: rgba(255, 255, 255, 0.95) !important;
        border: 1px solid rgba(0, 150, 199, 0.22) !important;
        color: #1e293b !important;
      }
      .mx-console.mx-theme-light .mx-title,
      .mx-console.mx-theme-light .mx-status-title {
        color: #0f172a !important;
      }
      .mx-console.mx-theme-light .mx-subtitle,
      .mx-console.mx-theme-light .mx-status-text {
        color: #475569 !important;
      }
      .mx-console.mx-theme-light .mx-body {
        color: #1e293b !important;
      }
      .mx-console.mx-theme-light .mx-context-pill,
      .mx-console.mx-theme-light .mx-take-action-pill {
        background: rgba(0, 150, 199, 0.08) !important;
        border: 1px solid rgba(0, 150, 199, 0.3) !important;
        color: #0369a1 !important;
      }
      .mx-console.mx-theme-light .mx-context-pill.active,
      .mx-console.mx-theme-light .mx-take-action-pill.active,
      .mx-console.mx-theme-light .mx-context-pill:hover,
      .mx-console.mx-theme-light .mx-take-action-pill:hover {
        background: rgba(0, 150, 199, 0.22) !important;
        border-color: #0284c7 !important;
        color: #0c4a6e !important;
      }
      .mx-console.mx-theme-light .mx-btn-trigger {
        background: #0284c7 !important;
        color: #ffffff !important;
        border: 1.5px solid #0369a1 !important;
      }
      .mx-console.mx-theme-light .mx-input-dark,
      .mx-console.mx-theme-light .mx-select-dark,
      .mx-console.mx-theme-light .mx-editable-result-area,
      .mx-console.mx-theme-light .mx-multicopy-prompt {
        background: #ffffff !important;
        color: #0f172a !important;
        border: 1px solid rgba(0, 150, 199, 0.35) !important;
      }
      .mx-console.mx-theme-light .mx-multicopy-item {
        background: rgba(0, 150, 199, 0.06) !important;
        border: 1px solid rgba(0, 150, 199, 0.2) !important;
        color: #1e293b !important;
      }

      /* Custom scrollbar for console */
      .mx-console::-webkit-scrollbar {
        width: 6px;
      }
      .mx-console::-webkit-scrollbar-thumb {
        background: rgba(94, 235, 255, 0.2);
        border-radius: 4px;
      }

      /* Section Cards */
      .mx-card {
        background: rgba(17, 27, 39, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 18px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Header Card */
      .mx-header-card {
        background: rgba(19, 28, 40, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.15);
        cursor: move;
        user-select: none;
        position: relative;
      }
      .mx-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .mx-title {
        font-size: 19px;
        font-weight: 700;
        color: #FFFFFF;
        letter-spacing: -0.2px;
      }
      .mx-badge {
        font-size: 11px;
        font-weight: 600;
        color: #5EEBFF;
        background: rgba(0, 140, 210, 0.16);
        border: 1px solid rgba(94, 235, 255, 0.4);
        border-radius: 12px;
        padding: 3px 10px;
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.15);
      }
      .mx-subtitle {
        font-size: 12px;
        color: #8FA6B8;
        line-height: 1.4;
        margin-top: 2px;
        padding-right: 52px;
      }
      .mx-maximize-btn {
        position: absolute;
        top: 12px;
        right: 38px;
        background: transparent;
        border: none;
        color: #7F97AA;
        font-size: 14px;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        line-height: 1;
        transition: color 0.15s, background 0.15s;
        user-select: none;
      }
      .mx-maximize-btn:hover {
        color: #5EEBFF;
        background: rgba(94, 235, 255, 0.15);
      }
      .mx-close-btn {
        position: absolute;
        top: 12px;
        right: 12px;
        background: transparent;
        border: none;
        color: #7F97AA;
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
        border-radius: 6px;
        line-height: 1;
        transition: color 0.15s, background 0.15s;
      }
      .mx-close-btn:hover {
        color: #FF6B6B;
        background: rgba(255, 107, 107, 0.15);
      }

      /* Mode Card */
      .mx-mode-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .mx-label {
        font-size: 12px;
        font-weight: 700;
        color: #FFFFFF;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .mx-desc {
        font-size: 11.5px;
        color: #8FA6B8;
        line-height: 1.35;
      }
      .mx-exit-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #D6EFFF;
        font-size: 12px;
        font-weight: 600;
        border-radius: 10px;
        padding: 6px 14px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .mx-exit-btn:hover {
        background: rgba(255, 107, 107, 0.15);
        border-color: #FF6B6B;
        color: #FF6B6B;
      }
      .mx-mode-card {
        display: none !important;
      }
      .mx-select {
        background: rgba(11, 20, 30, 0.85);
        border: 1px solid rgba(94, 235, 255, 0.25);
        border-radius: 10px;
        color: #FFFFFF;
        padding: 8px 12px;
        font-size: 12.5px;
        outline: none;
        width: 100%;
        margin-top: 4px;
      }

      /* Trigger Surface */
      .mx-btn-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 4px;
      }
      .mx-action-btn {
        height: 48px;
        border-radius: 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .mx-btn-trigger {
        background: rgba(0, 140, 210, 0.28);
        border: 1.5px solid #5EEBFF;
        color: #FFFFFF;
        box-shadow: 0 0 16px rgba(94, 235, 255, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(8px);
      }
      .mx-btn-trigger:hover {
        background: rgba(0, 140, 210, 0.42);
        border-color: #9BF5FF;
        color: #FFFFFF;
        transform: translateY(-1px);
        box-shadow: 0 4px 22px rgba(94, 235, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }
      .mx-btn-take-action, .mx-btn-voice, .mx-btn-image {
        background: rgba(17, 27, 39, 0.85);
        border: 1px solid rgba(94, 235, 255, 0.25);
        color: #D6EFFF;
      }
      .mx-btn-take-action:hover, .mx-btn-voice:hover, .mx-btn-image:hover {
        background: rgba(94, 235, 255, 0.15);
        border-color: #5EEBFF;
        color: #FFFFFF;
        transform: translateY(-1px);
      }
      .mx-btn-voice.recording {
        background: rgba(255, 107, 107, 0.25);
        border-color: #FF6B6B;
        color: #FF6B6B;
        animation: corsiri-pulse 1s infinite;
      }
      .mx-chatbot-btn-row {
        display: flex;
        gap: 10px;
        width: 100%;
        margin-top: 10px;
        box-sizing: border-box;
      }
      .mx-chatbot-btn-row .mx-chatbot-toggle-btn {
        flex: 1 1 0;
        width: 50%;
        min-width: 0;
        height: 40px;
        padding: 0 8px;
        box-sizing: border-box;
        border-radius: 12px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mx-chatbot-toggle-btn:hover {
        background: rgba(94, 235, 255, 0.15);
        border-color: #5EEBFF;
        color: #FFFFFF;
      }
      .mx-btn-copy-to-chat {
        background: rgba(0, 150, 199, 0.2);
        border-color: rgba(94, 235, 255, 0.4);
        color: #D6EFFF;
      }
      .mx-btn-copy-to-chat:hover {
        background: rgba(0, 150, 199, 0.38);
        border-color: #5EEBFF;
        color: #FFFFFF;
      }

      /* Context Awareness & Smart Actions Card */
      .mx-context-card {
        background: rgba(16, 24, 34, 0.88);
        border: 1px solid rgba(94, 235, 255, 0.28);
        border-radius: 14px;
        padding: 10px 12px;
      }
      .mx-context-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 3px;
      }
      .mx-context-type-badge {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3px;
        color: #5EEBFF;
        background: rgba(94, 235, 255, 0.14);
        border: 1px solid rgba(94, 235, 255, 0.35);
        padding: 2px 8px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .mx-context-pills-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 6px;
        margin-top: 7px;
      }
      .mx-context-pill {
        background: rgba(17, 27, 39, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #A0C4DE;
        padding: 7px 10px;
        border-radius: 10px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all 0.16s ease;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
      }
      .mx-context-pill:hover {
        background: rgba(94, 235, 255, 0.14);
        border-color: rgba(94, 235, 255, 0.5);
        color: #FFFFFF;
        transform: translateY(-1px);
      }
      .mx-context-pill.active {
        background: rgba(0, 140, 210, 0.28);
        border-color: #5EEBFF;
        color: #5EEBFF;
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.25);
      }

      /* Redesigned Take Action Panel */
      .mx-take-action-card {
        background: rgba(16, 24, 34, 0.92);
        border: 1px solid rgba(94, 235, 255, 0.32);
        border-radius: 14px;
        padding: 10px 12px;
      }
      .mx-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
      }
      .mx-take-action-subtitle {
        font-size: 10.5px;
        color: #8FA6B8;
        font-weight: 500;
      }
      .mx-action-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 6px;
      }
      .mx-take-pill {
        background: rgba(17, 27, 39, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #D6EFFF;
        padding: 8px 10px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.16s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        user-select: none;
      }
      .mx-take-pill:hover {
        background: rgba(94, 235, 255, 0.14);
        border-color: rgba(94, 235, 255, 0.45);
        color: #FFFFFF;
        transform: translateY(-1px);
      }
      .mx-take-pill.active {
        background: rgba(0, 140, 210, 0.26);
        border-color: #5EEBFF;
        color: #5EEBFF;
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.25);
      }
      .mx-counter-badge {
        background: #5EEBFF;
        color: #070e17;
        font-size: 10px;
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 999px;
        line-height: 1.2;
      }

      /* Take Action Workspaces / Subpanels */
      .mx-action-subpanel {
        margin-top: 10px;
        padding: 10px;
        background: rgba(9, 15, 23, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.2);
        border-radius: 10px;
        animation: mxSubpanelFadeIn 0.18s ease-out;
      }
      @keyframes mxSubpanelFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .mx-subpanel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .mx-subpanel-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12px;
        color: #D6EFFF;
      }
      .mx-subpanel-count {
        font-size: 11px;
        color: #5EEBFF;
        font-weight: 600;
      }
      .mx-subpanel-add-btn {
        background: rgba(94, 235, 255, 0.15);
        border: 1px solid #5EEBFF;
        color: #5EEBFF;
        border-radius: 7px;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
      }
      .mx-subpanel-add-btn:hover {
        background: rgba(94, 235, 255, 0.3);
        color: #FFFFFF;
      }

      /* Multi-Copy Items List */
      .mx-multicopy-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 140px;
        overflow-y: auto;
        padding-right: 4px;
        margin-bottom: 8px;
      }
      .mx-multicopy-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 7px;
        padding: 5px 8px;
        font-size: 11.5px;
        color: #D6EFFF;
      }
      .mx-multicopy-num {
        font-weight: 700;
        color: #5EEBFF;
        flex-shrink: 0;
      }
      .mx-multicopy-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }
      .mx-multicopy-del-btn {
        background: transparent;
        border: none;
        color: #8FA6B8;
        font-size: 12px;
        cursor: pointer;
        padding: 1px 4px;
        border-radius: 4px;
        line-height: 1;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .mx-multicopy-del-btn:hover {
        color: #FF6B6B;
        background: rgba(255, 107, 107, 0.15);
      }
      .mx-empty-hint {
        color: #8FA6B8;
        font-size: 11px;
        text-align: center;
        padding: 10px 4px;
        font-style: italic;
      }
      .mx-multicopy-prompt {
        width: 100%;
        background: rgba(7, 13, 20, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.3);
        border-radius: 8px;
        color: #FFFFFF;
        font-size: 11.5px;
        padding: 6px 8px;
        resize: vertical;
        box-sizing: border-box;
        outline: none;
        font-family: inherit;
        line-height: 1.4;
      }
      .mx-multicopy-prompt:focus {
        border-color: #5EEBFF;
        box-shadow: 0 0 8px rgba(94, 235, 255, 0.25);
      }
      .mx-multicopy-btn-row {
        display: flex;
        justify-content: flex-end;
        margin-top: 6px;
      }
      .mx-ask-cursiv-btn {
        background: rgba(0, 150, 199, 0.35);
        border: 1px solid #5EEBFF;
        color: #FFFFFF;
        border-radius: 8px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
      }
      .mx-ask-cursiv-btn:hover {
        background: rgba(0, 150, 199, 0.6);
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.3);
      }

      /* Clear Confirmation Box */
      .mx-clear-confirm-box {
        text-align: center;
        padding: 4px;
      }
      .mx-clear-prompt {
        font-size: 12.5px;
        font-weight: 700;
        color: #FFDF7E;
        margin-bottom: 4px;
      }
      .mx-clear-notice {
        font-size: 11px;
        color: #8FA6B8;
        margin-bottom: 10px;
        line-height: 1.4;
      }
      .mx-clear-actions {
        display: flex;
        justify-content: center;
        gap: 10px;
      }
      .mx-btn-sub-cancel {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #D6EFFF;
        border-radius: 7px;
        padding: 5px 14px;
        font-size: 11.5px;
        cursor: pointer;
      }
      .mx-btn-sub-cancel:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      .mx-btn-sub-danger {
        background: rgba(255, 107, 107, 0.2);
        border: 1px solid #FF6B6B;
        color: #FF6B6B;
        border-radius: 7px;
        padding: 5px 14px;
        font-size: 11.5px;
        font-weight: 700;
        cursor: pointer;
      }
      .mx-btn-sub-danger:hover {
        background: rgba(255, 107, 107, 0.38);
        color: #FFFFFF;
      }

      /* Form Controls for Reply and Translate */
      .mx-form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .mx-form-label {
        font-size: 11px;
        color: #A0C4DE;
        font-weight: 600;
      }
      .mx-form-select, .mx-form-input {
        background: rgba(7, 13, 20, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.25);
        border-radius: 7px;
        color: #D6EFFF;
        font-size: 11.5px;
        padding: 6px 8px;
        outline: none;
        box-sizing: border-box;
        font-family: inherit;
      }
      .mx-form-select:focus, .mx-form-input:focus {
        border-color: #5EEBFF;
        box-shadow: 0 0 8px rgba(94, 235, 255, 0.2);
      }
      .mx-generate-btn {
        margin-top: 10px;
        width: 100%;
        background: rgba(0, 150, 199, 0.32);
        border: 1px solid #5EEBFF;
        color: #FFFFFF;
        border-radius: 8px;
        padding: 7px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.15s;
      }
      .mx-generate-btn:hover {
        background: rgba(0, 150, 199, 0.55);
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.3);
      }
      .mx-action-tool-btn {
        background: transparent;
        border: 1px solid rgba(157, 182, 201, 0.3);
        color: #9DB6C9;
        font-size: 11px;
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        gap: 3px;
      }
      .mx-action-tool-btn:hover {
        border-color: #5EEBFF;
        color: #5EEBFF;
      }
      .mx-editable-result-area {
        width: 100%;
        background: rgba(7, 13, 20, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.4);
        border-radius: 8px;
        color: #FFFFFF;
        font-size: 12px;
        padding: 8px;
        font-family: inherit;
        line-height: 1.45;
        box-sizing: border-box;
        outline: none;
        resize: vertical;
        min-height: 100px;
      }

      /* Status & Result Card */
      .mx-status-card {
        background: rgba(16, 24, 34, 0.85);
        border: 1px solid rgba(94, 235, 255, 0.35);
        box-shadow: 0 0 16px rgba(94, 235, 255, 0.1);
      }
      .mx-status-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .mx-status-title {
        font-size: 13px;
        font-weight: 600;
        color: #5EEBFF;
      }
      .mx-status-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mx-copy-btn {
        background: transparent;
        border: 1px solid rgba(157, 182, 201, 0.3);
        color: #9DB6C9;
        font-size: 11px;
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .mx-copy-btn:hover {
        border-color: #5EEBFF;
        color: #5EEBFF;
      }
      .mx-copy-to-chat-btn {
        background: rgba(0, 150, 199, 0.25);
        border: 1px solid rgba(94, 235, 255, 0.45);
        color: #5EEBFF;
        font-size: 11px;
        font-weight: 600;
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .mx-copy-to-chat-btn:hover {
        background: rgba(94, 235, 255, 0.25);
        border-color: #5EEBFF;
        color: #FFFFFF;
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.3);
      }

      .mx-context-preview {
        font-size: 11.5px;
        color: #A0C4DE;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        padding: 8px 10px;
        max-height: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-left: 3px solid #5EEBFF;
      }
      .mx-context-preview img {
        max-height: 48px;
        border-radius: 4px;
        border: 1px solid rgba(94, 235, 255, 0.3);
        vertical-align: middle;
        margin-right: 6px;
      }

      .mx-result-body {
        font-size: 13.5px;
        line-height: 1.55;
        color: #E2ECF5;
        max-height: 380px;
        overflow-y: auto;
        padding-right: 4px;
      }

      /* Formula Cards matching Image 2, 3, 4 */
      .corsiri-formula-card {
        display: block;
        margin: 8px auto;
        padding: 8px 16px;
        background: rgba(20, 40, 60, 0.5);
        border: 1px solid rgba(94, 235, 255, 0.35);
        border-radius: 8px;
        text-align: center;
        font-family: "Cambria Math", Consolas, monospace;
        font-size: 15px;
        font-weight: 600;
        color: #5EEBFF;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
      .corsiri-bullet-row {
        display: flex;
        gap: 8px;
        margin: 3px 0 3px 6px;
      }
      .corsiri-bullet-dot {
        color: #5EEBFF;
        font-size: 14px;
        line-height: 1.4;
      }
      .corsiri-bullet-text {
        flex: 1;
      }

      /* Code Card & Multi-line Syntax Highlighting */
      .corsiri-code-card {
        display: block;
        margin: 10px 0;
        background: rgba(9, 17, 26, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.25);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      }
      .corsiri-code-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        background: rgba(14, 26, 40, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .corsiri-code-lang {
        font-family: Consolas, "Cascadia Code", monospace;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.6px;
        color: #5EEBFF;
        background: rgba(94, 235, 255, 0.12);
        border: 1px solid rgba(94, 235, 255, 0.25);
        padding: 2px 7px;
        border-radius: 5px;
        text-transform: uppercase;
      }
      .corsiri-code-copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #C5D9E8;
        font-size: 11px;
        font-weight: 500;
        padding: 3px 9px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
      }
      .corsiri-code-copy-btn:hover {
        background: rgba(94, 235, 255, 0.2);
        border-color: #5EEBFF;
        color: #FFFFFF;
      }
      .corsiri-code-copy-btn.copied {
        background: rgba(46, 213, 115, 0.22);
        border-color: #2ED573;
        color: #2ED573;
      }
      .corsiri-code-pre {
        margin: 0;
        padding: 12px 14px;
        overflow-x: auto;
        font-family: Consolas, "Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace;
        font-size: 12.5px;
        line-height: 1.55;
        color: #E6EDF3;
        background: transparent;
        tab-size: 4;
      }
      .corsiri-code-pre::-webkit-scrollbar {
        height: 6px;
      }
      .corsiri-code-pre::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
      }
      .corsiri-code-pre::-webkit-scrollbar-thumb {
        background: rgba(94, 235, 255, 0.25);
        border-radius: 3px;
      }
      .corsiri-code-pre::-webkit-scrollbar-thumb:hover {
        background: rgba(94, 235, 255, 0.45);
      }
      .corsiri-code-content {
        font-family: inherit;
        font-size: inherit;
        color: inherit;
        white-space: pre;
      }

      /* Syntax Highlighting Tokens */
      .corsiri-token-keyword {
        color: #FF7B72;
        font-weight: 600;
      }
      .corsiri-token-builtin {
        color: #79C0FF;
      }
      .corsiri-token-string {
        color: #7EE787;
      }
      .corsiri-token-number {
        color: #FFA657;
      }
      .corsiri-token-comment {
        color: #8B949E;
        font-style: italic;
      }
      .corsiri-token-directive {
        color: #D2A8FF;
      }

      .corsiri-inline-code {
        background: rgba(94, 235, 255, 0.12);
        color: #5EEBFF;
        padding: 2px 6px;
        border-radius: 5px;
        font-family: Consolas, "Cascadia Code", monospace;
        font-size: 0.9em;
        border: 1px solid rgba(94, 235, 255, 0.2);
      }

      /* Separate Floating Chatbot Window - Larger, Spacious & Resizable */
      .corsiri-chatbot-window {
        position: fixed;
        display: none;
        flex-direction: column;
        width: 640px;
        min-width: 440px;
        max-width: calc(100vw - 32px);
        height: 720px;
        min-height: 520px;
        max-height: calc(100vh - 40px);
        background: rgba(8, 17, 26, 0.98);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(94, 235, 255, 0.38);
        border-radius: 24px;
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.9), 0 0 35px rgba(94, 235, 255, 0.22);
        color: #F0F6FC;
        z-index: 2147483647;
        pointer-events: auto;
        overflow: hidden;
        resize: both;
        animation: corsiri-fade-in 0.2s ease-out;
      }
      .corsiri-chatbot-window.maximized {
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.95), 0 0 45px rgba(94, 235, 255, 0.28);
      }

      .chatbot-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: rgba(19, 28, 40, 0.9);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        cursor: move;
        user-select: none;
      }
      .chatbot-brand {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .chatbot-brand-icon {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: radial-gradient(circle, #5EEBFF 30%, #0099FF 100%);
        box-shadow: 0 0 10px #5EEBFF;
        display: inline-block;
      }
      .chatbot-title {
        font-size: 14px;
        font-weight: 700;
        color: #5EEBFF;
        letter-spacing: 0.3px;
      }
      .chatbot-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .chatbot-icon-btn {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #8FA6B8;
        font-size: 11px;
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .chatbot-icon-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: #5EEBFF;
        color: #5EEBFF;
      }
      .chatbot-btn-badge {
        background: rgba(94, 235, 255, 0.25);
        color: #5EEBFF;
        border-radius: 8px;
        padding: 0 5px;
        font-size: 9.5px;
        font-weight: 700;
        margin-left: 2px;
      }

      /* Floating Chatbot History Pop-up Panel */
      .chatbot-history-panel {
        position: absolute;
        top: 54px;
        left: 12px;
        right: 12px;
        max-height: 480px;
        background: rgba(8, 17, 26, 0.98);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(94, 235, 255, 0.35);
        border-radius: 14px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 25px rgba(94, 235, 255, 0.15);
        z-index: 100;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: corsiri-fade-slide 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes corsiri-fade-slide {
        from {
          opacity: 0;
          transform: translateY(-8px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .history-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(18, 30, 46, 0.85);
      }

      .history-panel-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 700;
        color: #D6EFFF;
      }

      .history-badge {
        background: rgba(94, 235, 255, 0.2);
        color: #5EEBFF;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 10px;
        border: 1px solid rgba(94, 235, 255, 0.3);
      }

      .history-panel-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .history-action-btn {
        background: rgba(0, 150, 199, 0.25);
        border: 1px solid rgba(94, 235, 255, 0.4);
        color: #5EEBFF;
        font-size: 11px;
        font-weight: 600;
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .history-action-btn:hover {
        background: rgba(94, 235, 255, 0.25);
        color: #FFFFFF;
      }

      .history-close-btn {
        background: transparent;
        border: none;
        color: #8FA6B8;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .history-close-btn:hover {
        color: #FFFFFF;
        background: rgba(255, 255, 255, 0.1);
      }

      .history-items-list {
        flex: 1;
        max-height: 340px;
        overflow-y: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .history-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        cursor: pointer;
        transition: all 0.15s ease;
        gap: 10px;
      }

      .history-item:hover {
        background: rgba(0, 150, 199, 0.18);
        border-color: rgba(94, 235, 255, 0.35);
        transform: translateX(2px);
      }

      .history-item.active {
        background: rgba(0, 150, 199, 0.28);
        border-color: #5EEBFF;
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.15);
      }

      .history-item-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .history-item-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .history-item-title {
        font-size: 12.5px;
        font-weight: 600;
        color: #E2ECF5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .history-item.active .history-item-title {
        color: #5EEBFF;
      }

      .history-active-tag {
        font-size: 9px;
        background: #5EEBFF;
        color: #0B141E;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .history-item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10.5px;
        color: #7F97AA;
      }

      .history-item-del-btn {
        background: transparent;
        border: none;
        color: #7F97AA;
        font-size: 12px;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
        opacity: 0.7;
        transition: all 0.15s;
        flex-shrink: 0;
      }

      .history-item-del-btn:hover {
        opacity: 1;
        color: #FF6B6B;
        background: rgba(255, 107, 107, 0.15);
      }

      .history-empty-state {
        text-align: center;
        padding: 28px 14px;
        color: #8FA6B8;
        font-size: 12px;
      }

      .history-empty-icon {
        font-size: 26px;
        margin-bottom: 6px;
      }

      .history-panel-footer {
        padding: 8px 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        justify-content: flex-end;
        background: rgba(18, 30, 46, 0.5);
      }

      .history-clear-all-btn {
        background: transparent;
        border: 1px solid rgba(255, 107, 107, 0.3);
        color: #FF8F8F;
        font-size: 10.5px;
        font-weight: 500;
        border-radius: 6px;
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .history-clear-all-btn:hover {
        background: rgba(255, 107, 107, 0.2);
        border-color: #FF6B6B;
        color: #FFFFFF;
      }
      .chatbot-close-btn {
        background: transparent;
        border: none;
        color: #7F97AA;
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: all 0.15s;
      }
      .chatbot-close-btn:hover {
        color: #FF6B6B;
        background: rgba(255, 107, 107, 0.15);
      }

      .chatbot-ref-banner {
        padding: 8px 14px;
        background: rgba(0, 150, 199, 0.15);
        border-bottom: 1px solid rgba(94, 235, 255, 0.2);
        font-size: 11.5px;
        color: #A0C4DE;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .chatbot-ref-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }
      .chatbot-ref-dismiss {
        background: transparent;
        border: none;
        color: #7F97AA;
        font-size: 12px;
        cursor: pointer;
      }

      .chatbot-messages-list {
        flex: 1;
        padding: 16px 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .chatbot-msg-wrapper {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
      .chatbot-msg-wrapper.user {
        align-items: flex-end;
      }
      .chatbot-msg-wrapper.assistant {
        align-items: flex-start;
      }
      .chatbot-msg-bubble {
        max-width: 90%;
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 13.5px;
        line-height: 1.55;
        word-break: break-word;
      }
      .chatbot-msg-bubble.user {
        background: linear-gradient(135deg, #0077B6 0%, #0096C7 100%);
        color: #FFFFFF;
        border-bottom-right-radius: 4px;
      }
      .chatbot-msg-bubble.assistant {
        background: rgba(17, 27, 39, 0.85);
        border: 1px solid rgba(94, 235, 255, 0.25);
        color: #E2ECF5;
        border-bottom-left-radius: 4px;
      }
      .chatbot-msg-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 10.5px;
        color: #7F97AA;
      }
      .chatbot-copy-msg-btn {
        background: transparent;
        border: 1px solid rgba(157, 182, 201, 0.25);
        color: #9DB6C9;
        font-size: 10px;
        border-radius: 4px;
        padding: 2px 6px;
        cursor: pointer;
      }
      .chatbot-copy-msg-btn:hover {
        border-color: #5EEBFF;
        color: #5EEBFF;
      }

      .chatbot-quick-chips {
        display: flex;
        gap: 6px;
        padding: 6px 14px;
        overflow-x: auto;
        background: rgba(11, 20, 30, 0.6);
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
      .chatbot-chip {
        background: rgba(23, 50, 78, 0.6);
        border: 1px solid rgba(94, 235, 255, 0.25);
        color: #D6EFFF;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      .chatbot-chip:hover {
        background: rgba(94, 235, 255, 0.2);
        border-color: #5EEBFF;
      }

      .chatbot-footer {
        padding: 10px 14px;
        background: rgba(11, 20, 30, 0.9);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .chatbot-input-row {
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }
      .chatbot-textarea {
        flex: 1;
        background: rgba(17, 34, 51, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        color: #FFFFFF;
        padding: 10px 14px;
        font-size: 13px;
        outline: none;
        resize: none;
        max-height: 120px;
        min-height: 42px;
        line-height: 1.45;
      }
      .chatbot-textarea:focus {
        border-color: #5EEBFF;
      }
      .chatbot-send-btn {
        background: linear-gradient(135deg, #0077B6 0%, #0096C7 100%);
        border: none;
        color: #FFFFFF;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        flex-shrink: 0;
      }
      .chatbot-send-btn:hover {
        opacity: 0.9;
      }
      .chatbot-hint {
        font-size: 10.5px;
        color: #5C7080;
        text-align: right;
      }

      .chatbot-tool-btn {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: rgba(17, 34, 51, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #8FA6B8;
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }
      .chatbot-tool-btn:hover {
        border-color: #5EEBFF;
        color: #5EEBFF;
        background: rgba(94, 235, 255, 0.1);
      }
      .chatbot-tool-btn.recording {
        border-color: #FF6B6B;
        color: #FF6B6B;
        background: rgba(255, 107, 107, 0.2);
        animation: corsiri-pulse 1s infinite;
      }

      .chatbot-attach-banner {
        margin-bottom: 4px;
      }
      .chatbot-attach-preview {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(14, 26, 40, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.35);
        border-radius: 8px;
        padding: 4px 10px;
      }
      .chatbot-attach-thumb {
        width: 32px;
        height: 32px;
        object-fit: cover;
        border-radius: 4px;
        border: 1px solid rgba(94, 235, 255, 0.4);
      }
      .chatbot-attach-label {
        font-size: 11px;
        color: #D6EFFF;
        flex: 1;
      }
      .chatbot-attach-remove {
        background: transparent;
        border: none;
        color: #7F97AA;
        font-size: 13px;
        cursor: pointer;
        padding: 2px 4px;
      }
      .chatbot-attach-remove:hover {
        color: #FF6B6B;
      }

      /* Image Command Studio in MX Console */
      .mx-img-studio {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        background: rgba(12, 22, 34, 0.85);
        border: 1px solid rgba(94, 235, 255, 0.28);
        border-radius: 12px;
        margin-bottom: 8px;
      }
      .mx-img-studio-top {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .mx-img-thumb-wrap {
        position: relative;
        flex-shrink: 0;
        cursor: pointer;
        border-radius: 8px;
        overflow: hidden;
        border: 1.5px solid rgba(94, 235, 255, 0.45);
        background: #000;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      }
      .mx-img-thumb {
        max-height: 52px;
        max-width: 100px;
        object-fit: contain;
        display: block;
      }
      .mx-img-zoom-hint {
        position: absolute;
        bottom: 2px;
        right: 2px;
        background: rgba(0, 0, 0, 0.75);
        font-size: 8.5px;
        color: #5EEBFF;
        padding: 1px 4px;
        border-radius: 3px;
        font-weight: 600;
      }
      .mx-img-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .mx-img-badge-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .mx-img-badge {
        color: #5EEBFF;
        font-weight: 700;
        font-size: 11.5px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .mx-img-resnip-btn {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #8FA6B8;
        font-size: 10.5px;
        padding: 2px 7px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .mx-img-resnip-btn:hover {
        border-color: #5EEBFF;
        color: #5EEBFF;
      }
      .mx-img-desc {
        font-size: 10.5px;
        color: #A0C4DE;
        line-height: 1.35;
      }
      .mx-img-input-box {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .mx-img-input-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .mx-img-text-input {
        flex: 1;
        background: rgba(9, 18, 28, 0.95);
        border: 1px solid rgba(94, 235, 255, 0.35);
        border-radius: 8px;
        color: #FFFFFF;
        font-size: 12px;
        padding: 7px 10px;
        outline: none;
        transition: all 0.15s;
      }
      .mx-img-text-input:focus {
        border-color: #5EEBFF;
        box-shadow: 0 0 10px rgba(94, 235, 255, 0.3);
      }
      .mx-img-voice-btn {
        background: rgba(0, 150, 199, 0.25);
        border: 1px solid rgba(94, 235, 255, 0.45);
        color: #5EEBFF;
        font-size: 11px;
        font-weight: 600;
        padding: 7px 10px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        user-select: none;
        white-space: nowrap;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .mx-img-voice-btn:hover {
        background: rgba(94, 235, 255, 0.25);
        color: #FFFFFF;
        border-color: #5EEBFF;
      }
      .mx-img-voice-btn.recording {
        background: rgba(255, 107, 107, 0.3);
        border-color: #FF6B6B;
        color: #FF6B6B;
        animation: corsiri-pulse 1s infinite;
      }
      .mx-img-submit-btn {
        background: linear-gradient(135deg, #0077B6 0%, #0096C7 100%);
        border: none;
        color: #FFFFFF;
        font-size: 11.5px;
        font-weight: 700;
        padding: 7px 13px;
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .mx-img-submit-btn:hover {
        box-shadow: 0 0 12px rgba(0, 150, 199, 0.7);
        opacity: 0.95;
      }
      .mx-img-voice-feedback {
        font-size: 11px;
        color: #5EEBFF;
        background: rgba(94, 235, 255, 0.1);
        border-radius: 6px;
        padding: 4px 8px;
        border: 1px dashed rgba(94, 235, 255, 0.35);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mx-img-chips-row {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
        margin-top: 2px;
      }
      .mx-img-chips-label {
        font-size: 10px;
        color: #7F97AA;
        font-weight: 600;
      }
      .mx-img-chip {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #D6EFFF;
        font-size: 10px;
        padding: 3px 8px;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .mx-img-chip:hover {
        background: rgba(94, 235, 255, 0.2);
        border-color: #5EEBFF;
        color: #FFFFFF;
      }
      .mx-img-ready-state {
        padding: 16px 14px;
        text-align: center;
        color: #D6EFFF;
      }

      /* Snipping Tool Fullscreen Overlay */
      .corsiri-snip-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: rgba(0, 0, 0, 0.42) !important;
        z-index: 2147483647 !important;
        cursor: crosshair !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        pointer-events: auto !important;
        touch-action: none !important;
      }
      .corsiri-snip-box {
        position: fixed !important;
        border: 2px dashed #5EEBFF !important;
        background: rgba(94, 235, 255, 0.16) !important;
        box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.42), 0 0 16px rgba(94, 235, 255, 0.6) !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        box-sizing: border-box !important;
        border-radius: 4px !important;
      }
      .corsiri-snip-badge {
        position: absolute;
        bottom: -24px;
        right: 0;
        background: #0B141E;
        color: #5EEBFF;
        font-size: 10px !important;
        font-weight: 600 !important;
        padding: 2px 7px !important;
        border-radius: 5px !important;
        border: 1px solid rgba(94, 235, 255, 0.45) !important;
        pointer-events: none !important;
        white-space: nowrap !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.6) !important;
        letter-spacing: 0.2px;
        max-width: 140px;
        line-height: 1.3;
      }
      .corsiri-snip-hint {
        position: fixed !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: rgba(11, 20, 30, 0.95) !important;
        color: #5EEBFF !important;
        padding: 7px 18px !important;
        border: 1px solid rgba(94, 235, 255, 0.45) !important;
        border-radius: 20px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.75), 0 0 12px rgba(94, 235, 255, 0.25) !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        letter-spacing: 0.2px;
      }

      /* Animations */
      @keyframes corsiri-pop {
        from { transform: scale(0.7); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @keyframes corsiri-fade-in {
        from { transform: translateY(6px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes corsiri-pulse {
        0% { opacity: 1; }
        50% { opacity: 0.6; }
        100% { opacity: 1; }
      }
      .corsiri-spinner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        justify-content: center;
        color: #5EEBFF;
        font-size: 13px;
      }
      .corsiri-spin-circle {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(94, 235, 255, 0.3);
        border-top-color: #5EEBFF;
        border-radius: 50%;
        animation: corsiri-spin 0.7s linear infinite;
      }
      @keyframes corsiri-spin {
        to { transform: rotate(360deg); }
      }
      .corsiri-selection-aura {
        box-sizing: border-box;
        pointer-events: none;
        user-select: none;
        will-change: transform, opacity;
      }
    `;
    shadowRoot.appendChild(styleEl);

    // Floating Trigger Pill on Selection
    const triggerEl = document.createElement("div");
    triggerEl.className = "corsiri-trigger";
    triggerEl.innerHTML = `<span class="corsiri-trigger-icon"></span><span>✨ Corsiri AI</span>`;
    shadowRoot.appendChild(triggerEl);

    // MX Creative Console UI
    const consoleEl = document.createElement("div");
    consoleEl.className = "mx-console";
    consoleEl.innerHTML = `
      <!-- Card 0: Header -->
      <div class="mx-card mx-header-card">
        <div class="mx-title-row">
          <h2 class="mx-title">MX Creative Console</h2>
          <span class="mx-badge">Extension-Native</span>
        </div>
        <p class="mx-subtitle">Corsiri turns selection into context, screen into intent, and Groq into action. (Hotkey: <kbd style="background:rgba(94,235,255,0.15);padding:1px 5px;border-radius:4px;color:#5EEBFF;font-family:monospace;font-size:11px;">Ctrl+Shift+Space</kbd>)</p>
        <button class="mx-maximize-btn" id="mxMaximizeBtn" title="Expand / Restore window">⛶</button>
        <button class="mx-close-btn" title="Close (Esc)">✕</button>
      </div>

      <!-- Hidden Interaction Mode Container (Preserved for internal compatibility) -->
      <div class="mx-card mx-mode-card" style="display: none;">
        <button class="mx-exit-btn" style="display: none;">Exit</button>
        <select class="mx-select" id="mxModeSelect">
          <option value="guided" selected>Guided Mode (Manual)</option>
          <option value="smart">Smart Mode (AutoPerform)</option>
        </select>
      </div>

      <!-- Card 2: Trigger Surface -->
      <div class="mx-card mx-trigger-card">
        <div class="mx-label">Trigger Surface</div>
        <div class="mx-desc">Tap for contextual AI, hold for voice, and capture an image region on demand.</div>
        
        <div class="mx-btn-grid">
          <button class="mx-action-btn mx-btn-trigger" id="mxBtnTrigger">⚡ Trigger</button>
          <button class="mx-action-btn mx-btn-take-action" id="mxBtnTakeAction">🎯 Take Action</button>
          <button class="mx-action-btn mx-btn-voice" id="mxBtnVoice">🎙 Hold to Talk</button>
          <button class="mx-action-btn mx-btn-image" id="mxBtnImage">📸 Image Selection</button>
        </div>
        <div class="mx-chatbot-btn-row">
          <button class="mx-chatbot-toggle-btn" id="mxBtnOpenChatbot">💬 Open AI Chatbot</button>
          <button class="mx-chatbot-toggle-btn mx-btn-copy-to-chat" id="mxBtnCopyTextToChatbot">📋 Copy to Chatbot</button>
        </div>
      </div>

      <!-- Card: Context Awareness & Smart Actions -->
      <div class="mx-card mx-context-card" id="mxContextCard">
        <div class="mx-context-header-row">
          <div class="mx-label">Contextual Intelligence</div>
          <span class="mx-context-type-badge" id="mxContextTypeBadge">📄 Normal Text</span>
        </div>
        <div class="mx-desc" id="mxContextDesc">Actions dynamically adapted for selected content:</div>
        <div class="mx-context-pills-grid" id="mxContextPillsGrid">
          <button type="button" class="mx-context-pill active" data-action="explain">✨ Explain</button>
          <button type="button" class="mx-context-pill" data-action="translate" data-sub="translate">🌐 Translate</button>
          <button type="button" class="mx-context-pill" data-action="summarize">📝 Summarize</button>
          <button type="button" class="mx-context-pill" data-action="search" data-util="true">🔍 Search</button>
        </div>
      </div>

      <!-- Card: Redesigned Take Action Panel -->
      <div class="mx-card mx-take-action-card" id="mxTakeActionCard">
        <div class="mx-label-row">
          <div class="mx-label">Take Action</div>
          <span class="mx-take-action-subtitle">Temporary Context & Tools</span>
        </div>
        <div class="mx-action-grid" id="mxTakeActionGrid">
          <button type="button" class="mx-take-pill" id="mxBtnMultiCopy" data-sub="multicopy">
            <span>📋 Multi-Copy</span>
            <span class="mx-counter-badge" id="mxMultiCopyBadge" style="display:none;">0</span>
          </button>
          <button type="button" class="mx-take-pill" id="mxBtnClearMulti" data-sub="clear">
            <span>🗑 Clear</span>
          </button>
          <button type="button" class="mx-take-pill" id="mxBtnGenReply" data-sub="reply">
            <span>✍ Generate Reply</span>
          </button>
          <button type="button" class="mx-take-pill" id="mxBtnTranslate" data-sub="translate">
            <span>🌐 Translate</span>
          </button>
        </div>

        <!-- Subpanel 1: Multi-Copy Workspace -->
        <div class="mx-action-subpanel" id="mxMultiCopySubpanel" style="display:none;">
          <div class="mx-subpanel-header">
            <div class="mx-subpanel-title">
              <strong>📋 Multi-Copy Context</strong>
              <span class="mx-subpanel-count" id="mxMultiCopyCountText">0 items collected</span>
            </div>
            <button type="button" class="mx-subpanel-add-btn" id="mxAddSelectionBtn">+ Add Selection</button>
          </div>
          <div class="mx-multicopy-list" id="mxMultiCopyList">
            <div class="mx-empty-hint">No items collected yet. Highlight text and click "+ Add Selection" or "Multi-Copy" to aggregate context.</div>
          </div>
          <div class="mx-multicopy-footer">
            <textarea class="mx-multicopy-prompt" id="mxMultiCopyPrompt" rows="2" placeholder="Ask Cursiv about all collected selections together (e.g. Explain these together in simple language)..."></textarea>
            <div class="mx-multicopy-btn-row">
              <button type="button" class="mx-ask-cursiv-btn" id="mxAskCursivBtn">⚡ Ask Cursiv</button>
            </div>
          </div>
        </div>

        <!-- Subpanel 2: Clear Confirmation -->
        <div class="mx-action-subpanel" id="mxClearSubpanel" style="display:none;">
          <div class="mx-clear-confirm-box">
            <div class="mx-clear-prompt" id="mxClearPromptText">Clear all collected Multi-Copy selections?</div>
            <p class="mx-clear-notice">Only temporary Multi-Copy selections will be cleared. Chatbot history and saved chats will NOT be touched.</p>
            <div class="mx-clear-actions">
              <button type="button" class="mx-btn-sub-cancel" id="mxCancelClearBtn">Cancel</button>
              <button type="button" class="mx-btn-sub-danger" id="mxConfirmClearBtn">🗑 Clear</button>
            </div>
          </div>
        </div>

        <!-- Subpanel 3: Generate Reply -->
        <div class="mx-action-subpanel" id="mxReplySubpanel" style="display:none;">
          <div class="mx-subpanel-title" style="margin-bottom:6px;">
            <strong>✍ Generate Reply</strong>
            <span style="font-size:11px;color:#8FA6B8;">Craft context-aware reply to selected message</span>
          </div>
          <div class="mx-form-group">
            <label class="mx-form-label">Tone:</label>
            <select class="mx-form-select" id="mxReplyToneSelect">
              <option value="Professional" selected>Professional</option>
              <option value="Friendly">Friendly</option>
              <option value="Casual">Casual</option>
              <option value="Concise">Concise</option>
              <option value="Formal">Formal</option>
            </select>
          </div>
          <div class="mx-form-group" style="margin-top:6px;">
            <label class="mx-form-label">Optional instruction:</label>
            <input type="text" class="mx-form-input" id="mxReplyInstructionInput" placeholder="e.g. Agree and propose meeting Thursday at 2 PM..." />
          </div>
          <button type="button" class="mx-generate-btn" id="mxRunGenerateReplyBtn">✍ Generate Reply</button>
        </div>

        <!-- Subpanel 4: Translate -->
        <div class="mx-action-subpanel" id="mxTranslateSubpanel" style="display:none;">
          <div class="mx-subpanel-title" style="margin-bottom:6px;">
            <strong>🌐 Translate</strong>
            <span style="font-size:11px;color:#8FA6B8;">Translate selected text or multi-copy context</span>
          </div>
          <div class="mx-form-group">
            <label class="mx-form-label">Translate to:</label>
            <select class="mx-form-select" id="mxTargetLangSelect">
              <option value="English" selected>English</option>
              <option value="Spanish">Spanish (Español)</option>
              <option value="French">French (Français)</option>
              <option value="German">German (Deutsch)</option>
              <option value="Chinese">Chinese (Mandarin)</option>
              <option value="Japanese">Japanese (日本語)</option>
              <option value="Hindi">Hindi (हिन्दी)</option>
              <option value="Arabic">Arabic (العربية)</option>
              <option value="Russian">Russian (Русский)</option>
              <option value="Portuguese">Portuguese (Português)</option>
              <option value="Italian">Italian (Italiano)</option>
              <option value="Korean">Korean (한국어)</option>
              <option value="Dutch">Dutch (Nederlands)</option>
              <option value="Turkish">Turkish (Türkçe)</option>
            </select>
          </div>
          <button type="button" class="mx-generate-btn" id="mxRunTranslateBtn">🌐 Translate</button>
        </div>
      </div>

      <!-- Card 4: Status & Result View -->
      <div class="mx-card mx-status-card">
        <div class="mx-status-header">
          <div class="mx-status-title" id="mxStatusTitle">Status: Ready. Press Trigger for text flow.</div>
          <div class="mx-status-actions">
            <button class="mx-copy-btn" id="mxCopyBtn" style="display:none;">📋 Copy</button>
            <button class="mx-action-tool-btn" id="mxRegenBtn" style="display:none;" title="Regenerate this answer">🔄 Regenerate</button>
            <button class="mx-action-tool-btn" id="mxEditResultBtn" style="display:none;" title="Edit before copying">✏ Edit</button>
            <button class="mx-action-tool-btn" id="mxChangeLangBtn" style="display:none;" title="Translate to different language">🌐 Change Language</button>
            <button class="mx-copy-to-chat-btn" id="mxCopyToChatBtn" style="display:none;" title="Open in separate Chatbot popup with full history">💬 Copy to Chatbot</button>
          </div>
        </div>
        <div class="mx-context-preview" id="mxContextPreview" style="display:none;"></div>
        <div class="mx-result-body" id="mxResultBody"></div>
      </div>
    `;
    shadowRoot.appendChild(consoleEl);

    // ── SEPARATE STANDALONE CHATBOT POPUP ────────────────────────────────────
    const chatbotWin = document.createElement("div");
    chatbotWin.className = "corsiri-chatbot-window";
    chatbotWin.id = "corsiriChatbotWindow";
    chatbotWin.innerHTML = `
      <div class="chatbot-header">
        <div class="chatbot-brand">
          <span class="chatbot-brand-icon"></span>
          <span class="chatbot-title">Corsiri AI Chatbot</span>
        </div>
        <div class="chatbot-header-actions">
          <button class="chatbot-icon-btn" id="chatbotNewChatBtn" title="Start new conversation">+ New</button>
          <button class="chatbot-icon-btn" id="chatbotHistoryBtn" title="Toggle conversation history">🕘 History <span class="chatbot-btn-badge" id="chatbotHeaderBadge" style="display:none;">0</span></button>
          <button class="chatbot-icon-btn" id="chatbotClearBtn" title="Clear conversation history">🗑 Clear</button>
          <button class="chatbot-icon-btn" id="chatbotMaximizeBtn" title="Expand / Restore window">⛶ Expand</button>
          <button class="chatbot-close-btn" id="chatbotCloseBtn" title="Close Chatbot">✕</button>
        </div>
      </div>
      <!-- History Toggle Menu / Pop-up Panel -->
      <div class="chatbot-history-panel" id="chatbotHistoryPanel" style="display:none;">
        <div class="history-panel-header">
          <div class="history-panel-title">
            <span>🕘 Conversation History</span>
            <span class="history-badge" id="historyBadge">0</span>
          </div>
          <div class="history-panel-actions">
            <button class="history-action-btn" id="historyNewChatBtn" title="Start new conversation">+ New</button>
            <button class="history-close-btn" id="historyCloseBtn" title="Close history">✕</button>
          </div>
        </div>
        <div class="history-items-list" id="historyItemsList"></div>
        <div class="history-panel-footer">
          <button class="history-clear-all-btn" id="historyClearAllBtn">🗑 Clear All History</button>
        </div>
      </div>
      <div class="chatbot-ref-banner" id="chatbotRefBanner" style="display:none;">
        <span class="chatbot-ref-text" id="chatbotRefText">📌 Context: Loaded</span>
        <button class="chatbot-ref-dismiss" id="chatbotRefDismiss" title="Remove reference context">✕</button>
      </div>
      <div class="chatbot-messages-list" id="chatbotMessagesList">
        <div id="chatbotWelcomeMsg" style="text-align: center; color: #8FA6B8; font-size: 12.5px; padding: 26px 10px;">
          <div style="font-size: 28px; margin-bottom: 8px;">💬</div>
          <strong style="color: #5EEBFF; font-size: 14px;">Corsiri AI Chatbot</strong>
          <p style="margin-top: 6px; font-size: 12px; line-height: 1.4;">Ask questions about your selected text, formulas, or anything on this webpage. Multi-turn conversation history is maintained.</p>
        </div>
      </div>
      <div class="chatbot-quick-chips">
        <button class="chatbot-chip" data-query="Explain this in more depth with practical examples">💡 Explain deeper</button>
        <button class="chatbot-chip" data-query="Extract all formulas and core equations">⚡ List formulas</button>
        <button class="chatbot-chip" data-query="Give me a 3-question practice quiz on this topic">📝 Practice quiz</button>
      </div>
      <div class="chatbot-footer">
        <div class="chatbot-attach-banner" id="chatbotAttachBanner" style="display:none;"></div>
        <div class="chatbot-input-row">
          <button type="button" class="chatbot-tool-btn" id="chatbotSnipBtn" title="Take screen image to ask about (Written & Voice supported)">📸</button>
          <textarea class="chatbot-textarea" id="chatbotInput" rows="1" placeholder="Ask question, solve image, or chat..."></textarea>
          <button type="button" class="chatbot-tool-btn" id="chatbotMicBtn" title="Hold to speak voice message">🎙</button>
          <button class="chatbot-send-btn" id="chatbotSendBtn" title="Send (Enter)">➤</button>
        </div>
        <div class="chatbot-hint">Shift + Enter for new line • Enter to send</div>
      </div>
    `;
    shadowRoot.appendChild(chatbotWin);

    // Event isolation to prevent any interaction inside extension panels from leaking to the host webpage
    const isolateEvents = (el) => {
      if (!el) return;
      const events = [
        "mousedown", "mouseup", "click", "dblclick", "auxclick",
        "pointerdown", "pointerup", "pointercancel",
        "touchstart", "touchend", "touchmove",
        "contextmenu", "selectstart"
      ];
      events.forEach(evtName => {
        el.addEventListener(evtName, (e) => {
          e.stopPropagation();
        }, false);
      });
    };
    isolateEvents(consoleEl);
    isolateEvents(chatbotWin);
    isolateEvents(triggerEl);

    // References
    const headerCard = consoleEl.querySelector(".mx-header-card");
    const closeBtn = consoleEl.querySelector(".mx-close-btn");
    const mxMaximizeBtn = consoleEl.querySelector("#mxMaximizeBtn");
    const exitBtn = consoleEl.querySelector(".mx-exit-btn");
    const modeSelect = consoleEl.querySelector("#mxModeSelect");
    const btnTrigger = consoleEl.querySelector("#mxBtnTrigger");
    const btnTakeAction = consoleEl.querySelector("#mxBtnTakeAction");
    const btnVoice = consoleEl.querySelector("#mxBtnVoice");
    const btnImage = consoleEl.querySelector("#mxBtnImage");
    const btnOpenChatbot = consoleEl.querySelector("#mxBtnOpenChatbot");
    const btnCopyTextToChatbot = consoleEl.querySelector("#mxBtnCopyTextToChatbot");
    const statusTitle = consoleEl.querySelector("#mxStatusTitle");
    const copyBtn = consoleEl.querySelector("#mxCopyBtn");
    const mxCopyToChatBtn = consoleEl.querySelector("#mxCopyToChatBtn");
    const contextPreview = consoleEl.querySelector("#mxContextPreview");
    const resultBody = consoleEl.querySelector("#mxResultBody");

    // Context Awareness References
    const mxContextCard = consoleEl.querySelector("#mxContextCard");
    const mxContextTypeBadge = consoleEl.querySelector("#mxContextTypeBadge");
    const mxContextDesc = consoleEl.querySelector("#mxContextDesc");
    const mxContextPillsGrid = consoleEl.querySelector("#mxContextPillsGrid");

    // Take Action References
    const mxTakeActionCard = consoleEl.querySelector("#mxTakeActionCard");
    const mxBtnMultiCopy = consoleEl.querySelector("#mxBtnMultiCopy");
    const mxMultiCopyBadge = consoleEl.querySelector("#mxMultiCopyBadge");
    const mxBtnClearMulti = consoleEl.querySelector("#mxBtnClearMulti");
    const mxBtnGenReply = consoleEl.querySelector("#mxBtnGenReply");
    const mxBtnTranslate = consoleEl.querySelector("#mxBtnTranslate");

    // Subpanels References
    const mxMultiCopySubpanel = consoleEl.querySelector("#mxMultiCopySubpanel");
    const mxMultiCopyCountText = consoleEl.querySelector("#mxMultiCopyCountText");
    const mxAddSelectionBtn = consoleEl.querySelector("#mxAddSelectionBtn");
    const mxMultiCopyList = consoleEl.querySelector("#mxMultiCopyList");
    const mxMultiCopyPrompt = consoleEl.querySelector("#mxMultiCopyPrompt");
    const mxAskCursivBtn = consoleEl.querySelector("#mxAskCursivBtn");

    const mxClearSubpanel = consoleEl.querySelector("#mxClearSubpanel");
    const mxClearPromptText = consoleEl.querySelector("#mxClearPromptText");
    const mxCancelClearBtn = consoleEl.querySelector("#mxCancelClearBtn");
    const mxConfirmClearBtn = consoleEl.querySelector("#mxConfirmClearBtn");

    const mxReplySubpanel = consoleEl.querySelector("#mxReplySubpanel");
    const mxReplyToneSelect = consoleEl.querySelector("#mxReplyToneSelect");
    const mxReplyInstructionInput = consoleEl.querySelector("#mxReplyInstructionInput");
    const mxRunGenerateReplyBtn = consoleEl.querySelector("#mxRunGenerateReplyBtn");

    const mxTranslateSubpanel = consoleEl.querySelector("#mxTranslateSubpanel");
    const mxTargetLangSelect = consoleEl.querySelector("#mxTargetLangSelect");
    const mxRunTranslateBtn = consoleEl.querySelector("#mxRunTranslateBtn");

    // Status action tool buttons
    const mxRegenBtn = consoleEl.querySelector("#mxRegenBtn");
    const mxEditResultBtn = consoleEl.querySelector("#mxEditResultBtn");
    const mxChangeLangBtn = consoleEl.querySelector("#mxChangeLangBtn");

    // Chatbot Window References
    const chatbotHeader = chatbotWin.querySelector(".chatbot-header");
    const chatbotCloseBtn = chatbotWin.querySelector("#chatbotCloseBtn");
    const chatbotNewChatBtn = chatbotWin.querySelector("#chatbotNewChatBtn");
    const chatbotHistoryBtn = chatbotWin.querySelector("#chatbotHistoryBtn");
    const chatbotHeaderBadge = chatbotWin.querySelector("#chatbotHeaderBadge");
    const chatbotClearBtn = chatbotWin.querySelector("#chatbotClearBtn");
    const chatbotMaximizeBtn = chatbotWin.querySelector("#chatbotMaximizeBtn");
    const chatbotRefBanner = chatbotWin.querySelector("#chatbotRefBanner");
    const chatbotRefText = chatbotWin.querySelector("#chatbotRefText");
    const chatbotRefDismiss = chatbotWin.querySelector("#chatbotRefDismiss");
    const chatbotMessagesList = chatbotWin.querySelector("#chatbotMessagesList");
    const chatbotInput = chatbotWin.querySelector("#chatbotInput");
    const chatbotSendBtn = chatbotWin.querySelector("#chatbotSendBtn");
    const chatbotAttachBanner = chatbotWin.querySelector("#chatbotAttachBanner");
    const chatbotSnipBtn = chatbotWin.querySelector("#chatbotSnipBtn");
    const chatbotMicBtn = chatbotWin.querySelector("#chatbotMicBtn");
    let activeAttachedImageUrl = null;

    function renderChatbotImageAttachment() {
      if (!chatbotAttachBanner) return;
      if (!activeAttachedImageUrl) {
        chatbotAttachBanner.style.display = "none";
        chatbotAttachBanner.innerHTML = "";
        return;
      }
      chatbotAttachBanner.style.display = "block";
      chatbotAttachBanner.innerHTML = `
        <div class="chatbot-attach-preview">
          <img src="${activeAttachedImageUrl}" class="chatbot-attach-thumb" alt="Attached Image" />
          <div class="chatbot-attach-label">
            <strong>📸 Image Attached</strong>
            <span style="color:#8FA6B8;font-size:10.5px;margin-left:6px;">Type question or hold 🎙 to speak</span>
          </div>
          <button type="button" class="chatbot-attach-remove" id="chatbotAttachRemove" title="Remove attached image">✕</button>
        </div>
      `;
      const removeBtn = chatbotAttachBanner.querySelector("#chatbotAttachRemove");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          activeAttachedImageUrl = null;
          renderChatbotImageAttachment();
        });
      }
      const thumb = chatbotAttachBanner.querySelector(".chatbot-attach-thumb");
      if (thumb) {
        thumb.style.cursor = "pointer";
        thumb.addEventListener("click", () => showFullImageModal(activeAttachedImageUrl));
      }
    }

    function showFullImageModal(imageUrl) {
      if (!imageUrl) return;
      const existing = shadowRoot.querySelector(".corsiri-img-modal-overlay");
      if (existing) existing.remove();

      const modal = document.createElement("div");
      modal.className = "corsiri-img-modal-overlay";
      modal.style.cssText = "position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(0, 0, 0, 0.88) !important; backdrop-filter: blur(8px) !important; z-index: 2147483647 !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: zoom-out !important; padding: 20px !important; box-sizing: border-box !important;";
      modal.innerHTML = `
        <div style="position: relative; max-width: 90vw; max-height: 88vh; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <button type="button" style="position: absolute; top: -38px; right: 0; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.35); color: #fff; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; font-weight: 700; transition: all 0.2s;">✕</button>
          <img src="${imageUrl}" alt="Preview" style="max-width: 88vw; max-height: 82vh; border-radius: 10px; border: 1.5px solid rgba(94, 235, 255, 0.7); box-shadow: 0 16px 50px rgba(0, 0, 0, 0.9), 0 0 30px rgba(94, 235, 255, 0.25); object-fit: contain; background: #070e17;" />
          <span style="margin-top: 10px; color: #8FA6B8; font-size: 12px; font-weight: 500; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Click anywhere or press Esc to close</span>
        </div>
      `;
      modal.addEventListener("click", () => modal.remove());
      const closeBtn = modal.querySelector("button");
      if (closeBtn) closeBtn.addEventListener("click", () => modal.remove());
      const escListener = (e) => {
        if (e.key === "Escape") {
          modal.remove();
          document.removeEventListener("keydown", escListener);
        }
      };
      document.addEventListener("keydown", escListener);
      shadowRoot.appendChild(modal);
    }

    if (chatbotSnipBtn) {
      chatbotSnipBtn.addEventListener("click", () => {
        startSnippingTool(true /* forChatbot */);
      });
    }

    function setupChatbotMicButton(micBtn, inputEl) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        micBtn.style.opacity = "0.5";
        micBtn.title = "Speech recognition unavailable.";
        return;
      }

      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";

      let isListening = false;
      let heard = "";

      rec.onresult = (e) => {
        let transcript = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          transcript += e.results[i][0].transcript;
        }
        heard = transcript.trim();
        if (inputEl && heard) {
          inputEl.value = heard;
          inputEl.style.height = "auto";
          inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
        }
      };

      rec.onend = () => {
        isListening = false;
        micBtn.classList.remove("recording");
        micBtn.innerHTML = "🎙";
      };

      rec.onerror = (e) => {
        isListening = false;
        micBtn.classList.remove("recording");
        micBtn.innerHTML = "🎙";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          showInPageMicPermissionPrompt();
        }
      };

      micBtn.addEventListener("mousedown", async () => {
        try {
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              stream.getTracks().forEach(track => track.stop());
            } catch (err) {
              if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                showInPageMicPermissionPrompt();
                return;
              }
            }
          }
          heard = "";
          isListening = true;
          micBtn.classList.add("recording");
          micBtn.innerHTML = "🔴";
          rec.start();
        } catch {
          showInPageMicPermissionPrompt();
        }
      });

      micBtn.addEventListener("mouseup", () => {
        if (isListening) {
          try { rec.stop(); } catch {}
        }
      });
    }

    if (chatbotMicBtn) {
      setupChatbotMicButton(chatbotMicBtn, chatbotInput);
    }

    function setupImageVoiceButton(voiceBtn, textInput, feedbackEl) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        voiceBtn.style.opacity = "0.5";
        voiceBtn.title = "Speech recognition unavailable in this browser.";
        voiceBtn.addEventListener("click", () => {
          statusTitle.textContent = "Web Speech API not supported in this browser.";
        });
        return;
      }

      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";

      let isListening = false;
      let voiceTranscript = "";

      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          interim += e.results[i][0].transcript;
        }
        interim = interim.trim();
        voiceTranscript = interim;
        currentContext.voicePrompt = interim;
        if (feedbackEl) {
          feedbackEl.style.display = "flex";
          feedbackEl.innerHTML = `<span>🎙️</span><span>Heard: <em>"${escapeHtml(interim)}"</em></span>`;
        }
        if (textInput && (!textInput.value || textInput.dataset.fromVoice === "true")) {
          textInput.value = interim;
          textInput.dataset.fromVoice = "true";
        }
      };

      rec.onend = () => {
        isListening = false;
        voiceBtn.classList.remove("recording");
        voiceBtn.innerHTML = "🎙️ Voice";
        if (voiceTranscript) {
          if (feedbackEl) {
            feedbackEl.style.display = "flex";
            feedbackEl.innerHTML = `<span>🎙️</span><span>Voice command saved: <strong>"${escapeHtml(voiceTranscript)}"</strong></span>`;
          }
        }
      };

      rec.onerror = (e) => {
        isListening = false;
        voiceBtn.classList.remove("recording");
        voiceBtn.innerHTML = "🎙️ Voice";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          showInPageMicPermissionPrompt();
        } else {
          if (feedbackEl) {
            feedbackEl.style.display = "flex";
            feedbackEl.innerHTML = `<span style="color:#FF6B6B;">⚠️ Mic: ${escapeHtml(e.error || "unavailable")}</span>`;
          }
        }
      };

      voiceBtn.addEventListener("mousedown", async (e) => {
        e.preventDefault();
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
          } catch (err) {
            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
              showInPageMicPermissionPrompt();
              return;
            }
          }
        }
        voiceTranscript = "";
        isListening = true;
        voiceBtn.classList.add("recording");
        voiceBtn.innerHTML = "🔴 Listening...";
        if (feedbackEl) {
          feedbackEl.style.display = "flex";
          feedbackEl.innerHTML = `<span>🔴</span><span>Listening for image command...</span>`;
        }
        try {
          rec.start();
        } catch {
          showInPageMicPermissionPrompt();
        }
      });

      voiceBtn.addEventListener("mouseup", (e) => {
        e.preventDefault();
        if (isListening) {
          try { rec.stop(); } catch {}
        }
      });
    }

    function openChatbotWithImage(dataUrl, promptText = "") {
      consoleEl.style.display = "none";
      openChatbotWindow();
      activeAttachedImageUrl = dataUrl;
      renderChatbotImageAttachment();
      if (promptText && chatbotInput) {
        chatbotInput.value = promptText;
      }
      if (chatbotInput) chatbotInput.focus();
    }
    const chatbotHistoryPanel = chatbotWin.querySelector("#chatbotHistoryPanel");
    const historyBadge = chatbotWin.querySelector("#historyBadge");
    const historyNewChatBtn = chatbotWin.querySelector("#historyNewChatBtn");
    const historyCloseBtn = chatbotWin.querySelector("#historyCloseBtn");
    const historyItemsList = chatbotWin.querySelector("#historyItemsList");
    const historyClearAllBtn = chatbotWin.querySelector("#historyClearAllBtn");

    let isChatMaximized = false;
    let preMaximizedBounds = null;

    if (chatbotMaximizeBtn) {
      chatbotMaximizeBtn.addEventListener("click", () => {
        isChatMaximized = !isChatMaximized;
        if (isChatMaximized) {
          preMaximizedBounds = {
            width: chatbotWin.style.width,
            height: chatbotWin.style.height,
            top: chatbotWin.style.top,
            left: chatbotWin.style.left
          };
          const targetW = Math.min(960, window.innerWidth - 32);
          const targetH = Math.min(860, window.innerHeight - 40);
          const targetLeft = Math.max(16, Math.round((window.innerWidth - targetW) / 2));
          const targetTop = Math.max(16, Math.round((window.innerHeight - targetH) / 2));

          chatbotWin.classList.add("maximized");
          chatbotWin.style.width = `${targetW}px`;
          chatbotWin.style.height = `${targetH}px`;
          chatbotWin.style.top = `${targetTop}px`;
          chatbotWin.style.left = `${targetLeft}px`;
          chatbotMaximizeBtn.textContent = "🗗 Restore";
        } else {
          chatbotWin.classList.remove("maximized");
          if (preMaximizedBounds && preMaximizedBounds.width) {
            chatbotWin.style.width = preMaximizedBounds.width;
            chatbotWin.style.height = preMaximizedBounds.height;
            chatbotWin.style.top = preMaximizedBounds.top;
            chatbotWin.style.left = preMaximizedBounds.left;
          } else {
            const defaultWidth = Math.min(640, window.innerWidth - 40);
            const defaultHeight = Math.min(720, window.innerHeight - 50);
            chatbotWin.style.width = `${defaultWidth}px`;
            chatbotWin.style.height = `${defaultHeight}px`;
          }
          chatbotMaximizeBtn.textContent = "⛶ Expand";
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // [TEST FEATURE - FULLY REVERSIBLE] Smooth Emergence Animation from Selection
    // Set to false to immediately revert to standard instant popup.
    // ═══════════════════════════════════════════════════════════════════════════
    const ENABLE_TEXT_EMERGE_ANIMATION = true;
    let enableTextEmerge = ENABLE_TEXT_EMERGE_ANIMATION;

    const userPreferences = {
      popupSize: "standard",
      popupPosition: "smart",
      themeMode: "dark",
      actionsShown: {
        fix_it: true,
        explain: true,
        debug: true,
        improve: true,
        translate: true,
        summarize: true,
        reply: true,
        multicopy: true,
        search: true
      },
      actionOrderPreset: "default",
      enableGlobalHotkey: true,
      enableSnipHotkey: true,
      enableConsoleToggleHotkey: true,
      defaultTranslationLanguage: "English",
      defaultReplyTone: "Professional",
      voiceLanguage: "en-US",
      voiceAutoListen: false,
      lastConsolePos: null
    };

    function applyPreferences() {
      if (!consoleEl) return;

      // 1. Popup Size
      consoleEl.classList.remove("mx-size-compact", "mx-size-standard", "mx-size-large", "mx-size-expanded");
      consoleEl.classList.add(`mx-size-${userPreferences.popupSize || "standard"}`);

      // 2. Theme Mode
      const isSystemLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
      const isLight = userPreferences.themeMode === "light" || (userPreferences.themeMode === "system" && isSystemLight);
      if (isLight) {
        consoleEl.classList.add("mx-theme-light");
      } else {
        consoleEl.classList.remove("mx-theme-light");
      }

      // 3. Default Selectors
      if (typeof mxTargetLangSelect !== "undefined" && mxTargetLangSelect && userPreferences.defaultTranslationLanguage) {
        mxTargetLangSelect.value = userPreferences.defaultTranslationLanguage;
      }
      if (typeof mxReplyToneSelect !== "undefined" && mxReplyToneSelect && userPreferences.defaultReplyTone) {
        mxReplyToneSelect.value = userPreferences.defaultReplyTone;
      }

      // 4. Take action buttons visibility
      if (userPreferences.actionsShown) {
        if (typeof mxBtnMultiCopy !== "undefined" && mxBtnMultiCopy) {
          mxBtnMultiCopy.style.display = userPreferences.actionsShown.multicopy === false ? "none" : "inline-flex";
        }
        if (typeof mxBtnGenReply !== "undefined" && mxBtnGenReply) {
          mxBtnGenReply.style.display = userPreferences.actionsShown.reply === false ? "none" : "inline-flex";
        }
        if (typeof mxBtnTranslate !== "undefined" && mxBtnTranslate) {
          mxBtnTranslate.style.display = userPreferences.actionsShown.translate === false ? "none" : "inline-flex";
        }
      }

      // Re-render contextual actions if currently displayed
      if (typeof temporaryContext !== "undefined" && temporaryContext?.contentType) {
        const textForClassify = (currentContext?.text || window.getSelection()?.toString() || "").trim();
        updateContextualActions(temporaryContext.contentType, textForClassify);
      }
    }

    if (isExtensionValid()) {
      chrome.storage?.local?.get?.([
        "popupSize",
        "popupPosition",
        "themeMode",
        "actionsShown",
        "actionOrderPreset",
        "enableGlobalHotkey",
        "enableSnipHotkey",
        "enableConsoleToggleHotkey",
        "defaultTranslationLanguage",
        "defaultReplyTone",
        "voiceLanguage",
        "voiceAutoListen",
        "lastConsolePos",
        "enableTextEmergeAnimation",
        "corsiri_emerge_animation"
      ], (res) => {
        if (!res) return;
        if (res.popupSize) userPreferences.popupSize = res.popupSize;
        if (res.popupPosition) userPreferences.popupPosition = res.popupPosition;
        if (res.themeMode) userPreferences.themeMode = res.themeMode;
        if (res.actionsShown && typeof res.actionsShown === "object") userPreferences.actionsShown = { ...userPreferences.actionsShown, ...res.actionsShown };
        if (res.actionOrderPreset) userPreferences.actionOrderPreset = res.actionOrderPreset;
        if (typeof res.enableGlobalHotkey === "boolean") userPreferences.enableGlobalHotkey = res.enableGlobalHotkey;
        if (typeof res.enableSnipHotkey === "boolean") userPreferences.enableSnipHotkey = res.enableSnipHotkey;
        if (typeof res.enableConsoleToggleHotkey === "boolean") userPreferences.enableConsoleToggleHotkey = res.enableConsoleToggleHotkey;
        if (res.defaultTranslationLanguage) userPreferences.defaultTranslationLanguage = res.defaultTranslationLanguage;
        if (res.defaultReplyTone) userPreferences.defaultReplyTone = res.defaultReplyTone;
        if (res.voiceLanguage) userPreferences.voiceLanguage = res.voiceLanguage;
        if (typeof res.voiceAutoListen === "boolean") userPreferences.voiceAutoListen = res.voiceAutoListen;
        if (res.lastConsolePos) userPreferences.lastConsolePos = res.lastConsolePos;

        if (typeof res.enableTextEmergeAnimation === "boolean") enableTextEmerge = res.enableTextEmergeAnimation;
        else if (typeof res.corsiri_emerge_animation === "boolean") enableTextEmerge = res.corsiri_emerge_animation;

        applyPreferences();
      });

      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area === "local") {
          let shouldReapply = false;
          Object.keys(changes).forEach(k => {
            if (k in userPreferences) {
              userPreferences[k] = changes[k].newValue;
              shouldReapply = true;
            }
          });
          if (changes.enableTextEmergeAnimation) {
            enableTextEmerge = Boolean(changes.enableTextEmergeAnimation.newValue);
          } else if (changes.corsiri_emerge_animation) {
            enableTextEmerge = Boolean(changes.corsiri_emerge_animation.newValue);
          }
          if (shouldReapply) applyPreferences();
        }
      });
    }

    function getActiveSourceRect() {
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const r = range.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            return {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height
            };
          }
        }
      } catch {}
      try {
        if (triggerEl && triggerEl.style.display !== "none") {
          const r = triggerEl.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            return {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height
            };
          }
        }
      } catch {}
      return null;
    }

    function showSelectionAura(rect) {
      if (!rect) return;
      try {
        const aura = document.createElement("div");
        aura.className = "corsiri-selection-aura";
        aura.style.position = "fixed";
        aura.style.left = `${Math.round(rect.left - 4)}px`;
        aura.style.top = `${Math.round(rect.top - 2)}px`;
        aura.style.width = `${Math.round(rect.width + 8)}px`;
        aura.style.height = `${Math.round(rect.height + 4)}px`;
        aura.style.borderRadius = "8px";
        aura.style.background = "linear-gradient(135deg, rgba(94, 235, 255, 0.4), rgba(0, 150, 199, 0.25))";
        aura.style.border = "1.5px solid rgba(94, 235, 255, 0.85)";
        aura.style.boxShadow = "0 0 20px rgba(94, 235, 255, 0.7), 0 0 40px rgba(0, 198, 255, 0.35)";
        aura.style.pointerEvents = "none";
        aura.style.zIndex = "2147483646";
        aura.style.transform = "scale(1)";
        aura.style.opacity = "1";
        aura.style.transition = "transform 0.42s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.42s cubic-bezier(0.16, 1, 0.3, 1)";
        shadowRoot.appendChild(aura);

        requestAnimationFrame(() => {
          aura.style.transform = "scale(1.15)";
          aura.style.opacity = "0";
        });

        setTimeout(() => {
          if (aura && aura.parentNode) aura.parentNode.removeChild(aura);
        }, 450);
      } catch {}
    }

    let currentEmergenceAnim = null;

    function animateEmergenceFromRect(element, sourceRect) {
      if (!element || !sourceRect || typeof element.animate !== "function") return;

      const targetRect = element.getBoundingClientRect();
      const targetWidth = targetRect.width || 440;
      const targetHeight = targetRect.height || 540;

      const sourceCenterX = sourceRect.left + sourceRect.width / 2;
      const sourceCenterY = sourceRect.top + sourceRect.height / 2;

      const targetCenterX = targetRect.left + targetWidth / 2;
      const targetCenterY = targetRect.top + targetHeight / 2;

      const deltaX = Math.round(sourceCenterX - targetCenterX);
      const deltaY = Math.round(sourceCenterY - targetCenterY);

      try {
        if (currentEmergenceAnim) {
          currentEmergenceAnim.cancel();
          currentEmergenceAnim = null;
        }

        element.style.animation = "none";
        element.style.transformOrigin = "center center";

        currentEmergenceAnim = element.animate([
          {
            transform: `translate(${deltaX}px, ${deltaY}px) scale(0.08)`,
            opacity: 0,
            filter: "blur(10px) brightness(1.6)",
            boxShadow: "0 0 35px rgba(94, 235, 255, 0.95), 0 0 70px rgba(0, 198, 255, 0.55)"
          },
          {
            transform: `translate(${Math.round(deltaX * 0.28)}px, ${Math.round(deltaY * 0.28)}px) scale(0.65)`,
            opacity: 0.92,
            filter: "blur(2px) brightness(1.2)",
            offset: 0.5
          },
          {
            transform: "translate(0px, 0px) scale(1)",
            opacity: 1,
            filter: "blur(0px) brightness(1)",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.85), 0 0 30px rgba(94, 235, 255, 0.15)"
          }
        ], {
          duration: 380,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "none"
        });

        currentEmergenceAnim.onfinish = () => {
          currentEmergenceAnim = null;
          element.style.animation = "";
        };
      } catch (err) {
        console.warn("Emergence animation failed, using instant show:", err);
      }
    }

    let currentContext = {
      type: "text", // "text" | "image"
      text: "",
      imageUrl: ""
    };
    let currentRawResult = "";

    function isExtensionValid() {
      try {
        return Boolean(typeof chrome !== "undefined" && chrome?.runtime && chrome?.runtime?.id);
      } catch {
        return false;
      }
    }

    // Chatbot state with persistent multi-session history
    let activeChatContextText = "";
    let chatSessions = [];
    let currentSessionId = null;
    let chatConversationHistory = [];
    let isChatLoading = false;
    let chatHistoryLoaded = false;

    function safeGetStorage(keys) {
      if (!isExtensionValid()) return Promise.resolve(null);
      try {
        const p = chrome.storage?.local?.get?.(keys);
        if (p && typeof p.then === "function") {
          return p.catch(() => null);
        }
        return Promise.resolve(null);
      } catch {
        return Promise.resolve(null);
      }
    }

    function safeSetStorage(data) {
      if (!isExtensionValid()) return Promise.resolve(null);
      try {
        const p = chrome.storage?.local?.set?.(data);
        if (p && typeof p.then === "function") {
          return p.catch(() => null);
        }
        return Promise.resolve(null);
      } catch {
        return Promise.resolve(null);
      }
    }

    function formatRelativeTime(ts) {
      if (!ts) return "";
      const diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 60) return "Just now";
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      const days = Math.floor(diff / 86400);
      if (days === 1) return "Yesterday";
      if (days < 7) return `${days}d ago`;
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function generateSessionId() {
      return "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    }

    function getOrCreateCurrentSession(initialTitle = "New Conversation", initialContext = "") {
      if (currentSessionId) {
        const existing = chatSessions.find(s => s.id === currentSessionId);
        if (existing) return existing;
      }
      const newSession = {
        id: generateSessionId(),
        title: initialTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        contextText: initialContext || ""
      };
      chatSessions.unshift(newSession);
      currentSessionId = newSession.id;
      return newSession;
    }

    function updateHistoryBadges() {
      const count = chatSessions.filter(s => Array.isArray(s.messages) && s.messages.length > 0).length;
      if (chatbotHeaderBadge) {
        if (count > 0) {
          chatbotHeaderBadge.textContent = count;
          chatbotHeaderBadge.style.display = "inline-block";
        } else {
          chatbotHeaderBadge.style.display = "none";
        }
      }
      if (historyBadge) {
        historyBadge.textContent = `${count} ${count === 1 ? "chat" : "chats"}`;
      }
    }

    function toggleHistoryPanel(show = null) {
      if (!chatbotHistoryPanel) return;
      const isCurrentlyVisible = chatbotHistoryPanel.style.display === "flex";
      const shouldShow = show !== null ? show : !isCurrentlyVisible;
      if (shouldShow) {
        renderHistoryItems();
        chatbotHistoryPanel.style.display = "flex";
      } else {
        chatbotHistoryPanel.style.display = "none";
      }
    }

    function renderHistoryItems() {
      if (!historyItemsList) return;
      historyItemsList.innerHTML = "";

      const activeSessions = chatSessions.filter(s => Array.isArray(s.messages) && s.messages.length > 0);

      if (activeSessions.length === 0) {
        historyItemsList.innerHTML = `
          <div class="history-empty-state">
            <div class="history-empty-icon">💬</div>
            <strong>No conversation history yet</strong>
            <p style="margin-top: 4px; color: #7F97AA;">Ask questions or send context to start a conversation.</p>
          </div>
        `;
        return;
      }

      activeSessions.forEach(session => {
        const item = document.createElement("div");
        const isActive = session.id === currentSessionId;
        item.className = `history-item ${isActive ? "active" : ""}`;

        const msgCount = Array.isArray(session.messages) ? session.messages.length : 0;
        const timeStr = formatRelativeTime(session.updatedAt || session.createdAt);

        item.innerHTML = `
          <div class="history-item-main">
            <div class="history-item-title-row">
              <span class="history-item-title" title="${escapeHtml(session.title || "Untitled")}">${escapeHtml(session.title || "Untitled")}</span>
              ${isActive ? `<span class="history-active-tag">Active</span>` : ""}
            </div>
            <div class="history-item-meta">
              <span>${timeStr}</span>
              <span>•</span>
              <span>${msgCount} ${msgCount === 1 ? "msg" : "msgs"}</span>
            </div>
          </div>
          <button class="history-item-del-btn" title="Delete conversation" data-id="${session.id}">🗑</button>
        `;

        item.addEventListener("click", (e) => {
          if (e.target.closest(".history-item-del-btn")) return;
          switchChatSession(session.id);
        });

        const delBtn = item.querySelector(".history-item-del-btn");
        if (delBtn) {
          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteChatSession(session.id);
          });
        }

        historyItemsList.appendChild(item);
      });
    }

    function createNewChatSession(contextText = null) {
      if (currentSessionId && chatConversationHistory.length > 0) {
        saveChatHistory();
      }

      const newSession = {
        id: generateSessionId(),
        title: contextText ? (contextText.replace(/\s+/g, " ").trim().slice(0, 42) + "...") : "New Conversation",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        contextText: contextText || ""
      };

      chatSessions.unshift(newSession);
      currentSessionId = newSession.id;
      chatConversationHistory = [];
      activeChatContextText = contextText || "";

      if (contextText && contextText.trim()) {
        const welcome = {
          role: "assistant",
          content: `📌 **Loaded Selected Text:**\n"${contextText.slice(0, 260)}${contextText.length > 260 ? "..." : ""}"\n\nAsk any question, or type **answer** / **solve** to get the complete solution.`
        };
        chatConversationHistory.push(welcome);
        saveChatHistory();
      } else {
        saveChatHistory();
      }

      if (activeChatContextText && chatbotRefBanner && chatbotRefText) {
        chatbotRefBanner.style.display = "flex";
        chatbotRefText.textContent = `📌 Context: ${activeChatContextText.replace(/\s+/g, " ").slice(0, 60)}...`;
      } else if (chatbotRefBanner) {
        chatbotRefBanner.style.display = "none";
      }

      renderAllChatMessages();
      toggleHistoryPanel(false);
      if (chatbotInput) chatbotInput.focus();
    }

    function switchChatSession(sessionId) {
      if (sessionId === currentSessionId) {
        toggleHistoryPanel(false);
        return;
      }

      if (currentSessionId && chatConversationHistory.length > 0) {
        saveChatHistory();
      }

      const target = chatSessions.find(s => s.id === sessionId);
      if (!target) return;

      currentSessionId = target.id;
      chatConversationHistory = Array.isArray(target.messages) ? [...target.messages] : [];
      activeChatContextText = target.contextText || "";

      if (activeChatContextText && chatbotRefBanner && chatbotRefText) {
        chatbotRefBanner.style.display = "flex";
        chatbotRefText.textContent = `📌 Context: ${activeChatContextText.replace(/\s+/g, " ").slice(0, 60)}...`;
      } else if (chatbotRefBanner) {
        chatbotRefBanner.style.display = "none";
      }

      renderAllChatMessages();
      toggleHistoryPanel(false);
      saveChatHistory();
      if (chatbotInput) chatbotInput.focus();
    }

    function deleteChatSession(sessionId) {
      chatSessions = chatSessions.filter(s => s.id !== sessionId);

      if (currentSessionId === sessionId) {
        if (chatSessions.length > 0) {
          currentSessionId = chatSessions[0].id;
          chatConversationHistory = Array.isArray(chatSessions[0].messages) ? [...chatSessions[0].messages] : [];
          activeChatContextText = chatSessions[0].contextText || "";
        } else {
          currentSessionId = null;
          chatConversationHistory = [];
          activeChatContextText = "";
        }
        renderAllChatMessages();
      }

      saveChatHistory();
      renderHistoryItems();
      updateHistoryBadges();
    }

    function clearAllChatHistory() {
      chatSessions = [];
      currentSessionId = null;
      chatConversationHistory = [];
      activeChatContextText = "";
      if (chatbotRefBanner) chatbotRefBanner.style.display = "none";

      if (isExtensionValid()) {
        chrome.storage?.local?.remove?.(["corsiri_chat_sessions", "corsiri_current_session_id", "corsiri_chat_history"])?.catch?.(() => {});
      }
      updateHistoryBadges();
      renderHistoryItems();
      renderAllChatMessages();
    }

    async function loadChatHistoryLazily() {
      if (chatHistoryLoaded || !isExtensionValid()) return;
      chatHistoryLoaded = true;
      try {
        const stored = await safeGetStorage(["corsiri_chat_sessions", "corsiri_current_session_id", "corsiri_chat_history"]);
        let sessions = Array.isArray(stored?.corsiri_chat_sessions) ? stored.corsiri_chat_sessions : [];
        let activeId = stored?.corsiri_current_session_id || null;

        // Legacy migration
        if (sessions.length === 0 && Array.isArray(stored?.corsiri_chat_history) && stored.corsiri_chat_history.length > 0) {
          const legacyMessages = stored.corsiri_chat_history;
          const firstUser = legacyMessages.find(m => m.role === "user");
          const title = firstUser ? (firstUser.content.replace(/\s+/g, " ").trim().slice(0, 42) + (firstUser.content.length > 42 ? "..." : "")) : "Previous Conversation";
          const migratedSession = {
            id: generateSessionId(),
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: legacyMessages,
            contextText: ""
          };
          sessions = [migratedSession];
          activeId = migratedSession.id;
        }

        chatSessions = sessions;
        currentSessionId = activeId;

        if (chatSessions.length > 0) {
          let activeSession = chatSessions.find(s => s.id === currentSessionId);
          if (!activeSession) {
            activeSession = chatSessions[0];
            currentSessionId = activeSession.id;
          }
          chatConversationHistory = Array.isArray(activeSession.messages) ? [...activeSession.messages] : [];
          activeChatContextText = activeSession.contextText || "";
          if (activeChatContextText && chatbotRefBanner && chatbotRefText) {
            chatbotRefBanner.style.display = "flex";
            chatbotRefText.textContent = `📌 Context: ${activeChatContextText.replace(/\s+/g, " ").slice(0, 60)}...`;
          }
        }

        updateHistoryBadges();
        renderAllChatMessages();
      } catch {}
    }

    function saveChatHistory() {
      if (!isExtensionValid()) return;
      try {
        const current = getOrCreateCurrentSession();
        current.messages = chatConversationHistory.slice(-50);
        current.updatedAt = Date.now();
        current.contextText = activeChatContextText || "";

        // Auto-name session if title is default
        if (!current.title || current.title === "New Conversation" || current.title === "Chat Session") {
          const firstUserMsg = chatConversationHistory.find(m => m.role === "user");
          if (firstUserMsg && firstUserMsg.content) {
            current.title = firstUserMsg.content.replace(/\s+/g, " ").trim().slice(0, 45) + (firstUserMsg.content.length > 45 ? "..." : "");
          } else if (activeChatContextText) {
            current.title = activeChatContextText.replace(/\s+/g, " ").trim().slice(0, 45) + (activeChatContextText.length > 45 ? "..." : "");
          }
        }

        // Sort by updatedAt descending and limit to 25
        chatSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (chatSessions.length > 25) {
          chatSessions = chatSessions.slice(0, 25);
        }

        updateHistoryBadges();

        safeSetStorage({
          corsiri_chat_sessions: chatSessions,
          corsiri_current_session_id: currentSessionId,
          corsiri_chat_history: chatConversationHistory.slice(-50)
        });
      } catch {}
    }

    // ── Context Awareness & Multi-Copy State Management ──────────────────────
    const temporaryContext = {
      selections: [], // temporary multi-copy text strings
      contentType: null
    };

    function classifySelectedContent(rawText, isImage = false) {
      if (isImage) return "image";
      if (!rawText || typeof rawText !== "string") return "unknown";
      const text = rawText.trim();
      if (text.length < 3) return "unknown";

      // 1. URL Detection
      const urlRegex = /^(https?:\/\/|ftp:\/\/|www\.)[^\s/$.?#].[^\s]*$/i;
      if (urlRegex.test(text) || (/^https?:\/\//i.test(text) && !text.includes("\n") && !text.includes(" "))) {
        return "url";
      }
      try {
        if (!text.includes(" ") && !text.includes("\n")) {
          const parsed = new URL(text.startsWith("www.") ? "https://" + text : text);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") return "url";
        }
      } catch {}

      // 2. Email / Message / Communication Detection
      const emailHeaderRegex = /^(from:|to:|subject:|date:|cc:|bcc:)/im;
      const salutationRegex = /^(hi|hello|hey|dear|good morning|good afternoon|good evening|greetings)\b/i;
      const signoffRegex = /\b(best regards|regards|sincerely|thanks|thank you|cheers|yours truly|best|warm regards|talk soon|let me know|looking forward)[,\s.!]/i;
      const commIntentRegex = /\b(can you please|could you please|please send|please find attached|following up on|update on|let me know if|as discussed|meeting at|reschedule|reply by|let's meet|reach out to)\b/i;
      const commQuestionRegex = /^(can you|could you|would you|are you free|will you|have you had a chance|please let me know)\b/i;

      const isEmailOrComm = emailHeaderRegex.test(text) ||
        salutationRegex.test(text) ||
        (signoffRegex.test(text) && text.length > 20) ||
        commIntentRegex.test(text) ||
        commQuestionRegex.test(text);

      // 3. Source Code Detection
      const codeKeywords = [
        "function", "const ", "let ", "var ", "def ", "import ", "from ", "export ", "class ", "return ",
        "public static", "System.out.", "console.log", "if (", "for (", "while (", "switch (",
        "namespace", "using namespace", "struct ", "typedef ", "#include", "#!/", "<?php",
        "SELECT ", "INSERT INTO", "CREATE TABLE", "async function", "await ", "fn ", "impl ",
        "val ", "package ", "func "
      ];
      let keywordMatches = 0;
      for (const kw of codeKeywords) {
        if (text.includes(kw)) keywordMatches++;
      }

      const syntaxChars = (text.match(/[{};=<>()[\]$|&!+\-*/%~^`]/g) || []).length;
      const syntaxDensity = syntaxChars / text.length;
      const hasCodeLines = /^\s*(const|let|var|def|class|function|import|export|public|private|return|if|for|while)\b/m.test(text);
      const hasBracesAndSemicolons = (text.includes("{") && text.includes("}")) || (text.includes(";") && (text.includes("(") || text.includes("=")));
      const isPythonStyle = /^\s*def\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/m.test(text) ||
        /^\s*class\s+[a-zA-Z0-9_]+(\(.*?\))?\s*:/m.test(text) ||
        (text.includes("def ") && text.includes("return"));

      const isLikelyCode = (keywordMatches >= 2) ||
        isPythonStyle ||
        (hasCodeLines && (syntaxDensity > 0.04 || hasBracesAndSemicolons || text.includes(":") || /\n\s{2,}/.test(text))) ||
        (keywordMatches >= 1 && hasBracesAndSemicolons) ||
        (text.startsWith("#!/") || text.startsWith("<?php") || text.startsWith("<html") || text.startsWith("<!DOCTYPE"));

      // 4. Math / Calculation Detection
      const latexMathRegex = /\\(frac|sqrt|sum|int|cdot|times|div|pm|alpha|beta|gamma|theta|pi|le|ge|neq|approx)\b/;
      const arithmeticExprRegex = /^\s*(\-?\d+(\.\d+)?\s*[+\-*/^%]\s*)+(\-?\d+(\.\d+)?)\s*(=.*)?$/;
      const equationPatternRegex = /^[a-zA-Z0-9\s()+\-*/^.]+\s*=\s*[a-zA-Z0-9\s()+\-*/^.]+$/;
      const isWordProblemMath = /\b(what is|evaluate|solve|calculate)\s+([0-9]|the\s+value|x|y)/i.test(text);
      const mathKeywordsRegex = /\b(sin|cos|tan|sqrt|log|ln|lim|derivative|integral|solve for|calculate|equation|matrix|polynomial|formula)\b/i;
      const mathSymbolsRegex = /[=+\-*/^√∑∫≈≠≤≥πθ]/;
      const mathCharCount = (text.match(/[0-9=+\-*/^()√∑∫≈≠≤≥%]/g) || []).length;
      const mathDensity = mathCharCount / text.length;

      const isLikelyMath = latexMathRegex.test(text) ||
        arithmeticExprRegex.test(text) ||
        (mathKeywordsRegex.test(text) && (mathDensity > 0.15 || text.includes("="))) ||
        (equationPatternRegex.test(text) && mathSymbolsRegex.test(text) && !text.includes("\n") && text.length < 150) ||
        (isWordProblemMath && mathDensity > 0.1) ||
        (mathDensity > 0.45 && text.length < 120 && mathSymbolsRegex.test(text));

      if (isLikelyCode && !isEmailOrComm && !latexMathRegex.test(text)) return "code";
      if (isLikelyMath) return "math";
      if (isEmailOrComm) return "email";

      // 5. Normal Readable Text
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
      const letterRatio = letterCount / text.length;

      if (wordCount >= 2 && letterRatio > 0.55) {
        return "normal";
      }

      return "unknown";
    }

    let currentActionId = "explain";
    let currentActionPrompt = "";

    const DIAL_ACTIONS = [
      { id: "explain", label: "✨ Explain Concept", prompt: "Explain thoroughly with clear numbered sections, intuitive bullet points, and key takeaways." },
      { id: "answer", label: "🎯 Direct Answer", prompt: "Provide the direct, complete solution, code/algorithm implementation, or answer to these questions first. Be clear, direct, and solve each numbered question explicitly." },
      { id: "solve", label: "⚡ Formulas & Steps", prompt: "Break down and solve or explain the formulas, equations, variables, and step-by-step mathematical/computational derivations." },
      { id: "summarize", label: "📝 Quick Summary", prompt: "Summarize the essential ideas into clean, high-yield bullet points." }
    ];

    function getSelectedAction() {
      return DIAL_ACTIONS.find(a => a.id === currentActionId) || DIAL_ACTIONS[0];
    }

    function selectAction(actionId, autoExecuteIfContext = false) {
      currentActionId = actionId;
      const action = getSelectedAction();
      statusTitle.textContent = `Selected: ${action.label}`;
      if (autoExecuteIfContext && currentContext.text) {
        runTriggerFlow();
      }
    }

    function updateContextualActions(detectedType, text) {
      if (!mxContextPillsGrid || !mxContextTypeBadge) return;

      let badgeHtml = "📄 Normal Text";
      let actions = [];

      switch (detectedType) {
        case "code":
          badgeHtml = "💻 Source Code";
          actions = [
            { id: "fix_it", label: "🛠 Fix Bug", prompt: "Fix the bug in this code. Explain the issue and provide the corrected code." },
            { id: "explain_code", label: "💡 Explain Code", prompt: "Explain how this code works step-by-step." },
            { id: "debug_code", label: "🐛 Debug / Find Issue", prompt: "Find bugs, logic flaws, and syntax issues in this code." },
            { id: "improve_code", label: "⚡ Improve / Refactor", prompt: "Refactor and improve this code for performance and best practices." },
            { id: "copy", label: "📋 Copy", isUtility: true }
          ];
          break;

        case "math":
          badgeHtml = "🧮 Math / Calculation";
          actions = [
            { id: "fix_it", label: "🛠 Fix Calculation", prompt: "Check and fix this calculation. Verify all arithmetic, formulas, and steps." },
            { id: "solve", label: "⚡ Solve & Steps", prompt: "Break down and solve or explain the formulas, equations, and steps." },
            { id: "explain", label: "✨ Explain Formula", prompt: "Explain the underlying formula, variables, and mathematical concepts clearly." },
            { id: "copy", label: "📋 Copy", isUtility: true }
          ];
          break;

        case "email":
          badgeHtml = "✉ Email / Message";
          actions = [
            { id: "fix_it", label: "🛠 Fix Tone", prompt: "Fix the tone of this email/message to make it polished, professional, clear, and polite." },
            { id: "generate_reply", label: "✍ Generate Reply", isSubpanel: "reply" },
            { id: "explain", label: "✨ Explain", prompt: "Explain this message and summarize intentions." },
            { id: "translate", label: "🌐 Translate", isSubpanel: "translate" },
            { id: "copy", label: "📋 Copy", isUtility: true }
          ];
          break;

        case "url":
          badgeHtml = "🔗 URL Link";
          actions = [
            { id: "open_url", label: "↗ Open", isUtility: true },
            { id: "search", label: "🔍 Search", isUtility: true },
            { id: "explain_page", label: "📄 Explain Page", prompt: "Explain what this web page or URL is." },
            { id: "copy", label: "📋 Copy", isUtility: true }
          ];
          break;

        case "image":
          badgeHtml = "📸 Screen Image";
          actions = [
            { id: "describe_image", label: "🖼 Describe Image" },
            { id: "extract_text", label: "📄 Extract Text" },
            { id: "explain_image", label: "✨ Explain Image" },
            { id: "translate_image_text", label: "🌐 Translate Text" }
          ];
          break;

        case "unknown":
          badgeHtml = "❓ Text Content";
          actions = [
            { id: "fix_it", label: "🛠 Fix This", prompt: "Fix errors, calculations, grammar, or bugs in this content." },
            { id: "explain", label: "✨ Explain", prompt: "Explain this clearly." },
            { id: "translate", label: "🌐 Translate", isSubpanel: "translate" },
            { id: "summarize", label: "📝 Summarize", prompt: "Summarize this text concisely." },
            { id: "copy", label: "📋 Copy", isUtility: true }
          ];
          break;

        case "normal":
        default:
          badgeHtml = "📄 Normal Text";
          actions = [
            { id: "fix_it", label: "🛠 Fix Grammar", prompt: "Fix all grammar, spelling, punctuation, and phrasing errors in this text." },
            { id: "explain", label: "✨ Explain", prompt: "Explain thoroughly with clear bullet points." },
            { id: "translate", label: "🌐 Translate", isSubpanel: "translate" },
            { id: "summarize", label: "📝 Summarize", prompt: "Summarize the essential ideas into clean bullet points." },
            { id: "search", label: "🔍 Search", isUtility: true }
          ];
          break;
      }

      // Filter actions based on personalization
      if (userPreferences?.actionsShown) {
        actions = actions.filter(act => {
          if (act.id === "fix_it" && userPreferences.actionsShown.fix_it === false) return false;
          if ((act.id === "explain" || act.id === "explain_code" || act.id === "explain_page" || act.id === "explain_image") && userPreferences.actionsShown.explain === false) return false;
          if ((act.id === "debug_code" || act.id === "improve_code") && userPreferences.actionsShown.debug === false) return false;
          if ((act.id === "translate" || act.id === "translate_image_text") && userPreferences.actionsShown.translate === false) return false;
          if (act.id === "summarize" && userPreferences.actionsShown.summarize === false) return false;
          if (act.id === "generate_reply" && userPreferences.actionsShown.reply === false) return false;
          if (act.id === "search" && userPreferences.actionsShown.search === false) return false;
          return true;
        });
      }

      // Order actions based on personalization preset
      if (userPreferences?.actionOrderPreset === "fix_first") {
        actions.sort((a, b) => (a.id === "fix_it" ? -1 : b.id === "fix_it" ? 1 : 0));
      } else if (userPreferences?.actionOrderPreset === "explain_first") {
        actions.sort((a, b) => (a.id.startsWith("explain") ? -1 : b.id.startsWith("explain") ? 1 : 0));
      } else if (userPreferences?.actionOrderPreset === "productivity_first") {
        const orderWeight = { fix_it: 1, generate_reply: 2, translate: 3, summarize: 4 };
        actions.sort((a, b) => (orderWeight[a.id] || 99) - (orderWeight[b.id] || 99));
      }

      mxContextTypeBadge.innerHTML = badgeHtml;

      let pillsHtml = "";
      actions.forEach((act, idx) => {
        const activeCls = idx === 0 ? " active" : "";
        pillsHtml += `<button type="button" class="mx-context-pill${activeCls}" data-action="${act.id}" data-sub="${act.isSubpanel || ""}" data-util="${act.isUtility ? "true" : "false"}">${act.label}</button>`;
      });
      mxContextPillsGrid.innerHTML = pillsHtml;

      mxContextPillsGrid.querySelectorAll(".mx-context-pill").forEach(pillBtn => {
        pillBtn.addEventListener("click", () => {
          const actId = pillBtn.getAttribute("data-action");
          const subType = pillBtn.getAttribute("data-sub");
          const isUtil = pillBtn.getAttribute("data-util") === "true";

          mxContextPillsGrid.querySelectorAll(".mx-context-pill").forEach(p => p.classList.remove("active"));
          pillBtn.classList.add("active");

          if (subType === "translate") {
            toggleTakeActionSubpanel("translate");
            return;
          }
          if (subType === "reply") {
            toggleTakeActionSubpanel("reply");
            return;
          }

          if (actId === "search") {
            const query = (currentContext.text || window.getSelection()?.toString() || "").trim();
            if (query) {
              window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank");
            }
            return;
          }

          if (actId === "open_url") {
            let targetUrl = (currentContext.text || window.getSelection()?.toString() || "").trim();
            if (targetUrl) {
              if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
                targetUrl = "https://" + targetUrl;
              }
              window.open(targetUrl, "_blank");
            }
            return;
          }

          if (actId === "copy") {
            const textToCopy = (currentContext.text || window.getSelection()?.toString() || "").trim();
            if (textToCopy) {
              copyToClipboard(textToCopy).then(success => {
                const prev = pillBtn.textContent;
                pillBtn.textContent = success ? "✓ Copied!" : "✓ Selected";
                setTimeout(() => { pillBtn.textContent = prev; }, 1400);
              });
            }
            return;
          }

          currentActionId = actId;
          const found = actions.find(a => a.id === actId);
          currentActionPrompt = found?.prompt || "";
          runTriggerFlow();
        });
      });
    }

    // ── Multi-Copy Helpers ────────────────────────────────────────────────────
    function addMultiCopyItem(text) {
      if (!text || !text.trim()) return false;
      const clean = text.trim();
      temporaryContext.selections.push(clean);
      renderMultiCopyItems();
      return true;
    }

    function removeMultiCopyItem(index) {
      if (index >= 0 && index < temporaryContext.selections.length) {
        temporaryContext.selections.splice(index, 1);
        renderMultiCopyItems();
      }
    }

    function clearMultiCopyContext() {
      temporaryContext.selections = [];
      renderMultiCopyItems();
      statusTitle.textContent = "Status: Multi-Copy context cleared.";
      if (mxClearSubpanel) mxClearSubpanel.style.display = "none";
      if (mxBtnClearMulti) mxBtnClearMulti.classList.remove("active");
    }

    function renderMultiCopyItems() {
      const count = temporaryContext.selections.length;
      if (mxMultiCopyBadge) {
        mxMultiCopyBadge.textContent = count;
        mxMultiCopyBadge.style.display = count > 0 ? "inline-flex" : "none";
      }
      if (mxMultiCopyCountText) {
        mxMultiCopyCountText.textContent = `${count} item${count === 1 ? "" : "s"} collected`;
      }
      if (!mxMultiCopyList) return;
      if (count === 0) {
        mxMultiCopyList.innerHTML = `<div class="mx-empty-hint">No items collected yet. Highlight text and click "+ Add Selection" or "Multi-Copy" to aggregate context.</div>`;
        return;
      }
      let html = "";
      temporaryContext.selections.forEach((selText, idx) => {
        const snippet = selText.replace(/\s+/g, " ").trim();
        const displaySnippet = snippet.length > 80 ? snippet.slice(0, 80) + "..." : snippet;
        html += `
          <div class="mx-multicopy-item">
            <span class="mx-multicopy-num">${idx + 1}.</span>
            <span class="mx-multicopy-text" title="${escapeHtml(snippet)}">${escapeHtml(displaySnippet)}</span>
            <button type="button" class="mx-multicopy-del-btn" data-idx="${idx}" title="Remove this selection">✕</button>
          </div>
        `;
      });
      mxMultiCopyList.innerHTML = html;
      mxMultiCopyList.querySelectorAll(".mx-multicopy-del-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute("data-idx"), 10);
          removeMultiCopyItem(idx);
        });
      });
    }

    function toggleTakeActionSubpanel(name) {
      const subpanels = {
        multicopy: mxMultiCopySubpanel,
        clear: mxClearSubpanel,
        reply: mxReplySubpanel,
        translate: mxTranslateSubpanel
      };

      const pills = {
        multicopy: mxBtnMultiCopy,
        clear: mxBtnClearMulti,
        reply: mxBtnGenReply,
        translate: mxBtnTranslate
      };

      const target = subpanels[name];
      const isCurrentlyOpen = target && target.style.display !== "none";

      Object.keys(subpanels).forEach(k => {
        if (subpanels[k]) subpanels[k].style.display = "none";
        if (pills[k]) pills[k].classList.remove("active");
      });

      if (!isCurrentlyOpen && target) {
        target.style.display = "block";
        if (pills[name]) pills[name].classList.add("active");

        if (name === "multicopy") {
          renderMultiCopyItems();
        } else if (name === "clear") {
          const count = temporaryContext.selections.length;
          if (mxClearPromptText) {
            mxClearPromptText.textContent = `Clear ${count} collected selection${count === 1 ? "" : "s"}?`;
          }
        }
      }
    }

    // ── Take Action Event Wiring ──────────────────────────────────────────────
    if (mxBtnMultiCopy) {
      mxBtnMultiCopy.addEventListener("click", () => {
        const sel = (currentContext.text || window.getSelection()?.toString() || "").trim();
        if (sel && (!temporaryContext.selections.length || temporaryContext.selections[temporaryContext.selections.length - 1] !== sel)) {
          addMultiCopyItem(sel);
        }
        toggleTakeActionSubpanel("multicopy");
      });
    }

    if (mxAddSelectionBtn) {
      mxAddSelectionBtn.addEventListener("click", async () => {
        let sel = (window.getSelection()?.toString() || currentContext.text || "").trim();
        if (!sel && navigator.clipboard?.readText) {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip && clip.trim().length >= 2) sel = clip.trim();
          } catch {}
        }
        if (sel) {
          addMultiCopyItem(sel);
          statusTitle.textContent = `Added selection to Multi-Copy (${temporaryContext.selections.length} total)`;
        } else {
          statusTitle.textContent = "No text currently selected to add";
        }
      });
    }

    if (mxAskCursivBtn) {
      mxAskCursivBtn.addEventListener("click", () => {
        const promptText = (mxMultiCopyPrompt ? mxMultiCopyPrompt.value : "").trim();
        if (temporaryContext.selections.length === 0) {
          statusTitle.textContent = "Please add at least one selection to Multi-Copy first";
          return;
        }
        currentActionId = "multi_copy_prompt";
        currentActionPrompt = promptText || "Analyze and explain these collected selections together:";
        runTriggerFlow();
      });
    }

    if (mxBtnClearMulti) {
      mxBtnClearMulti.addEventListener("click", () => {
        toggleTakeActionSubpanel("clear");
      });
    }

    if (mxConfirmClearBtn) {
      mxConfirmClearBtn.addEventListener("click", () => {
        clearMultiCopyContext();
      });
    }

    if (mxCancelClearBtn) {
      mxCancelClearBtn.addEventListener("click", () => {
        if (mxClearSubpanel) mxClearSubpanel.style.display = "none";
        if (mxBtnClearMulti) mxBtnClearMulti.classList.remove("active");
      });
    }

    if (mxBtnGenReply) {
      mxBtnGenReply.addEventListener("click", () => {
        toggleTakeActionSubpanel("reply");
      });
    }

    if (mxRunGenerateReplyBtn) {
      mxRunGenerateReplyBtn.addEventListener("click", () => {
        currentActionId = "generate_reply";
        runTriggerFlow();
      });
    }

    if (mxBtnTranslate) {
      mxBtnTranslate.addEventListener("click", () => {
        toggleTakeActionSubpanel("translate");
      });
    }

    if (mxRunTranslateBtn) {
      mxRunTranslateBtn.addEventListener("click", () => {
        currentActionId = "translate";
        runTriggerFlow();
      });
    }

    // ── Status Action Tool Buttons Wiring ──────────────────────────────────────
    if (mxRegenBtn) {
      mxRegenBtn.addEventListener("click", () => {
        runTriggerFlow();
      });
    }

    if (mxChangeLangBtn) {
      mxChangeLangBtn.addEventListener("click", () => {
        toggleTakeActionSubpanel("translate");
        if (mxTargetLangSelect) mxTargetLangSelect.focus();
      });
    }

    if (mxEditResultBtn) {
      mxEditResultBtn.addEventListener("click", () => {
        const currentText = currentRawResult || (resultBody ? resultBody.innerText : "");
        resultBody.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <textarea class="mx-editable-result-area" id="mxEditableArea" rows="6">${escapeHtml(currentText)}</textarea>
            <div style="display:flex;justify-content:flex-end;gap:6px;">
              <button type="button" class="mx-btn-sub-cancel" id="mxCancelEditBtn">Cancel</button>
              <button type="button" id="mxSaveEditBtn" style="background:rgba(0,150,199,0.35);border:1px solid #5EEBFF;color:#fff;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;">✓ Done Editing</button>
            </div>
          </div>
        `;
        const saveBtn = resultBody.querySelector("#mxSaveEditBtn");
        const cancelBtn = resultBody.querySelector("#mxCancelEditBtn");
        const editArea = resultBody.querySelector("#mxEditableArea");
        if (saveBtn && editArea) {
          saveBtn.addEventListener("click", () => {
            currentRawResult = editArea.value;
            activeChatContextText = editArea.value;
            renderFormattedResponse(resultBody, currentRawResult);
          });
        }
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            renderFormattedResponse(resultBody, currentRawResult);
          });
        }
      });
    }

    // Dragging for MX Console (Robust Pointer Capture & Boundary Clamped)
    let isConsoleDragging = false;
    let consoleDragStartX = 0, consoleDragStartY = 0, consoleWinStartX = 0, consoleWinStartY = 0;

    function startConsoleDrag(e) {
      if (e.target === closeBtn || closeBtn?.contains(e.target) || e.target === mxMaximizeBtn || mxMaximizeBtn?.contains(e.target)) return;
      if (e.button !== undefined && e.button !== 0) return;

      if (currentEmergenceAnim) {
        currentEmergenceAnim.cancel();
        currentEmergenceAnim = null;
      }
      isConsoleDragging = true;
      consoleDragStartX = e.clientX;
      consoleDragStartY = e.clientY;
      const rect = consoleEl.getBoundingClientRect();
      consoleWinStartX = rect.left;
      consoleWinStartY = rect.top;

      try {
        if (e.pointerId && headerCard.setPointerCapture) {
          headerCard.setPointerCapture(e.pointerId);
        }
      } catch {}
      e.preventDefault();
    }

    function moveConsoleDrag(e) {
      if (!isConsoleDragging) return;
      const newLeft = Math.max(0, Math.min(window.innerWidth - 120, consoleWinStartX + (e.clientX - consoleDragStartX)));
      const newTop = Math.max(0, Math.min(window.innerHeight - 60, consoleWinStartY + (e.clientY - consoleDragStartY)));
      consoleEl.style.left = `${newLeft}px`;
      consoleEl.style.top = `${newTop}px`;
    }

    function stopConsoleDrag(e) {
      if (!isConsoleDragging) return;
      isConsoleDragging = false;
      try {
        if (e && e.pointerId && headerCard.releasePointerCapture) {
          headerCard.releasePointerCapture(e.pointerId);
        }
      } catch {}
      if (userPreferences?.popupPosition === "remember" && isExtensionValid()) {
        const lastPos = { left: consoleEl.offsetLeft, top: consoleEl.offsetTop };
        userPreferences.lastConsolePos = lastPos;
        chrome.storage?.local?.set?.({ lastConsolePos: lastPos })?.catch?.(() => {});
      }
    }

    headerCard.addEventListener("pointerdown", startConsoleDrag);
    headerCard.addEventListener("pointermove", moveConsoleDrag);
    headerCard.addEventListener("pointerup", stopConsoleDrag);
    headerCard.addEventListener("pointercancel", stopConsoleDrag);

    headerCard.addEventListener("mousedown", startConsoleDrag);
    headerCard.addEventListener("mouseup", stopConsoleDrag);
    consoleEl.addEventListener("mouseup", stopConsoleDrag);
    window.addEventListener("mousemove", moveConsoleDrag);
    window.addEventListener("mouseup", stopConsoleDrag, true);

    // Expand / Restore feature for MX Console
    let isConsoleMaximized = false;
    let preMaxConsoleBounds = null;

    if (mxMaximizeBtn) {
      mxMaximizeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        isConsoleMaximized = !isConsoleMaximized;
        if (isConsoleMaximized) {
          preMaxConsoleBounds = {
            width: consoleEl.style.width,
            top: consoleEl.style.top,
            left: consoleEl.style.left
          };
          const targetW = Math.min(760, window.innerWidth - 32);
          const targetLeft = Math.max(16, Math.round((window.innerWidth - targetW) / 2));

          consoleEl.classList.add("maximized");
          consoleEl.style.width = `${targetW}px`;
          consoleEl.style.left = `${targetLeft}px`;
          mxMaximizeBtn.textContent = "🗗";
          mxMaximizeBtn.title = "Restore window";
        } else {
          consoleEl.classList.remove("maximized");
          if (preMaxConsoleBounds && preMaxConsoleBounds.width) {
            consoleEl.style.width = preMaxConsoleBounds.width;
            consoleEl.style.left = preMaxConsoleBounds.left;
            consoleEl.style.top = preMaxConsoleBounds.top;
          } else {
            consoleEl.style.width = "440px";
          }
          mxMaximizeBtn.textContent = "⛶";
          mxMaximizeBtn.title = "Expand window";
        }
      });
    }

    // Dragging for separate Chatbot Window (both normal & expanded/maximized)
    let isChatDragging = false;
    let chatDragStartX = 0, chatDragStartY = 0, chatWinStartX = 0, chatWinStartY = 0;

    function startChatDrag(e) {
      if (e.target === chatbotCloseBtn || e.target === chatbotClearBtn || e.target === chatbotMaximizeBtn || e.target === chatbotNewChatBtn || e.target === chatbotHistoryBtn || chatbotHistoryBtn?.contains(e.target)) return;
      isChatDragging = true;
      chatDragStartX = e.clientX;
      chatDragStartY = e.clientY;
      const rect = chatbotWin.getBoundingClientRect();
      chatWinStartX = rect.left;
      chatWinStartY = rect.top;

      try {
        if (e.pointerId && chatbotHeader.setPointerCapture) {
          chatbotHeader.setPointerCapture(e.pointerId);
        }
      } catch {}
      e.preventDefault();
    }

    function moveChatDrag(e) {
      if (!isChatDragging) return;
      const newLeft = Math.max(0, Math.min(window.innerWidth - 120, chatWinStartX + (e.clientX - chatDragStartX)));
      const newTop = Math.max(0, Math.min(window.innerHeight - 60, chatWinStartY + (e.clientY - chatDragStartY)));
      chatbotWin.style.left = `${newLeft}px`;
      chatbotWin.style.top = `${newTop}px`;
    }

    function stopChatDrag(e) {
      if (!isChatDragging) return;
      isChatDragging = false;
      try {
        if (e && e.pointerId && chatbotHeader.releasePointerCapture) {
          chatbotHeader.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }

    chatbotHeader.addEventListener("pointerdown", startChatDrag);
    chatbotHeader.addEventListener("pointermove", moveChatDrag);
    chatbotHeader.addEventListener("pointerup", stopChatDrag);
    chatbotHeader.addEventListener("pointercancel", stopChatDrag);

    chatbotHeader.addEventListener("mousedown", startChatDrag);
    window.addEventListener("mousemove", moveChatDrag);
    window.addEventListener("mouseup", stopChatDrag);

    // Close buttons
    closeBtn.addEventListener("click", () => { consoleEl.style.display = "none"; });
    exitBtn.addEventListener("click", () => { consoleEl.style.display = "none"; });
    chatbotCloseBtn.addEventListener("click", () => { chatbotWin.style.display = "none"; });

    // ── Robust Dual-Strategy Clipboard Helper ───────────────────────────────────
    async function copyToClipboard(text) {
      if (!text) return false;

      // Strategy 1: Modern Async Clipboard API
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (err) {
          console.warn("navigator.clipboard.writeText failed, trying execCommand fallback:", err);
        }
      }

      // Strategy 2: Off-screen textarea with document.execCommand('copy')
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "0";
        textarea.style.width = "2em";
        textarea.style.height = "2em";
        textarea.style.padding = "0";
        textarea.style.border = "none";
        textarea.style.outline = "none";
        textarea.style.boxShadow = "none";
        textarea.style.background = "transparent";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        textarea.style.zIndex = "-9999";

        const targetParent = document.body || document.documentElement;
        targetParent.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const successful = document.execCommand("copy");
        targetParent.removeChild(textarea);
        if (successful) return true;
      } catch (fallbackErr) {
        console.warn("document.execCommand fallback failed:", fallbackErr);
      }

      return false;
    }

    // Copy Result text action
    copyBtn.addEventListener("click", async () => {
      const textToCopy = currentRawResult || (resultBody ? resultBody.innerText : "") || (currentContext.text || "");
      if (!textToCopy) {
        copyBtn.textContent = "⚠️ No text";
        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1400);
        return;
      }
      const success = await copyToClipboard(textToCopy);
      copyBtn.textContent = success ? "✓ Copied!" : "✓ Selected";
      setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1400);
    });

    // Copy to Chatbot Button Action (Opens separate chatbot popup!)
    mxCopyToChatBtn.addEventListener("click", async () => {
      const textToCopy = currentRawResult || (resultBody ? resultBody.innerText : "") || currentContext.text || "";
      mxCopyToChatBtn.textContent = "✓ Sent to Chatbot!";
      setTimeout(() => { mxCopyToChatBtn.textContent = "💬 Copy to Chatbot"; }, 1500);

      const combined = (currentContext.text && currentRawResult && currentContext.text !== currentRawResult)
        ? `Question / Context:\n${currentContext.text}\n\nSolution / Answer:\n${currentRawResult}`
        : textToCopy;

      if (combined) {
        await copyToClipboard(combined);
      }

      openChatbotWindow(combined || null);
    });

    // Trigger Button Click -> Runs Groq
    btnTrigger.addEventListener("click", () => {
      runTriggerFlow();
    });

    // Take Action Button -> Opens / Focuses Redesigned Take Action Panel
    btnTakeAction.addEventListener("click", () => {
      if (mxTakeActionCard) {
        mxTakeActionCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const sel = (currentContext.text || window.getSelection()?.toString() || "").trim();
        if (sel && (!temporaryContext.selections.length || temporaryContext.selections[temporaryContext.selections.length - 1] !== sel)) {
          addMultiCopyItem(sel);
        }
        toggleTakeActionSubpanel("multicopy");
      }
    });

    // Hold to Talk (Speech Recognition)
    let speechRec = null;
    let isSpeaking = false;
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechConstructor) {
      speechRec = new SpeechConstructor();
      speechRec.continuous = false;
      speechRec.interimResults = true;
      speechRec.lang = "en-US";

      speechRec.onresult = (e) => {
        let transcript = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          transcript += e.results[i][0].transcript;
        }
        transcript = transcript.trim();
        statusTitle.textContent = `🎙 Heard: "${transcript}"`;
        currentContext.voicePrompt = transcript;
        contextPreview.style.display = "block";
        const hasText = Boolean(currentContext.text && currentContext.text.trim());
        if (hasText) {
          contextPreview.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div><strong>Text Input:</strong> ${escapeHtml(currentContext.text.slice(0, 110))}${currentContext.text.length > 110 ? "..." : ""}</div>
              <div style="color: #5EEBFF;"><strong>🎙 Voice Command:</strong> "${escapeHtml(transcript)}"</div>
            </div>
          `;
        } else {
          contextPreview.innerHTML = `<div><strong>🎙 Voice Query:</strong> "${escapeHtml(transcript)}"</div>`;
        }
      };

      speechRec.onend = () => {
        isSpeaking = false;
        btnVoice.classList.remove("recording");
        btnVoice.innerHTML = "🎙 Hold to Talk";
        if (currentContext.voicePrompt) {
          runTriggerFlow();
        }
      };

      speechRec.onerror = (e) => {
        isSpeaking = false;
        btnVoice.classList.remove("recording");
        btnVoice.innerHTML = "🎙 Hold to Talk";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          showInPageMicPermissionPrompt();
        } else {
          statusTitle.textContent = `Mic status: ${e.error || "unavailable"}`;
        }
      };

      function showInPageMicPermissionPrompt() {
        statusTitle.innerHTML = `⚠️ Mic permission needed. <a href="#" id="corsiriEnableMicLink" style="color:#5EEBFF;text-decoration:underline;cursor:pointer;font-weight:600;">Enable Mic</a>`;
        const link = consoleEl.querySelector("#corsiriEnableMicLink");
        if (link) {
          link.addEventListener("click", (evt) => {
            evt.preventDefault();
            chrome.runtime.sendMessage({ type: "corsiri_open_mic_permission" });
          });
        }
        if (resultBody) {
          resultBody.innerHTML = `
            <div style="padding: 16px 12px; text-align: center;">
              <div style="font-size: 28px; margin-bottom: 6px;">🎙️</div>
              <strong style="color: #5EEBFF; font-size: 13.5px;">Microphone Permission Needed</strong>
              <p style="font-size: 12px; margin-top: 6px; color: #D6EFFF; line-height: 1.55;">
                Chrome requires you to grant microphone permission once before speech recognition can listen.
              </p>
              <button id="corsiriOpenMicBtn" style="margin-top: 12px; background: linear-gradient(135deg, #00C6FF, #0072FF); border: none; color: #fff; font-weight: 600; padding: 9px 18px; border-radius: 9px; cursor: pointer; font-size: 12.5px; box-shadow: 0 2px 12px rgba(0, 114, 255, 0.45); display: inline-flex; align-items: center; gap: 6px;">
                🎙️ Grant Microphone Access
              </button>
            </div>
          `;
          const btn = consoleEl.querySelector("#corsiriOpenMicBtn");
          if (btn) {
            btn.addEventListener("click", () => {
              chrome.runtime.sendMessage({ type: "corsiri_open_mic_permission" });
            });
          }
        }
      }

      btnVoice.addEventListener("mousedown", async () => {
        try {
          if (!currentContext.text || !currentContext.text.trim()) {
            const sel = window.getSelection()?.toString().trim();
            if (sel && sel.length >= 2) {
              currentContext.text = sel;
            } else if (navigator.clipboard?.readText) {
              try {
                const clip = await navigator.clipboard.readText();
                if (clip && clip.trim().length >= 2) currentContext.text = clip.trim();
              } catch {}
            }
          }

          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              stream.getTracks().forEach(track => track.stop());
            } catch (mediaErr) {
              if (mediaErr.name === "NotAllowedError" || mediaErr.name === "PermissionDeniedError") {
                showInPageMicPermissionPrompt();
                return;
              }
            }
          }

          currentContext.voicePrompt = "";
          isSpeaking = true;
          btnVoice.classList.add("recording");
          btnVoice.innerHTML = "🔴 Listening...";
          speechRec.start();
        } catch {
          showInPageMicPermissionPrompt();
        }
      });

      btnVoice.addEventListener("mouseup", () => {
        if (isSpeaking) {
          try { speechRec.stop(); } catch {}
        }
      });
    } else {
      btnVoice.addEventListener("click", () => {
        statusTitle.textContent = "Web Speech API not supported in this browser.";
      });
    }

    // Image Selection / Snipping Tool
    btnImage.addEventListener("click", () => {
      startSnippingTool();
    });

    // ── Separate Chatbot Popup Logic ─────────────────────────────────────────

    // Open separate Chatbot popup from Trigger Surface button
    btnOpenChatbot.addEventListener("click", () => {
      let selectedText = window.getSelection()?.toString().trim() || "";
      if (!selectedText && currentContext.type === "text" && currentContext.text) {
        selectedText = currentContext.text.trim();
      }
      openChatbotWindow(selectedText || null);
    });

    // Directly copy browser selected text to Chatbot from Trigger Surface
    btnCopyTextToChatbot.addEventListener("click", async () => {
      let selectedText = window.getSelection()?.toString().trim() || "";
      if (!selectedText && currentContext.type === "text" && currentContext.text) {
        selectedText = currentContext.text.trim();
      }
      if (!selectedText && navigator.clipboard?.readText) {
        try {
          const clip = await navigator.clipboard.readText();
          if (clip && clip.trim().length >= 2) selectedText = clip.trim();
        } catch {}
      }

      if (!selectedText) {
        btnCopyTextToChatbot.textContent = "⚠️ No text selected";
        setTimeout(() => {
          btnCopyTextToChatbot.textContent = "📋 Copy to Chatbot";
        }, 1400);
        return;
      }

      btnCopyTextToChatbot.textContent = "✓ Copied to Chat!";
      setTimeout(() => {
        btnCopyTextToChatbot.textContent = "📋 Copy to Chatbot";
      }, 1400);

      await copyToClipboard(selectedText);
      openChatbotWindow(selectedText);
    });

    function openChatbotWindow(copiedContext = null) {
      loadChatHistoryLazily().then(() => {
        if (copiedContext && copiedContext.trim()) {
          // If current conversation already has messages, start a fresh conversation session for the new context
          if (chatConversationHistory.length > 0) {
            createNewChatSession(copiedContext.trim());
          } else {
            activeChatContextText = copiedContext.trim();
            chatbotRefBanner.style.display = "flex";
            chatbotRefText.textContent = `📌 Context: ${copiedContext.replace(/\s+/g, " ").slice(0, 65)}...`;

            const contextAnnouncement = {
              role: "assistant",
              content: `📌 **Loaded Selected Text:**\n"${copiedContext.slice(0, 260)}${copiedContext.length > 260 ? "..." : ""}"\n\nAsk any question, or type **answer** / **solve** to get the complete solution.`
            };
            chatConversationHistory.push(contextAnnouncement);
            renderSingleChatMessage(contextAnnouncement);
            saveChatHistory();
          }
        }
      });

      const targetWidth = Math.min(640, window.innerWidth - 40);
      const targetHeight = Math.min(720, window.innerHeight - 50);
      const top = Math.max(20, Math.min(window.innerHeight - targetHeight - 20, 50));
      const left = Math.max(20, window.innerWidth - targetWidth - 30);

      chatbotWin.style.width = `${targetWidth}px`;
      chatbotWin.style.height = `${targetHeight}px`;
      chatbotWin.style.top = `${top}px`;
      chatbotWin.style.left = `${left}px`;
      chatbotWin.style.display = "flex";

      if (enableTextEmerge) {
        const sourceRect = getActiveSourceRect() || (consoleEl && consoleEl.style.display !== "none" ? consoleEl.getBoundingClientRect() : null);
        if (sourceRect) {
          animateEmergenceFromRect(chatbotWin, sourceRect);
        }
      }

      chatbotInput.focus();
    }

    // Chatbot New Chat and History toggle handlers
    if (chatbotNewChatBtn) chatbotNewChatBtn.addEventListener("click", () => createNewChatSession());
    if (historyNewChatBtn) historyNewChatBtn.addEventListener("click", () => createNewChatSession());
    if (chatbotHistoryBtn) chatbotHistoryBtn.addEventListener("click", () => toggleHistoryPanel());
    if (historyCloseBtn) historyCloseBtn.addEventListener("click", () => toggleHistoryPanel(false));
    if (historyClearAllBtn) historyClearAllBtn.addEventListener("click", clearAllChatHistory);

    // Close history panel when clicking outside inside chatbot window
    chatbotWin.addEventListener("click", (e) => {
      if (!chatbotHistoryPanel || chatbotHistoryPanel.style.display !== "flex") return;
      if (chatbotHistoryPanel.contains(e.target) || chatbotHistoryBtn?.contains(e.target)) return;
      toggleHistoryPanel(false);
    });

    chatbotRefDismiss.addEventListener("click", () => {
      activeChatContextText = "";
      chatbotRefBanner.style.display = "none";
      if (currentSessionId) {
        const curr = chatSessions.find(s => s.id === currentSessionId);
        if (curr) curr.contextText = "";
        saveChatHistory();
      }
    });

    chatbotClearBtn.addEventListener("click", () => {
      chatConversationHistory = [];
      if (currentSessionId) {
        const curr = chatSessions.find(s => s.id === currentSessionId);
        if (curr) {
          curr.messages = [];
          curr.updatedAt = Date.now();
        }
      }
      saveChatHistory();
      chatbotMessagesList.innerHTML = `
        <div style="text-align: center; color: #8FA6B8; font-size: 12.5px; padding: 26px 10px;">
          <div style="font-size: 28px; margin-bottom: 8px;">💬</div>
          <strong style="color: #5EEBFF; font-size: 14px;">Conversation Cleared</strong>
          <p style="margin-top: 6px; font-size: 12px;">Start a new topic or use "Copy to Chatbot" from any explanation.</p>
        </div>
      `;
    });

    async function sendChatMessage(userText) {
      if ((!userText || !userText.trim()) && !activeAttachedImageUrl) return;
      if (isChatLoading) return;

      const attachedImage = activeAttachedImageUrl;
      activeAttachedImageUrl = null;
      renderChatbotImageAttachment();

      const finalUserText = (userText && userText.trim())
        ? userText.trim()
        : (attachedImage ? "Analyze, solve, and explain this image." : "");

      if (!isExtensionValid()) {
        renderSingleChatMessage({
          role: "assistant",
          content: "⚠️ The extension was updated in the browser. Please refresh this tab (F5 or Ctrl+R) to reconnect."
        });
        return;
      }

      isChatLoading = true;
      chatbotSendBtn.disabled = true;

      // Hide placeholder if any
      const placeholder = chatbotMessagesList.querySelector("#chatbotWelcomeMsg");
      if (placeholder) placeholder.remove();

      const userMsg = {
        role: "user",
        content: finalUserText,
        imageUrl: attachedImage || null
      };
      chatConversationHistory.push(userMsg);
      renderSingleChatMessage(userMsg);
      saveChatHistory();

      chatbotInput.value = "";
      chatbotInput.style.height = "auto";

      // Typing indicator
      const typingEl = document.createElement("div");
      typingEl.className = "chatbot-msg-wrapper assistant";
      typingEl.innerHTML = `
        <div class="chatbot-msg-bubble assistant" style="display:flex;align-items:center;gap:8px;">
          <div class="corsiri-spin-circle" style="width:14px;height:14px;"></div>
          <span>Reasoning with Groq${attachedImage ? " Vision" : ""}...</span>
        </div>
      `;
      chatbotMessagesList.appendChild(typingEl);
      chatbotMessagesList.scrollTop = chatbotMessagesList.scrollHeight;

      let chatDone = false;
      const chatTimeout = setTimeout(() => {
        if (chatDone) return;
        chatDone = true;
        typingEl.remove();
        isChatLoading = false;
        chatbotSendBtn.disabled = false;
        renderSingleChatMessage({
          role: "assistant",
          content: "⚠️ Request timed out. Groq took longer than expected to respond. Please try again."
        });
      }, attachedImage ? 25000 : 18000);

      // Prepare payload: if user typed a short keyword like "answer" / "solve", map it to the active context!
      const messagesPayload = chatConversationHistory.map((m, idx) => {
        if (idx === chatConversationHistory.length - 1 && activeChatContextText && /^(answer|ans|solve|solution|explain|what is the answer|solve this)$/i.test(m.content.trim())) {
          return {
            role: "user",
            content: `Please provide the direct, complete solution and answers for this active context:\n"${activeChatContextText}"`
          };
        }
        return m;
      });

      try {
        chrome.runtime.sendMessage({
          type: "corsiri_chat_query",
          messages: messagesPayload,
          contextText: activeChatContextText || currentContext.text || "",
          imageUrl: attachedImage || null
        }, (res) => {
          if (chatDone) return;
          chatDone = true;
          clearTimeout(chatTimeout);

          typingEl.remove();
          isChatLoading = false;
          chatbotSendBtn.disabled = false;

          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            renderSingleChatMessage({
              role: "assistant",
              content: `⚠️ Extension communication error: ${lastErr.message || "Failed to communicate with background. Please refresh page (F5)."}`
            });
            return;
          }

          if (res && res.ok) {
            const assistantMsg = { role: "assistant", content: res.reply };
            chatConversationHistory.push(assistantMsg);
            renderSingleChatMessage(assistantMsg, res.model);
            saveChatHistory();
          } else {
            const errMsg = { role: "assistant", content: `⚠️ Error: ${res?.error || "Failed to reach Groq AI."}` };
            renderSingleChatMessage(errMsg);
          }
        });
      } catch (err) {
        if (chatDone) return;
        chatDone = true;
        clearTimeout(chatTimeout);
        typingEl.remove();
        isChatLoading = false;
        chatbotSendBtn.disabled = false;
        renderSingleChatMessage({
          role: "assistant",
          content: "⚠️ The extension was updated. Please refresh this tab (F5) to reconnect."
        });
      }
    }

    chatbotSendBtn.addEventListener("click", () => {
      sendChatMessage(chatbotInput.value.trim());
    });

    chatbotInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage(chatbotInput.value.trim());
      }
    });

    chatbotInput.addEventListener("input", () => {
      chatbotInput.style.height = "auto";
      chatbotInput.style.height = Math.min(chatbotInput.scrollHeight, 100) + "px";
    });

    chatbotWin.querySelectorAll(".chatbot-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const query = chip.getAttribute("data-query");
        if (query) {
          sendChatMessage(query);
        }
      });
    });

    function renderSingleChatMessage(msg, model = "") {
      const wrapper = document.createElement("div");
      wrapper.className = `chatbot-msg-wrapper ${msg.role}`;

      const bubble = document.createElement("div");
      bubble.className = `chatbot-msg-bubble ${msg.role}`;

      if (msg.role === "user") {
        if (msg.imageUrl) {
          const imgWrap = document.createElement("div");
          imgWrap.style.cssText = "margin-bottom: 6px;";
          const imgEl = document.createElement("img");
          imgEl.src = msg.imageUrl;
          imgEl.alt = "Attached Screen Image";
          imgEl.style.cssText = "max-height: 120px; max-width: 200px; border-radius: 6px; border: 1px solid rgba(94, 235, 255, 0.45); cursor: pointer; display: block; object-fit: contain; background: #0b141e;";
          imgEl.title = "Click to zoom";
          imgEl.addEventListener("click", () => showFullImageModal(msg.imageUrl));
          imgWrap.appendChild(imgEl);
          bubble.appendChild(imgWrap);
        }
        const textSpan = document.createElement("span");
        textSpan.textContent = msg.content;
        bubble.appendChild(textSpan);
      } else {
        renderFormattedResponse(bubble, msg.content);

        const meta = document.createElement("div");
        meta.className = "chatbot-msg-meta";
        meta.innerHTML = `<span>${model ? `Groq (${model})` : "Groq AI"}</span>`;

        const copyMsgBtn = document.createElement("button");
        copyMsgBtn.className = "chatbot-copy-msg-btn";
        copyMsgBtn.textContent = "📋 Copy";
        copyMsgBtn.addEventListener("click", async () => {
          const success = await copyToClipboard(msg.content);
          copyMsgBtn.textContent = success ? "✓ Copied" : "✓ Selected";
          setTimeout(() => { copyMsgBtn.textContent = "📋 Copy"; }, 1400);
        });
        meta.appendChild(copyMsgBtn);
        bubble.appendChild(meta);
      }

      wrapper.appendChild(bubble);
      chatbotMessagesList.appendChild(wrapper);
      chatbotMessagesList.scrollTop = chatbotMessagesList.scrollHeight;
    }

    function renderAllChatMessages() {
      chatbotMessagesList.innerHTML = "";
      chatConversationHistory.forEach(msg => {
        renderSingleChatMessage(msg);
      });
    }

    // ── Open Console Helpers ──────────────────────────────────────────────────

    function openConsoleWithText(text, statusHint = "Context loaded", autoRun = false, sourceRect = null) {
      const cleanText = text || "";
      currentContext = {
        type: "text",
        text: cleanText,
        imageUrl: ""
      };
      statusTitle.textContent = `Status: ${statusHint}`;
      if (cleanText && cleanText.trim()) {
        contextPreview.style.display = "block";
        contextPreview.innerHTML = `<strong>Text Context:</strong> ${escapeHtml(cleanText.slice(0, 140))}${cleanText.length > 140 ? "..." : ""}`;
      } else {
        contextPreview.style.display = "none";
      }

      // Context Awareness: classify selection and update dynamic action pills
      const detectedType = classifySelectedContent(cleanText, false);
      temporaryContext.contentType = detectedType;
      updateContextualActions(detectedType, cleanText);

      const rect = sourceRect || getActiveSourceRect();
      showConsole(rect);

      if ((autoRun && cleanText && cleanText.trim()) || modeSelect.value === "smart") {
        runTriggerFlow();
      }
    }

    function openConsoleWithImage(dataUrl, statusHint = "Image region captured") {
      currentContext = {
        type: "image",
        text: "",
        voicePrompt: "",
        imageUrl: dataUrl
      };

      // Context Awareness for Image
      temporaryContext.contentType = "image";
      updateContextualActions("image", "");

      statusTitle.textContent = `Status: ${statusHint}`;
      contextPreview.style.display = "block";
      contextPreview.innerHTML = `
        <div class="mx-img-studio">
          <div class="mx-img-studio-top">
            <div class="mx-img-thumb-wrap" id="mxImgThumbWrap" title="Click to view full preview">
              <img src="${dataUrl}" class="mx-img-thumb" alt="Captured Region" />
              <span class="mx-img-zoom-hint">🔍 Zoom</span>
            </div>
            <div class="mx-img-info">
              <div class="mx-img-badge-row">
                <span class="mx-img-badge">📸 Captured Screen Region</span>
                <div style="display:flex;gap:4px;">
                  <button type="button" class="mx-img-resnip-btn" id="mxImgResnipBtn" title="Re-crop image">🔄 Re-snip</button>
                  <button type="button" class="mx-img-resnip-btn" id="mxImgSendToChatBtn" title="Send to Chatbot">💬 Chat</button>
                </div>
              </div>
              <div class="mx-img-desc">Type question or hold <strong>🎙️ Voice</strong> to command Groq Vision AI on this image.</div>
            </div>
          </div>

          <div class="mx-img-input-box">
            <div class="mx-img-input-row">
              <input type="text" id="mxImgTextInput" class="mx-img-text-input" placeholder="Type question/command for this image (or leave blank for direct answer)..." />
              <button type="button" id="mxImgVoiceBtn" class="mx-img-voice-btn" title="Hold to speak voice command">🎙️ Voice</button>
              <button type="button" id="mxImgSubmitBtn" class="mx-img-submit-btn" title="Run query on this image">⚡ Ask</button>
            </div>
            <div id="mxImgVoiceFeedback" class="mx-img-voice-feedback" style="display:none;"></div>
          </div>

          <div class="mx-img-chips-row">
            <span class="mx-img-chips-label">Quick Actions:</span>
            <button type="button" class="mx-img-chip" data-cmd="describe_image">🖼 Describe Image</button>
            <button type="button" class="mx-img-chip" data-cmd="extract_text">📄 Extract Text</button>
            <button type="button" class="mx-img-chip" data-cmd="explain_image">✨ Explain Image</button>
            <button type="button" class="mx-img-chip" data-cmd="translate_image_text">🌐 Translate Text</button>
            <button type="button" class="mx-img-chip" data-cmd="Provide the direct, complete answers and solutions to all questions and formulas visible in this image first.">🎯 Direct Answer</button>
          </div>
        </div>
      `;

      resultBody.innerHTML = `
        <div class="mx-img-ready-state">
          <div style="font-size: 26px; margin-bottom: 6px;">📸 🎙️ ⌨️</div>
          <strong style="color: #5EEBFF; font-size: 13.5px;">Image Ready for Command</strong>
          <p style="margin-top: 6px; font-size: 12px; color: #8FA6B8; line-height: 1.45;">
            You can enter a <strong>written command</strong>, a <strong>voice command</strong> (hold 🎙️ Voice), or both! Click <strong>⚡ Ask</strong> or a quick action chip to run.
          </p>
        </div>
      `;

      copyBtn.style.display = "none";
      mxCopyToChatBtn.style.display = "none";

      showConsole();

      const imgThumbWrap = contextPreview.querySelector("#mxImgThumbWrap");
      if (imgThumbWrap) {
        imgThumbWrap.addEventListener("click", () => showFullImageModal(dataUrl));
      }

      const resnipBtn = contextPreview.querySelector("#mxImgResnipBtn");
      if (resnipBtn) {
        resnipBtn.addEventListener("click", () => {
          startSnippingTool();
        });
      }

      const sendToChatBtn = contextPreview.querySelector("#mxImgSendToChatBtn");
      if (sendToChatBtn) {
        sendToChatBtn.addEventListener("click", () => {
          const textInput = contextPreview.querySelector("#mxImgTextInput");
          const initialPrompt = textInput ? textInput.value.trim() : "";
          openChatbotWithImage(dataUrl, initialPrompt);
        });
      }

      const textInput = contextPreview.querySelector("#mxImgTextInput");
      const voiceBtn = contextPreview.querySelector("#mxImgVoiceBtn");
      const submitBtn = contextPreview.querySelector("#mxImgSubmitBtn");
      const voiceFeedback = contextPreview.querySelector("#mxImgVoiceFeedback");

      if (voiceBtn && textInput && voiceFeedback) {
        setupImageVoiceButton(voiceBtn, textInput, voiceFeedback);
      }

      const executeImageQuery = (customPrompt = null) => {
        const writtenPrompt = customPrompt !== null
          ? customPrompt
          : (textInput ? textInput.value.trim() : "");

        currentContext.text = writtenPrompt || "Provide the direct, complete solution, code/algorithm implementation, or answer to the questions and formulas visible in this image.";
        runTriggerFlow();
      };

      if (submitBtn) {
        submitBtn.addEventListener("click", () => executeImageQuery());
      }

      if (textInput) {
        textInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            executeImageQuery();
          }
        });
        setTimeout(() => textInput.focus(), 60);
      }

      contextPreview.querySelectorAll(".mx-img-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          const cmd = chip.getAttribute("data-cmd");
          if (textInput) textInput.value = chip.textContent.trim();
          executeImageQuery(cmd);
        });
      });
    }

    function showConsole(sourceRect = null) {
      let top, left;
      const consoleWidth = consoleEl.offsetWidth || 440;
      const consoleHeight = Math.min(620, window.innerHeight - 40);

      const effectiveRect = (enableTextEmerge && sourceRect && sourceRect.width > 0 && sourceRect.height > 0)
        ? sourceRect
        : null;

      if (userPreferences?.popupPosition === "center") {
        left = Math.max(10, Math.round((window.innerWidth - consoleWidth) / 2));
        top = Math.max(10, Math.round((window.innerHeight - consoleHeight) / 2));
      } else if (userPreferences?.popupPosition === "top-right") {
        left = Math.max(10, window.innerWidth - consoleWidth - 24);
        top = 24;
      } else if (userPreferences?.popupPosition === "bottom-right") {
        left = Math.max(10, window.innerWidth - consoleWidth - 24);
        top = Math.max(10, window.innerHeight - consoleHeight - 24);
      } else if (userPreferences?.popupPosition === "remember" && userPreferences?.lastConsolePos) {
        left = Math.max(10, Math.min(window.innerWidth - consoleWidth - 10, userPreferences.lastConsolePos.left));
        top = Math.max(10, Math.min(window.innerHeight - consoleHeight - 10, userPreferences.lastConsolePos.top));
      } else if (effectiveRect) {
        // Smart adjacent placement near the selected text so user focus stays natural
        if (effectiveRect.right + consoleWidth + 24 <= window.innerWidth) {
          left = Math.round(effectiveRect.right + 14);
          top = Math.max(16, Math.min(window.innerHeight - consoleHeight - 16, Math.round(effectiveRect.top - 10)));
        } else if (effectiveRect.left - consoleWidth - 24 >= 10) {
          left = Math.round(effectiveRect.left - consoleWidth - 14);
          top = Math.max(16, Math.min(window.innerHeight - consoleHeight - 16, Math.round(effectiveRect.top - 10)));
        } else if (effectiveRect.bottom + consoleHeight + 20 <= window.innerHeight) {
          left = Math.max(16, Math.min(window.innerWidth - consoleWidth - 16, Math.round(effectiveRect.left)));
          top = Math.round(effectiveRect.bottom + 12);
        } else {
          top = Math.min(window.innerHeight - 560, 60);
          left = Math.min(window.innerWidth - 480, Math.max(20, window.innerWidth - 460));
        }
      } else {
        top = Math.min(window.innerHeight - 560, 60);
        left = Math.min(window.innerWidth - 480, Math.max(20, window.innerWidth - 460));
      }

      consoleEl.style.top = `${top}px`;
      consoleEl.style.left = `${left}px`;
      consoleEl.style.display = "flex";
      triggerEl.style.display = "none";

      if (!temporaryContext.contentType) {
        const textForClassify = (currentContext.text || window.getSelection()?.toString() || "").trim();
        const det = classifySelectedContent(textForClassify, currentContext.type === "image");
        temporaryContext.contentType = det;
        updateContextualActions(det, textForClassify);
      }

      if (effectiveRect) {
        animateEmergenceFromRect(consoleEl, effectiveRect);
        showSelectionAura(effectiveRect);
      }
    }

    // ── Groq Trigger Execution ────────────────────────────────────────────────

    async function runTriggerFlow() {
      if (!isExtensionValid()) {
        statusTitle.textContent = "Status: Page needs refresh";
        resultBody.innerHTML = `
          <div style="padding: 18px; text-align: center; color: #D6EFFF;">
            <div style="font-size: 26px; margin-bottom: 8px;">🔄</div>
            <strong style="color: #5EEBFF; font-size: 13.5px;">Extension Updated in Browser</strong>
            <p style="margin-top: 6px; font-size: 12px; color: #8FA6B8;">Please refresh this tab (press <strong>F5</strong> or <strong>Ctrl+R</strong>) to connect to the updated extension.</p>
            <button id="corsiriReloadTabBtn" style="margin-top: 12px; background: rgba(94, 235, 255, 0.15); border: 1px solid #5EEBFF; color: #5EEBFF; border-radius: 8px; padding: 6px 14px; font-size: 12px; cursor: pointer; font-weight: 600;">🔄 Reload Page Now</button>
          </div>
        `;
        const rBtn = resultBody.querySelector("#corsiriReloadTabBtn");
        if (rBtn) rBtn.addEventListener("click", () => window.location.reload());
        return;
      }

      const action = getSelectedAction();
      const isImageFlow = currentContext.type === "image" && Boolean(currentContext.imageUrl);
      const voiceCommand = (currentContext.voicePrompt || "").trim();

      const isMultiCopyAction = (currentActionId === "multi_copy_prompt" && temporaryContext.selections.length > 0);
      let queryText = (currentContext.text || "").trim();

      if (!isImageFlow && !voiceCommand) {
        if (!queryText && isMultiCopyAction) {
          queryText = temporaryContext.selections.join("\n\n");
        } else if (!queryText) {
          const sel = window.getSelection()?.toString().trim();
          if (sel && sel.length >= 2) queryText = sel;
        }
        if (!queryText && navigator.clipboard?.readText) {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip && clip.trim().length >= 2) queryText = clip.trim();
          } catch {}
        }

        if (!queryText && !isMultiCopyAction) {
          statusTitle.textContent = "Status: No text selected or copied";
          resultBody.innerHTML = `
            <div style="padding: 18px; text-align: center; color: #D6EFFF;">
              <div style="font-size: 26px; margin-bottom: 8px;">📋</div>
              <strong style="color: #5EEBFF; font-size: 13.5px;">No Question or Text Selected</strong>
              <p style="margin-top: 6px; font-size: 12px; color: #8FA6B8;">Please highlight text or copy (Ctrl+C) any question or code on the page. Corsiri will answer it immediately!</p>
            </div>
          `;
          return;
        }
        currentContext.text = queryText;
        contextPreview.style.display = "block";
        if (isMultiCopyAction) {
          contextPreview.innerHTML = `<strong>Multi-Copy Context:</strong> ${temporaryContext.selections.length} items collected`;
        } else {
          contextPreview.innerHTML = `<strong>Text Context:</strong> ${escapeHtml(queryText.slice(0, 140))}${queryText.length > 140 ? "..." : ""}`;
        }
      } else if (isImageFlow) {
        const hasWritten = Boolean(queryText && !queryText.startsWith("Analyze, extract") && !queryText.startsWith("Provide the direct"));
        if (hasWritten && voiceCommand) {
          statusTitle.textContent = "Analyzing image with written & voice command...";
        } else if (voiceCommand) {
          statusTitle.textContent = `Applying voice instruction to image: "${voiceCommand}"...`;
        } else if (hasWritten) {
          statusTitle.textContent = `Analyzing image with written command: "${queryText}"...`;
        } else {
          statusTitle.textContent = "Analyzing screen image with Vision AI...";
        }
      } else if (voiceCommand) {
        if (!queryText && navigator.clipboard?.readText) {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip && clip.trim().length >= 2) queryText = clip.trim();
          } catch {}
        }
        contextPreview.style.display = "block";
        if (queryText) {
          contextPreview.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div><strong>Text Input:</strong> ${escapeHtml(queryText.slice(0, 110))}${queryText.length > 110 ? "..." : ""}</div>
              <div style="color: #5EEBFF;"><strong>🎙 Voice Command:</strong> "${escapeHtml(voiceCommand)}"</div>
            </div>
          `;
        } else {
          contextPreview.innerHTML = `<div><strong>🎙 Voice Query:</strong> "${escapeHtml(voiceCommand)}"</div>`;
        }
        statusTitle.textContent = queryText ? `Applying voice command to text...` : `Answering voice query with Groq...`;
      }

      copyBtn.style.display = "none";
      mxCopyToChatBtn.style.display = "none";
      if (mxRegenBtn) mxRegenBtn.style.display = "none";
      if (mxEditResultBtn) mxEditResultBtn.style.display = "none";
      if (mxChangeLangBtn) mxChangeLangBtn.style.display = "none";

      let spinnerText = "Corsiri is reasoning with Groq...";
      if (isImageFlow) {
        if (queryText && voiceCommand && !queryText.startsWith("Analyze, extract") && !queryText.startsWith("Provide the direct")) {
          spinnerText = `Reasoning over image with written ("${escapeHtml(queryText.slice(0, 35))}") and voice commands...`;
        } else if (voiceCommand) {
          spinnerText = `Applying voice command: "${escapeHtml(voiceCommand)}"...`;
        } else if (queryText && !queryText.startsWith("Analyze, extract") && !queryText.startsWith("Provide the direct")) {
          spinnerText = `Answering: "${escapeHtml(queryText.slice(0, 45))}"...`;
        } else {
          spinnerText = "Corsiri Vision is reading image and solving questions...";
        }
      } else if (voiceCommand) {
        spinnerText = `Applying voice command: "${escapeHtml(voiceCommand)}"...`;
      } else if (currentActionId === "fix_it") {
        const ct = temporaryContext.contentType || "writing";
        if (ct === "code") spinnerText = "Fixing code bug with Groq...";
        else if (ct === "math") spinnerText = "Fixing calculation with Groq...";
        else if (ct === "email") spinnerText = "Fixing email tone with Groq...";
        else spinnerText = "Fixing grammar and phrasing with Groq...";
      } else if (currentActionId === "generate_reply") {
        spinnerText = `Drafting ${mxReplyToneSelect?.value || "professional"} reply with Groq...`;
      } else if (currentActionId === "translate") {
        spinnerText = `Translating into ${mxTargetLangSelect?.value || "English"} with Groq...`;
      } else if (currentActionId === "multi_copy_prompt") {
        spinnerText = `Synthesizing ${temporaryContext.selections.length} collected items with Groq...`;
      }

      resultBody.innerHTML = `
        <div class="corsiri-spinner">
          <div class="corsiri-spin-circle"></div>
          <span>${spinnerText}</span>
        </div>
      `;

      let flowDone = false;
      const timeoutTimer = setTimeout(() => {
        if (flowDone) return;
        flowDone = true;
        statusTitle.textContent = "Status: Request timed out";
        resultBody.innerHTML = `
          <div style="padding: 14px; text-align: center; color: #FFDF7E;">
            <div style="font-size: 22px; margin-bottom: 6px;">⏱️</div>
            <strong style="font-size: 13px;">Groq reasoning timed out</strong>
            <p style="font-size: 12px; margin-top: 4px; color: #8FA6B8;">The request took longer than expected. Check your network or try again.</p>
            <button id="corsiriRetryBtn" style="margin-top: 10px; background: rgba(255, 223, 126, 0.15); border: 1px solid #FFDF7E; color: #FFDF7E; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-weight: 600;">⚡ Retry</button>
          </div>
        `;
        const retryBtn = resultBody.querySelector("#corsiriRetryBtn");
        if (retryBtn) retryBtn.addEventListener("click", runTriggerFlow);
      }, isImageFlow ? 28000 : 18000);

      try {
        const effectiveActionId = currentActionId || action.id;
        const targetLang = (mxTargetLangSelect ? mxTargetLangSelect.value : "English");
        const replyTone = (mxReplyToneSelect ? mxReplyToneSelect.value : "Professional");
        const replyInst = (mxReplyInstructionInput ? mxReplyInstructionInput.value.trim() : "");
        const multiPrompt = (mxMultiCopyPrompt ? mxMultiCopyPrompt.value.trim() : "");

        chrome.runtime.sendMessage({
          type: "corsiri_query_action",
          action: voiceCommand ? "voice_command" : effectiveActionId,
          text: isImageFlow ? (currentContext.text || "") : (queryText || voiceCommand),
          voiceInstruction: voiceCommand || null,
          imageUrl: isImageFlow ? currentContext.imageUrl : null,
          question: voiceCommand || (effectiveActionId === "multi_copy_prompt" ? multiPrompt : (currentActionPrompt || action.prompt)),
          activeUrl: window.location.href,
          pageTitle: document.title,
          targetLanguage: targetLang,
          tone: replyTone,
          instruction: replyInst,
          contentType: temporaryContext.contentType || null,
          multiCopyItems: (effectiveActionId === "multi_copy_prompt" || temporaryContext.selections.length > 0) ? temporaryContext.selections : null
        }, (res) => {
          if (flowDone) return;
          flowDone = true;
          clearTimeout(timeoutTimer);
          currentContext.voicePrompt = "";

          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            statusTitle.textContent = "Status: Connection error";
            resultBody.innerHTML = `
              <div style="color: #FF6B6B; padding: 12px; text-align: center;">
                <strong>Connection Error:</strong> ${escapeHtml(lastErr.message || "Failed to communicate with background.")}
                <p style="font-size: 11px; margin-top: 6px; color: #8FA6B8;">Try reloading this tab (F5).</p>
              </div>
            `;
            return;
          }

          if (!res || !res.ok) {
            statusTitle.textContent = "Status: Groq error occurred";
            resultBody.innerHTML = `<div style="color: #FF6B6B; padding: 10px;">Error: ${escapeHtml(res?.error || "Failed to contact Groq AI.")}</div>`;
            return;
          }

          currentRawResult = res.result;
          activeChatContextText = res.result;
          chrome.storage?.local?.set?.({ corsiri_active_tab_context: res.result }).catch(() => {});
          statusTitle.textContent = `Status: Complete (${res.model || "Groq"})`;
          copyBtn.style.display = "block";
          mxCopyToChatBtn.style.display = "flex";
          if (mxRegenBtn) mxRegenBtn.style.display = "flex";
          if (mxEditResultBtn) {
            mxEditResultBtn.style.display = (effectiveActionId === "fix_it" || effectiveActionId === "generate_reply" || effectiveActionId === "explain_code" || effectiveActionId === "debug_code" || effectiveActionId === "improve_code") ? "flex" : "none";
          }
          if (mxChangeLangBtn) {
            mxChangeLangBtn.style.display = (effectiveActionId === "translate" || effectiveActionId === "translate_image_text") ? "flex" : "none";
          }
          renderFormattedResponse(resultBody, res.result);
        });
      } catch (err) {
        if (flowDone) return;
        flowDone = true;
        clearTimeout(timeoutTimer);
        statusTitle.textContent = "Status: Page needs refresh";
        resultBody.innerHTML = `
          <div style="padding: 18px; text-align: center; color: #D6EFFF;">
            <div style="font-size: 26px; margin-bottom: 8px;">🔄</div>
            <strong style="color: #5EEBFF; font-size: 13.5px;">Extension Context Updated</strong>
            <p style="margin-top: 6px; font-size: 12px; color: #8FA6B8;">Please refresh this tab (press <strong>F5</strong>) to connect to the extension.</p>
            <button id="corsiriReloadTabBtn" style="margin-top: 12px; background: rgba(94, 235, 255, 0.15); border: 1px solid #5EEBFF; color: #5EEBFF; border-radius: 8px; padding: 6px 14px; font-size: 12px; cursor: pointer; font-weight: 600;">🔄 Reload Page Now</button>
          </div>
        `;
        const rBtn = resultBody.querySelector("#corsiriReloadTabBtn");
        if (rBtn) rBtn.addEventListener("click", () => window.location.reload());
      }
    }

    // ── Snipping Tool Implementation ──────────────────────────────────────────

    function startSnippingTool(forChatbot = false) {
      consoleEl.style.display = "none";
      triggerEl.style.display = "none";
      if (forChatbot && chatbotWin) {
        chatbotWin.style.display = "none";
      }

      function getTabZoomFactor() {
        let zoom = 1;
        if (window.visualViewport && window.visualViewport.scale && window.visualViewport.scale > 0) {
          zoom = window.visualViewport.scale;
        }
        if (zoom === 1 && window.outerWidth && window.innerWidth) {
          const ratio = window.outerWidth / window.innerWidth;
          if (ratio >= 0.4 && ratio <= 6) {
            zoom = ratio;
          }
        }
        return Math.max(0.4, Math.min(zoom, 5));
      }

      const zoomFactor = getTabZoomFactor();
      const invScale = 1 / zoomFactor;

      const snipOverlay = document.createElement("div");
      snipOverlay.className = "corsiri-snip-overlay";
      snipOverlay.style.cssText = "position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; cursor: crosshair !important; pointer-events: auto !important; user-select: none !important; -webkit-user-select: none !important; touch-action: none !important; background: rgba(0, 0, 0, 0.42) !important;";
      snipOverlay.innerHTML = `
        <div class="corsiri-snip-hint">📸 Drag a box over any text, diagram, or formula to select it (Esc to cancel)</div>
        <div class="corsiri-snip-box" style="display:none;"><span class="corsiri-snip-badge"></span></div>
      `;
      shadowRoot.appendChild(snipOverlay);

      const hint = snipOverlay.querySelector(".corsiri-snip-hint");
      if (hint && zoomFactor !== 1) {
        hint.style.transform = `translateX(-50%) scale(${invScale})`;
        hint.style.transformOrigin = "top center";
      }

      let startX = 0, startY = 0, isSelecting = false;
      const box = snipOverlay.querySelector(".corsiri-snip-box");
      const badge = snipOverlay.querySelector(".corsiri-snip-badge");

      if (badge) {
        badge.style.transform = `scale(${invScale})`;
        badge.style.transformOrigin = "bottom right";
      }

      snipOverlay.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        try {
          snipOverlay.setPointerCapture(e.pointerId);
        } catch {}

        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        box.style.left = `${startX}px`;
        box.style.top = `${startY}px`;
        box.style.width = "0px";
        box.style.height = "0px";
        box.style.display = "block";
        if (badge) badge.textContent = "0 × 0 px";
      });

      snipOverlay.addEventListener("pointermove", (e) => {
        if (!isSelecting) return;
        e.preventDefault();
        e.stopPropagation();

        const currentX = e.clientX;
        const currentY = e.clientY;
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;

        if (badge) {
          badge.textContent = `${Math.round(width)} × ${Math.round(height)} px`;
          if (top + height + (30 * invScale) > window.innerHeight) {
            badge.style.bottom = "auto";
            badge.style.top = `${-24 * invScale}px`;
            badge.style.transformOrigin = "top right";
          } else {
            badge.style.top = "auto";
            badge.style.bottom = `${-24 * invScale}px`;
            badge.style.transformOrigin = "bottom right";
          }
        }
      });

      const finishSnip = async (e) => {
        if (!isSelecting) return;
        isSelecting = false;
        e.preventDefault();
        e.stopPropagation();

        try {
          snipOverlay.releasePointerCapture(e.pointerId);
        } catch {}

        const endX = e.clientX;
        const endY = e.clientY;
        const left = Math.min(startX, endX);
        const top = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        snipOverlay.remove();
        document.removeEventListener("keydown", escHandler);

        if (width < 15 || height < 15) {
          if (forChatbot && chatbotWin) {
            chatbotWin.style.display = "flex";
          } else {
            showConsole();
          }
          return;
        }

        if (!isExtensionValid()) {
          if (forChatbot && chatbotWin) {
            chatbotWin.style.display = "flex";
          }
          openConsoleWithText("", "Extension updated — please refresh page (F5)");
          return;
        }

        chrome.runtime.sendMessage({ type: "corsiri_capture_screenshot" }, (res) => {
          if (!res?.ok || !res.dataUrl) {
            if (forChatbot && chatbotWin) {
              chatbotWin.style.display = "flex";
            }
            openConsoleWithText("", "Screenshot capture error: " + (res?.error || "unknown"));
            return;
          }

          const img = new Image();
          img.onload = () => {
            const dpr = window.devicePixelRatio || 1;
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            const ctx = canvas.getContext("2d");
            ctx.drawImage(
              img,
              Math.round(left * dpr),
              Math.round(top * dpr),
              Math.round(width * dpr),
              Math.round(height * dpr),
              0,
              0,
              canvas.width,
              canvas.height
            );
            const croppedDataUrl = canvas.toDataURL("image/png");

            if (forChatbot) {
              openChatbotWithImage(croppedDataUrl);
            } else {
              openConsoleWithImage(croppedDataUrl, `Captured Region (${Math.round(width)}x${Math.round(height)})`);
            }
          };
          img.onerror = () => {
            if (forChatbot && chatbotWin) {
              chatbotWin.style.display = "flex";
            }
            openConsoleWithText("", "Could not load captured screen region");
          };
          img.src = res.dataUrl;
        });
      };

      snipOverlay.addEventListener("pointerup", finishSnip);
      snipOverlay.addEventListener("pointercancel", () => {
        if (isSelecting) {
          isSelecting = false;
          snipOverlay.remove();
          if (forChatbot && chatbotWin) {
            chatbotWin.style.display = "flex";
          } else {
            showConsole();
          }
          document.removeEventListener("keydown", escHandler);
        }
      });

      const escHandler = (e) => {
        if (e.key === "Escape") {
          isSelecting = false;
          snipOverlay.remove();
          if (forChatbot && chatbotWin) {
            chatbotWin.style.display = "flex";
          } else {
            showConsole();
          }
          document.removeEventListener("keydown", escHandler);
        }
      };
      document.addEventListener("keydown", escHandler);
    }

    // ── Global Listeners (Copy, Select, Keyboard) ─────────────────────────────

    // 1. Copy event preserves default system clipboard without opening Cursiv

    // 2. Text Selection Event Listener
    document.addEventListener("mouseup", (e) => {
      if (e.composedPath().includes(shadowHost)) return;

      setTimeout(async () => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();

        if (text && text.length >= 2 && sel.rangeCount > 0) {
          try {
            if (isExtensionValid()) {
              const prefs = await chrome.storage?.local?.get(["enableFloatingTrigger", "showFloatingTrigger"]);
              if (prefs?.enableFloatingTrigger === false || prefs?.showFloatingTrigger === false) {
                triggerEl.style.display = "none";
                return;
              }
            }
          } catch {}

          try {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const top = Math.max(10, rect.top - 38);
            const left = Math.min(window.innerWidth - 130, Math.max(10, rect.left + rect.width / 2 - 45));

            triggerEl.style.top = `${top}px`;
            triggerEl.style.left = `${left}px`;
            triggerEl.style.display = "flex";
          } catch {}
        } else {
          triggerEl.style.display = "none";
        }
      }, 10);
    });

    triggerEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const selRect = getActiveSourceRect();
      triggerEl.style.display = "none";
      const selText = window.getSelection()?.toString().trim();
      openConsoleWithText(selText || "", "Selection loaded", Boolean(selText), selRect);
    });

    // 3. Hotkeys: Ctrl+Shift+Space (Activate with Selection), Alt+S (Snipping) & Alt+C (Open Console)
    let lastHotkeyTriggerTime = 0;
    document.addEventListener("keydown", (e) => {
      const isSpace = e.code === "Space" || e.key === " " || e.key === "Spacebar" || e.keyCode === 32;
      const isActivateCombo = (e.ctrlKey || e.metaKey) && e.shiftKey && isSpace;

      if (isActivateCombo) {
        if (userPreferences?.enableGlobalHotkey === false) return;
        e.preventDefault();
        e.stopPropagation();
        lastHotkeyTriggerTime = Date.now();
        const selRect = getActiveSourceRect();
        const sel = window.getSelection()?.toString().trim() || "";
        openConsoleWithText(sel, sel ? "Activated via Ctrl+Shift+Space" : "Console opened", Boolean(sel), selRect);
      } else if (e.altKey && (e.key === "s" || e.key === "S")) {
        if (userPreferences?.enableSnipHotkey === false) return;
        e.preventDefault();
        startSnippingTool();
      } else if (e.altKey && (e.key === "c" || e.key === "C")) {
        if (userPreferences?.enableConsoleToggleHotkey === false) return;
        e.preventDefault();
        const selRect = getActiveSourceRect();
        const sel = window.getSelection()?.toString().trim() || "";
        openConsoleWithText(sel, "Console opened via hotkey", Boolean(sel), selRect);
      } else if (e.key === "Escape") {
        triggerEl.style.display = "none";
        consoleEl.style.display = "none";
      }
    }, true);

    // 4. Background message listener (e.g. from context menu, hotkey command, or subframe)
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "corsiri_start_snip") {
        startSnippingTool();
        return;
      }
      if (message.type === "corsiri_open_popup") {
        // Prevent duplicate trigger if DOM hotkey already fired within 350ms on same frame
        if (Date.now() - lastHotkeyTriggerTime < 350 && !message.action) {
          return;
        }
        const selRect = getActiveSourceRect();
        const text = message.selectedText || "";
        openConsoleWithText(text, text ? "Directly solving question..." : "Console opened", message.autoRun ?? Boolean(text), selRect);
        if (message.action) {
          selectAction(message.action, true);
        }
      }
    });
  }

  // ── RICH FORMULA & FORMATTING PARSER ──────────────────────────────────────────

  function highlightSyntax(rawCode, lang) {
    if (!rawCode) return "";
    const normLang = (lang || "").toLowerCase().trim();

    const keywords = new Set([
      "auto", "break", "case", "catch", "class", "const", "continue", "default", "delete",
      "do", "else", "enum", "export", "extends", "finally", "for", "function", "if",
      "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw",
      "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "public",
      "private", "protected", "def", "elif", "except", "from", "global", "lambda",
      "pass", "raise", "async", "await", "fn", "mut", "pub", "impl", "trait", "struct",
      "type", "interface", "package", "select", "defer", "go", "goto", "sizeof",
      "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "JOIN", "INNER", "LEFT"
    ]);

    const typesAndBuiltins = new Set([
      "int", "float", "double", "char", "bool", "boolean", "long", "short", "signed",
      "unsigned", "void", "string", "std", "cout", "cin", "endl", "vector", "map", "set",
      "pair", "true", "false", "null", "nullptr", "undefined", "None", "self", "print",
      "console", "log", "len", "range", "input"
    ]);

    const isCStyle = ["c", "cpp", "c++", "h", "hpp", "csharp", "cs"].includes(normLang);

    const tokenRegex = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)|([^\w\s]+)/g;

    return rawCode.replace(tokenRegex, (match, commentOrHash, string, number, word, symbol) => {
      if (commentOrHash) {
        if (isCStyle && commentOrHash.startsWith("#")) {
          return `<span class="corsiri-token-directive">${escapeHtml(commentOrHash)}</span>`;
        }
        return `<span class="corsiri-token-comment">${escapeHtml(commentOrHash)}</span>`;
      }
      if (string) {
        return `<span class="corsiri-token-string">${escapeHtml(string)}</span>`;
      }
      if (number) {
        return `<span class="corsiri-token-number">${escapeHtml(number)}</span>`;
      }
      if (word) {
        if (keywords.has(word) || keywords.has(word.toLowerCase())) {
          return `<span class="corsiri-token-keyword">${escapeHtml(word)}</span>`;
        }
        if (typesAndBuiltins.has(word)) {
          return `<span class="corsiri-token-builtin">${escapeHtml(word)}</span>`;
        }
        return escapeHtml(word);
      }
      if (symbol) {
        return escapeHtml(symbol);
      }
      return escapeHtml(match);
    });
  }

  function renderFormattedResponse(targetEl, raw) {
    targetEl.innerHTML = "";
    const lines = (raw || "").split("\n");
    let i = 0;

    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmedLine = rawLine.trim();

      if (!trimmedLine) {
        i++;
        continue;
      }

      // Multi-line Code blocks (```lang ... ``` or ~~~lang ... ~~~)
      if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
        const fenceMatch = trimmedLine.match(/^(`{3,}|~{3,})\s*([a-zA-Z0-9_+#.-]*)/);
        const lang = fenceMatch && fenceMatch[2] ? fenceMatch[2] : "";
        i++;
        const codeLines = [];
        while (i < lines.length && !lines[i].trim().startsWith("```") && !lines[i].trim().startsWith("~~~")) {
          codeLines.push(lines[i]); // Preserve original whitespace and indentation!
          i++;
        }
        if (i < lines.length && (lines[i].trim().startsWith("```") || lines[i].trim().startsWith("~~~"))) {
          i++; // Consume closing fence
        }
        const rawCode = codeLines.join("\n");

        const card = document.createElement("div");
        card.className = "corsiri-code-card";

        const header = document.createElement("div");
        header.className = "corsiri-code-header";

        const langBadge = document.createElement("span");
        langBadge.className = "corsiri-code-lang";
        langBadge.textContent = (lang || "code").toUpperCase();

        const copyCodeBtn = document.createElement("button");
        copyCodeBtn.type = "button";
        copyCodeBtn.className = "corsiri-code-copy-btn";
        copyCodeBtn.innerHTML = `<span>📋</span> Copy Code`;
        copyCodeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const success = await copyToClipboard(rawCode);
          copyCodeBtn.innerHTML = `<span>✓</span> Copied!`;
          copyCodeBtn.classList.add("copied");
          setTimeout(() => {
            copyCodeBtn.innerHTML = `<span>📋</span> Copy Code`;
            copyCodeBtn.classList.remove("copied");
          }, 2000);
        });

        header.appendChild(langBadge);
        header.appendChild(copyCodeBtn);
        card.appendChild(header);

        const pre = document.createElement("pre");
        pre.className = "corsiri-code-pre";
        const codeEl = document.createElement("code");
        codeEl.className = "corsiri-code-content";
        codeEl.innerHTML = highlightSyntax(rawCode, lang);
        pre.appendChild(codeEl);
        card.appendChild(pre);

        targetEl.appendChild(card);
        continue;
      }

      const line = trimmedLine;

      if (line === "---" || line === "***") {
        const hr = document.createElement("hr");
        hr.style.border = "none";
        hr.style.borderTop = "1px solid rgba(255, 255, 255, 0.08)";
        hr.style.margin = "10px 0";
        targetEl.appendChild(hr);
        i++;
        continue;
      }

      // Tables (| ... |)
      if (line.startsWith("|") && line.endsWith("|")) {
        const tableLines = [];
        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          tableLines.push(lines[i].trim());
          i++;
        }
        const tbl = buildHtmlTable(tableLines);
        if (tbl) targetEl.appendChild(tbl);
        continue;
      }

      // Heading 1 & 2
      if (line.startsWith("# ") || line.startsWith("## ")) {
        const h = document.createElement("h2");
        h.textContent = line.replace(/^#+\s*/, "");
        targetEl.appendChild(h);
        i++;
        continue;
      }

      // Section Subheadings (### or 1. Section)
      if (line.startsWith("### ") || /^\d+\.\s+[A-Za-z]/.test(line)) {
        const h = document.createElement("h3");
        h.textContent = line.replace(/^###\s*/, "").replace(/\*\*/g, "");
        targetEl.appendChild(h);
        i++;
        continue;
      }

      // Formulas (E = hf, λ = h/p, centered equations)
      if (isFormulaLine(line)) {
        const card = document.createElement("div");
        card.className = "corsiri-formula-card";
        card.textContent = cleanMathSymbols(line.replace(/\$\$/g, "").replace(/\*\*/g, ""));
        targetEl.appendChild(card);
        i++;
        continue;
      }

      // Bullet points
      if (/^[\-\*•]\s+/.test(line)) {
        const bulletRow = document.createElement("div");
        bulletRow.className = "corsiri-bullet-row";
        const dot = document.createElement("span");
        dot.className = "corsiri-bullet-dot";
        dot.textContent = "•";
        const text = document.createElement("div");
        text.className = "corsiri-bullet-text";
        text.innerHTML = parseInlineMarkdown(line.replace(/^[\-\*•]\s+/, ""));
        bulletRow.appendChild(dot);
        bulletRow.appendChild(text);
        targetEl.appendChild(bulletRow);
        i++;
        continue;
      }

      // Regular paragraph
      const p = document.createElement("p");
      p.style.margin = "4px 0 8px 0";
      p.innerHTML = parseInlineMarkdown(line);
      targetEl.appendChild(p);
      i++;
    }
  }

  function isFormulaLine(line) {
    if (line.startsWith("$$") || line.endsWith("$$")) return true;
    if (line.startsWith("\\(") || line.startsWith("\\[")) return true;
    const clean = line.replace(/\*\*/g, "").trim();
    if (!clean.includes("=") && !clean.includes("≈") && !clean.includes("→")) return false;
    if (/^(?:E|hf|Kmax|K_max|p|\\lambda|λ|F|B|c|a|v|W|U|V|d|s|t|x|y|z)\s*=/i.test(clean)) return true;
    if (/^[A-Za-zα-ωΑ-ΩλμφθΔ\\()_0-9\s]+\s*=\s*[\w\s\+\-\*\/\^\(\)·×²³_½¼¾\\{},\.·]+$/.test(clean)) return true;
    return false;
  }

  function cleanMathSymbols(math) {
    if (!math) return "";
    return math
      // LaTeX delimiters \( ... \), \[ ... \], $$ ... $$
      .replace(/\\\(\s*/g, "")
      .replace(/\s*\\\)/g, "")
      .replace(/\\\[\s*/g, "")
      .replace(/\s*\\\]/g, "")
      .replace(/\$\$/g, "")
      .replace(/\$([^\$]+)\$/g, "$1")
      // LaTeX formatting commands & spacing
      .replace(/\\displaystyle\s*/g, "")
      .replace(/\\text\{([^}]+)\}/g, "$1")
      .replace(/\\mathrm\{([^}]+)\}/g, "$1")
      .replace(/\\mathbf\{([^}]+)\}/g, "$1")
      .replace(/\\vec\{([^}]+)\}/g, "$1")
      .replace(/\\dot\{([^}]+)\}/g, "$1'")
      .replace(/\\ddot\{([^}]+)\}/g, "$1''")
      .replace(/\\,/g, " ")
      .replace(/\\;/g, " ")
      .replace(/\\quad/g, " ")
      .replace(/\\\s+/g, " ")
      // Fractions
      .replace(/\\(?:t)?frac\{1\}\{2\}/g, "½")
      .replace(/\\(?:t)?frac\{1\}\{4\}/g, "¼")
      .replace(/\\(?:t)?frac\{3\}\{4\}/g, "¾")
      .replace(/\\(?:t)?frac\{([^}]+)\}\{([^}]+)\}/g, "($1 / $2)")
      // Square roots
      .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
      .replace(/\\sqrt\s+/g, "√")
      // Integrals
      .replace(/\\int_\{([^}]+)\}\^\{([^}]+)\}/g, "∫ ($1 to $2) ")
      .replace(/\\int/g, "∫")
      // Greek symbols
      .replace(/\\Delta/g, "Δ")
      .replace(/\\delta/g, "δ")
      .replace(/\\phi/g, "φ")
      .replace(/\\Phi/g, "Φ")
      .replace(/\\lambda/g, "λ")
      .replace(/\\theta/g, "θ")
      .replace(/\\pi/g, "π")
      .replace(/\\mu_0/g, "μ₀")
      .replace(/\\mu/g, "μ")
      .replace(/\\epsilon_0/g, "ε₀")
      .replace(/\\epsilon/g, "ε")
      .replace(/\\sigma/g, "σ")
      .replace(/\\Sigma/g, "Σ")
      .replace(/\\omega/g, "ω")
      .replace(/\\Omega/g, "Ω")
      .replace(/\\oint/g, "∮")
      // Operators
      .replace(/\\times/g, "×")
      .replace(/\\cdot/g, "·")
      .replace(/\\pm/g, "±")
      .replace(/\\approx/g, "≈")
      .replace(/\\neq/g, "≠")
      .replace(/\\leq?/g, "≤")
      .replace(/\\geq?/g, "≥")
      .replace(/\\infty/g, "∞")
      // Exponents & subscripts
      .replace(/\^2\b/g, "²")
      .replace(/\^3\b/g, "³")
      .replace(/\^\{2\}/g, "²")
      .replace(/\^\{3\}/g, "³")
      .replace(/\^\{([^}]+)\}/g, "^($1)")
      .replace(/_\{max\}/g, "max")
      .replace(/_\{min\}/g, "min")
      .replace(/_0\b/g, "₀")
      .replace(/_1\b/g, "₁")
      .replace(/_2\b/g, "₂")
      .replace(/_3\b/g, "₃")
      .replace(/_\{0\}/g, "₀")
      .replace(/_\{1\}/g, "₁")
      .replace(/_\{2\}/g, "₂")
      .replace(/_i\b/g, "ᵢ")
      .replace(/_f\b/g, "ᶠ")
      // Remove lingering braces
      .replace(/[{}]/g, "")
      // Clean up multiple spaces
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function buildHtmlTable(tableLines) {
    const rows = [];
    for (const line of tableLines) {
      if (/^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(line)) continue;
      const cols = line.split("|").map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cols.length > 0) rows.push(cols);
    }
    if (rows.length === 0) return null;

    const card = document.createElement("div");
    card.className = "corsiri-table-card";

    rows.forEach((row, rIdx) => {
      const rowEl = document.createElement("div");
      rowEl.className = "corsiri-table-row" + (rIdx === 0 ? " header" : "");
      row.forEach(cell => {
        const cellEl = document.createElement("div");
        cellEl.className = "corsiri-table-cell";
        cellEl.innerHTML = parseInlineMarkdown(cell);
        rowEl.appendChild(cellEl);
      });
      card.appendChild(rowEl);
    });

    return card;
  }

  function parseInlineMarkdown(str) {
    if (!str) return "";
    const codeTokens = [];
    const protectedStr = str.replace(/`([^`]+)`/g, (_, code) => {
      const placeholder = `___CORSIRI_CODE_${codeTokens.length}___`;
      codeTokens.push(code);
      return placeholder;
    });

    const cleaned = cleanMathSymbols(protectedStr);
    let html = escapeHtml(cleaned)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");

    codeTokens.forEach((code, idx) => {
      const placeholder = `___CORSIRI_CODE_${idx}___`;
      const escapedCode = escapeHtml(code);
      html = html.replace(placeholder, `<code class="corsiri-inline-code">${escapedCode}</code>`);
    });

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
})();

