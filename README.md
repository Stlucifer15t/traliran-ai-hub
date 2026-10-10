# 💎 Traliran AI Hub

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

A lightweight, serverless, and privacy-first AI web client and sandbox running directly in your browser. Features a built-in code execution environment, a full-fledged AI IDE, and a parallel model benchmarking tool. Connect directly to Groq, Gemini, OpenAI, OpenRouter, DeepSeek, Qwen, GLM, Claude, and local backends (Ollama / Llama.cpp) without middlemen.

## ⚠️ Warning! ⚠️

> When you export a custom bot configuration that you've created, **your API keys are also exported**.
> 
> So before sharing your configuration, **REMOVE YOUR API KEYS FROM THE .json FILE**
> 
> P.S. This was designed to make it easy to import or restore your session later.


<img width="1866" height="1032" alt="image" src="https://github.com/user-attachments/assets/9a5bc0a3-eea5-4027-a76a-03c72e10bbc6" />

<img width="1873" height="1030" alt="image" src="https://github.com/user-attachments/assets/7ee56e9d-e4bd-4cac-b466-afe62f79816b" />

<img width="1873" height="1033" alt="image" src="https://github.com/user-attachments/assets/9b8c7d1e-9ead-4435-913e-3c638d9077c1" />

<img width="1876" height="1030" alt="image" src="https://github.com/user-attachments/assets/26a26954-dbe2-448a-84a9-279bc44f8495" />

<img width="1878" height="1036" alt="image" src="https://github.com/user-attachments/assets/513f0060-f5e7-414b-883a-5e651124a529" />

---

### 🛠️ Custom Builds & B2B Deployments

Need a branded, zero-server AI workspace tailored for your team or agency?
I build custom deployments with pre-configured prompt libraries, custom UI, and lightweight local storage/sync options.

