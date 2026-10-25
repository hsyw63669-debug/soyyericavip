
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = (process.env["SIGILOPAY_API_BASE"] || "").replace(/\/+$/, "");
const CREATE_PATH = "/gateway/pix/deposit";

type JsonObject = Record<string, unknown>;

function json(res: VercelResponse, status: number, body: unknown) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .json(body);
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object"
    ? (value as JsonObject)
    : {};
}

function firstText(values: unknown[], max = 200): string {
  for (const value of values) {
    const result = text(value, max);
    if (result) return result;
  }
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Método não permitido" });
  }

  const publicKey = process.env["SIGILOPAY_PUBLIC_KEY"];
  const secretKey = process.env["SIGILOPAY_SECRET_KEY"];

  if (!API_BASE || !publicKey || !secretKey) {
    return json(res, 500, {
      error:
        "Configure SIGILOPAY_API_BASE, SIGILOPAY_PUBLIC_KEY e SIGILOPAY_SECRET_KEY nas variáveis de ambiente da Vercel.",
    });
  }

  const body = asObject(req.body);
  const amount = Number(body["amount"]);

  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return json(res, 400, {
      error: "Valor inválido. Informe um valor entre R$ 1,00 e R$ 100.000,00.",
    });
  }

  const identifier =
    firstText([body["idempotency_key"], body["identifier"]], 80) ||
    `pix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const callbackUrl = firstText(
    [process.env["SIGILOPAY_CALLBACK_URL"], body["callbackUrl"]],
    500
  );

  const payload: JsonObject = {
    amount: Number(amount.toFixed(2)),
    identifier,
  };

  if (callbackUrl) payload["callbackUrl"] = callbackUrl;

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

    const rawResponse = await upstream.text();
    let parsed: unknown = {};
    try {
      parsed = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      parsed = {};
    }

    const result = asObject(parsed);

    if (!upstream.ok) {
      const message =
        firstText([result["message"], result["error"], result["detail"]], 300) ||
        "A SigiloPay recusou a criação da cobrança Pix.";
      console.error("SigiloPay create failed", {
        status: upstream.status,
        errorCode: result["errorCode"],
      });
      return json(res, upstream.status, {
        error: message,
        errorCode: result["errorCode"] ?? null,
      });
    }

    const transaction = asObject(
      result["data"] || result["transaction"] || result
    );
    const pix = asObject(transaction["pix"] || result["pix"]);
    const order = asObject(transaction["order"] || result["order"]);

    const pixCode = firstText(
      [
        pix["code"],
        pix["copyPaste"],
        pix["copy_paste"],
        pix["brcode"],
        pix["payload"],
        pix["emv"],
        pix["pixCopiaECola"],
        pix["pixCopyPaste"],
        transaction["pix_copia_cola"],
        transaction["pix_copy_paste"],
        transaction["copy_paste"],
