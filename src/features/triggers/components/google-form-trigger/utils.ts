/**
 * Builds the Google Apps Script text shown in the trigger dialog for
 * the user to copy into their form's Script editor.
 *
 * webhookSecret is now the real, workflow-specific secret, fetched
 * via workflows.getWebhookSecret (ownership-checked, decrypted
 * server-side) and passed in from dialog.tsx. Baking it directly into
 * the generated script is intentional: the workflow owner needs their
 * own secret to configure their own Apps Script, and this endpoint
 * only ever returns the secret for a workflow the requester actually
 * owns — same trust boundary as viewing a stored Credential value.
 */
export function generateGoogleFormScript(webhookUrl: string, webhookSecret: string): string {
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
      "x-webhook-secret": "${webhookSecret}"
    }
  };

  UrlFetchApp.fetch(webhookUrl, options);
}`;
}