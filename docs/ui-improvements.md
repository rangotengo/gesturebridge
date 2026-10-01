# UI Improvements & Polish Roadmap

This document outlines the UI issues and improvements identified across GestureBridge, ordered by priority (P0 through P3) and broken down with concrete recommendations.

---

## P0: Broken Right Now (Completed)

1. **Global Reset Wipes Out Tailwind Spacing** — `[COMPLETED]`
   - **Files:** `web/app/globals.css`
   - **Problem:** The unlayered universal selector reset (`*, *::before, *::after { margin: 0; padding: 0; }`) beats Tailwind v4's utilities layer (`@layer utilities`). Padding and margin classes (`py-2.5`, `px-10`, `px-3`, `mx-auto`, etc.) computed to `0px`.
   - **Fix Applied:**
     - Removed unlayered universal margin/padding reset.
     - Moved base element rules (`html`, `body`, `h1`–`h6`, `a`, `p`, `code`, `pre`) into `@layer base`.
     - Moved `.btn`, `.form-input`, `.alert`, table styles, modal containers, and layout rules into `@layer components`.

2. **Non-Existent Animation and Color Classes** — `[COMPLETED]`
   - **Files:** `web/app/globals.css`, `web/components/CalibrationModal.tsx`, `web/components/ProfileSelectorModal.tsx`, `web/components/ModeToggleOverlay.tsx`, `web/app/page.tsx`, `web/app/ml/evaluation/page.tsx`
   - **Problem:** Classes like `animate-fade-in`, `animate-in fade-in zoom-in-95`, `bg-slate-750`, and `bg-slate-850` were missing in Tailwind v4.
   - **Fix Applied:**
     - Defined `--animate-fade-in` and keyframe `fadeIn` in `@theme` in `globals.css`.
     - Replaced invalid classes with proper Tailwind tokens (`hover:bg-slate-700`, `hover:bg-slate-800/50`, `bg-slate-800`, `animate-fade-in`).

3. **"Train AI" Covers "Calibrate" for Admins** — `[COMPLETED]`
   - **Files:** `web/app/globals.css`, `web/app/page.tsx`
   - **Problem:** `.improve-toggle` positioned at `bottom: 3.5rem; left: 1rem` overlapped the Calibrate/Profiles pill button group (`fixed bottom-14 left-4`).
   - **Fix Applied:**
     - Removed fixed positioning from `.improve-toggle`.
     - Wrapped bottom controls in `web/app/page.tsx` into a single responsive, unified bottom toolbar container (`fixed bottom-14 inset-x-0 z-40 px-4`) containing Calibrate, Profiles, Train AI toggle (admin only), and Camera toggle.

4. **Public Evaluation Dashboard & Duplicate URL** — `[COMPLETED]`
   - **Files:** `web/app/ml/evaluation/page.tsx`, `web/app/api/ml/evaluation/route.ts`, `web/app/admin/evaluation/page.tsx`
   - **Problem:** Evaluation dashboard was accessible without admin privileges and had duplicate `/admin/evaluation` and `/ml/evaluation` routes.
   - **Fix Applied:**
     - Added `requireAdmin` check to `/api/ml/evaluation` GET route.
     - Protected `/ml/evaluation` with `<ProtectedRoute requireAdmin>`.
     - Replaced duplicate `/admin/evaluation` route with Next.js redirect to `/ml/evaluation`.

5. **Modals Are Real Accessible Dialogs & Focus Trapping** — `[COMPLETED]`
   - **Files:** `web/components/CalibrationModal.tsx`, `web/components/ProfileSelectorModal.tsx`, `web/app/page.tsx`
   - **Problem:** Modals lacked Escape key dismissal, backdrop click dismissal, accessible dialog roles/labels, tab accessibility, focus stayed on background triggers and could tab outside, and the navbar (`z-index: 100`) sat above modal backdrop (`z-50`).
   - **Fix Applied:**
     - Replaced custom div overlays with native `<dialog ref={dialogRef}>` opened via `showModal()`, automatically trapping focus inside the modal and placing it in top-layer above the navbar.
     - Added `onCancel` (for Escape) and backdrop click dismissal.
     - Rendered modals conditionally (`{isCalibrationOpen && <CalibrationModal ... />}`) so they mount fresh every time without stale state or `set-state-in-effect` lint issues.

6. **Modal Cancel Doesn't Discard Changes** — `[COMPLETED]`
   - **Files:** `web/components/CalibrationModal.tsx`, `web/components/ProfileSelectorModal.tsx`, `web/app/page.tsx`
   - **Problem:** Modals kept dirty editing state upon clicking Cancel; reopening showed abandoned changes.
   - **Fix Applied:**
     - Modal state initializes fresh on mount from storage. Unmounting on Cancel naturally discards uncommitted state.

7. **Space Key Captures Pose While Typing Gesture Name** — `[COMPLETED]`
   - **Files:** `web/app/page.tsx`
   - **Problem:** Global Space key handler swallowed space characters when typing custom gesture names.
   - **Fix Applied:**
     - Added focus guard in `handleKeyDown` to ignore Space events when active element is `INPUT`, `TEXTAREA`, `SELECT`, or `isContentEditable`.

