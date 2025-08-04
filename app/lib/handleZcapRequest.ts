import AsyncStorage from '@react-native-async-storage/async-storage';
import { WAS_KEYS } from '../../app.config';
import { Ed25519VerificationKey2020 } from '@digitalcredentials/ed25519-verification-key-2020';
// @ts-ignore
import { ZcapClient } from '@digitalbazaar/ezcap';
import { Ed25519Signature2020 } from '@digitalcredentials/ed25519-signature-2020';

import { displayGlobalModal } from './globalModal';


interface ZcapReq {
    query: {
      type: string;
      capabilityQuery: {
        allowedAction: string[];
        controller: string;
        invocationTarget: {
          type: string;
          name: string;
          contentType: string;
        };
        reason: string;
      };
    }[];
}

export default async function handleZcapRequest({
  request,
}: {
  request: ZcapReq;
}) {
  const zcapQuery = request.query?.find((q: any) => q.type === 'ZcapQuery');
  if (!zcapQuery) {
    throw new Error('No ZcapQuery found in request.');
  }

  const { allowedAction, controller, invocationTarget, reason } =
    zcapQuery.capabilityQuery;

  const approved = await displayGlobalModal({
    title: 'App Permission Request',
    body: `Unrecognized Application is asking for the following permission:\n\n"${reason}"\n\nRead and Write access to the Verifiable Credentials collection`,
    confirmText: 'Allow',
    cancelText: 'Cancel',
    onConfirm: () => true,
    onCancel: () => false
  });
  if (!approved) {
    throw new Error('User denied Zcap delegation');
  }

  const rootSignerStr = await AsyncStorage.getItem(WAS_KEYS.SIGNER_JSON);
  if (!rootSignerStr) {
    throw new Error('Root signer not found in wallet.');
  }

  const rootSigner = await Ed25519VerificationKey2020.from(
    JSON.parse(rootSignerStr)
  );

  const cacheKey = `WAS_ZCAP_ROOT_${invocationTarget.type}`;
  const cached = await AsyncStorage.getItem(cacheKey);

  let parentCapability: string | object;

  if (cached) {
    parentCapability = JSON.parse(cached);
  } else {
    // Generate a root capability ID for this resource
    parentCapability = `urn:zcap:root:${encodeURIComponent(invocationTarget.type)}`;
    await AsyncStorage.setItem(cacheKey, JSON.stringify(parentCapability));
  }

  const zcapClient = new ZcapClient({
    SuiteClass: Ed25519Signature2020,
    delegationSigner: rootSigner.signer()
  });

  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10); // 10 days

  const delegatedZcap = await zcapClient.delegate({
    capability: parentCapability,
    controller,
    invocationTarget: invocationTarget.type,
    allowedActions: allowedAction,
    expires: expires.toISOString()
  });

  return {
    verifiablePresentation: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: 'VerifiablePresentation',
      verifiableCredential: [delegatedZcap]
    }
  };
}
