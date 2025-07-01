import { drive, type drive_v3, auth as gauth } from '@googleapis/drive';
import type { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager';
import type { DocumentInterface } from '@langchain/core/documents';
import {
  BaseRetriever,
  type BaseRetrieverInput,
} from '@langchain/core/retrievers';
import type {
  ExternalAccountClientOptions,
  JWTInput,
} from 'google-auth-library';

export interface GoogleDriveRetrieverArgs extends BaseRetrieverInput {
  credentials: JWTInput | ExternalAccountClientOptions;
  folderId: string;
  scopes: string[];
}

export class GoogleDriveRetriever extends BaseRetriever {
  static lc_name() {
    return 'GoogleDriveRetriever';
  }

  lc_namespace = ['pangeacyber', 'retrievers', 'google_drive_retriever'];

  private folderId: string;

  private files: drive_v3.Resource$Files;

  constructor(args: GoogleDriveRetrieverArgs) {
    super(args);
    this.folderId = args.folderId;

    const auth = new gauth.GoogleAuth({
      credentials: args.credentials,
      scopes: args.scopes,
    });
    this.files = drive({ version: 'v3', auth }).files;
  }

  async _getRelevantDocuments(
    _query: string,
    _runManager?: CallbackManagerForRetrieverRun
  ): Promise<DocumentInterface<Record<string, unknown>>[]> {
    const results = await this.files.list({
      q: `'${this.folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    });

    if (!results.data.files) {
      return [];
    }

    const docs = await Promise.all(
      results.data.files.map((file) =>
        file.id ? this._loadDocumentFromFile(file.id) : Promise.resolve(null)
      )
    );

    return docs.filter((doc) => doc !== null);
  }

  async _loadDocumentFromFile(
    fileId: string
  ): Promise<DocumentInterface<Record<string, unknown>>> {
    const result = await this.files.export({ fileId, mimeType: 'text/plain' });
    return {
      id: fileId,
      pageContent: result.data as string,
      metadata: {},
    };
  }
}
