// Shared by plan-document-html.ts (AI-generated prose -> Puppeteer PDF) and
// email.ts (admin-settable free text -> notification emails) — both are
// boundaries between user/AI-controlled text and rendered HTML.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
