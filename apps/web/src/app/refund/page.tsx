import { permanentRedirect } from "next/navigation";

/**
 * `/refund` — the short form of the policy URL.
 *
 * The canonical page is `/refund-policy`: it is the URL in the site footer, on
 * the fees page, inside the terms, and the one already given to the payment
 * gateway. Serving a second copy of the policy here would mean two documents
 * that can disagree, which is precisely what a risk review penalises — so this
 * route redirects instead, and there is still only one refund policy.
 */
export default function RefundRedirectPage(): never {
  permanentRedirect("/refund-policy");
}
