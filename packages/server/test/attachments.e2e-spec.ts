import request = require('supertest');
import { app, AuthorizationHeader, orgainzationId } from './init-app-test';

describe('Attachments (e2e)', () => {
  it('/attachments/:id/presigned-url (GET)', async () => {
    const upload = await request(app.getHttpServer())
      .post('/attachments')
      .set('organization-id', orgainzationId)
      .set('Authorization', AuthorizationHeader)
      .attach('file', Buffer.from('attachment test content'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

    // Uploading requires an S3-compatible service which is not available in
    // every test environment, so skip when the upload cannot be performed.
    if (upload.status !== 200 || !upload.body?.data?.id) {
      return;
    }

    return request(app.getHttpServer())
      .get(`/attachments/${upload.body.data.id}/presigned-url`)
      .set('organization-id', orgainzationId)
      .set('Authorization', AuthorizationHeader)
      .expect(200);
  });

  describe('unlinking from a sale invoice', () => {
    let invoiceId: number;
    let invoiceBody: Record<string, unknown>;

    const api = () => ({
      post: (url: string) =>
        request(app.getHttpServer())
          .post(url)
          .set('organization-id', orgainzationId)
          .set('Authorization', AuthorizationHeader),
      put: (url: string) =>
        request(app.getHttpServer())
          .put(url)
          .set('organization-id', orgainzationId)
          .set('Authorization', AuthorizationHeader),
      get: (url: string) =>
        request(app.getHttpServer())
          .get(url)
          .set('organization-id', orgainzationId)
          .set('Authorization', AuthorizationHeader),
    });

    const uploadFile = async (): Promise<string | null> => {
      const upload = await api()
        .post('/attachments')
        .attach('file', Buffer.from('attachment test content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        });
      return upload.status === 200 ? upload.body?.data?.key : null;
    };

    const getInvoiceAttachmentKeys = async (): Promise<string[]> => {
      const invoice = await api()
        .get(`/sale-invoices/${invoiceId}`)
        .expect(200);
      return (invoice.body.attachments ?? []).map(
        (attachment: { key: string }) => attachment.key,
      );
    };

    beforeAll(async () => {
      await api()
        .put('/transactions-locking/cancel-lock')
        .send({ reason: 'Cancel lock for e2e test' });

      const customer = await api().post('/customers').send({
        displayName: 'Attachments Customer',
        customerType: 'business',
        currencyCode: 'USD',
      });
      const item = await api()
        .post('/items')
        .send({
          name: `Attachments Item ${Date.now()}`,
          type: 'service',
          sellable: true,
          sellAccountId: 1026,
          sellPrice: 100,
        });

      invoiceBody = {
        customerId: customer.body.id,
        invoiceDate: '2023-01-01',
        dueDate: '2023-02-01',
        invoiceNo: `ATT-${Date.now()}`,
        delivered: false,
        entries: [{ index: 1, itemId: item.body.id, quantity: 1, rate: 100 }],
      };
      const invoice = await api()
        .post('/sale-invoices')
        .send(invoiceBody)
        .expect(201);
      invoiceId = invoice.body.id;
    });

    it('/attachments/:id/unlink (POST) removes the link and keeps the document', async () => {
      const key = await uploadFile();
      if (!key) return; // S3 is not available in this environment.

      const linkBody = { modelRef: 'SaleInvoice', modelId: invoiceId };
      // Keys look like `<organizationId>/<uuid>`, so encode the slash.
      const path = `/attachments/${encodeURIComponent(key)}`;
      await api().post(`${path}/link`).send(linkBody).expect(201);
      expect(await getInvoiceAttachmentKeys()).toContain(key);

      await api()
        .post(`${path}/unlink`)
        .send(linkBody)
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toBe(
            'The document has been unlinked successfully.',
          );
        });
      expect(await getInvoiceAttachmentKeys()).not.toContain(key);

      // The document survives the unlink, so it can be linked again.
      await api().post(`${path}/link`).send(linkBody).expect(201);
    });

    it('/attachments/:id/unlink (POST) returns 404 for an unknown document key', () => {
      return api()
        .post('/attachments/unknown-document-key/unlink')
        .send({ modelRef: 'SaleInvoice', modelId: invoiceId })
        .expect(404)
        .expect((res) => {
          expect(res.body.errors[0].type).toBe('DOCUMENT_NOT_FOUND');
        });
    });

    it('/sale-invoices/:id (PUT) unlinks attachments removed from the invoice', async () => {
      const keptKey = await uploadFile();
      const removedKey = await uploadFile();
      if (!keptKey || !removedKey) return; // S3 is not available.

      await api()
        .put(`/sale-invoices/${invoiceId}`)
        .send({
          ...invoiceBody,
          attachments: [{ key: keptKey }, { key: removedKey }],
        })
        .expect(200);
      expect(await getInvoiceAttachmentKeys()).toEqual(
        expect.arrayContaining([keptKey, removedKey]),
      );

      await api()
        .put(`/sale-invoices/${invoiceId}`)
        .send({ ...invoiceBody, attachments: [{ key: keptKey }] })
        .expect(200);

      const keys = await getInvoiceAttachmentKeys();
      expect(keys).toContain(keptKey);
      expect(keys).not.toContain(removedKey);
    });
  });
});
