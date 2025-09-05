import uuid from 'react-native-uuid';
import * as vc from '@digitalcredentials/vc';
import { Ed25519Signature2020 } from '@digitalcredentials/ed25519-signature-2020';
import { securityLoader } from '@digitalcredentials/security-document-loader';
import { ObjectId } from 'bson';
import store from '../store';
import validator from 'validator';
import { CredentialRecord, DidRecordRaw } from '../model';
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
import { HumanReadableError } from './error';
import { ISigner, IVerifiableCredential, IVerifiablePresentation } from '@digitalcredentials/ssi';
import { IQueryByExample, IVpOffer, IVprDetails, IVpRequest, IZcap } from './vcApi';
import { extractCredentialsFrom } from './verifiableObject';

const MAX_INTERACTIONS = 10;

/**
 * Posts the initial {} body to the Exchanger endpoint to start an exchange
 * @param url
 * @param request
 */
export async function startExchange ({ url }: { url: string }): Promise<any> {
  try {
    const exchangeResponseRaw = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    return exchangeResponseRaw.json();
  } catch (err) {
    console.log(`Error on initial POST {} to endpoint "${url}".`);
    throw err;
  }
}

// Selects credentials to exchange with issuer or verifier
export async function selectCredentials (credentialRecords: CredentialRecordRaw[]): Promise<CredentialRecordRaw[]> => {
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

type IResponseToExchanger = {
  verifiablePresentation?: VerifiablePresentation;
  zcap?: IZcap | IZcap[];
}

/**
 * Recursively processes one or more VC API exchange messages.
 * If necessary, prompt the user to select which VCs to send.
 *
 * @param requestOrOffer - Exchange message to process.
 * @param selectedDidRecord - In case DIDAuthentication is required.
 * @param rootZcapSigner - In case zCaps are requested.
 * @param [interactions=0] {number} - Prevents infinite request loops.
 */
export async function processMessageChain (
  { requestOrOffer, selectedDidRecord, rootZcapSigner, interactions = 0 }:
  { requestOrOffer: IVpRequest | IVpOffer,
    selectedDidRecord: DidRecordRaw, rootZcapSigner: ISigner, interactions?: number }
): Promise<{ acceptCredentials?: IVerifiableCredential[] }> {
  // Classify the message
  let request, offer;
  if ('verifiablePresentation' in requestOrOffer) {
    offer = requestOrOffer.verifiablePresentation as IVerifiablePresentation;
  } else {
    request = requestOrOffer.verifiablePresentationRequest as IVprDetails;
  }

  // Check to see if this is an offer, if it is, return and finish
  if (offer) {
    return { acceptCredentials: extractCredentialsFrom(offer)! }
  }
  if (interactions === MAX_INTERACTIONS) {
    throw new Error(`Request timed out after ${interactions} interactions`);
  }
  // Check to see if 'interact' property is present (nothing to do if not there)
  if (!request?.interact) {
    console.log('[processMessageChain] No "interact" property, ending exchange.');
    return {};
  }

  // Process the queries (assemble and confirm credentials, delegate zcaps)
  const { query } = request!;
  const queries = Array.isArray(query) ? query : [query];

  const { credentials, zcaps } = await processRequestQueries({ queries, rootZcapSigner });

  if (credentials.length > 0) {
    // Prompt user to confirm / select which VCs to send
    const selectedVcs = (await selectCredentials(credentials))
      .map((r) => r.credential);
  }

  const response: IResponseToExchanger = {};
  if (zcaps.length > 0) {
    response.zcap = zcaps;
  }
  // Compose a VerifiablePresentation (to send to the requester) if appropriate

  // const vpToSend = ...
  // if (isDidAuthenticationRequested(queries)) {
  //   signVp( selectedDidRecord )
  // }

  // if (vpToSend) {
  //   response.verifiablePresentation = vpToSend;
  // }

  // const responseFromExchanger = await sendToExchanger({ interactUrl, response });
  // if (responseFromExchanger) {
  //   return processMessageChain (
  //     { requestOrOffer: responseFromExchanger, selectedDidRecord,
  //       rootZcapSigner, interactions: interactions + 1 });
  // }

  // No further requests from exchanger, end exchange
  return {};
}

/**
 * Handles an incoming VP/zCap/DIDAuth/Signing request,
 * parsed from a deep link.
 *
 * @param request
 * @param selectedDidRecord
 */
export async function processIncomingRequest (
  { request, selectedDidRecord }:
  { request: VcApiCredentialRequest, selectedDidRecord: DidRecordRaw }
): Promise<ExchangeResponse> {
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
  credentials: CredentialRecordRaw[]
  zcaps: IZcap[]
}

export async function processRequestQueries(
  { queries, rootZcapSigner }:
    { queries: any[], rootZcapSigner: ISigner }
): Promise<TQueryResult> {
  const vcs: CredentialRecordRaw[] = [];
  const zcaps: IZcap[] = [];

  for (const query of queries) {
    console.log(`Processing query type "${query.type}"`);
    switch (query.type) {
    case VcQueryType.Example:
      vcs.concat(await processQueryByExample({ query }));
      break;
    case VcQueryType.ZcapQuery:
      zcaps.push(await delegateZcap({ query, rootZcapSigner }));
      break;
    default:
      throw new HumanReadableError(`Unsupported query type: "${query.type}"`)
    }
  }
  return { credentials: vcs, zcaps };
}

export async function processQueryByExample({ query }: { query: IQueryByExample }): Promise<CredentialRecordRaw[]> {
  const allRecords = await CredentialRecord.getAllCredentialRecords();
  return filterCredentialRecordsByType(allRecords, query);
}

export async function delegateZcap({ query, rootZcapSigner }): Promise<IZcap> {

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

      const finalResponse = await startExchange(interactUrl, vp);
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
