# Technical Blueprint & Sprint Plan: SCADA Vibration Graph AI Analyzer (MVP)



**Priority:** Immediate (24-Hour MVP Target)

**Goal:** Deliver a production-ready MVP application for capturing, verifying, and analyzing industrial SCADA vibration graphs using Gemini Vision & Reasoning Models based on the *Brüel & Kjær Vibro Diagnostic Chart*.

---

## 1. Quick Technical Queries & Architecture Decisions

Before kicking off Sprint 1, review these core execution choices:

* **Deployment Strategy for Tomorrow's Live Demo:** 
Hybrid Deployment Strategy (Web-First to APK):

* Build the application strictly as a mobile-responsive Web App / PWA (React / Next.js / Vite) and host it live on Vercel or Render.

* If an .apk file is strictly required for tomorrow's live demo, convert the deployed web app URL into an Android APK using PWABuilder (Generates an APK/TWA package in under 10 minutes) or Capacitor (npx cap init, npx cap add android, npx cap build android).

* This guarantees a live, functioning URL demo regardless of native compilation errors.

* **PDF Extraction & Knowledge Base:** The provided reference document (BKV Diagnostic chart.pdf) is the complete **Brüel & Kjær Vibro Diagnostic Chart**. It spans key diagnostic domains:


1. **Sensors & Processing Display Tools:** Time Waveform, FFT Spectrum, Envelope Analysis, Cepstrum, Vector Plots (Bode/Polar), Orbit Plots, ASC (Average Shaft Centreline), 3-D Waterfall.


2. **Descriptors:** RMS, Peak, Peak-to-Peak, Kurtosis, Crest Factor, $S_{max}$, Narrowband Descriptors.


3. **Rotor Faults - Imbalance & Misalignment:** Static, Couple, Dynamic, Overhung Imbalance; Parallel, Angular, Cocked Bearing, Bent Shaft.


4. **Electrically Related Faults:** Stator Eccentricity, Rotor Bar Issues, DC Motor SCR Faults.


5. **Rolling Element Bearings (REB):** Defect Frequencies (BPFO, BPFI, BSF, FTF) and envelope analysis.


6. **Gearbox & Mechanical Faults:** Tooth Mesh Frequency (TMF), Gear Assembly Phase Frequency (GAPF), Resonance, Beating, Cracked Shaft, Looseness.


7. **Hydraulic Forces:** Cavitation and Flow Turbulence.




* **Multimodal Verification Strategy:** Image validation must execute in a two-tier pipeline:
* **Tier 1:** Visual verification using Gemini Vision API with a strict binary classification schema.
* **Tier 2:** Diagnostic inference using Gemini 1.5 Pro (or GLM-4V/z.ai for deep multi-step reasoning) injecting structured rules from the Vibro Diagnostic Chart.





---

## 2. System Architecture & Tech Stack

```
[ Mobile UI (React Native / Expo or Web PWA) ]
  ├── Camera Module & File Upload
  ├── Speech-to-Text Input (English / Hindi Web Speech API)
  └── Dynamic Markdown Render (Diagnostic Report)
         │
         ▼ (HTTPS / POST JSON)
[ Fastify / Express Node.js Backend API ]
  ├── Middleware: Payload Validation & Image Compression (Sharp)
  ├── Verification Guardrail Engine (Gemini 1.5 Flash / Pro)
  └── Diagnostic Reasoning Engine (Gemini 1.5 Pro System Prompt + Knowledge Base)

```

---

## 3. Step-by-Step Implementation Guidelines

Execute this roadmap feature-by-feature. Test each phase independently before proceeding.

### Phase 0: Web-First Architecture & Packaging Setup

* Ensure all web features (Camera API via navigator.mediaDevices or standard file inputs, and Web Speech API) are strictly cross-browser and mobile-viewport friendly.

* Include a standard manifest.json and service worker boilerplate so the web app can instantly be packaged into an APK shell via PWABuilder or Capacitor if requested.

### Phase 1: Frontend Capture & Speech Interface

#### 1. Image Input Component

* Provide two distinct CTA buttons: **"Take Photo"** (`camera`) and **"Upload Chart"** (`file input`).
* Compress images on the client side (max width 1600px, JPEG quality 0.8) prior to base64 encoding or multipart form submission to minimize transmission latency.

#### 2. Bilingual Speech-to-Text (STT) Module

* Implement the native Web Speech API (`webkitSpeechRecognition`).
* Provide a toggle for **Language Selection**:
* English (`en-IN` / `en-US`)
* Hindi (`hi-IN`)


* Append recognized transcript directly into the short description text area for manual editing before submission.

---

### Phase 2: Backend API & Verification Layer

Build a single POST endpoint `/api/analyze-vibration`.

#### Tier 1: Legitimacy Verification Prompt (Guardrail)

Before performing complex diagnostic calculations, query Gemini with low-latency JSON output mode to verify image validity.

**Verification System Prompt:**

