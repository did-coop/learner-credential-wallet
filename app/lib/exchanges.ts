import uuid from 'react-native-uuid';
import * as vc from '@digitalcredentials/vc';
import { Ed25519Signature2020 } from '@digitalcredentials/ed25519-signature-2020';
import { securityLoader } from '@digitalcredentials/security-document-loader';
import { ObjectId } from 'bson';
import store from '../store';
import validator from 'validator';
import { CredentialRecord, DidRecord, DidRecordRaw } from '../model';
import { navigationRef } from '../navigation';
import { clearSelectedExchangeCredentials, selectExchangeCredentials } from '../store/slices/credentialFoyer';
import { Credential, CredentialRecordRaw, VcQueryType } from '../types/credential';
import { VerifiablePresentation } from '../types/presentation';
import { clearGlobalModal, displayGlobalModal } from './globalModal';
import { getGlobalModalBody } from './globalModalBody';
import { delay } from './time';
import { filterCredentialRecordsByType } from './credentialMatching';
import handleZcapRequest from './handleZcapRequest';
import { VcApiCredentialRequest } from '../types/chapi';
import { Ed25519VerificationKey2020 } from '@digitalcredentials/ed25519-verification-key-2020';
import {HumanReadableError} from './error';
import { IVerifiableCredential, IZcap } from '@digitalcredentials/ssi';

const MAX_INTERACTIONS = 10;

// Interact with VC-API exchange
async function postToExchange (url: string, request: any): Promise<any> {
  const exchangeResponseRaw = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  return exchangeResponseRaw.json();
}

// Select credentials to exchange with issuer or verifier
const selectCredentials = async (credentialRecords: CredentialRecordRaw[]): Promise<CredentialRecordRaw[]> => {
  // ensure that the selected credentials have been cleared
  // before subscribing to redux store updates below
  store.dispatch(clearSelectedExchangeCredentials());
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const selectedExchangeCredentials: CredentialRecordRaw[] = store.getState().credentialFoyer.selectedExchangeCredentials;
    if (selectedExchangeCredentials.length === 0) {
      break;
    } else {
      await delay(500);
    }
  }

  let resolvePromise: (value: CredentialRecordRaw[]) => void;
  const selectionPromise = new Promise((resolve: (value: CredentialRecordRaw[]) => void) => {
    resolvePromise = resolve;
  });

  const unsubscribe = store.subscribe(async () => {
    // increase likelihood that the selected credentials
    // have been recorded before processing them
    await delay(1000);
    const selectedExchangeCredentials: CredentialRecordRaw[] = store.getState().credentialFoyer.selectedExchangeCredentials;
    if (selectedExchangeCredentials.length > 0) {
      resolvePromise(selectedExchangeCredentials);
      unsubscribe();
      store.dispatch(clearSelectedExchangeCredentials());
    }
  });

  clearGlobalModal();
  const credentialRecordIds = credentialRecords.map((r: CredentialRecordRaw) => r._id);
  const credentialFilter = (r: CredentialRecordRaw) => {
    return credentialRecordIds.some((id: ObjectId) => r._id.equals(id));
  };
  navigationRef.navigate('CredentialSelectionScreen', {
    title: 'Share Credentials',
    instructionText: 'Select credentials to share.',
    credentialFilter,
    goBack: () => {
      const cancelSendModalState = {
        title: 'Cancel Send',
        confirmButton: false,
        cancelButton: false,
        body: getGlobalModalBody('Ending credential request. To send credentials, open another request.', true)
      };
      displayGlobalModal(cancelSendModalState);
      store.dispatch(clearSelectedExchangeCredentials());
      navigationRef.navigate('HomeNavigation', {
        screen: 'CredentialNavigation',
        params: {
          screen: 'HomeScreen',
        },
      });
      setTimeout(() => {
        clearGlobalModal();
      }, 2000);
    },
    onSelectCredentials: (s: CredentialRecordRaw[]) => {
      const dataLoadingPendingModalState = {
        title: 'Sending Credential',
        confirmButton: false,
        cancelButton: false,
        body: getGlobalModalBody('This will only take a moment.', true)
      };
      displayGlobalModal(dataLoadingPendingModalState);
      store.dispatch(selectExchangeCredentials(s));
    }
  });

  return selectionPromise;
};

// Type definition for constructExchangeRequest function parameters
type ConstructExchangeRequestParameters = {
  credentials?: Credential[];
  challenge?: string | undefined;
  domain: string | undefined;
  holder: string;
  suite: Ed25519Signature2020;
  signed?: boolean;
};

