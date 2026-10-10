/**
 * Formula and symbol catalogue for the question-paper editor, by subject.
 *
 * The editor used to show one short mixed list for every paper. A Maths
 * teacher wants the whole Maths set (algebra, geometry, trigonometry,
 * statistics, symbols), a Physics teacher the Physics set, a Hindi teacher
 * the matras and punctuation. `catalogFor(subjectName)` returns the groups
 * for that subject first, then the general symbols; `searchCatalog` filters
 * them; anything missing goes to the AI search (api/ai/exam-symbols).
 *
 * Pure data + pure functions; no imports.
 */

export type SubjectKey =
  | "maths"
  | "physics"
  | "chemistry"
  | "biology"
  | "science"
  | "evs"
  | "computer"
  | "hindi"
  | "sanskrit"
  | "english"
  | "sst"
  | "general";

export type FormulaEntry = {
  /** What is inserted into the question. */
  insert: string;
  /** Short label on the button (defaults to insert). */
  label: string;
  /** Group heading within the subject: "Algebra", "Motion", "Matras"… */
  group: string;
  subject: SubjectKey;
};

function e(subject: SubjectKey, group: string, rows: (string | [string, string])[]): FormulaEntry[] {
  return rows.map((r) =>
    typeof r === "string"
      ? { insert: r, label: r, group, subject }
      : { insert: r[0], label: r[1], group, subject },
  );
}

