/* eslint-disable indent */
import 'react-native-get-random-values';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button, Linking, ScrollView, Alert } from 'react-native';
import {
  Camera,
  useCameraDevices,
  useCodeScanner,
} from 'react-native-vision-camera';
import { NavHeader } from '../../components';
import { navigationRef } from '../../navigation';
import { styles } from '../../styles/WasScreen';
import authService from './services/authService';
import walletStorageService from './services/wasService';

// For QR code scanning
if (typeof btoa === 'undefined') {
  globalThis.btoa = (str: any) => Buffer.from(str, 'binary').toString('base64');
}

const WASScreen = () => {
  const cameraRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [resumeData, setResumeData] = useState();
  const [storedSuccessfully, setStoredSuccessfully] = useState(false);
  const [confirmingSession, setConfirmingSession] = useState(false);
  const [error, setError] = useState('');
  const [rawQRData, setRawQRData] = useState('');
  const devices = useCameraDevices();
  const device = devices.find(device => device.position === 'back');

  // Set up the server URL once
  useEffect(() => {
    // Set your development server URL
    authService.setDefaultServerUrl('http://192.168.1.9:3000');
  }, []);

  // Handle QR code scanning
  const onCodeScanned = (codes: any) => {
    if (codes.length > 0 && scanning) {
      const qrData = codes[0].value;
      setRawQRData(qrData);
      console.log('Raw QR Data:', qrData);

      try {
        let payload = null;

        if (qrData.startsWith('walletapp://import?payload=')) {
          const payloadParam = qrData.split('payload=')[1];
          const decodedPayload = decodeURIComponent(payloadParam);
          console.log('Decoded Payload:', decodedPayload);

          try {
            payload = JSON.parse(decodedPayload);
          } catch (parseError: any) {
            console.error('JSON parse error:', parseError);
            setError(
              `Failed to parse payload JSON: ${
                parseError.message
              }. Raw payload: ${decodedPayload.substring(0, 50)}...`
            );
            return;
          }
        }

        if (payload) {
          setScanning(false);
          processResumeData(payload);
        } else {
          setError('No valid payload found in QR code');
        }
      } catch (error: any) {
        console.error('Error processing QR code:', error);
        setError(
          `Failed to process QR code: ${
            error.message
          }. Raw data: ${qrData.substring(0, 50)}...`
        );
      }
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: onCodeScanned,
  });

  // Request camera permissions
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      if (status !== 'granted') {
        console.error('Camera permission not granted');
      }
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Set up deep link handling
  useEffect(() => {
    const linkingSubscription = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then(url => {
      if (url) {
        handleDeepLink({ url });
      }
    });
    return () => linkingSubscription.remove();
  }, []);

  // Handle deep links
  const handleDeepLink = ({ url }: { url: string }) => {
    if (url && url.startsWith('walletapp://import')) {
      try {
        const payloadParam = url.split('payload=')[1];
        if (payloadParam) {
          const decodedPayload = decodeURIComponent(payloadParam);
          const payload = JSON.parse(decodedPayload);
          processResumeData(payload);
        }
      } catch (error: any) {
        console.error('Error processing deep link:', error);
        setError('Failed to process the link: ' + error.message);
      }
    }
  };

  // Process the resume data received from QR or deep link
  const processResumeData = async (payload: any) => {
    try {
      setResumeData(payload);
      const { sessionId, token, appOrigin } = payload;

      if (sessionId && token) {
        setConfirmingSession(true);

        try {
          // Store the resume data in WAS using our service
          const result = await walletStorageService.storeResume(payload);

          if (result.success) {
            setStoredSuccessfully(true);

            // Confirm authentication with the web app using our service
            const confirmResult = await authService.confirmAuthentication(
              sessionId,
              token,
              appOrigin,
              result
            );

            if (confirmResult.success) {
              console.log('Backend authentication confirmed successfully');
            } else {
              console.warn('Authentication confirmation failed:', confirmResult.error);
              // Don't show error to user if storage succeeded but confirmation failed
            }
          } else {
            setError(result.error || 'Failed to store resume');
          }
        } catch (err: any) {
          setError(err.message);
        } finally {
          setConfirmingSession(false);
        }
      } else {
        // Non-authentication flow (direct credential storage)
        const result = await walletStorageService.storeCredential(payload);
        if (result.success) {
          setStoredSuccessfully(true);
        } else {
          setError(result.error || 'Failed to store credential');
        }
      }
    } catch (error: any) {
      console.error('Error processing data:', error);
      setError('Failed to process data: ' + error.message);
      setConfirmingSession(false);
    }
  };

  const showRawQRData = () => {
    if (rawQRData) {
      Alert.alert('Raw QR Data', rawQRData, [{ text: 'OK' }]);
    }
  };

  if (hasPermission === false) {
    return (
      <View style={styles.centered}>
        <Text>No access to camera</Text>
      </View>
    );
  }

  return (
    <>
      <NavHeader
        title='Connect Resume-Author'
        goBack={navigationRef.goBack}
      />
      <View style={styles.container}>
        {scanning ? (
          <View style={styles.cameraContainer}>
            {device ? (
              <Camera
                ref={cameraRef}
                style={styles.scanner}
                device={device}
                isActive={true}
                codeScanner={codeScanner}
                onInitialized={() => console.log('📸 Camera ready')}
                onError={error => {
                  console.error('Camera error:', error);
                  setError(error.message);
                }}
              />
            ) : (
              <Text>Loading camera...</Text>
            )}
            <Button
              title='Cancel Scan'
              onPress={() => setScanning(false)}
            />
          </View>
        ) : (
          <View style={styles.content}>
            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Error: {error}</Text>
                {rawQRData ? (
                  <Button
                    title='Show Raw QR Data'
                    onPress={showRawQRData}
                  />
                ) : null}
                <Button
                  title='Try Again'
                  onPress={() => {
                    setError('');
                    setRawQRData('');
                    setScanning(true);
                  }}
                />
              </View>
            ) : resumeData ? (
              <ScrollView style={styles.dataContainer}>
                <Text style={styles.successText}>
                  {confirmingSession
                    ? '⏳ Confirming with web application...'
                    : storedSuccessfully
                    ? '✅ Resume successfully stored in your wallet!'
                    : 'Processing resume...'}
                </Text>

                <Text style={styles.dataTitle}>Successfully Connected!</Text>

                <Button
                  title='View My Credentials'
                  // onPress={() => navigationRef.navigate('CredentialsScreen')}
                />
              </ScrollView>
            ) : (
              <>
                <Text style={styles.welcomeText}>
                  Scan a QR code to connect to your resume-author account.
                </Text>
                <Button
                  title='Scan QR'
                  onPress={() => setScanning(true)}
                />
              </>
            )}
          </View>
        )}
      </View>
    </>
  );
};

export default WASScreen;