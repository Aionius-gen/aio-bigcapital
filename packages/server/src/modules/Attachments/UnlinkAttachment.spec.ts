import { HttpStatus } from '@nestjs/common';
import { ServiceError } from '../Items/ServiceError';
import { ERRORS } from './constants';
import { UnlinkAttachment } from './UnlinkAttachment';

jest.mock('./decorators/InjectAttachable.decorator', () => ({
  getAttachableModelsMap: () => new Map([['SaleInvoice', true]]),
}));

const DOCUMENTS: Record<string, { id: number; key: string }> = {
  'key-1': { id: 1, key: 'key-1' },
  'key-2': { id: 2, key: 'key-2' },
};

const createService = (options: { deleteError?: Error } = {}) => {
  const deletedLinks: Array<Record<string, unknown>> = [];

  const documentModel = () => ({
    query: () => ({
      findOne: async (_column: string, key: string) => DOCUMENTS[key],
    }),
  });

  const documentLinkModel = () => ({
    query: () => {
      const conditions: Record<string, unknown> = {};
      const builder = {
        where: (column: string, value: unknown) => {
          conditions[column] = value;
          return builder;
        },
        delete: async () => {
          // Yield to the event loop so an un-awaited call would be observable.
          await new Promise((resolve) => setImmediate(resolve));
          if (options.deleteError) throw options.deleteError;
          deletedLinks.push({ ...conditions });
          return 1;
        },
      };
      return builder;
    },
  });

  const invoiceModel = () => ({
    query: () => ({
      findById: async (id: number) => (id === 10 ? { id } : undefined),
    }),
  });
  const moduleRef = { get: () => invoiceModel };

  const service = new UnlinkAttachment(
    moduleRef as any,
    documentModel as any,
    documentLinkModel as any,
  );
  return { service, deletedLinks };
};

describe('UnlinkAttachment', () => {
  describe('unlink', () => {
    it('deletes the link between the document and the model entry', async () => {
      const { service, deletedLinks } = createService();

      await service.unlink('key-1', 'SaleInvoice', 10);

      expect(deletedLinks).toEqual([
        { modelRef: 'SaleInvoice', modelId: 10, documentId: 1 },
      ]);
    });

    it('throws DOCUMENT_NOT_FOUND (404) when the document key does not exist', async () => {
      const { service, deletedLinks } = createService();

      const error = await service
        .unlink('missing-key', 'SaleInvoice', 10)
        .catch((e) => e);

      expect(error).toBeInstanceOf(ServiceError);
      expect(error.errorType).toBe(ERRORS.DOCUMENT_NOT_FOUND);
      expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(deletedLinks).toHaveLength(0);
    });

    it('throws DOCUMENT_LINK_REF_INVALID for a non-attachable model', async () => {
      const { service } = createService();

      const error = await service
        .unlink('key-1', 'Unknown', 10)
        .catch((e) => e);

      expect(error.errorType).toBe(ERRORS.DOCUMENT_LINK_REF_INVALID);
    });

    it('throws DOCUMENT_LINK_ID_INVALID for a missing model entry', async () => {
      const { service } = createService();

      const error = await service
        .unlink('key-1', 'SaleInvoice', 999)
        .catch((e) => e);

      expect(error.errorType).toBe(ERRORS.DOCUMENT_LINK_ID_INVALID);
    });
  });

  describe('bulkUnlink', () => {
    it('completes every unlink before resolving', async () => {
      const { service, deletedLinks } = createService();

      await service.bulkUnlink(['key-1', 'key-2'], 'SaleInvoice', 10);

      expect(deletedLinks.map((link) => link.documentId)).toEqual([1, 2]);
    });

    it('skips keys whose document no longer exists', async () => {
      const { service, deletedLinks } = createService();

      await expect(
        service.bulkUnlink(['missing-key', 'key-2'], 'SaleInvoice', 10),
      ).resolves.toBeUndefined();
      expect(deletedLinks.map((link) => link.documentId)).toEqual([2]);
    });

    it('rethrows unexpected errors so the transaction can roll back', async () => {
      const dbError = new Error('Deadlock found');
      const { service } = createService({ deleteError: dbError });

      await expect(
        service.bulkUnlink(['key-1'], 'SaleInvoice', 10),
      ).rejects.toBe(dbError);
    });
  });
});
