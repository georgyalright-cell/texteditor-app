(function attach(root) {
  "use strict";
  // Editorial brief, not a CEFR classifier or a corpus of authenticated authors.
  // Two short attributed excerpts; full teaching materials are not redistributed.
  const api = {
    id: "business-english-b2-c1-v1",
    instruction: "Use clear B2–C1 Business English suitable for a university business plan. Use precise business vocabulary without inflated claims, idioms, slang or ornamental synonyms. Keep technical terms. Prefer a different clause order or sentence opening where natural, not a sequence of decorative synonyms. Use varied but readable sentences, natural transitions and a neutral evidence-based tone. Passive voice is acceptable when the actor is unknown. Preserve uncertainty, comparisons, causal direction and who does what. Never introduce another business mechanism or benefit. The writing examples illustrate language only: never copy their facts or wording into the result. Do not translate the source or change document headings, tables or citation style.",
    examples: [
      { text: "This may help them get a better job in the future.", level: "B2", source: "British Council — A report on working abroad", url: "https://learnenglish.britishcouncil.org/free-resources/writing/b2/report-working-abroad" },
      { text: "There was no correlation between salaries and level of employee engagement.", level: "C1", source: "British Council — A report on a research study", url: "https://learnenglish.britishcouncil.org/free-resources/writing/c1/report-research-study" },
    ],
    sources: [
      "https://www.sec.gov/pdf/handbook.pdf",
      "https://learnenglish.britishcouncil.org/free-resources/writing/b2/report-working-abroad",
      "https://learnenglish.britishcouncil.org/free-resources/writing/c1/report-research-study",
    ],
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BusinessEnglish = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
