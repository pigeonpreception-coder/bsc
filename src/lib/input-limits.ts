// Server Actions otherwise accept free text up to Next's ~1MB request-body
// cap. These values get stored and then re-emitted into emails, SMS,
// notifications, AI prompts, exported documents and audit snapshots, so an
// unbounded name or comment is a cost and abuse vector, not just a storage one.
export const TEXT_LIMITS = {
  email: 254,
  personName: 120,
  companyName: 200,
  department: 100,
  phone: 32,
  shortLabel: 100,
  title: 200,
  longText: 2000,
} as const;

export function assertMaxLength(value: string, max: number, label: string): void {
  if (value.length > max) {
    throw new Error(`${label} is too long (maximum ${max} characters).`);
  }
}
