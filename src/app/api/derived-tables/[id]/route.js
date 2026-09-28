import { NextResponse } from "next/server";
import { toDerived } from "@/lib/tables/rows";
import { sessionEmail, ownedDerived, unauthorized } from "@/lib/tables/routeUtils";

// desktop "get-derived-table"
export async function GET(req, { params }) {
  const email = await sessionEmail();
  if (!email) return unauthorized();
  const { id } = await params;
  const row = await ownedDerived(id, email);
  return row
    ? NextResponse.json({ success: true, derived: toDerived(row) })
    : NextResponse.json({ success: false, error: "This comparison table is no longer available." }, { status: 404 });
}