export const FORMULA_CATALOG: FormulaEntry[] = [
  // ------------------------------------------------------------ maths
  ...e("maths", "Symbols", ["+", "−", "×", "÷", "=", "≠", "≈", "<", ">", "≤", "≥", "±", "√", "∛", "²", "³", "ⁿ", "π", "∞", "%", "°", "∠", "△", "∥", "⊥", "≅", "∼", "∴", "∵", "∈", "∉", "⊂", "∪", "∩", "∅", "Σ", "∏", "→", "⇒", "⇔", "|x|", "( )", "[ ]", "{ }", "½", "⅓", "¼", "¾"]),
  ...e("maths", "Arithmetic", ["a + b", "a − b", "a × b", "a ÷ b", ["a/b", "fraction a/b"], "LCM(a, b)", "HCF(a, b)", ["a : b", "ratio"], ["a% of b = (a/100) × b", "percentage"], ["SP = CP + Profit", "profit"], ["Profit % = (Profit/CP) × 100", "profit %"], ["Loss % = (Loss/CP) × 100", "loss %"], ["SI = P × R × T / 100", "simple interest"], ["A = P(1 + R/100)ⁿ", "compound amount"], ["CI = A − P", "compound interest"], ["Discount = MP − SP", "discount"], ["Speed = Distance / Time", "speed"], ["Average = Sum / Count", "average"]]),
  ...e("maths", "Algebra", ["(a + b)² = a² + 2ab + b²", "(a − b)² = a² − 2ab + b²", "a² − b² = (a + b)(a − b)", "(a + b)³ = a³ + 3a²b + 3ab² + b³", "(a − b)³ = a³ − 3a²b + 3ab² − b³", "a³ + b³ = (a + b)(a² − ab + b²)", "a³ − b³ = (a − b)(a² + ab + b²)", ["x = [−b ± √(b² − 4ac)] / 2a", "quadratic formula"], ["D = b² − 4ac", "discriminant"], ["α + β = −b/a", "sum of roots"], ["αβ = c/a", "product of roots"], ["aₙ = a + (n − 1)d", "AP nth term"], ["Sₙ = n/2 [2a + (n − 1)d]", "AP sum"], ["aₙ = arⁿ⁻¹", "GP nth term"], ["aᵐ × aⁿ = aᵐ⁺ⁿ", "laws of exponents"], ["(aᵐ)ⁿ = aᵐⁿ", "power of power"], ["a⁰ = 1", "zero exponent"], ["log(ab) = log a + log b", "log product"]]),
  ...e("maths", "Geometry", [["Area of rectangle = l × b", "rectangle"], ["Perimeter of rectangle = 2(l + b)", "rectangle perimeter"], ["Area of square = a²", "square"], ["Area of triangle = ½ × b × h", "triangle"], ["Heron: A = √[s(s−a)(s−b)(s−c)]", "Heron's formula"], ["Area of circle = πr²", "circle"], ["Circumference = 2πr", "circumference"], ["Area of parallelogram = b × h", "parallelogram"], ["Area of rhombus = ½ × d₁ × d₂", "rhombus"], ["Area of trapezium = ½ (a + b) × h", "trapezium"], ["a² + b² = c²", "Pythagoras"], ["Sum of angles of triangle = 180°", "triangle angles"], ["Sum of interior angles = (n − 2) × 180°", "polygon angles"], ["Distance = √[(x₂ − x₁)² + (y₂ − y₁)²]", "distance formula"], ["Midpoint = ((x₁ + x₂)/2, (y₁ + y₂)/2)", "midpoint"], ["Slope m = (y₂ − y₁)/(x₂ − x₁)", "slope"], ["y = mx + c", "line"]]),
  ...e("maths", "Mensuration", [["Volume of cuboid = l × b × h", "cuboid"], ["TSA of cuboid = 2(lb + bh + hl)", "cuboid surface"], ["Volume of cube = a³", "cube"], ["TSA of cube = 6a²", "cube surface"], ["Volume of cylinder = πr²h", "cylinder"], ["CSA of cylinder = 2πrh", "cylinder CSA"], ["TSA of cylinder = 2πr(r + h)", "cylinder TSA"], ["Volume of cone = ⅓πr²h", "cone"], ["CSA of cone = πrl", "cone CSA"], ["l = √(r² + h²)", "slant height"], ["Volume of sphere = 4/3 πr³", "sphere"], ["Surface area of sphere = 4πr²", "sphere surface"], ["Volume of hemisphere = 2/3 πr³", "hemisphere"]]),
  ...e("maths", "Trigonometry", ["sin θ", "cos θ", "tan θ", "cosec θ", "sec θ", "cot θ", ["sin θ = P/H", "sin"], ["cos θ = B/H", "cos"], ["tan θ = P/B", "tan"], "sin²θ + cos²θ = 1", "1 + tan²θ = sec²θ", "1 + cot²θ = cosec²θ", ["sin 30° = ½", "sin 30"], ["cos 60° = ½", "cos 60"], ["tan 45° = 1", "tan 45"], ["sin 90° = 1", "sin 90"], ["h = d tan θ", "height & distance"]]),
  ...e("maths", "Statistics & probability", [["Mean = Σx / n", "mean"], ["Mean = Σfx / Σf", "mean (grouped)"], ["Median = l + [(n/2 − cf)/f] × h", "median (grouped)"], ["Mode = l + [(f₁ − f₀)/(2f₁ − f₀ − f₂)] × h", "mode (grouped)"], ["Range = Max − Min", "range"], ["P(E) = favourable / total", "probability"], ["P(E) + P(not E) = 1", "complement"], "0 ≤ P(E) ≤ 1"]),
  // ------------------------------------------------------------ physics
  ...e("physics", "Symbols & units", ["m/s", "m/s²", "km/h", "N", "J", "W", "Pa", "Hz", "Ω", "V", "A", "C", "T", "K", "°C", "kg", "m", "s", "Δ", "λ", "ν", "ρ", "μ", "ω", "θ", "≈", "∝", "×10ⁿ"]),
  ...e("physics", "Motion", [["Speed = Distance / Time", "speed"], ["Velocity = Displacement / Time", "velocity"], ["a = (v − u) / t", "acceleration"], ["v = u + at", "1st equation"], ["s = ut + ½at²", "2nd equation"], ["v² = u² + 2as", "3rd equation"], ["g = 9.8 m/s²", "g"], ["Momentum p = mv", "momentum"], ["F = ma", "Newton's 2nd law"], ["Impulse = F × t = Δp", "impulse"], ["W = mg", "weight"], ["a = v²/r", "centripetal"]]),
  ...e("physics", "Work, energy & power", [["W = F × s", "work"], ["W = F s cos θ", "work at angle"], ["KE = ½mv²", "kinetic energy"], ["PE = mgh", "potential energy"], ["P = W / t", "power"], ["1 kWh = 3.6 × 10⁶ J", "kWh"], ["Efficiency = output/input × 100%", "efficiency"]]),
  ...e("physics", "Gravitation & pressure", [["F = G m₁m₂ / r²", "gravitation"], ["G = 6.67 × 10⁻¹¹ N m²/kg²", "G"], ["Pressure = Force / Area", "pressure"], ["P = ρgh", "liquid pressure"], ["Density = Mass / Volume", "density"], ["Thrust = weight of displaced liquid", "Archimedes"], ["Relative density = ρ / ρ_water", "relative density"]]),
  ...e("physics", "Light", [["1/f = 1/v − 1/u", "mirror/lens formula"], ["m = h′/h = −v/u", "magnification (mirror)"], ["m = h′/h = v/u", "magnification (lens)"], ["f = R/2", "focal length"], ["P = 1/f (dioptre)", "power of lens"], ["n = c/v", "refractive index"], ["n = sin i / sin r", "Snell's law"], ["∠i = ∠r", "reflection"], ["c = 3 × 10⁸ m/s", "speed of light"]]),
  ...e("physics", "Electricity & magnetism", [["V = IR", "Ohm's law"], ["R = ρl/A", "resistivity"], ["R = R₁ + R₂ + …", "series"], ["1/R = 1/R₁ + 1/R₂ + …", "parallel"], ["P = VI", "power"], ["P = I²R", "power"], ["P = V²/R", "power"], ["H = I²Rt", "Joule heating"], ["Q = It", "charge"], ["E = P × t", "energy"], ["F = BIl", "force on conductor"], ["Fleming's left-hand rule", "FLHR"], ["Fleming's right-hand rule", "FRHR"]]),
  ...e("physics", "Sound & waves", [["v = f λ", "wave speed"], ["T = 1/f", "time period"], ["v = 2d / t", "echo"], ["v(sound) ≈ 343 m/s", "speed of sound"], ["Audible range 20 Hz – 20 kHz", "audible range"]]),
  ...e("physics", "Heat", [["Q = mcΔT", "specific heat"], ["Q = mL", "latent heat"], ["K = °C + 273", "kelvin"], ["°F = (9/5)°C + 32", "fahrenheit"]]),
  // ------------------------------------------------------------ chemistry
  ...e("chemistry", "Symbols", ["→", "⇌", "↑", "↓", "Δ", "+", "(s)", "(l)", "(g)", "(aq)", "₂", "₃", "₄", "⁺", "⁻", "²⁺", "²⁻", "³⁺", "e⁻", "pH", "mol", "M", "Å"]),
  ...e("chemistry", "Common formulae", ["H₂O", "CO₂", "O₂", "N₂", "H₂", "NaCl", "HCl", "H₂SO₄", "HNO₃", "NaOH", "KOH", "Ca(OH)₂", "CaCO₃", "CaO", "NH₃", "CH₄", "C₂H₅OH", "CH₃COOH", "C₆H₁₂O₆", "NaHCO₃", "Na₂CO₃", "CuSO₄", "FeSO₄", "ZnSO₄", "MgO", "Al₂O₃", "Fe₂O₃", "SO₂", "NO₂", "CO", "H₂O₂", "KMnO₄", "K₂Cr₂O₇", "AgNO₃", "PbO", "Cl₂", "Br₂", "I₂"]),
  ...e("chemistry", "Reactions", [["2H₂ + O₂ → 2H₂O", "formation of water"], ["CaCO₃ → CaO + CO₂", "decomposition"], ["Zn + H₂SO₄ → ZnSO₄ + H₂", "metal + acid"], ["NaOH + HCl → NaCl + H₂O", "neutralisation"], ["2Mg + O₂ → 2MgO", "combustion of Mg"], ["Fe + CuSO₄ → FeSO₄ + Cu", "displacement"], ["AgNO₃ + NaCl → AgCl + NaNO₃", "double displacement"], ["CH₄ + 2O₂ → CO₂ + 2H₂O", "combustion of methane"], ["2H₂O₂ → 2H₂O + O₂", "decomposition of H₂O₂"], ["Photosynthesis: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", "photosynthesis"], ["Respiration: C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + energy", "respiration"]]),
  ...e("chemistry", "Mole & solutions", [["n = m / M", "moles"], ["N = n × 6.022 × 10²³", "particles"], ["Molarity = moles / litre", "molarity"], ["Concentration % = solute/solution × 100", "concentration"], ["1 mol gas = 22.4 L at STP", "molar volume"], ["Atomic mass unit u = 1.66 × 10⁻²⁷ kg", "amu"]]),
  ...e("chemistry", "Atomic structure", ["1s² 2s² 2p⁶", ["K L M N", "shells"], ["2, 8, 8, 18", "shell capacity"], ["Valency", "valency"], ["Atomic number Z = protons", "Z"], ["Mass number A = p + n", "A"], ["Isotopes", "isotopes"]]),
  // ------------------------------------------------------------ biology
  ...e("biology", "Symbols", ["♂", "♀", "×", "F₁", "F₂", "P", "TT", "Tt", "tt", "→", "%", "μm", "nm", "°C"]),
  ...e("biology", "Processes", [["Photosynthesis: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", "photosynthesis"], ["Respiration: C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + energy", "aerobic respiration"], ["Glucose → Ethanol + CO₂ + energy", "fermentation"], ["Glucose → Lactic acid + energy", "muscle respiration"], ["Nitrogen cycle", "nitrogen cycle"], ["Carbon cycle", "carbon cycle"], ["Water cycle", "water cycle"]]),
  ...e("biology", "Genetics", [["Tt × Tt → 1 TT : 2 Tt : 1 tt", "monohybrid"], ["3 : 1", "phenotypic ratio"], ["1 : 2 : 1", "genotypic ratio"], ["9 : 3 : 3 : 1", "dihybrid"], ["XX / XY", "sex determination"], ["DNA → RNA → Protein", "central dogma"]]),
  ...e("biology", "Health & body", [["BMI = weight (kg) / height² (m²)", "BMI"], ["Normal BP 120/80 mm Hg", "blood pressure"], ["Normal temperature 37 °C / 98.6 °F", "body temperature"], ["Pulse 72 / min", "pulse"], ["Blood groups A, B, AB, O", "blood groups"], ["Rh⁺ / Rh⁻", "Rh factor"]]),
  // ------------------------------------------------------------ science (VI–X general)
  ...e("science", "Units & symbols", ["m", "cm", "km", "kg", "g", "L", "mL", "s", "min", "h", "°C", "N", "J", "W", "→", "Δ", "²", "³", "×", "÷", "%", "≈"]),
  ...e("science", "Everyday formulae", [["Speed = Distance / Time", "speed"], ["Density = Mass / Volume", "density"], ["Work = Force × Distance", "work"], ["Pressure = Force / Area", "pressure"], ["Area = l × b", "area"], ["Volume = l × b × h", "volume"], ["Photosynthesis: CO₂ + H₂O → glucose + O₂", "photosynthesis"], ["H₂O", "water"], ["CO₂", "carbon dioxide"], ["O₂", "oxygen"], ["NaCl", "common salt"]]),
  // ------------------------------------------------------------ evs (primary)
  ...e("evs", "Signs", ["→", "✓", "✗", "☀", "☁", "☂", "❄", "🌱", "🌳", "🌸", "🍎", "🐄", "🐦", "🐟", "💧", "🔥", "♻", "⚠", "🚰", "🩺"]),
  ...e("evs", "Measures", ["cm", "m", "km", "g", "kg", "L", "mL", "°C", "%", ["7 days = 1 week", "week"], ["12 months = 1 year", "year"], ["24 hours = 1 day", "day"], ["60 minutes = 1 hour", "hour"]]),
  // ------------------------------------------------------------ computer
  ...e("computer", "Symbols", ["{ }", "( )", "[ ]", "< >", "=", "==", "!=", "<=", ">=", "&&", "||", "!", "+=", "++", "--", "%", "//", "/*", "*/", "#", "$", "&", "|", "^", "~", "\\", "/", "_", "->", "=>", ";", ":", "::"]),
  ...e("computer", "Number systems", [["(1010)₂", "binary"], ["(12)₈", "octal"], ["(1F)₁₆", "hex"], ["1 byte = 8 bits", "byte"], ["1 KB = 1024 B", "KB"], ["1 MB = 1024 KB", "MB"], ["1 GB = 1024 MB", "GB"], ["ASCII", "ASCII"], ["2ⁿ", "2 to the n"]]),
  ...e("computer", "Logic", ["AND", "OR", "NOT", "NAND", "NOR", "XOR", ["A · B", "AND"], ["A + B", "OR"], ["Ā", "NOT A"], ["A ⊕ B", "XOR"], ["Truth table", "truth table"], ["if … else", "if"], ["for i in range(n):", "for (Python)"], ["while (condition)", "while"], ["print()", "print"], ["input()", "input"], ["SELECT * FROM table;", "SQL"]]),
  // ------------------------------------------------------------ hindi
  ...e("hindi", "मात्राएँ", ["ा", "ि", "ी", "ु", "ू", "ृ", "े", "ै", "ो", "ौ", "ं", "ः", "ँ", "्", "ॅ", "ॉ"]),
  ...e("hindi", "स्वर", ["अ", "आ", "इ", "ई", "उ", "ऊ", "ऋ", "ए", "ऐ", "ओ", "औ", "अं", "अः"]),
  ...e("hindi", "व्यंजन", ["क", "ख", "ग", "घ", "ङ", "च", "छ", "ज", "झ", "ञ", "ट", "ठ", "ड", "ढ", "ण", "त", "थ", "द", "ध", "न", "प", "फ", "ब", "भ", "म", "य", "र", "ल", "व", "श", "ष", "स", "ह", "क्ष", "त्र", "ज्ञ", "श्र", "ड़", "ढ़"]),
  ...e("hindi", "विराम चिह्न", ["।", "॥", ",", "?", "!", ";", ":", "—", "‘ ’", "“ ”", "( )", "…", "-", "/"]),
  ...e("hindi", "अंक", ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"]),
  ...e("hindi", "व्याकरण संकेत", [["संज्ञा", "संज्ञा"], ["सर्वनाम", "सर्वनाम"], ["विशेषण", "विशेषण"], ["क्रिया", "क्रिया"], ["लिंग", "लिंग"], ["वचन", "वचन"], ["कारक", "कारक"], ["काल", "काल"], ["संधि", "संधि"], ["समास", "समास"], ["उपसर्ग", "उपसर्ग"], ["प्रत्यय", "प्रत्यय"], ["मुहावरा", "मुहावरा"], ["लोकोक्ति", "लोकोक्ति"], ["पर्यायवाची", "पर्यायवाची"], ["विलोम", "विलोम"]]),
  // ------------------------------------------------------------ sanskrit
  ...e("sanskrit", "स्वराः", ["अ", "आ", "इ", "ई", "उ", "ऊ", "ऋ", "ॠ", "ऌ", "ए", "ऐ", "ओ", "औ", "अं", "अः"]),
  ...e("sanskrit", "मात्राः", ["ा", "ि", "ी", "ु", "ू", "ृ", "ॄ", "ॢ", "े", "ै", "ो", "ौ", "ं", "ः", "ँ", "्", "ऽ"]),
  ...e("sanskrit", "व्यञ्जनानि", ["क", "ख", "ग", "घ", "ङ", "च", "छ", "ज", "झ", "ञ", "ट", "ठ", "ड", "ढ", "ण", "त", "थ", "द", "ध", "न", "प", "फ", "ब", "भ", "म", "य", "र", "ल", "व", "श", "ष", "स", "ह", "क्ष", "त्र", "ज्ञ"]),
  ...e("sanskrit", "चिह्नानि", ["।", "॥", "ऽ", "ॐ", "॰", "-", "…"]),
  ...e("sanskrit", "व्याकरणम्", [["सन्धिः", "सन्धिः"], ["समासः", "समासः"], ["विभक्तिः", "विभक्तिः"], ["वचनम्", "वचनम्"], ["लिङ्गम्", "लिङ्गम्"], ["लकारः", "लकारः"], ["धातुः", "धातुः"], ["प्रत्ययः", "प्रत्ययः"], ["कारकम्", "कारकम्"], ["शब्दरूपम्", "शब्दरूपम्"], ["धातुरूपम्", "धातुरूपम्"], ["लट् लृट् लङ् लोट् विधिलिङ्", "लकाराः"], ["प्रथमा द्वितीया तृतीया चतुर्थी पञ्चमी षष्ठी सप्तमी सम्बोधन", "विभक्तयः"]]),
  // ------------------------------------------------------------ english
  ...e("english", "Punctuation", [".", ",", "?", "!", ";", ":", "—", "–", "‘ ’", "“ ”", "( )", "…", "'s", "&"]),
  ...e("english", "Grammar labels", [["Noun", "noun"], ["Pronoun", "pronoun"], ["Verb", "verb"], ["Adjective", "adjective"], ["Adverb", "adverb"], ["Preposition", "preposition"], ["Conjunction", "conjunction"], ["Article", "article"], ["Tense", "tense"], ["Subject – Verb – Object", "SVO"], ["Active / Passive", "voice"], ["Direct / Indirect", "speech"], ["Synonym", "synonym"], ["Antonym", "antonym"], ["Phrasal verb", "phrasal verb"], ["Idiom", "idiom"]]),
  // ------------------------------------------------------------ sst
  ...e("sst", "Symbols", ["°N", "°S", "°E", "°W", "km", "km²", "%", "₹", "→", "↑", "↓", "≈", "BCE", "CE", "c.", "—"]),
  ...e("sst", "Geography", [["Scale 1 cm = 1 km", "map scale"], ["Latitude / Longitude", "lat/long"], ["Tropic of Cancer 23½° N", "Tropic of Cancer"], ["Equator 0°", "Equator"], ["IST = GMT + 5:30", "IST"], ["82½° E", "standard meridian"], ["Density of population = population / area", "population density"], ["Sex ratio = females per 1000 males", "sex ratio"], ["Literacy rate %", "literacy"]]),
  ...e("sst", "Economics", [["GDP", "GDP"], ["Per capita income = GDP / population", "per capita"], ["HDI", "HDI"], ["Inflation %", "inflation"], ["Demand ↑ Price ↑", "demand"], ["₹", "rupee"]]),
  // ------------------------------------------------------------ general
  ...e("general", "Common symbols", ["→", "←", "↑", "↓", "✓", "✗", "•", "…", "—", "±", "×", "÷", "=", "≠", "≈", "<", ">", "≤", "≥", "%", "°", "²", "³", "√", "π", "∞", "₹", "€", "$", "©", "®", "™", "§", "¶", "†", "‡", "★", "☆", "♠", "♣", "♥", "♦"]),
  ...e("general", "Greek letters", ["α", "β", "γ", "δ", "ε", "θ", "λ", "μ", "π", "ρ", "σ", "τ", "φ", "ω", "Δ", "Σ", "Ω"]),
  ...e("general", "Sub / superscript", ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉", "⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹", "ⁿ", "⁺", "⁻", "ₓ"]),
];

const SUBJECT_MATCHERS: { key: SubjectKey; test: RegExp }[] = [
  { key: "maths", test: /\b(math|maths|mathematics|ganit|गणित|arith)/i },
  { key: "physics", test: /\b(phy|physics|भौतिक)/i },
  { key: "chemistry", test: /\b(chem|chemistry|रसायन)/i },
  { key: "biology", test: /\b(bio|biology|जीव|botany|zoology)/i },
  { key: "science", test: /\b(sci|science|विज्ञान)/i },
  { key: "evs", test: /\b(evs|environment|environmental|world around|hamara parivesh|परिवेश|पर्यावरण)/i },
  { key: "computer", test: /\b(computer|comp|it\b|ict|informatics|coding|programming|कंप्यूटर)/i },
  { key: "hindi", test: /\b(hin|hindi|हिंदी|हिन्दी)/i },
  { key: "sanskrit", test: /\b(skt|san|sanskrit|संस्कृत)/i },
  { key: "english", test: /\b(eng|english|अंग्रेज़ी|अंग्रेजी)/i },
  { key: "sst", test: /\b(sst|social|history|geography|civics|economics|political|सामाजिक|इतिहास|भूगोल)/i },
];

/** Which catalogue subjects a paper's subject name / code maps to, most specific first. */
export function subjectKeysFor(subjectName: string): SubjectKey[] {
  const name = subjectName.trim();
  let keys: SubjectKey[] = [];
  for (const m of SUBJECT_MATCHERS) if (m.test.test(name)) keys.push(m.key);
  // "Social Science" and "Computer Science" are not science papers.
  if (keys.includes("sst") || keys.includes("computer")) {
    keys = keys.filter((k) => k !== "science" && k !== "physics" && k !== "chemistry" && k !== "biology");
  }
  // "Science" for VI–X spans physics, chemistry and biology.
  if (keys.includes("science")) {
    for (const k of ["physics", "chemistry", "biology"] as SubjectKey[]) if (!keys.includes(k)) keys.push(k);
  }
  if (keys.includes("evs") && !keys.includes("science")) keys.push("science");
  if (keys.includes("sanskrit") && !keys.includes("hindi")) keys.push("hindi");
  keys.push("general");
  return [...new Set(keys)];
}

export function subjectKeyLabel(key: SubjectKey): string {
  return (
    {
      maths: "Mathematics",
      physics: "Physics",
      chemistry: "Chemistry",
      biology: "Biology",
      science: "Science",
      evs: "EVS",
      computer: "Computer",
      hindi: "हिंदी",
      sanskrit: "संस्कृतम्",
      english: "English",
      sst: "Social Science",
      general: "General",
    } as Record<SubjectKey, string>
  )[key];
}

/** The catalogue for a paper's subject: its own groups first, then general. */
export function catalogFor(subjectName: string): FormulaEntry[] {
  const keys = subjectKeysFor(subjectName);
  const rank = new Map(keys.map((k, i) => [k, i]));
  return FORMULA_CATALOG.filter((f) => rank.has(f.subject)).sort(
    (a, b) => rank.get(a.subject)! - rank.get(b.subject)!,
  );
}

/** Group headings in catalogue order for a subject. */
export function groupsFor(entries: FormulaEntry[]): { subject: SubjectKey; group: string }[] {
  const seen = new Set<string>();
  const out: { subject: SubjectKey; group: string }[] = [];
  for (const f of entries) {
    const k = `${f.subject}::${f.group}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ subject: f.subject, group: f.group });
  }
  return out;
}

/** Case-insensitive search over insert, label and group; empty query = all. */
export function searchCatalog(entries: FormulaEntry[], query: string): FormulaEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (f) =>
      f.insert.toLowerCase().includes(q) ||
      f.label.toLowerCase().includes(q) ||
      f.group.toLowerCase().includes(q),
  );
}
