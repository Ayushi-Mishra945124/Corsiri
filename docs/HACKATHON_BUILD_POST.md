# How I Built Corsiri: A Cursor-Native Amazon Nova UI Agent

I created this content for the Amazon Nova AI Hackathon.  
#AmazonNovaCode

## Introduction

Most AI products still start with the same workflow: open a chatbot, describe the context, paste content, wait for an answer, then manually apply that answer somewhere else.

I wanted to build something different.

That idea became **Corsiri**:

> **Selection = Context, Trigger = Intent, Nova = Intelligence**

Instead of moving work into a prompt box, Corsiri brings AI directly to what the user is already looking at. The user selects text, an image, or a UI region, presses a trigger, and Amazon Nova decides the most useful action based on context. Then Corsiri either returns a useful result or takes action directly in the browser UI.

## What Corsiri Does

Corsiri is a **cursor-native multimodal AI agent** designed for desktop workflows.

It can:

- summarize long reports and articles
- explain or debug selected code
- rewrite rough text or emails
- draft responses to emails
- analyze selected images
- accept voice commands via Nova 2 Sonic
- autofill forms
- reply in live browser tabs

The goal is to move beyond text-in/text-out AI and toward an interaction model where the AI becomes part of the interface itself.

## Core Product Idea

The main interaction loop is very simple:

1. The user selects something on screen
2. The user presses a trigger
3. Amazon Nova reasons about the selection
4. Corsiri returns the most useful result
5. The user can optionally press **Take Action** to execute it in the UI

That means a selection is not just text. It is context.

This makes Corsiri a strong fit for the **UI Automation** and **Voice AI** categories of the Amazon Nova AI Hackathon, because it does not stop at answering. It interprets screen context and can output executable actions for the interface, and uses Nova 2 Sonic for real-time voice interaction.

## How I Built It

Corsiri is built as a multi-part system:

- a **Windows companion app** in WPF and .NET 8
- a **Nova backend** in Node.js using the **AWS Bedrock SDK** (Converse API)
- a **Nova 2 Sonic voice pipeline** for real-time hold-to-talk capture and transcription
- a **Chromium browser extension** for real current-tab actions
- a **local browser bridge** for DOM-aware execution
- an **AWS deployment path** for the backend (ECR + App Runner)
- integration with the **Logitech MX Creative Console** interaction model

### Amazon Nova Models Used

- **Nova 2 Lite** — fast, cost-effective multimodal reasoning for text, image, and intent routing via the Bedrock Converse API
- **Nova 2 Sonic** — real-time speech-to-speech via `InvokeModelWithBidirectionalStream` for the voice command path
- **Nova Act** — UI workflow automation (Python SDK) for the browser action planning layer

The backend handles:

- contextual reasoning via Nova 2 Lite
- multimodal text and image understanding
- dynamic action suggestion
- voice transcription and real-time voice via Nova 2 Sonic
- browser action planning

The companion app handles:

- text selection capture
- lasso screenshot capture
- orb and result UI
- guided and smart modes
- action preview and follow-up flows

For browser execution, I built a real-tab path through a Chromium extension so Corsiri can act in the browser session the user is already logged into, instead of depending only on a separate managed automation browser.

## Why Amazon Nova Was the Right Choice

Amazon Nova was central to the project because I did not want a rigid menu-driven assistant.

The most important design goal was:

- the system should look at the selection
- understand what kind of content it is
- infer the likely user intent
- return the most useful result

That means the same trigger can behave differently depending on context:

- a report might be summarized
- foreign-language text might be translated
- broken code might be debugged
- correct code might be explained
- an email might be polished or replied to

Nova 2 Lite's speed and cost-efficiency made it ideal for this always-on, trigger-driven interaction model. Nova 2 Sonic's bidirectional streaming made the voice path feel natural and responsive. Nova Act's UI automation capabilities power the browser action execution layer.

## AWS Deployment

To make the backend reproducible and production-ready, I containerized the Nova backend and deployed it to AWS using ECR and App Runner.

That deployment path includes:

- containerizing the backend with Docker
- pushing the image to Amazon ECR
- deploying to AWS App Runner
- verifying the live backend with a health endpoint

I also added an automated deployment script (`scripts/deploy-aws.ps1`) so the cloud deployment process is visible in the codebase and reproducible by judges.

## Challenges I Faced

The hardest part was not generating text. The hard part was building a system that feels like a real UI agent.

Some of the biggest challenges were:

- keeping Smart Mode useful without over-hardcoding behavior
- handling text, image, and voice in one coherent flow using Nova's multimodal capabilities
- making browser actions work inside real logged-in tabs
- keeping the UI smooth and understandable
- integrating Nova 2 Sonic's bidirectional streaming protocol correctly

Voice interaction and browser action reliability were especially challenging, because those are the places where a project stops being a demo and starts behaving like a real agent.

## What I Learned

This project taught me a few important things:

- multimodal AI becomes much more compelling when tied to a real interface
- good agent UX depends heavily on trust and clarity
- hardware triggers create a much more natural feeling than opening a chatbot
- the most useful AI interaction is often not "ask a prompt" but simply "select and trigger"
- Nova 2 Sonic's streaming protocol enables genuinely low-latency voice experiences
- Nova 2 Lite's Converse API is clean and easy to build on top of

## Why Corsiri Matters

Corsiri is my attempt to explore a future where AI is no longer a separate destination.

Instead of:

- opening a chat app
- explaining context
- copying data in and out
- manually taking action

the user can simply:

- select
- trigger
- review
- act

That is the experience I wanted to prototype: a multimodal AI layer that lives directly on top of everyday work.

## Closing

Corsiri started from one simple idea:

**What if the cursor itself became an AI agent?**

By combining Amazon Nova 2 Lite, Nova 2 Sonic, Nova Act, multimodal input, browser execution, and a hardware-triggered UX, I built a system that moves beyond the text box and turns ordinary on-screen context into something actionable.
