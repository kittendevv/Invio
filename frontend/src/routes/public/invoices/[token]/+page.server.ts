import { backendGet } from "$lib/backend";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  // The document itself is served by the backend (iframe); only look up
  // whether it is a credit note so the heading can say so.
  let isCreditNote = false;
  try {
    const doc = await backendGet(`/api/v1/public/invoices/${params.token}`, "");
    isCreditNote = doc?.documentType === "credit_note";
  } catch {
    /* unknown or unpublished token: the iframe shows the error */
  }
  return { token: params.token, isCreditNote };
};
