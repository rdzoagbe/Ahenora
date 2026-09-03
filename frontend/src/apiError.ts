/**
 * What to SAY when an API call fails.
 *
 * Every screen used to write `setErr(e?.message || t('something_failed'))`, in
 * 102 places. That `||` is backwards: `e.message` is whatever the server put in
 * its detail — English, written for a developer — so it wins, and the
 * translated line only ever appears when the server said nothing at all. A
 * French household running out of AI scans was shown "AI scan limit reached for
 * this billing period."
 *
 * So the rule here is absolute: a server string is NEVER shown to a person. The
 * status decides the sentence, the caller supplies the fallback, and the
 * server's own words go to the log where they are useful.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

interface ApiFailure {
  status?: number;
  message?: string;
  planLimit?: { feature?: string };
}

/** True when the call failed because the household is out of AI allowance. */
export function isAiAllowanceError(e: unknown): boolean {
  const err = e as ApiFailure;
  return err?.status === 402 && err?.planLimit?.feature === 'ai_scans';
}

/** True for any plan wall — out of allowance, or a feature the plan lacks. */
export function isPlanLimitError(e: unknown): boolean {
  return (e as ApiFailure)?.status === 402;
}

/**
 * The sentence to show. `fallbackKey` is what this particular action says when
 * nothing more specific applies — "the scan didn't work", "couldn't save".
 */
export function apiErrorText(e: unknown, t: Translate, fallbackKey: string): string {
  const err = e as ApiFailure;

  if (isAiAllowanceError(err)) return t('err_ai_allowance');
  // A different 402: a feature this plan does not include at all, rather than
  // an allowance that will come back next month.
  if (err?.status === 402) return t('err_plan_feature');
  if (err?.status === 401 || err?.status === 403) return t('err_signed_out');
  if (err?.status === 413) return t('err_too_large');
  if (err?.status && err.status >= 500) return t('err_server');
  // status 0 / undefined with a message is what fetch gives on a dead network.
  if (!err?.status) return t('err_offline');

  return t(fallbackKey);
}
