export class AppError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); }
}
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = error as { code?: string; message?: string; name?: string };
  if (/ENOTFOUND|EAI_AGAIN/.test(e?.code ?? "")) return new AppError("DNS", "Le nom de domaine ne peut pas être résolu.");
  if (/CERT|TLS|SSL|SELF_SIGNED/.test(e?.code ?? "")) return new AppError("SSL", "Le certificat SSL du site est invalide ou non reconnu.");
  if (/TIME|ABORT/i.test(`${e?.code} ${e?.name}`)) return new AppError("TIMEOUT", "Le site a dépassé le délai de réponse autorisé.");
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(e?.code ?? "")) return new AppError("NETWORK", "La connexion au site a été refusée ou interrompue.");
  return new AppError("EXTRACTION", "L’analyse n’a pas abouti : le contenu ou le format de réponse n’est pas exploitable.");
}
export function checkPage(status: number, text: string): void {
  const start = text.slice(0, 100_000);
  if (/cf-chl-|challenge-platform|<title>Just a moment/i.test(start)) throw new AppError("CLOUDFLARE", "Une vérification Cloudflare bloque l’accès. Aucun contournement n’est tenté.");
  if (/g-recaptcha|h-captcha|hcaptcha|captcha-container/i.test(start) && /verify|vérifi|robot|challenge/i.test(start)) throw new AppError("CAPTCHA", "La page demande un CAPTCHA. L’analyse s’arrête ici.");
  if (status === 401 || /<input[^>]+type=["']password/i.test(start) && /sign in|log in|connexion/i.test(start)) throw new AppError("AUTH", "Cette page nécessite une authentification.");
  if (status === 403) throw new AppError("HTTP_403", "Le site refuse l’accès (HTTP 403).");
  if (status === 429) throw new AppError("HTTP_429", "Le site limite les requêtes (HTTP 429). Réessayez plus tard.");
  if (status >= 400) throw new AppError(`HTTP_${status}`, `Le site répond avec une erreur HTTP ${status}.`);
}
