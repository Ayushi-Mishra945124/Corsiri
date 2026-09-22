document.addEventListener("DOMContentLoaded", async () => {
  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");
  const btnGrantMic = document.getElementById("btnGrantMic");
  const actionContainer = document.getElementById("actionContainer");
  const troubleshootCard = document.getElementById("troubleshootCard");
  const headline = document.getElementById("headline");
  const subtext = document.getElementById("subtext");
  const iconDisplay = document.getElementById("iconDisplay");

  await checkExistingPermission();

  btnGrantMic.addEventListener("click", requestMicrophone);

  async function checkExistingPermission() {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: "microphone" });
        updateStatusDisplay(result.state);
        result.onchange = () => {
          updateStatusDisplay(result.state);
        };
      } catch {
        statusBadge.className = "status-badge";
        statusText.textContent = "Click below to grant microphone access";
      }
    } else {
      statusBadge.className = "status-badge";
      statusText.textContent = "Click below to grant microphone access";
    }
  }

  function updateStatusDisplay(state) {
    if (state === "granted") {
      setGrantedUI();
    } else if (state === "denied") {
      setDeniedUI("Microphone permission is blocked in Chrome settings");
    } else {
      statusBadge.className = "status-badge";
      statusText.textContent = "Ready: Click below to grant access";
    }
  }

  async function requestMicrophone() {
    btnGrantMic.disabled = true;
    btnGrantMic.textContent = "⏳ Requesting permission in Chrome...";
    statusBadge.className = "status-badge";
    statusText.textContent = "Waiting for your approval in the Chrome prompt...";

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia not supported in this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop all tracks cleanly once permission is acquired
      stream.getTracks().forEach((track) => track.stop());

      // Save flag in extension storage for fast lookup
      chrome.storage?.local?.set?.({ corsiri_mic_granted: true });

      setGrantedUI();
    } catch (err) {
      console.warn("Microphone request error:", err);
      const isDenied = err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
      setDeniedUI(isDenied ? "Permission dismissed or blocked" : (err.message || "Microphone inaccessible"));
    }
  }

  function setGrantedUI() {
    statusBadge.className = "status-badge granted";
    statusText.textContent = "✓ Microphone Permission Granted!";
    iconDisplay.textContent = "✅";
    headline.textContent = "You're All Set!";
    subtext.innerHTML = "Microphone access is now permanently enabled for Corsiri AI.<br>You can close this tab and start using <strong>Hold to Talk</strong> anytime.";
    troubleshootCard.style.display = "none";

    actionContainer.innerHTML = `
      <button class="action-btn" id="btnCloseTab" style="background: linear-gradient(135deg, #10B981, #059669);">
        ✓ Done — Ready to Use
      </button>
      <button class="action-btn btn-close" id="btnCloseTabSecondary">
        ✕ Close Tab
      </button>
    `;

    document.getElementById("btnCloseTab")?.addEventListener("click", () => {
      window.close();
    });
    document.getElementById("btnCloseTabSecondary")?.addEventListener("click", () => {
      window.close();
    });
  }

  function setDeniedUI(msg) {
    statusBadge.className = "status-badge denied";
    statusText.textContent = `❌ ${msg}`;
    iconDisplay.textContent = "⚠️";
    btnGrantMic.disabled = false;
    btnGrantMic.textContent = "🔄 Try Again";
    troubleshootCard.style.display = "block";
  }
});
