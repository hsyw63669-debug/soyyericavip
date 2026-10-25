
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = (process.env.SIGILOPAY_API_BASE || "").replace(/\/+$/, "");
const CREATE_PATH = "/gateway/pix/deposit";

const json = (res: VercelResponse, status: number, body: unknown) =>
  res
    .status(status)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .json(body);

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Método não permitido" });
  }

  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY;
  const secretKey = process.env.SIGILOPAY_SECRET_KEY;

  if (!API_BASE || !publicKey || !secretKey) {
    return json(res, 500, {
      error:
        "Configure SIGILOPAY_API_BASE, SIGILOPAY_PUBLIC_KEY e SIGILOPAY_SECRET_KEY nas variáveis de ambiente da Vercel.",
    });
  }

  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return json(res, 400, {
      error: "Valor inválido. Informe um valor entre R$ 1,00 e R$ 100.000,00.",
    });
  }

  const identifier =
    text(req.body?.idempotency_key, 80) ||
    text(req.body?.identifier, 80) ||
    `pix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const callbackUrl = text(
    process.env.SIGILOPAY_CALLBACK_URL || req.body?.callbackUrl,
    500
  );

  const payload: Record<string, unknown> = {
    amount: Number(amount.toFixed(2)),
    identifier,
  };

  if (callbackUrl) payload.callbackUrl = callbackUrl;

  try {
    const upstream = await fetch(`${API_BASE}${CREATE_PATH}`, {
      method: "POST",
      headers: {
        "x-public-key": publicKey,
        "x-secret-key": secretKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result: any = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message =
        text(result?.message, 300) ||
        text(result?.error, 300) ||
        "A SigiloPay recusou a criação da cobrança Pix.";
      console.error("SigiloPay create failed", { status: upstream.status, errorCode: result?.errorCode });
      return json(res, upstream.status, { error: message, errorCode: result?.errorCode });
    }

    const transaction = result?.data || result?.transaction || result;
    const pix = transaction?.pix || result?.pix || {};

    const pixCode = text(
      pix?.copyPaste ||
        pix?.copy_paste ||
        pix?.brcode ||
        pix?.payload ||
        pix?.emv ||
        pix?.pixCopiaECola ||
        transaction?.pix_copia_cola ||
        transaction?.pix_copy_paste ||
        transaction?.copy_paste ||
        transaction?.brcode,
      10000
    );

    let pixImage = text(
      pix?.qrCodeBase64 ||
        pix?.qr_code_base64 ||
        pix?.qrcode_base64 ||
        pix?.qrCode ||
        pix?.qr_code ||
        transaction?.qr_code_base64 ||
        transaction?.qrcode_base64,
      200000
    );

    if (pixImage && !pixImage.startsWith("data:") && !pixImage.startsWith("http")) {
      pixImage = `data:image/png;base64,${pixImage}`;
    }

    const transactionId = text(
      transaction?.transactionId ||
        transaction?.transaction_id ||
        transaction?.id ||
        result?.transactionId,
      200
    );

    const status = text(transaction?.status || result?.status, 40).toLowerCase();

    if (!transactionId) {
      console.error("SigiloPay response missing transactionId");
      return json(res, 502, {
        error: "A SigiloPay respondeu sem transactionId. Confira a estrutura da resposta na documentação.",
      });
    }

    if (!pixCode) {
      console.error("SigiloPay response missing recognized Pix copy-paste field");
⋮⋮⋮⋮
