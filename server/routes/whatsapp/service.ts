const WHATSAPP_API_VERSION = "v24.0";

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "871803432691653";

  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  }

  return { accessToken, phoneNumberId };
}

function getApiUrl() {
  const { phoneNumberId } = getConfig();
  return `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
}

async function sendWhatsAppRequest(body: object) {
  const { accessToken } = getConfig();
  const url = getApiUrl();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("WhatsApp API error:", response.status, errorText);
    throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export async function sendTextMessage(to: string, text: string) {
  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  });
}

export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
  headerText?: string,
  footerText?: string,
) {
  const maxButtons = buttons.slice(0, 3);

  const interactive: any = {
    type: "button",
    body: { text: bodyText },
    action: {
      buttons: maxButtons.map((btn) => ({
        type: "reply",
        reply: { id: btn.id, title: btn.title.slice(0, 20) },
      })),
    },
  };

  if (headerText) {
    interactive.header = { type: "text", text: headerText };
  }
  if (footerText) {
    interactive.footer = { text: footerText };
  }

  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  });
}

export async function sendListMessage(
  to: string,
  bodyText: string,
  buttonLabel: string,
  rows: { id: string; title: string; description?: string }[],
  headerText?: string,
  footerText?: string,
) {
  const interactive: any = {
    type: "list",
    body: { text: bodyText },
    action: {
      button: buttonLabel.slice(0, 20),
      sections: [
        {
          title: "Options",
          rows: rows.slice(0, 10).map((row) => ({
            id: row.id,
            title: row.title.slice(0, 24),
            description: row.description?.slice(0, 72),
          })),
        },
      ],
    },
  };

  if (headerText) {
    interactive.header = { type: "text", text: headerText };
  }
  if (footerText) {
    interactive.footer = { text: footerText };
  }

  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  });
}

export async function markMessageAsRead(messageId: string) {
  try {
    const { accessToken, phoneNumberId } = getConfig();
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (e) {
    console.error("Failed to mark message as read:", e);
  }
}

export function formatQuickRepliesForWhatsApp(
  to: string,
  responseText: string,
  quickReplies: { label: string; value: string }[],
  clinicName?: string,
) {
  if (quickReplies.length === 0) {
    return { type: "text" as const, send: () => sendTextMessage(to, responseText) };
  }

  if (quickReplies.length <= 3) {
    const buttons = quickReplies.map((qr, i) => ({
      id: `qr_${i}_${Date.now()}`,
      title: qr.label,
    }));
    return {
      type: "button" as const,
      send: () =>
        sendButtonMessage(to, responseText, buttons, undefined, clinicName),
    };
  }

  const rows = quickReplies.map((qr, i) => ({
    id: `qr_${i}_${Date.now()}`,
    title: qr.label,
  }));
  return {
    type: "list" as const,
    send: () =>
      sendListMessage(
        to,
        responseText,
        "View Options",
        rows,
        undefined,
        clinicName,
      ),
  };
}