// Type definitions for constructExchangeRequest function output
type ExchangeRequest = {
  verifiablePresentation: VerifiablePresentation
}
type ExchangeResponse = ExchangeRequest;

// Type definition for constructExchangeRequest function parameters
type CreatePresentationParameters = {
  verifiableCredential?: any[];
  id?: string | undefined;
  now?: string | undefined;
  holder: string;
};

// Construct exchange request in the form of a verifiable presentation
export const constructExchangeRequest = async ({
  credentials=[],
  challenge=uuid.v4() as string,
  domain,
  holder,
  suite,
  signed=true
}: ConstructExchangeRequestParameters): Promise<ExchangeRequest> => {
  const presentationOptions: CreatePresentationParameters = { holder };
  if (credentials.length !== 0) {
    presentationOptions.verifiableCredential = credentials;
  }
  const presentation = vc.createPresentation(presentationOptions);
  let finalPresentation = presentation;
  if (signed) {
    const documentLoader = securityLoader({ fetchRemoteContexts: true }).build();
    finalPresentation = await vc.signPresentation({
      presentation,
      challenge,
      domain,
      suite,
      documentLoader
    });
  }
  return { verifiablePresentation: finalPresentation };
};

// Type definition for handleVcApiExchangeSimple function parameters
type HandleVcApiExchangeSimpleParameters = {
  url: string;
  request: ExchangeRequest;
};

// Handle simplified VC-API credential exchange workflow
export const handleVcApiExchangeSimple = async ({ url, request }: HandleVcApiExchangeSimpleParameters): Promise<ExchangeResponse> => {
  const exchangeResponseRaw = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request, undefined, 2)
  });

  return exchangeResponseRaw.json();
};

// Type definition for handleVcApiExchangeComplete function parameters
type HandleVcApiExchangeParameters = {
  url: string;
  request?: any;
  holder: string;
  suite: Ed25519Signature2020;
  interactions?: number;
  interactive?: boolean;
};

export async function fetchVprFromExchange ({
  url, request, interactions = 0
}: { url: string, request: any, interactions?: number }): Promise<any> {
  if (interactions === MAX_INTERACTIONS) {
    throw new Error(`Request timed out after ${interactions} interactions`);
  }
  const exchangeResponse = await postToExchange(url, request);
  console.log('Initial exchange response:', JSON.stringify(exchangeResponse, null, 2));

  return exchangeResponse;
}

/**
 * Handles an incoming VP/zCap/DIDAuth/Signing request,
 * parsed from a deep link.
 *
 * @param request
 * @param selectedDidRecord
 */
export async function handleIncomingRequest (
  { request, selectedDidRecord }:
  { request: VcApiCredentialRequest, selectedDidRecord: DidRecordRaw }
): Promise<ExchangeResponse> {
  /**
   * Example request shapes:
   * { credentialRequestOrigin, protocols }
   * { verifiablePresentationRequest: { interact, query } }
   * { issueRequest: { interact, credential } }
   */
  const { credentialRequestOrigin, protocols,
    verifiablePresentationRequest, issueRequest } = request;

  console.log('credentialRequestOrigin (self-asserted):', credentialRequestOrigin);

  if (issueRequest) {
    // Short circuit unsupported request
    throw new HumanReadableError('Issue/signing requests not supported yet.');
  }

  /**
   * Get the VPR either directly (from 'verifiablePresentationRequest' property),
   * or indirectly from a remote source (via the 'protocols' property).
   */
  let vpr;
  if (protocols) {
    if (!protocols.vcapi) {
      throw new HumanReadableError('Only the "vcapi" protocol is currently supported.');
    }
    const { vcapi: url} = protocols
    // Start the exchange process - POST an empty {} to the exchange API url
    console.log('CHAPI: Sending initial {} request to:', url);
    vpr = (await fetchVprFromExchange({ url, request: {} })).verifiablePresentationRequest;
  } else {
    // VPR was provided directly
    vpr = verifiablePresentationRequest;
  }

  const { query, challenge, domain, interact } = vpr;

  const queries = Array.isArray(query) ? query : [query];
  const { credentials, zcaps } = await processRequestQueries({ queries });

  if (interactive && credentials.length > 0) {
    const credentialRecords = await selectCredentials(filteredCredentialRecords);
    credentials = credentialRecords.map((r) => r.credential);
  }

  if (credentials.length > 0) {
    queryResult.verifiableCredential = vcs;
  }
  if (zcaps.length > 0) {
    queryResult.zcap = zcaps;
  }

  // Later, determine if DIDAuth is needed

  const holder = selectedDidRecord?.didDocument.authentication[0].split('#')[0] as string;
  const key = await Ed25519VerificationKey2020.from(selectedDidRecord?.verificationKey);
  const suite = new Ed25519Signature2020({ key });

  const exchangeRequest = await constructExchangeRequest({ credentials, challenge, domain, holder, suite, signed });
  const exchangeUrl = interact?.service[0]?.serviceEndpoint ?? url;
  console.log(`Sending request to "${exchangeUrl}":`, exchangeRequest);
  return handleVcApiExchange({
    url: exchangeUrl, request: exchangeRequest, holder, suite,
    interactions: interactions + 1, interactive
  });

  return response;
}

