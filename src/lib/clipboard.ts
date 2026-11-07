/**
 * Copies text. The Clipboard API exists only in secure contexts (https, localhost); opened by IP
 * over plain http, for example from a phone on the local network, the copy goes through a
 * hidden textarea and execCommand instead.
 */
export async function copyText(value: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission denied: try the textarea below.
    }
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  // readonly keeps the on-screen keyboard closed; 16px stops iOS Safari from zooming the page
  // when the field gets focus; off-screen rather than display:none, which cannot be selected.
  ta.setAttribute("readonly", "");
  Object.assign(ta.style, { position: "fixed", top: "0", left: "-9999px", fontSize: "16px", opacity: "0" });
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length); // iOS ignores select() on its own
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
