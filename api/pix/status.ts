import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = process.env.ATENASPAY_API_BASE || "https://atenaspay.com.br/api";

const json = (res: VercelResponse, status: number, body: unknown) =>
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return json(res, 405, { error: "Método não permitido" });

  const apiKey = process.env.ATENASPAY_API_KEY;
  const id = String(req.query.identifier || "").trim();

  if (!apiKey) {
    return json(res, 500, { error: "Configure ATENASPAY_API_KEY na Vercel." });
  }
  if (!id || id.length > 200) {
    return json(res, 400, { error: "Identificador inválido." });
  }

  try {
    const upstream = await fetch(`${API_BASE}/pix/${encodeURIComponent(id)}`, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });

    const result: any = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message =
        typeof result?.message === "string"
          ? result.message
          : typeof result?.error === "string"
          ? result.error
          : "Não foi possível consultar o Pix na AtenasPay.";
      return json(res, upstream.status || 502, { error: message });
    }

    const transaction = result?.transaction ?? result?.data ?? result;
    const rawStatus = String(transaction?.status || result?.status || "pending").toLowerCase();

    const paid = ["paid", "completed", "confirmed", "approved", "success", "settled"].includes(rawStatus);
    const failed = ["expired", "cancelled", "canceled", "failed", "refunded", "rejected"].includes(rawStatus);

    return json(res, 200, {
      payment: {
        id: transaction?.id || transaction?.txid || id,
        amount: transaction?.amount,
        status: paid ? "paid" : failed ? "failed" : "pending",
        paid,
        failed,
      },
    });
  } catch (error) {
    console.error("Erro ao consultar AtenasPay", error);
    return json(res, 502, { error: "Não foi possível consultar o status na AtenasPay." });
  }
}
