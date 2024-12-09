import process from 'node:process';

import { config } from '@dotenvx/dotenvx';
import { StringOutputParser } from '@langchain/core/output_parsers';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { defineCommand, runMain } from 'citty';
import { consola } from 'consola';
import { createStuffDocumentsChain } from 'langchain/chains/combine_documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { PangeaConfig, VaultService } from 'pangea-node-sdk';

import { GoogleDriveRetriever } from './retrievers/google-drive.js';

config({ override: true, quiet: true });

const prompt = ChatPromptTemplate.fromMessages([
  HumanMessagePromptTemplate.fromTemplate(`You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you don't know the answer, just say that you don't know. Use three sentences maximum and keep the answer concise.
Question: {input}
Context: {context}
Answer:`),
]);

const main = defineCommand({
  args: {
    prompt: { type: 'positional' },
    googleDriveFolderId: {
      type: 'string',
      required: true,
      description: 'The ID of the Google Drive folder to fetch documents from.',
    },
    vaultItemId: {
      type: 'string',
      required: true,
      description:
        'The item ID of the Google Drive credentials in Pangea Vault.',
    },
    model: {
      type: 'string',
      default: 'gpt-4o-mini',
      description: 'OpenAI model.',
    },
  },
  async run({ args }) {
    const vaultToken = process.env.PANGEA_VAULT_TOKEN;
    if (!vaultToken) {
      consola.warn('PANGEA_VAULT_TOKEN is not set.');
      return;
    }

    const pangeaDomain = process.env.PANGEA_DOMAIN || 'aws.us.pangea.cloud';

    // Fetch service account credentials from Pangea Vault.
    const vault = new VaultService(
      vaultToken,
      new PangeaConfig({ domain: pangeaDomain })
    );
    const vaultResult = await vault.getBulk({
      filter: { id: args.vaultItemId },
    });
    const rawDriveCredentials =
      vaultResult.result.items[0].item_versions[0].secret;

    // Fetch documents.
    const driveRetriever = new GoogleDriveRetriever({
      credentials: JSON.parse(rawDriveCredentials!),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      folderId: args.googleDriveFolderId,
    });
    const docs = await driveRetriever.invoke('');

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 3500,
      chunkOverlap: 50,
    });
    const splits = await splitter.splitDocuments(docs);
    const vectorStore = await MemoryVectorStore.fromDocuments(
      splits,
      new OpenAIEmbeddings()
    );
    const retriever = vectorStore.asRetriever();

    const llm = new ChatOpenAI({ model: args.model });
    const chain = await createStuffDocumentsChain({
      llm,
      prompt,
      outputParser: new StringOutputParser(),
    });

    consola.log(
      await chain.invoke({
        input: args.prompt,
        context: await retriever.invoke(args.prompt),
      })
    );
  },
});

runMain(main);
