// MX Creative Console - Extension Toolbar Popup Logic
(function () {
  const consoleApp = document.querySelector(".mx-console-app");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const modeSelect = document.getElementById("mxModeSelect");
  const btnTrigger = document.getElementById("mxBtnTrigger");
  const btnTakeAction = document.getElementById("mxBtnTakeAction");
  const btnVoice = document.getElementById("mxBtnVoice");
  const btnImage = document.getElementById("mxBtnImage");
  const btnOpenChatbot = document.getElementById("mxBtnOpenChatbot") || document.getElementById("btnOpenChatbot");
  const btnCopyTextToChatbot = document.getElementById("mxBtnCopyTextToChatbot") || document.getElementById("btnCopyTextToChatbot");
  const statusTitle = document.getElementById("mxStatusTitle");
  const copyBtn = document.getElementById("mxCopyBtn");
  const mxCopyToChatBtn = document.getElementById("mxCopyToChatBtn");
  const contextPreview = document.getElementById("mxContextPreview");
  const resultBody = document.getElementById("mxResultBody");

  // Context Awareness References
  const mxContextCard = document.getElementById("mxContextCard");
  const mxContextTypeBadge = document.getElementById("mxContextTypeBadge");
  const mxContextDesc = document.getElementById("mxContextDesc");
  const mxContextPillsGrid = document.getElementById("mxContextPillsGrid");

  // Take Action References
  const mxTakeActionCard = document.getElementById("mxTakeActionCard");
  const mxBtnMultiCopy = document.getElementById("mxBtnMultiCopy");
  const mxMultiCopyBadge = document.getElementById("mxMultiCopyBadge");
  const mxBtnClearMulti = document.getElementById("mxBtnClearMulti");
  const mxBtnGenReply = document.getElementById("mxBtnGenReply");
  const mxBtnTranslate = document.getElementById("mxBtnTranslate");

  // Subpanels References
  const mxMultiCopySubpanel = document.getElementById("mxMultiCopySubpanel");
  const mxMultiCopyCountText = document.getElementById("mxMultiCopyCountText");
  const mxAddSelectionBtn = document.getElementById("mxAddSelectionBtn");
  const mxMultiCopyList = document.getElementById("mxMultiCopyList");
  const mxMultiCopyPrompt = document.getElementById("mxMultiCopyPrompt");
  const mxAskCursivBtn = document.getElementById("mxAskCursivBtn");

  const mxClearSubpanel = document.getElementById("mxClearSubpanel");
  const mxClearPromptText = document.getElementById("mxClearPromptText");
  const mxCancelClearBtn = document.getElementById("mxCancelClearBtn");
  const mxConfirmClearBtn = document.getElementById("mxConfirmClearBtn");

  const mxReplySubpanel = document.getElementById("mxReplySubpanel");
  const mxReplyToneSelect = document.getElementById("mxReplyToneSelect");
  const mxReplyInstructionInput = document.getElementById("mxReplyInstructionInput");
  const mxRunGenerateReplyBtn = document.getElementById("mxRunGenerateReplyBtn");

  const mxTranslateSubpanel = document.getElementById("mxTranslateSubpanel");
  const mxTargetLangSelect = document.getElementById("mxTargetLangSelect");
  const mxRunTranslateBtn = document.getElementById("mxRunTranslateBtn");

  // Status action tool buttons
  const mxRegenBtn = document.getElementById("mxRegenBtn");
  const mxEditResultBtn = document.getElementById("mxEditResultBtn");
  const mxChangeLangBtn = document.getElementById("mxChangeLangBtn");

  // Standalone Chatbot View Elements
  const popupChatbotView = document.getElementById("popupChatbotView");
  const chatbotBackBtn = document.getElementById("chatbotBackBtn");
  const chatbotNewChatBtn = document.getElementById("chatbotNewChatBtn");
  const chatbotHistoryBtn = document.getElementById("chatbotHistoryBtn");
  const chatbotHeaderBadge = document.getElementById("chatbotHeaderBadge");
  const chatbotClearBtn = document.getElementById("chatbotClearBtn");
  const chatbotRefBanner = document.getElementById("chatbotRefBanner");
  const chatbotRefText = document.getElementById("chatbotRefText");
  const chatbotRefDismiss = document.getElementById("chatbotRefDismiss");
  const chatbotMessagesList = document.getElementById("chatbotMessagesList");
  const chatbotInput = document.getElementById("chatbotInput");
  const chatbotSendBtn = document.getElementById("chatbotSendBtn");

  // Chatbot History Panel Elements
  const chatbotHistoryPanel = document.getElementById("chatbotHistoryPanel");
  const historyBadge = document.getElementById("historyBadge");
  const historyNewChatBtn = document.getElementById("historyNewChatBtn");
  const historyCloseBtn = document.getElementById("historyCloseBtn");
  const historyItemsList = document.getElementById("historyItemsList");
  const historyClearAllBtn = document.getElementById("historyClearAllBtn");

  let activeTab = null;
  let activeTabContextText = "";
  let currentRawResult = "";
  let activeChatContextText = "";
  let chatSessions = [];
  let currentSessionId = null;
  let chatConversationHistory = [];
  let isChatLoading = false;

  // ── Context Awareness & Multi-Copy State Management ──────────────────────
  const temporaryContext = {
    selections: [],
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

    const userPreferences = {
      popupSize: "standard",
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
      defaultTranslationLanguage: "English",
      defaultReplyTone: "Professional",
      voiceLanguage: "en-US",
      voiceAutoListen: false
    };

    function applyPreferences() {
      // 1. Popup Size
      document.body.classList.remove("mx-size-compact", "mx-size-standard", "mx-size-large", "mx-size-expanded");
      document.body.classList.add(`mx-size-${userPreferences.popupSize || "standard"}`);

      // 2. Theme Mode
      const isSystemLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
      const isLight = userPreferences.themeMode === "light" || (userPreferences.themeMode === "system" && isSystemLight);
      if (isLight) {
        document.body.classList.add("mx-theme-light");
      } else {
        document.body.classList.remove("mx-theme-light");
      }

      // 3. Default Selectors
      if (mxTargetLangSelect && userPreferences.defaultTranslationLanguage) {
        mxTargetLangSelect.value = userPreferences.defaultTranslationLanguage;
      }
      if (mxReplyToneSelect && userPreferences.defaultReplyTone) {
        mxReplyToneSelect.value = userPreferences.defaultReplyTone;
      }

      // 4. Take Action visibility
      if (userPreferences.actionsShown) {
        if (mxBtnMultiCopy) mxBtnMultiCopy.style.display = userPreferences.actionsShown.multicopy === false ? "none" : "inline-flex";
        if (mxBtnGenReply) mxBtnGenReply.style.display = userPreferences.actionsShown.reply === false ? "none" : "inline-flex";
        if (mxBtnTranslate) mxBtnTranslate.style.display = userPreferences.actionsShown.translate === false ? "none" : "inline-flex";
      }

      if (temporaryContext.contentType) {
        updateContextualActions(temporaryContext.contentType, activeTabContextText || "");
      }
    }

    async function loadUserPreferences() {
      try {
        const res = await chrome.storage.local.get([
          "popupSize",
          "themeMode",
          "actionsShown",
          "actionOrderPreset",
          "defaultTranslationLanguage",
          "defaultReplyTone",
          "voiceLanguage",
          "voiceAutoListen"
        ]);
        if (res) {
          if (res.popupSize) userPreferences.popupSize = res.popupSize;
          if (res.themeMode) userPreferences.themeMode = res.themeMode;
          if (res.actionsShown && typeof res.actionsShown === "object") userPreferences.actionsShown = { ...userPreferences.actionsShown, ...res.actionsShown };
          if (res.actionOrderPreset) userPreferences.actionOrderPreset = res.actionOrderPreset;
          if (res.defaultTranslationLanguage) userPreferences.defaultTranslationLanguage = res.defaultTranslationLanguage;
          if (res.defaultReplyTone) userPreferences.defaultReplyTone = res.defaultReplyTone;
          if (res.voiceLanguage) userPreferences.voiceLanguage = res.voiceLanguage;
          if (typeof res.voiceAutoListen === "boolean") userPreferences.voiceAutoListen = res.voiceAutoListen;
          applyPreferences();
        }
      } catch {}
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
      if (statusTitle) statusTitle.textContent = `Selected: ${action.label}`;
      if (autoExecuteIfContext && activeTabContextText) {
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
          const query = (activeTabContextText || "").trim();
          if (query) {
            chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}` });
          }
          return;
        }

        if (actId === "open_url") {
          let targetUrl = (activeTabContextText || "").trim();
          if (targetUrl) {
            if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
              targetUrl = "https://" + targetUrl;
            }
            chrome.tabs.create({ url: targetUrl });
          }
          return;
        }

        if (actId === "copy") {
          const textToCopy = (activeTabContextText || "").trim();
          if (textToCopy && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(textToCopy).then(() => {
              const prev = pillBtn.textContent;
              pillBtn.textContent = "✓ Copied!";
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
    if (statusTitle) statusTitle.textContent = "Status: Multi-Copy context cleared.";
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

  init();

  async function init() {
    setupEventListeners();
    await loadUserPreferences();
    await loadActiveTabContext();
    await loadChatHistory();
  }

  function setupEventListeners() {
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener("click", () => {
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open(chrome.runtime.getURL("options.html"));
        }
      });
    }

    if (btnTrigger) btnTrigger.addEventListener("click", runTriggerFlow);
    if (btnTakeAction) {
      btnTakeAction.addEventListener("click", () => {
        if (activeTabContextText && (!temporaryContext.selections.length || temporaryContext.selections[temporaryContext.selections.length - 1] !== activeTabContextText)) {
          addMultiCopyItem(activeTabContextText);
        }
        toggleTakeActionSubpanel("multicopy");
      });
    }
    if (btnImage) btnImage.addEventListener("click", runImageSelectionFlow);

    // Take Action Button listeners
    if (mxBtnMultiCopy) {
      mxBtnMultiCopy.addEventListener("click", () => {
        if (activeTabContextText && (!temporaryContext.selections.length || temporaryContext.selections[temporaryContext.selections.length - 1] !== activeTabContextText)) {
          addMultiCopyItem(activeTabContextText);
        }
        toggleTakeActionSubpanel("multicopy");
      });
    }
    if (mxAddSelectionBtn) {
      mxAddSelectionBtn.addEventListener("click", async () => {
        let sel = activeTabContextText;
        if (!sel && navigator.clipboard?.readText) {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip && clip.trim().length >= 2) sel = clip.trim();
          } catch {}
        }
        if (sel) {
          addMultiCopyItem(sel);
          if (statusTitle) statusTitle.textContent = `Added selection to Multi-Copy (${temporaryContext.selections.length} total)`;
        } else {
          if (statusTitle) statusTitle.textContent = "No text available to add";
        }
      });
    }
    if (mxAskCursivBtn) {
      mxAskCursivBtn.addEventListener("click", () => {
        const promptText = (mxMultiCopyPrompt ? mxMultiCopyPrompt.value : "").trim();
        if (temporaryContext.selections.length === 0) {
          if (statusTitle) statusTitle.textContent = "Please add at least one selection to Multi-Copy first";
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

    // Status action tool buttons
    if (mxRegenBtn) {
      mxRegenBtn.addEventListener("click", () => runTriggerFlow());
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

    setupVoiceButton();

    // Open Chatbot popup from Trigger Surface button
    if (btnOpenChatbot) {
      btnOpenChatbot.addEventListener("click", async () => {
        let textToUse = "";
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const selResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              func: () => window.getSelection()?.toString() || ""
            });
            if (Array.isArray(selResults)) {
              for (const r of selResults) {
                const txt = (r.result || "").trim();
                if (txt && txt.length >= 2) {
                  textToUse = txt;
                  break;
                }
              }
            }
          }
        } catch {}

        if (!textToUse && activeTabContextText) {
          textToUse = activeTabContextText.trim();
        }

        showChatbotView(textToUse || null);
      });
    }

    // Directly copy browser selected text to Chatbot from Trigger Surface
    if (btnCopyTextToChatbot) {
      btnCopyTextToChatbot.addEventListener("click", async () => {
        let selectedBrowserText = "";
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const selResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              func: () => window.getSelection()?.toString() || ""
            });
            if (Array.isArray(selResults)) {
              for (const r of selResults) {
                const txt = (r.result || "").trim();
                if (txt && txt.length >= 2) {
                  selectedBrowserText = txt;
                  break;
                }
              }
            }
          }
        } catch {}

        if (!selectedBrowserText && activeTabContextText) {
          selectedBrowserText = activeTabContextText.trim();
        }

        if (!selectedBrowserText && navigator.clipboard?.readText) {
          try {
            const clip = await navigator.clipboard.readText();
            if (clip && clip.trim().length >= 2) selectedBrowserText = clip.trim();
          } catch {}
        }

        if (!selectedBrowserText) {
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

        await copyToClipboard(selectedBrowserText);
        showChatbotView(selectedBrowserText);
      });
    }

    // Copy to Chatbot from Status card header
    if (mxCopyToChatBtn) {
      mxCopyToChatBtn.addEventListener("click", async () => {
        const textToCopy = currentRawResult || (resultBody ? resultBody.innerText : "") || activeTabContextText;
        mxCopyToChatBtn.textContent = "✓ Sent to Chatbot!";
        setTimeout(() => {
          mxCopyToChatBtn.textContent = "💬 Copy to Chatbot";
        }, 1500);

        const combined = (activeTabContextText && currentRawResult && activeTabContextText !== currentRawResult)
          ? `Question / Context:\n${activeTabContextText}\n\nSolution / Answer:\n${currentRawResult}`
          : textToCopy;

        if (combined) {
          await copyToClipboard(combined);
        }

        showChatbotView(combined || null);
      });
    }

    // Chatbot Back button
    if (chatbotBackBtn) {
      chatbotBackBtn.addEventListener("click", () => {
        toggleHistoryPanel(false);
        showConsoleView();
      });
    }

    // Chatbot New Chat buttons
    if (chatbotNewChatBtn) chatbotNewChatBtn.addEventListener("click", () => createNewChatSession());
    if (historyNewChatBtn) historyNewChatBtn.addEventListener("click", () => createNewChatSession());

    // Chatbot History Toggle button & Close button
    if (chatbotHistoryBtn) chatbotHistoryBtn.addEventListener("click", () => toggleHistoryPanel());
    if (historyCloseBtn) historyCloseBtn.addEventListener("click", () => toggleHistoryPanel(false));
    if (historyClearAllBtn) historyClearAllBtn.addEventListener("click", clearAllChatHistory);

    // Close history panel when clicking outside
    document.addEventListener("click", (e) => {
      if (!chatbotHistoryPanel || chatbotHistoryPanel.style.display !== "flex") return;
      if (chatbotHistoryPanel.contains(e.target) || chatbotHistoryBtn?.contains(e.target)) return;
      toggleHistoryPanel(false);
    });

    // Chatbot Clear current conversation
    if (chatbotClearBtn) {
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
        renderAllChatMessages();
      });
    }

    // Dismiss active context reference banner
    if (chatbotRefDismiss) {
      chatbotRefDismiss.addEventListener("click", () => {
        activeChatContextText = "";
        chatbotRefBanner.style.display = "none";
        if (currentSessionId) {
          const curr = chatSessions.find(s => s.id === currentSessionId);
          if (curr) curr.contextText = "";
          saveChatHistory();
        }
      });
    }

    // Chat send button & Enter key
    if (chatbotSendBtn) {
      chatbotSendBtn.addEventListener("click", () => {
        if (chatbotInput) sendChatMessage(chatbotInput.value.trim());
      });
    }

    if (chatbotInput) {
      chatbotInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage(chatbotInput.value.trim());
        }
      });

      chatbotInput.addEventListener("input", () => {
        chatbotInput.style.height = "auto";
        chatbotInput.style.height = Math.min(chatbotInput.scrollHeight, 90) + "px";
      });
    }

    // Copy raw result button with bulletproof fallback
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const textToCopy = currentRawResult || (resultBody ? resultBody.innerText : "") || (activeTabContextText || "");
        if (!textToCopy) {
          copyBtn.textContent = "⚠️ No text";
          setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1400);
          return;
        }

        const success = await copyToClipboard(textToCopy);
        copyBtn.textContent = success ? "✓ Copied!" : "✓ Selected";
        setTimeout(() => { copyBtn.textContent = "📋 Copy"; }, 1400);
      });
    }
  }

  // ── Robust Dual-Strategy Clipboard Helper ───────────────────────────────────

  async function copyToClipboard(text) {
    if (!text) return false;

    // Strategy 1: Async Clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn("navigator.clipboard.writeText failed, using execCommand fallback:", err);
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

  // ── Standalone Chatbot View Switching ───────────────────────────────────────

  function showChatbotView(copiedContext = null) {
    if (consoleApp) consoleApp.style.display = "none";
    if (popupChatbotView) popupChatbotView.style.display = "flex";

    if (copiedContext && copiedContext.trim()) {
      // If current chat already has messages on an unrelated topic, create a new session!
      if (chatConversationHistory.length > 0) {
        createNewChatSession(copiedContext.trim());
      } else {
        activeChatContextText = copiedContext.trim();
        if (chatbotRefBanner) chatbotRefBanner.style.display = "flex";
        if (chatbotRefText) chatbotRefText.textContent = `📌 Context: ${copiedContext.replace(/\s+/g, " ").slice(0, 60)}...`;

        const welcome = {
          role: "assistant",
          content: `📌 **Loaded Selected Text:**\n"${copiedContext.slice(0, 260)}${copiedContext.length > 260 ? "..." : ""}"\n\nAsk any question, or type **answer** / **solve** to get the complete solution.`
        };
        chatConversationHistory.push(welcome);
        renderSingleChatMessage(welcome);
        saveChatHistory();
      }
    }

    chatbotInput.focus();
  }

  function showConsoleView() {
    if (popupChatbotView) popupChatbotView.style.display = "none";
    if (consoleApp) consoleApp.style.display = "flex";
  }

  // ── Chat Persistence, Multi-Session History & Rendering ─────────────────────

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

  async function loadChatHistory() {
    try {
      const stored = await chrome.storage?.local?.get?.(["corsiri_chat_sessions", "corsiri_current_session_id", "corsiri_chat_history"]);
      let sessions = Array.isArray(stored?.corsiri_chat_sessions) ? stored.corsiri_chat_sessions : [];
      let activeId = stored?.corsiri_current_session_id || null;

      // Migrate legacy single history if sessions are empty
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
      } else {
        chatConversationHistory = [];
        activeChatContextText = "";
      }

      updateHistoryBadges();
      renderAllChatMessages();
    } catch (err) {
      console.warn("Could not load chat history:", err);
    }
  }

  function saveChatHistory() {
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

      chrome.storage?.local?.set?.({
        corsiri_chat_sessions: chatSessions,
        corsiri_current_session_id: currentSessionId,
        corsiri_chat_history: chatConversationHistory.slice(-50)
      })?.catch?.(() => {});
    } catch (err) {
      console.warn("Could not save chat history:", err);
    }
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

    chrome.storage?.local?.remove?.(["corsiri_chat_sessions", "corsiri_current_session_id", "corsiri_chat_history"])?.catch?.(() => {});
    updateHistoryBadges();
    renderHistoryItems();
    renderAllChatMessages();
  }

  function renderAllChatMessages() {
    chatbotMessagesList.innerHTML = "";
    if (chatConversationHistory.length === 0) {
      chatbotMessagesList.innerHTML = `
        <div id="chatbotWelcomeMsg" style="text-align: center; color: #8FA6B8; font-size: 12.5px; padding: 26px 10px;">
          <div style="font-size: 26px; margin-bottom: 6px;">💬</div>
          <strong style="color: #5EEBFF; font-size: 13.5px;">Corsiri AI Chatbot</strong>
          <p style="margin-top: 4px; font-size: 11.5px;">Ask questions or explore concepts in detail. Multi-turn conversation history is maintained.</p>
        </div>
      `;
      return;
    }
    chatConversationHistory.forEach(msg => renderSingleChatMessage(msg));
  }

  function renderSingleChatMessage(msg, model = "") {
    const wrapper = document.createElement("div");
    wrapper.className = `chatbot-msg-wrapper ${msg.role}`;

    const bubble = document.createElement("div");
    bubble.className = `chatbot-msg-bubble ${msg.role}`;

    if (msg.role === "user") {
      bubble.textContent = msg.content;
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

  async function sendChatMessage(userText) {
    if (!userText || isChatLoading) return;
    isChatLoading = true;
    chatbotSendBtn.disabled = true;

    const placeholder = chatbotMessagesList.querySelector("#chatbotWelcomeMsg");
    if (placeholder) placeholder.remove();

    const userMsg = { role: "user", content: userText };
    chatConversationHistory.push(userMsg);
    renderSingleChatMessage(userMsg);
    saveChatHistory();

    chatbotInput.value = "";
    chatbotInput.style.height = "auto";

    const typingEl = document.createElement("div");
    typingEl.className = "chatbot-msg-wrapper assistant";
    typingEl.innerHTML = `
      <div class="chatbot-msg-bubble assistant" style="display:flex;align-items:center;gap:8px;">
        <div class="corsiri-spin-circle" style="width:14px;height:14px;"></div>
        <span>Reasoning with Groq...</span>
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
        content: "⚠️ Request timed out. Groq took longer than 15s to respond. Please try again."
      });
    }, 15000);

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
        contextText: activeChatContextText || ""
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
            content: `⚠️ Extension communication error: ${lastErr.message || "Failed to communicate with background."}`
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
        content: "⚠️ Failed to send message. Please reload the extension or try again."
      });
    }
  }

  // ── Console Functions ───────────────────────────────────────────────────────

  function safeHostname(url) {
    if (!url) return "webpage";
    try {
      return new URL(url).hostname || "webpage";
    } catch {
      return "webpage";
    }
  }

  async function loadActiveTabContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        if (contextPreview) contextPreview.textContent = "Active Page Context: No tab detected";
        return;
      }
      activeTab = tab;

      const title = tab.title || "Webpage";
      const host = safeHostname(tab.url);

      // Check if user has text selected in active tab (including iframes)
      let selectedText = "";
      try {
        const selResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: () => window.getSelection()?.toString() || ""
        });
        if (Array.isArray(selResults)) {
          for (const r of selResults) {
            const txt = (r.result || "").trim();
            if (txt && txt.length >= 2) {
              selectedText = txt;
              break;
            }
          }
        }
      } catch {}

      if (selectedText) {
        activeTabContextText = selectedText;
        if (contextPreview) contextPreview.innerHTML = `<strong>Selected Question / Context:</strong><br><span style="color:#5EEBFF;">${escapeHtml(selectedText.slice(0, 140))}${selectedText.length > 140 ? "..." : ""}</span>`;
        // Context Awareness Classification
        const detectedType = classifySelectedContent(selectedText);
        temporaryContext.contentType = detectedType;
        updateContextualActions(detectedType, selectedText);
        // Auto-run immediately when opened with selected text!
        runTriggerFlow();
      } else {
        updateContextualActions("unknown", "");
        if (contextPreview) contextPreview.innerHTML = `<strong>Active Page:</strong> ${escapeHtml(title)} (${escapeHtml(host)})<br><span style="color:#8FA6B8;">Select any text or copy (Ctrl+C) to search</span>`;
      }
    } catch (err) {
      console.warn("Could not load tab context:", err);
      if (contextPreview) contextPreview.textContent = "Context ready for Groq analysis.";
    }
  }

  async function runTriggerFlow() {
    const action = getSelectedAction();
    const isMultiCopyAction = (currentActionId === "multi_copy_prompt" && temporaryContext.selections.length > 0);
    let text = (activeTabContextText || "").trim();

    if (!text && isMultiCopyAction) {
      text = temporaryContext.selections.join("\n\n");
    }

    if (!text && !isMultiCopyAction) {
      if (statusTitle) statusTitle.textContent = "Status: No text selected";
      if (resultBody) {
        resultBody.innerHTML = `
          <div style="padding: 16px; text-align: center; color: #D6EFFF;">
            <div style="font-size: 24px; margin-bottom: 6px;">📋</div>
            <strong style="color: #5EEBFF; font-size: 13px;">No Question or Text Selected</strong>
            <p style="margin-top: 4px; font-size: 11.5px; color: #8FA6B8;">Please highlight or copy (Ctrl+C) any question or code in your browser tab.</p>
          </div>
        `;
      }
      return;
    }

    if (copyBtn) copyBtn.style.display = "none";
    if (mxCopyToChatBtn) mxCopyToChatBtn.style.display = "none";
    if (mxRegenBtn) mxRegenBtn.style.display = "none";
    if (mxEditResultBtn) mxEditResultBtn.style.display = "none";
    if (mxChangeLangBtn) mxChangeLangBtn.style.display = "none";

    let spinnerText = "Corsiri is reasoning with Groq...";
    if (currentActionId === "fix_it") {
      const ct = temporaryContext.contentType || "writing";
      if (ct === "code") spinnerText = "Fixing code bug with Groq...";
      else if (ct === "math") spinnerText = "Fixing calculation with Groq...";
      else if (ct === "email") spinnerText = "Fixing email tone with Groq...";
      else spinnerText = "Fixing grammar and phrasing with Groq...";
      if (statusTitle) statusTitle.textContent = spinnerText;
    } else if (currentActionId === "generate_reply") {
      spinnerText = `Drafting ${mxReplyToneSelect?.value || "professional"} reply with Groq...`;
      if (statusTitle) statusTitle.textContent = "Drafting reply with Groq...";
    } else if (currentActionId === "translate") {
      spinnerText = `Translating into ${mxTargetLangSelect?.value || "English"} with Groq...`;
      if (statusTitle) statusTitle.textContent = `Translating into ${mxTargetLangSelect?.value || "English"} with Groq...`;
    } else if (currentActionId === "multi_copy_prompt") {
      spinnerText = `Synthesizing ${temporaryContext.selections.length} collected items with Groq...`;
      if (statusTitle) statusTitle.textContent = `Synthesizing ${temporaryContext.selections.length} selections...`;
    } else {
      if (statusTitle) statusTitle.textContent = `Directly reasoning with Groq (${action.label || currentActionId})...`;
    }

    if (resultBody) {
      resultBody.innerHTML = `
        <div class="corsiri-spinner">
          <div class="corsiri-spin-circle"></div>
          <span>${spinnerText}</span>
        </div>
      `;
    }

    let flowDone = false;
    const timeoutTimer = setTimeout(() => {
      if (flowDone) return;
      flowDone = true;
      if (statusTitle) statusTitle.textContent = "Status: Request timed out";
      if (resultBody) {
        resultBody.innerHTML = `
          <div style="padding: 14px; text-align: center; color: #FFDF7E;">
            <div style="font-size: 22px; margin-bottom: 6px;">⏱️</div>
            <strong style="font-size: 13px;">Groq reasoning timed out</strong>
            <p style="font-size: 12px; margin-top: 4px; color: #8FA6B8;">The request took longer than expected. Check your network or try again.</p>
            <button id="corsiriPopupRetryBtn" style="margin-top: 10px; background: rgba(255, 223, 126, 0.15); border: 1px solid #FFDF7E; color: #FFDF7E; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-weight: 600;">⚡ Retry</button>
          </div>
        `;
        const retryBtn = resultBody.querySelector("#corsiriPopupRetryBtn");
        if (retryBtn) retryBtn.addEventListener("click", runTriggerFlow);
      }
    }, 18000);

    try {
      const effectiveActionId = currentActionId || action.id;
      const targetLang = (mxTargetLangSelect ? mxTargetLangSelect.value : "English");
      const replyTone = (mxReplyToneSelect ? mxReplyToneSelect.value : "Professional");
      const replyInst = (mxReplyInstruction ? mxReplyInstruction.value.trim() : "");
      const multiPrompt = (mxMultiCopyPrompt ? mxMultiCopyPrompt.value.trim() : "");

      chrome.runtime.sendMessage({
        type: "corsiri_query_action",
        action: effectiveActionId,
        text: text,
        question: (effectiveActionId === "multi_copy_prompt" ? (multiPrompt || "Analyze and explain these collected selections together:") : (currentActionPrompt || action.prompt)),
        activeUrl: activeTab?.url || "",
        pageTitle: activeTab?.title || "",
        targetLanguage: targetLang,
        tone: replyTone,
        instruction: replyInst,
        contentType: temporaryContext.contentType || null,
        multiCopyItems: (effectiveActionId === "multi_copy_prompt" || temporaryContext.selections.length > 0) ? temporaryContext.selections : null
      }, (res) => {
        if (flowDone) return;
        flowDone = true;
        clearTimeout(timeoutTimer);

        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          if (statusTitle) statusTitle.textContent = "Status: Extension connection error";
          if (resultBody) {
            resultBody.innerHTML = `
              <div style="color: #FF6B6B; padding: 12px; text-align: center;">
                <strong>Connection Error:</strong> ${escapeHtml(lastErr.message || "Failed to communicate with background.")}
              </div>
            `;
          }
          return;
        }

        if (!res || !res.ok) {
          if (statusTitle) statusTitle.textContent = "Status: Groq query error";
          if (resultBody) resultBody.innerHTML = `<div style="color: #FF6B6B; padding: 10px;">Error: ${escapeHtml(res?.error || "Failed to reach Groq.")}</div>`;
          return;
        }

        currentRawResult = res.result;
        activeChatContextText = res.result;
        if (statusTitle) statusTitle.textContent = `Status: Complete (${res.model || "Groq"})`;
        if (copyBtn) copyBtn.style.display = "block";
        if (mxCopyToChatBtn) mxCopyToChatBtn.style.display = "inline-flex";
        if (mxRegenBtn) mxRegenBtn.style.display = "inline-flex";
        if (mxEditResultBtn) {
          mxEditResultBtn.style.display = (effectiveActionId === "fix_it" || effectiveActionId === "generate_reply" || effectiveActionId === "explain_code" || effectiveActionId === "debug_code" || effectiveActionId === "improve_code") ? "inline-flex" : "none";
        }
        if (mxChangeLangBtn) {
          mxChangeLangBtn.style.display = (effectiveActionId === "translate") ? "inline-flex" : "none";
        }
        if (resultBody) renderFormattedResponse(resultBody, res.result);
      });
    } catch (err) {
      if (flowDone) return;
      flowDone = true;
      clearTimeout(timeoutTimer);
      if (statusTitle) statusTitle.textContent = "Status: Error";
      if (resultBody) resultBody.innerHTML = `<div style="color: #FF6B6B; padding: 10px;">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function runTakeActionFlow() {
    if (!activeTab?.id) return;
    if (statusTitle) statusTitle.textContent = "Analyzing DOM interactive elements...";
    if (resultBody) {
      resultBody.innerHTML = `
        <div class="corsiri-spinner">
          <div class="corsiri-spin-circle"></div>
          <span>Scanning page for clickable buttons and inputs...</span>
        </div>
      `;
    }

    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, { type: "collect_context" });
      if (res?.ok && res.payload) {
        const elements = res.payload.interactiveElements || [];
        if (statusTitle) statusTitle.textContent = `Status: Found ${elements.length} interactive elements`;
        const buttons = elements.filter(el => el.role === "button" || el.type === "button").slice(0, 8);

        if (buttons.length === 0) {
          if (resultBody) resultBody.innerHTML = `<p style="color:#A0C4DE;">No interactive buttons detected on this page.</p>`;
          return;
        }

        let html = `<h4>Interactive Elements Available:</h4><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">`;
        buttons.forEach(b => {
          html += `<div style="background:rgba(255,255,255,0.06);padding:6px 10px;border-radius:6px;font-size:12px;"><strong>[${escapeHtml(b.role)}]</strong> ${escapeHtml(b.label || b.nameAttribute || "Button")}</div>`;
        });
        html += `</div>`;
        if (resultBody) resultBody.innerHTML = html;
      }
    } catch (err) {
      if (statusTitle) statusTitle.textContent = "Status: Cannot inspect this tab";
      if (resultBody) resultBody.innerHTML = `<div style="color:#FF6B6B;">${escapeHtml(err.message)}</div>`;
    }
  }

  function runImageSelectionFlow() {
    if (!activeTab?.id) return;
    chrome.tabs.sendMessage(activeTab.id, { type: "corsiri_start_snip" }, () => {
      window.close();
    });
  }

  function setupVoiceButton() {
    if (!btnVoice) return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      btnVoice.addEventListener("click", () => {
        if (statusTitle) statusTitle.textContent = "Speech recognition unavailable.";
      });
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";

    let isSpeaking = false;
    let voiceInstruction = "";

    rec.onresult = (e) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        transcript += e.results[i][0].transcript;
      }
      voiceInstruction = transcript.trim();
      if (statusTitle) statusTitle.textContent = `🎙 Heard: "${voiceInstruction}"`;
      if (contextPreview) {
        if (activeTabContextText && activeTabContextText.trim()) {
          contextPreview.style.display = "block";
          contextPreview.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div><strong>Text Input:</strong> ${escapeHtml(activeTabContextText.slice(0, 110))}${activeTabContextText.length > 110 ? "..." : ""}</div>
              <div style="color: #5EEBFF;"><strong>🎙 Voice Command:</strong> "${escapeHtml(voiceInstruction)}"</div>
            </div>
          `;
        } else {
          contextPreview.style.display = "block";
          contextPreview.innerHTML = `<div><strong>🎙 Voice Query:</strong> "${escapeHtml(voiceInstruction)}"</div>`;
        }
      }
    };

    rec.onend = () => {
      isSpeaking = false;
      btnVoice.classList.remove("recording");
      btnVoice.innerHTML = "🎙 Hold to Talk";
      if (voiceInstruction) {
        runVoiceTriggerFlow(voiceInstruction);
      }
    };

    rec.onerror = (e) => {
      isSpeaking = false;
      btnVoice.classList.remove("recording");
      btnVoice.innerHTML = "🎙 Hold to Talk";
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        showMicPermissionRequired();
      } else {
        if (statusTitle) statusTitle.textContent = `Mic status: ${e.error || "off"}`;
      }
    };

    btnVoice.addEventListener("mousedown", async () => {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const perm = await navigator.permissions.query({ name: "microphone" });
            if (perm.state === "denied") {
              showMicPermissionRequired();
              return;
            }
          } catch {}
        }

        if (!activeTabContextText || !activeTabContextText.trim()) {
          if (navigator.clipboard?.readText) {
            try {
              const clip = await navigator.clipboard.readText();
              if (clip && clip.trim().length >= 2) activeTabContextText = clip.trim();
            } catch {}
          }
        }
        voiceInstruction = "";
        isSpeaking = true;
        btnVoice.classList.add("recording");
        btnVoice.innerHTML = "🔴 Listening...";
        rec.start();
      } catch (err) {
        showMicPermissionRequired();
      }
    });

    btnVoice.addEventListener("mouseup", () => {
      if (isSpeaking) {
        try { rec.stop(); } catch {}
      }
    });
  }

  function showMicPermissionRequired() {
    if (statusTitle) {
      statusTitle.innerHTML = `⚠️ Mic permission needed. <a href="#" id="enableMicLink" style="color:#5EEBFF;text-decoration:underline;cursor:pointer;font-weight:600;">Enable Mic</a>`;
      const link = statusTitle.querySelector("#enableMicLink");
      if (link) {
        link.addEventListener("click", (evt) => {
          evt.preventDefault();
          openMicPermissionPage();
        });
      }
    }
    if (resultBody) {
      resultBody.innerHTML = `
        <div style="padding: 16px 12px; text-align: center;">
          <div style="font-size: 28px; margin-bottom: 6px;">🎙️</div>
          <strong style="color: #5EEBFF; font-size: 13.5px;">Microphone Permission Needed</strong>
          <p style="font-size: 12px; margin-top: 6px; color: #D6EFFF; line-height: 1.55;">
            Chrome requires one-time permission on an extension page to allow speech recognition.
          </p>
          <button id="openMicPermissionBtn" style="margin-top: 12px; background: linear-gradient(135deg, #00C6FF, #0072FF); border: none; color: #fff; font-weight: 600; padding: 9px 18px; border-radius: 9px; cursor: pointer; font-size: 12.5px; box-shadow: 0 2px 12px rgba(0, 114, 255, 0.45); display: inline-flex; align-items: center; gap: 6px;">
            🎙️ Grant Microphone Access
          </button>
        </div>
      `;
      const btn = resultBody.querySelector("#openMicPermissionBtn");
      if (btn) btn.addEventListener("click", openMicPermissionPage);
    }
  }

  function openMicPermissionPage() {
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
    } else {
      window.open(chrome.runtime.getURL("mic-permission.html"));
    }
  }

  async function runVoiceTriggerFlow(voiceInstruction) {
    if (!activeTabContextText || !activeTabContextText.trim()) {
      if (navigator.clipboard?.readText) {
        try {
          const clip = await navigator.clipboard.readText();
          if (clip && clip.trim().length >= 2) activeTabContextText = clip.trim();
        } catch {}
      }
    }

    const hasText = Boolean(activeTabContextText && activeTabContextText.trim());
    statusTitle.textContent = hasText
      ? "Applying voice command to text with Groq..."
      : "Answering voice query with Groq...";

    copyBtn.style.display = "none";
    mxCopyToChatBtn.style.display = "none";
    resultBody.innerHTML = `
      <div class="corsiri-spinner">
        <div class="corsiri-spin-circle"></div>
        <span>Applying voice command: "${escapeHtml(voiceInstruction)}"...</span>
      </div>
    `;

    chrome.runtime.sendMessage({
      type: "corsiri_query_action",
      action: "voice_command",
      text: activeTabContextText || voiceInstruction,
      voiceInstruction: voiceInstruction,
      question: voiceInstruction,
      activeUrl: activeTab?.url || "",
      pageTitle: activeTab?.title || ""
    }, (res) => {
      if (!res || !res.ok) {
        statusTitle.textContent = "Status: Voice processing error";
        resultBody.innerHTML = `<div style="color:#FF6B6B;">${escapeHtml(res?.error || "Failed")}</div>`;
        return;
      }
      currentRawResult = res.result;
      activeChatContextText = res.result;
      statusTitle.textContent = `Status: Complete (${res.model || "Groq"})`;
      copyBtn.style.display = "block";
      mxCopyToChatBtn.style.display = "flex";
      renderFormattedResponse(resultBody, res.result);
    });
  }

  // ── Rich Formula & Content Parser ──────────────────────────────────────────

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

      // Formulas (E = hf, etc.)
      if (isFormulaLine(line)) {
        const card = document.createElement("div");
        card.className = "corsiri-formula-card";
        card.textContent = cleanMathSymbols(line.replace(/\$\$/g, "").replace(/\*\*/g, ""));
        targetEl.appendChild(card);
        i++;
        continue;
      }

      // Section Headings
      if (line.startsWith("# ") || line.startsWith("## ")) {
        const h = document.createElement("h3");
        h.style.color = "#5EEBFF";
        h.style.fontSize = "14px";
        h.style.margin = "8px 0 4px 0";
        h.textContent = line.replace(/^#+\s*/, "");
        targetEl.appendChild(h);
        i++;
        continue;
      }

      // Subheadings (### or 1. Section)
      if (line.startsWith("### ") || /^\d+\.\s+[A-Za-z]/.test(line)) {
        const h = document.createElement("h4");
        h.style.color = "#FFDF7E";
        h.style.fontSize = "13px";
        h.style.margin = "6px 0 3px 0";
        h.textContent = line.replace(/^###\s*/, "").replace(/\*\*/g, "");
        targetEl.appendChild(h);
        i++;
        continue;
      }

      // Bullets
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

      // Paragraph
      const p = document.createElement("p");
      p.style.margin = "4px 0 6px 0";
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
      // Lingering braces
      .replace(/[{}]/g, "")
      // Extra whitespace
      .replace(/\s{2,}/g, " ")
      .trim();
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
