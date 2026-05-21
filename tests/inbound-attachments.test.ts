import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file — its factory can't close over
// non-hoisted variables. vi.hoisted() lets the mock fns be available inside
// the factory AND inside the tests.
const { mockExtractFile, mockIngest } = vi.hoisted(() => ({
  mockExtractFile: vi.fn(),
  mockIngest: vi.fn(),
}));

vi.mock('@/lib/ingest/extract-file', () => ({ extractFile: mockExtractFile }));
vi.mock('@/lib/kb/ingest', () => ({ ingestKbDocument: mockIngest }));

import { persistInboundEmail } from '@/lib/email/inbound';

function mockDb(opts: { matchedProjectId?: string } = {}) {
  const projectsSingle = vi.fn().mockResolvedValue(
    opts.matchedProjectId ? { data: { id: opts.matchedProjectId } } : { data: null },
  );
  const inboundUpsert = vi.fn().mockResolvedValue({ data: { id: 'inbound-1' }, error: null });
  const inboundUpdate = vi.fn().mockResolvedValue({ error: null });
  return {
    from: (table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: projectsSingle,
            }),
          }),
        };
      }
      if (table === 'inbound_emails') {
        return {
          upsert: () => ({
            select: () => ({ single: inboundUpsert }),
          }),
          update: () => ({ eq: inboundUpdate }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    _inboundUpsert: inboundUpsert,
    _inboundUpdate: inboundUpdate,
  };
}

beforeEach(() => {
  mockExtractFile.mockReset();
  mockIngest.mockReset();
});

describe('persistInboundEmail — attachments', () => {
  it('ingests each attachment as its own kb_document with provenance source_ref', async () => {
    mockExtractFile
      .mockResolvedValueOnce({ text: 'PDF body content '.repeat(20), format: 'pdf', warnings: [] })
      .mockResolvedValueOnce({ text: 'DOCX body content '.repeat(20), format: 'docx', warnings: [] });
    mockIngest
      .mockResolvedValueOnce({ document_id: 'kb-body', chunk_count: 1, warnings: [] })
      .mockResolvedValueOnce({ document_id: 'kb-att-1', chunk_count: 1, warnings: [] })
      .mockResolvedValueOnce({ document_id: 'kb-att-2', chunk_count: 1, warnings: [] });

    const db = mockDb({ matchedProjectId: 'p-1' });
    const r = await persistInboundEmail(db as never, {
      message_id: 'msg-1',
      from: 'planner@cgg.gov.au',
      to: 'lot-442-seafields@inbound.test',
      subject: 'CGG audit',
      text: 'Body of the email exceeds thirty chars easily.',
      attachments: [
        { filename: 'audit.pdf', content_type: 'application/pdf', content_base64: Buffer.from('fake').toString('base64') },
        { filename: 'addendum.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content_base64: Buffer.from('fake').toString('base64') },
      ],
    });

    expect(r.kb_document_id).toBe('kb-body');
    expect(r.attachment_kb_document_ids).toEqual(['kb-att-1', 'kb-att-2']);
    expect(r.attachment_warnings).toEqual([]);

    // Per-attachment ingest carries the source_ref pattern so the operator
    // can trace a kb_document back to which email + which attachment.
    expect(mockIngest.mock.calls[1][1].sourceRef).toBe('email:msg-1:attachment:audit.pdf');
    expect(mockIngest.mock.calls[2][1].sourceRef).toBe('email:msg-1:attachment:addendum.docx');
  });

  it('rejects DWG attachments with a clear warning', async () => {
    mockExtractFile.mockResolvedValueOnce({ text: '', format: 'dwg', warnings: ['native CAD format'] });
    mockIngest.mockResolvedValueOnce({ document_id: 'kb-body', chunk_count: 1, warnings: [] });

    const db = mockDb({ matchedProjectId: 'p-1' });
    const r = await persistInboundEmail(db as never, {
      message_id: 'msg-2',
      from: 'drafter@modularwa.com.au',
      to: 'lot-442-seafields@inbound.test',
      subject: 'Drawings',
      text: 'See attached. ' + 'x'.repeat(40),
      attachments: [
        { filename: 'plan.dwg', content_type: 'application/octet-stream', content_base64: Buffer.from('fake').toString('base64') },
      ],
    });

    expect(r.attachment_kb_document_ids).toEqual([]);
    expect(r.attachment_warnings[0]).toContain('plan.dwg');
    expect(r.attachment_warnings[0]).toContain('native CAD');
  });

  it('still ingests attachments when the email body is empty', async () => {
    mockExtractFile.mockResolvedValueOnce({ text: 'PDF text '.repeat(20), format: 'pdf', warnings: [] });
    mockIngest.mockResolvedValueOnce({ document_id: 'kb-att-only', chunk_count: 1, warnings: [] });

    const db = mockDb({ matchedProjectId: 'p-1' });
    const r = await persistInboundEmail(db as never, {
      message_id: 'msg-3',
      from: 'someone@example.com',
      to: 'lot-442-seafields@inbound.test',
      subject: '',
      text: '',
      attachments: [
        { filename: 'spec.pdf', content_type: 'application/pdf', content_base64: Buffer.from('fake').toString('base64') },
      ],
    });

    expect(r.kb_document_id).toBeNull();
    expect(r.attachment_kb_document_ids).toEqual(['kb-att-only']);
  });

  it('refuses to ingest when no project matches the inbound alias', async () => {
    const db = mockDb({ matchedProjectId: undefined });
    const r = await persistInboundEmail(db as never, {
      message_id: 'msg-4',
      to: 'unknown-project@inbound.test',
      text: 'body '.repeat(20),
      attachments: [
        { filename: 'x.pdf', content_type: 'application/pdf', content_base64: Buffer.from('y').toString('base64') },
      ],
    });
    expect(r.project_id).toBeNull();
    expect(r.kb_document_id).toBeNull();
    expect(r.attachment_kb_document_ids).toEqual([]);
    expect(mockExtractFile).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it('warns on attachment with neither content_base64 nor url', async () => {
    mockIngest.mockResolvedValueOnce({ document_id: 'kb-body', chunk_count: 1, warnings: [] });
    const db = mockDb({ matchedProjectId: 'p-1' });
    const r = await persistInboundEmail(db as never, {
      message_id: 'msg-5',
      to: 'lot-442-seafields@inbound.test',
      text: 'body '.repeat(20),
      attachments: [{ filename: 'broken.pdf', content_type: 'application/pdf' }],
    });
    expect(r.attachment_warnings[0]).toContain('no content_base64 or url provided');
  });
});