👉 **[Read B2B / Custom Build Docs](https://github.com/traliran/traliran-ai-hub/wiki/Custom-Builds-and-B2B)** or **[Order via Google Form](https://forms.gle/XpTQRCrpGdsbPiR48)**
---

## ✨ Live Web App & Preset Store
👉 **[Launch Traliran AI Hub on GitHub Pages](https://traliran.github.io/traliran-ai-hub/)**

### Assistant Store

The Assistant Store is free. It ships about 38 ready-made assistants in seven categories (Write, Code, Learn, Work, Create, Languages, Think), such as Code Reviewer, Debug Detective, Socratic Tutor and Meeting Notes. Search, filter, and tap **Use** to load one. You can also write your own prompt, which is saved only on your device. Nothing is sold or linked to a paid service.

---

## 🛡️ 100% Privacy-First & Serverless
* **Zero Middleman Servers:** The application is 100% client-side and runs directly in your browser.
* **Direct Routing:** Your API keys are stored strictly in your browser's `LocalStorage` and sent straight to official provider endpoints. No logs, no data collection, no leaks.
* **AGPLv3 Guaranteed:** Complete freedom to audit, inspect, and self-host, backed by a strong copyleft license.

---

## 🚀 Key Features

*   **Multi-Provider Support:** Seamlessly switch between top cloud APIs (Groq, Gemini, OpenAI, OpenRouter, DeepSeek, Qwen, GLM, Claude) and local LLMs (Ollama, Llama.cpp).
*   **⚡ Multi-Model Setup & Compare:** Select multiple models simultaneously — including across different providers (Groq + OpenAI + Claude, local models, etc.), each using its own configured API key. The app triggers parallel requests and renders side-by-side comparative cards with per-model and per-provider labels for instant benchmarking.
*   **💡 Model Thinking Support:** Native rendering for reasoning models (like DeepSeek-R1). Structural thoughts are captured and organized into a clean, collapsible hidden dropdown block.
*   **👥 AI Group Debate Mode:** Turn your raw ideas into fully analyzed concepts. Run a multi-agent discussion loop where specialized personas (Optimist, Critic, and Technologist) cross-examine your thesis over multiple rounds.
*   **⚡ AI IDE - Integrated Development Environment:** A full-fledged in-browser IDE for code generation, editing, and project management, powered by your chosen AI model.
    *   **Multi-Repository Workspaces:** Create, switch, and delete repositories. Each repo keeps its own files, commits, branches, and git refs; new repos start empty.
    *   **Real Git:** Commits bound to repo + branch, per-branch history, branches forked from the current branch, cascading delete of branches/repos with their commits (GIT tab).
    *   **Git-Compatible ZIP Export/Import:** Export packs the working tree plus a real `.git/` readable by the Git CLI (offline, zero dependencies); import restores files, history, and branches.
    *   **File Explorer:** Create/rename files and folders manually (HTML, CSS, JS, etc.) or via the AI agent.
    *   **Code Editor:** Edit files with a monospaced code editor.
    *   **Live Preview:** Instantly preview HTML/JS/CSS code changes in a separate browser tab or the inline panel.
    *   **AI Agent:** Multi-chat agent with tool calling (`list/read/write/edit/rename` files), image attachments (upload, camera, `Ctrl+V` paste), and a fullscreen Agentic-only mode.
    *   **Cloud Sync (optional):** Sync workspace via Firebase, Supabase, PocketBase, or a generic backend, with an offline queue.
    *   **Project Management:** Download your entire workspace as a `.zip` or reset it.
*   **📚 RAG Playground:** Build a local knowledge base, run dedicated RAG chats over it, and export Hub notes straight into the knowledge base.
*   **☁️ Cloud Sync:** Optional Firebase / Supabase / PocketBase / generic-backend sync with offline queueing for sessions, notes, VFS files, commits, and agent chats.
*   **💻 Built-in Sandbox Interpreter:** Execute, preview, and test generated HTML/JS/CSS code snippets securely in an isolated iframe without leaving the main chat workspace.
*   **🏪 Assistant Store:** A free library of about 38 ready-made assistants with search and categories, plus a builder for your own prompts saved on-device.
*   **⚙️ Advanced Parameters Control:** Fine-tune system behaviors with on-the-fly adjustable sliders for Temperature, Top P, and Max Tokens configuration.
*   **🧩 MCP (Model Context Protocol):** Connect remote MCP servers over Streamable HTTP and expose their tools to the AI as function-calling tools — just like an IDE agent. The model decides when to call a tool, the hub proxies the call, feeds the result back, and repeats. Works with any Streamable HTTP MCP endpoint; configure servers in the **🧩 MCP Servers** modal.

---

## 🧩 MCP (Model Context Protocol)

MCP lets you plug external tools into the chat. The client (`mcp.js`) speaks JSON-RPC 2.0 over Streamable HTTP to any remote MCP server and turns its tools into OpenAI-style function tools used by the agentic loop.

**Connect a server:** open **🧩 MCP Servers**, enter a name + URL (and an optional `Bearer` auth header), hit **Add & Connect**. Servers are saved in `LocalStorage` and auto-reconnect on startup. You can also add one from the console:

```js
const entry = MCP_MANAGER.add({ name: 'MyServer', url: 'https://host/mcp', authHeader: '' });
await MCP_MANAGER.connectOne(entry.id);
```

**Write your own server:** implement a `POST` endpoint handling `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`, return an `Mcp-Session-Id` header, and emit CORS. 

> Note: the agentic MCP mode runs only when a **single** model is selected (it is disabled in multi-model compare mode), and your server must allow CORS from the app's domain.

---

### 🐳 Run via Docker (Self-Hosted)

If you want to run this app locally using Docker, you can build and run it yourself:

1. Clone the repository:
```
   git clone https://github.com/traliran/traliran-ai-hub.git
   cd traliran-ai-hub
```
2. Build the Docker image:
```
docker build -t traliran-ai-hub .
```
3. Run the container:
```
docker run -d -p 8080:80 traliran-ai-hub
```
Open http://localhost:8080 in your browser.

   
## 📱 Android build & mobile IDE (fork changes)

This fork packages the same static app as an Android APK with [Capacitor](https://capacitorjs.com) and adds a phone-friendly IDE. The web app still runs from the repo root with no build step (GitHub Pages, Docker); the Capacitor bundle is generated into `www/`.

**Build the APK**

```bash
npm ci
npm run build        # bundles vendor/ and writes www/
npm run cap:sync     # copies www/ into android/
cd android && ./gradlew assembleDebug
```

CI builds the debug APK on every push (`.github/workflows`, Android APK workflow). Monaco (about 13 MB) is never committed; `www/` gets it at package time only.

**What changed**

- **Native shell:** CAMERA permission, app icon and splash screen, Android back button (closes panes first), `anthropic-dangerous-direct-browser-access` header on Anthropic requests, downloads through Capacitor Filesystem and Share, and inline previews on phones instead of `window.open` blob URLs.
- **Local models:** LAN endpoint entry for Ollama and llama.cpp, cleartext HTTP and mixed-content settings for LAN use, and an `OLLAMA_ORIGINS` setup hint.
- **Phone IDE:** one pane at a time (Chat, Files, Code, Preview) with bottom tabs and swipe. CodeMirror 6 replaces Monaco on phones, with a symbol row (`{ } ( ) ; = < > Tab`).
- **AI change review:** each AI edit shows a per-file diff with Accept and Reject, plus one-tap undo.
- **Preview:** auto-refresh after AI changes for web files, console and error panel, and a "Fix this error" button that sends the error to the agent.
- **Agent tools:** plan mode (the agent lists steps and waits for approval), `@file` mentions and pinned files as context, prompt templates, project presets (landing page, game, tool, PWA), screenshot-to-code, voice input, and "continue" for truncated output.
- **Models and cost:** a cheaper model for edits and a stronger one for planning, with a token and cost counter. Streaming with a Stop button.
- **Reliability:** partial replies are autosaved, and messages that fail on a dropped connection go into an offline queue and are retried. Note that a remote stream cannot be resumed; the partial text is kept and the message is retried.
- **Design:** graphite ink palette with one amber accent, Geist and Geist Mono bundled in `vendor/fonts/` (offline), new brand lockup. The colour scales are generated by `scripts/build-theme.py` into `theme-palette.css`.
- **Security:** API keys are encrypted at rest. Exports strip keys by default; including them is an explicit opt-in.

**Status:** the Android build runs in CI. Device behaviour (WebView quirks, local model access over LAN, voice on Android) has not yet been verified on hardware.

**Credits and licence:** all original authors, the LICENSE (AGPL-3.0), and the Assistant Store are kept as they were. Source for any modified version you distribute or host must remain available under AGPL-3.0.

## ⚖️ License & Open Source Terms

This project is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

### What this means for forks and deployments:
1.  **Keep it Open:** If you modify this software and run it on a server accessible to users over a network (e.g., SaaS or public websites), you **MUST** make your modified source code publicly available under the AGPLv3 license.
2.  **Attribution:** You must retain original copyright notices, links to this repository, and state any changes made.
3.  **No Hidden Commercialization:** You cannot close the source code or hide integrated core features (including the store and author credits) in public deployments.

*For custom commercial licensing or private white-label partnerships without AGPLv3 restrictions, please contact the repository maintainer via email: cwcom@proton.me.*

## Linux pages look (AiCode direction)

The Linux terminal and workspace pages now follow the look of the AiCode Android app (GPL-3.0): dark graphite surfaces, a green accent, a state badge, and a bottom tab bar (Terminal / Files / Git). The styles are in `linux-look.css`; no AiCode asset is copied. Credits and licence notes are in `THIRD_PARTY_NOTICES.md`.

The app-wide palette now follows the same direction: graphite surfaces, a green accent (#4ADE80) in place of the amber. The Hub colour scales are regenerated by `scripts/build-theme.py`.
The chat composer is now one rounded input bar, with attach and camera as icon chips (AiCode direction).

Agent modes (Build, Plan, Auto) are set from the button in the agent header. Plan is read-only: the tool loop blocks every tool except list_files and read_file. Auto runs run_command without the approval wait, limited to /root/projects; the command card still shows the output. "Plan first" is a separate setting.

Checkpoints: every message you send to the agent records a checkpoint. After the agent changes files, the review card has "Undo code and chat" (restores the files the turn changed and cuts the chat back to where it was) and "Undo chat only". Checkpoints are kept for the last 30 messages. Renames are not tracked yet.

Rules, memory and skills: the Rules button in the agent header opens a panel. Global rules and AGENTS.md (project root) are added to every agent prompt. The agent saves notes with remember, removes them with forget, and reads a skill with load_skill when it needs it. Everything is stored on the device. Prompt files and the grouping follow AiCode (GPL-3.0, see THIRD_PARTY_NOTICES.md).

Sub-agents: the agent can call spawn_subagent(agent, task). The sub-agent runs in its own context with a short tool loop (at most 6 model turns) and returns one report, so the main chat stays short. The built-in explore agent is read-only. Custom sub-agents (name, prompt, tools, optional model) are added in the Rules panel. Sub-agents cannot start sub-agents, and every tool they use goes through the PLAN gate.

## Container & images (AiCode direction)

The Linux terminal has a **Images** button. It opens a Container & images panel:

- **Installed** lists the images on the device. The active one runs in the next shell. Switching stops the current shell. Built-in images cannot be deleted, and neither can the active image.
- **Download** lists Alpine 3.21 to 3.24, Ubuntu 20.04, 22.04 and 24.04, and Debian 12 and 13. Debian 12 and 13 come from the Debian official-images build, and each one is checked against its published `.sha256`. The installer reads `.tar.xz` archives. Debian is the only image that uses xz.

Each image is stored in its own folder under the app's private storage. Downloads come only from `dl-cdn.alpinelinux.org`, `cdimage.ubuntu.com` and `doi-janky.infosiftr.net` (Debian), over https, and each one must match its published SHA-256 checksum before it is unpacked. The image list follows AiCode (GPL-3.0). See `THIRD_PARTY_NOTICES.md`.