> "You are an industrial vibration graph verification system. Examine the input image. Determine if it is a legitimate industrial vibration graph, SCADA display screen, FFT spectrum, time waveform, orbit plot, or Bode/Polar plot. Respond ONLY in valid JSON with schema: `{\"is_legitimate\": boolean, \"reason\": string}`. If it is a personal photo, selfie, document text, or unrelated object, set `is_legitimate` to `false`."

* **Logic:** If `is_legitimate == false`, abort execution and return a HTTP 400 response with the error message to the client.

---

### Phase 3: AI Diagnostic Engine (Gemini Pro)

#### Prompt Construction & Ruleset Injection

When verification passes, pass the image and optional user description into the Gemini Pro model. Enforce structured JSON output or crisp Markdown output covering all diagnostic dimensions found in the B&K Chart.

**Diagnostic System Prompt Template:**

```text
You are a Lead Machinery Vibration Diagnostic Engineer operating under the Brüel & Kjær Vibro Diagnostic Chart standard[cite: 1]. Analyze the provided image of the vibration graph alongside the user's operational description.

### RULE BASE REFERENCE[cite: 1]:
1. Imbalance: 
   - Static: High 1X radial, in-phase[cite: 1].
   - Couple: High 1X radial, 180° out-of-phase across bearings[cite: 1].
   - Dynamic: Combination of static & couple; 1X dominant[cite: 1].
   - Overhung: 1X high axial and radial[cite: 1].
2. Misalignment:
   - Parallel: High 1X and 2X radial (180° out of phase across coupling)[cite: 1].
   - Angular: High 1X axial (180° out of phase) with 2X, 3X, 4X harmonics[cite: 1].
   - Cocked Bearing: High 1X, 2X, 3X axial with 180° phase shifts top-to-bottom[cite: 1].
   - Bent Shaft: High 1X axial (180° out of phase across rotor)[cite: 1].
3. Bearings (REB):
   - BPFO (Outer Race): ~0.4 * No. Balls * RPM[cite: 1].
   - BPFI (Inner Race): ~0.6 * No. Balls * RPM with 1X sidebands[cite: 1].
   - BSF (Ball Spin): Harmonics with FTF sidebands[cite: 1].
   - Demodulation/Envelope analysis highlights impacts early[cite: 1].
4. Gearbox:
   - Tooth Mesh Frequency (TMF = No. Teeth * RPM)[cite: 1].
   - Look for sidebands around TMF (1X, 2X) for wear/cracks, GAPF for assembly issues[cite: 1].
5. Electrical & Hydraulic:
   - Stator/Rotor defects: 2X LF, PPF sidebands[cite: 1].
   - Cavitation: High frequency broadband noise (10k-50kHz)[cite: 1].

### INSTRUCTIONS:
1. Identify Chart Type (e.g., FFT Spectrum, Time Waveform, Orbit, Cascade, Bode Plot)[cite: 1].
2. Detect dominant spectral peaks, harmonics (1X, 2X, 3X, nX), sidebands, or waveform anomalies[cite: 1].
3. Cross-reference detected symptoms against the Rule Base above[cite: 1].
4. Synthesize findings considering user notes: "{USER_DESCRIPTION}".

### OUTPUT FORMAT REQUIREMENTS:
- **Graph Classification**: [Identified Graph Type & Estimated Timeline/Scale][cite: 1]
- **Key Spectral Findings**: [Dominant Frequencies, Amplitudes, Sidebands][cite: 1]
- **Diagnostic Findings & Fault Identification**: [Matched Faults e.g., Angular Misalignment, Inner Race Defect][cite: 1]
- **Severity & Actionable Recommendations**: [Immediate corrective steps]

```

---

## 4. MVP Feature Checklist & Lock-in Workflow

| Step | Feature Scope | Verification Metric | Status |
| --- | --- | --- | --- |
| **1** | Express/Node API boilerplate + Gemini SDK setup | API receives image payload & returns valid response | Pending |
| **2** | Image Validation Middleware (Tier 1 Prompt) | Non-graph images return quick warning; graphs pass | Pending |
| **3** | STT Web API Integration | Speak Hindi/English -> Input box populated correctly | Pending |
| **4** | Diagnostic Engine (Tier 2 Prompt with Chart Rules)

 | Detailed analysis output matching B&K Chart principles

 | Pending |
| **5** | Mobile UI Layout & Loading States | Clean dashboard, clear display of AI findings | Pending |

---

ADDITIONAL DEPLOYMENT REQUIREMENT (Hybrid Web-to-APK Fallback):

- Primary Focus: Build a mobile-first Responsive Web App / PWA first. Ensure full mobile responsiveness, camera access via standard file inputs/HTML5 camera, and speech-to-text via Web Speech API.
- Live Web Deployment: Deploy immediately to Vercel/Render for zero-latency testing on physical phones.
- Native APK Wrapper: Once the web app is live and tested, if an APK binary is required for the demo, run the live URL through PWABuilder (https://www.pwabuilder.com) or wrap the web build folder using Capacitor (`@capacitor/core` & `@capacitor/android`). This provides a downloadable APK without rewriting frontend code.