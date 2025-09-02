import { StackScreenProps } from '@react-navigation/stack';
import { VcApiCredentialRequest } from '../../types/chapi';

export type ExchangeCredentialsNavigationParamList = {
  ExchangeCredentials: { request: VcApiCredentialRequest; };
};

export type ExchangeCredentialsProps = StackScreenProps<ExchangeCredentialsNavigationParamList, 'ExchangeCredentials'>;
