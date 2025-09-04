import React, { useLayoutEffect, useState, useRef }from 'react';
import { Text } from 'react-native-elements';
import { AppState } from 'react-native';
import { ConfirmModal } from '../../components';
import { useAppDispatch, useDynamicStyles } from '../../hooks';
import { navigationRef } from '../../navigation';
import { makeSelectDidFromProfile, selectWithFactory } from '../../store/selectorFactories';
import { stageCredentials } from '../../store/slices/credentialFoyer';
import {processIncomingRequest, handleVcApiExchange} from '../../lib/exchanges';
import { displayGlobalModal } from '../../lib/globalModal';
import GlobalModalBody from '../../lib/globalModalBody';
import { NavigationUtil } from '../../lib/navigationUtil';
import { delay } from '../../lib/time';
import { ExchangeCredentialsProps } from './ExchangeCredentials.d';

export default function ExchangeCredentials({ route }: ExchangeCredentialsProps): React.ReactElement {
  const { params } = route;
  const { request } = params;

  const dispatch = useAppDispatch();
  const { mixins } = useDynamicStyles();

  const [coldStart, setColdStart] = useState(true);
  const appState = useRef(AppState.currentState);

  useLayoutEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      //use AppState to determine if app is cold launched or not
      if (appState.current === null || nextAppState === 'background') {
        //if cold launch, auto-open the modal
        setColdStart(true);
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const dataLoadingSuccessModalState = {
    title: 'Success',
    confirmButton: true,
    confirmText: 'OK',
    cancelButton: false,
    body: <GlobalModalBody message='You have successfully delivered credentials to the organization.' />
  };

  /**
   * Called when user confirms Yes to the 'Incoming Message' modal below
   */
  const acceptExchange = async () => {
    setColdStart(false);
    const rawProfileRecord = await NavigationUtil.selectProfile();
    const didRecord = selectWithFactory(makeSelectDidFromProfile, { rawProfileRecord });

    const response = processIncomingRequest({ request, selectedDidRecord: didRecord });
    console.log('Response from handleIncomingRequest():', JSON.stringify(response, null, 2));

    const credentialField = response.verifiablePresentation?.verifiableCredential;
    const credentialFieldExists = !!credentialField;
    const credentialFieldIsArray = Array.isArray(credentialField);
    const credentialAvailable = credentialFieldExists && credentialFieldIsArray && credentialField.length > 0;

    if (credentialAvailable && navigationRef.isReady()) {
      const credential = credentialField[0];
      await dispatch(stageCredentials([credential]));
      await delay(500);
      navigationRef.navigate('AcceptCredentialsNavigation', {
        screen: 'ApproveCredentialsScreen',
        params: {
          rawProfileRecord
        }
      });
    } else {
      console.log('Credential not available.');
      displayGlobalModal(dataLoadingSuccessModalState);
      navigationRef.navigate('HomeNavigation', {
        screen: 'CredentialNavigation',
        params: {
          screen: 'HomeScreen',
        },
      });
    }
  };

  const rejectExchange = () => {
    coldStart && setColdStart(false);
    if (navigationRef.isReady() && navigationRef.canGoBack()) {
      navigationRef.goBack();
    } else {
      navigationRef.navigate('HomeNavigation', {
        screen: 'CredentialNavigation',
        params: {
          screen: 'HomeScreen',
        },
      });
    }
  };

  return (
    <ConfirmModal
      open={coldStart}
      onConfirm={acceptExchange}
      onCancel={rejectExchange}
      onRequestClose={() => {(!coldStart) && rejectExchange();}}
      title="Incoming Message"
      confirmText="Yes"
      cancelText="No">
      <Text style={mixins.modalBodyText}>
        An organization would like to exchange credentials with you.
      </Text>
      <Text style={mixins.modalBodyText}>
        Would you like to continue?
      </Text>
    </ConfirmModal>
  );
}
