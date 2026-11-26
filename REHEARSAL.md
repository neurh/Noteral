
## Round 9: formula editor

- Saves as you type (450 ms after the last change; an invalid formula keeps the last working one). There is no Save/Cancel footer, and the toolbar shows Saved / Saving… / Not saved.
- Undo/redo uses its own history (lib/editHistory.ts), because a controlled textarea loses the browser's stack. Quick typing merges into one step; completions, inserts and AI applies are separate steps.
- The preview shows only the result of the chosen row. The function reference sits under the code (caret or hover), and its examples are checked by formulaDocs.test.ts.
- The side panel has two tabs, Functions and Ask AI (a chat-like feed and composer).
