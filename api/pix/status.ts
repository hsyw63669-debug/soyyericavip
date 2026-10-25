
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = (process.env.SIGILOPAY_API_BASE || "").replace(/\\/+$/, "");

const json = (res: VercelResponse, status: number, body: unknown) =>
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return json(res, 405, { error: "Método não permitido" });
  }

  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY;
  const secretKey = process.env.SIGILOPAY_SECRET_KEY;
  const id = text(req.query.identifier, 200);

  if (!API_BASE || !publicKey || !secretKey) {
    return json(res, 500, {
      error: "Configure SIGILOPAY_API_BASE, SIGILOPAY_PUBLIC_KEY e SIGILOPAY_SECRET_KEY na Vercel.",
    });
  }

  if (!id) {
    return json(res, 400, { error: "Identificador da transação inválido." });
  }

  // Configure este caminho somente após confirmar o endpoint oficial
  // de consulta de transação na documentação da SigiloPay.
  const statusPath = process.env.SIGILOPAY_STATUS_PATH?.trim();
  if (!statusPath) {
    return json(res, 501, {
      error: "Falta configurar SIGILOPAY_STATUS_PATH com o endpoint oficial de consulta da SigiloPay.",
    });
  }

  const url = `${API_BASE}/${statusPath.replace(/^\\/+/, "").replace(/\\/+$/, "")}/${encodeURIComponent(id)}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "x-public-key": publicKey,
        "x-secret-key": secretKey,
        Accept: "application/json",
      },
    });

    const result: any = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message = text(result?.message, 300) || text(result?.error, 300) ||
        "Não foi possível consultar a transação na SigiloPay.";
      console.error("SigiloPay status request failed", {
        status: upstream.status,
        errorCode: result?.errorCode,
      });
      return json(res, upstream.status, { error: message, errorCode: result?.errorCode });
    }

    const transaction = result?.data || result?.transaction || result;
    const rawStatus = text(transaction?.status || result?.status, 40).toUpperCase();

    // Conforme a documentação enviada: OK, FAILED ou PENDING.
    const paid = rawStatus === "OK";
    const failed = rawStatus === "FAILED";

    return json(res, 200, {
      payment: {
        id: text(transaction?.transactionId || transaction?.transaction_id || transaction?.id || id, 200),
        amount: transaction?.amount ?? transaction?.order?.amount,
        status: paid ? "paid" : failed ? "failed" : "pending",
        provider_status: rawStatus || "PENDING",
        paid,
        failed,
      },
    });
  } catch {
    console.error("Erro de conexão ao consultar status SigiloPay");
    return json(res, 502, {
      error: "Não foi possível conectar à SigiloPay para consultar o pagamento.",
    });
  }
}

