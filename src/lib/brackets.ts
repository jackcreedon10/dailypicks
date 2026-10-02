// Company size brackets for Daily Tickr, biggest first. Shared by the server and the browser.
export const BRACKETS = [
  { label: "Mega", range: "$500B+", min: 500e9 },
  { label: "Large", range: "$200–500B", min: 200e9 },
  { label: "Big", range: "$100–200B", min: 100e9 },
  { label: "Mid", range: "$50–100B", min: 50e9 },
  { label: "Small", range: "under $50B", min: 0 },
] as const;

/** One-line meaning of each S&P 500 sector, shown with the sector hint. Keys match the data's sector names. */
export const SECTOR_MEANING: Record<string, string> = {
  "Information Technology": "Software, hardware, semiconductors, and IT services",
  Financials: "Banks, insurance companies, asset managers, and payment processors",
  "Health Care": "Pharmaceuticals, biotech, medical devices, and healthcare providers",
  "Consumer Discretionary": "Non-essential goods and services like retail, automotive, and entertainment",
  "Communication Services": "Telecommunications, media, search engines, and social networking",
  Industrials: "Aerospace, defense, machinery, transportation, and construction",
  "Consumer Staples": "Essential goods like food, beverages, household items, and hygiene products",
  Energy: "Oil, natural gas, and renewable energy production and equipment",
  Utilities: "Electric, gas, water utilities, and independent power producers",
  Materials: "Chemicals, mining, forestry, and raw material processing",
  "Real Estate": "Real Estate Investment Trusts (REITs) and real estate management/development firms",
};
