/**
 * Cross-component style fragments. Pure className strings that get
 * composed at the callsite with size / context modifiers.
 *
 * Use a *constant* (not a component) when the same look appears across
 * elements (`<input>`, `<select>`, `<textarea>`) or when callers need to
 * extend with their own utilities. Use a component (Panel, Button, etc.)
 * when the wrapper element itself is the abstraction.
 */

// Form input base: border + bg + focus ring + placeholder colour. Padding
// + font-size live at the callsite (different inputs have different
// shapes).
export const inputBase = [
  'rounded-[7px] border border-border-base bg-surface-base text-fg outline-none',
  'placeholder:text-fg-muted focus:border-accent',
].join(' ')

// Code-block <pre> base: shared by CodePane (text/raw bodies) and
// HtmlSource (Prism-highlighted markup). Background + line-height + any
// internal padding live at the callsite — they differ slightly.
export const codeBlockBase = [
  'rounded-[7px] border border-border-base font-mono text-xs',
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
].join(' ')
