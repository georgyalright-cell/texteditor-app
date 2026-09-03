(function attachFormatProfiles(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FormatProfiles = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createFormatProfiles() {
  "use strict";

  // Значения перенесены из методички HSE Graduate School of Business
  // «Business Plan: Course Project Guidelines», 3rd edition, 2026:
  // §2.1 — обязательные разделы, §2.2-2.10 — состав разделов и шаблоны
  // таблиц, §3.1 — состав работы, §5.1-5.3 — оформление,
  // Приложения 1-3 — титульный лист, оригинальность, личный вклад.

  const TWIPS_PER_MM = 1440 / 25.4;
  const TWIPS_PER_CM = 1440 / 2.54;

  function mmToTwips(value) {
    return Math.round(value * TWIPS_PER_MM);
  }

  function cmToTwips(value) {
    return Math.round(value * TWIPS_PER_CM);
  }

  // §5.1: A4, поля 2/2/3/1.5 см, TNR 12 pt, интервал 1.15, отступ 1.25 см,
  // выравнивание по ширине, интервал между абзацами 0.
  const BASE_LAYOUT = {
    page: {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 20,
      marginBottomMm: 20,
      marginLeftMm: 30,
      marginRightMm: 15,
    },
    font: { family: "Times New Roman", sizePt: 12 },
    body: {
      lineSpacing: 1.15,
      firstLineIndentCm: 1.25,
      alignment: "both",
      spacingBeforePt: 0,
      spacingAfterPt: 0,
    },
    heading: {
      uppercase: true,
      alignment: "center",
      firstLineIndentCm: 0,
      lineSpacing: 1.15,
      trailingBlankLine: true,
      pageBreakBeforeTopLevel: true,
      terminalPunctuation: false,
    },
    pageNumbers: {
      enabled: true,
      position: "bottom",
      alignment: "center",
      skipFirstPage: true,
      terminalPunctuation: false,
    },
    charactersPerPage: 2000,
  };

  // §5.1, «Requirements for design of tables, figures, graphs».
  const BASE_CAPTIONS = {
    table: { prefix: "Table", position: "above", alignment: "right" },
    figure: { prefix: "Figure", position: "below", alignment: "center" },
    authorsNote: "designed by the authors",
    numbering: "continuous",
  };

  // §5.3: ссылка в тексте в скобках — фамилия и год, ГОСТ Р 7.0.5-2008.
  const GOST_CITATION = {
    id: "gost-r-7.0.5-2008",
    label: "(Иванов, 1999) — автор и год в скобках",
    inTextPattern: /\(([^()\n]{2,80}?,\s*\d{4}[a-z]?(?:,\s*\d{4}[a-z]?)*)\)/gu,
    // Нумерованные ссылки вида [12] методичкой не предусмотрены —
    // помечаем их как несоответствие, но не переписываем автоматически:
    // подстановка фамилии и года требует знания источника.
    foreignPattern: /\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/gu,
  };

  const PERIOD_COLUMNS = ["Period 0", "Period 1", "…", "Period T"];

  // Шаблонные таблицы из §2.2-2.9. Номера в id — номера таблиц в методичке;
  // в собранном документе нумерация сквозная и назначается заново (§5.1).
  const TABLES = {
    projectSummary: {
      id: "guideline-table-1",
      title: "Project summary",
      columns: ["Project Data", "Period I", "Period II", "Period III", "Period IV", "Period V"],
      rows: ["Sales", "Gross Profit", "Net Profit", "ROI", "NPV", "IRR", "Payback Period"],
    },
    industryDynamics: {
      id: "guideline-table-2",
      title: "Dynamics for industries relevant to the business",
      columns: ["Relevant Industries", "Industry Size", "Growth Rates (past period)", "Growth Rates Forecast"],
      rows: ["Industry 1", "Industry 2", "Industry 3"],
    },
    marketCapacity: {
      id: "guideline-table-4",
      title: "Evaluating target market capacity",
      columns: [
        "Potential Market Capacity",
        "Accessible Market Capacity",
        "Evaluation Method",
        "Data Source",
        "Measuring Limitations",
      ],
      rows: [""],
    },
    porterForces: {
      id: "guideline-table-6",
      title: "Porter's five forces: analysis results",
      columns: ["Competitive Force", "Impact Assessment", "Impact Description"],
      rows: [
        "Rivalry within the industry",
        "Threat of new entrants",
        "Bargaining power of buyers",
        "Bargaining power of suppliers",
        "Threat of substitute products",
      ],
    },
    competitorCsf: {
      id: "guideline-table-16",
      title: "CSF-based evaluation of the company against its main competitors",
      columns: ["Critical Success Factor", "Weight", "Our company", "Competitor 1", "Competitor 2"],
      rows: ["Factor 1", "Factor 2", "Factor 3"],
    },
    promotionCosts: {
      id: "guideline-table-20",
      title: "Promotion tools used and their cost estimate",
      columns: [
        "Event name",
        "Promotion channel",
        "Event price",
        "Number of events per month",
        "Cost per month",
        "Period of use",
      ],
      rows: ["", "", "TOTAL"],
    },
    salesPlan: {
      id: "guideline-table-21",
      title: "Sales plan",
      columns: ["Indicator", ...PERIOD_COLUMNS],
      rows: [
        "Quantitative sales forecast",
        "Product 1, ea",
        "Product N, ea",
        "Price forecast",
        "Product 1, RUB/ea",
        "Product N, RUB/ea",
        "Monetary sales forecast",
        "Product 1, RUB",
        "Product N, RUB",
      ],
    },
    staffSchedule: {
      id: "guideline-table-23",
      title: "Staff schedule (form Т-3)",
      columns: [
        "Structural Unit",
        "Job title, level, category",
        "Number of staff positions",
        "Pay rate (salary), RUB",
        "Wage premiums, RUB",
        "Total per month, RUB",
      ],
      rows: ["", "", "TOTAL"],
    },
    payroll: {
      id: "guideline-table-24",
      title: "Staff payroll calculation",
      columns: ["Position", "Responsibilities", "Pay Rate", "Count", "Salary, RUB", "Insurance per month"],
      rows: ["", "", "TOTAL"],
    },
    generalCosts: {
      id: "guideline-table-25",
      title: "Forecast of general and administrative management-related costs",
      columns: ["Indicator", ...PERIOD_COLUMNS],
      rows: [
        "Management labour costs, including payroll surcharges, RUB",
        "Other management-related general and administrative costs, RUB",
        "Total G&A costs, RUB",
      ],
    },
    productionPlan: {
      id: "guideline-table-26",
      title: "Production plan",
      columns: ["Indicator", ...PERIOD_COLUMNS],
      rows: [
        "Sales volume (production output), units",
        "Product 1",
        "Product N",
        "Production labour costs, RUB",
        "Raw material costs, RUB",
        "Variable production costs, RUB",
        "Fixed production costs, RUB",
        "Operating costs for production, RUB",
        "Purchase of manufacturing resources, RUB",
        "Production resource stock, RUB",
        "Work in progress, RUB",
      ],
    },
    assetInvestment: {
      id: "guideline-table-27",
      title: "Asset investment profile",
      columns: ["Complete list of products", "Product 1", "Product 2", "…", "Product N"],
      rows: [
        "Assets required to create the product or provide the service",
        "Way of using the assets (ownership or lease)",
        "Cost of required assets",
      ],
    },
    operatingCashFlow: {
      id: "guideline-table-28",
      title: "Operating cash flow planning",
      columns: ["Factor", ...PERIOD_COLUMNS],
      rows: [
        "Revenues, RUB",
        "Operating production costs, RUB",
        "Selling and management costs, RUB",
        "Operating costs, RUB",
        "Depreciation, RUB",
        "Earnings before interest and taxes, RUB",
        "Interest due, RUB",
        "Earnings before taxes, RUB",
        "Current income tax, RUB",
        "Operating cash flow, RUB",
      ],
    },
    cashPlanning: {
      id: "guideline-table-29",
      title: "Planning for cash",
      columns: ["Factor", ...PERIOD_COLUMNS],
      rows: [
        "Fixed assets, residual value, RUB",
        "Capital expenditures, RUB",
        "Net working capital, RUB",
        "Change in net working capital, RUB",
        "Cash flow from investing activities, RUB",
        "Free cash flow, RUB",
      ],
    },
  };

  // §2.1 — восемь обязательных разделов. Подразделы и таблицы взяты из
  // §2.2-2.10; они формируют каркас, который автор заполняет содержанием.
  const CANONICAL_SECTIONS = [
    {
      id: "executive-summary",
      title: "Executive Summary",
      aliases: ["executive summary", "резюме проекта", "резюме"],
      note: "Не более полутора страниц; составляется последним и не должен противоречить остальным разделам.",
      subsections: [
        "Project overview and stage of development",
        "Summary of the business plan sections",
        "Key performance indicators",
        "Project prospects",
      ],
      tables: [TABLES.projectSummary],
    },
    {
      id: "business-outline",
      title: "Business Outline and Market Analysis",
      aliases: [
        "business outline",
        "market analysis",
        "business outline and market analysis",
        "описание бизнеса",
        "анализ рынка",
      ],
      subsections: [
        "Business idea and value proposition",
        "Business Model Canvas",
        "Products and services",
        "Industry dynamics",
        "Target market and its capacity",
        "Porter's five competitive forces",
        "Competitor analysis",
        "Market segmentation and target segment",
      ],
      tables: [TABLES.industryDynamics, TABLES.marketCapacity, TABLES.porterForces, TABLES.competitorCsf],
    },
    {
      id: "marketing-sales",
      title: "Marketing and Sales Plan",
      aliases: ["marketing and sales plan", "marketing plan", "sales plan", "план маркетинга", "маркетинговый план"],
      subsections: [
        "Segmentation, targeting, positioning",
        "Product",
        "Price",
        "Place",
        "Promotion",
        "Sales process and sales funnel",
        "Sales plan and KPIs",
      ],
      tables: [TABLES.promotionCosts, TABLES.salesPlan],
    },
    {
      id: "organization",
      title: "Organization Plan",
      aliases: ["organization plan", "organizational structure", "организационный план", "организационная структура"],
      subsections: [
        "Legal form of the enterprise",
        "Organizational structure",
        "Staffing plan",
        "Payroll and personnel costs",
      ],
      tables: [TABLES.staffSchedule, TABLES.payroll],
    },
    {
      id: "production",
      title: "Production Plan",
      aliases: ["production plan", "производственный план"],
      subsections: [
        "Production technology and production cycle",
        "Assets, competencies and resources required",
        "Production volume planning",
        "Operating costs",
      ],
      tables: [TABLES.generalCosts, TABLES.productionPlan],
    },
    {
      id: "investment",
      title: "Investment Plan",
      aliases: ["investment plan", "инвестиционный план"],
      subsections: ["Required assets", "Investment schedule", "Sources of financing"],
      tables: [TABLES.assetInvestment],
    },
    {
      id: "financial",
      title: "Financial Plan",
      aliases: ["financial plan", "финансовый план"],
      subsections: [
        "Revenue forecast",
        "Operating costs forecast",
        "Operating cash flow",
        "Cash flow from investing activities",
        "Free cash flow and financing",
      ],
      tables: [TABLES.operatingCashFlow, TABLES.cashPlanning],
    },
    {
      id: "performance",
      title: "Project Performance Evaluation and Risk Analysis",
      aliases: [
        "project performance evaluation",
        "performance evaluation",
        "risk analysis",
        "оценка эффективности проекта",
        "анализ рисков",
      ],
      subsections: [
        "NPV and IRR",
        "Payback period",
        "Unit economics",
        "Scenario analysis",
        "Sensitivity analysis",
        "Project risks",
      ],
      tables: [],
    },
  ];

  // §3.1 — состав текста курсового проекта, в порядке следования.
  const REQUIRED_PARTS = [
    { id: "contents", title: "Contents", patterns: [/^contents$/imu, /^table of contents$/imu, /^содержание$/imu] },
    { id: "conclusion", title: "Conclusion", patterns: [/^conclusion$/imu, /^заключение$/imu] },
    {
      id: "references",
      title: "References",
      patterns: [/^references$/imu, /^bibliography$/imu, /^список (?:источников|литературы)$/imu],
    },
  ];

  // Приложение 1 — шаблон титульного листа.
  const TITLE_PAGE = {
    institution: [
      "Federal State Autonomous Educational Institution of Higher Education",
      "NATIONAL RESEARCH UNIVERSITY HIGHER SCHOOL OF ECONOMICS",
      "Graduate School of Business",
    ],
    projectLabel: "COURSE PROJECT «Business Plan»",
    fieldOfStudy: "field of study 38.03.02 Management",
    programmeOptions: ["Business Management", "Business Informatics"],
    supervisorVerdict: "The course project meets / does not meet (underline as appropriate) the established requirements",
    city: "Moscow",
  };

  // Приложение 2 — подтверждение оригинальности.
  const ORIGINALITY_STATEMENT = {
    title: "Confirmation of course project originality and compliance with academic standards",
    claims: [
      "does not reproduce our previously completed work or the work of other students;",
      "does not reproduce work by other authors without proper referencing and citation;",
      "has not been previously submitted for assessment in any other course or for academic credits at HSE Graduate School of Business or any other educational institution;",
      "contains a complete and accurate list of references; all claims, data, and estimates are supported by citations.",
    ],
    acknowledgement:
      "We acknowledge that violation of the HSE internal regulations is considered a serious offence, entailing qualification as a breach of the HSE Internal Regulations.",
    signatureLabel: "Student signatures:",
    signatureLine: "___________________________   _______________   \"____\" __________ ",
  };

  // Приложение 3 — раздел личного вклада, 1-2 страницы на участника,
  // размещается в конце основного текста перед заключением.
  const INDIVIDUAL_CONTRIBUTION = {
    title: "Individual Contribution",
    placement: "before-conclusion",
    subsections: [
      "Role in the project",
      "Personal tasks and completed work",
      "Artefacts and references",
      "Conclusions on one's part",
    ],
  };

  // §2.1 — адаптация структуры под тип проекта.
  const PROJECT_VARIANTS = [
    {
      id: "general",
      title: "Универсальная структура",
      emphasis: [],
    },
    {
      id: "startup",
      title: "Стартап или инновационный проект",
      emphasis: [
        "Business Outline — Business Model Canvas или Lean Canvas",
        "Market Analysis — problem-solution fit и ранние пользователи",
        "Production Plan — MVP и итерации продукта",
        "Financial Plan — стадии привлечения средств и burn rate",
        "Performance Evaluation — юнит-экономика, майлстоуны, сценарный анализ",
      ],
    },
    {
      id: "platform",
      title: "Платформа или маркетплейс",
      emphasis: [
        "Business Outline — обе стороны платформы и механизмы создания ценности",
        "Market Analysis — каждая сторона анализируется отдельно",
        "Marketing and Sales Plan — chicken-and-egg стратегия и сетевые эффекты",
        "Performance Evaluation — GMV, take rate, LTV/CAC, активность пользователей",
      ],
    },
    {
      id: "social",
      title: "Социальный проект",
      emphasis: [
        "Business Outline — Theory of Change",
        "Market Analysis — социальная проблема и группы благополучателей",
        "Financial Plan — гранты, пожертвования, социальные инвестиции",
        "Performance Evaluation — SROI и нефинансовые метрики влияния",
      ],
    },
    {
      id: "market-entry",
      title: "Выход на новый рынок",
      emphasis: [
        "Во всех разделах существующий бизнес отделён от нового рынка",
        "Market Analysis — сравнение текущего и нового рынка",
        "Financial Plan — приростные денежные потоки",
        "Performance Evaluation — приростной NPV",
      ],
    },
  ];

  const PROFILES = [
    {
      id: "hse-business-plan",
      label: "Бизнес-план HSE",
      description:
        "Курсовой проект «Бизнес-план» по методичке Высшей школы бизнеса НИУ ВШЭ, 3-е издание. " +
        "Собирается полный документ: титульный лист, оригинальность, оглавление, восемь разделов " +
        "с подразделами и шаблонными таблицами, личный вклад, заключение, источники, приложения.",
      assembleFullDocument: true,
      strictSections: true,
      layout: BASE_LAYOUT,
      captions: BASE_CAPTIONS,
      citation: GOST_CITATION,
      requiredSections: CANONICAL_SECTIONS,
      requiredParts: REQUIRED_PARTS,
      titlePage: TITLE_PAGE,
      originality: ORIGINALITY_STATEMENT,
      individualContribution: INDIVIDUAL_CONTRIBUTION,
      variants: PROJECT_VARIANTS,
    },
    {
      id: "academic-report",
      label: "Академический отчёт",
      description:
        "Те же требования к оформлению и та же сборка титульного листа, оглавления и списка источников, " +
        "но без обязательного списка разделов — структура берётся из вашего текста.",
      assembleFullDocument: true,
      strictSections: false,
      layout: BASE_LAYOUT,
      captions: BASE_CAPTIONS,
      citation: GOST_CITATION,
      requiredSections: [],
      requiredParts: REQUIRED_PARTS,
      titlePage: TITLE_PAGE,
      originality: null,
      individualContribution: null,
      variants: [],
    },
  ];

  function list() {
    return PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.label,
      description: profile.description,
    }));
  }

  function get(id) {
    return PROFILES.find((profile) => profile.id === id) || PROFILES[0];
  }

  function defaultProfileId() {
    return PROFILES[0].id;
  }

  function variants(profileId) {
    return get(profileId).variants;
  }

  return {
    list,
    get,
    variants,
    defaultProfileId,
    mmToTwips,
    cmToTwips,
    TABLES,
  };
});
