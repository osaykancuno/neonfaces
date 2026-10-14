// The chat's last check (web/mcp/ask.mjs): phrases that turn a fact into advice or a forecast, in English and Italian.
// Narrower than What I see's wordingProblems (a model may say "Face #65 holds 0.02 NVDA": a fact), aimed at advice.
export { looksSecret as looksSecretText } from "../src/guard.js";

const ADVICE = [
  /\b(you|they|one)\s+(should|ought to|must|need to)\s+(buy|sell|hold|mint|ape|invest|keep|dump)/i,
  /\b(buy|sell|mint)\s+(now|today|before|while)\b/i,
  /\b(good|great|smart|bad|safe)\s+(investment|buy|bet|opportunity)\b/i,
  /\b(will|is going to|are going to|is likely to|could)\s+(rise|fall|go up|go down|increase|decrease|moon|pump|dump|grow|double)\b/i,
  /\bprice target\b/i, /\b(undervalued|overvalued)\b/i, /\bguarantee[ds]?\b/i, /\bto the moon\b/i, /\bnot financial advice but\b/i,
  /\bi (would|'d) (buy|sell|hold|mint)\b/i, /\brecommend (buying|selling|holding|minting|investing)\b/i,
  /\b(dovresti|devi|conviene)\s+(comprare|vendere|tenere|mintare|investire)\b/i, /\bti consiglio di\s+(comprare|vendere|tenere|mintare|investire)\b/i,
  /\b(salir[àa]|scender[àa]|raddoppier[àa]|crescer[àa])(?![a-z])/i, /\b(buon|ottimo|grande)\s+investimento\b/i, /\b(sottovalutat|sopravvalutat)\w*/i, /\bgarantit\w*/i,
];

export function adviceProblems(text) {
  return ADVICE.filter((r) => r.test(String(text))).map(String);
}
