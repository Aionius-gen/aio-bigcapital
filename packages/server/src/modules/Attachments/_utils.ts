import { HttpStatus } from '@nestjs/common';
import { ServiceError } from '../Items/ServiceError';
import { ERRORS } from './constants';

export const validateDocumentExists = (document) => {
  if (!document) {
    throw new ServiceError(
      ERRORS.DOCUMENT_NOT_FOUND,
      'The document is not found.',
      null,
      HttpStatus.NOT_FOUND,
    );
  }
};

export const isDocumentNotFoundError = (error: unknown): boolean =>
  error instanceof ServiceError &&
  error.errorType === ERRORS.DOCUMENT_NOT_FOUND;

export const validateLinkModelExists = (LinkModel) => {
  if (!LinkModel) {
    throw new ServiceError(ERRORS.DOCUMENT_LINK_REF_INVALID);
  }
};

export const validateLinkModelEntryExists = (foundLinkModel) => {
  if (!foundLinkModel) {
    throw new ServiceError(ERRORS.DOCUMENT_LINK_ID_INVALID);
  }
};
