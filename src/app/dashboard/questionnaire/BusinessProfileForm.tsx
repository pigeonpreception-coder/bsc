"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CascadingList, { type CascadingEntry } from "./CascadingList";
import SearchableSelect from "./SearchableSelect";
import FileUploadField from "./FileUploadField";
import SupportingDocumentsList, { type SupportingDocument } from "./SupportingDocumentsList";
import StatusRowList, { type StatusRowEntry } from "./StatusRowList";
import { INDUSTRIES, SECTORS, PRODUCT_SERVICE_STATUS_OPTIONS, IMPORTANCE_STATUS_OPTIONS } from "./constants";
import { saveBusinessProfileDraft, type BusinessProfileDraft } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

function isCascadingListValid(entries: CascadingEntry[]): boolean {
  return entries.some((e) => e.name.trim().length >= 3 && e.description.trim().length > 0);
}

export type InitialProfileData = Partial<BusinessProfileDraft> & {
  companyProfileFileSize?: number | null;
};

export default function BusinessProfileForm({
  planId: initialPlanId,
  tenantId,
  companyName,
  initialData,
  initialLastSavedAt,
}: {
  planId: string | null;
  tenantId: string;
  companyName: string;
  initialData: InitialProfileData;
  initialLastSavedAt: string | null;
}) {
  const planIdRef = useRef(initialPlanId);
  const [vision, setVision] = useState(initialData.vision ?? "");
  const [mission, setMission] = useState(initialData.mission ?? "");
  const [values, setValues] = useState<CascadingEntry[]>(
    initialData.values && initialData.values.length > 0 ? initialData.values : [],
  );
  const [overallStrategicGoal, setOverallStrategicGoal] = useState(initialData.overallStrategicGoal ?? "");
  const [strategicPriorities, setStrategicPriorities] = useState<CascadingEntry[]>(
    initialData.strategicPriorities && initialData.strategicPriorities.length > 0
      ? initialData.strategicPriorities
      : [],
  );
  const [industry, setIndustry] = useState(initialData.industry ?? "");
  const [industryOther, setIndustryOther] = useState(initialData.industryOther ?? "");
  const [sector, setSector] = useState(initialData.sector ?? "");
  const [sectorOther, setSectorOther] = useState(initialData.sectorOther ?? "");
  const [businessDescription, setBusinessDescription] = useState(initialData.businessDescription ?? "");
  const [businessBackground, setBusinessBackground] = useState(initialData.businessBackground ?? "");
  const [businessDirection, setBusinessDirection] = useState(initialData.businessDirection ?? "");
  const [companyProfileUrl, setCompanyProfileUrl] = useState<string | null>(initialData.companyProfileUrl ?? null);
  const [companyProfileFileName, setCompanyProfileFileName] = useState<string | null>(
    initialData.companyProfileFileName ?? null,
  );
  const [strategicPlanDocumentUrl, setStrategicPlanDocumentUrl] = useState<string | null>(
    initialData.strategicPlanDocumentUrl ?? null,
  );
  const [strategicPlanDocumentFileName, setStrategicPlanDocumentFileName] = useState<string | null>(
    initialData.strategicPlanDocumentFileName ?? null,
  );
  const [supportingDocuments, setSupportingDocuments] = useState<SupportingDocument[]>(
    initialData.supportingDocuments ?? [],
  );
  const [websiteUrl, setWebsiteUrl] = useState(initialData.websiteUrl ?? "");

  // Section 2
  const [financialYearStart, setFinancialYearStart] = useState(initialData.financialYearStart ?? "");
  const [planDurationYears, setPlanDurationYears] = useState<number | null>(
    initialData.planDurationYears ?? null,
  );
  const initialVisionDate = initialData.visionAchievementDate ?? "";
  const [visionMonth, setVisionMonth] = useState(initialVisionDate ? initialVisionDate.slice(5, 7) : "");
  const [visionYear, setVisionYear] = useState(initialVisionDate ? initialVisionDate.slice(0, 4) : "");
  const [keyCustomers, setKeyCustomers] = useState<StatusRowEntry[]>(initialData.keyCustomers ?? []);
  const [keyStakeholders, setKeyStakeholders] = useState<StatusRowEntry[]>(initialData.keyStakeholders ?? []);
  const [keyProductsServices, setKeyProductsServices] = useState<StatusRowEntry[]>(
    initialData.keyProductsServices ?? [],
  );
  const [additionalInfo, setAdditionalInfo] = useState(initialData.additionalInfo ?? "");

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialLastSavedAt);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isContinuing, startContinuing] = useTransition();
  const [continueError, setContinueError] = useState<string | null>(null);
  const router = useRouter();

  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const visionAchievementDate = visionMonth && visionYear ? `${visionYear}-${visionMonth}-01` : "";

  const buildDraft = (): BusinessProfileDraft => ({
    vision,
    mission,
    values,
    overallStrategicGoal,
    strategicPriorities,
    industry,
    industryOther,
    sector,
    sectorOther,
    businessDescription,
    businessBackground,
    businessDirection,
    companyProfileUrl,
    companyProfileFileName,
    strategicPlanDocumentUrl,
    strategicPlanDocumentFileName,
    supportingDocuments,
    websiteUrl,
    financialYearStart,
    planDurationYears,
    visionAchievementDate,
    keyCustomers,
    keyStakeholders,
    keyProductsServices,
    additionalInfo,
  });

  const draftRef = useRef(buildDraft());
  useEffect(() => {
    draftRef.current = buildDraft();
  });

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await saveBusinessProfileDraft(planIdRef.current, draftRef.current);
      planIdRef.current = result.planId;
      setLastSavedAt(new Date().toISOString());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => save(), 60000);
    return () => clearInterval(interval);
  }, [save]);

  // ─── Validation ──────────────────────────────────────────
  const industryValid = industry.trim().length > 0 && (industry !== "Others" || industryOther.trim().length > 0);
  const sectorValid = sector.trim().length > 0 && (sector !== "Others" || sectorOther.trim().length > 0);
  const websiteValid = websiteUrl.trim().length === 0 || /^https?:\/\//i.test(websiteUrl.trim());

  const fyStartYear = financialYearStart ? new Date(`${financialYearStart}T00:00:00Z`).getUTCFullYear() : null;
  const validVisionYears =
    fyStartYear && planDurationYears
      ? Array.from({ length: planDurationYears }, (_, i) => fyStartYear + i)
      : [];
  const visionYearValid =
    !!visionMonth && !!visionYear && validVisionYears.includes(Number(visionYear));

  const isStatusRowListValid = (rows: StatusRowEntry[], minRows: number) => {
    const firstN = rows.length >= minRows ? rows.slice(0, minRows) : rows;
    return (
      firstN.length >= minRows && firstN.every((r) => r.description.trim().length > 0 && r.status.trim().length > 0)
    );
  };

  const mandatoryChecks = [
    vision.trim().length >= 20,
    mission.trim().length >= 20,
    isCascadingListValid(values),
    overallStrategicGoal.trim().length >= 20,
    isCascadingListValid(strategicPriorities),
    industryValid,
    sectorValid,
    businessDescription.trim().length >= 50,
    businessBackground.trim().length >= 50,
    businessDirection.trim().length >= 50,
    financialYearStart.trim().length > 0,
    planDurationYears !== null,
    visionYearValid,
    isStatusRowListValid(keyCustomers, 3),
    isStatusRowListValid(keyStakeholders, 3),
    isStatusRowListValid(keyProductsServices, 1),
  ];
  const completedCount = mandatoryChecks.filter(Boolean).length;
  const totalCount = mandatoryChecks.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);
  const allMandatoryComplete = completedCount === totalCount;

  const errorFor = (field: string, condition: boolean, message: string) =>
    touched[field] && !condition ? message : undefined;

  const handleContinue = () => {
    setContinueError(null);
    startContinuing(async () => {
      try {
        const result = await saveBusinessProfileDraft(planIdRef.current, buildDraft());
        planIdRef.current = result.planId;
        router.push(`/dashboard/plan/${result.planId}`);
      } catch (err) {
        setContinueError(err instanceof Error ? err.message : "Failed to save. Please try again.");
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl pb-24">
      {/* Progress indicator */}
      <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-gray-200 bg-gray-50/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-navy">
            Profile Completion: {completedCount} of {totalCount} mandatory fields completed ({progressPct}%)
          </span>
          <span className="text-xs text-gray-400">
            {lastSavedAt ? `Last saved: ${new Date(lastSavedAt).toLocaleTimeString()}` : "Not saved yet"}
          </span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-gold transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <h1 className="text-xl font-semibold text-navy">Business & Strategic Profile</h1>
      <p className="mt-1 text-sm text-gray-500">
        This information feeds our AI advisor to autonomously generate your Corporate Strategic Plan and cascading
        Balanced Scorecards.
      </p>

      {/* ─── Section 1: Business Profile ─────────────────── */}
      <section className="mt-8 space-y-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-navy">Section 1: Business Profile</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700">🔒 Company Name</label>
          <input
            type="text"
            value={companyName}
            disabled
            className="mt-1 w-full rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-500"
          />
        </div>

        <div>
          <label htmlFor="vision" className="block text-sm font-medium text-gray-700">
            Company Vision <span className="text-red-600">*</span>
          </label>
          <textarea
            id="vision"
            rows={3}
            maxLength={1000}
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            onBlur={() => markTouched("vision")}
            placeholder="Describe your company's long-term vision — what you ultimately want to become or achieve"
            className={inputClass}
          />
          {touched.vision && vision.trim().length < 20 && (
            <p className="mt-1 text-xs text-red-600">Vision must be at least 20 characters.</p>
          )}
        </div>

        <div>
          <label htmlFor="mission" className="block text-sm font-medium text-gray-700">
            Company Mission <span className="text-red-600">*</span>
          </label>
          <textarea
            id="mission"
            rows={3}
            maxLength={1000}
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            onBlur={() => markTouched("mission")}
            placeholder="Describe your company's mission — what you do, for whom, and how"
            className={inputClass}
          />
          {touched.mission && mission.trim().length < 20 && (
            <p className="mt-1 text-xs text-red-600">Mission must be at least 20 characters.</p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-navy">
            Company Values <span className="text-red-600">*</span>
          </h3>
          <div className="mt-2">
            <CascadingList
              entries={values}
              onChange={setValues}
              nameLabel={(i) => `Value #${i + 1}`}
              descriptionLabel="Describe this value"
              namePlaceholder="e.g. Integrity"
              descriptionPlaceholder="Explain what this value means to your company and how it guides your behaviour"
              addLabel="+ Add Another Value"
            />
          </div>
        </div>

        <div>
          <label htmlFor="overallGoal" className="block text-sm font-medium text-gray-700">
            Overall Strategic Goal <span className="text-red-600">*</span>
          </label>
          <textarea
            id="overallGoal"
            rows={3}
            maxLength={1000}
            value={overallStrategicGoal}
            onChange={(e) => setOverallStrategicGoal(e.target.value)}
            onBlur={() => markTouched("overallGoal")}
            placeholder="What is the single overarching goal your company intends to achieve through this strategic plan?"
            className={inputClass}
          />
          {touched.overallGoal && overallStrategicGoal.trim().length < 20 && (
            <p className="mt-1 text-xs text-red-600">Overall Strategic Goal must be at least 20 characters.</p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-navy">
            Strategic Priorities <span className="text-red-600">*</span>
          </h3>
          <div className="mt-2">
            <CascadingList
              entries={strategicPriorities}
              onChange={setStrategicPriorities}
              nameLabel={(i) => `Strategic Priority #${i + 1}`}
              descriptionLabel="Describe this priority"
              namePlaceholder="e.g. Market Expansion"
              descriptionPlaceholder="Explain what this priority means, why it matters, and what it involves"
              addLabel="+ Add Another Priority"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <SearchableSelect
              id="industry"
              label="Business Industry"
              options={INDUSTRIES}
              value={industry}
              onChange={(v) => {
                setIndustry(v);
                markTouched("industry");
              }}
              required
              error={errorFor("industry", industry.trim().length > 0, "Please select an industry.")}
            />
            {industry === "Others" && (
              <input
                type="text"
                value={industryOther}
                onChange={(e) => setIndustryOther(e.target.value)}
                onBlur={() => markTouched("industryOther")}
                placeholder="Please specify your industry"
                className={`${inputClass} mt-2`}
              />
            )}
            {touched.industryOther && industry === "Others" && industryOther.trim().length === 0 && (
              <p className="mt-1 text-xs text-red-600">Please specify your industry.</p>
            )}
          </div>

          {industry.trim().length > 0 && (
            <div>
              <SearchableSelect
                id="sector"
                label="Business Sector"
                options={SECTORS}
                value={sector}
                onChange={(v) => {
                  setSector(v);
                  markTouched("sector");
                }}
                required
                error={errorFor("sector", sector.trim().length > 0, "Please select a sector.")}
              />
              {sector === "Others" && (
                <input
                  type="text"
                  value={sectorOther}
                  onChange={(e) => setSectorOther(e.target.value)}
                  onBlur={() => markTouched("sectorOther")}
                  placeholder="Please specify your sector"
                  className={`${inputClass} mt-2`}
                />
              )}
              {touched.sectorOther && sector === "Others" && sectorOther.trim().length === 0 && (
                <p className="mt-1 text-xs text-red-600">Please specify your sector.</p>
              )}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="businessDescription" className="block text-sm font-medium text-gray-700">
            Business Description <span className="text-red-600">*</span>
          </label>
          <textarea
            id="businessDescription"
            rows={4}
            maxLength={2000}
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            onBlur={() => markTouched("businessDescription")}
            placeholder="Provide a clear description of your business — what products or services you offer, how you operate, and what makes you unique"
            className={inputClass}
          />
          {touched.businessDescription && businessDescription.trim().length < 50 && (
            <p className="mt-1 text-xs text-red-600">Business Description must be at least 50 characters.</p>
          )}
        </div>

        <div>
          <label htmlFor="businessBackground" className="block text-sm font-medium text-gray-700">
            Business Background <span className="text-red-600">*</span>
          </label>
          <textarea
            id="businessBackground"
            rows={4}
            maxLength={2000}
            value={businessBackground}
            onChange={(e) => setBusinessBackground(e.target.value)}
            onBlur={() => markTouched("businessBackground")}
            placeholder="Provide a brief history of your company — when it was founded, how it has evolved, key milestones, and where you are today"
            className={inputClass}
          />
          {touched.businessBackground && businessBackground.trim().length < 50 && (
            <p className="mt-1 text-xs text-red-600">Business Background must be at least 50 characters.</p>
          )}
        </div>

        <div>
          <label htmlFor="businessDirection" className="block text-sm font-medium text-gray-700">
            Business Direction & Ambition <span className="text-red-600">*</span>
          </label>
          <textarea
            id="businessDirection"
            rows={4}
            maxLength={2000}
            value={businessDirection}
            onChange={(e) => setBusinessDirection(e.target.value)}
            onBlur={() => markTouched("businessDirection")}
            placeholder="Describe where you want to take this business — your overall ambition, what success looks like in the long term, and what you ultimately want to achieve"
            className={inputClass}
          />
          {touched.businessDirection && businessDirection.trim().length < 50 && (
            <p className="mt-1 text-xs text-red-600">Business Direction must be at least 50 characters.</p>
          )}
        </div>

        <FileUploadField
          tenantId={tenantId}
          storageFolder="company-profile"
          label="Upload Your Company Profile"
          description="Upload your company's official profile, brochure, or any document that describes your business in detail. This helps our AI generate a more accurate and tailored Strategic Plan."
          path={companyProfileUrl}
          fileName={companyProfileFileName}
          onUploaded={(path, name) => {
            setCompanyProfileUrl(path);
            setCompanyProfileFileName(name);
          }}
          onRemoved={() => {
            setCompanyProfileUrl(null);
            setCompanyProfileFileName(null);
          }}
        />

        <FileUploadField
          tenantId={tenantId}
          storageFolder="strategic-plan-draft"
          label="Upload any existing draft of your company's Strategic Plan"
          description="If you already have a draft or previous Strategic Plan, upload it here so our AI can build on what you already have."
          path={strategicPlanDocumentUrl}
          fileName={strategicPlanDocumentFileName}
          onUploaded={(path, name) => {
            setStrategicPlanDocumentUrl(path);
            setStrategicPlanDocumentFileName(name);
          }}
          onRemoved={() => {
            setStrategicPlanDocumentUrl(null);
            setStrategicPlanDocumentFileName(null);
          }}
        />

        <div>
          <h3 className="text-sm font-medium text-gray-700">Any other supporting documents</h3>
          <p className="text-xs text-gray-500">
            Upload any other document that contains information that would help Safina develop your Strategic Plan
            — e.g. board papers, market research, past reports.
          </p>
          <div className="mt-2">
            <SupportingDocumentsList
              tenantId={tenantId}
              documents={supportingDocuments}
              onChange={setSupportingDocuments}
            />
          </div>
        </div>

        <div>
          <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-700">
            Company Website
          </label>
          <input
            id="websiteUrl"
            type="text"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            onBlur={() => markTouched("websiteUrl")}
            placeholder="https://www.yourcompany.com"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            Our AI will reference your website to gather additional context for your Strategic Plan
          </p>
          {touched.websiteUrl && !websiteValid && (
            <p className="mt-1 text-xs text-red-600">Website must start with http:// or https://</p>
          )}
        </div>
      </section>

      {/* ─── Section 2: Strategic Profile ─────────────────── */}
      <section className="mt-8 space-y-6 rounded-lg border border-gray-200 bg-white p-6">
        <div>
          <h2 className="text-lg font-semibold text-navy">Section 2: Strategic Profile</h2>
          <p className="text-sm text-gray-500">
            Answer all questions below to help our AI build the most accurate Strategic Plan for your company.
          </p>
        </div>

        <div>
          <label htmlFor="fyStart" className="block text-sm font-medium text-gray-700">
            On which date does your financial year start? <span className="text-red-600">*</span>
          </label>
          <input
            id="fyStart"
            type="date"
            value={financialYearStart}
            onChange={(e) => setFinancialYearStart(e.target.value)}
            onBlur={() => markTouched("fyStart")}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            This is used to align your Strategic Plan and Balanced Scorecard timelines to your financial year
          </p>
          {touched.fyStart && !financialYearStart && (
            <p className="mt-1 text-xs text-red-600">Please select your financial year start date.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            How many years would you like this Strategic Plan to cover? <span className="text-red-600">*</span>
          </label>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setPlanDurationYears(n);
                  markTouched("planDuration");
                }}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  planDurationYears === n
                    ? "border-gold bg-gold text-navy"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {n} {n === 1 ? "Year" : "Years"}
              </button>
            ))}
          </div>
          {touched.planDuration && planDurationYears === null && (
            <p className="mt-1 text-xs text-red-600">Please select a plan duration.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            By which year do you aim to achieve your company&apos;s vision? <span className="text-red-600">*</span>
          </label>
          {fyStartYear && planDurationYears ? (
            <>
              <div className="mt-1 flex gap-2">
                <select
                  value={visionMonth}
                  onChange={(e) => {
                    setVisionMonth(e.target.value);
                    markTouched("visionYear");
                  }}
                  className={inputClass}
                >
                  <option value="">Month…</option>
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={visionYear}
                  onChange={(e) => {
                    setVisionYear(e.target.value);
                    markTouched("visionYear");
                  }}
                  className={inputClass}
                >
                  <option value="">Year…</option>
                  {validVisionYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Select a year between {validVisionYears[0]} and {validVisionYears[validVisionYears.length - 1]}
              </p>
              {touched.visionYear && !visionYearValid && (
                <p className="mt-1 text-xs text-red-600">
                  Your vision achievement year must fall within your {planDurationYears}-year Strategic Plan
                  period ({validVisionYears[0]} – {validVisionYears[validVisionYears.length - 1]}).
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              Set your financial year start and plan duration above first.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Who are your targeted customers? <span className="text-red-600">*</span>
          </label>
          <p className="text-xs text-gray-500">Provide as many customer segments as possible. Be specific.</p>
          <div className="mt-2">
            <StatusRowList
              entries={keyCustomers}
              onChange={setKeyCustomers}
              rowLabel={(i) => `Customer #${i + 1}`}
              descriptionPlaceholder="e.g. First-time home buyers aged 25–40 in urban areas"
              addLabel="+ Add Another Key Customer"
              statusOptions={IMPORTANCE_STATUS_OPTIONS}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Who are your key stakeholders? <span className="text-red-600">*</span>
          </label>
          <p className="text-xs text-gray-500">Provide as many stakeholder segments as possible.</p>
          <div className="mt-2">
            <StatusRowList
              entries={keyStakeholders}
              onChange={setKeyStakeholders}
              rowLabel={(i) => `Stakeholder #${i + 1}`}
              descriptionPlaceholder="e.g. Board of Directors"
              addLabel="+ Add Another Key Stakeholder"
              statusOptions={IMPORTANCE_STATUS_OPTIONS}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            What are your Key or core products/services? <span className="text-red-600">*</span>
          </label>
          <p className="text-xs text-gray-500">Provide as many key or core products/services as you can.</p>
          <div className="mt-2">
            <StatusRowList
              entries={keyProductsServices}
              onChange={setKeyProductsServices}
              rowLabel={(i) => `Product/Service #${i + 1}`}
              descriptionPlaceholder="e.g. Home loans"
              addLabel="+ Add Another Key or Core Products/Services"
              statusOptions={PRODUCT_SERVICE_STATUS_OPTIONS}
              minMandatoryRows={1}
            />
          </div>
        </div>

        <div>
          <label htmlFor="additionalInfo" className="block text-sm font-medium text-gray-700">
            Additional Information
          </label>
          <textarea
            id="additionalInfo"
            rows={5}
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
            placeholder="Provide any additional information that would help our AI draft a well-aligned Strategic Plan for your company. Include recent performance highlights, challenges you face, competitive pressures, regulatory environment, key partnerships, or anything else relevant."
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            The more context you provide here, the more accurate and relevant your AI-generated Strategic Plan
            will be
          </p>
        </div>
      </section>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 text-center">
        {continueError && <p className="mb-3 text-sm text-red-600">{continueError}</p>}
        <button
          type="button"
          disabled={!allMandatoryComplete || isContinuing}
          onClick={handleContinue}
          className={`rounded-md px-6 py-3 text-sm font-semibold ${
            allMandatoryComplete
              ? "bg-gold text-navy hover:bg-gold-light"
              : "cursor-not-allowed bg-gray-200 text-gray-400"
          }`}
        >
          {isContinuing ? "Saving…" : "Continue to Strategic Plan Document →"}
        </button>
        {!allMandatoryComplete && (
          <p className="mt-2 text-xs text-gray-400">
            Complete all mandatory fields above ({completedCount} of {totalCount} done) to continue.
          </p>
        )}
      </div>

      {/* Sticky Save Progress bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          {saveError && <span className="text-sm text-red-600">{saveError}</span>}
          <span className="flex-1" />
          <button
            type="button"
            disabled={isSaving}
            onClick={save}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save Progress"}
          </button>
        </div>
      </div>
    </div>
  );
}
