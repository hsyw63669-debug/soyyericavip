import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = process.env.ATENASPAY_API_BASE || "https://atenaspay.com.br/api";

const json = (res: VercelResponse, status: number, body: unknown) =>
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Método não permitido" });

  const apiKey = process.env.ATENASPAY_API_KEY;
  if (!apiKey) {
    return json(res, 500, { error: "Configure ATENASPAY_API_KEY nas variáveis de ambiente da Vercel." });
  }

  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return json(res, 400, { error: "Valor inválido. Informe um valor entre R$ 1,00 e R$ 100.000,00." });
  }

  const externalId = text(req.body?.idempotency_key, 80) || `bianca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const description = text(req.body?.description, 120) || "Acesso exclusivo";

  const payload: Record<string, unknown> = {
    amount: Number(amount.toFixed(2)),
    external_id: externalId,
    description,
  };

  // Optional webhook URL if you want per-charge (or set globally in dashboard)
  if (process.env.ATENASPAY_WEBHOOK_URL) {
    payload.webhook_url = process.env.ATENASPAY_WEBHOOK_URL;
  }

  try {
    const upstream = await fetch(`${API_BASE}/pix/create`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result: any = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message =
        result?.message ||
        result?.error ||
        result?.error_description ||
        "A AtenasPay recusou a cobrança Pix.";
      console.error("AtenasPay error", { status: upstream.status, result });
      return json(res, upstream.status || 502, { error: message, details: result });
    }

    // Flexible field extraction (common patterns across gateways)
    const transaction = result?.transaction || result?.data || result;
    const pixCode = text(
      transaction?.pix_copia_cola ||
      transaction?.pix_copy_paste ||
      transaction?.copy_paste ||
      transaction?.brcode ||
      result?.pix_copia_cola ||
      result?.pix?.copyPaste,
      10000
    );

    let pixImage = text(
      transaction?.qr_code_base64 ||
      transaction?.qrcode_base64 ||
      transaction?.qr_code ||
      result?.qr_code_base64 ||
      result?.pix?.qrCodeBase64,
      200000
    );

    if (pixImage && !pixImage.startsWith("data:") && !pixImage.startsWith("http")) {
      pixImage = `data:image/png;base64,${pixImage}`;
    }

    const id = text(
      transaction?.id ||
      transaction?.txid ||
      transaction?.transaction_id ||
      result?.id ||
      externalId,
      200
    );

    if (!pixCode && !id) {
      console.error("Resposta inesperada da AtenasPay", result);
      return json(res, 502, { error: "A AtenasPay respondeu, mas não retornou o código Pix." });
    }

    return json(res, 200, {
      identifier: id || externalId,
      pix_code: pixCode,
      pix_image: pixImage || null,
      payment: {
        id: id || externalId,
        status: (transaction?.status || result?.status || "pending").toString().toLowerCase(),
        expires_at: transaction?.expires_at || transaction?.expiresAt || result?.expires_at || null,
      },
    });
  } catch (error) {
    console.error("Erro ao conectar à AtenasPay", error);
    return json(res, 502, { error: "Não foi possível conectar à AtenasPay. Tente novamente em instantes." });
  }
}
