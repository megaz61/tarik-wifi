import { NextResponse } from 'next/server';
import { endSyncSession } from '@/lib/syncSession';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body?.sessionId) {
      await endSyncSession(body.sessionId);
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
