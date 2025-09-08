import { ZCAP_EXPIRES, WAS } from '../../app.config';
// @ts-ignore
import { ZcapClient } from '@digitalcredentials/ezcap';
import { Ed25519Signature2020 } from '@digitalcredentials/ed25519-signature-2020';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { displayGlobalModal } from './globalModal';
import { getRootSigner } from './getRootSigner';


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
        } | string;
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

  let rootSigner
  try {
    rootSigner = await getRootSigner();
  } catch (error) {
    throw new Error(`Error getting root signer: ${error}`);
  }

  // Get stored space UUID
  const storedSpaceUUID = await AsyncStorage.getItem(WAS.KEYS.SPACE_ID);
  if (!storedSpaceUUID) {
    throw new Error('No stored space ID found for WAS delegation');
  }

  const zcapClient = new ZcapClient({
    SuiteClass: Ed25519Signature2020,
    delegationSigner: rootSigner,
  });

  const invocationTargetUrl = new URL(`/space/${storedSpaceUUID}`, WAS.BASE_URL).toString();

  const allowedActions = ['GET', 'POST', 'PUT', 'DELETE'];

  const parentCapability = `urn:zcap:root:${encodeURIComponent(invocationTargetUrl)}`;

  const delegatedZcap = await zcapClient.delegate({
    capability: parentCapability,
    controller,
    invocationTarget: invocationTargetUrl,
    allowedActions,
    expires: ZCAP_EXPIRES.toISOString(),
  });

  return { zcap: delegatedZcap };
}
