# React and shadcn/ui migration

**Goal:** Replace the imperative frontend with React and shadcn/ui while preserving the desktop workflows.

**Architecture:** React owns the workbench, forms and panel selection. A studio runtime, owned by a React effect, manages the existing renderer/tracker lifecycle, publishes UI status once per second and disposes timers, cameras and listeners on unmount. Output remains a separate passive canvas component.

**Tech stack:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui; existing Tauri, Pixi Live2D and MediaPipe modules.

**Design:** Retain the existing VTube Studio inspired layout: large stage, pastel navigation and white inspector. Use pink `#d34477`, ink `#423e4a`, muted `#77717e`, border `#eee6eb`, white `#ffffff` and blush `#f8edf1`. Retain the system rounded/CJK font stack; use a consistent control height and clear keyboard focus. Keep the renderer background independently configurable.

- [x] Add React/Vite integration, Tailwind and locally owned shadcn button, input, native select, switch, slider and collapsible components.
- [x] Replace `src/main.ts` with the React entrypoint, workbench, panels and `createStudio` runtime. Preserve settings schema, model operation guards, recording, shortcuts and Tauri output events.
- [x] Move passive output into a React component with effect cleanup. Keep it free of camera access and studio controls.
- [x] Adapt the existing browser regression to the accessible shadcn controls; check draft persistence while metrics update, model switching, saved parameters, keyboard navigation and clean output.
- [x] Run `npm run check`, `npm test`, `npm run build`, `npm run format:check` and fixture-backed Playwright checks. Inspect screenshots at desktop and minimum window sizes; document the native verification boundary.
