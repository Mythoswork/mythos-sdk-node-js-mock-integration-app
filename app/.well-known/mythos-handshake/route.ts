import { type NextRequest } from "next/server";
import { runHandshake } from "@/lib/mythos";

export async function GET(request: NextRequest) {
  const lt = request.nextUrl.searchParams.get("lt");
  const { status, body } = await runHandshake(lt);
  return Response.json(body, { status });
}
