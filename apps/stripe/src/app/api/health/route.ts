import { NextResponse } from "next/server";

/**
 * Health check endpoint for ALB target group health checks.
 * Returns 200 OK when the service is healthy.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "healthy",
      service: "stripe-app",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
