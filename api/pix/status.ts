
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = (process.env["SIGILOPAY_API_BASE"] || "").replace(/\/+$/, "");

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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Método não permitido" });
  }

  const publicKey = process.env["SIGILOPAY_PUBLIC_KEY"];
  const secretKey = process.env["SIGILOPAY_SECRET_KEY"];
  const queryIdentifier = req.query["identifier"];
  const identifier = Array.isArray(queryIdentifier)
    ? text(queryIdentifier[0], 200)
    : text(queryIdentifier, 200);

  if (!API_BASE || !publicKey || !secretKey) {
    return json(res, 500, {
      error:
        "Configure SIGILOPAY_API_BASE, SIGILOPAY_PUBLIC_KEY e SIGILOPAY_SECRET_KEY na Vercel.",
    });
  }

  if (!identifier) {
    return json(res, 400, { error: "Identificador da transação inválido." });
  }

  // Este caminho deve corresponder ao endpoint oficial de consulta da SigiloPay.
  const configuredPath = (process.env["SIGILOPAY_STATUS_PATH"] || "").trim();

  if (!configuredPath) {
    return json(res, 501, {
      error:
        "Falta configurar SIGILOPAY_STATUS_PATH com o endpoint oficial de consulta da SigiloPay.",
    });
  }

  const cleanPath = configuredPath.replace(/^\/+|\/+$/g, "");
  const url = `${API_BASE}/${cleanPath}/${encodeURIComponent(identifier)}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "x-public-key": publicKey,
        "x-secret-key": secretKey,
        Accept: "application/json",
      },
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
        "Não foi possível consultar a transação na SigiloPay.";
      console.error("SigiloPay status request failed", {
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
    const rawStatus = firstText(
      [transaction["status"], result["status"]],
      40
    ).toUpperCase();

    const paid = rawStatus === "OK" || rawStatus === "PAID";
    const failed = rawStatus === "FAILED" || rawStatus === "CANCELED" || rawStatus === "CANCELLED";

    return json(res, 200, {
      payment: {
        id: firstText(
          [
            transaction["transactionId"],
            transaction["transaction_id"],
            transaction["id"],
            identifier,
          ],
          200
        ),
        amount: transaction["amount"] ?? asObject(transaction["order"])["amount"] ?? null,
        status: paid ? "paid" : failed ? "failed" : "pending",
        provider_status: rawStatus || "PENDING",
        paid,
        failed,
      },
    });
  } catch (error) {
    console.error(
      "Erro ao consultar status SigiloPay",
      error instanceof Error ? error.message : "unknown error"
    );
    return json(res, 502, {
      error: "Não foi possível conectar à SigiloPay para consultar o pagamento.",
    });
  }
}

