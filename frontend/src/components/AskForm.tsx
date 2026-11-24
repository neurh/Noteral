import { useState } from "react";
import { Check } from "lucide-react";
import type { AskAnswer, PickItem } from "../lib/dialogs";

interface AskFormProps {
  question: string;
  options: PickItem[];
  multiple?: boolean;
  allowText?: boolean;
  placeholder?: string;
  onAnswer: (answer: AskAnswer) => void;
  /** Shown as a secondary button; omit to hide. */
  onCancel?: () => void;
  submitLabel?: string;
  compact?: boolean;
  /** Hide the question text (when the container shows it as a title). */
  hideQuestion?: boolean;
}

/**
 * A question with choices and/or a typed answer. Used by the `ui.ask` dialog for plugins
 * and inline in the assistant chat.
 */
export function AskForm({ question, options, multiple, allowText = true, placeholder, onAnswer, onCancel, submitLabel = "Answer", compact, hideQuestion }: AskFormProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const textAllowed = allowText || options.length === 0;
  const canSubmit = picked.length > 0 || text.trim().length > 0;

  const submit = (choices = picked) => {
    const typed = text.trim();
    const labels = options.filter((option) => choices.includes(option.id)).map((option) => option.label);
    const answer = [...labels, ...(typed ? [typed] : [])].join(", ");
    if (!answer) return;
    onAnswer({ answer, choices: labels, cancelled: false });
  };

  const toggle = (id: string) => {
    if (!multiple) {
      // Single choice without text: one click answers.
      if (!textAllowed) {
        submit([id]);
        return;
      }
      setPicked((current) => (current[0] === id ? [] : [id]));
      return;
    }
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <form
      className={`ask-form${compact ? " is-compact" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {hideQuestion ? null : <p className="ask-question">{question}</p>}
      {options.length ? (
        <div className="ask-options" role={multiple ? "group" : "radiogroup"} aria-label={question}>
          {options.map((option, index) => {
            const on = picked.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role={multiple ? "checkbox" : "radio"}
                aria-checked={on}
                className={`ask-option${on ? " is-on" : ""}`}
                onClick={() => toggle(option.id)}
              >
                <span className={`ask-mark${multiple ? " is-box" : ""}`} aria-hidden="true">
                  {on ? <Check size={11} strokeWidth={2.6} /> : <span className="ask-key">{index + 1}</span>}
                </span>
                <span className="ask-option-text">
                  <strong>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {textAllowed ? (
        <input
          className="host-field ask-text"
          value={text}
          placeholder={placeholder || (options.length ? "Or type your own answer…" : "Type your answer…")}
          onChange={(event) => setText(event.target.value)}
          autoFocus={!options.length}
          spellCheck
        />
      ) : null}
      {textAllowed || multiple || onCancel ? (
        <div className="ask-actions">
          {onCancel ? (
            <button type="button" className="secondary-button" onClick={onCancel}>
              Skip
            </button>
          ) : null}
          {textAllowed || multiple ? (
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {submitLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
