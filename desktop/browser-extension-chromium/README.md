# Corsiri AI — Chromium Web Extension

A powerful, standalone Chromium extension (Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi) that brings high-speed Groq AI reasoning directly into your browser workflow.

---

## 🌟 Key Features

1. **In-Page Floating Assistant (Cursor-Native)**:
   - Highlight any text (concepts, physics formulas, questions, code) on any website.
   - Click the floating **Corsiri** badge to instantly open the glassmorphic assistant card.
   - Quick action chips:
     - `✨ Explain`: Clear, numbered conceptual breakdown with key takeaways.
     - `⚡ Solve & Formulas`: Centered mathematical/physics equation cards ($E=hf$, $\lambda=\frac{h}{p}$, $E=mc^2$), variable definitions, and step-by-step solutions.
     - `📝 Summarize`: Clean, high-yield bullet points.
     - `🎯 Key Points`: Essential rules, principles, and exam/work takeaways.
     - `✍ Polish`: Text rewriting and enhancement.
   - Drag anywhere on the screen with the top header bar.
   - Isolated in a Shadow DOM to avoid conflicts with host page styles (Tailwind, Bootstrap, etc.).

2. **Browser Toolbar Chat Popup**:
   - Click the Corsiri icon in your browser toolbar to open the full chat assistant.
   - Automatically detects the active webpage context, title, and URL.
   - Preserves recent conversation history locally in `chrome.storage.local`.
   - Formats formulas into centered equation cards and tables into structured cards.

3. **Direct Groq Cloud Integration**:
   - Connects directly to Groq's low-latency inference LPU (e.g. `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `llama-3.3-70b-versatile`).
   - Works fully standalone in your browser without requiring external backend servers or desktop apps.

4. **Right-Click Context Menus**:
   - Right-click any highlighted text to trigger `Corsiri AI: Explain`, `Solve & Formulas`, or `Summarize`.

5. **Options & Customization UI**:
   - Manage your Groq API key and select preferred models.
   - Test connection latency in real time.
   - Toggle the in-page selection pill and context menu items.

6. **Desktop Companion Bridge (Backward Compatible)**:
   - Retains full support for DOM context capture and step execution with the Corsiri desktop companion via the native bridge or HTTP (`http://127.0.0.1:48830`).

---

## 🚀 How to Install in Your Browser

### Step 1: Open Extension Management
- **Google Chrome**: Navigate to `chrome://extensions`
- **Microsoft Edge**: Navigate to `edge://extensions`
- **Brave**: Navigate to `brave://extensions`

### Step 2: Enable Developer Mode
- Toggle the **Developer mode** switch (usually located in the top-right corner of the page).

### Step 3: Load Unpacked Extension
1. Click the **Load unpacked** button in the top left.
2. Select the directory:
   ```text
   C:\Users\ayush\Desktop\Corsor_ai\XCursor-AI\desktop\browser-extension-chromium
   ```
3. Click **Select Folder**.

### Step 4: Pin to Toolbar
- Click the Extensions puzzle piece icon (`🧩`) in your browser toolbar.
- Click the pin icon next to **Corsiri AI** so it is always accessible.

---

## ⚙️ Configuration

1. Click the **Corsiri AI** icon in your toolbar, then click the gear icon (`⚙`) in the header (or right-click the extension icon and choose **Options**).
2. The extension is pre-configured with Groq and model `openai/gpt-oss-120b`.
3. Click **⚡ Test Groq Connection** to confirm connectivity.

---

## 📖 How to Use

- **Highlight Any Text**: Select any paragraph, math formula, or question on any webpage. A floating cyan `Corsiri` pill will appear. Click it to open the floating card.
- **Formulas & Math**: Solve equations with clean, centered formula displays and defined variables (no broken ASCII pipe tables).
- **Toolbar Assistant**: Open the extension popup to ask general questions or discuss the active webpage.
