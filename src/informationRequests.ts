export const INFORMATION_REQUEST_OPTIONS = [
  { id: "cardholder_id", label: "ID of the Cardholder" },
  { id: "cardholder_selfie_with_id", label: "A selfie of the cardholder holding the ID next to their face" },
  { id: "payment_card", label: "Copy of the payment card used (showing the last 4 digits and cardholder's name)" },
  { id: "shipping_address_proof", label: "Proof of Shipping Address" },
  { id: "billing_address_proof", label: "Proof of Billing Address" },
  { id: "business_or_tobacco_license", label: "Valid Business or Tobacco License" }
] as const;

export const INITIAL_VERIFICATION_REQUIREMENTS = [
  "Proof of billing and shipping address",
  "Payment card showing only the last four digits and cardholder’s name",
  "Government-issued photo ID",
  "Selfie of the cardholder holding the ID"
] as const;

const LEGACY_INFORMATION_REQUEST_OPTIONS = [
  { id: "business_license", label: "Valid Business License" },
  { id: "tobacco_license", label: "Valid Tobacco License" }
] as const;

export type InformationRequestType =
  | (typeof INFORMATION_REQUEST_OPTIONS)[number]["id"]
  | (typeof LEGACY_INFORMATION_REQUEST_OPTIONS)[number]["id"];
export type VerificationDocumentType = InformationRequestType | "additional" | null;

const INFORMATION_REQUEST_IDS = new Set<string>([
  ...INFORMATION_REQUEST_OPTIONS.map((option) => option.id),
  ...LEGACY_INFORMATION_REQUEST_OPTIONS.map((option) => option.id)
]);

export function isInformationRequestType(value: string): value is InformationRequestType {
  return INFORMATION_REQUEST_IDS.has(value);
}

export function getInformationRequestLabel(value: InformationRequestType): string {
  return [...INFORMATION_REQUEST_OPTIONS, ...LEGACY_INFORMATION_REQUEST_OPTIONS]
    .find((option) => option.id === value)?.label ?? value;
}

export function parseInformationRequestTypes(value: string): InformationRequestType[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is InformationRequestType => typeof item === "string" && isInformationRequestType(item))
      : [];
  } catch {
    return [];
  }
}