8. **Dominant Hand & Profile-Action Synchronization** — `[COMPLETED]`
   - **Files:** `web/hooks/useHandRoles.ts`, `web/components/GestureDisplay.tsx`, `web/app/page.tsx`
   - **Problem:** Cursor movement previously ignored the left/right hand calibration setting, causing "Dominant (Left)" on-screen while the right hand moved the cursor. Profile-based action labels were also placed in dead code inside `GestureDisplay` which is hidden in mouse mode.
   - **Fix Applied:**
     - Updated `assignHandRoles` to accept `preferredDominantHand: 'Left' | 'Right' | 'Auto'`, honoring calibration preference when multiple hands are in view.
     - Connected `GestureDisplay` directly to the resulting dominant hand (`dominantHandName`), ensuring 100% synchronization between cursor tracking and on-screen dominant/modifier indicators.
     - Displayed the active profile's mapped action labels in the compact square mouse-mode panel directly beneath detected gestures.

---

## Addressed Along the Way

- **Dark `color-scheme` Defined:** Explicitly specified in `globals.css` to prevent white flash during theme rendering and style native form controls/scrollbars.
- **Accessible Camera Toggle Name:** Provided `title`, `aria-label`, and `aria-pressed` states on the camera toggle button.
- **Evaluation Dashboard Empty State:** Rendered clean empty state with CTA to evaluate models when no previous evaluation runs exist.

---

## P1: User Flow & Experience

9. **Camera-Denied / Error State**
   - **Problem:** Tiny banner over black screen when camera is rejected.
   - **Fix:** Centered friendly state with clear icons, distinct copy for "denied", "not found", and "in use", step-by-step unblocking guide, and large Retry button.

10. **First-Run Onboarding Guidance**
    - **Problem:** Direct launch into camera with no explanation of 6 gestures, hand roles, or modes.
    - **Fix:** Dismissible "How it works" onboarding card, plus a quick `?` cheat sheet overlay displaying gestures and actions under the active profile.

11. **Colliding Floating Overlays on Small Screens**
    - **Problem:** Fragmented absolute positioning (`bottom-24`, `bottom-14`, `bottom-0`, `top-16`, `top-20`) colliding on mobile viewports.
    - **Fix:** Coordinated layout: status & mode switcher top bar, gesture info cards mid-screen with responsive bounds, and unified bottom toolbar.

12. **Informative Startup Progress**
    - **Problem:** Vague "Initializing camera..." text during multi-step setup.
    - **Fix:** Multi-step status feedback (loading ML model -> requesting camera -> starting hand tracking) and a timeout hint (>10s) with troubleshooting steps.

13. **Mode Switcher Context & Emergency Stop Guidance**
    - **Problem:** Detect / Mouse / Mirror modes lack descriptions; Mouse mode hijacking system cursor is jarring without exit instructions.
    - **Fix:** Tooltips/descriptions explaining modes and prominent display of emergency-stop shortcut when entering Mouse mode.

14. **Soften Jarring Mode-Change Flash**
    - **Problem:** Fullscreen flashing green/red with bouncing emoji; red feels like an error for turning off.
    - **Fix:** Non-intrusive top toast / pill notification with neutral color scheme for "off" states.

15. **Prevent Loss of Unsaved Samples**
    - **Files:** `web/app/collect/page.tsx`, `web/app/page.tsx` (Train AI).
    - **Fix:** `beforeunload` warning when queue has unsaved captures, plus an "Undo last sample" action.

16. **Streamline Collect Page Workflow**
    - **Fix:** Burst capture when Space is held, progress bar per gesture toward recommended targets (200+ samples), status messages explaining when recording is disabled (e.g. "No hand detected"), warning before training with unsaved captures, and fix odd left margin on Train button.

17. **Order & State in Train AI Panel**
    - **Fix:** Move "+ New gesture" into gesture selection dropdown, add Retrain confirmation dialog, and maintain real progress indicators during 10–20s training cycles.

18. **Import Page Polishing**
    - **Fix:** 3-step wizard (Upload -> Review/Map Columns -> Save & Train), preserve column selector, disable train until saved, confirm before synthetic data seeding, display "showing 5 of N", and add focus outline to dropzone.

---

## P2: Visual Consistency & Interaction Details

19. **History Page Visual & Functional Flaws**
    - **Files:** `web/app/ml/history/page.tsx`
    - **Problem:** Table columns misaligned without minimum cell widths, timestamps unformatted/unlocalized, no pagination or scroll bounds for large datasets, "Live feed will pause" copy shown even when camera stream remains running, and no bulk delete/clear actions.
    - **Fix:**
      - Fix table alignment with consistent padding (`px-4 py-3`), fixed cell widths for status/confidence badges, and localized datetime strings (`toLocaleString()`).
      - Add pagination or virtualized list for history logs.
      - Align "Live feed will pause" banner to reflect actual camera lifecycle or pause camera while on history page.
      - Add clear history / export CSV action.

