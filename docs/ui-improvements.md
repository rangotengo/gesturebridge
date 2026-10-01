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

5. **Modals Are Not Accessible Dialogs** — `[COMPLETED]`
   - **Files:** `web/components/CalibrationModal.tsx`, `web/components/ProfileSelectorModal.tsx`
   - **Problem:** Modals lacked Escape key dismissal, backdrop click dismissal, accessible dialog roles/labels, tab accessibility, and the navbar (`z-index: 100`) sat above modal backdrop (`z-50`).
   - **Fix Applied:**
     - Raised modal backdrops to `z-[110]`.
     - Added `Escape` key event listener and backdrop click handlers.
     - Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and `aria-label` close button attributes.
     - Added accessible tab roles (`role="tablist"`, `role="tab"`, `role="tabpanel"`).

6. **Modal Cancel Doesn't Discard Changes** — `[COMPLETED]`
   - **Files:** `web/components/CalibrationModal.tsx`, `web/components/ProfileSelectorModal.tsx`
   - **Problem:** Modals kept dirty editing state upon clicking Cancel; reopening showed abandoned changes.
   - **Fix Applied:**
     - Re-sync internal editing state to saved local/storage configuration on open (`useEffect` on `isOpen`).
     - Reset state back to loaded configuration on Cancel before closing.

7. **Space Key Captures Pose While Typing Gesture Name** — `[COMPLETED]`
   - **Files:** `web/app/page.tsx`
   - **Problem:** Global Space key handler swallowed space characters when typing custom gesture names.
   - **Fix Applied:**
     - Added focus guard in `handleKeyDown` to ignore Space events when active element is `INPUT`, `TEXTAREA`, `SELECT`, or `isContentEditable`.

8. **Hardcoded Dominant Hand and Action Labels in Gesture Display** — `[COMPLETED]`
   - **Files:** `web/components/GestureDisplay.tsx`, `web/components/ProfileSelectorModal.tsx`, `web/app/page.tsx`
   - **Problem:** Right hand hardcoded as dominant, action labels only matched default profile, custom gestures could not be mapped, and mode toggle showed "5s Hold" in web browsers.
   - **Fix Applied:**
     - Connected `GestureDisplay` dynamically to dominant hand preference (`dominantHand`) from `loadCalibrationSettings()`.
     - Dynamically mapped gesture actions from active profile (`loadActiveProfile()`) and listened to custom update events (`gesturebridge:calibration-updated`, `gesturebridge:profile-updated`, and `storage`).
     - Passed `isElectron` prop and hid "Mode Toggle (5s Hold)" in web browser mode.
     - Passed dynamic `gestureLabels` to `ProfileSelectorModal` so custom gestures can be mapped.

---

## P1: User Flow & Experience

9. **Camera-Denied / Error State**
   - **Problem:** Tiny banner over black screen.
   - **Fix:** Centered friendly state with clear icons, distinct copy for "denied", "not found", and "in use", step-by-step unblocking guide, and large Retry button.

10. **First-Run Onboarding Guidance**
    - **Problem:** Direct launch into camera with no explanation of 6 gestures, hand roles, or modes.
    - **Fix:** Dismissible "How it works" onboarding card, plus a quick `?` cheat sheet overlay displaying gestures and actions under the active profile.

11. **Colliding Floating Overlays**
    - **Problem:** Fragmented absolute positioning (`bottom-24`, `bottom-14`, `bottom-0`, `top-16`, `top-20`) colliding on mobile screens.
    - **Fix:** Coordinated layout: status & mode switcher top bar, gesture info cards mid-screen with responsive bounds, and unified bottom toolbar.

12. **Informative Startup Progress**
    - **Problem:** Vague "Initializing camera..." text.
    - **Fix:** Multi-step status feedback (loading ML model -> requesting camera -> starting hand tracking) and a timeout hint (>10s) with troubleshooting steps.

13. **Mode Switcher Context & Emergency Stop**
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

## P2: Visual Consistency

19. **Fragmented Color Schemes**
    - **Fix:** Standardize across dark-mode palette using Tailwind slate scale and consistent primary accents.

20. **Typography and Font Sizes**
    - **Fix:** Establish consistent scale (`text-xs` for tags/labels, `text-sm` for body/descriptions, `text-lg`/`text-xl` for card titles, `text-2xl` for page headers).

21. **Card and Container Styling**
    - **Fix:** Unify border radius (`rounded-xl` / `rounded-2xl`), border colors (`border-slate-800`), and dark card backgrounds (`bg-slate-900/80`).

22. **Interactive State Feedback**
    - **Fix:** Standardize button hover/active/focus-visible rings and transitions.

23. **Table & List Presentation**
    - **Fix:** Align table cell paddings, typography, zebra striping, and empty states.

24. **Loading States and Spinners**
    - **Fix:** Standardize spinners and skeleton loaders across all pages.

25. **Toast and Notification Consistency**
    - **Fix:** Consistent positioning, durations, colors, and dismissal across notifications.

---

## P3: Accessibility & Polish

26. **Contrast & Color-Only Information**
    - **Fix:** Ensure WCAG AA contrast ratio (4.5:1) for all text and add shape/text indicators alongside color cues.

27. **Keyboard Navigation & Focus Management**
    - **Fix:** Trap focus in open modals, restore focus on close, and support Tab navigation throughout.

28. **Screen Reader Live Regions**
    - **Fix:** Audit `aria-live` regions to prevent verbose or interrupting announcements.

29. **Reduced Motion Preferences**
    - **Fix:** Honor `prefers-reduced-motion` across pulse, ping, and fade animations.

30. **Mobile Viewport & Touch Optimization**
    - **Fix:** Ensure touch target size >= 44x44px and responsive layouts on small screens.

31. **Form Labels & Error Associations**
    - **Fix:** Link form inputs to `<label>` tags with `htmlFor` and error messages via `aria-describedby`.

32. **Helpful Empty States**
    - **Fix:** Ensure all zero-data states provide educational context and a call to action.

33. **Consistent Iconography**
    - **Fix:** Replace mixed emojis with consistent SVG icons throughout action triggers.

34. **Tooltips & Discoverability**
    - **Fix:** Add accessible tooltips for icon-only buttons and badge indicators.

35. **Favicon and Page Metadata**
    - **Fix:** Add app favicon, OpenGraph tags, and page-specific `<title>` tags across routes.
