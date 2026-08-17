/**
 * Builds the Google Apps Script text shown in the trigger dialog for
 * the user to copy into their form's Script editor.
 *
 * The x-webhook-secret value is intentionally left as a placeholder
 * here, not the real secret — this file runs in a "use client"
 * component (see dialog.tsx), so anything referenced here ends up in
 * the browser bundle. The actual GOOGLE_FORM_WEBHOOK_SECRET must stay
 * server-only (.env / Vercel env vars); the user pastes it in by hand
 * after copying this script, matching what the server in
 * src/app/api/webhooks/google-form/route.ts checks for.
 */
export function generateGoogleFormScript(webhookUrl: string): string {
  return `function onFormSubmit(e) {
  const formResponse = e.response;
  const itemResponses = formResponse.getItemResponses();

  const responses = {};
  itemResponses.forEach((itemResponse) => {
    responses[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });

  const formData = {
    formId: FormApp.getActiveForm().getId(),
    formTitle: FormApp.getActiveForm().getTitle(),
    responseId: formResponse.getId(),
    timestamp: formResponse.getTimestamp().toISOString(),
    respondentEmail: formResponse.getRespondentEmail() || null,
    responses: responses,
  };

  const webhookUrl = "${webhookUrl}";

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(formData),
    headers: {
      "x-webhook-secret": "PASTE_YOUR_GOOGLE_FORM_WEBHOOK_SECRET_HERE"
    }
  };

  UrlFetchApp.fetch(webhookUrl, options);
}`;
}