20. **Evaluation Dashboard Follow-Ups**
    - **Files:** `web/app/ml/evaluation/page.tsx`
    - **Problem:** Confusion matrix labels cramped on smaller viewports, class distribution chart lacks interactive tooltips, no mechanism to compare two evaluation runs side-by-side, and re-evaluating requires manual page reload.
    - **Fix:**
      - Add responsive scrolling / heat-map color scale for confusion matrix cells.
      - Add comparison diff view between latest run and previous run.
      - Add re-evaluate button that triggers evaluation and updates live metrics without full page refresh.

21. **Authentication Flow Edge Cases**
    - **Files:** `web/app/admin/logout/page.tsx`, `web/app/admin/signup/page.tsx`
    - **Problem:**
      - In `/admin/logout`, if `fetch('/api/admin/logout')` errors or network drops, the spinner hangs indefinitely without a timeout or fallback redirect.
      - In `/admin/signup`, form validation runs only on submit; passwords mismatched or too short give no inline feedback while typing.
    - **Fix:**
      - In logout page, add a 3-second timeout fallback that forcibly clears client session tokens and redirects to `/admin/login`.
      - In signup page, add instant inline validation (password length indicator, match confirmation banner) on input change/blur.

22. **Unused CSS & Dual Styling Systems**
    - **Files:** `web/app/globals.css`
    - **Problem:** The app mixes modern Tailwind utility classes with older custom hand-written BEM-like CSS rules (`.history-table`, `.collector-box`, `.improve-panel`, `.mode-card`), with duplicate properties and dead rules left over from past refactors.
    - **Fix:**
      - Audit and remove dead CSS classes from `globals.css`.
      - Migrate custom panel and table styling to Tailwind utilities and component classes for design consistency.

23. **Duplicated Gesture Data & Sources of Truth**
    - **Files:** `web/ml/gestureUtils.ts`, `web/lib/gestureProfiles.ts`, `web/components/GestureDisplay.tsx`, `web/components/ProfileSelectorModal.tsx`, `web/app/page.tsx`
    - **Problem:** Gesture names (`'Pointing (Index Out)'`), default labels, and gesture icons (`👉`, `✊`, `✌️`, `🖐️`, `🤘`, `👍`) are declared independently in 4+ files.
    - **Fix:** Centralize standard gesture metadata (index, id, label, description, icon) in `web/ml/gestureUtils.ts` (or a dedicated `web/features/gestures/registry.ts`) and import it everywhere.

24. **Navbar Issues & Mobile Navigation**
    - **Files:** `web/components/Navbar.tsx`
    - **Problem:** Missing clear active route indicator on current page links, mobile hamburger menu doesn't smoothly animate or trap focus, and admin navigation links aren't clearly grouped.
    - **Fix:**
      - Add active state highlighting (`bg-slate-800 text-white font-semibold`) using `usePathname()`.
      - Add accessible mobile drawer/dropdown with Escape and outside-click dismissal.
      - Group Admin ML links into a dedicated "Admin" dropdown or section.

---

## P3: Accessibility & Polish

25. **Missing `<main>` Landmark & Skip Link**
    - **Files:** `web/app/layout.tsx`, all route pages
    - **Problem:** Pages lack a semantic `<main id="main-content">` landmark, and keyboard users have to tab through the entire navigation bar on every page.
    - **Fix:**
      - Add a visually hidden, focusable skip link (`<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>`) at the top of `layout.tsx`.
      - Wrap core page content in `<main id="main-content">`.

26. **Unloaded Inter Font & Typography Consistency**
    - **Files:** `web/app/layout.tsx`, `web/app/globals.css`
    - **Problem:** The CSS references `Inter, sans-serif` but the font is not bundled locally or configured via `next/font/google`, causing system fallback shifts and missing weights in offline/Electron environments.
    - **Fix:** Configure `next/font/google` with `Inter` and `variable: '--font-sans'`, or load bundled WOFF2 fonts for offline desktop reliability.

27. **Wording & Terminology Inconsistencies**
    - **Problem:** Terms are mixed across pages: "Train AI" vs "Improve AI", "Mouse Control" vs "Mouse Mode", "Single-Hand" vs "Accessibility Profile".
    - **Fix:** Standardize terminology across UI copy, tooltips, and documentation.

28. **Color Contrast & Shape Cues**
    - **Fix:** Ensure WCAG AA contrast ratio (4.5:1) for muted text (`text-slate-400`/`text-slate-500` on dark backgrounds) and add shape/text badges alongside colored dots so color-blind users can distinguish statuses.

29. **Screen Reader Live Regions**
    - **Fix:** Audit `aria-live="polite"` regions to prevent rapid spam during high-frequency gesture detection frames (throttle live announcements to meaningful status changes).

30. **Reduced Motion Preferences**
    - **Fix:** Wrap high-frequency or infinite animations (pulse rings, progress bars, radar sweeps) in `@media (prefers-reduced-motion: reduce)`.

31. **Touch Target Size**
    - **Fix:** Ensure all interactive elements on mobile viewports have minimum touch bounding boxes of 44x44px.

32. **Favicon and Page Metadata**
    - **Fix:** Add app favicon, Web App Manifest, OpenGraph tags, and page-specific `<title>` tags across routes.
