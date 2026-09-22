// Corsiri AI - Extension Settings Controller
(function () {
  const DEFAULT_KEY = "";
  const DEFAULT_MODEL = "openai/gpt-oss-120b";
  const DEFAULT_TEMP = 0.3;

  const apiKeyInput = document.getElementById("apiKey");
  const toggleKeyVisibilityBtn = document.getElementById("toggleKeyVisibility");
  const modelSelect = document.getElementById("modelSelect");
  const tempSlider = document.getElementById("temperature");
  const tempValueSpan = document.getElementById("tempValue");
  const floatingTriggerToggle = document.getElementById("enableFloatingTrigger");
  const textEmergeToggle = document.getElementById("enableTextEmergeAnimation");
  const contextMenuToggle = document.getElementById("enableContextMenu");
  const defaultActionSelect = document.getElementById("defaultAction");
  const testConnectionBtn = document.getElementById("testConnectionBtn");
  const testResultText = document.getElementById("testResult");
  const connectionBadge = document.getElementById("connectionBadge");
  const saveBtn = document.getElementById("saveBtn");
  const resetDefaultsBtn = document.getElementById("resetDefaultsBtn");
  const optMicBadge = document.getElementById("optMicBadge");
  const optMicDesc = document.getElementById("optMicDesc");
  const optGrantMicBtn = document.getElementById("optGrantMicBtn");
  const toastEl = document.getElementById("toast");

  // Personalization DOM elements
  const popupSizeSelect = document.getElementById("popupSize");
  const popupPositionSelect = document.getElementById("popupPosition");
  const themeModeSelect = document.getElementById("themeMode");
  const actionOrderPresetSelect = document.getElementById("actionOrderPreset");
  const defaultTranslationLanguageSelect = document.getElementById("defaultTranslationLanguage");
  const defaultReplyToneSelect = document.getElementById("defaultReplyTone");

  const actShowFixIt = document.getElementById("actShowFixIt");
  const actShowExplain = document.getElementById("actShowExplain");
  const actShowDebug = document.getElementById("actShowDebug");
  const actShowTranslate = document.getElementById("actShowTranslate");
  const actShowSummarize = document.getElementById("actShowSummarize");
  const actShowReply = document.getElementById("actShowReply");
  const actShowMultiCopy = document.getElementById("actShowMultiCopy");
  const actShowSearch = document.getElementById("actShowSearch");

  const enableGlobalHotkeyToggle = document.getElementById("enableGlobalHotkey");
  const enableConsoleToggleHotkeyToggle = document.getElementById("enableConsoleToggleHotkey");
  const enableSnipHotkeyToggle = document.getElementById("enableSnipHotkey");

  const voiceLanguageSelect = document.getElementById("voiceLanguage");
  const voiceAutoListenToggle = document.getElementById("voiceAutoListen");

  init();

  async function init() {
    setupEventListeners();
    await loadSettings();
    await checkConnectionStatus();
    await checkMicPermission();
  }

  function setupEventListeners() {
    toggleKeyVisibilityBtn.addEventListener("click", toggleKeyVisibility);

    tempSlider.addEventListener("input", (e) => {
      tempValueSpan.textContent = e.target.value;
    });

    testConnectionBtn.addEventListener("click", runConnectionTest);
    saveBtn.addEventListener("click", saveSettings);
    resetDefaultsBtn.addEventListener("click", resetDefaults);
    if (optGrantMicBtn) optGrantMicBtn.addEventListener("click", requestOptMicrophone);
  }

  function toggleKeyVisibility() {
    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleKeyVisibilityBtn.textContent = "🔒 Hide";
    } else {
      apiKeyInput.type = "password";
      toggleKeyVisibilityBtn.textContent = "👁 Show";
    }
  }

  async function loadSettings() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "corsiri_get_config" }, resolve);
      });

      const config = response?.config || {};
      const stored = await chrome.storage.local.get([
        "enableFloatingTrigger",
        "enableTextEmergeAnimation",
        "corsiri_emerge_animation",
        "enableContextMenu",
        "defaultAction",
        "popupSize",
        "popupPosition",
        "themeMode",
        "actionOrderPreset",
        "defaultTranslationLanguage",
        "defaultReplyTone",
        "actionsShown",
        "enableGlobalHotkey",
        "enableConsoleToggleHotkey",
        "enableSnipHotkey",
        "voiceLanguage",
        "voiceAutoListen"
      ]);

      apiKeyInput.value = config.groqApiKey || DEFAULT_KEY;
      modelSelect.value = config.groqModel || DEFAULT_MODEL;
      const temp = config.groqTemperature ?? DEFAULT_TEMP;
      tempSlider.value = temp;
      tempValueSpan.textContent = temp;

      floatingTriggerToggle.checked = stored.enableFloatingTrigger !== false;
      if (textEmergeToggle) {
        textEmergeToggle.checked = (stored.enableTextEmergeAnimation !== false && stored.corsiri_emerge_animation !== false);
      }
      contextMenuToggle.checked = stored.enableContextMenu !== false;
      defaultActionSelect.value = stored.defaultAction || "explain";

      // Personalization fields
      if (popupSizeSelect) popupSizeSelect.value = stored.popupSize || "standard";
      if (popupPositionSelect) popupPositionSelect.value = stored.popupPosition || "smart";
      if (themeModeSelect) themeModeSelect.value = stored.themeMode || "dark";
      if (actionOrderPresetSelect) actionOrderPresetSelect.value = stored.actionOrderPreset || "default";
      if (defaultTranslationLanguageSelect) defaultTranslationLanguageSelect.value = stored.defaultTranslationLanguage || "English";
      if (defaultReplyToneSelect) defaultReplyToneSelect.value = stored.defaultReplyTone || "Professional";

      const acts = stored.actionsShown || {};
      if (actShowFixIt) actShowFixIt.checked = acts.fix_it !== false;
      if (actShowExplain) actShowExplain.checked = acts.explain !== false;
      if (actShowDebug) actShowDebug.checked = acts.debug !== false;
      if (actShowTranslate) actShowTranslate.checked = acts.translate !== false;
      if (actShowSummarize) actShowSummarize.checked = acts.summarize !== false;
      if (actShowReply) actShowReply.checked = acts.reply !== false;
      if (actShowMultiCopy) actShowMultiCopy.checked = acts.multicopy !== false;
      if (actShowSearch) actShowSearch.checked = acts.search !== false;

      if (enableGlobalHotkeyToggle) enableGlobalHotkeyToggle.checked = stored.enableGlobalHotkey !== false;
      if (enableConsoleToggleHotkeyToggle) enableConsoleToggleHotkeyToggle.checked = stored.enableConsoleToggleHotkey !== false;
      if (enableSnipHotkeyToggle) enableSnipHotkeyToggle.checked = stored.enableSnipHotkey !== false;

      if (voiceLanguageSelect) voiceLanguageSelect.value = stored.voiceLanguage || "en-US";
      if (voiceAutoListenToggle) voiceAutoListenToggle.checked = !!stored.voiceAutoListen;
    } catch (err) {
      console.warn("Failed to load settings:", err);
      apiKeyInput.value = DEFAULT_KEY;
      modelSelect.value = DEFAULT_MODEL;
    }
  }

  async function saveSettings() {
    const config = {
      groqApiKey: apiKeyInput.value.trim() || DEFAULT_KEY,
      groqModel: modelSelect.value,
      groqTemperature: parseFloat(tempSlider.value) || 0.3
    };

    const uiPreferences = {
      enableFloatingTrigger: floatingTriggerToggle.checked,
      enableTextEmergeAnimation: textEmergeToggle ? textEmergeToggle.checked : true,
      corsiri_emerge_animation: textEmergeToggle ? textEmergeToggle.checked : true,
      enableContextMenu: contextMenuToggle.checked,
      defaultAction: defaultActionSelect.value
    };

    const personalization = {
      popupSize: popupSizeSelect ? popupSizeSelect.value : "standard",
      popupPosition: popupPositionSelect ? popupPositionSelect.value : "smart",
      themeMode: themeModeSelect ? themeModeSelect.value : "dark",
      actionOrderPreset: actionOrderPresetSelect ? actionOrderPresetSelect.value : "default",
      defaultTranslationLanguage: defaultTranslationLanguageSelect ? defaultTranslationLanguageSelect.value : "English",
      defaultReplyTone: defaultReplyToneSelect ? defaultReplyToneSelect.value : "Professional",
      actionsShown: {
        fix_it: actShowFixIt ? actShowFixIt.checked : true,
        explain: actShowExplain ? actShowExplain.checked : true,
        debug: actShowDebug ? actShowDebug.checked : true,
        translate: actShowTranslate ? actShowTranslate.checked : true,
        summarize: actShowSummarize ? actShowSummarize.checked : true,
        reply: actShowReply ? actShowReply.checked : true,
        multicopy: actShowMultiCopy ? actShowMultiCopy.checked : true,
        search: actShowSearch ? actShowSearch.checked : true
      },
      enableGlobalHotkey: enableGlobalHotkeyToggle ? enableGlobalHotkeyToggle.checked : true,
      enableConsoleToggleHotkey: enableConsoleToggleHotkeyToggle ? enableConsoleToggleHotkeyToggle.checked : true,
      enableSnipHotkey: enableSnipHotkeyToggle ? enableSnipHotkeyToggle.checked : true,
      voiceLanguage: voiceLanguageSelect ? voiceLanguageSelect.value : "en-US",
      voiceAutoListen: voiceAutoListenToggle ? voiceAutoListenToggle.checked : false
    };

    try {
      // Save LLM config through background service
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "corsiri_save_config",
          config
        }, resolve);
      });

      // Save UI & Personalization preferences
      await chrome.storage.local.set({
        ...uiPreferences,
        ...personalization
      });

      showToast("✓ Settings saved successfully!");
      await checkConnectionStatus();
    } catch (err) {
      showToast("⚠️ Error saving settings: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }

  async function resetDefaults() {
    if (!confirm("Reset all settings back to defaults?")) return;

    apiKeyInput.value = DEFAULT_KEY;
    modelSelect.value = DEFAULT_MODEL;
    tempSlider.value = DEFAULT_TEMP;
    tempValueSpan.textContent = DEFAULT_TEMP;
    floatingTriggerToggle.checked = true;
    if (textEmergeToggle) textEmergeToggle.checked = true;
    contextMenuToggle.checked = true;
    defaultActionSelect.value = "explain";

    if (popupSizeSelect) popupSizeSelect.value = "standard";
    if (popupPositionSelect) popupPositionSelect.value = "smart";
    if (themeModeSelect) themeModeSelect.value = "dark";
    if (actionOrderPresetSelect) actionOrderPresetSelect.value = "default";
    if (defaultTranslationLanguageSelect) defaultTranslationLanguageSelect.value = "English";
    if (defaultReplyToneSelect) defaultReplyToneSelect.value = "Professional";

    if (actShowFixIt) actShowFixIt.checked = true;
    if (actShowExplain) actShowExplain.checked = true;
    if (actShowDebug) actShowDebug.checked = true;
    if (actShowTranslate) actShowTranslate.checked = true;
    if (actShowSummarize) actShowSummarize.checked = true;
    if (actShowReply) actShowReply.checked = true;
    if (actShowMultiCopy) actShowMultiCopy.checked = true;
    if (actShowSearch) actShowSearch.checked = true;

    if (enableGlobalHotkeyToggle) enableGlobalHotkeyToggle.checked = true;
    if (enableConsoleToggleHotkeyToggle) enableConsoleToggleHotkeyToggle.checked = true;
    if (enableSnipHotkeyToggle) enableSnipHotkeyToggle.checked = true;

    if (voiceLanguageSelect) voiceLanguageSelect.value = "en-US";
    if (voiceAutoListenToggle) voiceAutoListenToggle.checked = false;

    await saveSettings();
  }

  async function runConnectionTest() {
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = "⏳ Testing...";
    testResultText.textContent = "Pinging Groq LPU API...";
    testResultText.className = "test-result-text";

    const startTime = Date.now();

    try {
      // Save current input temporarily before testing
      const keyToTest = apiKeyInput.value.trim() || DEFAULT_KEY;
      if (!keyToTest || !keyToTest.startsWith("gsk_")) {
        throw new Error("Please enter a valid Groq API Key (starts with 'gsk_')");
      }
      const modelToTest = modelSelect.value;

      await chrome.storage.local.set({
        groqApiKey: keyToTest,
        groqModel: modelToTest
      });

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "corsiri_chat_query",
          messages: [{ role: "user", content: "Reply with the exact word 'READY' and nothing else." }]
        }, resolve);
      });

      const latencyMs = Date.now() - startTime;

      if (response && response.ok) {
        testResultText.textContent = `✓ Connected! Model: ${response.model || modelToTest} (${latencyMs}ms)`;
        testResultText.className = "test-result-text success";
        updateBadge("connected", "Connected");
      } else {
        throw new Error(response?.error || "Unknown Groq error");
      }
    } catch (err) {
      testResultText.textContent = `✕ Connection failed: ${err.message}`;
      testResultText.className = "test-result-text error";
      updateBadge("disconnected", "Offline");
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionBtn.textContent = "⚡ Test Groq Connection";
    }
  }

  async function checkConnectionStatus() {
    updateBadge("checking", "Checking...");
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "corsiri_chat_query",
          messages: [{ role: "user", content: "Say OK" }]
        }, resolve);
      });

      if (response?.ok) {
        updateBadge("connected", "Connected");
      } else {
        updateBadge("disconnected", "Offline");
      }
    } catch {
      updateBadge("disconnected", "Offline");
    }
  }

  function updateBadge(state, label) {
    connectionBadge.className = `status-badge ${state}`;
    connectionBadge.textContent = label;
  }

  function showToast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.style.borderColor = isError ? "var(--danger-color)" : "var(--accent-cyan)";
    toastEl.classList.add("show");

    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2500);
  }

  async function checkMicPermission() {
    if (!optMicBadge) return;
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const perm = await navigator.permissions.query({ name: "microphone" });
        updateOptMicDisplay(perm.state);
        perm.onchange = () => updateOptMicDisplay(perm.state);
        return;
      } catch {}
    }
    optMicBadge.textContent = "Not Tested";
  }

  function updateOptMicDisplay(state) {
    if (!optMicBadge) return;
    if (state === "granted") {
      optMicBadge.textContent = "✓ Allowed";
      optMicBadge.style.background = "rgba(16, 185, 129, 0.15)";
      optMicBadge.style.color = "#10B981";
      optMicBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
      if (optMicDesc) optMicDesc.textContent = "Microphone access is active and ready for Hold to Talk across all pages.";
      if (optGrantMicBtn) {
        optGrantMicBtn.textContent = "✓ Test Microphone";
      }
    } else if (state === "denied") {
      optMicBadge.textContent = "❌ Blocked";
      optMicBadge.style.background = "rgba(255, 107, 107, 0.15)";
      optMicBadge.style.color = "#FF6B6B";
      optMicBadge.style.borderColor = "rgba(255, 107, 107, 0.3)";
      if (optMicDesc) optMicDesc.textContent = "Microphone is blocked in Chrome settings. Click lock icon in address bar to Allow.";
      if (optGrantMicBtn) optGrantMicBtn.textContent = "🔄 Re-request Access";
    } else {
      optMicBadge.textContent = "● Not Yet Granted";
      optMicBadge.style.background = "rgba(255, 223, 126, 0.12)";
      optMicBadge.style.color = "#FFDF7E";
      optMicBadge.style.borderColor = "rgba(255, 223, 126, 0.25)";
      if (optGrantMicBtn) optGrantMicBtn.textContent = "🎙️ Enable Microphone";
    }
  }

  async function requestOptMicrophone() {
    if (!optGrantMicBtn) return;
    optGrantMicBtn.disabled = true;
    optGrantMicBtn.textContent = "⏳ Requesting...";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      updateOptMicDisplay("granted");
      showToast("Microphone access enabled successfully!");
    } catch (err) {
      updateOptMicDisplay("denied");
      showToast("Could not access microphone: " + err.message, true);
    } finally {
      optGrantMicBtn.disabled = false;
    }
  }
})();
