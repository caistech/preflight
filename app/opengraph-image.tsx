import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Preflight — pre-submission triage for DA drawing sets';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: 'linear-gradient(135deg, #050505 0%, #0a1a13 100%)',
          color: '#ffffff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '12px',
              background: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0a0a0a',
              fontSize: '40px',
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <div style={{ fontSize: '32px', color: '#10b981', fontWeight: 600 }}>Preflight</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ fontSize: '64px', fontWeight: 700, lineHeight: 1.1, maxWidth: '900px' }}>
            Pre-submission triage for DA drawing sets
          </div>
          <div style={{ fontSize: '28px', color: '#9ca3af', lineHeight: 1.4, maxWidth: '900px' }}>
            Drop in a PDF. Get back a one-page sheet flagging known recurring issues against the project&apos;s accumulated knowledge — before the set leaves your desk.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
