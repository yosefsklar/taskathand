Review the current Task At Hand Chrome extension source code and update `background-concepts.md` if any new technical concepts, Chrome extension APIs, or architectural patterns have been introduced that are not yet documented.

## Steps

1. Read `background-concepts.md` to understand what is already covered.
2. Read all extension source files:
   - `manifest.json`
   - `background.js`
   - `popup.js`
   - `popup.html`
   - `popup.css`
3. Identify any Chrome extension APIs, browser platform concepts, or non-obvious architectural patterns used in the code that do **not** have a corresponding section in `background-concepts.md`.
4. For each new concept found, append a new numbered section to `background-concepts.md` that:
   - Names the concept clearly as a heading.
   - Explains **what it is** and **why it exists** in the context of Chrome extensions.
   - Shows a short, concrete code example drawn from this codebase.
   - Relates it to something a general software developer would already know (e.g. analogies to backend concepts, standard web APIs, OS primitives).
5. Keep the writing style consistent with the existing sections: developer-focused, concise, no fluff.

## Rules

- Do **not** rewrite or remove existing sections unless they are factually incorrect.
- Do **not** add a section if the concept is already covered, even under a different name.
- Only document concepts that are meaningfully new or non-obvious — skip trivial HTML/CSS.
- If no new concepts were introduced, say so and make no changes to the file.
