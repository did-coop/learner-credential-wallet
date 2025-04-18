export interface ConfirmationResult {
  success: boolean;
  error?: string;
}

export interface ConfirmationData {
  sessionId: string;
  token: string;
  resumeData: {
    wasResourceName: string;
    wasStorageTimestamp: string;
    storedSuccessfully: boolean;
    didController?: string;
  };
}

class AuthenticationService {
  private defaultServerUrl: string = 'http://localhost:3000';

  // Function to confirm authentication with the backend
  async confirmAuthentication(
    sessionId: string,
    token: string,
    appOrigin: string | null,
    result: any
  ): Promise<ConfirmationResult> {
    try {
      // Use provided origin or fall back to default
      const serverUrl = appOrigin || this.defaultServerUrl;
      const confirmUrl = `${serverUrl}/api/lcw/confirm`;

      console.log(`Confirming authentication with ${confirmUrl}`);

      // Prepare verification data
      const verificationData: ConfirmationData = {
        sessionId,
        token,
        resumeData: {
          wasResourceName: result.resourceName,
          wasStorageTimestamp: new Date().toISOString(),
          storedSuccessfully: true,
          didController: result.didController,
        },
      };

      // Log the verification data being sent
      console.log('Sending verification data:', JSON.stringify(verificationData));

      // Send confirmation to backend
      const response = await fetch(confirmUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(verificationData),
      });

      console.log(`Response status: ${response.status}`);

      // Handle non-successful responses
      if (!response.ok) {
        let errorText = '';
        try {
          const errorData = await response.json();
          errorText = errorData.error || errorData.message || 'Unknown error';
        } catch (e) {
          errorText = await response.text();
        }
        
        throw new Error(`Server responded with status ${response.status}: ${errorText}`);
      }

      // Parse the response
      const responseData = await response.json();
      console.log('Authentication confirmed successfully:', responseData);

      return { success: true };
    } catch (error: any) {
      console.error('Error confirming authentication:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to confirm authentication'
      };
    }
  }

  // Set the default server URL for future requests
  setDefaultServerUrl(url: string): void {
    this.defaultServerUrl = url;
  }

  // Get the default server URL
  getDefaultServerUrl(): string {
    return this.defaultServerUrl;
  }
}

export const authService = new AuthenticationService();

export default authService;