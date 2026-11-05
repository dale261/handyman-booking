export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function baseUrl(): string {
  return process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function accessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID || "";
  const secret = process.env.PAYPAL_CLIENT_SECRET || "";
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PayPal login failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("PayPal login failed");
  return body.access_token;
}

export type PayPalCheck = {
  /** Keys present and PayPal accepted them. */
  ok: boolean;
  /** "live" takes real money; "sandbox" is PayPal's test system. */
  mode: "live" | "sandbox";
  /** One plain sentence for the owner. */
  detail: string;
};

let lastCheck: { at: number; result: PayPalCheck } | null = null;
const CHECK_TTL_MS = 10 * 60 * 1000;

/**
 * Ask PayPal whether the keys in the environment work, so the owner can see
 * "connected" on a page instead of running a test payment to find out.
 * Cached for ten minutes per server instance.
 */
export async function checkPayPalKeys(force = false): Promise<PayPalCheck> {
  const mode: PayPalCheck["mode"] = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  if (!paypalConfigured()) {
    return { ok: false, mode, detail: "No PayPal keys in Vercel yet. Customers see “we'll contact you to take payment”." };
  }
  if (!force && lastCheck && Date.now() - lastCheck.at < CHECK_TTL_MS) return lastCheck.result;
  let result: PayPalCheck;
  try {
    await accessToken();
    result = {
      ok: true,
      mode,
      detail:
        mode === "live"
          ? "Connected. PayPal accepted the keys, and payments go to your PayPal Business account."
          : "Connected to PayPal's TEST system (PAYPAL_ENV is not “live”). Real cards are not charged. Set PAYPAL_ENV to live in Vercel and redeploy.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayPal login failed";
    result = {
      ok: false,
      mode,
      detail: /401/.test(message)
        ? "PayPal rejected the keys. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Vercel (Live tab keys, no extra spaces), then redeploy."
        : `Couldn't reach PayPal just now (${message}). Reload in a minute.`,
    };
  }
  lastCheck = { at: Date.now(), result };
  return result;
}

export async function createPayPalOrder(input: {
  amount: number;
  invoiceNumber: number | null;
  jobId: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; approveUrl: string }> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: input.invoiceNumber ? String(input.invoiceNumber) : input.jobId,
          invoice_id: input.invoiceNumber ? String(input.invoiceNumber) : undefined,
          description: `eX Construction invoice ${input.invoiceNumber ?? ""}`.trim(),
          amount: { currency_code: "USD", value: input.amount.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: "eX Construction",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        shipping_preference: "NO_SHIPPING",
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PayPal order failed (${res.status})`);
  const body = (await res.json()) as { id?: string; links?: { rel: string; href: string }[] };
  const approve = body.links?.find((link) => link.rel === "approve");
  if (!body.id || !approve) throw new Error("PayPal did not return a pay link");
  return { id: body.id, approveUrl: approve.href };
}

export type PayPalOrderState = {
  /** CREATED, APPROVED, COMPLETED, VOIDED, ... */
  status: string;
  /** What the order was created for. A capture always takes exactly this. */
  amount: number;
  /** Set once the order has been captured (status COMPLETED). */
  captureId: string | null;
  captureStatus: string;
};

/** Look at an order before capturing it: its amount, whether the customer approved it, and whether it was already captured. */
export async function getPayPalOrder(orderId: string): Promise<PayPalOrderState> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PayPal order lookup failed (${res.status})`);
  const body = (await res.json()) as {
    status?: string;
    purchase_units?: { amount?: { value?: string }; payments?: { captures?: { id?: string; status?: string }[] } }[];
  };
  const unit = body.purchase_units?.[0];
  const amount = Number(unit?.amount?.value);
  if (!Number.isFinite(amount)) throw new Error("PayPal order lookup was incomplete");
  const capture = unit?.payments?.captures?.[0];
  return {
    status: body.status || "",
    amount,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status || "",
  };
}

export async function capturePayPalOrder(orderId: string): Promise<{ captureId: string; amount: number; status: string }> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PayPal capture failed (${res.status})`);
  const body = (await res.json()) as {
    status?: string;
    purchase_units?: { payments?: { captures?: { id?: string; amount?: { value?: string }; status?: string }[] } }[];
  };
  const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
  const amount = Number(capture?.amount?.value);
  if (!capture?.id || !Number.isFinite(amount)) throw new Error("PayPal capture was incomplete");
  return { captureId: capture.id, amount, status: capture.status || body.status || "" };
}

/** Refund one captured PayPal payment. Caller decides what to do if this throws. */
export async function refundPayPalCapture(captureId: string, amount: number): Promise<{ id: string; status: string }> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: { currency_code: "USD", value: amount.toFixed(2) },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`PayPal refund failed (${res.status})`);
  const body = (await res.json()) as { id?: string; status?: string };
  if (!body.id) throw new Error("PayPal refund was incomplete");
  return { id: body.id, status: body.status || "" };
}
