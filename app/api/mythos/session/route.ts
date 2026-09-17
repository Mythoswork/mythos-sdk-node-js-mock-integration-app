import { type NextRequest } from "next/server";
import { verifyAndConsumeLaunchToken } from "@/lib/mythos";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const lt = request.nextUrl.searchParams.get("lt");
  if (!lt) {
    return Response.json({ error: "Missing launch token" }, { status: 401 });
  }
  const { status, body } = await verifyAndConsumeLaunchToken(lt);
  return Response.json(body, { status });
}