export type TQueryResult = {
  credentials: IVerifiableCredential[]
  zcaps: IZcap[]
}

export async function processRequestQueries(
  { queries, selectedDidRecord }:
    { queries: any[], selectedDidRecord: DidRecordRaw }
): Promise<TQueryResult> {
  const vcs: IVerifiableCredential[] = [];
  const zcaps: IZcap[] = [];

  for (const query of queries) {
    console.log(`Processing query type "${query.type}"`);
    switch (query.type) {
    case VcQueryType.Example:
      vcs.concat(await processQueryByExample({ query }));
      break;
    case VcQueryType.ZcapQuery:
      zcaps.push(await delegateZcap({ query, selectedDidRecord }));
      break;
    default:
      throw new HumanReadableError(`Unsupported query type: "${query.type}"`)
    }
  }
  return { credentials: vcs, zcaps };
}

export async function processQueryByExample({ query }): Promise<IVerifiableCredential[]> {
  const allRecords = await CredentialRecord.getAllCredentialRecords();
  const filteredCredentialRecords: CredentialRecordRaw[] =
    filterCredentialRecordsByType(allRecords, query);
  return filteredCredentialRecords.map((r) => r.credential);
}

export async function delegateZcap({ query, selectedDidRecord }): Promise<IZcap> {

}

/**
 * Handles the VC-API credential exchange workflow, which consists of
 * a series of request/response rounds with the remote Exchanger.
 * Note that this may called recursively, which is why it keeps track
 * of iterations (to avoid infinite loops).
 *
 * @param url
 * @param request
 * @param holder
 * @param suite
 * @param interactions
 * @param interactive
 */
export async function handleVcApiExchange ({
  url,
  request,
  holder,
  suite,
  interactions = 0,
  interactive = true
}: HandleVcApiExchangeParameters): Promise<ExchangeResponse> {
  if (interactions === MAX_INTERACTIONS) {
    throw new Error(`Request timed out after ${interactions} interactions`);
  }
  if (!validator.isURL(url + '')) {
    throw new Error(`Received invalid interaction URL from issuer: ${url}`);
  }

  // if (!exchangeResponse.verifiablePresentationRequest) {
  //   console.log('No VPR requested from the exchange, returning.');
  //   return exchangeResponse;
  // }

  let signed = false;
  let credentials: Credential[] = [];
  let filteredCredentialRecords: CredentialRecordRaw[] = [];
  const { query, challenge, domain, interact } = exchangeResponse.verifiablePresentationRequest;

  let queries = query;
  if (!Array.isArray(queries)) {
    queries = [query];
  }
  for (const query of queries) {
    console.log(`Processing query type "${query.type}"`);
    switch (query.type) {
    case VcQueryType.DidAuthLegacy:
    case VcQueryType.DidAuth:
      signed = true;
      break;
    // TODO: Support multi-round interactions for zcaps (currently only supports a single round interaction)
    case VcQueryType.ZcapQuery: {
      const vp = await handleZcapRequest({
        request: exchangeResponse.verifiablePresentationRequest
      });
      const interactUrl = exchangeResponse.verifiablePresentationRequest?.interact?.serviceEndpoint;
      if (!interactUrl) {
        throw new Error('Missing serviceEndpoint in VPR interact.');
      }

      const finalResponse = await postToExchange(interactUrl, vp);
      return finalResponse;
    }
    default: {
      console.log('Querying...');
    }
    }
  }

  const exchangeRequest = await constructExchangeRequest({ credentials, challenge, domain, holder, suite, signed });
  const exchangeUrl = interact?.service[0]?.serviceEndpoint ?? url;
  console.log(`Sending request to "${exchangeUrl}":`, exchangeRequest);
  return handleVcApiExchange({
    url: exchangeUrl, request: exchangeRequest, holder, suite,
    interactions: interactions + 1, interactive
  });
}
